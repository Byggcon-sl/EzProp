import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, requireOrganizationAccess, type EmployeeGrant } from "@/core/access";
import { db } from "@/db/client";
import {
  aiRow,
  aiRowCount,
  auditCount,
  captureError,
  employeeWithGrant,
  enableAi,
  fakeAiProvider,
  mergeOrganizationSettings,
  recordDecision,
  requestSuggestion,
  snapshot,
  validRequest,
  type EmployeeVariant,
} from "../../../tests/ai";
import {
  createAiUsageLog,
  createOrganization,
  grantPermission,
  resetDatabase,
} from "../../../tests/factories";
import { AiRequestRejectedError, checkAiTextApproved, getSuggestionStatus } from "./index";

/*
 * Tilgang per rolle for KI-forslag (docs/funksjoner/fase2a-ki-modul-logg-testplan.md avsnitt 8,
 * kortet «Tilgang»). Begge funksjonene krever rettigheten fra funksjonsdefinisjonen
 * (`report.edit` for `language_polish`), sjekket med `grantHasPermission`. Mot testdatabasen.
 *
 * Støtter hovedmål: de ansatte (riktige personer får forslag), færre reklamasjoner (bare de som
 * kan endre feltet, kan godta KI-tekst i det) og regel 11 (admin stenges aldri ute).
 */

type Variant = {
  name: string;
  roles: EmployeeVariant[];
  inspectorsEditAll: boolean;
  allowed: boolean;
};

const VARIANTS: Variant[] = [
  {
    name: "takstmann, innstillingen på (standard)",
    roles: ["inspector"],
    inspectorsEditAll: true,
    allowed: true,
  },
  {
    name: "takstmann, innstillingen av",
    roles: ["inspector"],
    inspectorsEditAll: false,
    allowed: false,
  },
  { name: "kontor", roles: ["office"], inspectorsEditAll: true, allowed: false },
  { name: "leder", roles: ["manager"], inspectorsEditAll: true, allowed: true },
  { name: "admin, innstillingen av", roles: ["admin"], inspectorsEditAll: false, allowed: true },
];

beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());

/** Organisasjon med KI på, innstillingen satt, og den ansatte i varianten. */
async function setup(variant: Pick<Variant, "roles" | "inspectorsEditAll">) {
  const organization = await createOrganization("Oppdiktet Takst A");
  await enableAi(organization.id);
  if (!variant.inspectorsEditAll) {
    await mergeOrganizationSettings(organization.id, { "access.inspectors_edit_all": false });
  }
  const requester = await employeeWithGrant(organization.id, ["manager"], "Test Leder Forslag");
  const person = await employeeWithGrant(organization.id, variant.roles, "Test Ansatt");
  return { organization, requester, person };
}

describe("tilgang per rolle: be om forslag (8)", () => {
  it.each(VARIANTS)("$name: be om = $allowed", async (variant) => {
    const { person } = await setup(variant);
    const spy = vi.spyOn(fakeAiProvider, "complete");
    const auditBefore = await auditCount();

    if (variant.allowed) {
      const result = await requestSuggestion(person.grant, validRequest());
      expect(result.kind).toBe("suggestion");
      expect(spy).toHaveBeenCalledTimes(1);
      expect(await aiRowCount()).toBe(1);
      return;
    }
    const error = await captureError(() => requestSuggestion(person.grant, validRequest()));
    expect(error).toBeInstanceOf(AccessDeniedError);
    expect(spy).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(0);
    expect(await auditCount()).toBe(auditBefore);
  });
});

describe("tilgang per rolle: avgjøre og angre (8)", () => {
  it.each(VARIANTS)("$name: avgjøre = $allowed", async (variant) => {
    const { organization, requester, person } = await setup(variant);
    const suggested = await createAiUsageLog(organization.id, {
      employeeId: requester.grant.employeeId,
    });
    const before = snapshot(await aiRow(suggested.id));
    const auditBefore = await auditCount();

    if (variant.allowed) {
      await recordDecision(person.grant, suggested.id, "accepted");
      expect((await aiRow(suggested.id))!.status).toBe("accepted");
      expect((await aiRow(suggested.id))!.decided_by).toBe(person.grant.employeeId);
      return;
    }
    for (const decision of ["accepted", "edited", "rejected"]) {
      const error = await captureError(() => recordDecision(person.grant, suggested.id, decision));
      expect(error, decision).toBeInstanceOf(AccessDeniedError);
    }
    expect(snapshot(await aiRow(suggested.id))).toBe(before);
    expect(await auditCount()).toBe(auditBefore);
  });

  it.each(VARIANTS)("$name: angre = $allowed", async (variant) => {
    const { organization, requester, person } = await setup(variant);
    const accepted = await createAiUsageLog(organization.id, {
      employeeId: requester.grant.employeeId,
      status: "accepted",
      decidedBy: requester.grant.employeeId,
      decidedAt: new Date("2026-11-02T10:00:00Z"),
    });
    const before = snapshot(await aiRow(accepted.id));
    const auditBefore = await auditCount();

    if (variant.allowed) {
      await recordDecision(person.grant, accepted.id, "undo");
      expect((await aiRow(accepted.id))!.status).toBe("suggested");
      return;
    }
    const error = await captureError(() => recordDecision(person.grant, accepted.id, "undo"));
    expect(error).toBeInstanceOf(AccessDeniedError);
    expect(snapshot(await aiRow(accepted.id))).toBe(before);
    expect(await auditCount()).toBe(auditBefore);
  });
});

describe("tilgang: grenser (8.1–8.4)", () => {
  it("8.1 admin stenges aldri ute: bare admin, innstillingen av, report.edit ikke gitt som enkeltrettighet", async () => {
    const { organization, person } = await setup({ roles: ["admin"], inspectorsEditAll: false });
    const permissions = (await db.execute(
      sql`select permission from employee_permissions where employee_id = ${person.employee.id}`,
    )) as unknown as unknown[];
    expect(permissions).toHaveLength(0);

    const result = await requestSuggestion(person.grant, validRequest());
    expect(result.kind).toBe("suggestion");
    if (result.kind !== "suggestion") return;
    await recordDecision(person.grant, result.usageId, "rejected");
    await recordDecision(person.grant, result.usageId, "undo");
    await recordDecision(person.grant, result.usageId, "accepted");
    const row = (await aiRow(result.usageId))!;
    expect(row.status).toBe("accepted");
    expect(row.organization_id).toBe(organization.id);
  });

  it("8.2 kontor med enkeltrettigheten report.edit kan be om og avgjøre", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    await enableAi(organization.id);
    const office = await employeeWithGrant(organization.id, ["office"], "Test Kontor");
    await grantPermission(office.employee, "report.edit");
    const grant = await requireOrganizationAccess(office.actor, organization.id);
    expect(grant.roles).toEqual(["office"]);

    const result = await requestSuggestion(grant, validRequest());
    expect(result.kind).toBe("suggestion");
    if (result.kind !== "suggestion") return;
    await recordDecision(grant, result.usageId, "edited");
    expect((await aiRow(result.usageId))!.status).toBe("edited");
  });

  it('8.2 en ukjent enkeltrettighet ("ai.use") gir ikke kontoret tilgang', async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    await enableAi(organization.id);
    const office = await employeeWithGrant(organization.id, ["office"], "Test Kontor");
    await grantPermission(office.employee, "ai.use");
    const grant = await requireOrganizationAccess(office.actor, organization.id);
    const error = await captureError(() => requestSuggestion(grant, validRequest()));
    expect(error).toBeInstanceOf(AccessDeniedError);
  });

  it.each([
    { name: "mykt slettet", column: "deleted_at" },
    { name: "deaktivert", column: "deactivated_at" },
  ])(
    "8.3 ansatt som er $name etter at forslaget ble laget: tilgangen avvises, ingen endring",
    async ({ column }) => {
      const organization = await createOrganization("Oppdiktet Takst A");
      await enableAi(organization.id);
      const person = await employeeWithGrant(organization.id, ["inspector"]);
      const result = await requestSuggestion(person.grant, validRequest());
      if (result.kind !== "suggestion") throw new Error("forventet forslag");
      const before = snapshot(await aiRow(result.usageId));

      await db.execute(
        sql`update employees set ${sql.identifier(column)} = now() where id = ${person.employee.id}`,
      );

      const error = await captureError(() =>
        requireOrganizationAccess(person.actor, organization.id, "report.edit"),
      );
      expect(error).toBeInstanceOf(AccessDeniedError);
      expect(snapshot(await aiRow(result.usageId))).toBe(before);
    },
  );

  it("8.4 rettigheten følger funksjonen på raden: recordDecision tar ingen feature", () => {
    const source = readFileSync(join(__dirname, "index.ts"), "utf8");
    // Signaturen i den offentlige flaten: (grant, usageId, decision)
    const signature = /recordDecision\s*(?:=\s*async\s*)?\(([^)]*)\)/.exec(source);
    if (signature) expect(signature[1]).not.toMatch(/feature/i);
  });

  it("8.4 en rad med ukjent funksjon kan ikke avgjøres (rettigheten kan ikke slås opp)", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    await enableAi(organization.id);
    const admin = await employeeWithGrant(organization.id, ["admin"], "Test Admin");
    const row = await createAiUsageLog(organization.id, {
      employeeId: admin.grant.employeeId,
      feature: "unknown_feature",
      promptVersion: "unknown_feature.v1",
    });
    const before = snapshot(await aiRow(row.id));
    await captureError(() => recordDecision(admin.grant, row.id, "accepted"));
    expect(snapshot(await aiRow(row.id))).toBe(before);
  });
});

/*
 * Tilgangstabellen for forslagsmønsteret (docs/funksjoner/fase2a-forslagsmonster-testplan.md
 * avsnitt 6): statusoppslaget, sperren og avgjørelser. Fasiten er skrevet inn her. «nøytralt»
 * betyr samme svar som for en id som ikke finnes: `null` fra statusoppslaget, «ikke godkjent» fra
 * sperren og `AiRequestRejectedError` fra `recordDecision`.
 */

type PatternVariant = {
  name: string;
  roles: EmployeeVariant[];
  inspectorsEditAll?: boolean;
  grantReportEdit?: boolean;
  /** Deaktivert eller mykt slettet før tilgangssjekken. */
  removed?: "deactivated_at" | "deleted_at";
  otherOrganization?: boolean;
  expected: "lov" | "avslag" | "nøytralt";
};

const PATTERN_VARIANTS: PatternVariant[] = [
  { name: "takstmann, innstillingen på", roles: ["inspector"], expected: "lov" },
  {
    name: "takstmann, innstillingen av",
    roles: ["inspector"],
    inspectorsEditAll: false,
    expected: "avslag",
  },
  { name: "kontor uten report.edit", roles: ["office"], expected: "avslag" },
  { name: "kontor med report.edit", roles: ["office"], grantReportEdit: true, expected: "lov" },
  { name: "leder", roles: ["manager"], expected: "lov" },
  { name: "admin med bare rollen admin", roles: ["admin"], expected: "lov" },
  {
    name: "admin, innstillingen av",
    roles: ["admin"],
    inspectorsEditAll: false,
    expected: "lov",
  },
  {
    name: "deaktivert takstmann",
    roles: ["inspector"],
    removed: "deactivated_at",
    expected: "avslag",
  },
  {
    name: "mykt slettet takstmann",
    roles: ["inspector"],
    removed: "deleted_at",
    expected: "avslag",
  },
  {
    name: "admin i annen organisasjon",
    roles: ["admin"],
    otherOrganization: true,
    expected: "nøytralt",
  },
];

/**
 * Organisasjonen med et godkjent og et åpent forslag, og grant for personen i varianten.
 * `grant` er `null` når tilgangssjekken selv avviser (deaktivert eller slettet ansatt).
 */
async function patternSetup(variant: PatternVariant) {
  const organization = await createOrganization("Oppdiktet Takst A");
  await enableAi(organization.id);
  const requester = await employeeWithGrant(organization.id, ["manager"], "Test Leder Forslag");
  const target = { type: "answer", id: crypto.randomUUID(), fieldKey: "text" };
  const accepted = await createAiUsageLog(organization.id, {
    employeeId: requester.grant.employeeId,
    targetRef: target,
    status: "accepted",
    decidedBy: requester.grant.employeeId,
    decidedAt: new Date("2026-11-02T10:00:00Z"),
  });
  const suggested = await createAiUsageLog(organization.id, {
    employeeId: requester.grant.employeeId,
  });

  const home = variant.otherOrganization
    ? (await createOrganization("Oppdiktet Takst B")).id
    : organization.id;
  if (variant.otherOrganization) await enableAi(home);
  if (variant.inspectorsEditAll === false) {
    await mergeOrganizationSettings(home, { "access.inspectors_edit_all": false });
  }
  const person = await employeeWithGrant(home, variant.roles, "Test Ansatt");
  if (variant.grantReportEdit) await grantPermission(person.employee, "report.edit");

  let grant: EmployeeGrant | null = null;
  if (variant.removed) {
    await db.execute(
      sql`update employees set ${sql.identifier(variant.removed)} = now() where id = ${person.employee.id}`,
    );
  } else {
    grant = await requireOrganizationAccess(person.actor, home);
  }
  return { organization, home, person, grant, accepted, suggested, target };
}

type PatternCtx = Awaited<ReturnType<typeof patternSetup>>;

/** Deaktivert eller slettet: tilgangssjekken avviser, så tjenestene nås aldri. */
async function expectAccessCheckDenied(ctx: PatternCtx) {
  const error = await captureError(() =>
    requireOrganizationAccess(ctx.person.actor, ctx.home, "report.edit"),
  );
  expect(error).toBeInstanceOf(AccessDeniedError);
}

describe("tilgang per rolle: forslagsmønsteret (6)", () => {
  it.each(PATTERN_VARIANTS)("$name: statusoppslag = $expected", async (variant) => {
    const ctx = await patternSetup(variant);
    if (!ctx.grant) return expectAccessCheckDenied(ctx);
    const result = await getSuggestionStatus(ctx.grant, ctx.accepted.id);
    if (variant.expected === "lov") {
      expect(result).toEqual({ status: "accepted", outcome: "ok" });
    } else {
      expect(result).toBeNull();
    }
  });

  it.each(PATTERN_VARIANTS)("$name: sperren = $expected", async (variant) => {
    const ctx = await patternSetup(variant);
    const grant = ctx.grant;
    if (!grant) return expectAccessCheckDenied(ctx);
    const items = [{ aiUsageId: ctx.accepted.id, target: ctx.target }];
    if (variant.expected === "avslag") {
      const error = await captureError(() => checkAiTextApproved(grant, items));
      expect(error).toBeInstanceOf(AccessDeniedError);
      return;
    }
    const result = await checkAiTextApproved(grant, items);
    expect(result).toEqual(variant.expected === "lov" ? [] : items);
  });

  it.each(PATTERN_VARIANTS)("$name: avgjøre og angre = $expected", async (variant) => {
    const ctx = await patternSetup(variant);
    const grant = ctx.grant;
    if (!grant) return expectAccessCheckDenied(ctx);
    const before = snapshot(await aiRow(ctx.suggested.id));
    const auditBefore = await auditCount();
    if (variant.expected === "lov") {
      await recordDecision(grant, ctx.suggested.id, "accepted");
      expect((await aiRow(ctx.suggested.id))!.status).toBe("accepted");
      await recordDecision(grant, ctx.suggested.id, "undo");
      expect((await aiRow(ctx.suggested.id))!.status).toBe("suggested");
      return;
    }
    const error = await captureError(() => recordDecision(grant, ctx.suggested.id, "accepted"));
    expect(error).toBeInstanceOf(
      variant.expected === "avslag" ? AccessDeniedError : AiRequestRejectedError,
    );
    expect(snapshot(await aiRow(ctx.suggested.id))).toBe(before);
    expect(await auditCount()).toBe(auditBefore);
  });

  it("6.2 admin uten enkeltrettigheter: be om forslag, avgjøre, angre, se status og kjøre sperren", async () => {
    const { organization, person } = await setup({ roles: ["admin"], inspectorsEditAll: false });
    const permissions = (await db.execute(
      sql`select permission from employee_permissions where employee_id = ${person.employee.id}`,
    )) as unknown as unknown[];
    expect(permissions).toHaveLength(0);

    const target = { type: "answer", id: crypto.randomUUID(), fieldKey: "text" };
    const result = await requestSuggestion(person.grant, validRequest({ target }));
    if (result.kind !== "suggestion") throw new Error("forventet forslag");
    expect(await getSuggestionStatus(person.grant, result.usageId)).toEqual({
      status: "suggested",
      outcome: "ok",
    });
    const items = [{ aiUsageId: result.usageId, target }];
    expect(await checkAiTextApproved(person.grant, items)).toEqual(items);

    await recordDecision(person.grant, result.usageId, "accepted");
    expect(await checkAiTextApproved(person.grant, items)).toEqual([]);
    await recordDecision(person.grant, result.usageId, "undo");
    expect(await getSuggestionStatus(person.grant, result.usageId)).toEqual({
      status: "suggested",
      outcome: "ok",
    });
    expect((await aiRow(result.usageId))!.organization_id).toBe(organization.id);
  });
});
