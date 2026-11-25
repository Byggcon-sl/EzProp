import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireOrganizationAccess, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { assignments, claims, publishCheckResults, reportReleases, reports } from "@/db/schema";
import {
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import {
  LEAK_MARKERS,
  overrideClaim,
  overrideOrg,
  overrideRelease,
  overrideReport,
} from "../../../tests/override-fixtures";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { buildOverrideStats } from "./index";

vi.mock("server-only", () => ({}));

/*
 * Tallene til KI (docs/funksjoner/fase2a-overstyringer-leder-testplan.md avsnitt 4b, O4.11–O4.15,
 * og 6, O6.2). Fast klokke: 24.11.2026.
 *
 * Støtter hovedmål: KI i bunnen (serveren teller riktig, også over skiftet til vintertid, og
 * grunnlaget har bare koder og tall) og færre reklamasjoner (slettede rader forfalsker ikke
 * tallene). Testdata er oppdiktet.
 */

const NOW = new Date("2026-11-24T12:00:00Z");

beforeEach(async () => {
  await resetDatabase();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const organization = await createOrganization("Oppdiktet Takst");
  const org = await overrideOrg(organization.id);
  const actor: Actor = await createUser({ name: "Leder Testesen" });
  await createEmployee(actor, organization.id, ["manager"]);
  const grant = await requireOrganizationAccess(actor, organization.id, "claims.read");
  return { org, grant, organizationId: organization.id };
}

describe("O6.2 tenant-isolasjon for buildOverrideStats", () => {
  it("tellingen i en organisasjon ser aldri rader fra den andre", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const keys = { a: "wet_room.membrane_drain", b: "wet_room.ventilation" };
        for (const [side, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const org = await overrideOrg(grant.organizationId);
          const report = await overrideReport(org);
          await overrideRelease(org, report, {
            releasedAt: new Date("2026-10-10T10:00:00Z"),
            overrides: [{ checkpointKey: keys[side] }],
          });
        }
        return { a: [keys.a], b: [keys.b] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "claims.read");
        return [...(await buildOverrideStats(grant, "2026-10")).stats.rows];
      },
      idOf: (row) => row.checkpointKey ?? "",
    });
  });

  it("samme kode, punkt og grunn i en annen organisasjon endrer verken nevner eller antall", async () => {
    const a = await setup();
    const b = await setup();
    for (const ctx of [a, b, b, b]) {
      const report = await overrideReport(ctx.org);
      await overrideRelease(ctx.org, report, { releasedAt: new Date("2026-10-10T10:00:00Z") });
      await overrideClaim(ctx.organizationId, report.assignmentId, {
        receivedAt: "2026-10-12",
        checkpointKey: "wet_room.membrane_drain",
      });
    }
    const { stats } = await buildOverrideStats(a.grant, "2026-10");
    expect(stats.reportCount).toBe(1);
    expect(stats.rows).toHaveLength(1);
    expect(stats.rows[0]).toMatchObject({ count: 1, claimCount: 1 });
  });
});

describe("O4.11 måned på released_at i norsk tid", () => {
  it.each([
    ["31.10 kl. 23:30 norsk tid hører til oktober", "2026-10-31T22:30:00Z", "2026-10"],
    ["1.11 kl. 00:30 norsk tid hører til november", "2026-10-31T23:30:00Z", "2026-11"],
    ["1.10 kl. 00:30 norsk tid (sommertid) hører til oktober", "2026-09-30T22:30:00Z", "2026-10"],
    ["30.9 kl. 23:30 norsk tid (sommertid) hører til september", "2026-09-30T21:30:00Z", "2026-09"],
    ["31.3 kl. 23:30 norsk tid (sommertid) hører til mars", "2026-03-31T21:30:00Z", "2026-03"],
    ["1.3 kl. 00:30 norsk tid (vintertid) hører til mars", "2026-02-28T23:30:00Z", "2026-03"],
  ])("%s", async (_name, releasedAt, month) => {
    const { org, grant } = await setup();
    const report = await overrideReport(org);
    await overrideRelease(org, report, { releasedAt: new Date(releasedAt) });
    const { stats } = await buildOverrideStats(grant, month);
    expect(stats.reportCount).toBe(1);
    expect(stats.rows[0]!.count).toBe(1);
    const [year, monthNumber] = month.split("-").map(Number) as [number, number];
    const other =
      monthNumber === 12 ? `${year + 1}-01` : `${year}-${String(monthNumber + 1).padStart(2, "0")}`;
    const next = await buildOverrideStats(grant, other);
    expect(next.stats.reportCount).toBe(0);
  });
});

describe("O4.12 nevneren", () => {
  it("unike rapporter publisert i måneden, også uten overstyring", async () => {
    const { org, grant } = await setup();
    for (let i = 0; i < 6; i += 1) {
      const report = await overrideReport(org);
      await overrideRelease(org, report, {
        releasedAt: new Date(`2026-10-1${i}T10:00:00Z`),
        overrides: i < 3 ? [{}] : [],
      });
    }
    const { stats } = await buildOverrideStats(grant, "2026-10");
    expect(stats.reportCount).toBe(6);
    expect(stats.rows).toHaveLength(1);
    expect(stats.rows[0]).toMatchObject({
      checkCode: "wet_or_below_ground_missing_hole",
      checkLabel: "Hulltaking mangler",
      checkpointKey: "wet_room.membrane_drain",
      checkpointName: "Membran og sluk",
      reasonCode: "no_access_or_refused",
      reasonLabel: "Ikke tilgang eller nektet av eier",
      count: 3,
      sharePercent: 50,
    });
  });

  it("v1 i oktober og v2 i november telles i begge måneder, én gang hver", async () => {
    const { org, grant } = await setup();
    const report = await overrideReport(org);
    await overrideRelease(org, report, {
      versionNumber: 1,
      releasedAt: new Date("2026-10-20T10:00:00Z"),
    });
    await overrideRelease(org, report, {
      versionNumber: 2,
      releasedAt: new Date("2026-11-02T10:00:00Z"),
    });
    await overrideRelease(org, report, {
      versionNumber: 3,
      releasedAt: new Date("2026-11-03T10:00:00Z"),
    });
    const october = await buildOverrideStats(grant, "2026-10");
    const november = await buildOverrideStats(grant, "2026-11");
    expect(october.stats.reportCount).toBe(1);
    expect(november.stats.reportCount).toBe(1);
    expect(november.stats.rows[0]).toMatchObject({ count: 1, previousCount: 1, deltaCount: 0 });
    expect(november.stats.previousMonth.reportCount).toBe(1);
  });

  it("kombinasjon som bare fantes måneden før, er med som nedgang til 0", async () => {
    const { org, grant } = await setup();
    const report = await overrideReport(org);
    await overrideRelease(org, report, {
      releasedAt: new Date("2026-09-20T10:00:00Z"),
      overrides: [{ checkCode: "tg3_missing_cost" }],
    });
    const other = await overrideReport(org);
    await overrideRelease(org, other, { releasedAt: new Date("2026-10-20T10:00:00Z") });
    const { stats } = await buildOverrideStats(grant, "2026-10");
    const gone = stats.rows.find((r) => r.checkCode === "tg3_missing_cost")!;
    expect(gone).toMatchObject({ count: 0, previousCount: 1, deltaCount: -1 });
  });

  it("rød telles per rapport når reklamasjonen gjelder samme punkt", async () => {
    const { org, grant, organizationId } = await setup();
    const report = await overrideReport(org);
    await overrideRelease(org, report, { releasedAt: new Date("2026-10-20T10:00:00Z") });
    await overrideClaim(organizationId, report.assignmentId, {
      receivedAt: "2026-11-02",
      checkpointKey: "wet_room.membrane_drain",
    });
    const plain = await overrideReport(org);
    await overrideRelease(org, plain, { releasedAt: new Date("2026-10-21T10:00:00Z") });
    await overrideClaim(organizationId, plain.assignmentId, {
      receivedAt: "2026-11-02",
      checkpointKey: null,
    });
    const { stats } = await buildOverrideStats(grant, "2026-10");
    expect(stats.rows[0]).toMatchObject({ count: 2, claimCount: 1 });
  });
});

describe("O4.14 grunnlaget har ingen persondata", () => {
  it("ingen begrunnelse, reklamasjonstekst, navn, ansatt-id, oppdragsnummer eller adresse", async () => {
    const { org, grant, organizationId } = await setup();
    const report = await overrideReport(org);
    await overrideRelease(org, report, {
      releasedAt: new Date("2026-10-20T10:00:00Z"),
      overrides: [{ reasonCode: "other" }, {}],
    });
    await overrideClaim(organizationId, report.assignmentId, {
      receivedAt: "2026-11-02",
      checkpointKey: "wet_room.membrane_drain",
    });
    const json = JSON.stringify(await buildOverrideStats(grant, "2026-10"));
    for (const marker of Object.values(LEAK_MARKERS)) expect(json).not.toContain(marker);
    for (const value of [
      org.employeeId,
      report.assignmentId,
      report.reportId,
      report.assignmentNumber,
      "Testveien",
    ]) {
      expect(json).not.toContain(value);
    }
  });
});

describe("O4.15 myk sletting gjelder også tallene", () => {
  const deletedAt = new Date("2026-11-22T10:00:00Z");

  async function oneOverride() {
    const ctx = await setup();
    const report = await overrideReport(ctx.org);
    const releaseId = await overrideRelease(ctx.org, report, {
      releasedAt: new Date("2026-10-20T10:00:00Z"),
    });
    const before = await buildOverrideStats(ctx.grant, "2026-10");
    expect(before.stats.reportCount).toBe(1);
    expect(before.stats.rows[0]!.count).toBe(1);
    return { ...ctx, report, releaseId };
  }

  it("slettet utgivelse", async () => {
    const ctx = await oneOverride();
    await db.update(reportReleases).set({ deletedAt }).where(eq(reportReleases.id, ctx.releaseId));
    const { stats } = await buildOverrideStats(ctx.grant, "2026-10");
    expect(stats.reportCount).toBe(0);
    expect(stats.rows).toEqual([]);
  });

  it("slettet rapport", async () => {
    const ctx = await oneOverride();
    await db.update(reports).set({ deletedAt }).where(eq(reports.id, ctx.report.reportId));
    const { stats } = await buildOverrideStats(ctx.grant, "2026-10");
    expect(stats.reportCount).toBe(0);
    expect(stats.rows).toEqual([]);
  });

  it("slettet oppdrag", async () => {
    const ctx = await oneOverride();
    await db
      .update(assignments)
      .set({ deletedAt })
      .where(eq(assignments.id, ctx.report.assignmentId));
    const { stats } = await buildOverrideStats(ctx.grant, "2026-10");
    expect(stats.reportCount).toBe(0);
    expect(stats.rows).toEqual([]);
  });

  it("slettet resultatrad", async () => {
    const ctx = await oneOverride();
    await db
      .update(publishCheckResults)
      .set({ deletedAt })
      .where(eq(publishCheckResults.releaseId, ctx.releaseId));
    const { stats } = await buildOverrideStats(ctx.grant, "2026-10");
    // Rapporten er fortsatt publisert, men overstyringen telles ikke
    expect(stats.reportCount).toBe(1);
    expect(stats.rows).toEqual([]);
  });

  it("slettet reklamasjon", async () => {
    const ctx = await oneOverride();
    const claim = await overrideClaim(ctx.organizationId, ctx.report.assignmentId, {
      receivedAt: "2026-11-02",
      checkpointKey: "wet_room.membrane_drain",
    });
    expect((await buildOverrideStats(ctx.grant, "2026-10")).stats.rows[0]!.claimCount).toBe(1);
    await db.update(claims).set({ deletedAt }).where(eq(claims.id, claim.id));
    expect((await buildOverrideStats(ctx.grant, "2026-10")).stats.rows[0]!.claimCount).toBe(0);
  });
});

describe("måneden valideres", () => {
  it.each(["2026-13", "2026-1", "26-10", "2026-10' or 1=1 --"])(
    "ugyldig format %s avvises",
    async (month) => {
      const { grant } = await setup();
      await expect(buildOverrideStats(grant, month)).rejects.toThrow();
    },
  );
});
