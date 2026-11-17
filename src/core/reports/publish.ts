import { createHash } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
  AccessDeniedError,
  canSeeOverrideReasons,
  grantHasPermission,
  requireOrganizationAccess,
  rolesGivePublish,
  type EmployeeGrant,
} from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { recordEvent } from "@/core/events";
import { findLatestExpiredCertificationDate, findValidCertification } from "@/core/organization";
import { db, type DbExecutor } from "@/db/client";
import {
  assignments,
  employees,
  publishCheckResults,
  reportReleases,
  reports,
  type PublishCheckCode,
  type PublishOverrideReasonCode,
} from "@/db/schema";
import { todayInOslo } from "@/shared/lib/dates";
import { uuidv7 } from "@/shared/lib/uuid";
import { requireUuid } from "./context";
import { guardReportErrors, ReportValidationError } from "./errors";
import type { PublishCheckFinding, PublishCheckTarget } from "./logic";
import {
  canonicalJson,
  canonicalPublishCheck,
  checkPublishOverrideReason,
  computePublishCheck,
  publishFindingKey,
  summarizePublishCheck,
} from "./logic/publish-check";
import type {
  GetPublishCheck,
  ListPendingAiSuggestions,
  ListReleases,
  PendingAiSuggestionView,
  PreviousOverride,
  PublishAbility,
  PublishCheckView,
  PublishFindingView,
  PublishReport,
  ReleaseOverrideView,
  ReleaseView,
  ReportSnapshot,
  StartNewVersion,
} from "./publish-types";
import {
  buildPublishCheckInput,
  findLatestRelease,
  loadPublishSource,
  pendingAiSuggestionsOf,
  type PublishSource,
} from "./signals";
import { buildPublishPreview, buildReportSnapshot } from "./snapshot";

/*
 * Publiseringen (ADR 0015, docs/funksjoner/fase2a-publisering-badet.md Omfang 7–9 og 11–13).
 *
 * - Sjekken er ren kode (`logic/publish-check.ts`). Her bygges inndata fra lagrede data, og
 *   fingeravtrykket regnes (SHA-256). KI er ikke med: ingen import av `@/core/ai`, ingen rad i
 *   `ai_usage_log`. KI setter aldri TG, krysser aldri bort en sperre og publiserer aldri.
 * - Rapporten slås alltid opp fra oppdraget med `grant.organizationId`. Rapport-id, ansatt, tid,
 *   versjonsnummer og funn tas aldri fra klienten.
 * - `report_releases` og `publish_check_results` skrives bare av `publishReport`, og ingen
 *   tjeneste endrer eller sletter dem.
 * - Begrunnelsesteksten står bare i sjekkraden: aldri i revisjonsloggen, hendelser, loggen eller
 *   feilmeldinger. Snapshot logges aldri.
 */

type CheckDraftView = Extract<PublishCheckView, { state: "draft" }>;

type AssignmentRef = { id: string; inspectionAt: Date | null; companyId: string | null };
type ReportRef = PublishSource["report"];

// --- Oppslag -----------------------------------------------------------------------------------

/** Oppdraget i organisasjonen (ikke slettet), ellers 404. */
async function requireAssignment(
  ex: DbExecutor,
  orgId: string,
  assignmentId: string,
): Promise<AssignmentRef> {
  const [row] = await ex
    .select({
      id: assignments.id,
      inspectionAt: assignments.inspectionAt,
      companyId: assignments.companyId,
    })
    .from(assignments)
    .where(
      and(
        eq(assignments.id, assignmentId),
        eq(assignments.organizationId, orgId),
        isNull(assignments.deletedAt),
      ),
    );
  if (!row) throw new AccessDeniedError();
  return row;
}

/**
 * Oppdragets gjeldende rapport, eller `null`. `lock` låser rapportraden (`FOR UPDATE`), samme lås
 * som `withRoomWrite`, så publisering og skriving i rapporten går etter hverandre.
 */
async function findCurrentReport(
  ex: DbExecutor,
  orgId: string,
  assignmentId: string,
  lock: boolean,
): Promise<ReportRef | null> {
  const query = ex
    .select({
      id: reports.id,
      status: reports.status,
      templateVersionId: reports.templateVersionId,
      reportType: reports.reportType,
    })
    .from(reports)
    .where(
      and(
        eq(reports.organizationId, orgId),
        eq(reports.assignmentId, assignmentId),
        isNull(reports.deletedAt),
        ne(reports.status, "superseded"),
      ),
    );
  const [row] = lock ? await query.for("update") : await query;
  return row ?? null;
}

/** Låsen bor i `published-lock.ts` (med `FOR SHARE`); eksporteres videre her. */
export { isReportPublishedForAssignment } from "./published-lock";

// --- Sjekken -----------------------------------------------------------------------------------

/** SHA-256 (hex) av teksten. */
function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Fingeravtrykket av funnlisten (ADR 0015 punkt 6). */
export function publishCheckFingerprint(findings: readonly PublishCheckFinding[]): string {
  return sha256(canonicalPublishCheck(findings));
}

/** `content_hash` for snapshot: SHA-256 av kanonisk JSON. */
export function snapshotContentHash(snapshot: ReportSnapshot): string {
  return sha256(canonicalJson(snapshot));
}

/** Ett år etter datoen (ÅÅÅÅ-MM-DD). 29. februar gir 28. februar (regel 12). */
export function oneYearAfter(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number) as [number, number, number];
  const nextDay = month === 2 && day === 29 ? 28 : day;
  return `${String(year + 1).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(nextDay).padStart(2, "0")}`;
}

/** Ti år etter tidspunktet (oppbevaring, regel 3). 29. februar blir 28. februar. */
export function tenYearsAfter(time: Date): Date {
  const result = new Date(time);
  const month = result.getUTCMonth();
  result.setUTCFullYear(result.getUTCFullYear() + 10);
  if (result.getUTCMonth() !== month) result.setUTCDate(0);
  return result;
}

/** Den interne stien til punktet, bygget her fra id-er. Funn på rapporten har ingen sti. */
function hrefOf(assignmentId: string, target: PublishCheckTarget): string | null {
  if (!target.roomId) return null;
  const base = `/oppdrag/${assignmentId}/rom/${target.roomId}`;
  const query = new URLSearchParams();
  if (target.checkpointKey) query.set("punkt", target.checkpointKey);
  query.set("fra", "publiser");
  return `${base}?${query.toString()}`;
}

function toTarget(
  target: Omit<PublishCheckTarget, "ruleKey" | "missing"> &
    Partial<Pick<PublishCheckTarget, "ruleKey" | "missing">>,
): PublishCheckTarget {
  const { roomId, checkpointId, checkpointKey, deviationId, aiUsageId } = target;
  return {
    roomId,
    checkpointId,
    checkpointKey,
    deviationId,
    ruleKey: target.ruleKey ?? null,
    aiUsageId,
    missing: target.missing ?? [],
  };
}

/** Om den ansatte kan publisere i dag, med grunn når svaret er nei (F5). */
async function publishAbilityOf(
  ex: DbExecutor,
  grant: EmployeeGrant,
  today: string,
): Promise<PublishAbility> {
  const hasPermission = grantHasPermission(grant, "report.publish");
  if (!hasPermission && !rolesGivePublish(grant)) {
    return { allowed: false, reason: "missing_permission" };
  }
  const certification = await findValidCertification(
    ex,
    grant.organizationId,
    grant.employeeId,
    today,
  );
  if (certification && hasPermission) {
    return { allowed: true, certificationId: certification.id };
  }
  if (certification) return { allowed: false, reason: "missing_permission" };
  return {
    allowed: false,
    reason: "no_valid_certification",
    expiredOn: await findLatestExpiredCertificationDate(
      ex,
      grant.organizationId,
      grant.employeeId,
      today,
    ),
  };
}

/** Overstyringene i forrige utgivelse per funn-nøkkel («I versjon 1 krysset du bort dette»). */
async function previousOverridesOf(
  ex: DbExecutor,
  grant: EmployeeGrant,
  source: PublishSource,
): Promise<Map<string, PreviousOverride>> {
  const result = new Map<string, PreviousOverride>();
  const latest = source.latestRelease;
  if (!latest) return result;
  const showText = canSeeOverrideReasons(grant);
  const rows = await ex
    .select({
      checkCode: publishCheckResults.checkCode,
      targetRef: publishCheckResults.targetRef,
      reasonCode: publishCheckResults.overrideReasonCode,
      reason: publishCheckResults.overrideReason,
    })
    .from(publishCheckResults)
    .where(
      and(
        eq(publishCheckResults.organizationId, grant.organizationId),
        eq(publishCheckResults.reportId, source.report.id),
        eq(publishCheckResults.releaseId, latest.id),
        eq(publishCheckResults.overridden, true),
      ),
    );
  for (const row of rows) {
    if (!row.reasonCode) continue;
    const key = publishFindingKey({
      checkCode: row.checkCode,
      target: row.targetRef as PublishCheckTarget,
    });
    result.set(key, {
      versionNumber: latest.versionNumber,
      reasonCode: row.reasonCode,
      reason: showText ? row.reason : null,
    });
  }
  return result;
}

function pendingViewsOf(source: PublishSource): PendingAiSuggestionView[] {
  return pendingAiSuggestionsOf(source).map(({ aiUsageId, outputText, field, ...place }) => ({
    aiUsageId,
    target: toTarget({ ...place, aiUsageId, ruleKey: null }),
    field: { type: field.type, id: field.id, fieldKey: field.fieldKey },
    outputText,
  }));
}

/**
 * Avviksnummeret (1, 2, … i rekkefølgen på punktet, som rommet viser) og TG for hvert avvik, så
 * funnteksten kan si «Avvik 1 (TG3)». Bare til visning.
 */
function deviationNumbersOf(
  source: PublishSource,
): Map<string, { number: number; tg: 2 | 3 | null }> {
  const result = new Map<string, { number: number; tg: 2 | 3 | null }>();
  for (const room of source.rooms) {
    for (const checkpoint of room.state.checkpoints) {
      const sorted = [...checkpoint.deviations].sort((a, b) => a.sortOrder - b.sortOrder);
      sorted.forEach((deviation, index) => {
        const tg = deviation.tg === 2 || deviation.tg === 3 ? deviation.tg : null;
        result.set(deviation.id, { number: index + 1, tg });
      });
    }
  }
  return result;
}

/**
 * Datoene utgivelsen får (4.7, regel 12): versjon 1 får dagens dato og befaringsdato + ett år (tom
 * uten befaringsdato); versjon 2 og senere arver begge fra versjon 1. Samme funksjon gir «Gyldig
 * til» i «Dette publiseres», så det den ansatte ser, er det som lagres.
 */
async function releaseDatesOf(
  ex: DbExecutor,
  source: PublishSource,
  versionNumber: number,
  today: string,
): Promise<{ originalReleaseDate: string; validUntil: string | null; inherited: boolean }> {
  const own = source.inspectionDate ? oneYearAfter(source.inspectionDate) : null;
  if (versionNumber <= 1) return { originalReleaseDate: today, validUntil: own, inherited: false };
  const [first] = await ex
    .select({
      originalReleaseDate: reportReleases.originalReleaseDate,
      validUntil: reportReleases.validUntil,
    })
    .from(reportReleases)
    .where(
      and(
        eq(reportReleases.organizationId, source.orgId),
        eq(reportReleases.reportId, source.report.id),
        eq(reportReleases.versionNumber, 1),
      ),
    );
  if (!first) return { originalReleaseDate: today, validUntil: own, inherited: false };
  return {
    originalReleaseDate: first.originalReleaseDate,
    validUntil: first.validUntil,
    inherited: true,
  };
}

/** Sjekken regnet på lagrede data: funnene og fingeravtrykket. */
function runCheck(source: PublishSource) {
  const findings = computePublishCheck(buildPublishCheckInput(source));
  return { findings, fingerprint: publishCheckFingerprint(findings) };
}

/** Listen slik publiser-siden viser den. Leser bare; lager aldri rader. */
async function buildDraftView(
  ex: DbExecutor,
  grant: EmployeeGrant,
  source: PublishSource,
  check: ReturnType<typeof runCheck>,
  now: Date,
): Promise<CheckDraftView> {
  const nextVersionNumber = (source.latestRelease?.versionNumber ?? 0) + 1;
  const [previous, ability, dates] = await Promise.all([
    previousOverridesOf(ex, grant, source),
    publishAbilityOf(ex, grant, todayInOslo(now)),
    releaseDatesOf(ex, source, nextVersionNumber, todayInOslo(now)),
  ]);
  const roomNames = new Map(source.rooms.map((room) => [room.roomId, room.name]));
  const checkpointLabels = new Map(
    source.template.document.checkpoints.map((c) => [c.key, c.name] as const),
  );
  const deviations = deviationNumbersOf(source);
  const findings: PublishFindingView[] = check.findings.map((item) => {
    const key = publishFindingKey(item);
    return {
      ...item,
      key,
      href: hrefOf(source.assignmentId, item.target),
      roomName: item.target.roomId ? (roomNames.get(item.target.roomId) ?? null) : null,
      checkpointLabel: item.target.checkpointKey
        ? (checkpointLabels.get(item.target.checkpointKey) ?? null)
        : null,
      deviationNumber: item.target.deviationId
        ? (deviations.get(item.target.deviationId)?.number ?? null)
        : null,
      deviationTg: item.target.deviationId
        ? (deviations.get(item.target.deviationId)?.tg ?? null)
        : null,
      previousOverride: item.severity === "blocker" ? (previous.get(key) ?? null) : null,
    };
  });
  return {
    state: "draft",
    reportId: source.report.id,
    nextVersionNumber,
    validUntil: dates.validUntil,
    validUntilInherited: dates.inherited,
    findings,
    summary: summarizePublishCheck(check.findings),
    fingerprint: check.fingerprint,
    hasWetRoom: source.rooms.length > 0,
    preview: buildPublishPreview(buildReportSnapshot(source)),
    pendingAiSuggestions: pendingViewsOf(source),
    ability,
    canEdit: grantHasPermission(grant, "report.edit"),
  };
}

/** TG-logikken gjelder bare systemmalen for tilstandsrapport (regel 5). */
function requireConditionReportTemplate(source: PublishSource): void {
  if (source.template.kind !== "system" || source.template.reportType !== "condition_report") {
    throw new ReportValidationError("not_applicable");
  }
}

/**
 * Sjekken for oppdragets rapport (`organization.read`). Ren lesing: lager aldri rader, heller
 * ikke i `publish_check_results`.
 */
export const getPublishCheck: GetPublishCheck = async (actor, organizationId, assignmentId) => {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  requireUuid(assignmentId);
  const orgId = grant.organizationId;
  return guardReportErrors("publish_check", async (): Promise<PublishCheckView> => {
    const assignment = await requireAssignment(db, orgId, assignmentId);
    const report = await findCurrentReport(db, orgId, assignment.id, false);
    if (!report) return { state: "not_started" };
    if (report.status === "published") {
      const latest = await findLatestRelease(db, orgId, report.id);
      if (latest) {
        return {
          state: "published",
          reportId: report.id,
          versionNumber: latest.versionNumber,
          releasedAt: latest.releasedAt.toISOString(),
          canStartNewVersion: grantHasPermission(grant, "report.edit"),
        };
      }
    }
    const now = new Date();
    const source = await loadPublishSource(
      db,
      actor,
      grant,
      { assignmentId: assignment.id, inspectionAt: assignment.inspectionAt, report },
      now,
    );
    return buildDraftView(db, grant, source, runCheck(source), now);
  });
};

// --- Publisering -------------------------------------------------------------------------------

/** Formen på det som sendes. Ekstra felt (rapport-id, ansatt, tid, versjon) ignoreres. */
const publishInputSchema = z.object({
  assignmentId: z.string(),
  fingerprint: z.string().max(128).nullable(),
  overrides: z
    .array(
      z.object({
        findingKey: z.string().min(1).max(4000),
        reasonCode: z.string().max(64).nullable(),
        text: z.string().max(20000).nullable().optional(),
      }),
    )
    .max(2000),
});

type AcceptedOverride = {
  finding: PublishCheckFinding;
  reasonCode: PublishOverrideReasonCode;
  text: string | null;
};

/**
 * Kobler overstyringene til sperrene serveren selv har regnet ut (ADR 0015 punkt 5). Ukjent
 * nøkkel, advarsel, samme sperre to ganger eller ugyldig begrunnelse gir `publish_override`.
 */
function acceptOverrides(
  findings: readonly PublishCheckFinding[],
  overrides: z.output<typeof publishInputSchema>["overrides"],
): { accepted: Map<string, AcceptedOverride>; remaining: string[] } {
  const blockers = new Map<string, PublishCheckFinding>();
  for (const item of findings) {
    if (item.severity === "blocker") blockers.set(publishFindingKey(item), item);
  }
  const accepted = new Map<string, AcceptedOverride>();
  for (const override of overrides) {
    const finding = blockers.get(override.findingKey);
    if (!finding || accepted.has(override.findingKey)) {
      throw new ReportValidationError("publish_override");
    }
    const text = override.text?.trim() ? override.text.trim() : null;
    const check = checkPublishOverrideReason({
      reasonCode: override.reasonCode as PublishOverrideReasonCode | null,
      text,
    });
    if (check !== "ok") throw new ReportValidationError("publish_override");
    accepted.set(override.findingKey, {
      finding,
      reasonCode: override.reasonCode as PublishOverrideReasonCode,
      text,
    });
  }
  const remaining = [...blockers.keys()].filter((key) => !accepted.has(key));
  return { accepted, remaining };
}

/**
 * Publiserer rapporten (`report.publish` og gyldig sertifisering). Én transaksjon med låst
 * rapportrad; feil underveis lagrer ingenting. To samtidige kall gir én utgivelse.
 */
export const publishReport: PublishReport = async (actor, organizationId, rawInput) => {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  requireUuid(rawInput?.assignmentId);
  if (!grantHasPermission(grant, "report.publish")) {
    // Rollen gir publisering, men sertifiseringen mangler: si det tydelig (A29). Ellers 404.
    if (rolesGivePublish(grant)) throw new ReportValidationError("certification_missing");
    throw new AccessDeniedError();
  }
  const parsed = publishInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new ReportValidationError("invalid_input");
  const input = parsed.data;
  const orgId = grant.organizationId;

  return guardReportErrors("publish", () =>
    db.transaction(async (tx) => {
      const now = new Date();
      const today = todayInOslo(now);

      // 1. Rapporten fra oppdraget, låst. Bare en rapport under arbeid kan publiseres.
      const assignment = await requireAssignment(tx, orgId, input.assignmentId);
      const report = await findCurrentReport(tx, orgId, assignment.id, true);
      if (!report) throw new ReportValidationError("report_not_started");
      if (report.status !== "draft") throw new ReportValidationError("report_published");

      // 2. Gyldig sertifisering i dag i norsk tid (A29). Gjelder også admin.
      const certification = await findValidCertification(tx, orgId, grant.employeeId, today);
      if (!certification) throw new ReportValidationError("certification_missing");

      // 3. Selskap og våtrom. Ingen av dem kan krysses bort.
      if (!assignment.companyId) throw new ReportValidationError("company_missing");
      const source = await loadPublishSource(
        tx,
        actor,
        grant,
        { assignmentId: assignment.id, inspectionAt: assignment.inspectionAt, report },
        now,
      );
      requireConditionReportTemplate(source);
      if (source.rooms.length === 0) throw new ReportValidationError("no_wet_room");

      // 4. Sjekken på nytt. Annen liste enn den ansatte så: den nye listen tilbake, ingenting lagret.
      const check = runCheck(source);
      if (input.fingerprint !== check.fingerprint) {
        return {
          status: "check_changed" as const,
          check: await buildDraftView(tx, grant, source, check, now),
        };
      }

      // 5. Overstyringene må treffe sperrer serveren selv har regnet ut.
      const { accepted, remaining } = acceptOverrides(check.findings, input.overrides);
      if (remaining.length > 0) return { status: "blockers_remaining" as const, remaining };

      // 6. Utgivelsen. Versjon 2 og senere arver datoene fra versjon 1.
      const versionNumber = (source.latestRelease?.versionNumber ?? 0) + 1;
      const dates = await releaseDatesOf(tx, source, versionNumber, today);
      const { originalReleaseDate, validUntil } = dates;
      const snapshot = buildReportSnapshot(source);
      const releaseId = uuidv7();
      await tx.insert(reportReleases).values({
        id: releaseId,
        organizationId: orgId,
        reportId: report.id,
        versionNumber,
        releasedAt: now,
        releasedBy: grant.employeeId,
        signedByEmployeeId: grant.employeeId,
        certificationId: certification.id,
        companyId: assignment.companyId,
        originalReleaseDate,
        validUntil,
        snapshot: snapshot as unknown as Record<string, unknown>,
        contentHash: snapshotContentHash(snapshot),
        retainUntil: tenYearsAfter(now),
        createdBy: grant.employeeId,
      });

      // 7. Sjekkrader for alle funn, også advarsler.
      const overrideRows: { id: string; checkCode: PublishCheckCode; reasonCode: string }[] = [];
      const rows = check.findings.map((item) => {
        const id = uuidv7();
        const override = accepted.get(publishFindingKey(item));
        if (override) {
          overrideRows.push({ id, checkCode: item.checkCode, reasonCode: override.reasonCode });
        }
        return {
          id,
          organizationId: orgId,
          reportId: report.id,
          releaseId,
          checkCode: item.checkCode,
          severity: item.severity,
          source: item.source,
          targetRef: item.target,
          overridden: override !== undefined,
          overriddenBy: override ? grant.employeeId : null,
          overriddenAt: override ? now : null,
          overrideReasonCode: override?.reasonCode ?? null,
          overrideReason: override?.text ?? null,
          createdBy: grant.employeeId,
        };
      });
      if (rows.length > 0) await tx.insert(publishCheckResults).values(rows);

      await tx
        .update(reports)
        .set({ status: "published", updatedBy: grant.employeeId })
        .where(and(eq(reports.organizationId, orgId), eq(reports.id, report.id)));

      // Revisjonslogg og hendelser: bare id-er, versjon, tall og faste koder.
      await recordAuditEvent(tx, grant, {
        entityType: "report",
        entityId: report.id,
        action: "publish",
        changes: {
          releaseId,
          versionNumber,
          status: { from: "draft", to: "published" },
          findingCount: rows.length,
          overriddenCount: overrideRows.length,
        },
      });
      await recordEvent(tx, grant, {
        type: versionNumber === 1 ? "report.published" : "report.revised",
        assignmentId: assignment.id,
        reportId: report.id,
        data: { releaseId, versionNumber },
      });
      for (const override of overrideRows) {
        await recordEvent(tx, grant, {
          type: "report.publish_override",
          assignmentId: assignment.id,
          reportId: report.id,
          data: {
            releaseId,
            versionNumber,
            checkResultId: override.id,
            checkCode: override.checkCode,
            reasonCode: override.reasonCode,
          },
        });
      }

      return { status: "published" as const, releaseId, versionNumber, validUntil };
    }),
  );
};

// --- Ny versjon --------------------------------------------------------------------------------

/**
 * «Lag ny versjon» (`report.edit`, A425): rapporten går tilbake til `draft` i samme rapport.
 * Eldre utgivelser og sjekkrader røres ikke, og ingen overstyring følger med. Er rapporten alt
 * under arbeid, er svaret det samme uten endring.
 */
export const startNewVersion: StartNewVersion = async (actor, organizationId, assignmentId) => {
  const grant = await requireOrganizationAccess(actor, organizationId, "report.edit");
  requireUuid(assignmentId);
  const orgId = grant.organizationId;
  return guardReportErrors("new_version", () =>
    db.transaction(async (tx) => {
      const assignment = await requireAssignment(tx, orgId, assignmentId);
      const report = await findCurrentReport(tx, orgId, assignment.id, true);
      if (!report) throw new ReportValidationError("report_not_started");
      const latest = await findLatestRelease(tx, orgId, report.id);
      const nextVersionNumber = (latest?.versionNumber ?? 0) + 1;
      if (report.status !== "published") return { reportId: report.id, nextVersionNumber };

      await tx
        .update(reports)
        .set({ status: "draft", updatedBy: grant.employeeId })
        .where(and(eq(reports.organizationId, orgId), eq(reports.id, report.id)));
      await recordAuditEvent(tx, grant, {
        entityType: "report",
        entityId: report.id,
        action: "new_version",
        changes: { status: { from: "published", to: "draft" }, nextVersionNumber },
      });
      return { reportId: report.id, nextVersionNumber };
    }),
  );
};

// --- Utgivelsene -------------------------------------------------------------------------------

/** Romnavn og punktnavn fra snapshot, til listen over overstyringer. */
function namesFromSnapshot(snapshot: unknown) {
  const rooms = new Map<string, string | null>();
  const checkpoints = new Map<string, string>();
  const value = snapshot as Partial<ReportSnapshot> | null;
  for (const building of value?.buildings ?? []) {
    for (const floor of building.floors ?? []) {
      for (const room of floor.rooms ?? []) {
        rooms.set(room.room_id, room.name);
        for (const checkpoint of room.checkpoints ?? []) {
          checkpoints.set(checkpoint.checkpoint_key, checkpoint.label);
        }
      }
    }
  }
  return { rooms, checkpoints };
}

/**
 * Utgivelsene for oppdragets rapport, nyeste først (`organization.read`). Sender aldri snapshot.
 * Navn slås opp i samme organisasjon, også for ansatte som har sluttet. Begrunnelsesteksten er
 * `null` for den som ikke har `canSeeOverrideReasons`. Slår aldri opp i `claims`.
 */
export const listReleases: ListReleases = async (actor, organizationId, assignmentId) => {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  requireUuid(assignmentId);
  const orgId = grant.organizationId;
  const showText = canSeeOverrideReasons(grant);
  return guardReportErrors("releases", async (): Promise<ReleaseView[]> => {
    const assignment = await requireAssignment(db, orgId, assignmentId);
    const [report] = await db
      .select({ id: reports.id })
      .from(reports)
      .where(
        and(
          eq(reports.organizationId, orgId),
          eq(reports.assignmentId, assignment.id),
          isNull(reports.deletedAt),
          ne(reports.status, "superseded"),
        ),
      );
    if (!report) return [];

    const releasedBy = alias(employees, "released_by_employee");
    const signedBy = alias(employees, "signed_by_employee");
    const releases = await db
      .select({
        id: reportReleases.id,
        versionNumber: reportReleases.versionNumber,
        releasedAt: reportReleases.releasedAt,
        releasedByName: releasedBy.name,
        signedByName: signedBy.name,
        originalReleaseDate: reportReleases.originalReleaseDate,
        validUntil: reportReleases.validUntil,
        snapshot: reportReleases.snapshot,
      })
      .from(reportReleases)
      .innerJoin(
        releasedBy,
        and(
          eq(releasedBy.id, reportReleases.releasedBy),
          eq(releasedBy.organizationId, reportReleases.organizationId),
        ),
      )
      .innerJoin(
        signedBy,
        and(
          eq(signedBy.id, reportReleases.signedByEmployeeId),
          eq(signedBy.organizationId, reportReleases.organizationId),
        ),
      )
      .where(and(eq(reportReleases.organizationId, orgId), eq(reportReleases.reportId, report.id)))
      .orderBy(desc(reportReleases.versionNumber));
    if (releases.length === 0) return [];
    const releaseIds = releases.map((r) => r.id);

    const overriddenBy = alias(employees, "overridden_by_employee");
    const [overrideRows, warningRows] = await Promise.all([
      db
        .select({
          releaseId: publishCheckResults.releaseId,
          checkCode: publishCheckResults.checkCode,
          targetRef: publishCheckResults.targetRef,
          reasonCode: publishCheckResults.overrideReasonCode,
          reason: publishCheckResults.overrideReason,
          overriddenAt: publishCheckResults.overriddenAt,
          overriddenByName: overriddenBy.name,
        })
        .from(publishCheckResults)
        .innerJoin(
          overriddenBy,
          and(
            eq(overriddenBy.id, publishCheckResults.overriddenBy),
            eq(overriddenBy.organizationId, publishCheckResults.organizationId),
          ),
        )
        .where(
          and(
            eq(publishCheckResults.organizationId, orgId),
            eq(publishCheckResults.reportId, report.id),
            inArray(publishCheckResults.releaseId, releaseIds),
            eq(publishCheckResults.overridden, true),
          ),
        )
        .orderBy(asc(publishCheckResults.createdAt), asc(publishCheckResults.id)),
      db
        .select({ releaseId: publishCheckResults.releaseId, total: count() })
        .from(publishCheckResults)
        .where(
          and(
            eq(publishCheckResults.organizationId, orgId),
            eq(publishCheckResults.reportId, report.id),
            inArray(publishCheckResults.releaseId, releaseIds),
            eq(publishCheckResults.severity, "warning"),
          ),
        )
        .groupBy(publishCheckResults.releaseId),
    ]);
    const warnings = new Map(warningRows.map((row) => [row.releaseId, Number(row.total)]));

    return releases.map((release) => {
      const names = namesFromSnapshot(release.snapshot);
      const overrides: ReleaseOverrideView[] = overrideRows
        .filter((row) => row.releaseId === release.id && row.reasonCode && row.overriddenAt)
        .map((row) => {
          const target = row.targetRef as PublishCheckTarget;
          return {
            checkCode: row.checkCode,
            target: toTarget(target),
            roomName: target.roomId ? (names.rooms.get(target.roomId) ?? null) : null,
            checkpointLabel: target.checkpointKey
              ? (names.checkpoints.get(target.checkpointKey) ?? null)
              : null,
            reasonCode: row.reasonCode as PublishOverrideReasonCode,
            reason: showText ? row.reason : null,
            overriddenByName: row.overriddenByName,
            overriddenAt: (row.overriddenAt as Date).toISOString(),
          };
        });
      return {
        id: release.id,
        versionNumber: release.versionNumber,
        releasedAt: release.releasedAt.toISOString(),
        releasedByName: release.releasedByName,
        signedByName: release.signedByName,
        originalReleaseDate: release.originalReleaseDate,
        validUntil: release.validUntil,
        overrides,
        warningCount: warnings.get(release.id) ?? 0,
      };
    });
  });
};

/**
 * KI-forslagene som venter på oppdragets rapport (`organization.read`, A454), med teksten til
 * «Bruk», «Endre» og «Avvis». Samme utvalg som advarselen `ai_suggestion_pending`.
 */
export const listPendingAiSuggestions: ListPendingAiSuggestions = async (
  actor,
  organizationId,
  assignmentId,
) => {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  requireUuid(assignmentId);
  const orgId = grant.organizationId;
  return guardReportErrors("pending_ai", async () => {
    const assignment = await requireAssignment(db, orgId, assignmentId);
    const report = await findCurrentReport(db, orgId, assignment.id, false);
    if (!report) return [];
    const source = await loadPublishSource(
      db,
      actor,
      grant,
      { assignmentId: assignment.id, inspectionAt: assignment.inspectionAt, report },
      new Date(),
    );
    return pendingViewsOf(source);
  });
};
