import { randomUUID } from "node:crypto";
import { count, eq, sql } from "drizzle-orm";
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
 * Kontakter i kontaktregisteret: kjernen i src/core/contacts (contacts).
 * Testplan: docs/funksjoner/fase2a-kontakter-firma-testplan.md avsnitt 5. Firmadelen står i
 * firms.test.ts, transaksjonen i contacts-transaction.test.ts.
 *
 * Avvises uten: 5.1 (med admin-testen 5.1.5), 5.2 og 5.3. Regel 2 og 11.
 *
 * Kontakter er personopplysninger. Testdata er oppdiktet: «Megler Test», «Testmegling AS»,
 * megler@example.com, telefon 00000000, notat «Vil ha rapport før kl. 12».
 *
 * Støtter hovedmål: tid (søket finner megleren raskt), reklamasjoner (kilden står alltid på
 * kontakten, aldri data fra en annen organisasjon, aldri personopplysninger i loggen) og
 * KI først (kilden er en fast kode som en senere KI-ordre kan sette).
 */

beforeEach(resetDatabase);

const FIRST = "Megler";
const LAST = "Test";
const EMAIL = "megler@example.com";
const PHONE = "00000000";
const NOTE = "Vil ha rapport før kl. 12";
const FIRM_NAME = "Testmegling AS";
const ORG_NUMBER = "000000019";
const DELETED = new Date("2026-11-01T08:00:00Z");

type ContactInput = Parameters<typeof core.createContact>[2];

function contactInput(overrides: Record<string, unknown> = {}): ContactInput {
  return {
    firstName: FIRST,
    lastName: LAST,
    email: EMAIL,
    phone: PHONE,
    firmId: null,
    notes: NOTE,
    ...overrides,
  } as ContactInput;
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

async function contactRow(id: string) {
  const [row] = await db.select().from(contacts).where(eq(contacts.id, id));
  if (!row) throw new Error("fant ikke kontakten");
  return row;
}

async function auditFor(organizationId: string) {
  return db.select().from(auditLog).where(eq(auditLog.organizationId, organizationId));
}

async function caught(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => null,
    (error: unknown) => error,
  );
}

const CONTACT_KEYS = [
  "email",
  "firmId",
  "firstName",
  "id",
  "lastName",
  "notes",
  "phone",
  "source",
].sort();
const CONTACT_DETAIL_KEYS = [...CONTACT_KEYS, "firmName"].sort();
const CONTACT_LIST_KEYS = [
  "email",
  "firmId",
  "firmName",
  "firstName",
  "id",
  "lastName",
  "phone",
  "source",
].sort();
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

describe("5.1 tilgang per rolle (kontakter)", () => {
  it.each(ROLE_CASES)("5.1.1 $name kan lese listen og kontakten", async ({ roles, editAll }) => {
    const org = await createOrganization();
    await setInspectorsEditAll(org.id, editAll);
    const contact = await insertContact(org.id);
    const { actor } = await person(org.id, roles);

    expect((await core.listContacts(actor, org.id)).map((row) => row.id)).toEqual([contact.id]);
    expect((await core.getContact(actor, org.id, contact.id)).id).toBe(contact.id);
  });

  it.each(ROLE_CASES.filter((c) => !(c.roles[0] === "inspector" && !c.editAll)))(
    "5.1.2 $name kan legge inn og endre kontakter",
    async ({ roles, editAll }) => {
      const org = await createOrganization();
      await setInspectorsEditAll(org.id, editAll);
      const { actor } = await person(org.id, roles);

      const created = await core.createContact(actor, org.id, contactInput());
      const updated = await core.updateContact(
        actor,
        org.id,
        created.id,
        contactInput({ notes: "Ring før befaring" }),
      );
      expect(updated.notes).toBe("Ring før befaring");
    },
  );

  it("5.1.2 takstmann med innstillingen av får AccessDeniedError på createContact og updateContact; ingenting endres", async () => {
    const org = await createOrganization();
    await setInspectorsEditAll(org.id, false);
    const contact = await insertContact(org.id);
    const { actor } = await person(org.id, ["inspector"]);
    const before = await tableCounts();
    const rowBefore = await contactRow(contact.id);

    await expect(core.createContact(actor, org.id, contactInput())).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(
      core.updateContact(actor, org.id, contact.id, contactInput({ firstName: "Endret" })),
    ).rejects.toThrow(AccessDeniedError);

    expect(await tableCounts()).toEqual(before);
    expect(await contactRow(contact.id)).toEqual(rowBefore);
  });

  it("5.1.3 takstmann med innstillingen av og enkeltrettigheten assignment.edit kan legge inn og endre", async () => {
    const org = await createOrganization();
    await setInspectorsEditAll(org.id, false);
    const { actor, employee } = await person(org.id, ["inspector"]);
    await grantPermission(employee, "assignment.edit");

    const created = await core.createContact(actor, org.id, contactInput());
    const updated = await core.updateContact(
      actor,
      org.id,
      created.id,
      contactInput({ lastName: "Testesen" }),
    );
    expect(updated.lastName).toBe("Testesen");
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
    {
      name: "ansatt uten roller",
      make: async (organizationId) => (await person(organizationId, [])).actor,
    },
  ];

  it.each(DENIED)(
    "5.1.4 $name får AccessDeniedError på alle fire kontakttjenestene",
    async ({ make }) => {
      const org = await createOrganization();
      await setInspectorsEditAll(org.id, true);
      const contact = await insertContact(org.id);
      const actor = await make(org.id);
      const before = await tableCounts();

      await expect(core.listContacts(actor, org.id)).rejects.toThrow(AccessDeniedError);
      await expect(core.getContact(actor, org.id, contact.id)).rejects.toThrow(AccessDeniedError);
      await expect(core.createContact(actor, org.id, contactInput())).rejects.toThrow(
        AccessDeniedError,
      );
      await expect(core.updateContact(actor, org.id, contact.id, contactInput())).rejects.toThrow(
        AccessDeniedError,
      );
      expect(await tableCounts()).toEqual(before);
    },
  );

  // Regel 11: admin stenges aldri ute. Testen skal aldri fjernes.
  it("5.1.5 admin uten andre roller, innstillingen av, kan lese og skrive med alle fire kontakttjenestene", async () => {
    const { org, admin } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);

    const created = await core.createContact(admin, org.id, contactInput());
    const updated = await core.updateContact(
      admin,
      org.id,
      created.id,
      contactInput({ notes: "Ring før befaring" }),
    );
    expect(updated.notes).toBe("Ring før befaring");
    expect((await core.listContacts(admin, org.id)).map((row) => row.id)).toEqual([created.id]);
    expect((await core.getContact(admin, org.id, created.id)).notes).toBe("Ring før befaring");
  });
});

// ---------------------------------------------------------------------------------------------
// 5.2 Tenant-isolasjon (regel 2)
// ---------------------------------------------------------------------------------------------

describe("5.2 tenant-isolasjon (kontakter)", () => {
  it("5.2.6 listContacts viser aldri kontakter fra en annen organisasjon", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => ({
        a: [(await insertContact(grantA.organizationId)).id],
        b: [(await insertContact(grantB.organizationId)).id],
      }),
      query: (actor, organizationId) => core.listContacts(actor, organizationId),
      idOf: (row) => row.id,
    });
  });

  it("5.2.7 getContact henter bare kontakter i egen organisasjon", async () => {
    const contactFor = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const grant of [grantA, grantB]) {
          const firm = await insertFirm(grant.organizationId);
          contactFor.set(
            grant.organizationId,
            (await insertContact(grant.organizationId, { firmId: firm.id })).id,
          );
        }
        return {
          a: [contactFor.get(grantA.organizationId)!],
          b: [contactFor.get(grantB.organizationId)!],
        };
      },
      query: async (actor, organizationId) => [
        await core.getContact(
          actor,
          organizationId,
          contactFor.get(organizationId) ?? randomUUID(),
        ),
      ],
      idOf: (row) => row.id,
    });
  });

  it("5.2.8 createContact legger alltid kontakten i egen organisasjon, med firma fra egen organisasjon", async () => {
    const firmFor = new Map<string, string>();
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        for (const grant of [grantA, grantB]) {
          firmFor.set(grant.organizationId, (await insertFirm(grant.organizationId)).id);
        }
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor, organizationId) => {
        const row = await core.createContact(
          actor,
          organizationId,
          contactInput({ firmId: firmFor.get(organizationId) ?? null }),
        );
        const stored = await contactRow(row.id);
        return [{ organizationId: stored.organizationId }];
      },
      idOf: (row) => row.organizationId,
    });

    const contactsB = await db.select().from(contacts).where(eq(contacts.organizationId, orgB));
    expect(contactsB).toHaveLength(1);
    expect(contactsB[0]?.firmId).toBe(firmFor.get(orgB));
    expect(await rowCount(contacts)).toBe(2);
  });

  it("5.2.8 updateContact endrer bare kontakter i egen organisasjon", async () => {
    const contactFor = new Map<string, string>();
    let contactB = "";
    let employeeB = "";
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const grant of [grantA, grantB]) {
          contactFor.set(grant.organizationId, (await insertContact(grant.organizationId)).id);
        }
        contactB = contactFor.get(grantB.organizationId)!;
        employeeB = grantB.employeeId;
        orgB = grantB.organizationId;
        return { a: [contactFor.get(grantA.organizationId)!], b: [contactB] };
      },
      query: async (actor, organizationId) => [
        await core.updateContact(
          actor,
          organizationId,
          contactFor.get(organizationId) ?? randomUUID(),
          contactInput({ lastName: `Endret ${actor.id.slice(0, 8)}` }),
        ),
      ],
      idOf: (row) => row.id,
    });

    // Bs kontakt er endret nøyaktig én gang, av B
    const rowB = await contactRow(contactB);
    expect(rowB.rowVersion).toBe(2);
    expect(rowB.updatedBy).toBe(employeeB);
    const updatesB = (await auditFor(orgB)).filter(
      (row) => row.entityType === "contact" && row.action === "update",
    );
    expect(updatesB).toHaveLength(1);
    expect(updatesB[0]?.entityId).toBe(contactB);
  });
});

// ---------------------------------------------------------------------------------------------
// 5.3 Fremmed id i egen organisasjon (IDOR)
// ---------------------------------------------------------------------------------------------

describe("5.3 fremmed eller ugyldig id (kontakter)", () => {
  it("5.3.2 Bs kontakt-id i getContact og updateContact → AccessDeniedError; Bs kontakt er uendret", async () => {
    const { org: orgA, admin: adminA } = await orgWithAdmin("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const contactB = await insertContact(orgB.id, { email: EMAIL });
    const before = await contactRow(contactB.id);

    await expect(core.getContact(adminA, orgA.id, contactB.id)).rejects.toThrow(AccessDeniedError);
    await expect(
      core.updateContact(adminA, orgA.id, contactB.id, contactInput({ firstName: "Kapret" })),
    ).rejects.toThrow(AccessDeniedError);

    expect(await contactRow(contactB.id)).toEqual(before);
    expect(await rowCount(auditLog)).toBe(0);
  });

  it("5.3.3 Bs firmId i createContact → FirmNotFoundError og ingen kontakt", async () => {
    const { org: orgA, admin: adminA } = await orgWithAdmin("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const firmB = await insertFirm(orgB.id);

    const error = await caught(
      core.createContact(adminA, orgA.id, contactInput({ firmId: firmB.id })),
    );
    expect(error).toBeInstanceOf(core.FirmNotFoundError);
    expect((error as Error).message).toBe("Firmaet finnes ikke.");
    expect(await rowCount(contacts)).toBe(0);
    expect(await rowCount(auditLog)).toBe(0);
  });

  it("5.3.3 Bs firmId i updateContact på egen kontakt → FirmNotFoundError; firm_id er uendret", async () => {
    const { org: orgA, admin: adminA } = await orgWithAdmin("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const firmA = await insertFirm(orgA.id);
    const firmB = await insertFirm(orgB.id);
    const contact = await insertContact(orgA.id, { firmId: firmA.id });
    const before = await contactRow(contact.id);

    await expect(
      core.updateContact(adminA, orgA.id, contact.id, contactInput({ firmId: firmB.id })),
    ).rejects.toThrow(core.FirmNotFoundError);
    const after = await contactRow(contact.id);
    expect(after.firmId).toBe(firmA.id);
    expect(after).toEqual(before);
    expect(await rowCount(auditLog)).toBe(0);
  });

  it("5.3.4 organizationId og source i input ignoreres", async () => {
    const { org: orgA, admin: adminA } = await orgWithAdmin("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");

    const created = await core.createContact(
      adminA,
      orgA.id,
      contactInput({ organizationId: orgB.id, source: "order" }),
    );
    const row = await contactRow(created.id);
    expect(row.organizationId).toBe(orgA.id);
    expect(row.source).toBe("manual");
    expect(created.source).toBe("manual");

    const updated = await core.updateContact(
      adminA,
      orgA.id,
      created.id,
      contactInput({ organizationId: orgB.id, source: "order" }),
    );
    expect(updated.source).toBe("manual");
    expect((await contactRow(created.id)).organizationId).toBe(orgA.id);
  });

  it.each([randomUUID(), "ikke-en-id"])(
    "5.3.5 kontakt-id %s → AccessDeniedError, aldri databasefeil",
    async (id) => {
      const { org, admin } = await orgWithAdmin();
      await expect(core.getContact(admin, org.id, id)).rejects.toThrow(AccessDeniedError);
      await expect(core.updateContact(admin, org.id, id, contactInput())).rejects.toThrow(
        AccessDeniedError,
      );
      expect(await rowCount(contacts)).toBe(0);
    },
  );

  it.each([randomUUID(), "ikke-en-id"])(
    "5.3.5 firmId %s i createContact → FirmNotFoundError eller valideringsfeil, aldri databasefeil",
    async (firmId) => {
      const { org, admin } = await orgWithAdmin();
      const error = await caught(core.createContact(admin, org.id, contactInput({ firmId })));
      expect(
        error instanceof core.FirmNotFoundError || error instanceof ZodError,
        `fikk ${String(error)}`,
      ).toBe(true);
      expect(await rowCount(contacts)).toBe(0);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// 5.4 Myk sletting
// ---------------------------------------------------------------------------------------------

describe("5.4 myk sletting (kontakter)", () => {
  it("5.4.1 slettet kontakt: getContact og updateContact → AccessDeniedError; raden er urørt", async () => {
    const { org, admin } = await orgWithAdmin();
    const contact = await insertContact(org.id, { deletedAt: DELETED });
    const before = await contactRow(contact.id);

    await expect(core.getContact(admin, org.id, contact.id)).rejects.toThrow(AccessDeniedError);
    await expect(core.updateContact(admin, org.id, contact.id, contactInput())).rejects.toThrow(
      AccessDeniedError,
    );
    expect(await contactRow(contact.id)).toEqual(before);
    expect(await rowCount(auditLog)).toBe(0);
  });

  it("5.4.2 slettet firma som firmId i createContact → FirmNotFoundError", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await insertFirm(org.id, { deletedAt: DELETED });
    await expect(
      core.createContact(admin, org.id, contactInput({ firmId: firm.id })),
    ).rejects.toThrow(core.FirmNotFoundError);
    expect(await rowCount(contacts)).toBe(0);
  });

  it("5.4.3 listContacts og søket viser ikke slettede kontakter", async () => {
    const { org, admin } = await orgWithAdmin();
    const kept = await insertContact(org.id, { firstName: "Synlig" });
    await insertContact(org.id, { firstName: "Borte", deletedAt: DELETED });

    expect((await core.listContacts(admin, org.id)).map((row) => row.id)).toEqual([kept.id]);
    expect(await core.listContacts(admin, org.id, { query: "Borte" })).toEqual([]);
  });

  it("5.4.4 kontakt i et slettet firma: firmanavnet vises verken i getContact eller listContacts", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await insertFirm(org.id, { name: "Slettet Testmegling AS", deletedAt: DELETED });
    const contact = await insertContact(org.id, { firmId: firm.id });

    const detail = await core.getContact(admin, org.id, contact.id);
    expect(detail.firmName).toBeNull();
    const [listed] = await core.listContacts(admin, org.id);
    expect(listed?.firmName).toBeNull();
    expect(JSON.stringify(await core.listContacts(admin, org.id))).not.toContain(
      "Slettet Testmegling AS",
    );
    // Søket treffer ikke på navnet til det slettede firmaet
    expect(await core.listContacts(admin, org.id, { query: "Slettet Testmegling" })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 5.5.8 Ingen sperre mot like kontakter
// ---------------------------------------------------------------------------------------------

describe("5.5 dubletter (kontakter)", () => {
  it("5.5.8 to kontakter med samme navn og e-post lagres begge", async () => {
    const { org, admin } = await orgWithAdmin();
    const first = await core.createContact(admin, org.id, contactInput());
    const second = await core.createContact(admin, org.id, contactInput());
    expect(first.id).not.toBe(second.id);
    expect(await rowCount(contacts)).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------
// 5.6 Søk
// ---------------------------------------------------------------------------------------------

describe("5.6 søk (kontakter)", () => {
  async function ids(actor: Actor, organizationId: string, query?: string) {
    return (await core.listContacts(actor, organizationId, { query })).map((row) => row.id).sort();
  }

  it("5.6.2 treffer fornavn, etternavn, e-post og firmanavn (uten hensyn til store og små bokstaver)", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await insertFirm(org.id, { name: FIRM_NAME });
    const byFirst = await insertContact(org.id, { firstName: "Annlaug", lastName: "Testberg" });
    const byLast = await insertContact(org.id, { firstName: "Per", lastName: "Testsnes" });
    const byEmail = await insertContact(org.id, {
      firstName: "Kari",
      lastName: "Testvik",
      email: "unik.adresse@example.com",
    });
    const byFirm = await insertContact(org.id, {
      firstName: "Ola",
      lastName: "Testli",
      firmId: firm.id,
    });

    expect(await ids(admin, org.id, "annl")).toEqual([byFirst.id]);
    expect(await ids(admin, org.id, "TESTSNES")).toEqual([byLast.id]);
    expect(await ids(admin, org.id, "unik.adresse")).toEqual([byEmail.id]);
    expect(await ids(admin, org.id, "testmegling")).toEqual([byFirm.id]);
  });

  it("5.6.3 % og _ søker etter tegnet", async () => {
    const { org, admin } = await orgWithAdmin();
    const underscore = await insertContact(org.id, { firstName: "Test_navn" });
    await insertContact(org.id, { firstName: "Testxnavn" });
    const percent = await insertContact(org.id, { firstName: "Test%navn" });
    await insertContact(org.id, { firstName: "Testynavn" });

    expect(await ids(admin, org.id, "_")).toEqual([underscore.id]);
    expect(await ids(admin, org.id, "%")).toEqual([percent.id]);
  });

  it("5.6.4 tomt søk og bare mellomrom gir hele listen; søk over 100 tegn gir aldri databasefeil", async () => {
    const { org, admin } = await orgWithAdmin();
    await insertContact(org.id, { firstName: "En" });
    await insertContact(org.id, { firstName: "To" });

    expect(await ids(admin, org.id, "")).toHaveLength(2);
    expect(await ids(admin, org.id, "   ")).toHaveLength(2);

    const error = await caught(core.listContacts(admin, org.id, { query: "a".repeat(150) }));
    if (error !== null) expect(error).toBeInstanceOf(ZodError);
  });

  it("5.6.5 sortert på navn, og høyst 200 rader", async () => {
    const { org, admin } = await orgWithAdmin();
    await insertContact(org.id, { firstName: "Kari", lastName: "Testvik" });
    await insertContact(org.id, { firstName: "Ola", lastName: "Testberg" });
    await insertContact(org.id, { firstName: "Anne", lastName: "Testvik" });
    expect(
      (await core.listContacts(admin, org.id)).map((row) => `${row.lastName} ${row.firstName}`),
    ).toEqual(["Testberg Ola", "Testvik Anne", "Testvik Kari"]);

    await db.insert(contacts).values(
      Array.from({ length: 198 }, (_, index) => ({
        organizationId: org.id,
        firstName: "Megler",
        lastName: `Testø ${String(index).padStart(3, "0")}`,
      })),
    );
    expect(await rowCount(contacts)).toBe(201);
    const rows = await core.listContacts(admin, org.id);
    expect(rows).toHaveLength(200);
    expect(rows[0]?.lastName).toBe("Testberg");
  });

  it("5.6.6 søket filtrerer på organisasjonen", async () => {
    const { org, admin } = await orgWithAdmin("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    await insertContact(org.id, { firstName: "Megler" });
    const firmB = await insertFirm(orgB.id, { name: "Bare i B Testmegling" });
    await insertContact(orgB.id, {
      firstName: "Barebe",
      email: "bare.b@example.com",
      firmId: firmB.id,
    });

    expect(await ids(admin, org.id, "Barebe")).toEqual([]);
    expect(await ids(admin, org.id, "bare.b@")).toEqual([]);
    expect(await ids(admin, org.id, "Bare i B")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 5.7 Oppslag og faste felt
// ---------------------------------------------------------------------------------------------

describe("5.7 oppslag og faste felt (kontakter)", () => {
  it("5.7.1 Object.keys på kontakt og listeelement er faste lister", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await insertFirm(org.id);
    const created = await core.createContact(admin, org.id, contactInput({ firmId: firm.id }));
    expectKeys(created, CONTACT_KEYS);
    const updated = await core.updateContact(admin, org.id, created.id, contactInput());
    expectKeys(updated, CONTACT_KEYS);
    expectKeys(await core.getContact(admin, org.id, created.id), CONTACT_DETAIL_KEYS);
    const [listed] = await core.listContacts(admin, org.id);
    expectKeys(listed!, CONTACT_LIST_KEYS);
  });

  it("5.7.2 getContact har source og firmName", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await insertFirm(org.id, { name: FIRM_NAME });
    const contact = await insertContact(org.id, { firmId: firm.id, source: "order" });
    const detail = await core.getContact(admin, org.id, contact.id);
    expect(detail.source).toBe("order");
    expect(detail.firmName).toBe(FIRM_NAME);
    expect(detail.firmId).toBe(firm.id);
  });

  it("5.7.3 createContact lagrer alle feltene, source = manual, egen organisasjon og den ansatte som createdBy", async () => {
    const { org, admin, adminEmployee } = await orgWithAdmin();
    const firm = await insertFirm(org.id, { name: FIRM_NAME });
    const created = await core.createContact(admin, org.id, contactInput({ firmId: firm.id }));
    expect(await contactRow(created.id)).toMatchObject({
      organizationId: org.id,
      firstName: FIRST,
      lastName: LAST,
      email: EMAIL,
      phone: PHONE,
      firmId: firm.id,
      notes: NOTE,
      source: "manual",
      createdBy: adminEmployee.id,
      deletedAt: null,
    });
  });

  it("5.7.4 kilden er alltid satt: hver kontakt fra tjenestene har source i CONTACT_SOURCES", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await insertFirm(org.id);
    const created = await core.createContact(admin, org.id, contactInput({ firmId: firm.id }));
    await insertContact(org.id, { source: "order" });
    const updated = await core.updateContact(admin, org.id, created.id, contactInput());

    const all = [
      created,
      updated,
      await core.getContact(admin, org.id, created.id),
      ...(await core.listContacts(admin, org.id)),
    ];
    expect(all.length).toBeGreaterThanOrEqual(4);
    for (const row of all) expect(core.CONTACT_SOURCES as readonly string[]).toContain(row.source);
  });

  it("5.7.5 updateContact uten firma fjerner koblingen, og updated_at endres", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await insertFirm(org.id);
    const contact = await insertContact(org.id, { firmId: firm.id });
    await db.execute(
      sql`update contacts set updated_at = '2026-01-01T00:00:00Z' where id = ${contact.id}`,
    );
    const before = await contactRow(contact.id);

    const updated = await core.updateContact(
      admin,
      org.id,
      contact.id,
      contactInput({ firmId: null }),
    );
    expect(updated.firmId).toBeNull();
    const after = await contactRow(contact.id);
    expect(after.firmId).toBeNull();
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect((await core.getContact(admin, org.id, contact.id)).firmName).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// 5.8 Revisjonslogg
// ---------------------------------------------------------------------------------------------

describe("5.8 revisjonslogg (kontakter)", () => {
  const SECRETS = [FIRST + " " + LAST, FIRM_NAME, ORG_NUMBER, EMAIL, PHONE, NOTE, "Testesen"];

  it("5.8.1 og 5.8.2 én rad per skriving, med id-er, kilden og navnene på feltene som ble endret", async () => {
    const { org, admin, adminEmployee } = await orgWithAdmin();
    const firm = await insertFirm(org.id);
    const created = await core.createContact(admin, org.id, contactInput({ firmId: firm.id }));
    let rows = await auditFor(org.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entityType: "contact",
      entityId: created.id,
      action: "create",
      organizationId: org.id,
      actorEmployeeId: adminEmployee.id,
    });
    const createText = JSON.stringify(rows[0]!.changes);
    expect(createText).toContain(created.id);
    expect(createText).toContain(firm.id);
    expect(createText).toContain("manual");

    await core.updateContact(
      admin,
      org.id,
      created.id,
      contactInput({ firmId: firm.id, notes: "Ring før befaring" }),
    );
    rows = await auditFor(org.id);
    expect(rows).toHaveLength(2);
    const update = rows.find((row) => row.action === "update");
    expect(update).toMatchObject({
      entityType: "contact",
      entityId: created.id,
      organizationId: org.id,
    });
    const changes = update!.changes as Record<string, unknown>;
    expect(JSON.stringify(changes)).toContain(created.id);
    expect(JSON.stringify(changes)).toContain("manual");
    expect(
      Object.values(changes).some(
        (value) => Array.isArray(value) && JSON.stringify(value) === JSON.stringify(["notes"]),
      ),
      `endrede felt skal være ["notes"], fikk ${JSON.stringify(changes)}`,
    ).toBe(true);
  });

  it.each([
    [
      "createContact",
      async (actor: Actor, organizationId: string, firmId: string) =>
        core.createContact(actor, organizationId, contactInput({ firmId })),
    ],
    [
      "updateContact",
      async (actor: Actor, organizationId: string, firmId: string) => {
        const contact = await insertContact(organizationId, {
          firstName: "Gammel",
          lastName: "Navn",
        });
        return core.updateContact(
          actor,
          organizationId,
          contact.id,
          contactInput({ lastName: "Testesen", firmId }),
        );
      },
    ],
  ] as const)("5.8.3 %s skriver ingen personopplysninger i revisjonsloggen", async (_name, run) => {
    const { org, admin } = await orgWithAdmin();
    const firm = await insertFirm(org.id, { name: FIRM_NAME, orgNumber: ORG_NUMBER });
    await run(admin, org.id, firm.id);
    const rows = await auditFor(org.id);
    expect(rows).toHaveLength(1);
    const text = JSON.stringify(rows);
    for (const secret of [...SECRETS, FIRST, "Gammel"]) expect(text).not.toContain(secret);
  });

  it("5.8.4 ingen rader i events fra kontakttjenestene", async () => {
    const { org, admin } = await orgWithAdmin();
    const created = await core.createContact(admin, org.id, contactInput());
    await core.updateContact(admin, org.id, created.id, contactInput({ notes: null }));
    await core.listContacts(admin, org.id);
    await core.getContact(admin, org.id, created.id);
    expect(await rowCount(events)).toBe(0);
  });

  it("5.8.5 ingen loggrad ved avvist tilgang, valideringsfeil eller FirmNotFoundError", async () => {
    const { org, admin } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);
    const contact = await insertContact(org.id);
    const { actor: inspector } = await person(org.id, ["inspector"]);

    await expect(core.createContact(inspector, org.id, contactInput())).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(
      core.createContact(admin, org.id, contactInput({ firstName: " " })),
    ).rejects.toThrow(ZodError);
    await expect(
      core.updateContact(admin, org.id, contact.id, contactInput({ email: "ikke-epost" })),
    ).rejects.toThrow(ZodError);
    await expect(
      core.createContact(admin, org.id, contactInput({ firmId: randomUUID() })),
    ).rejects.toThrow(core.FirmNotFoundError);
    expect(await rowCount(auditLog)).toBe(0);
  });
});
