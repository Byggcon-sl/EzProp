import { and, eq, isNotNull, isNull, ne, or } from "drizzle-orm";
import {
  AccessDeniedError,
  grantHasPermission,
  requireOrganizationAccess,
  type EmployeeGrant,
} from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import {
  AI_SUMMARY_FINDINGS_MAX,
  AiInputTooLargeError,
  recordDecisionIn,
  requestSuggestion,
  type AiSummaryGroup,
  type AiSuggestionResult,
} from "@/core/ai";
import { db, type DbExecutor } from "@/db/client";
import {
  aiUsageLog,
  assignments,
  checkpointResults,
  checkpoints,
  deviationMeasures,
  deviations,
  reports,
  rooms,
  tgiuDetails,
  type ReportStatus,
  type SummaryBasisEntry,
} from "@/db/schema";
import { requireUuid } from "./context";
import { guardReportErrors, ReportValidationError } from "./errors";
import {
  assembleCodeOnlySummary,
  collectSummaryFindings,
  compareSummaryBasis,
  containsPiiPlaceholder,
  groupSummaryFindings,
  summaryBasisOf,
  summaryNeedsAi,
  uncoveredSummaryFindings,
  type SummaryCheckpointInput,
  type SummaryFinding,
} from "./logic";
import {
  draftSummaryInputSchema,
  parseOrThrow,
  saveSummaryInputSchema,
  summaryBasisSchema,
} from "./schemas";
import type {
  DraftSummary,
  DraftSummaryResult,
  GetReportSummary,
  ReportSummaryView,
  SaveSummary,
  SaveSummaryResult,
  SummaryFindingView,
} from "./types";
import { withReportWrite } from "./write";

/*
 * Sammendraget for hele rapporten (docs/funksjoner/fase2a-ki-i-veien.md, A483, A484, A434, A435,
 * A461, A462, A465, A469 og A470). Koden velger funnene, gruppene, overskriftene og rekkefølgen;
 * KI skriver bare teksten per funn under TG3, TG2 og HMS, gjennom `requestSuggestion`. Utkastet
 * lagres aldri før takstmannen trykker «Bruk». Advarslene sperrer aldri. Ingenting her setter TG.
 */

type ReportRow = {
  id: string;
  status: ReportStatus;
  rowVersion: number;
  templateVersionId: string;
  summaryText: string | null;
  summaryBasis: SummaryBasisEntry[] | null;
};

/**
 * Oppdragets gjeldende rapport med `grant.organizationId` og `deleted_at is null`. Ukjent eller
 * fremmed oppdrag gir 404; oppdrag uten startet rapport gir `null`.
 */
async function findReport(
  ex: DbExecutor,
  orgId: string,
  assignmentId: string,
): Promise<ReportRow | null> {
  const [assignment] = await ex
    .select({ id: assignments.id })
    .from(assignments)
    .where(
      and(
        eq(assignments.organizationId, orgId),
        eq(assignments.id, assignmentId),
        isNull(assignments.deletedAt),
      ),
    );
  if (!assignment) throw new AccessDeniedError();
  const [report] = await ex
    .select({
      id: reports.id,
      status: reports.status,
      rowVersion: reports.rowVersion,
      templateVersionId: reports.templateVersionId,
      summaryText: reports.summaryText,
      summaryBasis: reports.summaryBasis,
    })
    .from(reports)
    .where(
      and(
        eq(reports.organizationId, orgId),
        eq(reports.assignmentId, assignment.id),
        isNull(reports.deletedAt),
        ne(reports.status, "superseded"),
      ),
    );
  return report ?? null;
}

/**
 * De godkjente funnene i rapporten (A484, A434), i fem spørringer uansett antall punkter, avvik og
 * tiltak (K4.21b): punktene, avvikene, tiltakene, TGIU-opplysningene og kontrollpunktene i den
 * låste malversjonen. Bare rader som ikke er slettet; punkter i et slettet rom er ikke med.
 */
export async function loadSummaryFindings(
  ex: DbExecutor,
  orgId: string,
  reportId: string,
  templateVersionId: string,
): Promise<{ findings: SummaryFinding[]; missingTgCount: number }> {
  const [resultRows, deviationRows, measureRows, tgiuRows, checkpointRows] = await Promise.all([
    ex
      .select({
        id: checkpointResults.id,
        rowVersion: checkpointResults.rowVersion,
        checkpointId: checkpointResults.checkpointId,
        roomId: checkpointResults.roomId,
        tgDirect: checkpointResults.tgDirect,
      })
      .from(checkpointResults)
      .leftJoin(
        rooms,
        and(
          eq(rooms.id, checkpointResults.roomId),
          eq(rooms.organizationId, orgId),
          isNull(rooms.deletedAt),
        ),
      )
      .where(
        and(
          eq(checkpointResults.organizationId, orgId),
          eq(checkpointResults.reportId, reportId),
          isNull(checkpointResults.deletedAt),
          or(isNull(checkpointResults.roomId), isNotNull(rooms.id)),
        ),
      ),
    ex
      .select({
        id: deviations.id,
        rowVersion: deviations.rowVersion,
        checkpointResultId: deviations.checkpointResultId,
        kind: deviations.kind,
        tg: deviations.tg,
        sortOrder: deviations.sortOrder,
        deviationText: deviations.deviationText,
        causeText: deviations.causeText,
        consequenceText: deviations.consequenceText,
      })
      .from(deviations)
      .where(
        and(
          eq(deviations.organizationId, orgId),
          eq(deviations.reportId, reportId),
          isNull(deviations.deletedAt),
        ),
      ),
    ex
      .select({
        id: deviationMeasures.id,
        rowVersion: deviationMeasures.rowVersion,
        deviationId: deviationMeasures.deviationId,
        text: deviationMeasures.text,
        sortOrder: deviationMeasures.sortOrder,
      })
      .from(deviationMeasures)
      .where(
        and(
          eq(deviationMeasures.organizationId, orgId),
          eq(deviationMeasures.reportId, reportId),
          isNull(deviationMeasures.deletedAt),
        ),
      ),
    ex
      .select({
        id: tgiuDetails.id,
        rowVersion: tgiuDetails.rowVersion,
        checkpointResultId: tgiuDetails.checkpointResultId,
        reason: tgiuDetails.reason,
      })
      .from(tgiuDetails)
      .where(
        and(
          eq(tgiuDetails.organizationId, orgId),
          eq(tgiuDetails.reportId, reportId),
          isNull(tgiuDetails.deletedAt),
        ),
      ),
    ex
      .select({
        id: checkpoints.id,
        key: checkpoints.key,
        name: checkpoints.name,
        sortOrder: checkpoints.sortOrder,
      })
      .from(checkpoints)
      .where(
        and(
          eq(checkpoints.organizationId, orgId),
          eq(checkpoints.versionId, templateVersionId),
          isNull(checkpoints.deletedAt),
        ),
      ),
  ]);

  const checkpointById = new Map(checkpointRows.map((c) => [c.id, c]));
  const measuresByDeviation = new Map<string, typeof measureRows>();
  for (const measure of measureRows) {
    const list = measuresByDeviation.get(measure.deviationId) ?? [];
    list.push(measure);
    measuresByDeviation.set(measure.deviationId, list);
  }
  const deviationsByResult = new Map<string, typeof deviationRows>();
  for (const deviation of deviationRows) {
    const list = deviationsByResult.get(deviation.checkpointResultId) ?? [];
    list.push(deviation);
    deviationsByResult.set(deviation.checkpointResultId, list);
  }
  const tgiuByResult = new Map(tgiuRows.map((t) => [t.checkpointResultId, t]));

  const inputs: SummaryCheckpointInput[] = [];
  for (const result of resultRows) {
    const checkpoint = checkpointById.get(result.checkpointId);
    if (!checkpoint) continue;
    const tgiu = tgiuByResult.get(result.id) ?? null;
    inputs.push({
      resultId: result.id,
      resultRowVersion: result.rowVersion,
      checkpointKey: checkpoint.key,
      checkpointName: checkpoint.name,
      order: [checkpoint.sortOrder],
      roomId: result.roomId,
      tgDirect: result.tgDirect,
      tgiu: tgiu ? { id: tgiu.id, rowVersion: tgiu.rowVersion, reason: tgiu.reason } : null,
      deviations: (deviationsByResult.get(result.id) ?? []).map((d) => ({
        id: d.id,
        rowVersion: d.rowVersion,
        kind: d.kind,
        tg: d.tg,
        sortOrder: d.sortOrder,
        deviationText: d.deviationText,
        causeText: d.causeText,
        consequenceText: d.consequenceText,
        measures: (measuresByDeviation.get(d.id) ?? []).map((m) => ({
          id: m.id,
          rowVersion: m.rowVersion,
          text: m.text,
          sortOrder: m.sortOrder,
        })),
      })),
    });
  }
  return collectSummaryFindings(inputs);
}

function findingView(finding: SummaryFinding): SummaryFindingView {
  return {
    source: finding.source,
    id: finding.id,
    group: finding.group,
    checkpointKey: finding.checkpointKey,
    checkpointName: finding.checkpointName,
    roomId: finding.roomId,
  };
}

/** Grunnlaget slik det står i databasen. En rad som ikke har riktig form, regnes som tom. */
function storedBasis(value: unknown): SummaryBasisEntry[] | null {
  if (value === null || value === undefined) return null;
  const parsed = summaryBasisSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function summaryView(
  ex: DbExecutor,
  grant: EmployeeGrant,
  report: ReportRow,
): Promise<ReportSummaryView> {
  const { findings, missingTgCount } = await loadSummaryFindings(
    ex,
    grant.organizationId,
    report.id,
    report.templateVersionId,
  );
  const changes = compareSummaryBasis(storedBasis(report.summaryBasis), findings);
  return {
    reportId: report.id,
    reportStatus: report.status,
    canEdit: grantHasPermission(grant, "report.edit") && report.status === "draft",
    text: report.summaryText,
    rowVersion: report.rowVersion,
    findingCount: findings.length,
    missingTgCount,
    changedSinceDraft: changes
      ? {
          added: changes.added.map(findingView),
          changed: changes.changed.map(findingView),
          removedCount: changes.removedCount,
        }
      : null,
    uncovered: uncoveredSummaryFindings(report.summaryText, findings).map(findingView),
  };
}

// --- Lesing --------------------------------------------------------------------------------

/** Se `GetReportSummary` i `./types`. */
export const getReportSummary: GetReportSummary = async (actor, organizationId, assignmentId) => {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  requireUuid(assignmentId);
  return guardReportErrors("summary_read", async () => {
    const report = await findReport(db, grant.organizationId, assignmentId);
    return report ? summaryView(db, grant, report) : null;
  });
};

// --- Utkast --------------------------------------------------------------------------------

/** Gruppene til KI: funnene under TG3, TG2 og HMS, og TGIU-linjene som koden skriver (A462). */
function aiSummaryGroups(findings: readonly SummaryFinding[]): AiSummaryGroup[] {
  return groupSummaryFindings(findings).map((group) =>
    group.group === "tgiu"
      ? {
          group: group.group,
          heading: group.heading,
          findings: [],
          fixedLines: group.findings.map((f) => ({
            checkpointName: f.checkpointName,
            text: f.tgiuReason?.trim() ?? "",
          })),
        }
      : {
          group: group.group,
          heading: group.heading,
          findings: group.findings.map((f) => ({
            checkpointName: f.checkpointName,
            deviationText: f.deviationText,
            causeText: f.causeText,
            consequenceText: f.consequenceText,
            measures: f.measures,
          })),
          fixedLines: [],
        },
  );
}

/** Se `DraftSummary` i `./types`. */
export const draftSummary: DraftSummary = async (actor, organizationId, assignmentId, input) => {
  const grant = await requireOrganizationAccess(actor, organizationId, "report.edit");
  requireUuid(assignmentId, input?.requestId);
  const values = parseOrThrow(draftSummaryInputSchema, input);
  return guardReportErrors("summary_draft", async (): Promise<DraftSummaryResult> => {
    const report = await findReport(db, grant.organizationId, assignmentId);
    if (!report) throw new ReportValidationError("report_not_started");
    if (report.status !== "draft") throw new ReportValidationError("report_not_editable");
    const { findings, missingTgCount } = await loadSummaryFindings(
      db,
      grant.organizationId,
      report.id,
      report.templateVersionId,
    );
    // Ingen godkjente funn: intet kall og ingen rad («Ingen avvik med TG ennå»)
    if (findings.length === 0) return { status: "no_findings", missingTgCount };
    // Aldri stille kutt av funn
    if (findings.length > AI_SUMMARY_FINDINGS_MAX) return { status: "too_many_findings" };
    const basis = summaryBasisOf(findings);

    // Bare TGIU-funn: koden skriver hele utkastet, KI kalles ikke (A462)
    if (!summaryNeedsAi(findings)) {
      return {
        status: "suggestion",
        usageId: null,
        text: assembleCodeOnlySummary(findings),
        basis,
        missingTgCount,
      };
    }

    let result: AiSuggestionResult;
    try {
      result = await requestSuggestion(
        grant,
        {
          requestId: values.requestId,
          feature: "summary_draft",
          // Kjernen slår opp rapporten og utleder oppdraget selv
          assignmentId: null,
          reportId: null,
          target: { type: "report", id: report.id, fieldKey: "summary_text" },
          fields: {},
        },
        { summaryGroups: aiSummaryGroups(findings) },
      );
    } catch (error) {
      if (error instanceof AiInputTooLargeError) return { status: "too_many_findings" };
      throw error;
    }
    switch (result.kind) {
      case "suggestion":
        return {
          status: "suggestion",
          usageId: result.usageId,
          text: result.text,
          basis,
          missingTgCount,
        };
      case "stopped":
        return { status: "stopped", guard: result.guard };
      case "disabled":
      case "blocked":
        return { status: "ai_off" };
      default:
        return { status: "ai_error" };
    }
  });
};

// --- Lagring -------------------------------------------------------------------------------

function findingKey(source: string, id: string): string {
  return `${source}|${id}`;
}

/**
 * Kontrollerer grunnlaget fra nettleseren mot dagens funn (A470): hver id må være et funn i denne
 * rapporten, hver del en del av det funnet, ingen `rowVersion` høyere enn dagens og ingen funn to
 * ganger. `group` settes av serveren fra dagens funn.
 */
function checkedBasis(
  basis: readonly SummaryBasisEntry[],
  findings: readonly SummaryFinding[],
): SummaryBasisEntry[] {
  const current = new Map(findings.map((f) => [findingKey(f.source, f.id), f]));
  const seen = new Set<string>();
  return basis.map((entry) => {
    const key = findingKey(entry.source, entry.id);
    const finding = current.get(key);
    if (!finding || seen.has(key) || entry.rowVersion > finding.rowVersion) {
      throw new ReportValidationError("invalid_input");
    }
    seen.add(key);
    const parts = new Map(finding.parts.map((p) => [p.id, p.rowVersion]));
    const seenParts = new Set<string>();
    for (const part of entry.parts) {
      const rowVersion = parts.get(part.id);
      if (rowVersion === undefined || seenParts.has(part.id) || part.rowVersion > rowVersion) {
        throw new ReportValidationError("invalid_input");
      }
      seenParts.add(part.id);
    }
    return {
      source: entry.source,
      id: entry.id,
      group: finding.group,
      rowVersion: entry.rowVersion,
      parts: entry.parts.map((p) => ({ id: p.id, rowVersion: p.rowVersion })),
    };
  });
}

/**
 * Loggraden for utkastet (A470): samme organisasjon, ikke slettet, funksjonen `summary_draft` og
 * målet `report` / `summary_text` med id-en til akkurat denne rapporten. Ellers 404. Gir teksten
 * som ble lagret og antall plassholdere, så serveren kan avgjøre «godtatt» eller «endret».
 */
async function requireSummaryUsageRow(
  ex: DbExecutor,
  orgId: string,
  reportId: string,
  usageId: string,
): Promise<{ outputText: string | null; redactedCount: number }> {
  const [row] = await ex
    .select({
      feature: aiUsageLog.feature,
      reportId: aiUsageLog.reportId,
      targetRef: aiUsageLog.targetRef,
      outputText: aiUsageLog.outputText,
      redactedCount: aiUsageLog.redactedCount,
    })
    .from(aiUsageLog)
    .where(
      and(
        eq(aiUsageLog.organizationId, orgId),
        eq(aiUsageLog.id, usageId),
        isNull(aiUsageLog.deletedAt),
      ),
    );
  if (
    !row ||
    row.feature !== "summary_draft" ||
    row.reportId !== reportId ||
    row.targetRef?.type !== "report" ||
    row.targetRef.id !== reportId ||
    row.targetRef.fieldKey !== "summary_text"
  ) {
    throw new AccessDeniedError();
  }
  return { outputText: row.outputText, redactedCount: row.redactedCount };
}

/** Lik tekst uten hensyn til linjeskiftform, Unicode-form og mellomrom i start og slutt. */
function sameSummaryText(a: string, b: string): boolean {
  const normalize = (text: string) => text.normalize("NFC").replace(/\r\n?/gu, "\n").trim();
  return normalize(a) === normalize(b);
}

/**
 * «Godtatt» eller «endret». Uten plassholdere avgjør serveren selv ved å sammenligne med teksten
 * KI ga (`output_text`). Med plassholdere er de opprinnelige verdiene borte (A466), og da gjelder
 * det klienten sier.
 */
function summaryDecision(
  row: { outputText: string | null; redactedCount: number },
  text: string,
  clientEdited: boolean,
): "accepted" | "edited" {
  if (row.redactedCount > 0 || row.outputText === null || containsPiiPlaceholder(row.outputText)) {
    return clientEdited ? "edited" : "accepted";
  }
  return sameSummaryText(text, row.outputText) ? "accepted" : "edited";
}

/** Se `SaveSummary` i `./types`. */
export const saveSummary: SaveSummary = (actor, organizationId, assignmentId, input) =>
  withReportWrite(
    actor,
    organizationId,
    assignmentId,
    async (scope): Promise<SaveSummaryResult> => {
      if (input?.draft?.usageId) requireUuid(input.draft.usageId);
      const values = parseOrThrow(saveSummaryInputSchema, input);
      const report = await findReport(scope.tx, scope.orgId, assignmentId);
      if (!report || report.id !== scope.reportId) throw new AccessDeniedError();
      if (values.baseRowVersion !== scope.reportRowVersion) {
        return { status: "conflict", summary: await summaryView(scope.tx, scope.grant, report) };
      }

      const text = values.text;
      // Et utkast fra KI kan ikke «brukes» som tomt sammendrag
      if (text === null && values.draft?.usageId) {
        throw new ReportValidationError("invalid_input");
      }
      let basis: SummaryBasisEntry[] | null | undefined;
      if (text === null) {
        // Tom tekst tømmer sammendraget og grunnlaget
        basis = null;
      } else if (values.draft) {
        const { findings } = await loadSummaryFindings(
          scope.tx,
          scope.orgId,
          scope.reportId,
          scope.templateVersionId,
        );
        basis = checkedBasis(values.draft.basis, findings);
      }
      const usageRow = values.draft?.usageId
        ? await requireSummaryUsageRow(scope.tx, scope.orgId, scope.reportId, values.draft.usageId)
        : null;

      const [updated] = await scope.tx
        .update(reports)
        .set({
          summaryText: text,
          ...(basis !== undefined ? { summaryBasis: basis } : {}),
          updatedBy: scope.grant.employeeId,
        })
        .where(and(eq(reports.organizationId, scope.orgId), eq(reports.id, scope.reportId)))
        .returning({ id: reports.id });
      if (!updated) throw new AccessDeniedError();
      // Bare feltkoden, aldri teksten
      await recordAuditEvent(scope.tx, scope.grant, {
        entityType: "report",
        entityId: scope.reportId,
        action: "update",
        changes: {
          reportId: scope.reportId,
          field: "summary_text",
          fromDraft: values.draft !== undefined,
        },
      });
      // Beslutningen i samme transaksjon (A469): rapportraden er låst først, så KI-låsen
      if (values.draft?.usageId && usageRow && text !== null) {
        await recordDecisionIn(
          scope.tx,
          scope.grant,
          values.draft.usageId,
          summaryDecision(usageRow, text, values.draft.edited),
        );
      }
      const fresh = await findReport(scope.tx, scope.orgId, assignmentId);
      if (!fresh) throw new AccessDeniedError();
      return { status: "saved", summary: await summaryView(scope.tx, scope.grant, fresh) };
    },
  );
