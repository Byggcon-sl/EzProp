import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireOrganizationAccess } from "@/core/access";
import {
  aiRow,
  employeeWithGrant,
  enableAi,
  mergeOrganizationSettings,
  snapshot,
} from "../../../tests/ai";
import { getSuggestionStatus, outcomeOf, trialTarget } from "../../../tests/ai-pattern";
import { createAiUsageLog, createOrganization, resetDatabase } from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";

/*
 * `getSuggestionStatus` (docs/funksjoner/fase2a-forslagsmonster-testplan.md avsnitt 3 og 5.1,
 * kortet Omfang 3). Ett forslag per kall, bare status og utfall, samme svar for alt som ikke kan
 * vises. Mot testdatabasen. Radene lages med `createAiUsageLog`. Alle verdier er oppdiktet.
 *
 * Støtter hovedmål: de ansatte (forslagskortet og KI-merket viser status lest fra serveren) og
 * færre reklamasjoner (svaret røper aldri tekst, hvem som ba om forslaget eller om en id finnes
 * hos en annen organisasjon).
 */

const MARKER = "MARKOR-status-7c1f";

beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());

async function setup() {
  const organization = await createOrganization("Oppdiktet Takst A");
  await enableAi(organization.id);
  const inspector = await employeeWithGrant(organization.id, ["inspector"], "Test Takstmann A");
  return { organization, inspector };
}

describe("getSuggestionStatus: status og utfall (3.1)", () => {
  const CASES = [
    { status: "suggested", outcome: "ok" },
    { status: "accepted", outcome: "ok" },
    { status: "rejected", outcome: "ok" },
    { status: "edited", outcome: "ok" },
    { status: null, outcome: "no_match" },
    { status: null, outcome: "error" },
  ] as const;

  it.each(CASES)("status $status, utfall $outcome", async ({ status, outcome }) => {
    const { organization, inspector } = await setup();
    const decided = status !== null && status !== "suggested";
    const row = await createAiUsageLog(organization.id, {
      employeeId: inspector.grant.employeeId,
      outcome,
      status,
      errorCode: outcome === "error" ? "unavailable" : null,
      outputText: outcome === "ok" ? `Forslag ${MARKER}.` : null,
      decidedBy: decided ? inspector.grant.employeeId : null,
      decidedAt: decided ? new Date("2026-11-09T10:00:00Z") : null,
      targetRef: trialTarget(),
    });

    expect(await getSuggestionStatus(inspector.grant, row.id)).toEqual({ status, outcome });
  });
});

describe("getSuggestionStatus: bare status og utfall (3.2)", () => {
  it("nøklene er nøyaktig outcome og status, og verken tekst, employee_id eller decided_by lekker", async () => {
    const { organization, inspector } = await setup();
    const decider = await employeeWithGrant(organization.id, ["manager"], "Test Leder");
    const row = await createAiUsageLog(organization.id, {
      employeeId: inspector.grant.employeeId,
      status: "accepted",
      decidedBy: decider.grant.employeeId,
      decidedAt: new Date("2026-11-09T10:00:00Z"),
      outputText: `Taket er gammelt ${MARKER}.`,
    });

    const answer = await getSuggestionStatus(inspector.grant, row.id);

    expect(answer).not.toBeNull();
    expect(Object.keys(answer!).sort()).toEqual(["outcome", "status"]);
    const text = JSON.stringify(answer);
    expect(text).not.toContain(MARKER);
    expect(text).not.toContain(inspector.grant.employeeId);
    expect(text).not.toContain(decider.grant.employeeId);
  });
});

describe("getSuggestionStatus: nøytralt svar (3.3)", () => {
  type Case = { name: string; usageId: (ids: Ids) => string; asOffInspector?: boolean };
  type Ids = { own: string; foreign: string; deleted: string };

  const CASES: Case[] = [
    { name: "id finnes ikke", usageId: () => randomUUID() },
    { name: "rad i annen organisasjon", usageId: (ids) => ids.foreign },
    { name: "mykt slettet rad", usageId: (ids) => ids.deleted },
    { name: 'ugyldig uuid "abc"', usageId: () => "abc" },
    { name: "tom tekst", usageId: () => "" },
    { name: "uuid med ekstra tegn", usageId: () => `${randomUUID()}x` },
    { name: "uuid med SQL-tegn", usageId: () => `${randomUUID()}' or '1'='1` },
    {
      name: "takstmann uten report.edit når raden finnes",
      usageId: (ids) => ids.own,
      asOffInspector: true,
    },
  ];

  it.each(CASES)("$name gir samme svar som ukjent id", async ({ usageId, asOffInspector }) => {
    const { organization, inspector } = await setup();
    const other = await createOrganization("Oppdiktet Takst B");
    const ids: Ids = {
      own: (await createAiUsageLog(organization.id, { employeeId: inspector.grant.employeeId })).id,
      foreign: (await createAiUsageLog(other.id)).id,
      deleted: (
        await createAiUsageLog(organization.id, {
          employeeId: inspector.grant.employeeId,
          status: "accepted",
          decidedBy: inspector.grant.employeeId,
          decidedAt: new Date("2026-11-09T10:00:00Z"),
          deletedAt: new Date("2026-11-09T11:00:00Z"),
          deletedBy: inspector.grant.employeeId,
        })
      ).id,
    };

    let grant = inspector.grant;
    if (asOffInspector) {
      await mergeOrganizationSettings(organization.id, { "access.inspectors_edit_all": false });
      grant = await requireOrganizationAccess(inspector.actor, organization.id);
      expect(grant.permissions).not.toContain("report.edit");
    }

    const baseline = await outcomeOf(() => getSuggestionStatus(inspector.grant, randomUUID()));
    // Avklaring A: null eller nøytral feil, aldri AccessDeniedError og aldri en databasefeil
    if (baseline.kind === "value") expect(baseline.value).toBeNull();
    else {
      expect(baseline.accessDenied).toBe(false);
      expect(baseline.name).toBe("AiRequestRejectedError");
    }

    const answer = await outcomeOf(() => getSuggestionStatus(grant, usageId(ids)));
    expect(answer).toEqual(baseline);
  });
});

describe("getSuggestionStatus: ikke eierskapsfilter (3.4, A162)", () => {
  it("takstmann B i samme organisasjon ser status på forslaget takstmann A ba om", async () => {
    const { organization, inspector } = await setup();
    const inspectorB = await employeeWithGrant(organization.id, ["inspector"], "Test Takstmann B");
    const row = await createAiUsageLog(organization.id, {
      employeeId: inspector.grant.employeeId,
      status: "rejected",
      decidedBy: inspector.grant.employeeId,
      decidedAt: new Date("2026-11-09T10:00:00Z"),
    });

    expect(await getSuggestionStatus(inspectorB.grant, row.id)).toEqual({
      status: "rejected",
      outcome: "ok",
    });
  });
});

describe("getSuggestionStatus: ett forslag per kall (3.5)", () => {
  it("en liste med id-er gir samme svar som ukjent id, ikke status for noen av dem", async () => {
    const { organization, inspector } = await setup();
    const row = await createAiUsageLog(organization.id, { employeeId: inspector.grant.employeeId });
    const baseline = await outcomeOf(() => getSuggestionStatus(inspector.grant, randomUUID()));

    const answer = await outcomeOf(() => getSuggestionStatus(inspector.grant, [row.id, row.id]));

    expect(answer).toEqual(baseline);
  });
});

describe("getSuggestionStatus: tenant-isolasjon (3.7, 5.1)", () => {
  it("expectTenantIsolation", async () => {
    const seeded: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createAiUsageLog(grantA.organizationId, {
          employeeId: grantA.employeeId,
        });
        const b = await createAiUsageLog(grantB.organizationId, {
          employeeId: grantB.employeeId,
        });
        seeded.push(a.id, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "report.edit");
        const visible: { id: string }[] = [];
        for (const id of seeded) {
          const answer = await outcomeOf(() => getSuggestionStatus(grant, id));
          if (answer.kind === "value" && answer.value !== null) visible.push({ id });
        }
        return visible;
      },
      idOf: (row) => row.id,
    });
  });

  it("5.1 B sin admin og takstmann får nøytralt svar for A sin rad, og A sin rad er uendret", async () => {
    const { organization, inspector } = await setup();
    const rowA = await createAiUsageLog(organization.id, {
      employeeId: inspector.grant.employeeId,
    });
    const before = snapshot(await aiRow(rowA.id));
    const orgB = await createOrganization("Oppdiktet Takst B");
    await enableAi(orgB.id);
    const adminB = await employeeWithGrant(orgB.id, ["admin"], "Test Admin B");
    const inspectorB = await employeeWithGrant(orgB.id, ["inspector"], "Test Takstmann B");

    for (const grant of [adminB.grant, inspectorB.grant]) {
      const baseline = await outcomeOf(() => getSuggestionStatus(grant, randomUUID()));
      expect(await outcomeOf(() => getSuggestionStatus(grant, rowA.id))).toEqual(baseline);
    }
    expect(snapshot(await aiRow(rowA.id))).toBe(before);
  });
});
