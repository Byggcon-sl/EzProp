import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getPublishCheck,
  listPendingAiSuggestions,
  listReleases,
  publishReport,
  ReportValidationError,
  startNewVersion,
  type PublishCheckView,
  type PublishReportInput,
} from "@/core/reports";
import { canonicalJson } from "@/core/reports/logic/publish-check";
import { db } from "@/db/client";
import {
  assignments,
  auditLog,
  checkpointResults,
  events,
  publishCheckResults,
  rooms,
} from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import { todayInOslo } from "@/shared/lib/dates";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  createAiUsageLog,
  createAssignmentParty,
  createClaim,
  createRoom,
  resetDatabase,
} from "../../../tests/factories";
import {
  addTg3WithoutCost,
  checkRowsOf,
  createPublishableBathroom,
  releasesOf,
  reportStatus,
  softDeleteRoom,
  writeCounts,
  type PublishableBathroom,
} from "../../../tests/publish-fixtures";
import { answer } from "../../../tests/report-fixtures";

/*
 * Publiseringstjenesten mot testdatabasen (docs/funksjoner/fase2a-publisering-badet-testplan.md
 * avsnitt 2.2, 2.6, 4.1, 4.3, 4.4 og 4.5; kortets I1–I4, I6, I10–I13, I15 og I17). Tilgang og
 * tenant-isolasjon står i `publish-access.test.ts`. Alle data er oppdiktede.
 *
 * Hovedmål: færre reklamasjoner (serveren godtar aldri en sperre som verken er rettet eller krysset
 * bort med grunn, og mangelen kommer tilbake i ny versjon), de ansatte (én transaksjon, ingen tapt
 * arbeid) og KI i bunnen (publisering kaller aldri KI, og ventende KI-tekst kommer ikke med).
 */

beforeEach(resetDatabase);
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type DraftView = Extract<PublishCheckView, { state: "draft" }>;

async function draftCheck(f: PublishableBathroom): Promise<DraftView> {
  const view = await getPublishCheck(f.actor, f.organizationId, f.assignmentId);
  if (view.state !== "draft") throw new Error(`forventet draft, fikk ${view.state}`);
  return view;
}

/** Publiserer med fingeravtrykket fra en fersk sjekk, og krysser bort de sperrene som sendes. */
async function publish(
  f: PublishableBathroom,
  overrides: PublishReportInput["overrides"] = [],
  fingerprint?: string | null,
) {
  const view = await draftCheck(f);
  return publishReport(f.actor, f.organizationId, {
    assignmentId: f.assignmentId,
    fingerprint: fingerprint === undefined ? view.fingerprint : fingerprint,
    overrides,
  });
}

/** Krysser bort alle sperrene i en fersk sjekk med fast grunn. */
async function publishOverridingAll(
  f: PublishableBathroom,
  reason: { reasonCode: "no_access_or_refused" | "other"; text?: string | null } = {
    reasonCode: "no_access_or_refused",
  },
) {
  const view = await draftCheck(f);
  const overrides = view.findings
    .filter((x) => x.severity === "blocker")
    .map((x) => ({ findingKey: x.key, ...reason }));
  return publishReport(f.actor, f.organizationId, {
    assignmentId: f.assignmentId,
    fingerprint: view.fingerprint,
    overrides,
  });
}

async function rejection(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  return null;
}

async function expectValidationError(action: () => Promise<unknown>, code: string) {
  const error = await rejection(action);
  expect(error).toBeInstanceOf(ReportValidationError);
  expect((error as ReportValidationError).code).toBe(code);
  return error as ReportValidationError;
}

function published(result: Awaited<ReturnType<typeof publishReport>>) {
  if (result.status !== "published") throw new Error(`forventet published, fikk ${result.status}`);
  return result;
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Fanger alt som logges i testen (logger og konsoll). */
function captureLogs() {
  const spies = [
    vi.spyOn(logger, "debug"),
    vi.spyOn(logger, "info"),
    vi.spyOn(logger, "warn"),
    vi.spyOn(logger, "error"),
    vi.spyOn(console, "log").mockImplementation(() => {}),
    vi.spyOn(console, "info").mockImplementation(() => {}),
    vi.spyOn(console, "warn").mockImplementation(() => {}),
    vi.spyOn(console, "error").mockImplementation(() => {}),
  ];
  return () => JSON.stringify(spies.flatMap((s) => s.mock.calls));
}

// --- 4.1 Sjekk og publisering ------------------------------------------------------------------

describe("4.1 sjekk og publisering", () => {
  it("4.1.1 getPublishCheck er ren lesing: ingen rader i sjekk, revisjonslogg eller hendelser", async () => {
    const f = await createPublishableBathroom();
    await addTg3WithoutCost(f);
    const before = await writeCounts(f.organizationId);
    await getPublishCheck(f.actor, f.organizationId, f.assignmentId);
    await getPublishCheck(f.actor, f.organizationId, f.assignmentId);
    expect(await writeCounts(f.organizationId)).toEqual(before);
  });

  it("4.1.1 et bad uten mangler gir ingen sperrer og et fingeravtrykk", async () => {
    const f = await createPublishableBathroom();
    const view = await draftCheck(f);
    expect(view.findings.filter((x) => x.severity === "blocker")).toEqual([]);
    expect(view.summary.blockers).toBe(0);
    expect(view.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(view.hasWetRoom).toBe(true);
    expect(view.nextVersionNumber).toBe(1);
    expect(view.ability).toMatchObject({ allowed: true });
  });

  it("4.1.2 (I1) sperre som ikke er krysset bort avvises: ingen utgivelse, rapporten er draft", async () => {
    const f = await createPublishableBathroom();
    await addTg3WithoutCost(f);
    const before = await writeCounts(f.organizationId);
    const result = await publish(f, []);
    expect(result.status).toBe("blockers_remaining");
    if (result.status === "blockers_remaining") expect(result.remaining.length).toBeGreaterThan(0);
    expect(await writeCounts(f.organizationId)).toEqual(before);
    expect(await reportStatus(f.organizationId, f.reportId)).toBe("draft");
  });

  it("4.1.2 sjekken på serveren finner tg3_missing_cost for TG3 uten kostnad", async () => {
    const f = await createPublishableBathroom();
    const deviationId = await addTg3WithoutCost(f);
    const view = await draftCheck(f);
    const cost = view.findings.filter((x) => x.checkCode === "tg3_missing_cost");
    expect(cost).toHaveLength(1);
    expect(cost[0]!.severity).toBe("blocker");
    expect(cost[0]!.target.deviationId).toBe(deviationId);
    expect(cost[0]!.target.roomId).toBe(f.roomId);
  });

  it.each([
    { name: "utdatert", fingerprint: "0".repeat(64) },
    { name: "manglende", fingerprint: null },
  ])(
    "4.1.3 (I1) $name fingeravtrykk gir ny liste tilbake, ingen utgivelse",
    async ({ fingerprint }) => {
      const f = await createPublishableBathroom();
      const before = await writeCounts(f.organizationId);
      const result = await publish(f, [], fingerprint);
      expect(result.status).toBe("check_changed");
      if (result.status === "check_changed") {
        expect(result.check.state).toBe("draft");
        expect(result.check.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
      }
      expect(await writeCounts(f.organizationId)).toEqual(before);
      expect(await reportStatus(f.organizationId, f.reportId)).toBe("draft");
    },
  );

  it("4.1.3 endres dataene etter at siden ble åpnet, kommer den nye listen tilbake", async () => {
    const f = await createPublishableBathroom();
    const old = await draftCheck(f);
    await addTg3WithoutCost(f);
    const result = await publishReport(f.actor, f.organizationId, {
      assignmentId: f.assignmentId,
      fingerprint: old.fingerprint,
      overrides: [],
    });
    expect(result.status).toBe("check_changed");
    if (result.status === "check_changed") {
      expect(result.check.findings.some((x) => x.checkCode === "tg3_missing_cost")).toBe(true);
    }
    expect(await releasesOf(f.organizationId, f.reportId)).toEqual([]);
  });

  it("4.1.4 overstyring av en advarsel avvises, ingenting lagres", async () => {
    const f = await createPublishableBathroom();
    // Eget beløp som ikke er rundet gir bare advarsel
    await answer(f, "wet_room.hole_moisture_reading", { number: null }, { number: 10 });
    const view = await draftCheck(f);
    const warn = view.findings.find((x) => x.severity === "warning");
    expect(warn, "testen trenger en advarsel").toBeDefined();
    const before = await writeCounts(f.organizationId);
    await expectValidationError(
      () =>
        publishReport(f.actor, f.organizationId, {
          assignmentId: f.assignmentId,
          fingerprint: view.fingerprint,
          overrides: [{ findingKey: warn!.key, reasonCode: "described_elsewhere" }],
        }),
      "publish_override",
    );
    expect(await writeCounts(f.organizationId)).toEqual(before);
  });

  it.each([
    { name: "ukjent nøkkel", key: () => "finnes-ikke" },
    {
      name: "mål fra et annet rom",
      key: (view: DraftView) =>
        view.findings
          .find((x) => x.severity === "blocker")!
          .key.replaceAll(
            view.findings.find((x) => x.severity === "blocker")!.target.roomId!,
            uuidv7(),
          ),
    },
  ])("4.1.4 overstyring med $name avvises, ingenting lagres", async ({ key }) => {
    const f = await createPublishableBathroom();
    await addTg3WithoutCost(f);
    const view = await draftCheck(f);
    const before = await writeCounts(f.organizationId);
    const blockers = view.findings.filter((x) => x.severity === "blocker");
    await expectValidationError(
      () =>
        publishReport(f.actor, f.organizationId, {
          assignmentId: f.assignmentId,
          fingerprint: view.fingerprint,
          overrides: [
            ...blockers.map((x) => ({
              findingKey: x.key,
              reasonCode: "described_elsewhere" as const,
            })),
            { findingKey: key(view), reasonCode: "described_elsewhere" },
          ],
        }),
      "publish_override",
    );
    expect(await writeCounts(f.organizationId)).toEqual(before);
  });

  it("4.1.4 ugyldig grunn («Annet» uten tekst) avvises, ingenting lagres", async () => {
    const f = await createPublishableBathroom();
    await addTg3WithoutCost(f);
    const before = await writeCounts(f.organizationId);
    const error = await rejection(() =>
      publishOverridingAll(f, { reasonCode: "other", text: "kort" }),
    );
    expect(error).toBeInstanceOf(ReportValidationError);
    expect(await writeCounts(f.organizationId)).toEqual(before);
  });

  it("4.1.4 samme sperre krysset bort to ganger avvises", async () => {
    const f = await createPublishableBathroom();
    await addTg3WithoutCost(f);
    const view = await draftCheck(f);
    const blockers = view.findings.filter((x) => x.severity === "blocker");
    const overrides = blockers.map((x) => ({
      findingKey: x.key,
      reasonCode: "described_elsewhere" as const,
    }));
    await expectValidationError(
      () =>
        publishReport(f.actor, f.organizationId, {
          assignmentId: f.assignmentId,
          fingerprint: view.fingerprint,
          overrides: [...overrides, overrides[0]!],
        }),
      "publish_override",
    );
    expect(await releasesOf(f.organizationId, f.reportId)).toEqual([]);
  });

  it("4.1.5 serveren stoler ikke på klienten: id-er, ansatt, tid og versjon fra skjemaet brukes aldri", async () => {
    const f = await createPublishableBathroom();
    await addTg3WithoutCost(f);
    const other = await createPublishableBathroom({ organizationId: f.organizationId });
    const view = await draftCheck(f);
    const forged = {
      assignmentId: f.assignmentId,
      fingerprint: view.fingerprint,
      reportId: other.reportId,
      organizationId: other.organizationId,
      releasedAt: "2001-01-01T00:00:00Z",
      versionNumber: 7,
      releasedBy: other.employeeId,
      overrides: view.findings
        .filter((x) => x.severity === "blocker")
        .map((x) => ({
          findingKey: x.key,
          reasonCode: "no_access_or_refused" as const,
          overriddenBy: other.employeeId,
          overriddenAt: "2001-01-01T00:00:00Z",
        })),
    } as unknown as PublishReportInput;
    const started = Date.now();
    const outcome = await publishReport(f.actor, f.organizationId, forged).then(
      (r) => r,
      (e: unknown) => e,
    );
    if (outcome instanceof Error) {
      // Avvist som ugyldig inndata: ingenting lagret
      expect(outcome).toBeInstanceOf(ReportValidationError);
      expect(await releasesOf(f.organizationId, f.reportId)).toEqual([]);
    } else {
      const result = published(outcome as Awaited<ReturnType<typeof publishReport>>);
      expect(result.versionNumber).toBe(1);
      const [release] = await releasesOf(f.organizationId, f.reportId);
      expect(release!.releasedBy).toBe(f.employeeId);
      expect(release!.signedByEmployeeId).toBe(f.employeeId);
      expect(release!.versionNumber).toBe(1);
      expect(release!.releasedAt.getTime()).toBeGreaterThanOrEqual(started - 5000);
      for (const row of await checkRowsOf(f.organizationId, release!.id)) {
        if (row.overridden) {
          expect(row.overriddenBy).toBe(f.employeeId);
          expect(row.overriddenAt!.getTime()).toBeGreaterThanOrEqual(started - 5000);
        }
      }
    }
    // Den andre rapporten er urørt
    expect(await releasesOf(other.organizationId, other.reportId)).toEqual([]);
    expect(await reportStatus(other.organizationId, other.reportId)).toBe("draft");
  });

  it("4.1.6 vellykket publisering lager versjon 1 med snapshot, hash, datoer og sjekkrader for alle funn", async () => {
    const f = await createPublishableBathroom({ inspectionAt: new Date("2026-02-28T10:00:00Z") });
    await addTg3WithoutCost(f);
    const view = await draftCheck(f);
    const result = published(await publishOverridingAll(f));
    expect(result.versionNumber).toBe(1);
    expect(result.validUntil).toBe("2027-02-28");

    const [release, ...more] = await releasesOf(f.organizationId, f.reportId);
    expect(more).toEqual([]);
    expect(release!.id).toBe(result.releaseId);
    expect(release!.versionNumber).toBe(1);
    expect(release!.companyId).toBe(f.companyId);
    expect(release!.certificationId).toBe(f.certificationId);
    expect(release!.releasedBy).toBe(f.employeeId);
    expect(release!.signedByEmployeeId).toBe(f.employeeId);
    expect(release!.validUntil).toBe("2027-02-28");
    expect(release!.originalReleaseDate).toBe(todayInOslo(release!.releasedAt));
    const tenYears = new Date(release!.releasedAt);
    tenYears.setUTCFullYear(tenYears.getUTCFullYear() + 10);
    expect(Math.abs(release!.retainUntil.getTime() - tenYears.getTime())).toBeLessThan(
      2 * 24 * 3600 * 1000,
    );
    expect(release!.retainUntil.getTime()).toBeGreaterThanOrEqual(
      tenYears.getTime() - 24 * 3600 * 1000,
    );

    const snapshot = release!.snapshot as Record<string, unknown>;
    expect(snapshot.schema_version).toBe(1);
    expect(release!.contentHash).toBe(sha256(canonicalJson(snapshot)));
    const report = snapshot.report as Record<string, unknown>;
    expect(report.report_id).toBe(f.reportId);
    expect(report.template_version_id).toBe(f.templateVersionId);
    expect(report.inspection_date).toBe("2026-02-28");
    const text = JSON.stringify(snapshot);
    expect(text).toContain(f.roomId);
    expect(text).toContain("wet_room.membrane_drain");
    expect(text).toContain('"tg":"3"');
    expect(text).toContain('"tg_direct":"1"');
    expect(text).toContain("rule_decisions");
    expect(text).toContain("wet_room.membrane_before_2000");

    const rows = await checkRowsOf(f.organizationId, release!.id);
    expect(rows).toHaveLength(view.findings.length);
    expect(rows.filter((r) => r.severity === "blocker").every((r) => r.overridden)).toBe(true);
    expect(rows.filter((r) => r.severity === "warning").every((r) => !r.overridden)).toBe(true);
    expect(rows.every((r) => r.source === "rule" && r.reportId === f.reportId)).toBe(true);
    expect(rows.map((r) => r.checkCode).sort()).toEqual(
      view.findings.map((x) => x.checkCode).sort(),
    );
    expect(await reportStatus(f.organizationId, f.reportId)).toBe("published");
  });

  it("2.2 (P7) content_hash endres når en TG endres", async () => {
    const a = await createPublishableBathroom();
    const b = await createPublishableBathroom({ organizationId: a.organizationId });
    published(await publish(a));
    published(await publish(b));
    const [ra] = await releasesOf(a.organizationId, a.reportId);
    const [rb] = await releasesOf(b.organizationId, b.reportId);
    expect(ra!.contentHash).not.toBe(rb!.contentHash);
    expect(ra!.contentHash).toBe(sha256(canonicalJson(ra!.snapshot)));
  });

  it("4.1.7 (I2) feil midt i publiseringen lagrer ingenting", async () => {
    const f = await createPublishableBathroom();
    await addTg3WithoutCost(f);
    const before = await writeCounts(f.organizationId);
    // Tvunget feil når sjekkradene settes inn, etter at utgivelsen er laget
    await db.execute(sql`create or replace function test_fail_publish_check() returns trigger
      language plpgsql as $$ begin raise exception 'tvunget feil i test'; end $$`);
    await db.execute(sql`create trigger test_fail_publish_check before insert on publish_check_results
      for each row execute function test_fail_publish_check()`);
    try {
      const error = await rejection(() => publishOverridingAll(f));
      expect(error).not.toBeNull();
    } finally {
      await db.execute(
        sql`drop trigger if exists test_fail_publish_check on publish_check_results`,
      );
      await db.execute(sql`drop function if exists test_fail_publish_check()`);
    }
    expect(await writeCounts(f.organizationId)).toEqual(before);
    expect(await reportStatus(f.organizationId, f.reportId)).toBe("draft");
  });

  it("4.1.8 (I3) to samtidige publiseringer gir én utgivelse; den andre avvises med tydelig melding", async () => {
    const f = await createPublishableBathroom();
    const view = await draftCheck(f);
    const input = { assignmentId: f.assignmentId, fingerprint: view.fingerprint, overrides: [] };
    const results = await Promise.allSettled([
      publishReport(f.actor, f.organizationId, input),
      publishReport(f.actor, f.organizationId, input),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled" && r.value.status === "published");
    expect(ok).toHaveLength(1);
    const other = results.find(
      (r) => !(r.status === "fulfilled" && r.value.status === "published"),
    );
    expect(other?.status).toBe("rejected");
    if (other?.status === "rejected") {
      expect(other.reason).toBeInstanceOf(ReportValidationError);
      expect((other.reason as ReportValidationError).code).toBe("report_published");
      expect((other.reason as Error).message).toBe(
        "Rapporten er publisert. Lag ny versjon for å rette.",
      );
    }
    expect(await releasesOf(f.organizationId, f.reportId)).toHaveLength(1);
  });

  it("4.1.9 (I4) publisert rapport kan ikke publiseres igjen", async () => {
    const f = await createPublishableBathroom();
    const view = await draftCheck(f);
    published(
      await publishReport(f.actor, f.organizationId, {
        assignmentId: f.assignmentId,
        fingerprint: view.fingerprint,
        overrides: [],
      }),
    );
    const before = await writeCounts(f.organizationId);
    await expectValidationError(
      () =>
        publishReport(f.actor, f.organizationId, {
          assignmentId: f.assignmentId,
          fingerprint: view.fingerprint,
          overrides: [],
        }),
      "report_published",
    );
    expect(await writeCounts(f.organizationId)).toEqual(before);
    const after = await getPublishCheck(f.actor, f.organizationId, f.assignmentId);
    expect(after.state).toBe("published");
  });

  it("4.1.10 (I15) badet er mykt slettet: «Rapporten har ikke noe våtrom å publisere.», ingen overstyring", async () => {
    const f = await createPublishableBathroom();
    await softDeleteRoom(f.roomId);
    const view = await draftCheck(f);
    expect(view.hasWetRoom).toBe(false);
    const error = await expectValidationError(
      () =>
        publishReport(f.actor, f.organizationId, {
          assignmentId: f.assignmentId,
          fingerprint: view.fingerprint,
          overrides: [],
        }),
      "no_wet_room",
    );
    expect(error.message).toBe("Rapporten har ikke noe våtrom å publisere.");
    expect(await releasesOf(f.organizationId, f.reportId)).toEqual([]);
  });

  it("4.1.10 (I15) rapport med bare rom som ikke er våtrom avvises", async () => {
    const f = await createPublishableBathroom();
    const [bath] = await db.select().from(rooms).where(eq(rooms.id, f.roomId));
    await createRoom(f.organizationId, { floorId: bath!.floorId, roomType: "bedroom" });
    await softDeleteRoom(f.roomId);
    const view = await draftCheck(f);
    expect(view.hasWetRoom).toBe(false);
    await expectValidationError(
      () =>
        publishReport(f.actor, f.organizationId, {
          assignmentId: f.assignmentId,
          fingerprint: view.fingerprint,
          overrides: [],
        }),
      "no_wet_room",
    );
  });

  it("4.1.11 (I13) befaringsdato mangler: sperre; krysset bort gir tom «gyldig til»", async () => {
    const f = await createPublishableBathroom({ inspectionAt: null });
    const view = await draftCheck(f);
    const date = view.findings.filter((x) => x.checkCode === "inspection_date_missing");
    expect(date).toHaveLength(1);
    expect(date[0]!.severity).toBe("blocker");
    expect((await publish(f, [])).status).toBe("blockers_remaining");
    const result = published(await publishOverridingAll(f));
    expect(result.validUntil).toBeNull();
    const [release] = await releasesOf(f.organizationId, f.reportId);
    expect(release!.validUntil).toBeNull();
    expect(
      (release!.snapshot as { report: { inspection_date: unknown } }).report.inspection_date,
    ).toBeNull();
  });

  it("2.6 gyldig til i skuddår: befaring 2028-02-29 gir 2029-02-28", async () => {
    const f = await createPublishableBathroom({ inspectionAt: new Date("2028-02-29T10:00:00Z") });
    const result = published(await publish(f));
    expect(result.validUntil).toBe("2029-02-28");
  });

  it("2.6 gyldig til regnes i norsk tid: befaring 31.12. kl. 23.30 UTC er 01.01. i Oslo", async () => {
    const f = await createPublishableBathroom({ inspectionAt: new Date("2026-12-31T23:30:00Z") });
    const result = published(await publish(f));
    expect(result.validUntil).toBe("2028-01-01");
  });

  describe("4.1.12 sertifisering (norsk tid)", () => {
    // 2026-11-17 kl. 23.30 UTC er 18.11. i Oslo
    const NEAR_MIDNIGHT = new Date("2026-11-17T23:30:00Z");

    it("gyldig til i går (norsk tid) avvises med norsk melding", async () => {
      vi.useFakeTimers({ now: NEAR_MIDNIGHT, toFake: ["Date"] });
      const f = await createPublishableBathroom({
        certification: { validFrom: null, validTo: "2026-11-17" },
      });
      const view = await draftCheck(f);
      expect(view.ability).toMatchObject({ allowed: false });
      const error = await rejection(() =>
        publishReport(f.actor, f.organizationId, {
          assignmentId: f.assignmentId,
          fingerprint: view.fingerprint,
          overrides: [],
        }),
      );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/[æøåÆØÅ]|sertifisering|tilgang/u);
      expect(await releasesOf(f.organizationId, f.reportId)).toEqual([]);
    });

    it("utløpsdagen i dag (norsk tid) er siste gyldige dag", async () => {
      vi.useFakeTimers({ now: NEAR_MIDNIGHT, toFake: ["Date"] });
      const f = await createPublishableBathroom({
        certification: { validFrom: null, validTo: "2026-11-18" },
      });
      const result = published(await publish(f));
      const [release] = await releasesOf(f.organizationId, f.reportId);
      expect(release!.certificationId).toBe(f.certificationId);
      expect(release!.originalReleaseDate).toBe("2026-11-18");
      expect(result.versionNumber).toBe(1);
    });

    it("rett før midnatt i Oslo er utløpsdagen fortsatt gyldig", async () => {
      vi.useFakeTimers({ now: new Date("2026-11-17T22:59:00Z"), toFake: ["Date"] });
      const f = await createPublishableBathroom({
        certification: { validFrom: null, validTo: "2026-11-17" },
      });
      published(await publish(f));
    });

    it("to gyldige: den med lengst valid_to velges", async () => {
      const f = await createPublishableBathroom({
        certification: { validFrom: null, validTo: "2030-01-01" },
      });
      const { createCertification } = await import("../../../tests/factories");
      const longest = await createCertification(
        { id: f.employeeId, organizationId: f.organizationId },
        { validFrom: null, validTo: "2031-06-30" },
      );
      published(await publish(f));
      const [release] = await releasesOf(f.organizationId, f.reportId);
      expect(release!.certificationId).toBe(longest.id);
    });

    it("mykt slettet sertifisering teller ikke", async () => {
      const f = await createPublishableBathroom({ certification: null });
      const { createCertification } = await import("../../../tests/factories");
      await createCertification(
        { id: f.employeeId, organizationId: f.organizationId },
        { validFrom: null, validTo: "2099-01-01", deletedAt: new Date() },
      );
      const view = await draftCheck(f);
      expect(view.ability).toMatchObject({ allowed: false });
      expect(
        await rejection(() =>
          publishReport(f.actor, f.organizationId, {
            assignmentId: f.assignmentId,
            fingerprint: view.fingerprint,
            overrides: [],
          }),
        ),
      ).toBeInstanceOf(Error);
    });
  });

  it("4.1.13 hendelser: report.published for v1, report.publish_override per sperre, bare id-er og koder", async () => {
    const f = await createPublishableBathroom();
    await addTg3WithoutCost(f);
    const view = await draftCheck(f);
    const blockers = view.findings.filter((x) => x.severity === "blocker").length;
    published(
      await publishOverridingAll(f, { reasonCode: "other", text: "MERKE-HENDELSE-4113 oppdiktet" }),
    );
    const rows = await db.select().from(events).where(eq(events.organizationId, f.organizationId));
    const types = rows.map((r) => r.type);
    expect(types.filter((t) => t === "report.published")).toHaveLength(1);
    expect(types.filter((t) => t === "report.revised")).toHaveLength(0);
    expect(types.filter((t) => t === "report.publish_override")).toHaveLength(blockers);
    expect(JSON.stringify(rows)).not.toContain("MERKE-HENDELSE-4113");
  });

  it("4.1.13 mangler oppdraget selskap, avvises publiseringen", async () => {
    const f = await createPublishableBathroom();
    await db.update(assignments).set({ companyId: null }).where(eq(assignments.id, f.assignmentId));
    await expectValidationError(() => publish(f), "company_missing");
  });
});

// --- 4.3 Ny versjon ----------------------------------------------------------------------------

describe("4.3 ny versjon (I6)", () => {
  async function publishedWithOverride() {
    const f = await createPublishableBathroom({ inspectionAt: new Date("2026-03-10T10:00:00Z") });
    await addTg3WithoutCost(f);
    published(
      await publishOverridingAll(f, { reasonCode: "other", text: "Oppdiktet grunn for versjon 1" }),
    );
    return f;
  }

  it("4.3.1 startNewVersion setter draft, skriver revisjonslogg og rører ikke v1 eller sjekkradene", async () => {
    const f = await publishedWithOverride();
    const [v1] = await releasesOf(f.organizationId, f.reportId);
    const rowsBefore = await checkRowsOf(f.organizationId, v1!.id);
    const auditBefore = (await writeCounts(f.organizationId)).audit;
    const result = await startNewVersion(f.actor, f.organizationId, f.assignmentId);
    expect(result).toEqual({ reportId: f.reportId, nextVersionNumber: 2 });
    expect(await reportStatus(f.organizationId, f.reportId)).toBe("draft");
    expect((await writeCounts(f.organizationId)).audit).toBeGreaterThan(auditBefore);
    expect(await releasesOf(f.organizationId, f.reportId)).toEqual([v1]);
    expect(await checkRowsOf(f.organizationId, v1!.id)).toEqual(rowsBefore);
  });

  it("4.3.2 neste publisering blir v2 og arver original_release_date og valid_until fra v1, også om befaringsdatoen er endret", async () => {
    const f = await publishedWithOverride();
    const [v1] = await releasesOf(f.organizationId, f.reportId);
    await startNewVersion(f.actor, f.organizationId, f.assignmentId);
    await db
      .update(assignments)
      .set({ inspectionAt: new Date("2026-09-01T10:00:00Z") })
      .where(eq(assignments.id, f.assignmentId));
    const result = published(await publishOverridingAll(f));
    expect(result.versionNumber).toBe(2);
    expect(result.validUntil).toBe(v1!.validUntil);
    const [, v2] = await releasesOf(f.organizationId, f.reportId);
    expect(v2!.versionNumber).toBe(2);
    expect(v2!.originalReleaseDate).toBe(v1!.originalReleaseDate);
    expect(v2!.validUntil).toBe("2027-03-10");
    const types = (
      await db.select().from(events).where(eq(events.organizationId, f.organizationId))
    ).map((r) => r.type);
    expect(types.filter((t) => t === "report.published")).toHaveLength(1);
    expect(types.filter((t) => t === "report.revised")).toHaveLength(1);
  });

  it("4.3.3 en mangel som ikke er rettet, kommer tilbake som sperre uten overstyring", async () => {
    const f = await publishedWithOverride();
    await startNewVersion(f.actor, f.organizationId, f.assignmentId);
    const view = await draftCheck(f);
    expect(view.nextVersionNumber).toBe(2);
    expect(view.findings.some((x) => x.checkCode === "tg3_missing_cost")).toBe(true);
    const before = await writeCounts(f.organizationId);
    const result = await publishReport(f.actor, f.organizationId, {
      assignmentId: f.assignmentId,
      fingerprint: view.fingerprint,
      overrides: [],
    });
    expect(result.status).toBe("blockers_remaining");
    expect(await writeCounts(f.organizationId)).toEqual(before);
    expect(await releasesOf(f.organizationId, f.reportId)).toHaveLength(1);
  });

  it("4.3.4 forrige overstyring leveres som forslag, men lagres aldri uten at den sendes", async () => {
    const f = await publishedWithOverride();
    await startNewVersion(f.actor, f.organizationId, f.assignmentId);
    const view = await draftCheck(f);
    const cost = view.findings.find((x) => x.checkCode === "tg3_missing_cost")!;
    expect(cost.previousOverride).toEqual({
      versionNumber: 1,
      reasonCode: "other",
      reason: "Oppdiktet grunn for versjon 1",
    });
    // Advarsler får aldri forrige overstyring
    for (const w of view.findings.filter((x) => x.severity === "warning")) {
      expect(w.previousOverride).toBeNull();
    }
    // Publiseres med en annen grunn: bare den sendte lagres
    published(await publishOverridingAll(f, { reasonCode: "no_access_or_refused" }));
    const [, v2] = await releasesOf(f.organizationId, f.reportId);
    const rows = await checkRowsOf(f.organizationId, v2!.id);
    const costRow = rows.find((r) => r.checkCode === "tg3_missing_cost")!;
    expect(costRow.overrideReasonCode).toBe("no_access_or_refused");
    expect(costRow.overrideReason).toBeNull();
  });

  it("4.3.5 startNewVersion på en rapport i draft endrer ingenting", async () => {
    const f = await createPublishableBathroom();
    const before = await writeCounts(f.organizationId);
    const outcome = await startNewVersion(f.actor, f.organizationId, f.assignmentId).then(
      (r) => r,
      (e: unknown) => e,
    );
    if (outcome instanceof Error) expect(outcome).toBeInstanceOf(ReportValidationError);
    else expect(outcome).toEqual({ reportId: f.reportId, nextVersionNumber: 1 });
    expect(await writeCounts(f.organizationId)).toEqual(before);
    expect(await reportStatus(f.organizationId, f.reportId)).toBe("draft");
  });

  it("4.3.6 utgivelser og sjekkrader står igjen uendret etter ny versjon og ny publisering", async () => {
    const f = await publishedWithOverride();
    const [v1] = await releasesOf(f.organizationId, f.reportId);
    const rows = await checkRowsOf(f.organizationId, v1!.id);
    await startNewVersion(f.actor, f.organizationId, f.assignmentId);
    published(await publishOverridingAll(f));
    const [again] = await releasesOf(f.organizationId, f.reportId);
    expect(again).toEqual(v1);
    expect(await checkRowsOf(f.organizationId, v1!.id)).toEqual(rows);
  });
});

// --- 4.4 KI (I10, I11) -------------------------------------------------------------------------

describe("4.4 KI", () => {
  const PENDING_TEXT = "MERKE-KI-VENTER-44 oppdiktet forslag";

  async function aiRow(
    f: PublishableBathroom,
    overrides: Parameters<typeof createAiUsageLog>[1] = {},
  ) {
    // Forslaget peker på beskrivelsen av et punkt som står i rapporten
    const [result] = await db
      .select({ id: checkpointResults.id })
      .from(checkpointResults)
      .where(
        and(
          eq(checkpointResults.organizationId, f.organizationId),
          eq(checkpointResults.reportId, f.reportId),
        ),
      )
      .limit(1);
    return createAiUsageLog(f.organizationId, {
      employeeId: f.employeeId,
      assignmentId: f.assignmentId,
      reportId: f.reportId,
      outputText: PENDING_TEXT,
      targetRef: { type: "checkpoint_result", id: result!.id, fieldKey: "description_text" },
      ...overrides,
    });
  }

  it("4.4.1 bare ok + suggested, ikke slettet, på rapporten gir advarsel", async () => {
    const f = await createPublishableBathroom();
    const pending = await aiRow(f);
    await aiRow(f, { outcome: "blocked", outputText: null, status: null });
    await aiRow(f, { outcome: "error", errorCode: "timeout", outputText: null, status: null });
    await aiRow(f, { outcome: "no_match", outputText: null, status: null });
    await aiRow(f, { deletedAt: new Date() });
    await aiRow(f, { status: "accepted", decidedBy: f.employeeId, decidedAt: new Date() });
    const other = await createPublishableBathroom({ organizationId: f.organizationId });
    await aiRow(other);

    const view = await draftCheck(f);
    const ai = view.findings.filter((x) => x.checkCode === "ai_suggestion_pending");
    expect(ai.map((x) => x.target.aiUsageId)).toEqual([pending.id]);
    expect(ai[0]!.severity).toBe("warning");
    expect(view.pendingAiSuggestions.map((s) => s.aiUsageId)).toEqual([pending.id]);
    const listed = await listPendingAiSuggestions(f.actor, f.organizationId, f.assignmentId);
    expect(listed.map((s) => s.aiUsageId)).toEqual([pending.id]);
    expect(listed[0]!.outputText).toBe(PENDING_TEXT);
  });

  it("4.4.1 forslag eldre enn forrige utgivelse teller ikke", async () => {
    const f = await createPublishableBathroom();
    await aiRow(f, { createdAt: new Date(Date.now() - 3600_000) });
    // Forslaget kan ikke hindre publisering (bare advarsel)
    published(await publish(f));
    await startNewVersion(f.actor, f.organizationId, f.assignmentId);
    const view = await draftCheck(f);
    expect(view.findings.filter((x) => x.checkCode === "ai_suggestion_pending")).toEqual([]);
    const fresh = await aiRow(f, { createdAt: new Date(Date.now() + 1000) });
    const again = await draftCheck(f);
    expect(
      again.findings
        .filter((x) => x.checkCode === "ai_suggestion_pending")
        .map((x) => x.target.aiUsageId),
    ).toEqual([fresh.id]);
  });

  it("4.4.2 ventende forslagstekst står ikke i snapshot", async () => {
    const f = await createPublishableBathroom();
    await aiRow(f);
    published(await publish(f));
    const [release] = await releasesOf(f.organizationId, f.reportId);
    expect(JSON.stringify(release!.snapshot)).not.toContain("MERKE-KI-VENTER-44");
    const rows = await checkRowsOf(f.organizationId, release!.id);
    expect(rows.some((r) => r.checkCode === "ai_suggestion_pending")).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("MERKE-KI-VENTER-44");
  });

  it("4.4.3 publisering lager ingen nye rader i ai_usage_log", async () => {
    const f = await createPublishableBathroom();
    await addTg3WithoutCost(f);
    const before = (await writeCounts(f.organizationId)).ai;
    await getPublishCheck(f.actor, f.organizationId, f.assignmentId);
    published(await publishOverridingAll(f));
    await startNewVersion(f.actor, f.organizationId, f.assignmentId);
    published(await publishOverridingAll(f));
    expect((await writeCounts(f.organizationId)).ai).toBe(before);
  });
});

// --- 4.5 Personvern og logg (I12, I17) ---------------------------------------------------------

describe("4.5 personvern og logg", () => {
  const MARK = "MERKE-BEGRUNNELSE-451 oppdiktet tekst";

  it("4.5.1 begrunnelsen står i sjekkraden, men ikke i revisjonslogg, hendelser eller loggen", async () => {
    const logs = captureLogs();
    const f = await createPublishableBathroom();
    await addTg3WithoutCost(f);
    published(await publishOverridingAll(f, { reasonCode: "other", text: MARK }));
    const [release] = await releasesOf(f.organizationId, f.reportId);
    const rows = await checkRowsOf(f.organizationId, release!.id);
    expect(rows.filter((r) => r.overrideReason === MARK).length).toBeGreaterThan(0);

    const audit = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.organizationId, f.organizationId));
    expect(JSON.stringify(audit)).not.toContain("MERKE-BEGRUNNELSE-451");
    const ev = await db.select().from(events).where(eq(events.organizationId, f.organizationId));
    expect(JSON.stringify(ev)).not.toContain("MERKE-BEGRUNNELSE-451");
    expect(logs()).not.toContain("MERKE-BEGRUNNELSE-451");
  });

  it("4.5.1 begrunnelsen står ikke i feilmeldingen når publiseringen avvises", async () => {
    const logs = captureLogs();
    const f = await createPublishableBathroom();
    await addTg3WithoutCost(f);
    const marked = `${MARK} 01010150013`;
    const error = await rejection(() =>
      publishOverridingAll(f, { reasonCode: "other", text: marked }),
    );
    expect(error).toBeInstanceOf(ReportValidationError);
    expect((error as Error).message).not.toContain("MERKE-BEGRUNNELSE-451");
    expect((error as Error).message).not.toContain("01010150013");
    expect(logs()).not.toContain("MERKE-BEGRUNNELSE-451");
    expect(await releasesOf(f.organizationId, f.reportId)).toEqual([]);
  });

  it("4.5.2 snapshot, utgivelse og sjekkrader har ingen parter, kontaktopplysninger, adresse eller reklamasjon", async () => {
    const f = await createPublishableBathroom();
    await addTg3WithoutCost(f);
    await createAssignmentParty(f.organizationId, {
      assignmentId: f.assignmentId,
      name: "MERKE-PART-NAVN",
      email: "merke-part@example.invalid",
      phone: "40000001",
    });
    await createClaim(f.organizationId, {
      assignmentId: f.assignmentId,
      description: "MERKE-REKLAMASJON-452",
      claimantText: "MERKE-KLAGER-452",
    });
    published(await publishOverridingAll(f));
    const [release] = await releasesOf(f.organizationId, f.reportId);
    const rows = await checkRowsOf(f.organizationId, release!.id);
    const text = JSON.stringify({ release, rows });
    for (const mark of [
      "MERKE-PART-NAVN",
      "merke-part@example.invalid",
      "40000001",
      "MERKE-REKLAMASJON-452",
      "MERKE-KLAGER-452",
      "Testveien",
    ]) {
      expect(text).not.toContain(mark);
    }
  });

  it("4.5.4 snapshot logges aldri", async () => {
    const logs = captureLogs();
    const f = await createPublishableBathroom();
    published(await publish(f));
    const [release] = await releasesOf(f.organizationId, f.reportId);
    const captured = logs();
    expect(captured).not.toContain(release!.contentHash);
    expect(captured).not.toContain("schema_version");
    expect(captured).not.toContain("wet_room.membrane_drain");
  });
});

// --- Utgivelser --------------------------------------------------------------------------------

describe("listReleases", () => {
  it("viser versjon, hvem, når og overstyringer med grunn; nyeste først; aldri snapshot", async () => {
    const f = await createPublishableBathroom();
    await addTg3WithoutCost(f);
    published(
      await publishOverridingAll(f, { reasonCode: "other", text: "Oppdiktet grunn v1 her" }),
    );
    await startNewVersion(f.actor, f.organizationId, f.assignmentId);
    published(await publishOverridingAll(f));
    const list = await listReleases(f.actor, f.organizationId, f.assignmentId);
    expect(list.map((r) => r.versionNumber)).toEqual([2, 1]);
    const v1 = list[1]!;
    expect(v1.overrides.length).toBeGreaterThan(0);
    expect(v1.overrides.some((o) => o.reason === "Oppdiktet grunn v1 her")).toBe(true);
    expect(v1.releasedByName.length).toBeGreaterThan(0);
    expect(JSON.stringify(list)).not.toContain("schema_version");
    expect(JSON.stringify(list)).not.toContain('"snapshot"');
  });

  it("sjekkradene for v1 hører til v1 (release_id) og ikke til v2", async () => {
    const f = await createPublishableBathroom();
    await addTg3WithoutCost(f);
    published(await publishOverridingAll(f));
    await startNewVersion(f.actor, f.organizationId, f.assignmentId);
    published(await publishOverridingAll(f));
    const [v1, v2] = await releasesOf(f.organizationId, f.reportId);
    const all = await db
      .select()
      .from(publishCheckResults)
      .where(
        and(
          eq(publishCheckResults.organizationId, f.organizationId),
          eq(publishCheckResults.reportId, f.reportId),
        ),
      );
    const ids = new Set(all.map((r) => r.releaseId));
    expect(ids).toEqual(new Set([v1!.id, v2!.id]));
  });
});
