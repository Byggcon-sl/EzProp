import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { AccessDeniedError, type Actor } from "@/core/access";
import { db } from "@/db/client";
import {
  auditLog,
  contacts,
  employees,
  events,
  firms,
  organizations,
  type EmployeeRole,
} from "@/db/schema";
import {
  createContact as insertContact,
  createEmployee,
  createFirm as insertFirm,
  createOrganization,
  createUser,
  grantPermission,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import * as core from "./index";

/*
 * Firma i kontaktregisteret: kjernen i src/core/contacts (firms).
 * Testplan: docs/funksjoner/fase2a-kontakter-firma-testplan.md avsnitt 5. Kontaktdelen står i
 * contacts.test.ts, transaksjonen i contacts-transaction.test.ts.
 *
 * Avvises uten: 5.1 (med admin-testen 5.1.5), 5.2 og 5.3. Regel 2 og 11.
 *
 * Testdata er oppdiktet: «Testmegling AS», organisasjonsnumre som starter med 000, notat
 * «Vil ha rapport før kl. 12».
 *
 * Støtter hovedmål: tid (ett firma per organisasjonsnummer; dubletten stoppes med id og navn,
 * så skjermen kan lenke til firmaet som finnes) og reklamasjoner (aldri data fra en annen
 * organisasjon, aldri personopplysninger i revisjonsloggen).
 */

beforeEach(resetDatabase);

const FIRM_NAME = "Testmegling AS";
const NOTE = "Vil ha rapport før kl. 12";
const ORG_A = "000000019";
const ORG_TWO = "000000027";
const ORG_SEARCH = "000000108";

type FirmInput = Parameters<typeof core.createFirm>[2];

function firmInput(overrides: Record<string, unknown> = {}): FirmInput {
  return {
    name: FIRM_NAME,
    orgNumber: ORG_A,
    firmType: "broker_firm",
    notes: null,
    ...overrides,
  } as FirmInput;
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

async function rowCount(table: typeof firms | typeof contacts | typeof auditLog | typeof events) {
  const [row] = await db.select({ n: count() }).from(table);
  return row?.n ?? 0;
}

async function tableCounts() {
  return {
    firms: await rowCount(firms),
    contacts: await rowCount(contacts),
    auditLog: await rowCount(auditLog),
    events: await rowCount(events),
  };
}

async function firmRow(id: string) {
  const [row] = await db.select().from(firms).where(eq(firms.id, id));
  if (!row) throw new Error("fant ikke firmaet");
  return row;
}

async function auditFor(organizationId: string) {
  return db.select().from(auditLog).where(eq(auditLog.organizationId, organizationId));
}

/** Feilen fra et kall, eller `null` når kallet lyktes. */
async function caught(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => null,
    (error: unknown) => error,
  );
}

const FIRM_KEYS = ["firmType", "id", "name", "notes", "orgNumber"].sort();
const FIRM_LIST_KEYS = ["firmType", "id", "name", "orgNumber"].sort();
const FIRM_DETAIL_KEYS = [...FIRM_KEYS, "contacts"].sort();
const FIRM_CONTACT_KEYS = ["email", "firstName", "id", "lastName", "phone"].sort();
const FORBIDDEN_KEYS = ["deletedAt", "deletedBy", "rowVersion", "organizationId", "createdBy"];

function expectKeys(row: object, keys: string[]) {
  expect(Object.keys(row).sort()).toEqual(keys);
  for (const key of FORBIDDEN_KEYS) expect(row).not.toHaveProperty(key);
}

// ---------------------------------------------------------------------------------------------
// 5.1 Tilgang per rolle
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

describe("5.1 tilgang per rolle (firma)", () => {
  it.each(ROLE_CASES)("5.1.1 $name kan lese listen og firmaet", async ({ roles, editAll }) => {
    const org = await createOrganization();
    await setInspectorsEditAll(org.id, editAll);
    const firm = await insertFirm(org.id);
    const { actor } = await person(org.id, roles);

    expect((await core.listFirms(actor, org.id)).map((row) => row.id)).toEqual([firm.id]);
    expect((await core.getFirm(actor, org.id, firm.id)).id).toBe(firm.id);
  });

  it.each(ROLE_CASES.filter((c) => !(c.roles[0] === "inspector" && !c.editAll)))(
    "5.1.2 $name kan legge inn og endre firma",
    async ({ roles, editAll }) => {
      const org = await createOrganization();
      await setInspectorsEditAll(org.id, editAll);
      const { actor } = await person(org.id, roles);

      const created = await core.createFirm(actor, org.id, firmInput());
      const updated = await core.updateFirm(actor, org.id, created.id, firmInput({ notes: NOTE }));
      expect(updated.notes).toBe(NOTE);
    },
  );

  it("5.1.2 takstmann med innstillingen av får AccessDeniedError på createFirm og updateFirm; ingenting endres", async () => {
    const org = await createOrganization();
    await setInspectorsEditAll(org.id, false);
    const firm = await insertFirm(org.id, { name: FIRM_NAME });
    const { actor } = await person(org.id, ["inspector"]);
    const before = await tableCounts();
    const rowBefore = await firmRow(firm.id);

    await expect(core.createFirm(actor, org.id, firmInput({ orgNumber: ORG_TWO }))).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(
      core.updateFirm(actor, org.id, firm.id, firmInput({ name: "Endret AS", orgNumber: null })),
    ).rejects.toThrow(AccessDeniedError);

    expect(await tableCounts()).toEqual(before);
    expect(await firmRow(firm.id)).toEqual(rowBefore);
  });

  it("5.1.3 takstmann med innstillingen av og enkeltrettigheten assignment.edit kan legge inn og endre", async () => {
    const org = await createOrganization();
    await setInspectorsEditAll(org.id, false);
    const { actor, employee } = await person(org.id, ["inspector"]);
    await grantPermission(employee, "assignment.edit");

    const created = await core.createFirm(actor, org.id, firmInput());
    const updated = await core.updateFirm(actor, org.id, created.id, firmInput({ notes: NOTE }));
    expect(updated.notes).toBe(NOTE);
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
          .set({ deactivatedAt: new Date("2026-11-01T08:00:00Z") })
          .where(eq(employees.id, employee.id));
        return actor;
      },
    },
    {
      name: "slettet ansatt (admin)",
      make: async (organizationId) => {
        const { actor, employee } = await person(organizationId, ["admin"]);
        await db
          .update(employees)
          .set({ deletedAt: new Date("2026-11-01T08:00:00Z") })
          .where(eq(employees.id, employee.id));
        return actor;
      },
    },
    {
      name: "ansatt uten roller",
      make: async (organizationId) => (await person(organizationId, [])).actor,
    },
  ];

  it.each(DENIED)(
    "5.1.4 $name får AccessDeniedError på alle fire firmatjenestene",
    async ({ make }) => {
      const org = await createOrganization();
      await setInspectorsEditAll(org.id, true);
      const firm = await insertFirm(org.id);
      const actor = await make(org.id);
      const before = await tableCounts();

      await expect(core.listFirms(actor, org.id)).rejects.toThrow(AccessDeniedError);
      await expect(core.getFirm(actor, org.id, firm.id)).rejects.toThrow(AccessDeniedError);
      await expect(
        core.createFirm(actor, org.id, firmInput({ orgNumber: ORG_TWO })),
      ).rejects.toThrow(AccessDeniedError);
      await expect(
        core.updateFirm(actor, org.id, firm.id, firmInput({ orgNumber: null })),
      ).rejects.toThrow(AccessDeniedError);
      expect(await tableCounts()).toEqual(before);
    },
  );

  // Regel 11: admin stenges aldri ute. Testen skal aldri fjernes.
  it("5.1.5 admin uten andre roller, innstillingen av, kan lese og skrive med alle fire firmatjenestene", async () => {
    const { org, admin } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);

    const created = await core.createFirm(admin, org.id, firmInput());
    const updated = await core.updateFirm(admin, org.id, created.id, firmInput({ notes: NOTE }));
    expect(updated.notes).toBe(NOTE);
    expect((await core.listFirms(admin, org.id)).map((row) => row.id)).toEqual([created.id]);
    expect((await core.getFirm(admin, org.id, created.id)).notes).toBe(NOTE);
  });
});

// ---------------------------------------------------------------------------------------------
// 5.2 Tenant-isolasjon (regel 2)
// ---------------------------------------------------------------------------------------------

describe("5.2 tenant-isolasjon (firma)", () => {
  it("5.2.1 listFirms viser aldri firma fra en annen organisasjon", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => ({
        a: [(await insertFirm(grantA.organizationId)).id],
        b: [(await insertFirm(grantB.organizationId)).id],
      }),
      query: (actor, organizationId) => core.listFirms(actor, organizationId),
      idOf: (row) => row.id,
    });
  });

  it("5.2.2 getFirm henter bare firma i egen organisasjon", async () => {
    const firmFor = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const grant of [grantA, grantB]) {
          firmFor.set(grant.organizationId, (await insertFirm(grant.organizationId)).id);
        }
        return {
          a: [firmFor.get(grantA.organizationId)!],
          b: [firmFor.get(grantB.organizationId)!],
        };
      },
      query: async (actor, organizationId) => [
        await core.getFirm(actor, organizationId, firmFor.get(organizationId) ?? randomUUID()),
      ],
      idOf: (row) => row.id,
    });
  });

  it("5.2.3 getFirm(...).contacts har bare kontakter fra egen organisasjon", async () => {
    const firmFor = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids: Record<string, string> = {};
        for (const grant of [grantA, grantB]) {
          const firm = await insertFirm(grant.organizationId);
          firmFor.set(grant.organizationId, firm.id);
          ids[grant.organizationId] = (
            await insertContact(grant.organizationId, { firmId: firm.id })
          ).id;
        }
        return { a: [ids[grantA.organizationId]!], b: [ids[grantB.organizationId]!] };
      },
      query: async (actor, organizationId) =>
        (await core.getFirm(actor, organizationId, firmFor.get(organizationId) ?? randomUUID()))
          .contacts,
      idOf: (row) => row.id,
    });
  });

  it("5.2.4 createFirm legger alltid firmaet i egen organisasjon; dublettsjekken er per organisasjon", async () => {
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor, organizationId) => {
        // Samme nummer i begge organisasjonene
        const row = await core.createFirm(actor, organizationId, firmInput({ orgNumber: ORG_A }));
        const stored = await firmRow(row.id);
        return [{ organizationId: stored.organizationId }];
      },
      idOf: (row) => row.organizationId,
    });

    const firmsB = await db.select().from(firms).where(eq(firms.organizationId, orgB));
    expect(firmsB).toHaveLength(1);
    expect(firmsB[0]?.orgNumber).toBe(ORG_A);
    expect(await rowCount(firms)).toBe(2);
  });

  it("5.2.5 updateFirm endrer bare firma i egen organisasjon", async () => {
    // Sifrene fjernes, så navnet aldri ligner et fødselsnummer (11 sifre på rad i en uuid)
    const digitFree = (id: string) => id.replace(/\d/g, "");
    const firmFor = new Map<string, string>();
    let firmB = "";
    let employeeB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const grant of [grantA, grantB]) {
          firmFor.set(grant.organizationId, (await insertFirm(grant.organizationId)).id);
        }
        firmB = firmFor.get(grantB.organizationId)!;
        employeeB = grantB.employeeId;
        return { a: [firmFor.get(grantA.organizationId)!], b: [firmB] };
      },
      query: async (actor, organizationId) => [
        await core.updateFirm(
          actor,
          organizationId,
          firmFor.get(organizationId) ?? randomUUID(),
          firmInput({ name: `Endret av ${digitFree(actor.id)}`, orgNumber: null }),
        ),
      ],
      idOf: (row) => row.id,
    });

    // Bs firma er endret nøyaktig én gang, av admin i B
    const [adminB] = await db.select().from(employees).where(eq(employees.id, employeeB));
    const rowB = await firmRow(firmB);
    expect(rowB.name).toBe(`Endret av ${digitFree(adminB!.userId!)}`);
    expect(rowB.rowVersion).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------
// 5.3 Fremmed id i egen organisasjon (IDOR)
// ---------------------------------------------------------------------------------------------

describe("5.3 fremmed eller ugyldig firma-id", () => {
  it("5.3.1 Bs firma-id i getFirm og updateFirm → AccessDeniedError; Bs firma er uendret, ingen loggrad", async () => {
    const { org: orgA, admin: adminA } = await orgWithAdmin("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const firmB = await insertFirm(orgB.id, { name: FIRM_NAME, orgNumber: ORG_A });
    const before = await firmRow(firmB.id);

    await expect(core.getFirm(adminA, orgA.id, firmB.id)).rejects.toThrow(AccessDeniedError);
    await expect(
      core.updateFirm(
        adminA,
        orgA.id,
        firmB.id,
        firmInput({ name: "Kapret AS", orgNumber: ORG_TWO }),
      ),
    ).rejects.toThrow(AccessDeniedError);

    const after = await firmRow(firmB.id);
    expect(after).toEqual(before);
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(await rowCount(auditLog)).toBe(0);
  });

  it.each([randomUUID(), "ikke-en-id"])(
    "5.3.5 firma-id %s → AccessDeniedError, aldri databasefeil",
    async (id) => {
      const { org, admin } = await orgWithAdmin();
      await expect(core.getFirm(admin, org.id, id)).rejects.toThrow(AccessDeniedError);
      await expect(core.updateFirm(admin, org.id, id, firmInput())).rejects.toThrow(
        AccessDeniedError,
      );
      expect(await rowCount(firms)).toBe(0);
      expect(await rowCount(auditLog)).toBe(0);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// 5.4 Myk sletting
// ---------------------------------------------------------------------------------------------

describe("5.4 myk sletting (firma)", () => {
  const DELETED = new Date("2026-11-01T08:00:00Z");

  it("5.4.1 slettet firma: getFirm og updateFirm → AccessDeniedError; raden er urørt", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await insertFirm(org.id, { deletedAt: DELETED });
    const before = await firmRow(firm.id);

    await expect(core.getFirm(admin, org.id, firm.id)).rejects.toThrow(AccessDeniedError);
    await expect(
      core.updateFirm(admin, org.id, firm.id, firmInput({ orgNumber: null })),
    ).rejects.toThrow(AccessDeniedError);
    expect(await firmRow(firm.id)).toEqual(before);
    expect(await rowCount(auditLog)).toBe(0);
  });

  it("5.4.3 listFirms og søket viser ikke slettede firma; getFirm(...).contacts viser ikke slettede kontakter", async () => {
    const { org, admin } = await orgWithAdmin();
    const active = await insertFirm(org.id, { name: "Testmegling Aktiv AS" });
    await insertFirm(org.id, { name: "Testmegling Slettet AS", deletedAt: DELETED });
    const kept = await insertContact(org.id, { firmId: active.id, firstName: "Synlig" });
    await insertContact(org.id, { firmId: active.id, firstName: "Borte", deletedAt: DELETED });

    expect((await core.listFirms(admin, org.id)).map((row) => row.id)).toEqual([active.id]);
    expect(
      (await core.listFirms(admin, org.id, { query: "Testmegling" })).map((row) => row.id),
    ).toEqual([active.id]);
    expect(await core.listFirms(admin, org.id, { query: "Slettet" })).toEqual([]);
    expect((await core.getFirm(admin, org.id, active.id)).contacts.map((row) => row.id)).toEqual([
      kept.id,
    ]);
  });

  it("5.4.5 ingen tjeneste i src/core/contacts sletter permanent", () => {
    const folder = path.resolve(process.cwd(), "src/core/contacts");
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
});

// ---------------------------------------------------------------------------------------------
// 5.5 Dubletter (D17)
// ---------------------------------------------------------------------------------------------

describe("5.5 dubletter", () => {
  async function duplicateError(run: Promise<unknown>) {
    const error = await caught(run);
    expect(error).toBeInstanceOf(core.FirmDuplicateError);
    return error as InstanceType<typeof core.FirmDuplicateError>;
  }

  it("5.5.1 createFirm med nummer som finnes → FirmDuplicateError med id og navn; ingen ny rad, ingen loggrad", async () => {
    const { org, admin } = await orgWithAdmin();
    const existing = await insertFirm(org.id, { name: FIRM_NAME, orgNumber: ORG_A });
    const before = await tableCounts();

    const error = await duplicateError(
      core.createFirm(admin, org.id, firmInput({ name: "Annet navn AS", orgNumber: ORG_A })),
    );
    expect(error.firmId).toBe(existing.id);
    expect(error.firmName).toBe(FIRM_NAME);
    expect(await tableCounts()).toEqual(before);
  });

  it("5.5.2 createFirm med «000 000 019» når 000000019 finnes → dublett", async () => {
    const { org, admin } = await orgWithAdmin();
    const existing = await insertFirm(org.id, { orgNumber: ORG_A });
    const error = await duplicateError(
      core.createFirm(admin, org.id, firmInput({ orgNumber: "000 000 019" })),
    );
    expect(error.firmId).toBe(existing.id);
    expect(await rowCount(firms)).toBe(1);
  });

  it("5.5.3 updateFirm til et nummer et annet firma har → FirmDuplicateError; firmaet er uendret", async () => {
    const { org, admin } = await orgWithAdmin();
    const other = await insertFirm(org.id, { name: "Annen Testmegling AS", orgNumber: ORG_A });
    const firm = await insertFirm(org.id, { name: FIRM_NAME, orgNumber: ORG_TWO });
    const before = await firmRow(firm.id);

    const error = await duplicateError(
      core.updateFirm(
        admin,
        org.id,
        firm.id,
        firmInput({ name: "Nytt navn AS", orgNumber: ORG_A }),
      ),
    );
    expect(error.firmId).toBe(other.id);
    expect(error.firmName).toBe("Annen Testmegling AS");
    expect(await firmRow(firm.id)).toEqual(before);
    expect(await rowCount(auditLog)).toBe(0);
  });

  it("5.5.4 updateFirm med sitt eget nummer (bare navnet endres) går gjennom", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await insertFirm(org.id, { name: FIRM_NAME, orgNumber: ORG_A });
    const updated = await core.updateFirm(
      admin,
      org.id,
      firm.id,
      firmInput({ name: "Testmegling Nord AS", orgNumber: ORG_A }),
    );
    expect(updated.name).toBe("Testmegling Nord AS");
    expect((await firmRow(firm.id)).orgNumber).toBe(ORG_A);
  });

  it("5.5.5 et slettet firma med samme nummer er ingen dublett", async () => {
    const { org, admin } = await orgWithAdmin();
    await insertFirm(org.id, { orgNumber: ORG_A, deletedAt: new Date("2026-11-01T08:00:00Z") });
    const created = await core.createFirm(admin, org.id, firmInput({ orgNumber: ORG_A }));
    expect(created.orgNumber).toBe(ORG_A);
  });

  it("5.5.6 samme nummer i en annen organisasjon er ingen dublett", async () => {
    const { org, admin } = await orgWithAdmin("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    await insertFirm(orgB.id, { orgNumber: ORG_A });
    const created = await core.createFirm(admin, org.id, firmInput({ orgNumber: ORG_A }));
    expect((await firmRow(created.id)).organizationId).toBe(org.id);
  });

  it("5.5.7 feilen avbryter transaksjonen rent: neste kall med nytt nummer lykkes", async () => {
    const { org, admin } = await orgWithAdmin();
    const existing = await insertFirm(org.id, { orgNumber: ORG_A });
    await duplicateError(core.createFirm(admin, org.id, firmInput({ orgNumber: ORG_A })));
    const created = await core.createFirm(admin, org.id, firmInput({ orgNumber: ORG_TWO }));
    expect(created.orgNumber).toBe(ORG_TWO);

    await duplicateError(
      core.updateFirm(admin, org.id, created.id, firmInput({ orgNumber: ORG_A })),
    );
    const updated = await core.updateFirm(
      admin,
      org.id,
      created.id,
      firmInput({ orgNumber: ORG_SEARCH }),
    );
    expect(updated.orgNumber).toBe(ORG_SEARCH);
    expect(await rowCount(firms)).toBe(2);
    expect((await firmRow(existing.id)).orgNumber).toBe(ORG_A);
  });
});

// ---------------------------------------------------------------------------------------------
// 5.6 Søk
// ---------------------------------------------------------------------------------------------

describe("5.6 søk (firma)", () => {
  async function names(actor: Actor, organizationId: string, query?: string) {
    return (await core.listFirms(actor, organizationId, { query })).map((row) => row.name);
  }

  it("5.6.1 treffer del av navnet uten hensyn til store og små bokstaver, og del av nummeret", async () => {
    const { org, admin } = await orgWithAdmin();
    await insertFirm(org.id, { name: FIRM_NAME, orgNumber: ORG_A });
    await insertFirm(org.id, {
      name: "Testforsikring ASA",
      orgNumber: ORG_SEARCH,
      firmType: "insurer",
    });

    expect(await names(admin, org.id, "tESTmeg")).toEqual([FIRM_NAME]);
    expect(await names(admin, org.id, "0108")).toEqual(["Testforsikring ASA"]);
  });

  it("5.6.3 % og _ søker etter tegnet", async () => {
    const { org, admin } = await orgWithAdmin();
    await insertFirm(org.id, { name: "Test_megling", orgNumber: null });
    await insertFirm(org.id, { name: "Testxmegling", orgNumber: null });
    await insertFirm(org.id, { name: "Test%megling", orgNumber: null });
    await insertFirm(org.id, { name: "Testymegling", orgNumber: null });

    expect(await names(admin, org.id, "_")).toEqual(["Test_megling"]);
    expect(await names(admin, org.id, "%")).toEqual(["Test%megling"]);
  });

  it("5.6.4 tomt søk og bare mellomrom gir hele listen; søk over 100 tegn gir aldri databasefeil", async () => {
    const { org, admin } = await orgWithAdmin();
    await insertFirm(org.id, { name: "Testmegling A AS" });
    await insertFirm(org.id, { name: "Testmegling B AS" });

    expect(await names(admin, org.id, "")).toHaveLength(2);
    expect(await names(admin, org.id, "   ")).toHaveLength(2);
    expect(await names(admin, org.id, undefined)).toHaveLength(2);

    const error = await caught(core.listFirms(admin, org.id, { query: "a".repeat(150) }));
    if (error !== null) expect(error).toBeInstanceOf(ZodError);
  });

  it("5.6.5 sortert på navn, og høyst 200 rader", async () => {
    const { org, admin } = await orgWithAdmin();
    await insertFirm(org.id, { name: "Testmegling C AS" });
    await insertFirm(org.id, { name: "Testmegling A AS" });
    await insertFirm(org.id, { name: "Testmegling B AS" });
    expect(await names(admin, org.id)).toEqual([
      "Testmegling A AS",
      "Testmegling B AS",
      "Testmegling C AS",
    ]);

    await db.insert(firms).values(
      Array.from({ length: 198 }, (_, index) => ({
        organizationId: org.id,
        name: `Testmegling Z ${String(index).padStart(3, "0")}`,
        orgNumber: null,
      })),
    );
    expect(await rowCount(firms)).toBe(201);
    const rows = await names(admin, org.id);
    expect(rows).toHaveLength(200);
    expect(rows[0]).toBe("Testmegling A AS");
  });

  it("5.6.6 søket filtrerer på organisasjonen", async () => {
    const { org, admin } = await orgWithAdmin("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    await insertFirm(org.id, { name: "Testmegling A AS" });
    await insertFirm(orgB.id, { name: "Bare i B Testmegling", orgNumber: ORG_SEARCH });

    expect(await names(admin, org.id, "Bare i B")).toEqual([]);
    expect(await names(admin, org.id, "0108")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 5.7 Oppslag og faste felt
// ---------------------------------------------------------------------------------------------

describe("5.7 oppslag og faste felt (firma)", () => {
  it("5.7.1 Object.keys på firma, listeelement og getFirm(...).contacts er faste lister", async () => {
    const { org, admin } = await orgWithAdmin();
    const created = await core.createFirm(admin, org.id, firmInput({ notes: NOTE }));
    expectKeys(created, FIRM_KEYS);
    const updated = await core.updateFirm(admin, org.id, created.id, firmInput());
    expectKeys(updated, FIRM_KEYS);
    await insertContact(org.id, { firmId: created.id });

    const [listed] = await core.listFirms(admin, org.id);
    expectKeys(listed!, FIRM_LIST_KEYS);
    const detail = await core.getFirm(admin, org.id, created.id);
    expectKeys(detail, FIRM_DETAIL_KEYS);
    expect(detail.contacts).toHaveLength(1);
    expectKeys(detail.contacts[0]!, FIRM_CONTACT_KEYS);
  });

  it("5.7.2 getFirm har kontaktene sortert på navn", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await insertFirm(org.id);
    await insertContact(org.id, { firmId: firm.id, firstName: "Kari", lastName: "Testvik" });
    await insertContact(org.id, { firmId: firm.id, firstName: "Ola", lastName: "Testberg" });
    await insertContact(org.id, { firmId: firm.id, firstName: "Anne", lastName: "Testvik" });

    const detail = await core.getFirm(admin, org.id, firm.id);
    expect(detail.contacts.map((row) => `${row.lastName} ${row.firstName}`)).toEqual([
      "Testberg Ola",
      "Testvik Anne",
      "Testvik Kari",
    ]);
  });

  it("createFirm lagrer feltene i egen organisasjon med den ansatte som createdBy", async () => {
    const { org, admin, adminEmployee } = await orgWithAdmin();
    const created = await core.createFirm(
      admin,
      org.id,
      firmInput({ orgNumber: "000 000 019", firmType: "housing_association", notes: NOTE }),
    );
    const row = await firmRow(created.id);
    expect(row).toMatchObject({
      organizationId: org.id,
      name: FIRM_NAME,
      orgNumber: ORG_A,
      firmType: "housing_association",
      notes: NOTE,
      createdBy: adminEmployee.id,
      deletedAt: null,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// 5.8 Revisjonslogg
// ---------------------------------------------------------------------------------------------

describe("5.8 revisjonslogg (firma)", () => {
  /** Personopplysningene og verdiene som aldri skal stå i loggen. */
  const SECRETS = [FIRM_NAME, ORG_A, NOTE, "Testmegling Nord AS", ORG_TWO];

  it("5.8.1 og 5.8.2 én rad per skriving, med id, firmatype og navnene på feltene som ble endret", async () => {
    const { org, admin, adminEmployee } = await orgWithAdmin();
    const created = await core.createFirm(admin, org.id, firmInput());
    let rows = await auditFor(org.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entityType: "firm",
      entityId: created.id,
      action: "create",
      organizationId: org.id,
      actorEmployeeId: adminEmployee.id,
    });
    const createChanges = JSON.stringify(rows[0]!.changes);
    expect(createChanges).toContain(created.id);
    expect(createChanges).toContain("broker_firm");

    await core.updateFirm(admin, org.id, created.id, firmInput({ notes: NOTE }));
    rows = await auditFor(org.id);
    expect(rows).toHaveLength(2);
    const update = rows.find((row) => row.action === "update");
    expect(update).toMatchObject({
      entityType: "firm",
      entityId: created.id,
      organizationId: org.id,
    });
    const changes = update!.changes as Record<string, unknown>;
    expect(JSON.stringify(changes)).toContain(created.id);
    expect(JSON.stringify(changes)).toContain("broker_firm");
    expect(
      Object.values(changes).some(
        (value) => Array.isArray(value) && JSON.stringify(value) === JSON.stringify(["notes"]),
      ),
      `endrede felt skal være ["notes"], fikk ${JSON.stringify(changes)}`,
    ).toBe(true);
  });

  it.each([
    [
      "createFirm",
      async (actor: Actor, organizationId: string) =>
        core.createFirm(actor, organizationId, firmInput({ notes: NOTE })),
    ],
    [
      "updateFirm",
      async (actor: Actor, organizationId: string) => {
        const firm = await insertFirm(organizationId, { name: "Gammelt navn", orgNumber: null });
        return core.updateFirm(
          actor,
          organizationId,
          firm.id,
          firmInput({ name: "Testmegling Nord AS", orgNumber: ORG_TWO, notes: NOTE }),
        );
      },
    ],
  ] as const)("5.8.3 %s skriver ingen personopplysninger i revisjonsloggen", async (_name, run) => {
    const { org, admin } = await orgWithAdmin();
    await run(admin, org.id);
    const rows = await auditFor(org.id);
    expect(rows).toHaveLength(1);
    const text = JSON.stringify(rows);
    for (const secret of SECRETS) expect(text).not.toContain(secret);
  });

  it("5.8.4 ingen rader i events fra firmatjenestene", async () => {
    const { org, admin } = await orgWithAdmin();
    const created = await core.createFirm(admin, org.id, firmInput());
    await core.updateFirm(admin, org.id, created.id, firmInput({ notes: NOTE }));
    await core.listFirms(admin, org.id);
    await core.getFirm(admin, org.id, created.id);
    expect(await rowCount(events)).toBe(0);
  });

  it("5.8.5 ingen loggrad ved avvist tilgang, valideringsfeil eller FirmDuplicateError", async () => {
    const { org, admin } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);
    const firm = await insertFirm(org.id, { orgNumber: ORG_A });
    const { actor: inspector } = await person(org.id, ["inspector"]);

    await expect(
      core.createFirm(inspector, org.id, firmInput({ orgNumber: ORG_TWO })),
    ).rejects.toThrow(AccessDeniedError);
    await expect(core.createFirm(admin, org.id, firmInput({ name: " " }))).rejects.toThrow(
      ZodError,
    );
    await expect(
      core.updateFirm(admin, org.id, firm.id, firmInput({ orgNumber: "000000018" })),
    ).rejects.toThrow(ZodError);
    await expect(core.createFirm(admin, org.id, firmInput({ orgNumber: ORG_A }))).rejects.toThrow(
      core.FirmDuplicateError,
    );
    expect(await rowCount(auditLog)).toBe(0);
  });
});
