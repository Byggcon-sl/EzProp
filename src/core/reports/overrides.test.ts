import { and, eq, isNull, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireOrganizationAccess, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { assignments, claims, overrideSummaries, reportReleases, reports } from "@/db/schema";
import {
  createEmployee,
  createOrganization,
  createOverrideSummaryRow,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import {
  bulkOverrides,
  LEAK_MARKERS,
  overrideClaim,
  overrideOrg,
  overrideRelease,
  overrideReport,
  type OverrideOrg,
} from "../../../tests/override-fixtures";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { CLAIM_MARKER_CASES } from "./logic/claim-marker-cases";
import { listPublishOverrides } from "./index";
import { overrideListQueries } from "./overrides";
import type { OverrideOverview, OverrideReleaseLine } from "./override-types";

vi.mock("server-only", () => ({}));

/*
 * Listen over overstyrte sperrer (docs/funksjoner/fase2a-overstyringer-leder-testplan.md avsnitt
 * 4a, O4.1–O4.10, og 6, O6.1 og O6.7). Fast klokke: 24.11.2026 kl. 13:00 norsk tid.
 *
 * Støtter hovedmål: færre reklamasjoner (rød bare på samme punkt og riktig utgivelse, ingen
 * dobbelttelling, slettede rader holdes ute) og de ansatte (leder ser mønstrene, uten navn og
 * fritekst). Testdata er oppdiktet.
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

async function managerIn(organizationId: string): Promise<Actor> {
  const actor = await createUser({ name: "Leder Testesen" });
  await createEmployee(actor, organizationId, ["manager"]);
  return actor;
}

async function setup() {
  const organization = await createOrganization("Oppdiktet Takst");
  const org = await overrideOrg(organization.id);
  const actor = await managerIn(organization.id);
  return { org, actor, organizationId: organization.id };
}

function allLines(overview: OverrideOverview): OverrideReleaseLine[] {
  return overview.groups.flatMap((g) => g.reasons.flatMap((r) => r.releases));
}

const IN_WINDOW = new Date("2026-11-20T10:00:00Z");

describe("tenant-isolasjon for override_summaries", () => {
  it("en annen organisasjon får verken rader eller tilgang", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => ({
        a: [(await createOverrideSummaryRow(grantA.organizationId)).id],
        b: [(await createOverrideSummaryRow(grantB.organizationId)).id],
      }),
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "claims.read");
        return db
          .select({ id: overrideSummaries.id })
          .from(overrideSummaries)
          .where(
            and(
              eq(overrideSummaries.organizationId, grant.organizationId),
              isNull(overrideSummaries.deletedAt),
            ),
          );
      },
      idOf: (row) => row.id,
    });
  });
});

describe("O6.1 tenant-isolasjon for listPublishOverrides", () => {
  it("leder i B ser ingen rader fra A, og fremmed organisasjons-id avvises", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids: { a: string[]; b: string[] } = { a: [], b: [] };
        for (const [side, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const org = await overrideOrg(grant.organizationId);
          const report = await overrideReport(org);
          // Samme kode, punkt, grunn og tid i begge organisasjonene
          ids[side].push(await overrideRelease(org, report, { releasedAt: IN_WINDOW }));
          await overrideClaim(grant.organizationId, report.assignmentId, {
            receivedAt: "2026-11-21",
            checkpointKey: "wet_room.membrane_drain",
          });
        }
        return ids;
      },
      query: async (actor, organizationId) =>
        allLines(await listPublishOverrides(actor, organizationId)),
      idOf: (line) => line.releaseId,
    });
  });
});

describe("O4.1 bare overstyrte sperrer", () => {
  it("advarsler og sperrer uten overstyring er ikke med", async () => {
    const { org, actor, organizationId } = await setup();
    const report = await overrideReport(org);
    await overrideRelease(org, report, {
      releasedAt: IN_WINDOW,
      overrides: [{ warning: true }, { checkCode: "tg3_missing_cost" }],
    });
    const overview = await listPublishOverrides(actor, organizationId);
    expect(overview.groups.map((g) => g.checkCode)).toEqual(["tg3_missing_cost"]);
    expect(allLines(overview)).toHaveLength(1);
  });
});

describe("O4.2 90 dager i norsk dato", () => {
  it("dag 89 og 90 er med, dag 91 ikke; 00:30 norsk tid telles på den norske dagen", async () => {
    const { org, actor, organizationId } = await setup();
    const cases = [
      { createdAt: "2026-08-27T10:00:00Z", included: true }, // dag 89
      { createdAt: "2026-08-26T10:00:00Z", included: true }, // dag 90
      { createdAt: "2026-08-25T22:30:00Z", included: true }, // 26.08 kl. 00:30 i Oslo
      { createdAt: "2026-08-25T21:30:00Z", included: false }, // 25.08 kl. 23:30 i Oslo
      { createdAt: "2026-08-25T10:00:00Z", included: false }, // dag 91
    ];
    const expected: string[] = [];
    for (const item of cases) {
      const report = await overrideReport(org);
      const releaseId = await overrideRelease(org, report, {
        releasedAt: new Date(item.createdAt),
        overrides: [{ createdAt: new Date(item.createdAt) }],
      });
      if (item.included) expected.push(releaseId);
    }
    const overview = await listPublishOverrides(actor, organizationId);
    expect(overview).toMatchObject({ fromDate: "2026-08-26", toDate: "2026-11-24" });
    expect(
      allLines(overview)
        .map((l) => l.releaseId)
        .sort(),
    ).toEqual(expected.sort());
  });
});

describe("O4.3 to nivåer", () => {
  it("gruppe per kode og punkt, grunner under, «Hele rapporten» uten punkt", async () => {
    const { org, actor, organizationId } = await setup();
    const report = await overrideReport(org);
    await overrideRelease(org, report, {
      releasedAt: IN_WINDOW,
      overrides: [
        { reasonCode: "no_access_or_refused" },
        { reasonCode: "other" },
        { checkpointKey: "wet_room.ventilation" },
        { checkCode: "inspection_date_missing", checkpointKey: null },
      ],
    });
    const overview = await listPublishOverrides(actor, organizationId);
    const hole = overview.groups.find(
      (g) =>
        g.checkCode === "wet_or_below_ground_missing_hole" &&
        g.checkpointKey === "wet_room.membrane_drain",
    )!;
    expect(hole).toMatchObject({
      checkLabel: "Hulltaking mangler",
      checkpointName: "Membran og sluk",
      reportCount: 1,
      claimCount: 0,
    });
    expect(hole.reasons.map((r) => [r.reasonCode, r.reasonLabel, r.reportCount])).toEqual([
      ["no_access_or_refused", "Ikke tilgang eller nektet av eier", 1],
      ["other", "Annet", 1],
    ]);
    const whole = overview.groups.find((g) => g.checkCode === "inspection_date_missing")!;
    expect(whole).toMatchObject({ checkpointKey: null, checkpointName: null });
    expect(overview.groups).toHaveLength(3);
  });

  it("punktnavnet kommer fra malversjonen til den nyeste rapporten i gruppen", async () => {
    const { org, actor, organizationId } = await setup();
    const { createTemplateVersionRow, createCheckpointRow } =
      await import("../../../tests/factories");
    const newer = await createTemplateVersionRow(organizationId);
    await createCheckpointRow(organizationId, {
      versionId: newer.id,
      key: "wet_room.membrane_drain",
      name: "Membran, sluk og tettesjikt",
    });
    const older = await overrideReport(org);
    await overrideRelease(org, older, { releasedAt: new Date("2026-11-01T10:00:00Z") });
    const latest = await overrideReport(org, { templateVersionId: newer.id });
    await overrideRelease(org, latest, { releasedAt: new Date("2026-11-10T10:00:00Z") });
    const overview = await listPublishOverrides(actor, organizationId);
    expect(overview.groups[0]!.checkpointName).toBe("Membran, sluk og tettesjikt");
  });
});

describe("O4.4 telling av unike rapporter", () => {
  it("v1 og v2 av samme rapport telles én gang, med to linjer og versjon 2 på den andre", async () => {
    const { org, actor, organizationId } = await setup();
    const report = await overrideReport(org);
    await overrideRelease(org, report, {
      versionNumber: 1,
      releasedAt: new Date("2026-11-01T10:00:00Z"),
    });
    await overrideRelease(org, report, {
      versionNumber: 2,
      releasedAt: new Date("2026-11-05T10:00:00Z"),
    });
    const overview = await listPublishOverrides(actor, organizationId);
    expect(overview.groups).toHaveLength(1);
    const group = overview.groups[0]!;
    expect(group.reportCount).toBe(1);
    expect(group.reasons[0]!.reportCount).toBe(1);
    expect(group.reasons[0]!.releases.map((l) => [l.versionNumber, l.releasedDate])).toEqual([
      [2, "2026-11-05"],
      [1, "2026-11-01"],
    ]);
    expect(group.reasons[0]!.releases[0]!.assignmentNumber).toBe(report.assignmentNumber);
  });

  it("to rom med samme punkt i samme utgivelse gir én linje", async () => {
    const { org, actor, organizationId } = await setup();
    const report = await overrideReport(org);
    await overrideRelease(org, report, { releasedAt: IN_WINDOW, overrides: [{}, {}] });
    const overview = await listPublishOverrides(actor, organizationId);
    expect(allLines(overview)).toHaveLength(1);
  });
});

describe("O4.5 sortering", () => {
  it("grupper med røde øverst, deretter flest rapporter; linjer nyeste først", async () => {
    const { org, actor, organizationId } = await setup();
    // Tre rapporter med TG3 uten kostnad, ingen reklamasjon
    for (let i = 0; i < 3; i += 1) {
      const report = await overrideReport(org);
      await overrideRelease(org, report, {
        releasedAt: new Date(`2026-11-0${i + 1}T10:00:00Z`),
        overrides: [{ checkCode: "tg3_missing_cost", checkpointKey: "wet_room.floor" }],
      });
    }
    // To rapporter med punkt uten TG, ingen reklamasjon
    for (let i = 0; i < 2; i += 1) {
      const report = await overrideReport(org);
      await overrideRelease(org, report, {
        releasedAt: IN_WINDOW,
        overrides: [{ checkCode: "mandatory_without_tg", checkpointKey: "wet_room.floor" }],
      });
    }
    // Én rapport med hull i våtrom og reklamasjon på samme punkt
    const red = await overrideReport(org);
    await overrideRelease(org, red, { releasedAt: IN_WINDOW });
    await overrideClaim(organizationId, red.assignmentId, {
      receivedAt: "2026-11-22",
      checkpointKey: "wet_room.membrane_drain",
    });

    const overview = await listPublishOverrides(actor, organizationId);
    expect(overview.groups.map((g) => [g.checkCode, g.reportCount, g.claimCount])).toEqual([
      ["wet_or_below_ground_missing_hole", 1, 1],
      ["tg3_missing_cost", 3, 0],
      ["mandatory_without_tg", 2, 0],
    ]);
    expect(overview.groups[1]!.reasons[0]!.releases.map((l) => l.releasedDate)).toEqual([
      "2026-11-03",
      "2026-11-02",
      "2026-11-01",
    ]);
  });

  it("like datoer med ulike takstmenn gir samme rekkefølge uansett hvem", async () => {
    const { org, actor, organizationId } = await setup();
    const otherUser = await createUser({ name: "Annen Takstmann" });
    const other = await createEmployee(otherUser, organizationId, ["inspector"]);
    const orders: string[][] = [];
    const reportsMade = [await overrideReport(org), await overrideReport(org)];
    for (const [index, report] of reportsMade.entries()) {
      const byOther: OverrideOrg = index === 0 ? { ...org, employeeId: other.id } : org;
      if (index === 0) {
        const { createCertification } = await import("../../../tests/factories");
        byOther.certificationId = (await createCertification({ id: other.id, organizationId })).id;
      }
      await overrideRelease(byOther, report, { releasedAt: IN_WINDOW });
    }
    orders.push(
      allLines(await listPublishOverrides(actor, organizationId)).map((l) => l.releaseId),
    );
    orders.push(
      allLines(await listPublishOverrides(actor, organizationId)).map((l) => l.releaseId),
    );
    expect(orders[0]).toEqual(orders[1]);
    // Samme tid: avgjort av oppdragsnummeret, ikke av personen
    const numbers = allLines(await listPublishOverrides(actor, organizationId)).map(
      (l) => l.assignmentNumber,
    );
    expect(numbers).toEqual([...numbers].sort());
  });
});

describe("O4.6 og O6.7 rød og nøytral fra databasen", () => {
  it.each(CLAIM_MARKER_CASES.map((c) => [c.name, c] as const))("%s", async (_name, testCase) => {
    const { org, actor, organizationId } = await setup();
    const report = await overrideReport(org);
    const releaseIds = new Map<number, string>();
    for (const [index, releasedAt] of testCase.releases.entries()) {
      const version = index + 1;
      const overridden = testCase.overriddenVersions.includes(version);
      const id = await overrideRelease(org, report, {
        versionNumber: version,
        releasedAt: new Date(releasedAt),
        overrides: overridden
          ? [
              {
                checkCode: testCase.checkpointKey
                  ? "wet_or_below_ground_missing_hole"
                  : "inspection_date_missing",
                checkpointKey: testCase.checkpointKey,
                createdAt: IN_WINDOW,
              },
            ]
          : [],
      });
      releaseIds.set(version, id);
    }
    for (const claim of testCase.claims) {
      if (claim.otherOrganization) {
        const otherOrg = await createOrganization("Annen organisasjon");
        const other = await overrideOrg(otherOrg.id);
        const otherReport = await overrideReport(other);
        await overrideClaim(otherOrg.id, otherReport.assignmentId, claim);
        continue;
      }
      const assignmentId = claim.otherAssignment
        ? (await overrideReport(org)).assignmentId
        : report.assignmentId;
      await overrideClaim(organizationId, assignmentId, {
        ...claim,
        deletedAt: claim.deleted ? new Date("2026-11-22T10:00:00Z") : null,
      });
    }

    const overview = await listPublishOverrides(actor, organizationId);
    const lines = allLines(overview);
    for (const version of testCase.overriddenVersions) {
      const line = lines.find((l) => l.releaseId === releaseIds.get(version))!;
      expect(line.marker, `versjon ${version}`).toBe(testCase.expected[version]);
      expect(line.claimId !== null).toBe(line.marker === "checkpoint_not_selected");
    }
    // Tellingen i SQL stemmer med markeringen på linjene
    const redReports = new Set(
      lines.filter((l) => l.marker === "same_checkpoint").map((l) => l.reportId),
    );
    expect(overview.groups.reduce((sum, g) => sum + g.claimCount, 0)).toBe(redReports.size);
  });
});

describe("O4.7 myk sletting, én test hver", () => {
  async function oneOverride() {
    const ctx = await setup();
    const report = await overrideReport(ctx.org);
    const releaseId = await overrideRelease(ctx.org, report, { releasedAt: IN_WINDOW });
    return { ...ctx, report, releaseId };
  }
  const deletedAt = new Date("2026-11-22T10:00:00Z");

  it("slettet utgivelse er ikke med", async () => {
    const ctx = await oneOverride();
    await db.update(reportReleases).set({ deletedAt }).where(eq(reportReleases.id, ctx.releaseId));
    expect((await listPublishOverrides(ctx.actor, ctx.organizationId)).groups).toEqual([]);
  });

  it("slettet rapport er ikke med", async () => {
    const ctx = await oneOverride();
    await db.update(reports).set({ deletedAt }).where(eq(reports.id, ctx.report.reportId));
    expect((await listPublishOverrides(ctx.actor, ctx.organizationId)).groups).toEqual([]);
  });

  it("slettet oppdrag er ikke med", async () => {
    const ctx = await oneOverride();
    await db
      .update(assignments)
      .set({ deletedAt })
      .where(eq(assignments.id, ctx.report.assignmentId));
    expect((await listPublishOverrides(ctx.actor, ctx.organizationId)).groups).toEqual([]);
  });

  it("slettet resultatrad er ikke med", async () => {
    const ctx = await setup();
    const report = await overrideReport(ctx.org);
    await overrideRelease(ctx.org, report, {
      releasedAt: IN_WINDOW,
      overrides: [{ deletedAt }],
    });
    expect((await listPublishOverrides(ctx.actor, ctx.organizationId)).groups).toEqual([]);
  });

  it("slettet reklamasjon gir verken markering eller rødt antall", async () => {
    const ctx = await oneOverride();
    const claim = await overrideClaim(ctx.organizationId, ctx.report.assignmentId, {
      receivedAt: "2026-11-22",
      checkpointKey: "wet_room.membrane_drain",
    });
    expect((await listPublishOverrides(ctx.actor, ctx.organizationId)).groups[0]!.claimCount).toBe(
      1,
    );
    await db.update(claims).set({ deletedAt }).where(eq(claims.id, claim.id));
    const overview = await listPublishOverrides(ctx.actor, ctx.organizationId);
    expect(overview.groups[0]!.claimCount).toBe(0);
    expect(allLines(overview)[0]!.marker).toBe("none");
  });
});

describe("O4.8 svaret har ingen persondata", () => {
  it("ingen begrunnelse, reklamasjonstekst, navn, ansatt-id eller adresse", async () => {
    const { org, actor, organizationId } = await setup();
    const report = await overrideReport(org);
    await overrideRelease(org, report, {
      releasedAt: IN_WINDOW,
      overrides: [{ reasonCode: "other" }, {}],
    });
    await overrideClaim(organizationId, report.assignmentId, {
      receivedAt: "2026-11-22",
      checkpointKey: null,
    });
    const json = JSON.stringify(await listPublishOverrides(actor, organizationId));
    for (const marker of Object.values(LEAK_MARKERS)) expect(json).not.toContain(marker);
    expect(json).not.toContain(org.employeeId);
    expect(json).not.toContain("Testveien");
    expect(json).not.toContain("overriddenBy");
    expect(json).not.toContain('overrideReason"');
    expect(json).not.toMatch(/"overrideReason"/u);
  });

  it("spørringene henter aldri begrunnelsen, hvem som krysset bort eller reklamasjonstekst", async () => {
    const { readFileSync } = await import("node:fs");
    // Kommentarene forklarer reglen og nevner kolonnene; bare koden sjekkes
    const source = readFileSync(new URL("./overrides.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .replace(/^\s*\/\/.*$/gmu, "");
    for (const column of [
      "override_reason ",
      "override_reason,",
      "overridden_by",
      "overrideReason)",
      "overriddenBy",
      "claimant_text",
      "building_part_text",
      "c.description",
      "c.created_by",
    ]) {
      expect(source, column).not.toContain(column);
    }
  });
});

describe("O4.9 tom tilstand", () => {
  it("ingen overstyringer gir tom liste", async () => {
    const { actor, organizationId } = await setup();
    expect(await listPublishOverrides(actor, organizationId)).toEqual({
      fromDate: "2026-08-26",
      toDate: "2026-11-24",
      groups: [],
    });
  });
});

describe("O4.10 ytelse", () => {
  it("2 000 overstyringer: under tidsgrensen, fast antall spørringer og riktige indekser", async () => {
    const { org, actor, organizationId } = await setup();
    await bulkOverrides(org, { reports: 300, perReport: 7, claims: 50, now: NOW });
    for (const table of [
      "publish_check_results",
      "report_releases",
      "reports",
      "assignments",
      "claims",
      "checkpoints",
    ]) {
      await db.execute(sql.raw(`analyze ${table}`));
    }

    const spy = vi.spyOn(db, "execute");
    const started = performance.now();
    const overview = await listPublishOverrides(actor, organizationId);
    const elapsed = performance.now() - started;
    const calls = spy.mock.calls.length;
    spy.mockRestore();

    expect(overview.groups.reduce((n, g) => n + g.reportCount, 0)).toBeGreaterThan(0);
    expect(allLines(overview).length).toBeGreaterThanOrEqual(300);
    // Romslig for CI; på en vanlig maskin tar det en brøkdel
    expect(elapsed).toBeLessThan(5000);
    // To spørringer uansett antall rader (linjer og telling)
    expect(calls).toBe(2);

    const queries = overrideListQueries(organizationId, "2026-08-26");
    const plan = await db.transaction(async (tx) => {
      await tx.execute(sql`set local enable_seqscan = off`);
      const rows = (await tx.execute(sql`explain ${queries.lines}`)) as unknown as Record<
        string,
        string
      >[];
      return rows.map((row) => Object.values(row)[0]).join("\n");
    });
    expect(plan).toContain("publish_check_results_overridden_idx");
    expect(plan).toContain("claims_organization_id_assignment_id_idx");
  }, 120_000);
});
