import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { and, count, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/** Tvunget feil midt i publiseringen (I2): hendelsen skrives etter utgivelsen og sjekkradene. */
const failEvents = vi.hoisted(() => ({ on: false }));
vi.mock("@/core/events", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/core/events")>();
  return {
    ...original,
    recordEvent: async (...args: Parameters<typeof original.recordEvent>) => {
      if (failEvents.on) throw new Error("tvunget feil i testen");
      return original.recordEvent(...args);
    },
  };
});

import {
  AccessDeniedError,
  canSeeOverrideReasons,
  requireOrganizationAccess,
  type Actor,
  type EmployeeGrant,
} from "@/core/access";
import { findValidCertification } from "@/core/organization";
import {
  getPublishCheck,
  isReportPublishedForAssignment,
  listPendingAiSuggestions,
  listReleases,
  publishReport,
  ReportStorageError,
  ReportValidationError,
  setTgDirect,
  startNewVersion,
  type PublishCheckView,
  type PublishOverrideInput,
} from "@/core/reports";
import { canonicalJson } from "@/core/reports/logic/publish-check";
import { db } from "@/db/client";
import {
  aiUsageLog,
  assignments,
  auditLog,
  checkpointResults,
  events,
  publishCheckResults,
  reportReleases,
  reports,
  rooms,
  type EmployeeRole,
} from "@/db/schema";
import { addDays, todayInOslo } from "@/shared/lib/dates";
import { logger } from "@/shared/lib/logger";
import {
  createAiUsageLog,
  createAssignmentParty,
  createCertification,
  createClaim,
  createCompany,
  grantPermission,
  resetDatabase,
} from "../../../tests/factories";
import {
  answerHole,
  CP,
  createStaff,
  startedBathroom,
  type BathroomFixture,
} from "../../../tests/report-fixtures";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { oneYearAfter, snapshotContentHash, tenYearsAfter } from "./publish";

/*
 * Publiseringstjenesten (docs/funksjoner/fase2a-publisering-badet.md Omfang 7–9 og 11–13,
 * testplanen avsnitt 4 og 5): sjekk, publiser, ny versjon og utgivelser mot testdatabasen. Alle
 * data er oppdiktede.
 */

const ALL_CHECKPOINTS = [
  "wet_room.general",
  "wet_room.documentation",
  "wet_room.walls_ceiling",
  "wet_room.floor",
  "wet_room.membrane_drain",
  "wet_room.fixtures",
  "wet_room.ventilation",
  "wet_room.adjacent",
] as const;

/** Unikt merke i begrunnelsen, så testene kan lete etter det i logg, hendelser og revisjonslogg. */
const REASON_MARKER = "Merke-7Q4Z sjekket i kjeller";

type Fixture = BathroomFixture & { reportId: string; companyId: string };

/**
 * Et bad som kan publiseres: selskap på oppdraget, sertifisert takstmann, hull tatt med måling,
 * og TG1 på alle punktene unntatt dem i `skip` (hvert av dem gir sperren `mandatory_without_tg`).
 */
async function publishableBathroom(
  options: {
    skip?: readonly string[];
    inspectionAt?: Date | null;
    organizationId?: string;
    certified?: boolean;
    roles?: EmployeeRole[];
    /** `null` gir hull uten måling (advarselen `hole_reading_missing`). */
    holeReading?: number | null;
  } = {},
): Promise<Fixture> {
  const f = await startedBathroom({
    organizationId: options.organizationId,
    inspectionAt: options.inspectionAt,
    roles: options.roles,
  });
  const company = await createCompany(f.organizationId);
  await db
    .update(assignments)
    .set({ companyId: company.id })
    .where(eq(assignments.id, f.assignmentId));
  if (options.certified !== false) {
    await createCertification({ id: f.employeeId, organizationId: f.organizationId });
  }
  if (options.holeReading === null) await answerHole(f, "done_no_findings");
  else await answerHole(f, "done_no_findings", options.holeReading ?? 10);
  for (const checkpointKey of ALL_CHECKPOINTS) {
    if (options.skip?.includes(checkpointKey)) continue;
    await setTgDirect(f.actor, f.organizationId, f.room, {
      checkpointKey,
      tgDirect: "1",
      base: null,
    });
  }
  return { ...f, companyId: company.id };
}

async function draftCheck(actor: Actor, organizationId: string, assignmentId: string) {
  const view = await getPublishCheck(actor, organizationId, assignmentId);
  if (view.state !== "draft") throw new Error(`sjekken er ${view.state}, ikke draft`);
  return view;
}

function blockerKeys(view: Extract<PublishCheckView, { state: "draft" }>) {
  return view.findings.filter((f) => f.severity === "blocker").map((f) => f.key);
}

function overrideAll(
  view: Extract<PublishCheckView, { state: "draft" }>,
  text: string | null = null,
): PublishOverrideInput[] {
  return blockerKeys(view).map((findingKey) => ({
    findingKey,
    reasonCode: text ? "other" : "described_elsewhere",
    text,
  }));
}

/** Publiserer med alle sperrer krysset bort. */
async function publishAll(f: Fixture, actor: Actor = f.actor, text: string | null = null) {
  const view = await draftCheck(actor, f.organizationId, f.assignmentId);
  return publishReport(actor, f.organizationId, {
    assignmentId: f.assignmentId,
    fingerprint: view.fingerprint,
    overrides: overrideAll(view, text),
  });
}

async function tableCount(
  table:
    | typeof publishCheckResults
    | typeof reportReleases
    | typeof auditLog
    | typeof events
    | typeof aiUsageLog,
  organizationId: string,
) {
  const [row] = await db
    .select({ total: count() })
    .from(table)
    .where(eq(table.organizationId, organizationId));
  return Number(row?.total ?? 0);
}

async function reportStatus(reportId: string) {
  const [row] = await db
    .select({ status: reports.status })
    .from(reports)
    .where(eq(reports.id, reportId));
  return row?.status;
}

async function expectValidationError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ReportValidationError);
  expect((error as ReportValidationError).code).toBe(code);
}

beforeEach(async () => {
  await resetDatabase();
  failEvents.on = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Rene hjelpere ---------------------------------------------------------------------------

describe("datoer og fingeravtrykk", () => {
  it.each([
    ["2026-02-28", "2027-02-28"],
    ["2028-02-29", "2029-02-28"],
    ["2026-06-15", "2027-06-15"],
    ["2026-12-31", "2027-12-31"],
  ])("gyldig til: %s gir %s", (date, expected) => {
    expect(oneYearAfter(date)).toBe(expected);
  });

  it("oppbevaring er ti år etter utgivelsen", () => {
    expect(tenYearsAfter(new Date("2026-11-17T10:00:00Z")).toISOString()).toBe(
      "2036-11-17T10:00:00.000Z",
    );
    expect(todayInOslo(tenYearsAfter(new Date("2028-02-29T10:00:00Z")))).toBe("2038-02-28");
  });

  it("content_hash er lik uansett nøkkelrekkefølge", () => {
    const a = { schema_version: 1, report: { b: 1, a: 2 }, buildings: [] } as never;
    const b = { buildings: [], report: { a: 2, b: 1 }, schema_version: 1 } as never;
    expect(snapshotContentHash(a)).toBe(snapshotContentHash(b));
  });
});

describe("canSeeOverrideReasons (I16)", () => {
  const grant = (roles: EmployeeGrant["roles"]): EmployeeGrant => ({
    employeeId: "x",
    organizationId: "y",
    roles,
    permissions: [],
  });
  it.each([
    [["inspector"], true],
    [["manager"], true],
    [["admin"], true],
    [["office"], false],
    [["office", "admin"], true],
    [[], false],
  ] as const)("%j gir %s", (roles, expected) => {
    expect(canSeeOverrideReasons(grant(roles as unknown as EmployeeGrant["roles"]))).toBe(expected);
  });
});

// --- Sjekken ----------------------------------------------------------------------------------

describe("getPublishCheck", () => {
  it("er ren lesing: ingen rader i sjekkradene, revisjonsloggen eller hendelsene", async () => {
    const f = await publishableBathroom({ skip: [CP.general] });
    const before = await Promise.all(
      [publishCheckResults, auditLog, events].map((t) => tableCount(t, f.organizationId)),
    );
    const first = await draftCheck(f.actor, f.organizationId, f.assignmentId);
    const second = await draftCheck(f.actor, f.organizationId, f.assignmentId);
    const after = await Promise.all(
      [publishCheckResults, auditLog, events].map((t) => tableCount(t, f.organizationId)),
    );
    expect(after).toEqual(before);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(first.hasWetRoom).toBe(true);
    expect(first.nextVersionNumber).toBe(1);
    expect(first.summary.blockers).toBe(1);
    const blocker = first.findings.find((x) => x.severity === "blocker");
    expect(blocker?.checkCode).toBe("mandatory_without_tg");
    expect(blocker?.target.checkpointKey).toBe(CP.general);
    // «Gå til» bygges på serveren fra id-er
    expect(blocker?.href).toBe(
      `/oppdrag/${f.assignmentId}/rom/${f.roomId}?punkt=${encodeURIComponent(CP.general)}&fra=publiser`,
    );
    expect(blocker?.checkpointLabel).toBe("Generelt");
    expect(first.ability).toMatchObject({ allowed: true });
    expect(first.canEdit).toBe(true);
    expect(first.preview).toHaveLength(1);
    expect(first.preview[0]?.tgCounts).toMatchObject({ "1": 7, none: 1 });
  });

  it("uten rapport er svaret «ikke startet»", async () => {
    const f = await publishableBathroom();
    await db.update(reports).set({ deletedAt: new Date() }).where(eq(reports.id, f.reportId));
    expect(await getPublishCheck(f.actor, f.organizationId, f.assignmentId)).toEqual({
      state: "not_started",
    });
  });

  it("ugyldig, fremmed og slettet oppdrag gir 404", async () => {
    const f = await publishableBathroom();
    await expect(getPublishCheck(f.actor, f.organizationId, "ikke-en-id")).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    await db
      .update(assignments)
      .set({ deletedAt: new Date() })
      .where(eq(assignments.id, f.assignmentId));
    await expect(getPublishCheck(f.actor, f.organizationId, f.assignmentId)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
  });
});

// --- Publisering ------------------------------------------------------------------------------

describe("publishReport", () => {
  it("I1 sperre som ikke er krysset bort: ingen utgivelse, rapporten er under arbeid", async () => {
    const f = await publishableBathroom({ skip: [CP.general] });
    const view = await draftCheck(f.actor, f.organizationId, f.assignmentId);
    const result = await publishReport(f.actor, f.organizationId, {
      assignmentId: f.assignmentId,
      fingerprint: view.fingerprint,
      overrides: [],
    });
    expect(result).toEqual({ status: "blockers_remaining", remaining: blockerKeys(view) });
    expect(await tableCount(reportReleases, f.organizationId)).toBe(0);
    expect(await reportStatus(f.reportId)).toBe("draft");
  });

  it("I1 utdatert eller manglende fingeravtrykk gir den nye listen, ikke feil", async () => {
    const f = await publishableBathroom({ skip: [CP.general] });
    const view = await draftCheck(f.actor, f.organizationId, f.assignmentId);
    // Listen endres: et nytt punkt mangler TG
    await setTgDirect(f.actor, f.organizationId, f.room, {
      checkpointKey: CP.floor,
      tgDirect: null,
      base: "1",
    });
    for (const fingerprint of [view.fingerprint, null]) {
      const result = await publishReport(f.actor, f.organizationId, {
        assignmentId: f.assignmentId,
        fingerprint,
        overrides: overrideAll(view),
      });
      expect(result.status).toBe("check_changed");
      if (result.status !== "check_changed") return;
      expect(result.check.summary.blockers).toBe(2);
      expect(result.check.fingerprint).not.toBe(view.fingerprint);
    }
    expect(await tableCount(reportReleases, f.organizationId)).toBe(0);
    expect(await tableCount(publishCheckResults, f.organizationId)).toBe(0);
  });

  it.each([
    ["advarsel", "warning"],
    ["ukjent nøkkel", "unknown"],
    ["samme sperre to ganger", "duplicate"],
    ["ugyldig grunn", "bad_reason"],
    ["«Annet» uten tekst", "other_without_text"],
  ])("overstyring med %s avvises, ingenting lagres", async (_label, variant) => {
    const f = await publishableBathroom({
      skip: [CP.general],
      inspectionAt: null,
      holeReading: null,
    });
    const view = await draftCheck(f.actor, f.organizationId, f.assignmentId);
    const valid = overrideAll(view);
    const warning = view.findings.find((x) => x.severity === "warning");
    const overrides: PublishOverrideInput[] =
      variant === "warning"
        ? [...valid, { findingKey: warning?.key ?? "x", reasonCode: "described_elsewhere" }]
        : variant === "unknown"
          ? [
              ...valid,
              {
                findingKey: '{"checkCode":"tg3_missing_cost"}',
                reasonCode: "other",
                text: "Lang nok begrunnelse",
              },
            ]
          : variant === "duplicate"
            ? [...valid, valid[0]!]
            : variant === "bad_reason"
              ? valid.map((o) => ({ ...o, reasonCode: "no_such_code" as never }))
              : valid.map((o) => ({ ...o, reasonCode: "other" as const, text: "  " }));
    if (variant === "warning") expect(warning).toBeDefined();
    await expectValidationError(
      publishReport(f.actor, f.organizationId, {
        assignmentId: f.assignmentId,
        fingerprint: view.fingerprint,
        overrides,
      }),
      "publish_override",
    );
    expect(await tableCount(reportReleases, f.organizationId)).toBe(0);
    expect(await reportStatus(f.reportId)).toBe("draft");
  });

  it("vellykket publisering: utgivelse v1, snapshot, sjekkrader for alle funn, hendelser", async () => {
    const f = await publishableBathroom({ skip: [CP.general] });
    const view = await draftCheck(f.actor, f.organizationId, f.assignmentId);
    const loggerCalls: unknown[] = [];
    for (const level of ["info", "warn", "error", "debug"] as const) {
      vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
        loggerCalls.push(args);
      });
    }
    const result = await publishReport(f.actor, f.organizationId, {
      assignmentId: f.assignmentId,
      fingerprint: view.fingerprint,
      overrides: overrideAll(view, REASON_MARKER),
      // Felt klienten ikke styrer, ignoreres
      ...({ reportId: "00000000-0000-0000-0000-000000000000", versionNumber: 9 } as object),
    });
    expect(result).toMatchObject({
      status: "published",
      versionNumber: 1,
      validUntil: "2027-06-15",
    });
    if (result.status !== "published") return;

    const [release] = await db
      .select()
      .from(reportReleases)
      .where(eq(reportReleases.id, result.releaseId));
    expect(release).toBeDefined();
    if (!release) return;
    expect(release.reportId).toBe(f.reportId);
    expect(release.versionNumber).toBe(1);
    expect(release.releasedBy).toBe(f.employeeId);
    expect(release.signedByEmployeeId).toBe(f.employeeId);
    expect(release.companyId).toBe(f.companyId);
    expect(release.originalReleaseDate).toBe(todayInOslo());
    expect(release.validUntil).toBe("2027-06-15");
    expect(release.retainUntil.toISOString()).toBe(tenYearsAfter(release.releasedAt).toISOString());
    expect(release.contentHash).toBe(
      createHash("sha256").update(canonicalJson(release.snapshot)).digest("hex"),
    );
    const snapshot = release.snapshot as {
      schema_version: number;
      report: Record<string, unknown>;
      buildings: { floors: { rooms: { room_id: string; checkpoints: unknown[] }[] }[] }[];
    };
    expect(snapshot.schema_version).toBe(1);
    expect(snapshot.report).toMatchObject({
      report_id: f.reportId,
      template_version_id: f.templateVersionId,
      inspection_date: "2026-06-15",
    });
    const room = snapshot.buildings[0]?.floors[0]?.rooms[0];
    expect(room?.room_id).toBe(f.roomId);
    expect(room?.checkpoints).toHaveLength(8);

    const checkRows = await db
      .select()
      .from(publishCheckResults)
      .where(eq(publishCheckResults.releaseId, release.id));
    expect(checkRows).toHaveLength(view.findings.length);
    const blockerRow = checkRows.find((r) => r.severity === "blocker");
    expect(blockerRow).toMatchObject({
      overridden: true,
      overriddenBy: f.employeeId,
      overrideReasonCode: "other",
      overrideReason: REASON_MARKER,
    });
    expect(checkRows.filter((r) => r.severity === "warning").every((r) => !r.overridden)).toBe(
      true,
    );
    expect(await reportStatus(f.reportId)).toBe("published");

    const eventRows = await db
      .select()
      .from(events)
      .where(eq(events.organizationId, f.organizationId));
    const types = eventRows.map((e) => e.type).filter((t) => t.startsWith("report."));
    expect(types.sort()).toEqual(["report.publish_override", "report.published"]);
    const override = eventRows.find((e) => e.type === "report.publish_override");
    expect(override?.data).toMatchObject({
      releaseId: release.id,
      versionNumber: 1,
      checkResultId: blockerRow?.id,
      checkCode: "mandatory_without_tg",
      reasonCode: "other",
    });

    // I12: begrunnelsen står bare i sjekkraden
    const auditJson = JSON.stringify(
      await db.select().from(auditLog).where(eq(auditLog.organizationId, f.organizationId)),
    );
    expect(auditJson).not.toContain("Merke-7Q4Z");
    expect(JSON.stringify(eventRows)).not.toContain("Merke-7Q4Z");
    expect(JSON.stringify(loggerCalls)).not.toContain("Merke-7Q4Z");
    expect(JSON.stringify(loggerCalls)).not.toContain(release.contentHash);
    expect(JSON.stringify(release.snapshot)).not.toContain("Merke-7Q4Z");
  });

  it("I4 publisert rapport kan ikke publiseres igjen", async () => {
    const f = await publishableBathroom();
    const view = await draftCheck(f.actor, f.organizationId, f.assignmentId);
    await publishReport(f.actor, f.organizationId, {
      assignmentId: f.assignmentId,
      fingerprint: view.fingerprint,
      overrides: [],
    });
    await expectValidationError(
      publishReport(f.actor, f.organizationId, {
        assignmentId: f.assignmentId,
        fingerprint: view.fingerprint,
        overrides: [],
      }),
      "report_published",
    );
    expect(await tableCount(reportReleases, f.organizationId)).toBe(1);
    expect(await getPublishCheck(f.actor, f.organizationId, f.assignmentId)).toMatchObject({
      state: "published",
      versionNumber: 1,
      canStartNewVersion: true,
    });
  });

  it("I3 to samtidige publiseringer gir én utgivelse", async () => {
    const f = await publishableBathroom();
    const view = await draftCheck(f.actor, f.organizationId, f.assignmentId);
    const input = { assignmentId: f.assignmentId, fingerprint: view.fingerprint, overrides: [] };
    const results = await Promise.allSettled([
      publishReport(f.actor, f.organizationId, input),
      publishReport(f.actor, f.organizationId, input),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason as ReportValidationError;
    expect(reason).toBeInstanceOf(ReportValidationError);
    expect(reason.code).toBe("report_published");
    expect(reason.message).toBe("Rapporten er publisert. Lag ny versjon for å rette.");
    expect(await tableCount(reportReleases, f.organizationId)).toBe(1);
  });

  it("I2 tvunget feil midt i publiseringen lagrer ingenting", async () => {
    const f = await publishableBathroom({ skip: [CP.general] });
    const view = await draftCheck(f.actor, f.organizationId, f.assignmentId);
    const auditBefore = await tableCount(auditLog, f.organizationId);
    vi.spyOn(logger, "error").mockImplementation(() => undefined);
    failEvents.on = true;
    await expect(
      publishReport(f.actor, f.organizationId, {
        assignmentId: f.assignmentId,
        fingerprint: view.fingerprint,
        overrides: overrideAll(view),
      }),
    ).rejects.toBeInstanceOf(ReportStorageError);
    failEvents.on = false;
    expect(await tableCount(reportReleases, f.organizationId)).toBe(0);
    expect(await tableCount(publishCheckResults, f.organizationId)).toBe(0);
    expect(await tableCount(events, f.organizationId)).toBe(0);
    expect(await tableCount(auditLog, f.organizationId)).toBe(auditBefore);
    expect(await reportStatus(f.reportId)).toBe("draft");
  });

  it("I15 uten våtrom, også når badet er slettet, avvises uten mulighet for overstyring", async () => {
    const f = await publishableBathroom();
    await db.update(rooms).set({ deletedAt: new Date() }).where(eq(rooms.id, f.roomId));
    const view = await draftCheck(f.actor, f.organizationId, f.assignmentId);
    expect(view.hasWetRoom).toBe(false);
    await expectValidationError(
      publishReport(f.actor, f.organizationId, {
        assignmentId: f.assignmentId,
        fingerprint: view.fingerprint,
        overrides: [],
      }),
      "no_wet_room",
    );
    expect(await tableCount(reportReleases, f.organizationId)).toBe(0);
  });

  it("oppdrag uten selskap avvises", async () => {
    const f = await publishableBathroom();
    await db.update(assignments).set({ companyId: null }).where(eq(assignments.id, f.assignmentId));
    await expectValidationError(publishAll(f), "company_missing");
  });

  it("I13 uten befaringsdato: sperre, og krysset bort gir tom «gyldig til»", async () => {
    const f = await publishableBathroom({ inspectionAt: null });
    const view = await draftCheck(f.actor, f.organizationId, f.assignmentId);
    const dateFinding = view.findings.find((x) => x.checkCode === "inspection_date_missing");
    expect(dateFinding).toMatchObject({ severity: "blocker", href: null });
    const result = await publishAll(f);
    expect(result).toMatchObject({ status: "published", validUntil: null });
    const [release] = await db.select().from(reportReleases);
    expect(release?.validUntil).toBeNull();
    expect(
      (release?.snapshot as { report: { inspection_date: unknown } }).report.inspection_date,
    ).toBeNull();
  });

  it("sertifisering: gikk ut i går avvises, utløpsdagen i dag godtas, lengst gyldig velges", async () => {
    const today = todayInOslo();
    const f = await publishableBathroom({ certified: false });
    const employee = { id: f.employeeId, organizationId: f.organizationId };
    await createCertification(employee, { validFrom: null, validTo: addDays(today, -1) });
    await expectValidationError(publishAll(f), "certification_missing");
    const ability = (await draftCheck(f.actor, f.organizationId, f.assignmentId)).ability;
    expect(ability).toEqual({
      allowed: false,
      reason: "no_valid_certification",
      expiredOn: addDays(today, -1),
    });

    const lastDay = await createCertification(employee, { validFrom: null, validTo: today });
    expect(await findValidCertification(db, f.organizationId, f.employeeId, today)).toEqual({
      id: lastDay.id,
      validTo: today,
    });
    const longest = await createCertification(employee, { validTo: addDays(today, 400) });
    await createCertification(employee, { validTo: addDays(today, 30) });
    const result = await publishAll(f);
    expect(result.status).toBe("published");
    const [release] = await db.select().from(reportReleases);
    expect(release?.certificationId).toBe(longest.id);
  });
});

// --- Ny versjon --------------------------------------------------------------------------------

describe("startNewVersion (I6)", () => {
  it("åpner rapporten igjen uten å røre v1, og mangelen kommer tilbake som sperre", async () => {
    const f = await publishableBathroom({ skip: [CP.general] });
    const first = await publishAll(f, f.actor, REASON_MARKER);
    expect(first.status).toBe("published");
    const releasesBefore = await db.select().from(reportReleases);
    const checkRowsBefore = await db.select().from(publishCheckResults);
    // Et KI-forslag fra før utgivelsen teller ikke etter ny versjon
    const [result] = await db
      .select({ id: checkpointResults.id })
      .from(checkpointResults)
      .where(eq(checkpointResults.reportId, f.reportId));
    await createAiUsageLog(f.organizationId, {
      employeeId: f.employeeId,
      reportId: f.reportId,
      assignmentId: f.assignmentId,
      createdAt: new Date(Date.now() - 24 * 3600 * 1000),
      targetRef: { type: "checkpoint_result", id: result!.id, fieldKey: "description_text" },
    });

    expect(await startNewVersion(f.actor, f.organizationId, f.assignmentId)).toEqual({
      reportId: f.reportId,
      nextVersionNumber: 2,
    });
    expect(await reportStatus(f.reportId)).toBe("draft");
    expect(await db.select().from(reportReleases)).toEqual(releasesBefore);
    expect(await db.select().from(publishCheckResults)).toEqual(checkRowsBefore);
    const auditRows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, f.reportId), eq(auditLog.action, "new_version")));
    expect(auditRows).toHaveLength(1);

    // Samme svar på draft, uten ny revisjonsrad
    expect(await startNewVersion(f.actor, f.organizationId, f.assignmentId)).toEqual({
      reportId: f.reportId,
      nextVersionNumber: 2,
    });
    expect(
      await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entityId, f.reportId), eq(auditLog.action, "new_version"))),
    ).toHaveLength(1);

    const view = await draftCheck(f.actor, f.organizationId, f.assignmentId);
    expect(view.nextVersionNumber).toBe(2);
    expect(view.findings.some((x) => x.checkCode === "ai_suggestion_pending")).toBe(false);
    const blocker = view.findings.find((x) => x.severity === "blocker");
    expect(blocker?.previousOverride).toEqual({
      versionNumber: 1,
      reasonCode: "other",
      reason: REASON_MARKER,
    });
    // Forrige overstyring følger ikke med av seg selv
    const without = await publishReport(f.actor, f.organizationId, {
      assignmentId: f.assignmentId,
      fingerprint: view.fingerprint,
      overrides: [],
    });
    expect(without.status).toBe("blockers_remaining");

    // Befaringsdatoen endres: v2 arver datoene fra v1
    await db
      .update(assignments)
      .set({ inspectionAt: new Date("2026-09-01T10:00:00Z") })
      .where(eq(assignments.id, f.assignmentId));
    const second = await publishAll(f);
    expect(second).toMatchObject({
      status: "published",
      versionNumber: 2,
      validUntil: "2027-06-15",
    });
    const v2 = (await db.select().from(reportReleases)).find((r) => r.versionNumber === 2);
    expect(v2?.originalReleaseDate).toBe(releasesBefore[0]?.originalReleaseDate);
    expect(v2?.validUntil).toBe("2027-06-15");
    const eventTypes = (await db.select().from(events)).map((e) => e.type);
    expect(eventTypes.filter((t) => t === "report.revised")).toHaveLength(1);
    expect(eventTypes.filter((t) => t === "report.published")).toHaveLength(1);
  });
});

// --- KI (I10, I11) -------------------------------------------------------------------------------

describe("KI-forslag", () => {
  it("I10 bare ok + suggested, ikke slettet, på rapporten gir advarsel; I11 ingen nye KI-rader", async () => {
    const f = await publishableBathroom();
    const other = await publishableBathroom({ organizationId: f.organizationId });
    const [result] = await db
      .select({ id: checkpointResults.id })
      .from(checkpointResults)
      .where(eq(checkpointResults.reportId, f.reportId));
    const target = { type: "checkpoint_result", id: result!.id, fieldKey: "description_text" };
    const base = {
      employeeId: f.employeeId,
      reportId: f.reportId,
      assignmentId: f.assignmentId,
      targetRef: target,
    };
    const pending = await createAiUsageLog(f.organizationId, {
      ...base,
      outputText: "Ventende forslag 4XK9.",
    });
    await createAiUsageLog(f.organizationId, { ...base, outcome: "blocked" });
    await createAiUsageLog(f.organizationId, { ...base, outcome: "error", errorCode: "timeout" });
    await createAiUsageLog(f.organizationId, { ...base, outcome: "no_match" });
    await createAiUsageLog(f.organizationId, { ...base, deletedAt: new Date() });
    await createAiUsageLog(f.organizationId, {
      ...base,
      reportId: other.reportId,
      assignmentId: other.assignmentId,
    });
    const accepted = await createAiUsageLog(f.organizationId, {
      ...base,
      status: "accepted",
      decidedBy: f.employeeId,
      decidedAt: new Date(),
      outputText: "Godtatt forslag 9TT2.",
    });

    const view = await draftCheck(f.actor, f.organizationId, f.assignmentId);
    const aiFindings = view.findings.filter((x) => x.checkCode === "ai_suggestion_pending");
    expect(aiFindings.map((x) => x.target.aiUsageId)).toEqual([pending.id]);
    expect(aiFindings[0]).toMatchObject({ severity: "warning", source: "rule" });
    expect(view.pendingAiSuggestions).toEqual([
      expect.objectContaining({ aiUsageId: pending.id, outputText: "Ventende forslag 4XK9." }),
    ]);
    expect(
      (await listPendingAiSuggestions(f.actor, f.organizationId, f.assignmentId)).map(
        (s) => s.aiUsageId,
      ),
    ).toEqual([pending.id]);

    const aiBefore = await tableCount(aiUsageLog, f.organizationId);
    const published = await publishAll(f);
    expect(published.status).toBe("published");
    expect(await tableCount(aiUsageLog, f.organizationId)).toBe(aiBefore);

    const [release] = await db
      .select()
      .from(reportReleases)
      .where(eq(reportReleases.reportId, f.reportId));
    const json = JSON.stringify(release?.snapshot);
    expect(json).not.toContain("4XK9");
    expect(json).not.toContain("9TT2");
    const general = (
      release?.snapshot as {
        buildings: {
          floors: {
            rooms: { checkpoints: { checkpoint_key: string; description_ai: unknown }[] }[];
          }[];
        }[];
      }
    ).buildings[0]?.floors[0]?.rooms[0]?.checkpoints.find((c) => c.checkpoint_key === CP.general);
    expect(general?.description_ai).toEqual({ ai_usage_id: accepted.id, status: "accepted" });
  });

  it("publiseringstjenesten importerer ikke KI-modulen", () => {
    const dir = path.join(process.cwd(), "src/core/reports");
    for (const file of ["publish.ts", "snapshot.ts", "signals.ts"]) {
      const text = readFileSync(path.join(dir, file), "utf8");
      expect(text).not.toMatch(/from\s+["']@\/core\/ai/);
    }
  });
});

// --- Utgivelser og personvern ------------------------------------------------------------------

describe("listReleases", () => {
  it("I16 kontor ser grunnkoden, men ikke teksten; takstmann ser begge", async () => {
    const f = await publishableBathroom({ skip: [CP.general] });
    await publishAll(f, f.actor, REASON_MARKER);
    const office = await createStaff(f.organizationId, ["office"]);

    const own = await listReleases(f.actor, f.organizationId, f.assignmentId);
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({
      versionNumber: 1,
      releasedByName: expect.any(String),
      validUntil: "2027-06-15",
    });
    expect(own[0]?.overrides).toEqual([
      expect.objectContaining({
        checkCode: "mandatory_without_tg",
        reasonCode: "other",
        reason: REASON_MARKER,
        checkpointLabel: "Generelt",
      }),
    ]);
    expect(own[0]?.warningCount).toBeGreaterThanOrEqual(0);

    const officeView = await listReleases(office.actor, f.organizationId, f.assignmentId);
    expect(officeView[0]?.overrides[0]).toMatchObject({ reasonCode: "other", reason: null });
    expect(JSON.stringify(officeView)).not.toContain("Merke-7Q4Z");
    expect(JSON.stringify(officeView)).not.toContain("schema_version");
  });

  it("I17 snapshot og utgivelser har ingen parter, adresse eller reklamasjonsdata", async () => {
    const f = await publishableBathroom();
    await createAssignmentParty(f.organizationId, {
      assignmentId: f.assignmentId,
      name: "Part-Merke-K2",
      email: "part-merke@example.invalid",
      phone: "40000001",
    });
    await createClaim(f.organizationId, { assignmentId: f.assignmentId });
    await publishAll(f);
    const [release] = await db.select().from(reportReleases);
    const json =
      JSON.stringify(release) + JSON.stringify(await db.select().from(publishCheckResults));
    for (const marker of [
      "Part-Merke-K2",
      "part-merke@",
      "40000001",
      "Testveien",
      "Fukt i kjeller",
      "Kjøper Test",
    ]) {
      expect(json).not.toContain(marker);
    }
    const listed = JSON.stringify(await listReleases(f.actor, f.organizationId, f.assignmentId));
    expect(listed).not.toContain("Fukt i kjeller");
  });

  it("listen slår aldri opp i reklamasjoner", () => {
    const text = readFileSync(path.join(process.cwd(), "src/core/reports/publish.ts"), "utf8");
    // Tabellen nevnes bare i kommentarer (i `…`), aldri som kode
    expect(text).not.toMatch(/(?<!`)\bclaims\b(?!`)/);
  });
});

// --- Rollematrisen (I7) ----------------------------------------------------------------------

describe("rollene", () => {
  it("kontor ser sjekken, men kan verken publisere eller lage ny versjon", async () => {
    const f = await publishableBathroom({ skip: [CP.general] });
    const office = await createStaff(f.organizationId, ["office"]);
    const view = await draftCheck(office.actor, f.organizationId, f.assignmentId);
    expect(view.ability).toEqual({ allowed: false, reason: "missing_permission" });
    expect(view.canEdit).toBe(false);
    await expect(
      publishReport(office.actor, f.organizationId, {
        assignmentId: f.assignmentId,
        fingerprint: view.fingerprint,
        overrides: overrideAll(view),
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await publishAll(f);
    await expect(
      startNewVersion(office.actor, f.organizationId, f.assignmentId),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("takstmann uten sertifisering ser alt, men publisering avvises med norsk melding", async () => {
    const f = await publishableBathroom({ certified: false });
    const view = await draftCheck(f.actor, f.organizationId, f.assignmentId);
    expect(view.ability).toEqual({
      allowed: false,
      reason: "no_valid_certification",
      expiredOn: null,
    });
    await expectValidationError(publishAll(f), "certification_missing");
  });

  it("admin uten sertifisering ser sjekk og begrunnelser og lager ny versjon, men publiserer ikke", async () => {
    const f = await publishableBathroom({ skip: [CP.general] });
    await publishAll(f, f.actor, REASON_MARKER);
    const admin = await createStaff(f.organizationId, ["admin"]);
    const releases = await listReleases(admin.actor, f.organizationId, f.assignmentId);
    expect(releases[0]?.overrides[0]?.reason).toBe(REASON_MARKER);
    expect(await startNewVersion(admin.actor, f.organizationId, f.assignmentId)).toMatchObject({
      nextVersionNumber: 2,
    });
    const view = await draftCheck(admin.actor, f.organizationId, f.assignmentId);
    expect(view.ability).toMatchObject({ allowed: false, reason: "no_valid_certification" });
    await expectValidationError(publishAll(f, admin.actor), "certification_missing");
  });

  it("leder med sertifisering kan publisere", async () => {
    const f = await publishableBathroom({ roles: ["manager"] });
    expect((await publishAll(f)).status).toBe("published");
  });

  it("enkeltrettigheten report.publish gjelder bare med sertifisering", async () => {
    const f = await publishableBathroom();
    const office = await createStaff(f.organizationId, ["office"]);
    await grantPermission(office.employee, "report.publish");
    await expect(publishAll(f, office.actor)).rejects.toBeInstanceOf(AccessDeniedError);
    await createCertification(office.employee);
    expect((await publishAll(f, office.actor)).status).toBe("published");
    const [release] = await db.select().from(reportReleases);
    expect(release?.releasedBy).toBe(office.employee.id);
  });
});

// --- Låsen og papirkurven -----------------------------------------------------------------------

describe("isReportPublishedForAssignment", () => {
  it("er sann bare for publisert rapport, og bare i egen organisasjon", async () => {
    const f = await publishableBathroom();
    const other = await publishableBathroom();
    expect(await isReportPublishedForAssignment(db, f.organizationId, f.assignmentId)).toBe(false);
    await publishAll(f);
    expect(await isReportPublishedForAssignment(db, f.organizationId, f.assignmentId)).toBe(true);
    expect(await isReportPublishedForAssignment(db, other.organizationId, f.assignmentId)).toBe(
      false,
    );
  });
});

describe("utgivelser og sjekkrader endres aldri", () => {
  it("ingen tjeneste oppdaterer eller sletter dem", () => {
    const dir = path.join(process.cwd(), "src/core");
    const files: string[] = [];
    const walk = (folder: string) => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const full = path.join(folder, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(full);
      }
    };
    walk(dir);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/\.update\(\s*(reportReleases|publishCheckResults)\b/);
      expect(text, file).not.toMatch(/\.delete\(\s*(reportReleases|publishCheckResults)\b/);
    }
  });
});

// --- Tenant-isolasjon (I8) -----------------------------------------------------------------------

describe("tenant-isolasjon", () => {
  /** Et publiserbart bad med publisert utgivelse og et ventende KI-forslag i organisasjonen. */
  async function seedOrganization(grant: EmployeeGrant, publish: boolean) {
    const f = await publishableBathroom({ organizationId: grant.organizationId });
    if (publish) await publishAll(f);
    return f;
  }

  async function adminActorFor(grant: EmployeeGrant, actor: Actor) {
    await createCertification({ id: grant.employeeId, organizationId: grant.organizationId });
    return actor;
  }

  it("getPublishCheck", async () => {
    const fixtures = new Map<string, Fixture>();
    await expectTenantIsolation({
      seed: async (a, b) => {
        fixtures.set(a.organizationId, await seedOrganization(a, false));
        fixtures.set(b.organizationId, await seedOrganization(b, false));
        return {
          a: [fixtures.get(a.organizationId)!.reportId],
          b: [fixtures.get(b.organizationId)!.reportId],
        };
      },
      query: async (actor, organizationId) => {
        const results = [];
        for (const f of fixtures.values()) {
          try {
            const view = await getPublishCheck(actor, organizationId, f.assignmentId);
            if (view.state === "draft") results.push(view);
          } catch (error) {
            if (!(error instanceof AccessDeniedError)) throw error;
            await requireOrganizationAccess(actor, organizationId);
          }
        }
        return results;
      },
      idOf: (view) => view.reportId,
    });
  });

  it("publishReport", async () => {
    const fixtures = new Map<string, Fixture>();
    await expectTenantIsolation({
      seed: async (a, b) => {
        fixtures.set(a.organizationId, await seedOrganization(a, false));
        fixtures.set(b.organizationId, await seedOrganization(b, false));
        return {
          a: [fixtures.get(a.organizationId)!.assignmentId],
          b: [fixtures.get(b.organizationId)!.assignmentId],
        };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId);
        await adminActorFor(grant, actor);
        const published: string[] = [];
        for (const f of fixtures.values()) {
          try {
            const view = await draftCheck(actor, organizationId, f.assignmentId);
            const result = await publishReport(actor, organizationId, {
              assignmentId: f.assignmentId,
              fingerprint: view.fingerprint,
              overrides: [],
            });
            if (result.status === "published") published.push(f.assignmentId);
          } catch (error) {
            if (!(error instanceof AccessDeniedError)) throw error;
            // Fremmed oppdrag: ingen utgivelse i egen organisasjon for det
            expect(f.organizationId).not.toBe(organizationId);
          }
        }
        return [...new Set(published)].map((id) => ({ id }));
      },
      idOf: (row) => row.id,
    });
  });

  it("startNewVersion", async () => {
    const fixtures = new Map<string, Fixture>();
    await expectTenantIsolation({
      seed: async (a, b) => {
        fixtures.set(a.organizationId, await seedOrganization(a, true));
        fixtures.set(b.organizationId, await seedOrganization(b, true));
        return {
          a: [fixtures.get(a.organizationId)!.reportId],
          b: [fixtures.get(b.organizationId)!.reportId],
        };
      },
      query: async (actor, organizationId) => {
        const rows = [];
        for (const f of fixtures.values()) {
          try {
            rows.push(await startNewVersion(actor, organizationId, f.assignmentId));
          } catch (error) {
            if (!(error instanceof AccessDeniedError)) throw error;
            await requireOrganizationAccess(actor, organizationId, "report.edit");
            expect(f.organizationId).not.toBe(organizationId);
          }
        }
        return rows;
      },
      idOf: (row) => row.reportId,
    });
  });

  it("listReleases", async () => {
    const fixtures = new Map<string, Fixture>();
    await expectTenantIsolation({
      seed: async (a, b) => {
        fixtures.set(a.organizationId, await seedOrganization(a, true));
        fixtures.set(b.organizationId, await seedOrganization(b, true));
        const ids = async (orgId: string) =>
          (
            await db
              .select({ id: reportReleases.id })
              .from(reportReleases)
              .where(eq(reportReleases.organizationId, orgId))
          ).map((r) => r.id);
        return { a: await ids(a.organizationId), b: await ids(b.organizationId) };
      },
      query: async (actor, organizationId) => {
        const rows = [];
        for (const f of fixtures.values()) {
          try {
            rows.push(...(await listReleases(actor, organizationId, f.assignmentId)));
          } catch (error) {
            if (!(error instanceof AccessDeniedError)) throw error;
            await requireOrganizationAccess(actor, organizationId);
          }
        }
        return rows;
      },
      idOf: (row) => row.id,
    });
  });

  it("listPendingAiSuggestions", async () => {
    const fixtures = new Map<string, Fixture>();
    const seedAi = async (f: Fixture) => {
      const [result] = await db
        .select({ id: checkpointResults.id })
        .from(checkpointResults)
        .where(eq(checkpointResults.reportId, f.reportId));
      return (
        await createAiUsageLog(f.organizationId, {
          employeeId: f.employeeId,
          reportId: f.reportId,
          assignmentId: f.assignmentId,
          targetRef: { type: "checkpoint_result", id: result!.id, fieldKey: "description_text" },
        })
      ).id;
    };
    await expectTenantIsolation({
      seed: async (a, b) => {
        const fa = await seedOrganization(a, false);
        const fb = await seedOrganization(b, false);
        fixtures.set(a.organizationId, fa);
        fixtures.set(b.organizationId, fb);
        return { a: [await seedAi(fa)], b: [await seedAi(fb)] };
      },
      query: async (actor, organizationId) => {
        const rows = [];
        for (const f of fixtures.values()) {
          try {
            rows.push(...(await listPendingAiSuggestions(actor, organizationId, f.assignmentId)));
          } catch (error) {
            if (!(error instanceof AccessDeniedError)) throw error;
            await requireOrganizationAccess(actor, organizationId);
          }
        }
        return rows;
      },
      idOf: (row) => row.aiUsageId,
    });
  });

  it("isReportPublishedForAssignment", async () => {
    const fixtures = new Map<string, Fixture>();
    await expectTenantIsolation({
      seed: async (a, b) => {
        fixtures.set(a.organizationId, await seedOrganization(a, true));
        fixtures.set(b.organizationId, await seedOrganization(b, true));
        return {
          a: [fixtures.get(a.organizationId)!.assignmentId],
          b: [fixtures.get(b.organizationId)!.assignmentId],
        };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId);
        const rows = [];
        for (const f of fixtures.values()) {
          if (await isReportPublishedForAssignment(db, grant.organizationId, f.assignmentId)) {
            rows.push({ id: f.assignmentId });
          }
        }
        return rows;
      },
      idOf: (row) => row.id,
    });
  });
});
