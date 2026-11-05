import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { AccessDeniedError, type Actor } from "@/core/access";
import { db } from "@/db/client";
import {
  auditLog,
  contacts as contactsTable,
  employees,
  events,
  firms as firmsTable,
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
import * as contactsCore from "./index";
import { CONTACT_SOURCES, FirmNotFoundError } from "./index";

/*
 * Kontakter i kjernen (src/core/contacts/contacts.ts). Kontakter er personopplysninger.
 * Testplan: docs/funksjoner/fase2a-kontakter-firma-testplan.md avsnitt 5 (kontaktdelen).
 * Firmadelen står i firms.test.ts. Testdata er oppdiktet («Megler Test», megler@example.com).
 * Støtter hovedmål: tid (megleren finnes med ett søk) og reklamasjoner (kilden står alltid på
 * kontakten, og navn, e-post, telefon og notat havner aldri i revisjonsloggen).
 */

beforeEach(resetDatabase);

const { createContact, getContact, listContacts, updateContact } = contactsCore;

const NOTE = "Vil ha rapport før kl. 12";
const CONTACT_INPUT = {
  firstName: "Megler",
  lastName: "Test",
  email: "megler@example.com",
  phone: "00000000",
  notes: NOTE,
};

async function setInspectorsEditAll(organizationId: string, value: boolean) {
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": value } })
    .where(eq(organizations.id, organizationId));
}

async function person(organizationId: string, roles: EmployeeRole[]) {
  const actor = await createUser();
  const employee = await createEmployee(actor, organizationId, roles);
  return { actor, employee };
}

async function orgWithAdmin(name = "Testfirma takst") {
  const org = await createOrganization(name);
  const { actor: admin } = await person(org.id, ["admin"]);
  return { org, admin };
}

async function contactRow(id: string) {
  const [row] = await db.select().from(contactsTable).where(eq(contactsTable.id, id));
  if (!row) throw new Error("fant ikke kontakten");
  return row;
}

async function counts() {
  const [c] = await db.select({ n: count() }).from(contactsTable);
  const [a] = await db.select({ n: count() }).from(auditLog);
  return { contacts: c?.n ?? 0, audit: a?.n ?? 0 };
}

async function readContacts(actor: Actor, organizationId: string, contactId: string) {
  await listContacts(actor, organizationId);
  await getContact(actor, organizationId, contactId);
}

async function writeContacts(actor: Actor, organizationId: string, contactId: string) {
  await createContact(actor, organizationId, CONTACT_INPUT);
  await updateContact(actor, organizationId, contactId, { ...CONTACT_INPUT, notes: "Nytt" });
}

// ---------------------------------------------------------------------------------------------
// 5.1 Tilgang per rolle
// ---------------------------------------------------------------------------------------------

type RoleCase = { roles: EmployeeRole[]; editAll: boolean };

const roleCases: RoleCase[] = (["inspector", "office", "manager", "admin"] as const).flatMap(
  (role) => [
    { roles: [role], editAll: true },
    { roles: [role], editAll: false },
  ],
);

describe("5.1 tilgang per rolle (kontakter)", () => {
  it.each(roleCases)("$roles med innstillingen $editAll kan lese", async ({ roles, editAll }) => {
    const org = await createOrganization();
    await setInspectorsEditAll(org.id, editAll);
    const contact = await insertContact(org.id);
    const { actor } = await person(org.id, roles);
    await expect(readContacts(actor, org.id, contact.id)).resolves.toBeUndefined();
  });

  it.each(roleCases.filter((c) => !(c.roles[0] === "inspector" && !c.editAll)))(
    "$roles med innstillingen $editAll kan skrive",
    async ({ roles, editAll }) => {
      const org = await createOrganization();
      await setInspectorsEditAll(org.id, editAll);
      const contact = await insertContact(org.id);
      const { actor } = await person(org.id, roles);
      await expect(writeContacts(actor, org.id, contact.id)).resolves.toBeUndefined();
    },
  );

  it("takstmann med innstillingen av får ikke skrive; ingenting endres", async () => {
    const org = await createOrganization();
    await setInspectorsEditAll(org.id, false);
    const contact = await insertContact(org.id);
    const { actor } = await person(org.id, ["inspector"]);
    const before = await counts();

    await expect(createContact(actor, org.id, CONTACT_INPUT)).rejects.toThrow(AccessDeniedError);
    await expect(updateContact(actor, org.id, contact.id, CONTACT_INPUT)).rejects.toThrow(
      AccessDeniedError,
    );
    expect(await counts()).toEqual(before);
    expect(await contactRow(contact.id)).toEqual(contact);
  });

  it("takstmann med innstillingen av og enkeltrettigheten assignment.edit kan skrive", async () => {
    const org = await createOrganization();
    await setInspectorsEditAll(org.id, false);
    const contact = await insertContact(org.id);
    const { actor, employee } = await person(org.id, ["inspector"]);
    await grantPermission(employee, "assignment.edit");
    await expect(writeContacts(actor, org.id, contact.id)).resolves.toBeUndefined();
  });

  it("bruker uten ansattrad får verken lese eller skrive", async () => {
    const org = await createOrganization();
    const contact = await insertContact(org.id);
    const stranger = await createUser();
    await expect(listContacts(stranger, org.id)).rejects.toThrow(AccessDeniedError);
    await expect(getContact(stranger, org.id, contact.id)).rejects.toThrow(AccessDeniedError);
    await expect(createContact(stranger, org.id, CONTACT_INPUT)).rejects.toThrow(AccessDeniedError);
    await expect(updateContact(stranger, org.id, contact.id, CONTACT_INPUT)).rejects.toThrow(
      AccessDeniedError,
    );
  });

  it.each([
    ["deaktivert", { deactivatedAt: new Date("2026-11-01T08:00:00Z") }],
    ["slettet", { deletedAt: new Date("2026-11-01T08:00:00Z") }],
  ] as const)("%s ansatt (admin) får verken lese eller skrive", async (_name, set) => {
    const org = await createOrganization();
    const contact = await insertContact(org.id);
    const { actor, employee } = await person(org.id, ["admin"]);
    await db.update(employees).set(set).where(eq(employees.id, employee.id));
    await expect(listContacts(actor, org.id)).rejects.toThrow(AccessDeniedError);
    await expect(getContact(actor, org.id, contact.id)).rejects.toThrow(AccessDeniedError);
    await expect(createContact(actor, org.id, CONTACT_INPUT)).rejects.toThrow(AccessDeniedError);
    await expect(updateContact(actor, org.id, contact.id, CONTACT_INPUT)).rejects.toThrow(
      AccessDeniedError,
    );
  });

  it("ansatt uten roller får verken lese eller skrive", async () => {
    const org = await createOrganization();
    const contact = await insertContact(org.id);
    const { actor } = await person(org.id, []);
    await expect(readContacts(actor, org.id, contact.id)).rejects.toThrow(AccessDeniedError);
    await expect(createContact(actor, org.id, CONTACT_INPUT)).rejects.toThrow(AccessDeniedError);
  });

  // Regel 11: admin stenges aldri ute. Testen skal aldri fjernes.
  it("admin uten andre roller og med innstillingen av kan lese og skrive", async () => {
    const { org, admin } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);
    const created = await createContact(admin, org.id, CONTACT_INPUT);
    await updateContact(admin, org.id, created.id, { ...CONTACT_INPUT, notes: "Nytt" });
    expect((await getContact(admin, org.id, created.id)).notes).toBe("Nytt");
    expect((await listContacts(admin, org.id)).map((row) => row.id)).toEqual([created.id]);
  });
});

// ---------------------------------------------------------------------------------------------
// 5.2 Tenant-isolasjon (regel 2)
// ---------------------------------------------------------------------------------------------

describe("5.2 tenant-isolasjon (kontakter)", () => {
  it("listContacts", async () => {
    await expectTenantIsolation({
      seed: async (a, b) => ({
        a: [(await insertContact(a.organizationId)).id],
        b: [(await insertContact(b.organizationId)).id],
      }),
      query: (actor, organizationId) => listContacts(actor, organizationId),
      idOf: (row) => row.id,
    });
  });

  it("getContact", async () => {
    const ids = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (a, b) => {
        const ca = await insertContact(a.organizationId);
        const cb = await insertContact(b.organizationId);
        ids.set(a.organizationId, ca.id).set(b.organizationId, cb.id);
        return { a: [ca.id], b: [cb.id] };
      },
      query: async (actor, organizationId) => [
        await getContact(actor, organizationId, ids.get(organizationId) ?? randomUUID()),
      ],
      idOf: (row) => row.id,
    });
  });

  it("createContact (med firma fra egen organisasjon)", async () => {
    const firmIds = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (a, b) => {
        firmIds
          .set(a.organizationId, (await insertFirm(a.organizationId)).id)
          .set(b.organizationId, (await insertFirm(b.organizationId)).id);
        return { a: [a.organizationId], b: [b.organizationId] };
      },
      query: async (actor, organizationId) => {
        const row = await createContact(actor, organizationId, {
          ...CONTACT_INPUT,
          firmId: firmIds.get(organizationId) ?? randomUUID(),
        });
        return [await contactRow(row.id)];
      },
      idOf: (row) => row.organizationId,
    });
  });

  it("updateContact", async () => {
    const ids = new Map<string, string>();
    let contactB = "";
    await expectTenantIsolation({
      seed: async (a, b) => {
        const ca = await insertContact(a.organizationId);
        const cb = await insertContact(b.organizationId);
        ids.set(a.organizationId, ca.id).set(b.organizationId, cb.id);
        contactB = cb.id;
        return { a: [ca.id], b: [cb.id] };
      },
      query: async (actor, organizationId) => [
        await updateContact(actor, organizationId, ids.get(organizationId) ?? randomUUID(), {
          firstName: `Endret av ${actor.id}`,
        }),
      ],
      idOf: (row) => row.id,
    });
    const row = await contactRow(contactB);
    expect(row.rowVersion).toBe(2);
    const [employee] = await db
      .select({ id: employees.id, userId: employees.userId })
      .from(employees)
      .where(eq(employees.organizationId, row.organizationId));
    expect(row.firstName).toBe(`Endret av ${employee?.userId}`);
    expect(row.updatedBy).toBe(employee?.id);
  });
});

// ---------------------------------------------------------------------------------------------
// 5.3 Fremmed id i egen organisasjon (IDOR), 5.4 myk sletting
// ---------------------------------------------------------------------------------------------

describe("5.3 og 5.4 fremmed, ukjent og slettet id", () => {
  it("Bs kontakt-id med A sin organisasjon gir AccessDeniedError, og Bs kontakt er uendret", async () => {
    const { org: orgA, admin } = await orgWithAdmin("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const contactB = await insertContact(orgB.id);

    await expect(getContact(admin, orgA.id, contactB.id)).rejects.toThrow(AccessDeniedError);
    await expect(updateContact(admin, orgA.id, contactB.id, CONTACT_INPUT)).rejects.toThrow(
      AccessDeniedError,
    );
    expect(await contactRow(contactB.id)).toEqual(contactB);
    expect((await counts()).audit).toBe(0);
  });

  it("Bs firmId gir FirmNotFoundError: ingen ny kontakt, og firm_id på egen kontakt er uendret", async () => {
    const { org: orgA, admin } = await orgWithAdmin("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const firmB = await insertFirm(orgB.id);
    const firmA = await insertFirm(orgA.id);
    const own = await insertContact(orgA.id, { firmId: firmA.id });
    const before = await counts();

    await expect(
      createContact(admin, orgA.id, { ...CONTACT_INPUT, firmId: firmB.id }),
    ).rejects.toThrow(new FirmNotFoundError());
    await expect(
      updateContact(admin, orgA.id, own.id, { ...CONTACT_INPUT, firmId: firmB.id }),
    ).rejects.toThrow(FirmNotFoundError);
    expect(await counts()).toEqual(before);
    expect((await contactRow(own.id)).firmId).toBe(firmA.id);
  });

  it("organizationId og source i input ignoreres", async () => {
    const { org: orgA, admin } = await orgWithAdmin("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const created = await createContact(admin, orgA.id, {
      ...CONTACT_INPUT,
      organizationId: orgB.id,
      source: "order",
    } as typeof CONTACT_INPUT);
    const row = await contactRow(created.id);
    expect(row.organizationId).toBe(orgA.id);
    expect(row.source).toBe("manual");
  });

  it.each([randomUUID(), "ikke-en-id"])(
    "ukjent eller ugyldig kontakt-id %j gir AccessDeniedError, aldri databasefeil",
    async (id) => {
      const { org, admin } = await orgWithAdmin();
      await expect(getContact(admin, org.id, id)).rejects.toThrow(AccessDeniedError);
      await expect(updateContact(admin, org.id, id, CONTACT_INPUT)).rejects.toThrow(
        AccessDeniedError,
      );
    },
  );

  it("ukjent firma-id gir FirmNotFoundError, ugyldig firma-id gir valideringsfeil", async () => {
    const { org, admin } = await orgWithAdmin();
    await expect(
      createContact(admin, org.id, { ...CONTACT_INPUT, firmId: randomUUID() }),
    ).rejects.toThrow(FirmNotFoundError);
    await expect(
      createContact(admin, org.id, { ...CONTACT_INPUT, firmId: "ikke-en-id" }),
    ).rejects.toThrow(ZodError);
    expect((await counts()).contacts).toBe(0);
  });

  it("slettet kontakt: get og update gir AccessDeniedError, raden er urørt, listen viser den ikke", async () => {
    const { org, admin } = await orgWithAdmin();
    const deleted = await insertContact(org.id, { deletedAt: new Date("2026-11-01T08:00:00Z") });

    await expect(getContact(admin, org.id, deleted.id)).rejects.toThrow(AccessDeniedError);
    await expect(updateContact(admin, org.id, deleted.id, CONTACT_INPUT)).rejects.toThrow(
      AccessDeniedError,
    );
    expect(await contactRow(deleted.id)).toEqual(deleted);
    expect(await listContacts(admin, org.id)).toEqual([]);
    expect(await listContacts(admin, org.id, { query: "Megler" })).toEqual([]);
  });

  it("slettet firma som firmId gir FirmNotFoundError", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await insertFirm(org.id, { deletedAt: new Date() });
    await expect(
      createContact(admin, org.id, { ...CONTACT_INPUT, firmId: firm.id }),
    ).rejects.toThrow(FirmNotFoundError);
  });

  it("kontakt i et slettet firma viser ikke firmanavnet", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await insertFirm(org.id, { name: "Nedlagt Megling AS" });
    const contact = await insertContact(org.id, { firmId: firm.id });
    await db.update(firmsTable).set({ deletedAt: new Date() }).where(eq(firmsTable.id, firm.id));

    expect(await getContact(admin, org.id, contact.id)).toMatchObject({
      firmId: null,
      firmName: null,
    });
    const [listed] = await listContacts(admin, org.id);
    expect(listed).toMatchObject({ firmId: null, firmName: null });
    expect(await listContacts(admin, org.id, { query: "Nedlagt" })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 5.5.8 Ingen sperre mot like kontakter, 5.6 søk
// ---------------------------------------------------------------------------------------------

describe("5.5.8 og 5.6 like kontakter og søk", () => {
  it("to kontakter med samme navn og e-post lagres begge", async () => {
    const { org, admin } = await orgWithAdmin();
    await createContact(admin, org.id, CONTACT_INPUT);
    await createContact(admin, org.id, CONTACT_INPUT);
    expect((await counts()).contacts).toBe(2);
  });

  it("treffer fornavn, etternavn, e-post og firmanavn", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await insertFirm(org.id, { name: "Fjordmegling AS" });
    const first = await insertContact(org.id, { firstName: "Solveig", lastName: "Aas" });
    const last = await insertContact(org.id, { firstName: "Ola", lastName: "Strandvik" });
    const mail = await insertContact(org.id, {
      firstName: "Per",
      lastName: "Berg",
      email: "unik@example.com",
    });
    const inFirm = await insertContact(org.id, {
      firstName: "Kari",
      lastName: "Dal",
      firmId: firm.id,
    });
    const ids = async (query: string) =>
      (await listContacts(admin, org.id, { query })).map((row) => row.id);

    expect(await ids("solv")).toEqual([first.id]);
    expect(await ids("STRANDVIK")).toEqual([last.id]);
    expect(await ids("unik@")).toEqual([mail.id]);
    expect(await ids("fjordmegling")).toEqual([inFirm.id]);
  });

  it("% og _ søker etter tegnet", async () => {
    const { org, admin } = await orgWithAdmin();
    const underscore = await insertContact(org.id, { firstName: "Te_st" });
    await insertContact(org.id, { firstName: "Texst", lastName: null });
    expect((await listContacts(admin, org.id, { query: "_" })).map((r) => r.id)).toEqual([
      underscore.id,
    ]);
    expect(await listContacts(admin, org.id, { query: "%" })).toEqual([]);
  });

  it("sortert på etternavn og fornavn, og søket filtrerer på organisasjonen", async () => {
    const { org, admin } = await orgWithAdmin();
    const other = await createOrganization("Organisasjon B");
    const b = await insertContact(org.id, { firstName: "Ola", lastName: "Berg" });
    const a = await insertContact(org.id, { firstName: "Kari", lastName: "Aas" });
    await insertContact(other.id, { firstName: "Fremmed", lastName: "Megler" });
    expect((await listContacts(admin, org.id)).map((r) => r.id)).toEqual([a.id, b.id]);
    expect(await listContacts(admin, org.id, { query: "Fremmed" })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 5.7 Faste felt, 5.8 revisjonslogg
// ---------------------------------------------------------------------------------------------

const TRACKING_KEYS = ["deletedAt", "deletedBy", "rowVersion", "organizationId", "createdBy"];

describe("5.7 faste felt og kilde", () => {
  it("svarene har faste feltlister uten sporingsfelt, og kilden er alltid satt", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await insertFirm(org.id);
    const created = await createContact(admin, org.id, { ...CONTACT_INPUT, firmId: firm.id });
    const detail = await getContact(admin, org.id, created.id);
    const [listed] = await listContacts(admin, org.id);

    const base = ["email", "firmId", "firstName", "id", "lastName", "notes", "phone", "source"];
    expect(Object.keys(created).sort()).toEqual([...base].sort());
    expect(Object.keys(detail).sort()).toEqual([...base, "firmName"].sort());
    expect(Object.keys(listed!).sort()).toEqual(
      ["email", "firmId", "firmName", "firstName", "id", "lastName", "phone", "source"].sort(),
    );
    for (const key of TRACKING_KEYS) {
      expect(created).not.toHaveProperty(key);
      expect(detail).not.toHaveProperty(key);
    }
    expect(detail).toMatchObject({ ...CONTACT_INPUT, firmId: firm.id, firmName: firm.name });
    for (const row of [created, detail, listed!]) {
      expect(CONTACT_SOURCES).toContain(row.source);
    }
  });

  it("createContact lagrer alle feltene, manual, organisasjonen og den ansatte", async () => {
    const { org } = await orgWithAdmin();
    const { actor, employee } = await person(org.id, ["office"]);
    const created = await createContact(actor, org.id, CONTACT_INPUT);
    expect(await contactRow(created.id)).toMatchObject({
      ...CONTACT_INPUT,
      source: "manual",
      organizationId: org.id,
      createdBy: employee.id,
    });
  });

  it("updateContact uten firma fjerner koblingen og endrer updated_at", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await insertFirm(org.id);
    const contact = await insertContact(org.id, { firmId: firm.id });
    await updateContact(admin, org.id, contact.id, { ...CONTACT_INPUT, firmId: null });
    const row = await contactRow(contact.id);
    expect(row.firmId).toBeNull();
    expect(row.updatedAt.getTime()).toBeGreaterThan(contact.updatedAt.getTime());
    expect(row.source).toBe("manual");
  });
});

describe("5.8 revisjonslogg (kontakter)", () => {
  it("én rad per skriving med id-er, kilde og navnene på endrede felt", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await insertFirm(org.id);
    const created = await createContact(admin, org.id, { ...CONTACT_INPUT, firmId: firm.id });
    await updateContact(admin, org.id, created.id, {
      ...CONTACT_INPUT,
      firmId: firm.id,
      notes: "Ring etter kl. 9",
    });

    const rows = await db.select().from(auditLog).where(eq(auditLog.organizationId, org.id));
    expect(rows.map((r) => [r.entityType, r.action, r.entityId])).toEqual([
      ["contact", "create", created.id],
      ["contact", "update", created.id],
    ]);
    expect(rows[0]?.changes).toEqual({ contactId: created.id, firmId: firm.id, source: "manual" });
    expect(rows[1]?.changes).toEqual({
      contactId: created.id,
      firmId: firm.id,
      source: "manual",
      changedFields: ["notes"],
    });
  });

  it.each([["createContact"], ["updateContact"]] as const)(
    "%s skriver ingen personopplysninger i loggen",
    async (service) => {
      const { org, admin } = await orgWithAdmin();
      const firm = await insertFirm(org.id, { name: "Testmegling AS", orgNumber: "000000019" });
      const input = { ...CONTACT_INPUT, firmId: firm.id };
      if (service === "createContact") {
        await createContact(admin, org.id, input);
      } else {
        const contact = await insertContact(org.id, { firstName: "Annen", lastName: "Person" });
        await updateContact(admin, org.id, contact.id, input);
      }
      const text = JSON.stringify(await db.select().from(auditLog));
      for (const secret of [
        "Megler",
        "Testmegling AS",
        "000000019",
        "megler@example.com",
        "00000000",
        NOTE,
      ]) {
        expect(text).not.toContain(secret);
      }
    },
  );

  it("ingen rader i events, og ingen loggrad ved avvisning", async () => {
    const { org, admin } = await orgWithAdmin();
    const created = await createContact(admin, org.id, CONTACT_INPUT);
    await updateContact(admin, org.id, created.id, CONTACT_INPUT);
    const [eventCount] = await db.select({ n: count() }).from(events);
    expect(eventCount?.n).toBe(0);

    const auditBefore = (await counts()).audit;
    await expect(createContact(admin, org.id, { firstName: "" })).rejects.toThrow(ZodError);
    await expect(
      createContact(admin, org.id, { ...CONTACT_INPUT, firmId: randomUUID() }),
    ).rejects.toThrow(FirmNotFoundError);
    expect((await counts()).audit).toBe(auditBefore);
  });
});
