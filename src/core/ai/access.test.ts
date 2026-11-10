import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, requireOrganizationAccess } from "@/core/access";
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
