import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { AccessDeniedError, type EmployeeGrant } from "@/core/access";
import { AI_CANDIDATES_MAX } from "@/core/ai";
import { ROOM_TYPES } from "@/core/buildings";
import { db, type DbExecutor } from "@/db/client";
import {
  aiUsageLog,
  checkpointResults,
  checkpoints,
  deviationMeasures,
  deviationQuestions,
  deviations,
  floors,
  outcomes,
  reportBuildings,
  reports,
  rooms,
  standardMeasures,
  type AiCandidateRef,
  type DeviationKind,
  type DeviationTg,
  type MeasureAppliesToTg,
  type OutcomeKind,
  type TextStatus,
} from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { SUPPORTED_ROOM_GROUP } from "./context";
import { ReportValidationError } from "./errors";
import {
  cutPhraseCandidates,
  listPhraseCandidates,
  mergePhraseUsage,
  normalizeSearchText,
  PHRASE_FIELDS,
  type PhraseCandidateDocument,
  type PhraseField,
  type PhraseUsageCount,
} from "./logic";
import type { LoadPhraseCandidates, LoadPhraseUsage, RankedPhraseCandidate } from "./types";

/*
 * Kandidatkilden for forslag fra frasebanken (docs/funksjoner/fase2a-ki-i-veien.md, A482, A433,
 * A463, A467 og A468). Den ene stedet som vet hvor kandidatene kommer fra: i dag tekstene i
 * rapportens låste malversjon (`template_outcome`, `template_measure`). Frasebanken (`phrase`)
 * kobles til her i 2a-3 uten at KI-delen endres.
 *
 * Alle spørringer filtrerer på `grant.organizationId` og `deleted_at is null`, og leser bare
 * rapportens `template_version_id`. Antall spørringer er fast, uansett antall utfall, tiltak og
 * valg i loggen (K4.21b). «Mest brukt» telles for hele organisasjonen og aldri per ansatt: ingen
 * spørring her leser `employee_id` eller `decided_by`.
 */

/** Rekkene fra malversjonen, med id-ene til kandidatene. */
export type VersionPhraseRows = {
  document: PhraseCandidateDocument;
  checkpointKeyById: Map<string, string>;
  outcomeById: Map<string, { checkpointKey: string; questionKey: string; outcomeKey: string }>;
  /** `punkt|spørsmål|utfall` → id. */
  outcomeIdByRef: Map<string, string>;
  /** `punkt|spørsmål|utfall|plass|tekst` → id for standardtiltak. */
  measureIdByRef: Map<string, string>;
};

function outcomeRef(checkpointKey: string, questionKey: string, outcomeKey: string): string {
  return `${checkpointKey}|${questionKey}|${outcomeKey}`;
}

function measureRef(
  checkpointKey: string,
  questionKey: string,
  outcomeKey: string,
  sortOrder: number,
  text: string,
): string {
  return `${outcomeRef(checkpointKey, questionKey, outcomeKey)}|${sortOrder}|${text}`;
}

function roomGroupOf(roomType: string): string | null {
  return ROOM_TYPES.find((type) => type.key === roomType)?.group ?? null;
}

/**
 * Kandidatradene i malversjonen for rommets romgruppe: kontrollpunktene per rom for gruppen, med
 * spørsmål, utfall og standardtiltak som ikke er slettet. Fire spørringer.
 */
export async function loadVersionPhraseRows(
  ex: DbExecutor,
  orgId: string,
  versionId: string,
  roomGroup: string,
): Promise<VersionPhraseRows> {
  const liveCheckpoint = (checkpointId: typeof deviationQuestions.checkpointId) =>
    and(
      eq(checkpoints.id, checkpointId),
      eq(checkpoints.organizationId, orgId),
      eq(checkpoints.versionId, versionId),
      isNull(checkpoints.deletedAt),
    );
  const liveQuestion = and(
    eq(deviationQuestions.id, outcomes.deviationQuestionId),
    eq(deviationQuestions.organizationId, orgId),
    isNull(deviationQuestions.deletedAt),
  );
  const [checkpointRows, questionRows, outcomeRows, measureRows] = await Promise.all([
    ex
      .select({
        id: checkpoints.id,
        key: checkpoints.key,
        name: checkpoints.name,
        sortOrder: checkpoints.sortOrder,
        scope: checkpoints.scope,
        roomTypeGroups: checkpoints.roomTypeGroups,
      })
      .from(checkpoints)
      .where(
        and(
          eq(checkpoints.organizationId, orgId),
          eq(checkpoints.versionId, versionId),
          isNull(checkpoints.deletedAt),
        ),
      ),
    ex
      .select({
        key: deviationQuestions.key,
        text: deviationQuestions.text,
        sortOrder: deviationQuestions.sortOrder,
        checkpointKey: checkpoints.key,
      })
      .from(deviationQuestions)
      .innerJoin(checkpoints, liveCheckpoint(deviationQuestions.checkpointId))
      .where(
        and(eq(deviationQuestions.organizationId, orgId), isNull(deviationQuestions.deletedAt)),
      ),
    ex
      .select({
        id: outcomes.id,
        key: outcomes.key,
        kind: outcomes.kind,
        deviationText: outcomes.deviationText,
        causeText: outcomes.defaultCauseText,
        consequenceText: outcomes.defaultConsequenceText,
        textStatus: outcomes.textStatus,
        sortOrder: outcomes.sortOrder,
        questionKey: deviationQuestions.key,
        checkpointKey: checkpoints.key,
      })
      .from(outcomes)
      .innerJoin(deviationQuestions, liveQuestion)
      .innerJoin(checkpoints, liveCheckpoint(deviationQuestions.checkpointId))
      .where(and(eq(outcomes.organizationId, orgId), isNull(outcomes.deletedAt))),
    ex
      .select({
        id: standardMeasures.id,
        text: standardMeasures.text,
        appliesToTg: standardMeasures.appliesToTg,
        textStatus: standardMeasures.textStatus,
        sortOrder: standardMeasures.sortOrder,
        outcomeKey: outcomes.key,
        questionKey: deviationQuestions.key,
        checkpointKey: checkpoints.key,
      })
      .from(standardMeasures)
      .innerJoin(
        outcomes,
        and(
          eq(outcomes.id, standardMeasures.outcomeId),
          eq(outcomes.organizationId, orgId),
          isNull(outcomes.deletedAt),
        ),
      )
      .innerJoin(deviationQuestions, liveQuestion)
      .innerJoin(checkpoints, liveCheckpoint(deviationQuestions.checkpointId))
      .where(and(eq(standardMeasures.organizationId, orgId), isNull(standardMeasures.deletedAt)))
      .orderBy(asc(standardMeasures.sortOrder), asc(standardMeasures.id)),
  ]);

  const roomCheckpoints = checkpointRows.filter(
    (c) =>
      c.scope === "room" &&
      (c.roomTypeGroups === null ||
        c.roomTypeGroups.length === 0 ||
        c.roomTypeGroups.includes(roomGroup)),
  );
  const keys = new Set(roomCheckpoints.map((c) => c.key));
  const roomOutcomes = outcomeRows.filter((o) => keys.has(o.checkpointKey));
  const roomMeasures = measureRows.filter((m) => keys.has(m.checkpointKey));

  return {
    document: {
      checkpoints: roomCheckpoints.map((c) => ({
        key: c.key,
        name: c.name,
        sort_order: c.sortOrder,
      })),
      deviation_questions: questionRows
        .filter((q) => keys.has(q.checkpointKey))
        .map((q) => ({
          checkpoint_key: q.checkpointKey,
          key: q.key,
          text: q.text,
          sort_order: q.sortOrder,
        })),
      outcomes: roomOutcomes.map((o) => ({
        checkpoint_key: o.checkpointKey,
        question_key: o.questionKey,
        key: o.key,
        kind: o.kind as OutcomeKind,
        deviation_text: o.deviationText,
        default_cause_text: o.causeText,
        default_consequence_text: o.consequenceText,
        text_status: o.textStatus as TextStatus,
        sort_order: o.sortOrder,
      })),
      standard_measures: roomMeasures.map((m) => ({
        checkpoint_key: m.checkpointKey,
        question_key: m.questionKey,
        outcome_key: m.outcomeKey,
        text: m.text,
        applies_to_tg: (m.appliesToTg ?? null) as MeasureAppliesToTg | null,
        text_status: m.textStatus as TextStatus,
        sort_order: m.sortOrder,
      })),
    },
    checkpointKeyById: new Map(checkpointRows.map((c) => [c.id, c.key])),
    outcomeById: new Map(
      outcomeRows.map((o) => [
        o.id,
        { checkpointKey: o.checkpointKey, questionKey: o.questionKey, outcomeKey: o.key },
      ]),
    ),
    outcomeIdByRef: new Map(
      roomOutcomes.map((o) => [outcomeRef(o.checkpointKey, o.questionKey, o.key), o.id]),
    ),
    measureIdByRef: new Map(
      roomMeasures.map((m) => [
        measureRef(m.checkpointKey, m.questionKey, m.outcomeKey, m.sortOrder, m.text),
        m.id,
      ]),
    ),
  };
}

// --- «Mest brukt» (A468) -------------------------------------------------------------------

const DEVIATION_TEXT_PHRASE_FIELDS: readonly PhraseField[] = [
  "deviation_text",
  "cause_text",
  "consequence_text",
];

function isPhraseField(value: unknown): value is PhraseField {
  return typeof value === "string" && (PHRASE_FIELDS as readonly string[]).includes(value);
}

/**
 * Antall valg per kandidat i organisasjonen for kandidatene i `document` (A468). To spørringer:
 * én for utfallstekstene og én for standardtiltakene, begge på delindeksen
 * `ai_usage_log_chosen_candidate_idx` (organisasjon, funksjon). Valget følger de faste kodene, så
 * valg gjort i en eldre malversjon teller for kandidaten med samme koder i dokumentet;
 * standardtiltak følger utfallets koder og lik tekst. Aldri per ansatt.
 */
export async function phraseUsageForDocument(
  ex: DbExecutor,
  orgId: string,
  document: PhraseCandidateDocument,
): Promise<PhraseUsageCount[]> {
  const chosen = and(
    eq(aiUsageLog.organizationId, orgId),
    eq(aiUsageLog.feature, "phrase_suggest"),
    isNotNull(aiUsageLog.chosenCandidate),
    isNull(aiUsageLog.deletedAt),
  );
  const fieldKey = sql<string>`${aiUsageLog.targetRef} ->> 'fieldKey'`;
  const count = sql<number>`cast(count(*) as integer)`;
  const questionJoin = and(
    eq(deviationQuestions.id, outcomes.deviationQuestionId),
    eq(deviationQuestions.organizationId, orgId),
  );
  const checkpointJoin = and(
    eq(checkpoints.id, deviationQuestions.checkpointId),
    eq(checkpoints.organizationId, orgId),
  );
  const [outcomeCounts, measureCounts] = await Promise.all([
    ex
      .select({
        field: fieldKey,
        checkpointKey: checkpoints.key,
        questionKey: deviationQuestions.key,
        outcomeKey: outcomes.key,
        count,
      })
      .from(aiUsageLog)
      .innerJoin(
        outcomes,
        and(
          eq(outcomes.organizationId, orgId),
          sql`${outcomes.id}::text = ${aiUsageLog.chosenCandidate} ->> 'id'`,
        ),
      )
      .innerJoin(deviationQuestions, questionJoin)
      .innerJoin(checkpoints, checkpointJoin)
      .where(and(chosen, sql`${aiUsageLog.chosenCandidate} ->> 'source' = 'template_outcome'`))
      .groupBy(fieldKey, checkpoints.key, deviationQuestions.key, outcomes.key),
    ex
      .select({
        field: fieldKey,
        checkpointKey: checkpoints.key,
        questionKey: deviationQuestions.key,
        outcomeKey: outcomes.key,
        text: standardMeasures.text,
        count,
      })
      .from(aiUsageLog)
      .innerJoin(
        standardMeasures,
        and(
          eq(standardMeasures.organizationId, orgId),
          sql`${standardMeasures.id}::text = ${aiUsageLog.chosenCandidate} ->> 'id'`,
        ),
      )
      .innerJoin(
        outcomes,
        and(eq(outcomes.id, standardMeasures.outcomeId), eq(outcomes.organizationId, orgId)),
      )
      .innerJoin(deviationQuestions, questionJoin)
      .innerJoin(checkpoints, checkpointJoin)
      .where(and(chosen, sql`${aiUsageLog.chosenCandidate} ->> 'source' = 'template_measure'`))
      .groupBy(
        fieldKey,
        checkpoints.key,
        deviationQuestions.key,
        outcomes.key,
        standardMeasures.text,
      ),
  ]);

  const outcomeKeys = new Set(
    document.outcomes.map((o) => outcomeRef(o.checkpoint_key, o.question_key, o.key)),
  );
  const usage: PhraseUsageCount[] = [];
  for (const row of outcomeCounts) {
    if (!isPhraseField(row.field) || !DEVIATION_TEXT_PHRASE_FIELDS.includes(row.field)) continue;
    if (!outcomeKeys.has(outcomeRef(row.checkpointKey, row.questionKey, row.outcomeKey))) continue;
    usage.push({
      field: row.field,
      checkpointKey: row.checkpointKey,
      questionKey: row.questionKey,
      outcomeKey: row.outcomeKey,
      measureSortOrder: null,
      count: Number(row.count),
    });
  }
  for (const row of measureCounts) {
    if (row.field !== "new_measure") continue;
    const text = normalizeSearchText(row.text);
    const measure = document.standard_measures.find(
      (m) =>
        m.checkpoint_key === row.checkpointKey &&
        m.question_key === row.questionKey &&
        m.outcome_key === row.outcomeKey &&
        normalizeSearchText(m.text) === text,
    );
    if (!measure) continue;
    usage.push({
      field: "new_measure",
      checkpointKey: row.checkpointKey,
      questionKey: row.questionKey,
      outcomeKey: row.outcomeKey,
      measureSortOrder: measure.sort_order,
      count: Number(row.count),
    });
  }
  return mergePhraseUsage(usage);
}

// --- Rapporten og rommet -----------------------------------------------------------------------

/**
 * Rapporten og rommet, med `grant.organizationId` og `deleted_at is null` i alle ledd. Rommet må
 * høre til rapportens oppdrag og være et våtrom. Ellers `AccessDeniedError` (404).
 */
async function requireReportRoom(
  ex: DbExecutor,
  orgId: string,
  reportId: string,
  roomId: string,
): Promise<{ templateVersionId: string; roomGroup: string }> {
  const [row] = await ex
    .select({ templateVersionId: reports.templateVersionId, roomType: rooms.roomType })
    .from(reports)
    .innerJoin(
      reportBuildings,
      and(
        eq(reportBuildings.assignmentId, reports.assignmentId),
        eq(reportBuildings.organizationId, orgId),
        isNull(reportBuildings.deletedAt),
      ),
    )
    .innerJoin(
      floors,
      and(
        eq(floors.reportBuildingId, reportBuildings.id),
        eq(floors.organizationId, orgId),
        isNull(floors.deletedAt),
      ),
    )
    .innerJoin(
      rooms,
      and(eq(rooms.floorId, floors.id), eq(rooms.organizationId, orgId), isNull(rooms.deletedAt)),
    )
    .where(
      and(
        eq(reports.organizationId, orgId),
        eq(reports.id, reportId),
        isNull(reports.deletedAt),
        eq(rooms.id, roomId),
      ),
    );
  if (!row) throw new AccessDeniedError();
  const roomGroup = roomGroupOf(row.roomType);
  if (roomGroup !== SUPPORTED_ROOM_GROUP) throw new AccessDeniedError();
  return { templateVersionId: row.templateVersionId, roomGroup };
}

function requireIds(...ids: unknown[]): void {
  if (!ids.every((id) => typeof id === "string" && isUuid(id))) throw new AccessDeniedError();
}

/** Se `LoadPhraseUsage` i `./types`. */
export const loadPhraseUsage: LoadPhraseUsage = async (grant, input) => {
  requireIds(input?.reportId, input?.roomId);
  const orgId = grant.organizationId;
  const { templateVersionId, roomGroup } = await requireReportRoom(
    db,
    orgId,
    input.reportId,
    input.roomId,
  );
  const rows = await loadVersionPhraseRows(db, orgId, templateVersionId, roomGroup);
  return phraseUsageForDocument(db, orgId, rows.document);
};

// --- Kandidatene ---------------------------------------------------------------------------

/** Avviket i rommet (ikke slettet), med punktet. Ellers `AccessDeniedError` (404). */
async function requireRoomDeviation(
  ex: DbExecutor,
  orgId: string,
  reportId: string,
  roomId: string,
  deviationId: string,
) {
  const [row] = await ex
    .select({
      id: deviations.id,
      kind: deviations.kind,
      tg: deviations.tg,
      outcomeId: deviations.outcomeId,
      deviationText: deviations.deviationText,
      causeText: deviations.causeText,
      consequenceText: deviations.consequenceText,
      checkpointId: checkpointResults.checkpointId,
    })
    .from(deviations)
    .innerJoin(
      checkpointResults,
      and(
        eq(checkpointResults.id, deviations.checkpointResultId),
        eq(checkpointResults.organizationId, orgId),
        eq(checkpointResults.reportId, reportId),
        eq(checkpointResults.roomId, roomId),
        isNull(checkpointResults.deletedAt),
      ),
    )
    .where(
      and(
        eq(deviations.organizationId, orgId),
        eq(deviations.reportId, reportId),
        eq(deviations.id, deviationId),
        isNull(deviations.deletedAt),
      ),
    );
  if (!row) throw new AccessDeniedError();
  return row;
}

/** Teksten som står i feltet (for `new_measure`: tekstene i tiltakene som finnes). */
async function currentTextsOf(
  ex: DbExecutor,
  orgId: string,
  reportId: string,
  deviation: Awaited<ReturnType<typeof requireRoomDeviation>>,
  field: PhraseField,
): Promise<string[]> {
  switch (field) {
    case "deviation_text":
      return deviation.deviationText ? [deviation.deviationText] : [];
    case "cause_text":
      return deviation.causeText ? [deviation.causeText] : [];
    case "consequence_text":
      return deviation.consequenceText ? [deviation.consequenceText] : [];
    case "new_measure": {
      const measures = await ex
        .select({ text: deviationMeasures.text })
        .from(deviationMeasures)
        .where(
          and(
            eq(deviationMeasures.organizationId, orgId),
            eq(deviationMeasures.reportId, reportId),
            eq(deviationMeasures.deviationId, deviation.id),
            isNull(deviationMeasures.deletedAt),
          ),
        );
      return measures.map((m) => m.text);
    }
  }
}

/**
 * Kandidatene for ett felt på ett avvik, med `ex` (en transaksjon eller `db`). Se
 * `LoadPhraseCandidates` i `./types`.
 */
export async function loadPhraseCandidatesWith(
  ex: DbExecutor,
  grant: EmployeeGrant,
  input: { reportId: string; roomId: string; deviationId: string; field: PhraseField },
): Promise<{ candidates: RankedPhraseCandidate[]; cut: number }> {
  requireIds(input?.reportId, input?.roomId, input?.deviationId);
  if (!isPhraseField(input.field)) throw new ReportValidationError("invalid_input");
  const orgId = grant.organizationId;
  const { templateVersionId, roomGroup } = await requireReportRoom(
    ex,
    orgId,
    input.reportId,
    input.roomId,
  );
  const deviation = await requireRoomDeviation(
    ex,
    orgId,
    input.reportId,
    input.roomId,
    input.deviationId,
  );
  const [rows, currentTexts] = await Promise.all([
    loadVersionPhraseRows(ex, orgId, templateVersionId, roomGroup),
    currentTextsOf(ex, orgId, input.reportId, deviation, input.field),
  ]);
  const usage = await phraseUsageForDocument(ex, orgId, rows.document);
  const outcome = deviation.outcomeId ? rows.outcomeById.get(deviation.outcomeId) : undefined;
  const checkpointKey =
    outcome?.checkpointKey ?? rows.checkpointKeyById.get(deviation.checkpointId) ?? "";

  const listed = listPhraseCandidates(rows.document, {
    field: input.field,
    checkpointKey,
    questionKey: outcome?.questionKey ?? null,
    outcomeKey: outcome?.outcomeKey ?? null,
    kind: deviation.kind as DeviationKind,
    tg: deviation.tg as DeviationTg | null,
    usage,
    currentTexts,
  });

  const ranked: RankedPhraseCandidate[] = [];
  for (const candidate of listed) {
    let ref: AiCandidateRef | null = null;
    if (candidate.measureSortOrder === null) {
      const id = rows.outcomeIdByRef.get(
        outcomeRef(candidate.checkpointKey, candidate.questionKey, candidate.outcomeKey),
      );
      if (id) ref = { source: "template_outcome", id };
    } else {
      const id = rows.measureIdByRef.get(
        measureRef(
          candidate.checkpointKey,
          candidate.questionKey,
          candidate.outcomeKey,
          candidate.measureSortOrder,
          candidate.text,
        ),
      );
      if (id) ref = { source: "template_measure", id };
    }
    if (ref) ranked.push({ ...candidate, ref });
  }
  return cutPhraseCandidates(ranked, AI_CANDIDATES_MAX);
}

/** Se `LoadPhraseCandidates` i `./types`. */
export const loadPhraseCandidates: LoadPhraseCandidates = (grant, input) =>
  loadPhraseCandidatesWith(db, grant, input);
