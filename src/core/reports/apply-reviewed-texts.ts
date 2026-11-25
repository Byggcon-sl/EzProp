import { and, eq, inArray, isNull } from "drizzle-orm";
import { AccessDeniedError } from "@/core/access";
import { recordDecisionIn, restorePolishSuggestion } from "@/core/ai";
import {
  aiUsageLog,
  checkpointResults,
  deviationMeasures,
  deviations,
  type AiSuggestionStatus,
  type TextSource,
} from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { ReportValidationError } from "./errors";
import { applyReviewedTextsInputSchema, parseOrThrow, reviewTextSchema } from "./schemas";
import type { ApplyReviewedTexts, ApplyReviewedTextsResult, ReviewChoice } from "./types";
import { auditReport, withRoomWrite, type WriteScope } from "./write";

/*
 * Lagringen i «Gå gjennom tekstene» (docs/funksjoner/fase2a-ga-gjennom-tekstene.md, Omfang
 * `applyReviewedTexts`, A605, A607 og A612). Alle valgene lagres i én transaksjon med låst rapport
 * (`withRoomWrite`): tekst og beslutning sammen, eller ingenting.
 *
 * - Nettleseren sender bare valget. Serveren slår opp loggraden med `grant.organizationId` og
 *   utleder tabell, rad og felt fra `target_ref`. Målet må være en levende rad i dette rommet.
 * - Serveren avgjør beslutningen: «Bruk» skriver forslaget med plassholderne byttet tilbake på
 *   serveren og gir `accepted`; «Rett før bruk» gir `accepted` bare når teksten er lik forslaget,
 *   ellers `edited`; «Behold» gir `rejected`; «Angre» skriver teksten før tilbake og gir `rejected`.
 * - Er raden endret av andre etter gjennomgangen (høyere `row_version` enn sendt), hoppes feltet
 *   over og nevnes i svaret. Flere felt på samme rad lagres med én oppdatering, så `row_version`
 *   øker én gang per rad og felt to og tre ikke ser «endret av andre».
 * - Ethvert avslag avviser hele listen, uten KI-kall. TG leses og skrives aldri her.
 * - Revisjonsloggen får én linje per valg med id-er, feltkode og koder, aldri tekst.
 *
 * Hovedmål: KI i bunnen (serveren avgjør og logger beslutningen per felt) og færre reklamasjoner
 * (endrede felt overskrives ikke, TG er urørt, og en publisert rapport er låst).
 */

/** Funksjonskoden for språkvask i `ai_usage_log.feature` (fast kode, regel 6). */
const LANGUAGE_POLISH = "language_polish";

/** Feltene i avviket som kan språkvaskes, med kolonnen. */
const DEVIATION_COLUMNS = {
  deviation_text: "deviationText",
  cause_text: "causeText",
  consequence_text: "consequenceText",
} as const;
type DeviationField = keyof typeof DEVIATION_COLUMNS;

/** Feltnavnene i svaret («hoppet over»). Samme navn som skjermen bruker. */
const FIELD_LABELS: Record<string, string> = {
  deviation_text: "Avviksbeskrivelse",
  cause_text: "Årsak",
  consequence_text: "Konsekvens",
  text: "Tiltak",
  description_text: "Beskrivelse av punktet",
};

const CHANGED_MESSAGE =
  "Forslaget kan ikke brukes som det er, fordi feltet er endret. Velg «Rett før bruk».";

/** Raden teksten skrives i. Nøkkelen er tabell og id. */
type TargetRow =
  | {
      table: "deviations";
      id: string;
      checkpointId: string;
      rowVersion: number;
      textSource: TextSource;
      texts: Record<DeviationField, string | null>;
    }
  | {
      table: "deviation_measures";
      id: string;
      deviationId: string;
      checkpointId: string;
      rowVersion: number;
      textSource: TextSource;
      text: string;
    }
  | {
      table: "checkpoint_results";
      id: string;
      checkpointId: string;
      rowVersion: number;
      text: string | null;
    };

type UsageRow = {
  id: string;
  feature: string;
  reportId: string | null;
  assignmentId: string | null;
  targetRef: { type: string; id: string; fieldKey: string } | null;
  outcome: string;
  status: AiSuggestionStatus | null;
  outputText: string | null;
  redactedCount: number;
  deletedAt: Date | null;
};

type Planned = {
  usageId: string;
  choice: ReviewChoice;
  row: TargetRow;
  fieldKey: string;
  /** Teksten som skal stå i feltet etterpå, eller `null` når teksten ikke endres («Behold»). */
  newText: string | null;
  decision: "accepted" | "edited" | "rejected";
};

function rowKey(table: string, id: string): string {
  return `${table}|${id}`;
}

/** Teksten i feltet nå. Tomt felt er tom tekst. */
function currentTextOf(row: TargetRow, fieldKey: string): string {
  if (row.table === "deviations") return row.texts[fieldKey as DeviationField] ?? "";
  return row.text ?? "";
}

function emptyToNull(text: string): string | null {
  return text === "" ? null : text;
}

// --- Oppslag av målet i rommet (levende rader) --------------------------------------------------

async function loadLiveDeviation(scope: WriteScope, id: string): Promise<TargetRow | null> {
  const [row] = await scope.tx
    .select({ deviation: deviations, checkpointId: checkpointResults.checkpointId })
    .from(deviations)
    .innerJoin(
      checkpointResults,
      and(
        eq(checkpointResults.id, deviations.checkpointResultId),
        eq(checkpointResults.organizationId, scope.orgId),
        eq(checkpointResults.reportId, scope.reportId),
        eq(checkpointResults.roomId, scope.context.room.id),
        isNull(checkpointResults.deletedAt),
      ),
    )
    .where(
      and(
        eq(deviations.organizationId, scope.orgId),
        eq(deviations.reportId, scope.reportId),
        eq(deviations.id, id),
        isNull(deviations.deletedAt),
      ),
    );
  if (!row) return null;
  const d = row.deviation;
  return {
    table: "deviations",
    id: d.id,
    checkpointId: row.checkpointId,
    rowVersion: d.rowVersion,
    textSource: d.textSource,
    texts: {
      deviation_text: d.deviationText,
      cause_text: d.causeText,
      consequence_text: d.consequenceText,
    },
  };
}

async function loadLiveMeasure(scope: WriteScope, id: string): Promise<TargetRow | null> {
  const [row] = await scope.tx
    .select({ measure: deviationMeasures })
    .from(deviationMeasures)
    .where(
      and(
        eq(deviationMeasures.organizationId, scope.orgId),
        eq(deviationMeasures.reportId, scope.reportId),
        eq(deviationMeasures.id, id),
        isNull(deviationMeasures.deletedAt),
      ),
    );
  if (!row) return null;
  // Tiltaket hører til et levende avvik i rommet
  const deviation = await loadLiveDeviation(scope, row.measure.deviationId);
  if (!deviation) return null;
  return {
    table: "deviation_measures",
    id: row.measure.id,
    deviationId: deviation.id,
    checkpointId: deviation.checkpointId,
    rowVersion: row.measure.rowVersion,
    textSource: row.measure.textSource,
    text: row.measure.text,
  };
}

async function loadLiveCheckpointResult(scope: WriteScope, id: string): Promise<TargetRow | null> {
  const [row] = await scope.tx
    .select({
      id: checkpointResults.id,
      checkpointId: checkpointResults.checkpointId,
      rowVersion: checkpointResults.rowVersion,
      descriptionText: checkpointResults.descriptionText,
    })
    .from(checkpointResults)
    .where(
      and(
        eq(checkpointResults.organizationId, scope.orgId),
        eq(checkpointResults.reportId, scope.reportId),
        eq(checkpointResults.roomId, scope.context.room.id),
        eq(checkpointResults.id, id),
        isNull(checkpointResults.deletedAt),
      ),
    );
  if (!row) return null;
  return {
    table: "checkpoint_results",
    id: row.id,
    checkpointId: row.checkpointId,
    rowVersion: row.rowVersion,
    text: row.descriptionText,
  };
}

/**
 * Raden og feltet loggraden peker på, i dette rommet og levende. Måltypen og feltet må være et av
 * feltene språkvasken skriver i (A470). Ellers 404 for hele listen.
 */
async function requireLiveTarget(
  scope: WriteScope,
  cache: Map<string, TargetRow>,
  target: UsageRow["targetRef"],
): Promise<{ row: TargetRow; fieldKey: string }> {
  if (!target || typeof target.id !== "string" || !isUuid(target.id)) {
    throw new AccessDeniedError();
  }
  const id = target.id.toLowerCase();
  let table: TargetRow["table"];
  let load: (scope: WriteScope, id: string) => Promise<TargetRow | null>;
  if (target.type === "deviation" && target.fieldKey in DEVIATION_COLUMNS) {
    table = "deviations";
    load = loadLiveDeviation;
  } else if (target.type === "deviation_measure" && target.fieldKey === "text") {
    table = "deviation_measures";
    load = loadLiveMeasure;
  } else if (target.type === "checkpoint_result" && target.fieldKey === "description_text") {
    table = "checkpoint_results";
    load = loadLiveCheckpointResult;
  } else {
    throw new AccessDeniedError();
  }
  const key = rowKey(table, id);
  let row = cache.get(key) ?? null;
  if (!row) {
    row = await load(scope, id);
    if (!row) throw new AccessDeniedError();
    cache.set(key, row);
  }
  return { row, fieldKey: target.fieldKey };
}

/** Feltnavnet til visning, med punktets navn fra malen når det finnes. */
function fieldLabelOf(scope: WriteScope, row: TargetRow, fieldKey: string): string {
  const field = FIELD_LABELS[fieldKey] ?? fieldKey;
  const checkpointKey = scope.template.checkpointKeyById.get(row.checkpointId);
  const checkpoint = scope.roomDoc.checkpoints.find((c) => c.key === checkpointKey);
  return checkpoint ? `${checkpoint.name}: ${field}` : field;
}

// --- Skriving -----------------------------------------------------------------------------------

/** Skriver alle tekstene på én rad med én oppdatering. Gir radens nye `row_version`. */
async function writeRow(
  scope: WriteScope,
  row: TargetRow,
  texts: Map<string, string>,
): Promise<number> {
  const by = scope.grant.employeeId;
  if (row.table === "deviations") {
    const values: Partial<typeof deviations.$inferInsert> = {};
    for (const [fieldKey, text] of texts) {
      values[DEVIATION_COLUMNS[fieldKey as DeviationField]] = emptyToNull(text);
    }
    const [updated] = await scope.tx
      .update(deviations)
      .set({
        ...values,
        textSource: row.textSource === "template" ? "edited" : row.textSource,
        updatedBy: by,
      })
      .where(
        and(
          eq(deviations.organizationId, scope.orgId),
          eq(deviations.reportId, scope.reportId),
          eq(deviations.id, row.id),
        ),
      )
      .returning({ rowVersion: deviations.rowVersion });
    return updated?.rowVersion ?? row.rowVersion + 1;
  }
  if (row.table === "deviation_measures") {
    const [updated] = await scope.tx
      .update(deviationMeasures)
      .set({
        text: texts.get("text") ?? row.text,
        textSource: row.textSource === "template" ? "edited" : row.textSource,
        updatedBy: by,
      })
      .where(
        and(
          eq(deviationMeasures.organizationId, scope.orgId),
          eq(deviationMeasures.reportId, scope.reportId),
          eq(deviationMeasures.id, row.id),
        ),
      )
      .returning({ rowVersion: deviationMeasures.rowVersion });
    return updated?.rowVersion ?? row.rowVersion + 1;
  }
  const [updated] = await scope.tx
    .update(checkpointResults)
    .set({ descriptionText: emptyToNull(texts.get("description_text") ?? ""), updatedBy: by })
    .where(
      and(
        eq(checkpointResults.organizationId, scope.orgId),
        eq(checkpointResults.reportId, scope.reportId),
        eq(checkpointResults.id, row.id),
      ),
    )
    .returning({ rowVersion: checkpointResults.rowVersion });
  return updated?.rowVersion ?? row.rowVersion + 1;
}

const AUDIT_ENTITY: Record<TargetRow["table"], string> = {
  deviations: "deviation",
  deviation_measures: "deviation_measure",
  checkpoint_results: "checkpoint_result",
};

// --- Tjenesten ----------------------------------------------------------------------------------

/** Se `ApplyReviewedTexts` i `./types`. */
export const applyReviewedTexts: ApplyReviewedTexts = (actor, organizationId, room, input) =>
  withRoomWrite(actor, organizationId, room, async (scope): Promise<ApplyReviewedTextsResult> => {
    const values = parseOrThrow(applyReviewedTextsInputSchema, input);
    const choices = values.choices.map((c) => ({ ...c, usageId: c.usageId.toLowerCase() }));

    // Samme forslag to ganger i listen: hele listen avvises
    const ids = choices.map((c) => c.usageId);
    if (new Set(ids).size !== ids.length) throw new ReportValidationError("invalid_input");

    // Loggradene, bare i organisasjonen til tilgangen
    const usageRows: UsageRow[] = await scope.tx
      .select({
        id: aiUsageLog.id,
        feature: aiUsageLog.feature,
        reportId: aiUsageLog.reportId,
        assignmentId: aiUsageLog.assignmentId,
        targetRef: aiUsageLog.targetRef,
        outcome: aiUsageLog.outcome,
        status: aiUsageLog.status,
        outputText: aiUsageLog.outputText,
        redactedCount: aiUsageLog.redactedCount,
        deletedAt: aiUsageLog.deletedAt,
      })
      .from(aiUsageLog)
      .where(and(eq(aiUsageLog.organizationId, scope.orgId), inArray(aiUsageLog.id, ids)));
    const usageById = new Map(usageRows.map((row) => [row.id, row]));

    // 1. Kontroller hele listen før noe skrives
    const rows = new Map<string, TargetRow>();
    const fieldsSeen = new Set<string>();
    const planned: Planned[] = [];
    const skippedChanged: ApplyReviewedTextsResult["skippedChanged"] = [];
    for (const choice of choices) {
      const usage = usageById.get(choice.usageId);
      if (
        !usage ||
        usage.deletedAt !== null ||
        usage.feature !== LANGUAGE_POLISH ||
        usage.reportId !== scope.reportId
      ) {
        throw new AccessDeniedError();
      }
      const { row, fieldKey } = await requireLiveTarget(scope, rows, usage.targetRef);
      // To valg på samme felt kan ikke lagres i samme liste
      const fieldId = `${rowKey(row.table, row.id)}|${fieldKey}`;
      if (fieldsSeen.has(fieldId)) throw new ReportValidationError("invalid_input");
      fieldsSeen.add(fieldId);

      // Stoppet, ingen treff, sperret, feil eller alt avgjort: ikke et forslag som kan velges
      if (usage.outcome !== "ok" || usage.outputText === null) {
        throw new ReportValidationError("invalid_choice");
      }
      const allowed: readonly (AiSuggestionStatus | null)[] =
        choice.choice === "undo" ? ["accepted", "edited"] : ["suggested"];
      if (!allowed.includes(usage.status)) throw new ReportValidationError("invalid_choice");

      if (choice.choice === "keep") {
        planned.push({ ...choice, row, fieldKey, newText: null, decision: "rejected" });
        continue;
      }
      // Raden er endret av andre etter gjennomgangen: feltet lagres ikke (A605)
      if (row.rowVersion > choice.rowVersion) {
        skippedChanged.push({
          usageId: choice.usageId,
          fieldLabel: fieldLabelOf(scope, row, fieldKey),
        });
        continue;
      }
      if (choice.choice === "undo") {
        planned.push({ ...choice, row, fieldKey, newText: choice.text, decision: "rejected" });
        continue;
      }
      // Forslaget med plassholderne byttet tilbake, fra den uendrede teksten i feltet (A466)
      const restored = await restorePolishSuggestion(scope.tx, scope.grant, {
        assignmentId: usage.assignmentId,
        outputText: usage.outputText,
        redactedCount: usage.redactedCount,
        fieldText: currentTextOf(row, fieldKey),
      });
      if (choice.choice === "use") {
        if (restored === null) throw new ReportValidationError("invalid_choice", CHANGED_MESSAGE);
        // Samme kontroll som `saveField` også for forslaget
        const text = parseOrThrow(reviewTextSchema, restored);
        planned.push({ ...choice, row, fieldKey, newText: text, decision: "accepted" });
        continue;
      }
      if (choice.choice !== "edit") throw new ReportValidationError("invalid_choice");
      // «Rett før bruk»: en fremmed tekst kan aldri føres som godtatt (A525, A607)
      const same = restored !== null && restored.trim() === choice.text.trim();
      planned.push({
        ...choice,
        row,
        fieldKey,
        newText: choice.text,
        decision: same ? "accepted" : "edited",
      });
    }

    // 2. Tekstene, én oppdatering per rad
    const textsByRow = new Map<string, { row: TargetRow; texts: Map<string, string> }>();
    for (const plan of planned) {
      if (plan.newText === null) continue;
      if (plan.newText === currentTextOf(plan.row, plan.fieldKey)) continue;
      const key = rowKey(plan.row.table, plan.row.id);
      const entry = textsByRow.get(key) ?? { row: plan.row, texts: new Map<string, string>() };
      entry.texts.set(plan.fieldKey, plan.newText);
      textsByRow.set(key, entry);
    }
    const versionByRow = new Map<string, number>();
    for (const [key, entry] of textsByRow) {
      versionByRow.set(key, await writeRow(scope, entry.row, entry.texts));
    }

    // 3. Beslutningene i samme transaksjon, og én linje i revisjonsloggen per valg
    const saved: ApplyReviewedTextsResult["saved"] = [];
    for (const plan of planned) {
      if (plan.choice === "undo") {
        // «Angre»: teksten er satt tilbake, og forslaget skal ikke stå åpent (som `decideAiText`)
        await recordDecisionIn(scope.tx, scope.grant, plan.usageId, "undo");
        await recordDecisionIn(scope.tx, scope.grant, plan.usageId, "rejected");
      } else {
        await recordDecisionIn(scope.tx, scope.grant, plan.usageId, plan.decision);
      }
      const key = rowKey(plan.row.table, plan.row.id);
      await auditReport(scope, AUDIT_ENTITY[plan.row.table], plan.row.id, "ai_review", {
        field: plan.fieldKey,
        usageId: plan.usageId,
        choice: plan.choice,
        decision: plan.decision,
        textChanged: textsByRow.get(key)?.texts.has(plan.fieldKey) ?? false,
      });
      saved.push({
        usageId: plan.usageId,
        decision: plan.decision,
        text: plan.newText ?? currentTextOf(plan.row, plan.fieldKey),
        rowVersion: versionByRow.get(key) ?? plan.row.rowVersion,
      });
    }
    return { saved, skippedChanged };
  });
