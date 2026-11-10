import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, requireOrganizationAccess } from "@/core/access";
import { db } from "@/db/client";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  aiRow,
  auditCount,
  captureError,
  employeeWithGrant,
  enableAi,
  expectSameRejection,
  neutralDecisionRejection,
  recordDecision,
  snapshot,
} from "../../../tests/ai";
import { createAiUsageLog, createOrganization, resetDatabase } from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { AI_FEATURES, type AiFeatureDefinition } from "./features";

/*
 * Rekkefølgen for tilgang i `recordDecision` (docs/funksjoner/fase2a-forslagsmonster-testplan.md
 * avsnitt 7 og 5.3, kortet Omfang 7):
 * 1. Uten rettigheten til noen KI-funksjon: `AccessDeniedError` før noe leses.
 * 2. Med KI-rettighet, men ikke for funksjonen på raden: samme nøytrale avslag som «finnes ikke».
 * Ved avslag er raden og `audit_log` uendret. Mot testdatabasen. Alle verdier er oppdiktet.
 *
 * Støtter hovedmål: færre reklamasjoner (svaret røper ikke hva en rad gjelder) og regel 11
 * (admin stenges aldri ute).
 */

/** En oppdiktet funksjon som krever en rettighet takstmannen ikke har. Bare i denne testen. */
const INVENTED_FEATURE = "invented_order_feature";
const features = AI_FEATURES as unknown as Record<string, AiFeatureDefinition>;

beforeEach(async () => {
  await resetDatabase();
  features[INVENTED_FEATURE] = {
    ...AI_FEATURES.language_polish,
    code: INVENTED_FEATURE as AiFeatureDefinition["code"],
    permission: "organization.manage",
    promptVersion: `${INVENTED_FEATURE}.v1`,
  };
});
afterEach(() => {
  delete features[INVENTED_FEATURE];
  vi.restoreAllMocks();
});

async function setup() {
  const organization = await createOrganization("Oppdiktet Takst A");
  await enableAi(organization.id);
  const inspector = await employeeWithGrant(organization.id, ["inspector"]);
  const office = await employeeWithGrant(organization.id, ["office"], "Test Kontor");
  const admin = await employeeWithGrant(organization.id, ["admin"], "Test Admin");
  const other = await createOrganization("Oppdiktet Takst B");
  const own = await createAiUsageLog(organization.id, { employeeId: inspector.grant.employeeId });
  const foreign = await createAiUsageLog(other.id);
  const deleted = await createAiUsageLog(organization.id, {
    employeeId: inspector.grant.employeeId,
    deletedAt: new Date(),
    deletedBy: "oppdiktet-admin",
  });
  const invented = await createAiUsageLog(organization.id, {
    employeeId: admin.grant.employeeId,
    feature: INVENTED_FEATURE,
    promptVersion: `${INVENTED_FEATURE}.v1`,
  });
  return { organization, inspector, office, admin, own, foreign, deleted, invented };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

async function snapshots(ctx: Ctx) {
  const ids = [ctx.own.id, ctx.foreign.id, ctx.deleted.id, ctx.invented.id];
  return Promise.all(ids.map(async (id) => snapshot(await aiRow(id))));
}

describe("recordDecision: trinn 1, uten noen KI-rettighet (7.1, 7.3)", () => {
  it.each([
    { name: "rad som finnes", id: (ctx: Ctx) => ctx.own.id },
    { name: "ukjent id", id: () => uuidv7() },
    { name: "rad i annen organisasjon", id: (ctx: Ctx) => ctx.foreign.id },
    { name: "ugyldig uuid", id: () => "abc" },
  ])("kontor uten report.edit, $name: AccessDeniedError før lesing", async ({ id }) => {
    const ctx = await setup();
    const before = await snapshots(ctx);
    const auditBefore = await auditCount();
    const select = vi.spyOn(db, "select");
    const transaction = vi.spyOn(db, "transaction");

    const error = await captureError(() => recordDecision(ctx.office.grant, id(ctx), "accepted"));

    expect(error).toBeInstanceOf(AccessDeniedError);
    expect(select).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(await snapshots(ctx)).toEqual(before);
    expect(await auditCount()).toBe(auditBefore);
  });
});

describe("recordDecision: trinn 2, rettighet men ikke for funksjonen på raden (7.2, 7.3)", () => {
  it.each([
    { name: "rad som finnes, annen funksjon", id: (ctx: Ctx) => ctx.invented.id },
    { name: "ukjent id", id: () => uuidv7() },
    { name: "rad i annen organisasjon", id: (ctx: Ctx) => ctx.foreign.id },
    { name: "mykt slettet rad", id: (ctx: Ctx) => ctx.deleted.id },
  ])("takstmann med report.edit, $name: samme nøytrale avslag", async ({ id }) => {
    const ctx = await setup();
    const baseline = await neutralDecisionRejection(ctx.inspector.grant);
    const before = await snapshots(ctx);
    const auditBefore = await auditCount();

    for (const decision of ["accepted", "edited", "rejected", "undo"]) {
      const error = await captureError(() =>
        recordDecision(ctx.inspector.grant, id(ctx), decision),
      );
      expectSameRejection(error, baseline);
      expect(error.name, decision).toBe("AiRequestRejectedError");
    }
    expect(await snapshots(ctx)).toEqual(before);
    expect(await auditCount()).toBe(auditBefore);
  });

  it("takstmannen kan fortsatt avgjøre raden for language_polish (ingen regresjon)", async () => {
    const ctx = await setup();
    await recordDecision(ctx.inspector.grant, ctx.own.id, "accepted");
    expect((await aiRow(ctx.own.id))!.status).toBe("accepted");
  });
});

describe("recordDecision: admin stenges aldri ute (7.4)", () => {
  it("admin kan avgjøre og angre, også raden med den oppdiktede funksjonen", async () => {
    const ctx = await setup();
    for (const id of [ctx.own.id, ctx.invented.id]) {
      await recordDecision(ctx.admin.grant, id, "accepted");
      expect((await aiRow(id))!.status).toBe("accepted");
      await recordDecision(ctx.admin.grant, id, "undo");
      expect((await aiRow(id))!.status).toBe("suggested");
      await recordDecision(ctx.admin.grant, id, "rejected");
      expect((await aiRow(id))!.status).toBe("rejected");
    }
  });
});

describe("recordDecision: tenant (5.3)", () => {
  it("expectTenantIsolation: B med KI-rettighet får nøytralt avslag for A sin rad, og raden er uendret", async () => {
    const seeded: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createAiUsageLog(grantA.organizationId, { employeeId: grantA.employeeId });
        const b = await createAiUsageLog(grantB.organizationId, { employeeId: grantB.employeeId });
        seeded.push(a.id, b.id);
        return { a: [a.id], b: [b.id] };
      },
      // «Radene» er forslagene grant kan avgjøre: «rejected» og straks angret, så raden står igjen
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "report.edit");
        const decided: { id: string }[] = [];
        for (const id of seeded) {
          const before = snapshot(await aiRow(id));
          const auditBefore = await auditCount();
          try {
            await recordDecision(grant, id, "rejected");
            await recordDecision(grant, id, "undo");
            decided.push({ id });
          } catch (error) {
            if ((error as Error).name !== "AiRequestRejectedError") throw error;
            expect(snapshot(await aiRow(id))).toBe(before);
            expect(await auditCount()).toBe(auditBefore);
          }
        }
        return decided;
      },
      idOf: (row) => row.id,
    });
  });
});
