import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import {
  AccessDeniedError,
  grantHasPermission,
  requireOrganizationAccess,
  type EmployeeGrant,
} from "@/core/access";
import {
  recordDecisionIn,
  requestSuggestion,
  type AiFeatureCode,
  type AiSuggestionResult,
  type AiTargetRef,
} from "@/core/ai";
import {
  AI_OVERRIDE_SUMMARY_MAX_PER_EMPLOYEE_PER_HOUR,
  AI_OVERRIDE_SUMMARY_MAX_PER_ORGANIZATION_PER_DAY,
} from "@/core/ai/limits";
import { recordAuditEvent } from "@/core/audit";
import { db, type DbExecutor } from "@/db/client";
import { aiUsageLog, employees, overrideSummaries, type OverrideSummaryRow } from "@/db/schema";
import {
  publishCheckLabel,
  publishOverrideReasonLabel,
} from "@/shared/config/publish-check-labels";
import { todayInOslo } from "@/shared/lib/dates";
import { logger } from "@/shared/lib/logger";
import { isUuid } from "@/shared/lib/uuid";
import { requireUuid } from "./context";
import { guardReportErrors, ReportValidationError } from "./errors";
import { classifyClaimMarker } from "./logic/claim-marker";
import { PUBLISH_OVERRIDE_REASON_CODES } from "./logic/codes";
import { isOverrideSummaryMonth, overrideListFromDate } from "./logic/overrides";
import { buildOverrideSummaryInput, type OverrideCountRow } from "./override-stats-input";
import { containsPiiPlaceholder } from "./logic/summary";
import { OVERRIDE_SUMMARY_TEXT_MESSAGES, validateSummaryText } from "./logic/summary-text";
import type {
  BuildOverrideStats,
  DecideOverrideSummary,
  GetOverrideSummary,
  ListPublishOverrides,
  OverrideClaimMarker,
  OverrideGroup,
  OverrideReasonGroup,
  OverrideReleaseLine,
  OverrideSummaryTextIssue,
  OverrideSummaryView,
  OverrideSummaryWriteResult,
  RequestOverrideSummary,
  RequestOverrideSummaryResult,
  SaveOverrideSummary,
} from "./override-types";

/*
 * Overstyringer for leder (docs/funksjoner/fase2a-overstyringer-leder.md, ADR 0015 punkt 18 og
 * ADR 0006 tillegg 24.11.2026). Grensesnittet står i `./override-types`.
 *
 * Støtter hovedmål: de ansatte (leder ser mønstrene på én side), færre reklamasjoner (rød
 * markering når en overstyring endte i reklamasjon på samme punkt) og KI i bunnen (serveren
 * teller, KI formulerer månedsoppsummeringen, leder godtar, endrer eller avviser).
 *
 * Regler i hele filen:
 * - Eneste inngang er `requireOrganizationAccess(..., "claims.read")` (`claims.manage` for
 *   beslutning og lagring), ikke `report.read`: siden viser reklamasjonsdata (A565). Alle
 *   spørringer filtrerer på `grant.organizationId`.
 * - Spørringene velger aldri `override_reason`, `overridden_by`, `claims.created_by` eller
 *   tekstkolonnene i `claims`. Ingen filter, sortering eller gruppering på person (spørsmål 100).
 * - `deleted_at is null` i alle ledd: resultatrad, utgivelse, rapport, oppdrag og reklamasjon.
 * - Gruppering og telling gjøres i SQL, med fast antall spørringer uansett antall rader.
 * - Ren lesing av `publish_check_results`, `report_releases` og `claims`; bare
 *   `override_summaries` skrives. Lederens tekst logges aldri (bare id, måned og status).
 */

/** Funksjonskoden i `@/core/ai` (A568). */
const OVERRIDE_SUMMARY_FEATURE = "override_summary" as string as AiFeatureCode;
const OVERRIDE_SUMMARY_TARGET_TYPE = "override_summary";
const OVERRIDE_SUMMARY_FIELD_KEY = "text";

// --- Felles SQL -----------------------------------------------------------------------------

/** Midnatt norsk tid for datoen (`YYYY-MM-DD`), som tidspunkt. */
function osloMidnight(date: string): SQL {
  return sql`(${date}::date::timestamp at time zone 'Europe/Oslo')`;
}

/** Første tidspunkt i måneden etter `month` (`YYYY-MM`), norsk tid. */
function osloNextMonthStart(month: string): SQL {
  return sql`((${`${month}-01`}::date + interval '1 month')::timestamp at time zone 'Europe/Oslo')`;
}

/**
 * Overstyrte sperrer som linjer (én per utgivelse, kode, punkt og grunn) med markeringen fra
 * reklamasjonene, som CTE-en `marked`. `filter` avgrenser på resultatraden eller utgivelsen.
 *
 * Markeringen (A571): en reklamasjon på samme oppdrag, ikke slettet, med samme punkt eller uten
 * punkt, der linjens utgivelse er den siste av rapporten med norsk dato til og med
 * `received_at`. `red` er sann når en slik reklamasjon har samme punkt. `claim_facts` har bare
 * punktkoden, id-en og om utgivelsen var den siste, aldri tekst.
 */
function markedLinesCte(organizationId: string, filter: SQL): SQL {
  return sql`
    lines as (
      select distinct
        pcr.check_code,
        nullif(pcr.target_ref ->> 'checkpointKey', '') as checkpoint_key,
        pcr.override_reason_code as reason_code,
        rr.id as release_id,
        rr.report_id,
        rr.version_number,
        rr.released_at,
        rep.assignment_id,
        rep.template_version_id,
        a.number as assignment_number
      from publish_check_results pcr
      join report_releases rr
        on rr.organization_id = pcr.organization_id
        and rr.report_id = pcr.report_id
        and rr.id = pcr.release_id
        and rr.deleted_at is null
      join reports rep
        on rep.organization_id = pcr.organization_id
        and rep.id = pcr.report_id
        and rep.deleted_at is null
      join assignments a
        on a.organization_id = rep.organization_id
        and a.id = rep.assignment_id
        and a.deleted_at is null
      where pcr.organization_id = ${organizationId}
        and pcr.overridden
        and pcr.severity = 'blocker'
        and pcr.deleted_at is null
        and ${filter}
    ),
    marked as (
      select
        l.*,
        coalesce(m.red, false) as red,
        coalesce(m.claim_facts, '[]'::json) as claim_facts
      from lines l
      left join lateral (
        select
          bool_or(c.checkpoint_key = l.checkpoint_key) as red,
          json_agg(
            json_build_object('id', c.id, 'checkpointKey', c.checkpoint_key)
            order by c.received_at, c.created_at, c.id
          ) as claim_facts
        from claims c
        where c.organization_id = ${organizationId}
          and c.assignment_id = l.assignment_id
          and c.deleted_at is null
          and l.checkpoint_key is not null
          and (c.checkpoint_key is null or c.checkpoint_key = l.checkpoint_key)
          and l.release_id = (
            select r2.id
            from report_releases r2
            where r2.organization_id = ${organizationId}
              and r2.report_id = l.report_id
              and r2.deleted_at is null
              and (r2.released_at at time zone 'Europe/Oslo')::date <= c.received_at
            order by r2.version_number desc
            limit 1
          )
      ) m on true
    )`;
}

/** Rader fra `db.execute`, uansett driverens type. */
function rowsOf<T>(result: unknown): T[] {
  return [...(result as Iterable<T>)];
}

function toNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

// --- Listen (siste 90 dager) ------------------------------------------------------------------

type LineRow = {
  check_code: string;
  checkpoint_key: string | null;
  reason_code: string;
  release_id: string;
  report_id: string;
  version_number: number;
  released_at: string | Date;
  released_date: string;
  assignment_id: string;
  assignment_number: string;
  checkpoint_name: string | null;
  claim_facts: { id: string; checkpointKey: string | null }[] | string;
};

type CountRow = {
  check_code: string;
  checkpoint_key: string | null;
  reason_code: string | null;
  reason_level: number;
  report_count: number;
  claim_count: number;
};

function groupKey(checkCode: string, checkpointKey: string | null): string {
  return `${checkCode}|${checkpointKey ?? ""}`;
}

function reasonKey(checkCode: string, checkpointKey: string | null, reasonCode: string): string {
  return `${groupKey(checkCode, checkpointKey)}|${reasonCode}`;
}

function reasonOrder(code: string): number {
  const index = (PUBLISH_OVERRIDE_REASON_CODES as readonly string[]).indexOf(code);
  return index === -1 ? PUBLISH_OVERRIDE_REASON_CODES.length : index;
}

function compareKeys(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

/** Linjen og markeringen. Markeringen regnes av den rene funksjonen fra fakta fra SQL. */
function lineOf(row: LineRow): OverrideReleaseLine & { releasedAtTime: number } {
  const facts = typeof row.claim_facts === "string" ? JSON.parse(row.claim_facts) : row.claim_facts;
  const claimFacts = (facts ?? []) as { id: string; checkpointKey: string | null }[];
  const marker: OverrideClaimMarker = classifyClaimMarker({
    checkpointKey: row.checkpoint_key,
    // Bare reklamasjoner der utgivelsen var den siste før saken, er med i `claim_facts`
    claims: claimFacts.map((fact) => ({
      checkpointKey: fact.checkpointKey,
      isLatestReleaseBeforeClaim: true,
    })),
  });
  const neutralClaim =
    marker === "checkpoint_not_selected"
      ? (claimFacts.find((fact) => fact.checkpointKey === null)?.id ?? null)
      : null;
  return {
    releaseId: row.release_id,
    reportId: row.report_id,
    assignmentId: row.assignment_id,
    assignmentNumber: row.assignment_number,
    releasedDate: row.released_date,
    versionNumber: toNumber(row.version_number),
    marker,
    claimId: neutralClaim,
    releasedAtTime: new Date(row.released_at).getTime(),
  };
}

/**
 * De to spørringene bak listen: linjene (én per utgivelse, kode, punkt og grunn) og tellingen av
 * unike rapporter på begge nivåer. Fast antall spørringer uansett antall rader. Eksportert for
 * ytelsestesten (EXPLAIN); ikke en del av den offentlige flaten.
 */
export function overrideListQueries(orgId: string, fromDate: string): { lines: SQL; counts: SQL } {
  const cte = markedLinesCte(orgId, sql`pcr.created_at >= ${osloMidnight(fromDate)}`);
  return {
    lines: sql`
    with ${cte}
    select
      m.check_code,
      m.checkpoint_key,
      m.reason_code,
      m.release_id,
      m.report_id,
      m.version_number,
      m.released_at,
      to_char(m.released_at at time zone 'Europe/Oslo', 'YYYY-MM-DD') as released_date,
      m.assignment_id,
      m.assignment_number,
      cp.name as checkpoint_name,
      m.claim_facts
    from marked m
    left join checkpoints cp
      on cp.organization_id = ${orgId}
      and cp.version_id = m.template_version_id
      and cp.key = m.checkpoint_key
      and cp.deleted_at is null
    `,
    counts: sql`
        with ${cte}
        select
          check_code,
          checkpoint_key,
          reason_code,
          grouping(reason_code)::int as reason_level,
          count(distinct report_id)::int as report_count,
          (count(distinct report_id) filter (where red))::int as claim_count
        from marked
        group by grouping sets ((check_code, checkpoint_key), (check_code, checkpoint_key, reason_code))
      `,
  };
}

/** Se `ListPublishOverrides`. */
export const listPublishOverrides: ListPublishOverrides = async (actor, organizationId) => {
  const grant = await requireOrganizationAccess(actor, organizationId, "claims.read");
  return guardReportErrors("overrides_list", async () => {
    const toDate = todayInOslo();
    const fromDate = overrideListFromDate(toDate);
    const orgId = grant.organizationId;
    const queries = overrideListQueries(orgId, fromDate);
    const lineRows = rowsOf<LineRow>(await db.execute(queries.lines));
    if (lineRows.length === 0) return { fromDate, toDate, groups: [] };
    const countRows = rowsOf<CountRow>(await db.execute(queries.counts));

    const groupCounts = new Map<string, { reportCount: number; claimCount: number }>();
    const reasonCounts = new Map<string, { reportCount: number; claimCount: number }>();
    for (const row of countRows) {
      const counts = {
        reportCount: toNumber(row.report_count),
        claimCount: toNumber(row.claim_count),
      };
      if (toNumber(row.reason_level) === 1 || row.reason_code === null) {
        groupCounts.set(groupKey(row.check_code, row.checkpoint_key), counts);
      } else {
        reasonCounts.set(reasonKey(row.check_code, row.checkpoint_key, row.reason_code), counts);
      }
    }

    type GroupDraft = {
      group: OverrideGroup;
      newestTime: number;
      reasons: Map<
        string,
        OverrideReasonGroup & { lines: (OverrideReleaseLine & { releasedAtTime: number })[] }
      >;
    };
    const groups = new Map<string, GroupDraft>();
    for (const row of lineRows) {
      const key = groupKey(row.check_code, row.checkpoint_key);
      const line = lineOf(row);
      let draft = groups.get(key);
      if (!draft) {
        const counts = groupCounts.get(key) ?? { reportCount: 0, claimCount: 0 };
        draft = {
          group: {
            checkCode: row.check_code as OverrideGroup["checkCode"],
            checkLabel: publishCheckLabel(row.check_code),
            checkpointKey: row.checkpoint_key,
            checkpointName: null,
            reportCount: counts.reportCount,
            claimCount: counts.claimCount,
            reasons: [],
          },
          newestTime: Number.NEGATIVE_INFINITY,
          reasons: new Map(),
        };
        groups.set(key, draft);
      }
      // Navnet fra malversjonen til den nyeste rapporten i gruppen
      if (row.checkpoint_key !== null && line.releasedAtTime > draft.newestTime) {
        draft.newestTime = line.releasedAtTime;
        if (row.checkpoint_name) draft.group.checkpointName = row.checkpoint_name;
      } else if (
        row.checkpoint_key !== null &&
        !draft.group.checkpointName &&
        row.checkpoint_name
      ) {
        draft.group.checkpointName = row.checkpoint_name;
      }
      let reason = draft.reasons.get(row.reason_code);
      if (!reason) {
        const counts = reasonCounts.get(
          reasonKey(row.check_code, row.checkpoint_key, row.reason_code),
        ) ?? { reportCount: 0, claimCount: 0 };
        reason = {
          reasonCode: row.reason_code as OverrideReasonGroup["reasonCode"],
          reasonLabel: publishOverrideReasonLabel(row.reason_code),
          reportCount: counts.reportCount,
          claimCount: counts.claimCount,
          releases: [],
          lines: [],
        };
        draft.reasons.set(row.reason_code, reason);
      }
      reason.lines.push(line);
    }

    const result: OverrideGroup[] = [...groups.values()].map((draft) => ({
      ...draft.group,
      reasons: [...draft.reasons.values()]
        .sort(
          (a, b) =>
            b.claimCount - a.claimCount ||
            b.reportCount - a.reportCount ||
            reasonOrder(a.reasonCode) - reasonOrder(b.reasonCode),
        )
        .map(({ lines, ...reason }) => ({
          ...reason,
          // Nyeste først; aldri på person
          releases: lines
            .sort(
              (a, b) =>
                b.releasedAtTime - a.releasedAtTime ||
                a.assignmentNumber.localeCompare(b.assignmentNumber) ||
                b.versionNumber - a.versionNumber ||
                a.releaseId.localeCompare(b.releaseId),
            )
            .map(({ releasedAtTime: _time, ...line }) => line),
        })),
    }));
    result.sort(
      (a, b) =>
        b.claimCount - a.claimCount ||
        b.reportCount - a.reportCount ||
        a.checkCode.localeCompare(b.checkCode) ||
        compareKeys(a.checkpointKey, b.checkpointKey),
    );
    return { fromDate, toDate, groups: result };
  });
};

// --- Tallene til KI ---------------------------------------------------------------------------

const MONTH_FORMAT = /^\d{4}-(0[1-9]|1[0-2])$/;

function previousMonthOf(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  return monthNumber === 1
    ? `${String(year - 1).padStart(4, "0")}-12`
    : `${String(year).padStart(4, "0")}-${String(monthNumber - 1).padStart(2, "0")}`;
}

function monthFilter(column: SQL, month: string): SQL {
  return sql`${column} >= ${osloMidnight(`${month}-01`)} and ${column} < ${osloNextMonthStart(month)}`;
}

/** Unike rapporter publisert i måneden (`released_at` i norsk tid), med myk sletting i alle ledd. */
async function monthReportCount(ex: DbExecutor, organizationId: string, month: string) {
  const [row] = rowsOf<{ n: number }>(
    await ex.execute(sql`
      select count(distinct rr.report_id)::int as n
      from report_releases rr
      join reports rep
        on rep.organization_id = rr.organization_id
        and rep.id = rr.report_id
        and rep.deleted_at is null
      join assignments a
        on a.organization_id = rep.organization_id
        and a.id = rep.assignment_id
        and a.deleted_at is null
      where rr.organization_id = ${organizationId}
        and rr.deleted_at is null
        and ${monthFilter(sql`rr.released_at`, month)}
    `),
  );
  return toNumber(row?.n ?? 0);
}

type MonthCountRow = {
  check_code: string;
  checkpoint_key: string | null;
  reason_code: string;
  report_count: number;
  claim_count: number;
  checkpoint_name: string | null;
};

/** Tellingen per (kode, punkt, grunn) for måneden, gruppert i SQL. */
async function monthOverrideCounts(organizationId: string, month: string) {
  const cte = markedLinesCte(organizationId, monthFilter(sql`rr.released_at`, month));
  return rowsOf<MonthCountRow>(
    await db.execute(sql`
      with ${cte}
      select
        m.check_code,
        m.checkpoint_key,
        m.reason_code,
        count(distinct m.report_id)::int as report_count,
        (count(distinct m.report_id) filter (where m.red))::int as claim_count,
        (array_agg(cp.name order by m.released_at desc) filter (where cp.name is not null))[1]
          as checkpoint_name
      from marked m
      left join checkpoints cp
        on cp.organization_id = ${organizationId}
        and cp.version_id = m.template_version_id
        and cp.key = m.checkpoint_key
        and cp.deleted_at is null
      group by m.check_code, m.checkpoint_key, m.reason_code
    `),
  );
}

/** Se `BuildOverrideStats`. Kalles bare etter tilgangssjekken. */
export const buildOverrideStats: BuildOverrideStats = async (grant, month) => {
  if (!MONTH_FORMAT.test(month)) throw new ReportValidationError("invalid_input");
  const orgId = grant.organizationId;
  const previous = previousMonthOf(month);
  const [reportCount, previousReportCount, current, before] = await Promise.all([
    monthReportCount(db, orgId, month),
    monthReportCount(db, orgId, previous),
    monthOverrideCounts(orgId, month),
    monthOverrideCounts(orgId, previous),
  ]);
  const rows = new Map<string, OverrideCountRow>();
  const keyOf = (row: MonthCountRow) =>
    reasonKey(row.check_code, row.checkpoint_key, row.reason_code);
  for (const row of current) {
    rows.set(keyOf(row), {
      checkCode: row.check_code,
      checkpointKey: row.checkpoint_key,
      checkpointName: row.checkpoint_name,
      reasonCode: row.reason_code,
      count: toNumber(row.report_count),
      claimCount: toNumber(row.claim_count),
      previousCount: 0,
    });
  }
  for (const row of before) {
    const existing = rows.get(keyOf(row));
    if (existing) {
      existing.previousCount = toNumber(row.report_count);
      if (!existing.checkpointName) existing.checkpointName = row.checkpoint_name;
    } else {
      // Fantes måneden før, men ikke nå: med som «ned fra n til 0»
      rows.set(keyOf(row), {
        checkCode: row.check_code,
        checkpointKey: row.checkpoint_key,
        checkpointName: row.checkpoint_name,
        reasonCode: row.reason_code,
        count: 0,
        claimCount: 0,
        previousCount: toNumber(row.report_count),
      });
    }
  }
  return buildOverrideSummaryInput({
    month,
    reportCount,
    previousReportCount,
    rows: [...rows.values()],
  });
};

// --- Månedsoppsummeringen ---------------------------------------------------------------------

/** Lederens tekst kan ikke lagres (A574). Koden står i `issue`; teksten står aldri i feilen. */
export class OverrideSummaryTextError extends ReportValidationError {
  readonly issue: OverrideSummaryTextIssue;
  constructor(issue: OverrideSummaryTextIssue) {
    super("invalid_input", OVERRIDE_SUMMARY_TEXT_MESSAGES[issue]);
    this.name = "OverrideSummaryTextError";
    this.issue = issue;
  }
}

/** Måneden må være en av de fire som kan velges nå (A577). Alt annet gir samme feil. */
function requireSummaryMonth(month: unknown): string {
  if (!isOverrideSummaryMonth(month, new Date())) throw new ReportValidationError("invalid_input");
  return month;
}

function summaryTarget(rowId: string): AiTargetRef {
  return { type: OVERRIDE_SUMMARY_TARGET_TYPE, id: rowId, fieldKey: OVERRIDE_SUMMARY_FIELD_KEY };
}

async function findSummaryRow(
  ex: DbExecutor,
  organizationId: string,
  month: string,
  lock = false,
): Promise<OverrideSummaryRow | undefined> {
  const query = ex
    .select()
    .from(overrideSummaries)
    .where(
      and(
        eq(overrideSummaries.organizationId, organizationId),
        eq(overrideSummaries.month, month),
        isNull(overrideSummaries.deletedAt),
      ),
    );
  const [row] = lock ? await query.for("update") : await query;
  return row;
}

/** Henter raden for måneden, eller lager den (`empty`). Den unike indeksen avgjør ved samtidige trykk. */
async function ensureSummaryRow(
  ex: DbExecutor,
  grant: EmployeeGrant,
  month: string,
  lock = false,
): Promise<{ row: OverrideSummaryRow; created: boolean }> {
  const existing = await findSummaryRow(ex, grant.organizationId, month, lock);
  if (existing) return { row: existing, created: false };
  const [inserted] = await ex
    .insert(overrideSummaries)
    .values({ organizationId: grant.organizationId, month, createdBy: grant.employeeId })
    .onConflictDoNothing({
      target: [overrideSummaries.organizationId, overrideSummaries.month],
      where: sql`${overrideSummaries.deletedAt} is null`,
    })
    .returning();
  if (inserted) {
    await recordAuditEvent(ex, grant, {
      entityType: "override_summary",
      entityId: inserted.id,
      action: "create",
      changes: { month, status: inserted.status },
    });
    return { row: inserted, created: true };
  }
  const raced = await findSummaryRow(ex, grant.organizationId, month, lock);
  if (!raced) throw new AccessDeniedError();
  return { row: raced, created: false };
}

/** Forslaget som venter på beslutning for raden, uansett hvem som ba om det. */
async function openSuggestionOf(
  ex: DbExecutor,
  organizationId: string,
  rowId: string,
): Promise<{ usageId: string; text: string } | null> {
  const [open] = await ex
    .select({ id: aiUsageLog.id, outputText: aiUsageLog.outputText })
    .from(aiUsageLog)
    .where(
      and(
        eq(aiUsageLog.organizationId, organizationId),
        eq(aiUsageLog.feature, OVERRIDE_SUMMARY_FEATURE),
        sql`${aiUsageLog.targetRef} = ${JSON.stringify(summaryTarget(rowId))}::jsonb`,
        eq(aiUsageLog.outcome, "ok"),
        eq(aiUsageLog.status, "suggested"),
        isNull(aiUsageLog.deletedAt),
      ),
    )
    .orderBy(sql`${aiUsageLog.createdAt} desc`)
    .limit(1);
  return open && open.outputText !== null ? { usageId: open.id, text: open.outputText } : null;
}

async function summaryView(
  ex: DbExecutor,
  grant: EmployeeGrant,
  month: string,
): Promise<OverrideSummaryView> {
  const [row, reportCount] = await Promise.all([
    findSummaryRow(ex, grant.organizationId, month),
    monthReportCount(ex, grant.organizationId, month),
  ]);
  return {
    month,
    id: row?.id ?? null,
    status: row?.status ?? "empty",
    source: row?.source ?? null,
    text: row?.text ?? null,
    rowVersion: row?.rowVersion ?? 0,
    openSuggestion: row ? await openSuggestionOf(ex, grant.organizationId, row.id) : null,
    reportCount,
    canDecide: grantHasPermission(grant, "claims.manage"),
  };
}

/** Se `GetOverrideSummary`. Lager aldri raden. */
export const getOverrideSummary: GetOverrideSummary = async (actor, organizationId, month) => {
  const grant = await requireOrganizationAccess(actor, organizationId, "claims.read");
  const valid = requireSummaryMonth(month);
  return guardReportErrors("override_summary_read", () => summaryView(db, grant, valid));
};

/**
 * Antall forespørsler om oppsummering fra den ansatte siste time og fra organisasjonen siste døgn
 * (A575). Tidene regnes fra serverens klokke, samme klokke som setter `created_at` i loggen.
 */
async function recentRequestCounts(grant: EmployeeGrant) {
  const now = Date.now();
  const hourAgo = new Date(now - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const [row] = rowsOf<{ employee_hour: number; organization_day: number }>(
    await db.execute(sql`
      select
        (count(*) filter (
          where employee_id = ${grant.employeeId} and created_at > ${hourAgo}::timestamptz
        ))::int as employee_hour,
        count(*)::int as organization_day
      from ai_usage_log
      where organization_id = ${grant.organizationId}
        and feature = ${OVERRIDE_SUMMARY_FEATURE}
        and created_at > ${dayAgo}::timestamptz
    `),
  );
  return {
    employeeHour: toNumber(row?.employee_hour ?? 0),
    organizationDay: toNumber(row?.organization_day ?? 0),
  };
}

async function usageRowExists(organizationId: string, usageId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: aiUsageLog.id })
    .from(aiUsageLog)
    .where(and(eq(aiUsageLog.organizationId, organizationId), eq(aiUsageLog.id, usageId)));
  return row !== undefined;
}

/** Se `RequestOverrideSummary`. Skriver aldri `text`. */
export const requestOverrideSummary: RequestOverrideSummary = async (
  actor,
  organizationId,
  input,
) => {
  const grant = await requireOrganizationAccess(actor, organizationId, "claims.read");
  requireUuid(input?.requestId);
  const month = requireSummaryMonth(input?.month);
  const requestId = input.requestId;
  return guardReportErrors(
    "override_summary_request",
    async (): Promise<RequestOverrideSummaryResult> => {
      const { stats, rowsCut } = await buildOverrideStats(grant, month);
      // Ingen rapporter: KI kalles ikke, og ingen rad lages
      if (stats.reportCount === 0) {
        return { status: "no_reports", summary: await summaryView(db, grant, month) };
      }

      // Ett åpent forslag per måned for hele organisasjonen
      const existing = await findSummaryRow(db, grant.organizationId, month);
      if (existing && (await openSuggestionOf(db, grant.organizationId, existing.id))) {
        return { status: "suggested", summary: await summaryView(db, grant, month) };
      }

      // Grensene (A575). Samme `requestId` på nytt går til kjernen, som gir samme svar.
      if (!(await usageRowExists(grant.organizationId, requestId))) {
        const counts = await recentRequestCounts(grant);
        if (
          counts.employeeHour >= AI_OVERRIDE_SUMMARY_MAX_PER_EMPLOYEE_PER_HOUR ||
          counts.organizationDay >= AI_OVERRIDE_SUMMARY_MAX_PER_ORGANIZATION_PER_DAY
        ) {
          logger.info("Oppsummering av overstyringer: grensen er nådd", { month });
          return { status: "rate_limited" };
        }
      }

      const { row } = await db.transaction((tx) => ensureSummaryRow(tx, grant, month));
      const result: AiSuggestionResult = await requestSuggestion(
        grant,
        {
          requestId,
          feature: OVERRIDE_SUMMARY_FEATURE,
          // Organisasjonsmål: kjernen slår opp raden selv, uten oppdrag og rapport
          assignmentId: null,
          reportId: null,
          target: summaryTarget(row.id),
          fields: {},
        },
        { overrideStats: stats, overrideStatsCut: rowsCut },
      );
      logger.info("Oppsummering av overstyringer: forespørsel", {
        summaryId: row.id,
        month,
        result: result.kind,
      });
      switch (result.kind) {
        case "suggestion":
          return { status: "suggested", summary: await summaryView(db, grant, month) };
        case "stopped":
          return { status: "stopped", guard: result.guard };
        case "disabled":
        case "blocked":
          return { status: "disabled" };
        default:
          return { status: "error" };
      }
    },
  );
};

/**
 * Loggraden for forslaget (samme kontroll som sammendraget): samme organisasjon, ikke slettet,
 * funksjonen `override_summary` og målet akkurat denne raden. Ellers 404, samme svar som ukjent id.
 */
async function requireSummaryUsageRow(
  ex: DbExecutor,
  organizationId: string,
  rowId: string,
  usageId: string,
): Promise<{ outputText: string | null }> {
  const [row] = await ex
    .select({
      feature: aiUsageLog.feature,
      targetRef: aiUsageLog.targetRef,
      outputText: aiUsageLog.outputText,
    })
    .from(aiUsageLog)
    .where(
      and(
        eq(aiUsageLog.organizationId, organizationId),
        eq(aiUsageLog.id, usageId),
        isNull(aiUsageLog.deletedAt),
      ),
    );
  if (
    !row ||
    row.feature !== OVERRIDE_SUMMARY_FEATURE ||
    row.targetRef?.type !== OVERRIDE_SUMMARY_TARGET_TYPE ||
    row.targetRef.id !== rowId ||
    row.targetRef.fieldKey !== OVERRIDE_SUMMARY_FIELD_KEY
  ) {
    throw new AccessDeniedError();
  }
  return { outputText: row.outputText };
}

/** Navnene på alle ansatte i organisasjonen, også de som har sluttet (A574). */
async function employeeNamesOf(ex: DbExecutor, organizationId: string): Promise<string[]> {
  const rows = await ex
    .select({ name: employees.name })
    .from(employees)
    .where(eq(employees.organizationId, organizationId));
  return rows.map((row) => row.name);
}

/** Kontrollen av teksten (A574). Feil gir koden, aldri teksten. */
async function requireValidText(
  ex: DbExecutor,
  organizationId: string,
  text: unknown,
): Promise<string> {
  if (typeof text !== "string") throw new OverrideSummaryTextError("empty");
  const issue = validateSummaryText(text, await employeeNamesOf(ex, organizationId));
  if (issue) throw new OverrideSummaryTextError(issue);
  return text.trim();
}

function requireRowVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ReportValidationError("invalid_input");
  }
  return value;
}

async function auditSummary(ex: DbExecutor, grant: EmployeeGrant, row: OverrideSummaryRow) {
  // Bare id, måned og status; aldri teksten
  await recordAuditEvent(ex, grant, {
    entityType: "override_summary",
    entityId: row.id,
    action: "update",
    changes: { month: row.month, status: row.status },
  });
  logger.info("Oppsummering av overstyringer: lagret", {
    summaryId: row.id,
    month: row.month,
    status: row.status,
  });
}

async function updateSummaryRow(
  ex: DbExecutor,
  grant: EmployeeGrant,
  row: OverrideSummaryRow,
  values: Pick<OverrideSummaryRow, "text" | "status" | "source" | "aiUsageLogId"> & {
    decided: boolean;
  },
): Promise<void> {
  const [updated] = await ex
    .update(overrideSummaries)
    .set({
      text: values.text,
      status: values.status,
      source: values.source,
      aiUsageLogId: values.aiUsageLogId,
      decidedBy: values.decided ? grant.employeeId : null,
      decidedAt: values.decided ? new Date() : null,
      updatedBy: grant.employeeId,
    })
    .where(
      and(
        eq(overrideSummaries.organizationId, grant.organizationId),
        eq(overrideSummaries.id, row.id),
      ),
    )
    .returning();
  if (!updated) throw new AccessDeniedError();
  await auditSummary(ex, grant, updated);
}

/** Se `DecideOverrideSummary`. Raden låses først, så tar `recordDecisionIn` KI-låsen. */
export const decideOverrideSummary: DecideOverrideSummary = async (
  actor,
  organizationId,
  input,
) => {
  const grant = await requireOrganizationAccess(actor, organizationId, "claims.manage");
  requireUuid(input?.usageId);
  const month = requireSummaryMonth(input?.month);
  const baseRowVersion = requireRowVersion(input?.baseRowVersion);
  const decision = input?.decision;
  if (decision !== "accepted" && decision !== "rejected" && decision !== "undo") {
    throw new ReportValidationError("invalid_input");
  }
  const usageId = input.usageId;
  return guardReportErrors(
    "override_summary_decide",
    async (): Promise<OverrideSummaryWriteResult> => {
      const conflict = await db.transaction(async (tx) => {
        const row = await findSummaryRow(tx, grant.organizationId, month, true);
        // Uten rad finnes det ikke noe forslag for måneden
        if (!row) throw new AccessDeniedError();
        const usage = await requireSummaryUsageRow(tx, grant.organizationId, row.id, usageId);
        if (row.rowVersion !== baseRowVersion) return true;

        if (decision === "accepted") {
          const text = usage.outputText;
          if (text === null) throw new ReportValidationError("invalid_input");
          if (containsPiiPlaceholder(text)) throw new ReportValidationError("text_has_placeholder");
          const checked = await requireValidText(tx, grant.organizationId, text);
          await recordDecisionIn(tx, grant, usageId, "accepted");
          await updateSummaryRow(tx, grant, row, {
            text: checked,
            status: "accepted",
            source: "ai",
            aiUsageLogId: usageId,
            decided: true,
          });
        } else if (decision === "rejected") {
          await recordDecisionIn(tx, grant, usageId, "rejected");
          // Teksten som gjelder, forsvinner ikke fordi et nytt forslag avvises
          if (row.aiUsageLogId === usageId || row.text === null) {
            await updateSummaryRow(tx, grant, row, {
              text: null,
              status: "rejected",
              source: "ai",
              aiUsageLogId: usageId,
              decided: true,
            });
          }
        } else {
          await recordDecisionIn(tx, grant, usageId, "undo");
          if (row.aiUsageLogId === usageId) {
            await updateSummaryRow(tx, grant, row, {
              text: null,
              status: "empty",
              source: null,
              aiUsageLogId: null,
              decided: false,
            });
          }
        }
        return false;
      });
      const summary = await summaryView(db, grant, month);
      return conflict ? { status: "conflict", summary } : { status: "saved", summary };
    },
  );
};

/** Se `SaveOverrideSummary`. Samme låserekkefølge som `decideOverrideSummary`. */
export const saveOverrideSummary: SaveOverrideSummary = async (actor, organizationId, input) => {
  const grant = await requireOrganizationAccess(actor, organizationId, "claims.manage");
  const usageId = input?.usageId;
  if (usageId !== undefined && (typeof usageId !== "string" || !isUuid(usageId))) {
    throw new AccessDeniedError();
  }
  const month = requireSummaryMonth(input?.month);
  const baseRowVersion = requireRowVersion(input?.baseRowVersion);
  return guardReportErrors(
    "override_summary_save",
    async (): Promise<OverrideSummaryWriteResult> => {
      const text = await requireValidText(db, grant.organizationId, input?.text);
      const conflict = await db.transaction(async (tx) => {
        const { row, created } = await ensureSummaryRow(tx, grant, month, true);
        const expected = created ? 0 : row.rowVersion;
        if (baseRowVersion !== expected && baseRowVersion !== row.rowVersion) return true;

        if (usageId !== undefined) {
          await requireSummaryUsageRow(tx, grant.organizationId, row.id, usageId);
          await recordDecisionIn(tx, grant, usageId, "edited");
          await updateSummaryRow(tx, grant, row, {
            text,
            status: "edited",
            source: "ai",
            aiUsageLogId: usageId,
            decided: true,
          });
        } else if (
          (row.status === "accepted" || row.status === "edited") &&
          row.aiUsageLogId !== null
        ) {
          // Endrer en tekst som bygger på KI: loggraden røres ikke
          await updateSummaryRow(tx, grant, row, {
            text,
            status: "edited",
            source: "ai",
            aiUsageLogId: row.aiUsageLogId,
            decided: true,
          });
        } else {
          await updateSummaryRow(tx, grant, row, {
            text,
            status: "manual",
            source: "manual",
            aiUsageLogId: null,
            decided: true,
          });
        }
        return false;
      });
      const summary = await summaryView(db, grant, month);
      return conflict ? { status: "conflict", summary } : { status: "saved", summary };
    },
  );
};
