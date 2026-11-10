import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/core/access";
import {
  aiRow,
  auditCount,
  captureError,
  employeeWithGrant,
  enableAi,
  expectSameRejection,
  recordDecision,
  snapshot,
} from "../../../tests/ai";
import { createAiUsageLog, createOrganization, resetDatabase } from "../../../tests/factories";

/*
 * `recordDecision`, ny rekkefølge (docs/funksjoner/fase2a-forslagsmonster-testplan.md avsnitt 7
 * og 5.3, kortet Omfang 7). (1) Uten rettighet til noen KI-funksjon: `AccessDeniedError` før noe
 * leses. (2) Med KI-rettighet, men ikke for funksjonen på raden: samme nøytrale avslag som «finnes
 * ikke». Ved avslag endres verken raden eller `audit_log`. Mot testdatabasen.
 *
 * Funksjonen «test_manage_only» finnes bare i denne testen: den krever `organization.manage`, som
 * takstmannen ikke har. Slik prøves trinn 2 uten å endre de ekte funksjonsdefinisjonene.
 *
 * Støtter hovedmål: færre reklamasjoner (et avslag røper aldri om en rad finnes eller hva den
 * gjelder) og regel 11 (admin kan alltid avgjøre og angre).
 */

const TEST_FEATURE = "test_manage_only";

vi.mock("@/core/ai/features", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/core/ai/features")>();
  return {
    ...original,
    getFeatureDefinition: (code: string) => {
      if (code === "test_manage_only") {
        return {
          ...original.AI_FEATURES.language_polish,
          code: "test_manage_only",
          permission: "organization.manage",
        };
      }
      return original.getFeatureDefinition(code);
    },
  };
});

beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());

async function setup() {
  const organization = await createOrganization("Oppdiktet Takst A");
  await enableAi(organization.id);
  const other = await createOrganization("Oppdiktet Takst B");
  const inspector = await employeeWithGrant(organization.id, ["inspector"], "Test Takstmann");
  const own = await createAiUsageLog(organization.id, { employeeId: inspector.grant.employeeId });
  const foreign = await createAiUsageLog(other.id);
  const deleted = await createAiUsageLog(organization.id, {
    employeeId: inspector.grant.employeeId,
    deletedAt: new Date("2026-11-09T11:00:00Z"),
    deletedBy: inspector.grant.employeeId,
  });
  const managed = await createAiUsageLog(organization.id, {
    employeeId: inspector.grant.employeeId,
    feature: TEST_FEATURE,
    promptVersion: `${TEST_FEATURE}.v1`,
  });
  return { organization, other, inspector, own, foreign, deleted, managed };
}

describe("recordDecision trinn 1: uten noen KI-rettighet (7.1, 7.3)", () => {
  type Ids = Awaited<ReturnType<typeof setup>>;
  const CASES: { name: string; usageId: (ids: Ids) => string }[] = [
    { name: "rad som finnes", usageId: (ids) => ids.own.id },
    { name: "ukjent id", usageId: () => randomUUID() },
    { name: "rad i annen organisasjon", usageId: (ids) => ids.foreign.id },
    { name: 'ugyldig uuid "abc"', usageId: () => "abc" },
  ];

  it.each(CASES)("kontor uten report.edit, $name → AccessDeniedError", async ({ usageId }) => {
    const ids = await setup();
    const office = await employeeWithGrant(ids.organization.id, ["office"], "Test Kontor");
    expect(office.grant.permissions).not.toContain("report.edit");
    const before = snapshot(await aiRow(ids.own.id));
    const foreignBefore = snapshot(await aiRow(ids.foreign.id));
    const auditBefore = await auditCount();

    for (const decision of ["accepted", "rejected", "undo"]) {
      const error = await captureError(() => recordDecision(office.grant, usageId(ids), decision));
      expect(error, decision).toBeInstanceOf(AccessDeniedError);
    }

    expect(snapshot(await aiRow(ids.own.id))).toBe(before);
    expect(snapshot(await aiRow(ids.foreign.id))).toBe(foreignBefore);
    expect(await auditCount()).toBe(auditBefore);
  });
});

describe("recordDecision trinn 2: KI-rettighet, men ikke for funksjonen på raden (7.2, 7.3)", () => {
  type Ids = Awaited<ReturnType<typeof setup>>;
  const CASES: { name: string; usageId: (ids: Ids) => string }[] = [
    {
      name: "rad som finnes (funksjonen krever en annen rettighet)",
      usageId: (ids) => ids.managed.id,
    },
    { name: "ukjent id", usageId: () => randomUUID() },
    { name: "rad i annen organisasjon", usageId: (ids) => ids.foreign.id },
    { name: "mykt slettet rad", usageId: (ids) => ids.deleted.id },
  ];

  it.each(CASES)("$name → samme AiRequestRejectedError", async ({ usageId }) => {
    const ids = await setup();
    const { grant } = ids.inspector;
    expect(grant.permissions).toContain("report.edit");
    expect(grant.permissions).not.toContain("organization.manage");
    const baseline = await captureError(() => recordDecision(grant, randomUUID(), "accepted"));
    expect(baseline.name).toBe("AiRequestRejectedError");
    const watched = [ids.managed.id, ids.foreign.id, ids.deleted.id];
    const before = new Map<string, string>();
    for (const id of watched) before.set(id, snapshot(await aiRow(id)));
    const auditBefore = await auditCount();

    const error = await captureError(() => recordDecision(grant, usageId(ids), "accepted"));

    expectSameRejection(error, baseline);
    for (const id of watched) expect(snapshot(await aiRow(id)), id).toBe(before.get(id));
    expect(await auditCount()).toBe(auditBefore);
  });

  it("7.3 avslaget for rad med annen rettighet: status, decided_by, decided_at og row_version uendret", async () => {
    const ids = await setup();
    const before = (await aiRow(ids.managed.id))!;
    const auditBefore = await auditCount();
    await captureError(() => recordDecision(ids.inspector.grant, ids.managed.id, "rejected"));
    const after = (await aiRow(ids.managed.id))!;
    expect(after.status).toBe(before.status);
    expect(after.decided_by).toBe(before.decided_by);
    expect(after.decided_at).toBe(before.decided_at);
    expect(after.row_version).toBe(before.row_version);
    expect(await auditCount()).toBe(auditBefore);
  });
});

describe("recordDecision: admin (7.4)", () => {
  it("admin kan avgjøre og angre, også på raden med funksjonen som krever en annen rettighet", async () => {
    const ids = await setup();
    const admin = await employeeWithGrant(ids.organization.id, ["admin"], "Test Admin");

    for (const id of [ids.own.id, ids.managed.id]) {
      await recordDecision(admin.grant, id, "accepted");
      expect((await aiRow(id))!.status).toBe("accepted");
      await recordDecision(admin.grant, id, "undo");
      expect((await aiRow(id))!.status).toBe("suggested");
      await recordDecision(admin.grant, id, "rejected");
      expect((await aiRow(id))!.status).toBe("rejected");
    }
  });
});

describe("recordDecision: tenant-isolasjon med ny rekkefølge (5.3)", () => {
  it("B med KI-rettighet får AiRequestRejectedError for A sin rad; raden og audit_log i A er uendret", async () => {
    const ids = await setup();
    await enableAi(ids.other.id);
    const inspectorB = await employeeWithGrant(ids.other.id, ["inspector"], "Test Takstmann B");
    const adminB = await employeeWithGrant(ids.other.id, ["admin"], "Test Admin B");
    const before = snapshot(await aiRow(ids.own.id));
    const auditBefore = await auditCount();

    for (const grant of [inspectorB.grant, adminB.grant]) {
      for (const decision of ["accepted", "rejected", "edited", "undo"]) {
        const error = await captureError(() => recordDecision(grant, ids.own.id, decision));
        expect(error.name, decision).toBe("AiRequestRejectedError");
      }
    }
    expect(snapshot(await aiRow(ids.own.id))).toBe(before);
    expect(await auditCount()).toBe(auditBefore);
  });
});
