import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireOrganizationAccess } from "@/core/access";
import { db } from "@/db/client";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  aiRow,
  employeeWithGrant,
  enableAi,
  mergeOrganizationSettings,
  snapshot,
} from "../../../tests/ai";
import { createAiUsageLog, createOrganization, resetDatabase } from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { getSuggestionStatus } from "./index";

/*
 * Statusoppslaget `getSuggestionStatus` (docs/funksjoner/fase2a-forslagsmonster-testplan.md
 * avsnitt 3 og 5.1, kortet Omfang 3, avklaring A: `null` for alt som ikke kan vises). Mot
 * testdatabasen. Alle verdier er oppdiktet.
 *
 * Støtter hovedmål: de ansatte (kortet og KI-merket viser status lest fra serveren) og færre
 * reklamasjoner (ingen tekst, ingen personer og ingen annen organisasjon i svaret).
 */

beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());

const MARKER = "OPPDIKTET-MARKOR-7f3a";

async function setup() {
  const organization = await createOrganization("Oppdiktet Takst A");
  await enableAi(organization.id);
  const inspector = await employeeWithGrant(organization.id, ["inspector"]);
  return { organization, ...inspector };
}

describe("getSuggestionStatus: svaret (3.1–3.2)", () => {
  it.each([
    { outcome: "ok", status: "suggested" },
    { outcome: "ok", status: "accepted" },
    { outcome: "ok", status: "rejected" },
    { outcome: "ok", status: "edited" },
    { outcome: "no_match", status: null },
    { outcome: "error", status: null },
  ])("3.1 outcome $outcome, status $status", async ({ outcome, status }) => {
    const { organization, grant } = await setup();
    const row = await createAiUsageLog(organization.id, {
      employeeId: grant.employeeId,
      outcome,
      status,
      outputText: outcome === "ok" ? "Oppdiktet forslag." : null,
      errorCode: outcome === "error" ? "timeout" : null,
      decidedBy: status === "suggested" || status === null ? null : grant.employeeId,
      decidedAt: status === "suggested" || status === null ? null : new Date(),
    });
    expect(await getSuggestionStatus(grant, row.id)).toEqual({ status, outcome });
  });

  it("3.2 bare status og utfall: ingen tekst, ingen ansatt og ingen som avgjorde", async () => {
    const { organization, grant } = await setup();
    const decider = await employeeWithGrant(organization.id, ["manager"], "Test Leder");
    const row = await createAiUsageLog(organization.id, {
      employeeId: grant.employeeId,
      outputText: `Forslag ${MARKER}`,
      status: "accepted",
      decidedBy: decider.grant.employeeId,
      decidedAt: new Date(),
    });
    const result = await getSuggestionStatus(grant, row.id);
    expect(Object.keys(result!).sort()).toEqual(["outcome", "status"]);
    const text = JSON.stringify(result);
    expect(text).not.toContain(MARKER);
    expect(text).not.toContain(grant.employeeId);
    expect(text).not.toContain(decider.grant.employeeId);
  });

  it("3.1 id med store bokstaver gir samme svar som med små", async () => {
    const { organization, grant } = await setup();
    const row = await createAiUsageLog(organization.id, { employeeId: grant.employeeId });
    expect(await getSuggestionStatus(grant, row.id.toUpperCase())).toEqual({
      status: "suggested",
      outcome: "ok",
    });
  });
});

describe("getSuggestionStatus: nøytralt svar (3.3)", () => {
  type Case = { name: string; id: (ctx: Awaited<ReturnType<typeof neutralSetup>>) => string };

  async function neutralSetup() {
    const base = await setup();
    const own = await createAiUsageLog(base.organization.id, { employeeId: base.grant.employeeId });
    const other = await createOrganization("Oppdiktet Takst B");
    const foreign = await createAiUsageLog(other.id, { status: "accepted" });
    const deleted = await createAiUsageLog(base.organization.id, {
      employeeId: base.grant.employeeId,
      deletedAt: new Date(),
      deletedBy: "oppdiktet-admin",
    });
    const office = await employeeWithGrant(base.organization.id, ["office"], "Test Kontor");
    return { ...base, own, foreign, deleted, office };
  }

  const cases: Case[] = [
    { name: "id finnes ikke", id: () => uuidv7() },
    { name: "rad i annen organisasjon", id: (ctx) => ctx.foreign.id },
    { name: "mykt slettet rad", id: (ctx) => ctx.deleted.id },
    { name: "ugyldig uuid «abc»", id: () => "abc" },
    { name: "tom streng", id: () => "" },
    { name: "uuid med ekstra tegn", id: (ctx) => `${ctx.own.id}x` },
    { name: "uuid med SQL-tegn", id: (ctx) => `${ctx.own.id}' or '1'='1` },
  ];

  it.each(cases)("$name: null", async ({ id }) => {
    const ctx = await neutralSetup();
    expect(await getSuggestionStatus(ctx.grant, id(ctx))).toBeNull();
  });

  it("kontor uten report.edit, raden finnes: null, samme som finnes ikke", async () => {
    const ctx = await neutralSetup();
    expect(await getSuggestionStatus(ctx.office.grant, ctx.own.id)).toBeNull();
    expect(await getSuggestionStatus(ctx.office.grant, uuidv7())).toBeNull();
  });

  it("takstmann når innstillingen er av (mister report.edit): null", async () => {
    const ctx = await neutralSetup();
    await mergeOrganizationSettings(ctx.organization.id, { "access.inspectors_edit_all": false });
    const grant = await requireOrganizationAccess(ctx.actor, ctx.organization.id);
    expect(await getSuggestionStatus(grant, ctx.own.id)).toBeNull();
  });

  it("raden er uendret etter oppslagene", async () => {
    const ctx = await neutralSetup();
    const before = snapshot(await aiRow(ctx.own.id));
    await getSuggestionStatus(ctx.grant, ctx.own.id);
    await getSuggestionStatus(ctx.office.grant, ctx.own.id);
    expect(snapshot(await aiRow(ctx.own.id))).toBe(before);
  });
});

describe("getSuggestionStatus: eierskap og tenant (3.4, 3.7, 5.1)", () => {
  it("3.4 ingen eierskapsfilter (A162): takstmann B ser status på forslaget takstmann A ba om", async () => {
    const { organization, grant } = await setup();
    const other = await employeeWithGrant(organization.id, ["inspector"], "Test Takstmann B");
    const row = await createAiUsageLog(organization.id, {
      employeeId: grant.employeeId,
      status: "rejected",
      decidedBy: grant.employeeId,
      decidedAt: new Date(),
    });
    expect(await getSuggestionStatus(other.grant, row.id)).toEqual({
      status: "rejected",
      outcome: "ok",
    });
  });

  it("3.7 expectTenantIsolation: B får null for A sin rad, og omvendt", async () => {
    const seeded: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createAiUsageLog(grantA.organizationId, {
          employeeId: grantA.employeeId,
          status: "accepted",
          decidedBy: grantA.employeeId,
          decidedAt: new Date(),
        });
        const b = await createAiUsageLog(grantB.organizationId, { employeeId: grantB.employeeId });
        seeded.push(a.id, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "report.edit");
        const found: { id: string }[] = [];
        for (const id of seeded) {
          if ((await getSuggestionStatus(grant, id)) !== null) found.push({ id });
        }
        return found;
      },
      idOf: (row) => row.id,
    });
  });
});

describe("getSuggestionStatus: sperret forespørsel og rettighet før oppslag (vask før KI)", () => {
  it("V5.6 en blocked-rad gir null, også for admin", async () => {
    const { organization, grant } = await setup();
    const admin = await employeeWithGrant(organization.id, ["admin"], "Test Admin");
    const blocked = await createAiUsageLog(organization.id, {
      employeeId: grant.employeeId,
      outcome: "blocked",
      status: null,
      outputText: null,
    });
    expect(await getSuggestionStatus(grant, blocked.id)).toBeNull();
    expect(await getSuggestionStatus(admin.grant, blocked.id)).toBeNull();
  });

  it("V7.5 uten noen KI-rettighet leses ikke raden (0 oppslag), svaret er null", async () => {
    const { organization, grant } = await setup();
    const row = await createAiUsageLog(organization.id, { employeeId: grant.employeeId });
    const office = await employeeWithGrant(organization.id, ["office"], "Test Kontor");
    const select = vi.spyOn(db, "select");
    expect(await getSuggestionStatus(office.grant, row.id)).toBeNull();
    expect(await getSuggestionStatus(office.grant, uuidv7())).toBeNull();
    expect(select).not.toHaveBeenCalled();
  });

  it("V7.5 takstmann uten report.edit (innstillingen av): ingen oppslag", async () => {
    const { organization, actor, grant } = await setup();
    const row = await createAiUsageLog(organization.id, { employeeId: grant.employeeId });
    await mergeOrganizationSettings(organization.id, { "access.inspectors_edit_all": false });
    const withoutEdit = await requireOrganizationAccess(actor, organization.id);
    const select = vi.spyOn(db, "select");
    expect(await getSuggestionStatus(withoutEdit, row.id)).toBeNull();
    expect(select).not.toHaveBeenCalled();
  });

  it("V7.5 med rettighet leses raden; mykt slettet gir null; admin ser status", async () => {
    const { organization, grant } = await setup();
    const admin = await employeeWithGrant(organization.id, ["admin"], "Test Admin");
    const row = await createAiUsageLog(organization.id, { employeeId: grant.employeeId });
    const deleted = await createAiUsageLog(organization.id, {
      employeeId: grant.employeeId,
      deletedAt: new Date(),
      deletedBy: "oppdiktet-admin",
    });
    const select = vi.spyOn(db, "select");
    expect(await getSuggestionStatus(grant, row.id)).toEqual({
      status: "suggested",
      outcome: "ok",
    });
    expect(select).toHaveBeenCalledTimes(1);
    expect(await getSuggestionStatus(grant, deleted.id)).toBeNull();
    expect(await getSuggestionStatus(admin.grant, row.id)).toEqual({
      status: "suggested",
      outcome: "ok",
    });
  });

  it("V7.5 rettigheten for funksjonen på raden sjekkes fortsatt: ukjent funksjon gir null", async () => {
    const { organization, grant } = await setup();
    const unknown = await createAiUsageLog(organization.id, {
      employeeId: grant.employeeId,
      feature: "oppdiktet_funksjon",
    });
    expect(await getSuggestionStatus(grant, unknown.id)).toBeNull();
  });
});
