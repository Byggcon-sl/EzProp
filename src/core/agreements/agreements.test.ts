import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { count, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { auditLog, employees, events, organizations, type EmployeeRole } from "@/db/schema";
import {
  createClientAgreement,
  createEmployee,
  createFirm,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import * as core from "./index";

/*
 * Avtale med oppdragsgiver: kjernen i src/core/agreements (liste, hente, opprette, endre, fjerne).
 * Testplan: docs/funksjoner/fase2a-oppdragsgiveravtale-testplan.md avsnitt 4.
 * Avtalen på oppdraget står i assignment-agreement.test.ts, forslaget i suggest.test.ts.
 *
 * Avvises uten: 4.1 (med admin-testen 4.1.5), 4.2 og 4.3. Regel 2 og 11.
 *
 * Testdata er oppdiktet: «Testforsikring AS», «Testavtale forsikring», premisseteksten «Premiss
 * for test. Ikke ekte tekst.», rapportprofilen `test-profil`.
 *
 * Støtter hovedmål: reklamasjoner (bare admin endrer avtalene, aldri data fra en annen
 * organisasjon, premisseteksten havner aldri i loggen) og tid (premissene ligger ett sted).
 */

beforeEach(resetDatabase);

const PREMISE = "Premiss for test. Ikke ekte tekst.";
const PREMISE_MARK = "Premiss for test";
const AGREEMENT_NAME = "Testavtale forsikring";
const DELETED = new Date("2026-11-01T08:00:00Z");

type AgreementInput = Parameters<typeof core.createAgreement>[2];

function agreementInput(firmId: string, overrides: Record<string, unknown> = {}): AgreementInput {
  return {
    firmId,
    name: AGREEMENT_NAME,
    validFrom: "2026-01-01",
    validTo: "",
    premiseText: PREMISE,
    reportProfileCode: "test-profil",
    ...overrides,
  } as AgreementInput;
}

async function setInspectorsEditAll(organizationId: string, value: boolean) {
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": value } })
    .where(eq(organizations.id, organizationId));
}

async function orgWithAdmin(name = "Testfirma takst") {
  const org = await createOrganization(name);
  const admin = await createUser({ name: "Test Admin" });
  const adminEmployee = await createEmployee(admin, org.id, ["admin"]);
  return { org, admin, adminEmployee };
}

async function person(organizationId: string, roles: EmployeeRole[]) {
  const actor = await createUser();
  const employee = await createEmployee(actor, organizationId, roles);
  return { actor, employee };
}

async function insurer(organizationId: string, name = "Testforsikring AS") {
  return createFirm(organizationId, { name, firmType: "insurer" });
}

type AgreementDbRow = {
  id: string;
  organization_id: string;
  firm_id: string;
  name: string;
  valid_from: string;
  valid_to: string | null;
  premise_text: string | null;
  report_profile_code: string | null;
  updated_at: string;
  deleted_at: string | null;
};

/** Raden slik den står i databasen (med SQL, utenom kjernen). Datoene som tekst. */
async function agreementRow(id: string): Promise<AgreementDbRow> {
  const [row] = await db.execute<AgreementDbRow>(sql`
    select id, organization_id, firm_id, name, valid_from::text as valid_from,
      valid_to::text as valid_to, premise_text, report_profile_code,
      updated_at::text as updated_at, deleted_at::text as deleted_at
    from client_agreements where id = ${id}`);
  if (!row) throw new Error("fant ikke avtalen");
  return row;
}

async function agreementRowsIn(organizationId: string): Promise<AgreementDbRow[]> {
  const rows = await db.execute<{ id: string }>(
    sql`select id from client_agreements where organization_id = ${organizationId}`,
  );
  return Promise.all([...rows].map((row) => agreementRow(row.id)));
}

async function agreementCount(): Promise<number> {
  const [row] = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from client_agreements`,
  );
  return row?.n ?? 0;
}

async function rowCount(table: typeof auditLog | typeof events) {
  const [row] = await db.select({ n: count() }).from(table);
  return row?.n ?? 0;
}

async function tableCounts() {
  return {
    agreements: await agreementCount(),
    auditLog: await rowCount(auditLog),
    events: await rowCount(events),
  };
}

async function agreementAudit(organizationId: string) {
  return (await db.select().from(auditLog).where(eq(auditLog.organizationId, organizationId)))
    .filter((row) => row.entityType === "client_agreement")
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
}

/** Feilen fra et kall, eller `null` når kallet lyktes. */
async function caught(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => null,
    (error: unknown) => error,
  );
}

/** Ukjent, fremmed eller slettet id: `NotFoundError` (kortet) eller `AccessDeniedError`. */
async function expectNotFound(run: Promise<unknown>) {
  const error = await caught(run);
  expect(error, "kallet skulle blitt avvist").not.toBeNull();
  expect(
    error instanceof core.NotFoundError || error instanceof AccessDeniedError,
    `NotFoundError eller AccessDeniedError (fikk ${String(error)})`,
  ).toBe(true);
}

/** Postgres-feilkoden, også når Drizzle har pakket feilen inn. */
function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Avvist i kjernen med norsk feil, ikke av databasen. */
async function expectRejectedInCore(run: Promise<unknown>) {
  const error = await caught(run);
  expect(error, "kallet skulle blitt avvist").not.toBeNull();
  expect(pgCode(error), `databasefeil (fikk ${String(error)})`).toBeUndefined();
  const message = error instanceof Error ? error.message : String(error);
  expect(message).not.toMatch(/violates|foreign key|constraint|insert into|update /i);
}

/** Sifrene fjernes, så navnet aldri ligner et fødselsnummer (11 sifre på rad i en uuid). */
function digitFree(id: string) {
  return id.replace(/\d/g, "");
}

// ---------------------------------------------------------------------------------------------
// 4.1 Tilgang per rolle
// ---------------------------------------------------------------------------------------------

type RoleCase = { name: string; roles: EmployeeRole[]; editAll: boolean };

const ROLE_CASES: RoleCase[] = (["inspector", "office", "manager", "admin"] as const).flatMap(
  (role) =>
    [true, false].map((editAll) => ({
      name: `${role}, innstillingen ${editAll ? "på" : "av"}`,
      roles: [role] as EmployeeRole[],
      editAll,
    })),
);

const NON_ADMIN_CASES = ROLE_CASES.filter((c) => c.roles[0] !== "admin");

describe("4.1 tilgang per rolle", () => {
  it.each(ROLE_CASES)("4.1.1 $name kan lese listen og avtalen", async ({ roles, editAll }) => {
    const org = await createOrganization();
    await setInspectorsEditAll(org.id, editAll);
    const agreement = await createClientAgreement(org.id);
    const { actor } = await person(org.id, roles);

    expect((await core.listAgreements(actor, org.id)).map((row) => row.id)).toEqual([agreement.id]);
    expect((await core.getAgreement(actor, org.id, agreement.id)).id).toBe(agreement.id);
  });

  it.each(NON_ADMIN_CASES)(
    "4.1.2/4.1.3 $name får AccessDeniedError på opprette, endre og fjerne; ingenting endres",
    async ({ roles, editAll }) => {
      const org = await createOrganization();
      await setInspectorsEditAll(org.id, editAll);
      const firm = await insurer(org.id);
      const agreement = await createClientAgreement(org.id, { firmId: firm.id });
      const { actor } = await person(org.id, roles);
      const before = await tableCounts();
      const rowBefore = await agreementRow(agreement.id);

      await expect(core.createAgreement(actor, org.id, agreementInput(firm.id))).rejects.toThrow(
        AccessDeniedError,
      );
      await expect(
        core.updateAgreement(
          actor,
          org.id,
          agreement.id,
          agreementInput(firm.id, { name: "Endret avtale" }),
        ),
      ).rejects.toThrow(AccessDeniedError);
      await expect(core.deleteAgreement(actor, org.id, agreement.id)).rejects.toThrow(
        AccessDeniedError,
      );

      expect(await tableCounts()).toEqual(before);
      expect(await agreementRow(agreement.id)).toEqual(rowBefore);
    },
  );

  it("4.1.3 takstmann med access.inspectors_edit_all på får fortsatt AccessDeniedError på skriving", async () => {
    const org = await createOrganization();
    await setInspectorsEditAll(org.id, true);
    const firm = await insurer(org.id);
    const agreement = await createClientAgreement(org.id, { firmId: firm.id });
    const { actor } = await person(org.id, ["inspector"]);
    const before = await tableCounts();

    await expect(core.createAgreement(actor, org.id, agreementInput(firm.id))).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(
      core.updateAgreement(actor, org.id, agreement.id, agreementInput(firm.id)),
    ).rejects.toThrow(AccessDeniedError);
    await expect(core.deleteAgreement(actor, org.id, agreement.id)).rejects.toThrow(
      AccessDeniedError,
    );
    expect(await tableCounts()).toEqual(before);
  });

  type Denied = { name: string; make: (organizationId: string) => Promise<Actor> };
  const DENIED: Denied[] = [
    { name: "uten ansattrad", make: async () => createUser() },
    {
      name: "deaktivert ansatt (admin)",
      make: async (organizationId) => {
        const { actor, employee } = await person(organizationId, ["admin"]);
        await db
          .update(employees)
          .set({ deactivatedAt: DELETED })
          .where(eq(employees.id, employee.id));
        return actor;
      },
    },
    {
      name: "slettet ansatt (admin)",
      make: async (organizationId) => {
        const { actor, employee } = await person(organizationId, ["admin"]);
        await db.update(employees).set({ deletedAt: DELETED }).where(eq(employees.id, employee.id));
        return actor;
      },
    },
  ];

  it.each(DENIED)(
    "4.1.4 $name får AccessDeniedError på alle fem avtaletjenestene",
    async ({ make }) => {
      const org = await createOrganization();
      const firm = await insurer(org.id);
      const agreement = await createClientAgreement(org.id, { firmId: firm.id });
      const actor = await make(org.id);
      const before = await tableCounts();

      await expect(core.listAgreements(actor, org.id)).rejects.toThrow(AccessDeniedError);
      await expect(core.getAgreement(actor, org.id, agreement.id)).rejects.toThrow(
        AccessDeniedError,
      );
      await expect(core.createAgreement(actor, org.id, agreementInput(firm.id))).rejects.toThrow(
        AccessDeniedError,
      );
      await expect(
        core.updateAgreement(actor, org.id, agreement.id, agreementInput(firm.id)),
      ).rejects.toThrow(AccessDeniedError);
      await expect(core.deleteAgreement(actor, org.id, agreement.id)).rejects.toThrow(
        AccessDeniedError,
      );
      expect(await tableCounts()).toEqual(before);
    },
  );

  // Regel 11: admin stenges aldri ute. Testen skal aldri fjernes.
  it("4.1.5 admin uten andre roller og uten sertifisering kan lese, opprette, endre og slette", async () => {
    const { org, admin } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);
    const firm = await insurer(org.id);

    const created = await core.createAgreement(admin, org.id, agreementInput(firm.id));
    await core.updateAgreement(
      admin,
      org.id,
      created.id,
      agreementInput(firm.id, { name: "Testavtale endret" }),
    );
    expect((await agreementRow(created.id)).name).toBe("Testavtale endret");
    expect((await core.listAgreements(admin, org.id)).map((row) => row.id)).toEqual([created.id]);
    expect((await core.getAgreement(admin, org.id, created.id)).id).toBe(created.id);

    await core.deleteAgreement(admin, org.id, created.id);
    expect((await agreementRow(created.id)).deleted_at).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// 4.2 Tenant-isolasjon (regel 2)
// ---------------------------------------------------------------------------------------------

describe("4.2 tenant-isolasjon", () => {
  it("4.2.1 listAgreements viser aldri avtaler fra en annen organisasjon", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => ({
        a: [(await createClientAgreement(grantA.organizationId)).id],
        b: [(await createClientAgreement(grantB.organizationId)).id],
      }),
      query: (actor, organizationId) => core.listAgreements(actor, organizationId),
      idOf: (row) => row.id,
    });
  });

  it("4.2.2 getAgreement henter bare avtale i egen organisasjon", async () => {
    const agreementFor = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const grant of [grantA, grantB]) {
          agreementFor.set(
            grant.organizationId,
            (await createClientAgreement(grant.organizationId)).id,
          );
        }
        return {
          a: [agreementFor.get(grantA.organizationId)!],
          b: [agreementFor.get(grantB.organizationId)!],
        };
      },
      query: async (actor, organizationId) => [
        await core.getAgreement(
          actor,
          organizationId,
          agreementFor.get(organizationId) ?? randomUUID(),
        ),
      ],
      idOf: (row) => row.id,
    });
  });

  it("4.2.3 createAgreement legger alltid avtalen i egen organisasjon", async () => {
    const firmFor = new Map<string, string>();
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        for (const grant of [grantA, grantB]) {
          firmFor.set(grant.organizationId, (await insurer(grant.organizationId)).id);
        }
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor, organizationId) => {
        const created = await core.createAgreement(
          actor,
          organizationId,
          agreementInput(firmFor.get(organizationId) ?? randomUUID()),
        );
        const stored = await agreementRow(created.id);
        return [{ organizationId: stored.organization_id }];
      },
      idOf: (row) => row.organizationId,
    });

    const rowsB = await agreementRowsIn(orgB);
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0]?.firm_id).toBe(firmFor.get(orgB));
    expect(await agreementCount()).toBe(2);
  });

  it("4.2.4 updateAgreement endrer bare avtale i egen organisasjon", async () => {
    const agreementFor = new Map<string, { id: string; firmId: string }>();
    let agreementB = "";
    let employeeB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const grant of [grantA, grantB]) {
          const agreement = await createClientAgreement(grant.organizationId);
          agreementFor.set(grant.organizationId, { id: agreement.id, firmId: agreement.firmId });
        }
        agreementB = agreementFor.get(grantB.organizationId)!.id;
        employeeB = grantB.employeeId;
        return { a: [agreementFor.get(grantA.organizationId)!.id], b: [agreementB] };
      },
      query: async (actor, organizationId) => {
        const target = agreementFor.get(organizationId) ?? {
          id: randomUUID(),
          firmId: randomUUID(),
        };
        await core.updateAgreement(
          actor,
          organizationId,
          target.id,
          agreementInput(target.firmId, { name: `Endret av ${digitFree(actor.id)}` }),
        );
        const stored = await agreementRow(target.id);
        return stored.organization_id === organizationId ? [{ id: stored.id }] : [];
      },
      idOf: (row) => row.id,
    });

    // Bs avtale er endret bare av admin i B
    const [adminB] = await db.select().from(employees).where(eq(employees.id, employeeB));
    expect((await agreementRow(agreementB)).name).toBe(`Endret av ${digitFree(adminB!.userId!)}`);
    const logB = await agreementAudit(adminB!.organizationId);
    expect(logB.filter((row) => row.action === "update")).toHaveLength(1);
    expect(logB[0]?.entityId).toBe(agreementB);
  });

  it("4.2.5 deleteAgreement sletter bare avtale i egen organisasjon", async () => {
    const agreementFor = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const grant of [grantA, grantB]) {
          agreementFor.set(
            grant.organizationId,
            (await createClientAgreement(grant.organizationId)).id,
          );
        }
        return {
          a: [agreementFor.get(grantA.organizationId)!],
          b: [agreementFor.get(grantB.organizationId)!],
        };
      },
      query: async (actor, organizationId) => {
        const id = agreementFor.get(organizationId) ?? randomUUID();
        await core.deleteAgreement(actor, organizationId, id);
        const stored = await agreementRow(id);
        return stored.organization_id === organizationId && stored.deleted_at !== null
          ? [{ id: stored.id }]
          : [];
      },
      idOf: (row) => row.id,
    });

    // Hver avtale er slettet én gang, og loggraden står i egen organisasjon
    for (const [organizationId, id] of agreementFor) {
      expect((await agreementRow(id)).deleted_at).not.toBeNull();
      const log = await agreementAudit(organizationId);
      expect(log.map((row) => [row.action, row.entityId])).toEqual([["delete", id]]);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 4.3 Fremmed id i egen organisasjon (IDOR)
// ---------------------------------------------------------------------------------------------

describe("4.3 fremmed eller ugyldig id", () => {
  it("4.3.1 Bs avtale-id i getAgreement, updateAgreement og deleteAgreement → avvist; Bs avtale uendret, ingen loggrad", async () => {
    const { org: orgA, admin: adminA } = await orgWithAdmin("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const firmA = await insurer(orgA.id);
    const agreementB = await createClientAgreement(orgB.id);
    const before = await agreementRow(agreementB.id);

    await expectNotFound(core.getAgreement(adminA, orgA.id, agreementB.id));
    await expectNotFound(
      core.updateAgreement(
        adminA,
        orgA.id,
        agreementB.id,
        agreementInput(firmA.id, { name: "Kapret avtale" }),
      ),
    );
    await expectNotFound(core.deleteAgreement(adminA, orgA.id, agreementB.id));

    const after = await agreementRow(agreementB.id);
    expect(after).toEqual(before);
    expect(after.updated_at).toBe(before.updated_at);
    expect(after.deleted_at).toBeNull();
    expect(await rowCount(auditLog)).toBe(0);
  });

  it("4.3.2 Bs firmId i createAgreement og updateAgreement → avvist i kjernen, ingen rad, ingen loggrad", async () => {
    const { org: orgA, admin: adminA } = await orgWithAdmin("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const firmB = await insurer(orgB.id);
    const agreementA = await createClientAgreement(orgA.id);
    const before = await tableCounts();
    const rowBefore = await agreementRow(agreementA.id);

    await expectRejectedInCore(core.createAgreement(adminA, orgA.id, agreementInput(firmB.id)));
    await expectRejectedInCore(
      core.updateAgreement(adminA, orgA.id, agreementA.id, agreementInput(firmB.id)),
    );

    expect(await tableCounts()).toEqual(before);
    expect(await agreementRow(agreementA.id)).toEqual(rowBefore);
  });

  it("4.3.3 slettet firma som firmId → avvist i kjernen, ingen rad, ingen loggrad", async () => {
    const { org, admin } = await orgWithAdmin();
    const deletedFirm = await createFirm(org.id, { name: "Testforsikring AS", deletedAt: DELETED });
    const agreement = await createClientAgreement(org.id);
    const before = await tableCounts();
    const rowBefore = await agreementRow(agreement.id);

    await expectRejectedInCore(core.createAgreement(admin, org.id, agreementInput(deletedFirm.id)));
    await expectRejectedInCore(
      core.updateAgreement(admin, org.id, agreement.id, agreementInput(deletedFirm.id)),
    );

    expect(await tableCounts()).toEqual(before);
    expect(await agreementRow(agreement.id)).toEqual(rowBefore);
  });

  it("4.3.4 organizationId: orgB.id i input ignoreres; raden lagres i A", async () => {
    const { org: orgA, admin: adminA } = await orgWithAdmin("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const firmA = await insurer(orgA.id);

    const created = await core.createAgreement(
      adminA,
      orgA.id,
      agreementInput(firmA.id, { organizationId: orgB.id }),
    );
    expect((await agreementRow(created.id)).organization_id).toBe(orgA.id);
    expect(await agreementRowsIn(orgB.id)).toEqual([]);
  });

  it.each([randomUUID(), "ikke-en-id"])(
    "4.3.5 avtale-id %s → NotFoundError/AccessDeniedError, aldri databasefeil",
    async (id) => {
      const { org, admin } = await orgWithAdmin();
      const firm = await insurer(org.id);
      await expectNotFound(core.getAgreement(admin, org.id, id));
      await expectNotFound(core.updateAgreement(admin, org.id, id, agreementInput(firm.id)));
      await expectNotFound(core.deleteAgreement(admin, org.id, id));
      expect(await agreementCount()).toBe(0);
      expect(await rowCount(auditLog)).toBe(0);
    },
  );

  it.each([randomUUID(), "ikke-en-id"])(
    "4.3.5 firmId %s i createAgreement → avvist i kjernen, ingen rad",
    async (firmId) => {
      const { org, admin } = await orgWithAdmin();
      await expectRejectedInCore(core.createAgreement(admin, org.id, agreementInput(firmId)));
      expect(await agreementCount()).toBe(0);
      expect(await rowCount(auditLog)).toBe(0);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// 4.4 Opprette, endre, myk sletting
// ---------------------------------------------------------------------------------------------

describe("4.4 opprette, endre og myk sletting", () => {
  it("4.4.1 createAgreement lagrer alle feltene i organisasjonen fra tilgangssjekken", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await insurer(org.id);

    const created = await core.createAgreement(
      admin,
      org.id,
      agreementInput(firm.id, { validFrom: "2026-03-01", validTo: "2026-12-31" }),
    );
    expect(await agreementRow(created.id)).toMatchObject({
      organization_id: org.id,
      firm_id: firm.id,
      name: AGREEMENT_NAME,
      valid_from: "2026-03-01",
      valid_to: "2026-12-31",
      premise_text: PREMISE,
      report_profile_code: "test-profil",
      deleted_at: null,
    });
  });

  it("4.4.1 tom til-dato, premissetekst og rapportprofil lagres som null", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await insurer(org.id);
    const created = await core.createAgreement(
      admin,
      org.id,
      agreementInput(firm.id, { validTo: "", premiseText: "", reportProfileCode: "" }),
    );
    expect(await agreementRow(created.id)).toMatchObject({
      valid_to: null,
      premise_text: null,
      report_profile_code: null,
    });
  });

  it("4.4.2 updateAgreement lagrer nye verdier og oppdaterer updated_at", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await insurer(org.id);
    const otherFirm = await insurer(org.id, "Testforsikring Nord AS");
    const agreement = await createClientAgreement(org.id, { firmId: firm.id });
    const before = await agreementRow(agreement.id);

    await core.updateAgreement(
      admin,
      org.id,
      agreement.id,
      agreementInput(otherFirm.id, {
        name: "Testavtale endret",
        validFrom: "2026-02-01",
        validTo: "2027-01-31",
        premiseText: "Premiss for test, endret. Ikke ekte tekst.",
        reportProfileCode: "test-profil-2",
      }),
    );

    const after = await agreementRow(agreement.id);
    expect(after).toMatchObject({
      organization_id: org.id,
      firm_id: otherFirm.id,
      name: "Testavtale endret",
      valid_from: "2026-02-01",
      valid_to: "2027-01-31",
      premise_text: "Premiss for test, endret. Ikke ekte tekst.",
      report_profile_code: "test-profil-2",
      deleted_at: null,
    });
    expect(new Date(after.updated_at).getTime()).toBeGreaterThan(
      new Date(before.updated_at).getTime(),
    );
  });

  it("4.4.2 til-dato før fra-dato i updateAgreement → ZodError-melding, ingenting endret", async () => {
    const { org, admin } = await orgWithAdmin();
    const agreement = await createClientAgreement(org.id);
    const before = await agreementRow(agreement.id);
    await expectRejectedInCore(
      core.updateAgreement(
        admin,
        org.id,
        agreement.id,
        agreementInput(agreement.firmId, { validFrom: "2026-03-01", validTo: "2026-02-28" }),
      ),
    );
    expect(await agreementRow(agreement.id)).toEqual(before);
    expect(await rowCount(auditLog)).toBe(0);
  });

  it("4.4.3 deleteAgreement: deleted_at satt, raden finnes, vises ikke i listen", async () => {
    const { org, admin } = await orgWithAdmin();
    const kept = await createClientAgreement(org.id, { name: "Testavtale beholdt" });
    const removed = await createClientAgreement(org.id, { name: "Testavtale fjernet" });

    await core.deleteAgreement(admin, org.id, removed.id);

    const row = await agreementRow(removed.id);
    expect(row.deleted_at).not.toBeNull();
    expect(row.name).toBe("Testavtale fjernet");
    expect((await core.listAgreements(admin, org.id)).map((r) => r.id)).toEqual([kept.id]);

    // Kortet lar getAgreement vise den slettede (med deletedAt) eller gi NotFoundError
    const result = await caught(core.getAgreement(admin, org.id, removed.id));
    if (result === null) {
      const shown = (await core.getAgreement(admin, org.id, removed.id)) as {
        deletedAt?: unknown;
      };
      expect(shown.deletedAt).toBeTruthy();
    } else {
      expect(result).toBeInstanceOf(core.NotFoundError);
    }
  });

  it("4.4.4 slettet avtale: updateAgreement og deleteAgreement → NotFoundError, ingen loggrad, deleted_at uendret", async () => {
    const { org, admin } = await orgWithAdmin();
    const agreement = await createClientAgreement(org.id, { deletedAt: DELETED });
    const before = await agreementRow(agreement.id);

    await expect(
      core.updateAgreement(
        admin,
        org.id,
        agreement.id,
        agreementInput(agreement.firmId, { name: "Testavtale gjenopplivet" }),
      ),
    ).rejects.toThrow(core.NotFoundError);
    await expect(core.deleteAgreement(admin, org.id, agreement.id)).rejects.toThrow(
      core.NotFoundError,
    );

    expect(await agreementRow(agreement.id)).toEqual(before);
    expect(await rowCount(auditLog)).toBe(0);
  });

  it("4.4.5 ingen tjeneste i src/core/agreements sletter permanent", () => {
    const folder = path.resolve(process.cwd(), "src/core/agreements");
    const sources = readdirSync(folder).filter(
      (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
    );
    expect(sources.length).toBeGreaterThan(0);
    for (const name of sources) {
      const text = readFileSync(path.join(folder, name), "utf8");
      expect(text, name).not.toMatch(/\.delete\s*\(/);
      expect(text, name).not.toMatch(/delete\s+from/i);
    }
  });

  it("4.4.6 listen har firmanavnet, er sortert på navn og viser utløpte avtaler", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await insurer(org.id, "Testforsikring AS");
    const later = await createClientAgreement(org.id, { firmId: firm.id, name: "Testavtale B" });
    const expired = await createClientAgreement(org.id, {
      firmId: firm.id,
      name: "Testavtale A utløpt",
      validFrom: "2025-01-01",
      validTo: "2025-12-31",
    });
    await createClientAgreement(org.id, {
      firmId: firm.id,
      name: "Testavtale C",
      deletedAt: DELETED,
    });

    const list = await core.listAgreements(admin, org.id);
    expect(list.map((row) => row.id)).toEqual([expired.id, later.id]);
    for (const row of list) {
      expect(row).toMatchObject({ firmName: "Testforsikring AS" });
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 4.5 Revisjonslogg
// ---------------------------------------------------------------------------------------------

describe("4.5 revisjonslogg", () => {
  it("4.5.1 én rad per skriving med client_agreement, riktig organisasjon og id", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await insurer(org.id);

    const created = await core.createAgreement(admin, org.id, agreementInput(firm.id));
    await core.updateAgreement(
      admin,
      org.id,
      created.id,
      agreementInput(firm.id, { premiseText: "Premiss for test, ny. Ikke ekte tekst." }),
    );
    await core.deleteAgreement(admin, org.id, created.id);

    const log = await agreementAudit(org.id);
    expect(log.map((row) => row.action)).toEqual(["create", "update", "delete"]);
    for (const row of log) {
      expect(row.organizationId).toBe(org.id);
      expect(row.entityId).toBe(created.id);
    }
    expect(await rowCount(auditLog)).toBe(3);
  });

  it("4.5.2 update har navnene på feltene som ble endret", async () => {
    const { org, admin } = await orgWithAdmin();
    const agreement = await createClientAgreement(org.id, {
      premiseText: PREMISE,
      reportProfileCode: "test-profil",
    });

    await core.updateAgreement(
      admin,
      org.id,
      agreement.id,
      agreementInput(agreement.firmId, {
        premiseText: "Premiss for test, ny. Ikke ekte tekst.",
      }),
    );

    const [row] = await agreementAudit(org.id);
    expect(row?.action).toBe("update");
    expect(JSON.stringify(row?.changes)).toContain("premiseText");
  });

  it.each(["create", "update", "delete"] as const)(
    "4.5.3 premisseteksten logges aldri (%s)",
    async (action) => {
      const { org, admin } = await orgWithAdmin();
      const firm = await insurer(org.id);
      if (action === "create") {
        await core.createAgreement(admin, org.id, agreementInput(firm.id));
      } else {
        const agreement = await createClientAgreement(org.id, {
          firmId: firm.id,
          premiseText: PREMISE,
        });
        if (action === "update") {
          await core.updateAgreement(
            admin,
            org.id,
            agreement.id,
            agreementInput(firm.id, { premiseText: `${PREMISE} Endret.` }),
          );
        } else {
          await core.deleteAgreement(admin, org.id, agreement.id);
        }
      }

      const log = await agreementAudit(org.id);
      expect(log.map((row) => row.action)).toEqual([action]);
      for (const row of log) expect(JSON.stringify(row)).not.toContain(PREMISE_MARK);
      const allEvents = await db.select().from(events).where(eq(events.organizationId, org.id));
      for (const row of allEvents) expect(JSON.stringify(row)).not.toContain(PREMISE_MARK);
    },
  );

  it("4.5.4 ingen loggrad ved avvist tilgang, valideringsfeil eller NotFoundError", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await insurer(org.id);
    const { actor: office } = await person(org.id, ["office"]);
    const agreement = await createClientAgreement(org.id, { firmId: firm.id });

    await expect(core.createAgreement(office, org.id, agreementInput(firm.id))).rejects.toThrow(
      AccessDeniedError,
    );
    await expectRejectedInCore(
      core.createAgreement(admin, org.id, agreementInput(firm.id, { name: "" })),
    );
    await expectRejectedInCore(
      core.createAgreement(
        admin,
        org.id,
        agreementInput(firm.id, { validFrom: "2026-03-01", validTo: "2026-02-28" }),
      ),
    );
    await expectNotFound(core.deleteAgreement(admin, org.id, randomUUID()));
    await core.deleteAgreement(admin, org.id, agreement.id);
    await expect(core.deleteAgreement(admin, org.id, agreement.id)).rejects.toThrow(
      core.NotFoundError,
    );

    expect((await agreementAudit(org.id)).map((row) => row.action)).toEqual(["delete"]);
  });
});
