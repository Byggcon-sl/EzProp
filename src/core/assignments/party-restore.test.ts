import { randomUUID } from "node:crypto";
import { count, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, type Actor } from "@/core/access";
import { mergeContacts, removeContact, removeFirm } from "@/core/contacts";
import { db } from "@/db/client";
import {
  assignmentParties,
  auditLog,
  employees,
  events,
  organizations,
  type EmployeeRole,
} from "@/db/schema";
import {
  TEST_NOW,
  createAssignment,
  createAssignmentParty,
  createContact,
  createEmployee,
  createFirm,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import {
  PARTY_CONTACT_REMOVED_NOTICE,
  PARTY_FIRM_REMOVED_NOTICE,
  cancelAssignment,
  removeParty,
  restoreParty,
} from "./index";

/*
 * Gjenoppretting av part på oppdraget (docs/funksjoner/fase2a-papirkurv.md A415, A416, A417;
 * testplanen docs/funksjoner/fase2a-papirkurv-testplan.md avsnitt 4, 5.5 og 7.1–7.5).
 *
 * Signatur fra «Avtale om signaturer»: `restoreParty(actor, organizationId, partyId, how)` gir
 * `{ restored: { type, id, organizationId }[], changed, notices }`. Fasit står i testen.
 *
 * Fast tid: parten fjernes ved TEST_NOW og hentes tilbake 42 sekunder senere (bare `Date` er
 * falsk). Testdata er oppdiktet: «Ola Testmann», ola.testmann@example.invalid, 90000000.
 *
 * Støtter hovedmål: de ansatte (feiltrykk på «Fjern» rettes med «Angre»), færre reklamasjoner
 * (sporet står i revisjonsloggen, aldri kobling til en fjernet kontakt) og personvern (ingen
 * navn, e-post eller telefon i hendelser eller logg).
 */

const PARTY_NAME = "Ola Testmann";
const PARTY_FIRM_NAME = "Testmegling Nord AS";
const PARTY_EMAIL = "ola.testmann@example.invalid";
const PARTY_PHONE = "90000000";
const PERSONAL_VALUES = [PARTY_NAME, PARTY_FIRM_NAME, PARTY_EMAIL, PARTY_PHONE];
const RESTORED_AT = new Date(TEST_NOW.getTime() + 42 * 1000);

beforeEach(async () => {
  await resetDatabase();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TEST_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Organisasjon med admin og ett oppdrag. */
async function orgWithAdmin(name = "Oppdiktet Takst A") {
  const org = await createOrganization(name);
  const admin = await createUser({ name: "Admin Testesen" });
  const adminEmployee = await createEmployee(admin, org.id, ["admin"]);
  const assignment = await createAssignment(org.id);
  return { org, admin, adminEmployee, assignment };
}

/** En person med rollene i organisasjonen. */
async function person(organizationId: string, roles: EmployeeRole[]) {
  const actor = await createUser({ name: "Ansatt Testesen" });
  const employee = await createEmployee(actor, organizationId, roles);
  return { actor, employee };
}

async function setInspectorsEditAll(organizationId: string, value: boolean) {
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": value } })
    .where(eq(organizations.id, organizationId));
}

/** En aktiv part med oppdiktede personopplysninger. */
function createParty(
  organizationId: string,
  assignmentId: string,
  link: { contactId?: string | null; firmId?: string | null } = {},
) {
  return createAssignmentParty(organizationId, {
    assignmentId,
    role: "seller",
    name: PARTY_NAME,
    firmName: PARTY_FIRM_NAME,
    email: PARTY_EMAIL,
    phone: PARTY_PHONE,
    receivesReport: true,
    receivesMessages: true,
    ...link,
  });
}

/** Fjerner parten med kjernen ved TEST_NOW og stiller klokka 42 sekunder fram. */
async function removeNow(actor: Actor, organizationId: string, partyId: string) {
  vi.setSystemTime(TEST_NOW);
  await removeParty(actor, organizationId, partyId);
  vi.setSystemTime(RESTORED_AT);
}

async function partyRow(id: string) {
  const [row] = await db.select().from(assignmentParties).where(eq(assignmentParties.id, id));
  if (!row) throw new Error("fant ikke parten");
  return row;
}

async function eventsFor(organizationId: string, type?: string) {
  const rows = await db.select().from(events).where(eq(events.organizationId, organizationId));
  return rows.filter((row) => type === undefined || row.type === type);
}

async function restoreAudit(organizationId: string) {
  const rows = await db.select().from(auditLog).where(eq(auditLog.organizationId, organizationId));
  return rows.filter((row) => row.action === "restore");
}

async function counts() {
  const [parties] = await db.select({ n: count() }).from(assignmentParties);
  const [eventRows] = await db.select({ n: count() }).from(events);
  const [auditRows] = await db.select({ n: count() }).from(auditLog);
  return { parties: parties?.n ?? 0, events: eventRows?.n ?? 0, audit: auditRows?.n ?? 0 };
}

/** Fanger feilen fra en handling som skal feile. */
async function caught(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => null,
    (error: unknown) => error,
  );
}

// ---------------------------------------------------------------------------------------------
// 7.1–7.5 Parter (A415)
// ---------------------------------------------------------------------------------------------

describe("7 restoreParty: koblingen til kontakt og firma (A415)", () => {
  it("7.1 part med aktiv kontakt og firma kommer tilbake med samme id, verdier og koblinger", async () => {
    const { org, admin, adminEmployee, assignment } = await orgWithAdmin();
    const firm = await createFirm(org.id);
    const contact = await createContact(org.id, { firmId: firm.id });
    const party = await createParty(org.id, assignment.id, {
      contactId: contact.id,
      firmId: firm.id,
    });
    await removeNow(admin, org.id, party.id);

    const result = await restoreParty(admin, org.id, party.id, "undo");

    expect(result).toEqual({
      restored: [{ type: "party", id: party.id, organizationId: org.id }],
      changed: true,
      notices: [],
    });
    const row = await partyRow(party.id);
    expect(row).toMatchObject({
      id: party.id,
      assignmentId: assignment.id,
      role: "seller",
      name: PARTY_NAME,
      firmName: PARTY_FIRM_NAME,
      email: PARTY_EMAIL,
      phone: PARTY_PHONE,
      receivesReport: true,
      receivesInvoice: false,
      receivesMessages: true,
      contactId: contact.id,
      firmId: firm.id,
      deletedAt: null,
      deletedBy: null,
      updatedBy: adminEmployee.id,
    });

    const [event] = await eventsFor(org.id, "assignment.party_restored");
    expect(event?.assignmentId).toBe(assignment.id);
    expect(event?.data).toEqual({
      partyId: party.id,
      role: "seller",
      how: "undo",
      secondsSinceRemoval: 42,
    });
    const audit = await restoreAudit(org.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ entityType: "assignment_party", entityId: party.id });
    expect(audit[0]?.changes).toEqual({ assignmentId: assignment.id, role: "seller", how: "undo" });
  });

  it("7.1 slettelinjen i revisjonsloggen og fjern-hendelsen er uendret etter gjenopprettingen", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const party = await createParty(org.id, assignment.id);
    await removeNow(admin, org.id, party.id);
    const deleteRows = async () =>
      (await db.select().from(auditLog).where(eq(auditLog.organizationId, org.id))).filter(
        (row) => row.action === "delete",
      );
    const before = await deleteRows();
    const removedBefore = await eventsFor(org.id, "assignment.party_removed");

    await restoreParty(admin, org.id, party.id, "trash");

    expect(await deleteRows()).toEqual(before);
    expect(await eventsFor(org.id, "assignment.party_removed")).toEqual(removedBefore);
    expect(removedBefore[0]?.data).toEqual({ partyId: party.id, role: "seller" });
  });

  it("7.2 kontakten er fjernet: kontakt og firma blir null, navn og verdier står, med beskjed", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const firm = await createFirm(org.id);
    const contact = await createContact(org.id, { firmId: firm.id });
    const party = await createParty(org.id, assignment.id, {
      contactId: contact.id,
      firmId: firm.id,
    });
    await removeNow(admin, org.id, party.id);
    await removeContact(admin, org.id, contact.id);

    const result = await restoreParty(admin, org.id, party.id, "trash");

    expect(result.changed).toBe(true);
    expect(result.notices).toEqual([
      "Parten kom tilbake, men kontakten den var koblet til, er fjernet.",
    ]);
    expect(PARTY_CONTACT_REMOVED_NOTICE).toBe(result.notices[0]);
    const row = await partyRow(party.id);
    expect(row).toMatchObject({
      name: PARTY_NAME,
      firmName: PARTY_FIRM_NAME,
      email: PARTY_EMAIL,
      phone: PARTY_PHONE,
      contactId: null,
      firmId: null,
      deletedAt: null,
    });
    const [audit] = await restoreAudit(org.id);
    expect(audit?.changes).toEqual({
      assignmentId: assignment.id,
      role: "seller",
      how: "trash",
      contactId: { from: contact.id, to: null },
      firmId: { from: firm.id, to: null },
    });
  });

  it("7.3 firmaet er fjernet: firmaet blir null, kontakten står, med beskjed", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const firm = await createFirm(org.id);
    const contact = await createContact(org.id, { firmId: firm.id });
    const party = await createParty(org.id, assignment.id, {
      contactId: contact.id,
      firmId: firm.id,
    });
    await removeNow(admin, org.id, party.id);
    await removeFirm(admin, org.id, firm.id);

    const result = await restoreParty(admin, org.id, party.id, "trash");

    expect(result.notices).toEqual([
      "Parten kom tilbake, men firmaet den var koblet til, er fjernet.",
    ]);
    expect(PARTY_FIRM_REMOVED_NOTICE).toBe(result.notices[0]);
    expect(await partyRow(party.id)).toMatchObject({
      name: PARTY_NAME,
      firmName: PARTY_FIRM_NAME,
      contactId: contact.id,
      firmId: null,
      deletedAt: null,
    });
  });

  it("7.4 sammenslått kontakt: parten kommer tilbake med den flyttede koblingen", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const firm = await createFirm(org.id);
    const keep = await createContact(org.id, { firmId: firm.id, firstName: "Beholdt" });
    const merged = await createContact(org.id, { firmId: null, firstName: "Sammenslått" });
    const party = await createParty(org.id, assignment.id, { contactId: merged.id });
    await removeNow(admin, org.id, party.id);
    await mergeContacts(admin, org.id, { keepId: keep.id, removeId: merged.id });

    const result = await restoreParty(admin, org.id, party.id, "trash");

    expect(result.notices).toEqual([]);
    expect(await partyRow(party.id)).toMatchObject({
      contactId: keep.id,
      firmId: firm.id,
      deletedAt: null,
    });
  });

  it("7.5 kontakt i en annen organisasjon: databasen nekter koblingen, og B sin kontakt blir aldri koblet", async () => {
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    const contactB = await createContact(b.org.id);
    const contactA = await createContact(a.org.id);

    // Rad lagt inn direkte, utenom kjernen: den sammensatte fremmednøkkelen stopper den
    const error = await caught(
      db.execute(sql`
        insert into assignment_parties
          (organization_id, assignment_id, role, name, contact_id, deleted_at)
        values (${a.org.id}, ${a.assignment.id}, 'seller', ${PARTY_NAME}, ${contactB.id}, now())`),
    );
    expect(error).not.toBeNull();

    // Parten i A med egen kontakt kommer tilbake med A sin kontakt, aldri med B sin
    const party = await createParty(a.org.id, a.assignment.id, { contactId: contactA.id });
    await removeNow(a.admin, a.org.id, party.id);
    await restoreParty(a.admin, a.org.id, party.id, "undo");
    const row = await partyRow(party.id);
    expect(row.contactId).toBe(contactA.id);
    expect(row.contactId).not.toBe(contactB.id);
  });
});

// ---------------------------------------------------------------------------------------------
// Gjentatte kall og persondata
// ---------------------------------------------------------------------------------------------

describe("restoreParty: gjentatte kall og persondata", () => {
  it("andre kall gir changed: false og ingen ny hendelse eller loggrad", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const party = await createParty(org.id, assignment.id);
    await removeNow(admin, org.id, party.id);

    const first = await restoreParty(admin, org.id, party.id, "undo");
    const before = await counts();
    const second = await restoreParty(admin, org.id, party.id, "undo");

    expect(first.changed).toBe(true);
    expect(second).toEqual({
      restored: [{ type: "party", id: party.id, organizationId: org.id }],
      changed: false,
      notices: [],
    });
    expect(await counts()).toEqual(before);
    expect(await eventsFor(org.id, "assignment.party_restored")).toHaveLength(1);
    expect(await restoreAudit(org.id)).toHaveLength(1);
  });

  it("en part som aldri er fjernet gir changed: false og ingen spor", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const party = await createParty(org.id, assignment.id);
    const before = await counts();
    const rowBefore = await partyRow(party.id);

    const result = await restoreParty(admin, org.id, party.id, "trash");

    expect(result.changed).toBe(false);
    expect(await counts()).toEqual(before);
    expect(await partyRow(party.id)).toEqual(rowBefore);
  });

  it("ingen navn, firmanavn, e-post eller telefon i hendelsene eller revisjonsloggen", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const contact = await createContact(org.id);
    const party = await createParty(org.id, assignment.id, { contactId: contact.id });
    await removeNow(admin, org.id, party.id);
    await removeContact(admin, org.id, contact.id);
    await restoreParty(admin, org.id, party.id, "trash");

    const eventData = (await eventsFor(org.id)).map((row) => JSON.stringify(row.data));
    const auditChanges = (
      await db.select().from(auditLog).where(eq(auditLog.organizationId, org.id))
    ).map((row) => JSON.stringify(row.changes));
    for (const text of [...eventData, ...auditChanges]) {
      for (const value of PERSONAL_VALUES) expect(text).not.toContain(value);
    }
  });

  it("ukjent måte å hente tilbake på avvises før noe skrives", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const party = await createParty(org.id, assignment.id);
    await removeNow(admin, org.id, party.id);
    const before = await counts();

    const error = await caught(restoreParty(admin, org.id, party.id, "auto" as unknown as "undo"));

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AccessDeniedError);
    expect(await counts()).toEqual(before);
    expect((await partyRow(party.id)).deletedAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// 4 Tilgang per rolle og avslag uten lekkasje (A417, A416)
// ---------------------------------------------------------------------------------------------

describe("4 restoreParty: tilgang per rolle", () => {
  const CASES: {
    name: string;
    roles: EmployeeRole[];
    editAll?: boolean;
    deleted?: boolean;
    allowed: boolean;
  }[] = [
    {
      name: "takstmann med access.inspectors_edit_all på",
      roles: ["inspector"],
      editAll: true,
      allowed: true,
    },
    {
      name: "takstmann med access.inspectors_edit_all av",
      roles: ["inspector"],
      editAll: false,
      allowed: false,
    },
    { name: "kontor", roles: ["office"], allowed: true },
    { name: "leder", roles: ["manager"], allowed: true },
    { name: "admin som eneste rolle (regel 11)", roles: ["admin"], allowed: true },
    { name: "slettet ansatt", roles: ["admin"], deleted: true, allowed: false },
  ];

  it.each(CASES)("$name", async ({ roles, editAll, deleted, allowed }) => {
    const { org, admin, assignment } = await orgWithAdmin();
    if (editAll !== undefined) await setInspectorsEditAll(org.id, editAll);
    const { actor, employee } = await person(org.id, roles);
    if (deleted) {
      await db.update(employees).set({ deletedAt: TEST_NOW }).where(eq(employees.id, employee.id));
    }
    const party = await createParty(org.id, assignment.id);
    await removeNow(admin, org.id, party.id);
    const before = await counts();

    const run = restoreParty(actor, org.id, party.id, "trash");

    if (allowed) {
      expect((await run).changed).toBe(true);
      expect((await partyRow(party.id)).deletedAt).toBeNull();
    } else {
      await expect(run).rejects.toBeInstanceOf(AccessDeniedError);
      expect((await partyRow(party.id)).deletedAt).not.toBeNull();
      expect(await counts()).toEqual(before);
    }
  });
});

describe("4.1 restoreParty: samme avslag uten lekkasje", () => {
  it("ukjent id, annen organisasjon, ugyldig UUID og kansellert oppdrag gir samme avslag uten spor", async () => {
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    const partyB = await createParty(b.org.id, b.assignment.id);
    await removeNow(b.admin, b.org.id, partyB.id);

    const cancelled = await createAssignment(a.org.id);
    const partyCancelled = await createParty(a.org.id, cancelled.id);
    await removeNow(a.admin, a.org.id, partyCancelled.id);
    await cancelAssignment(a.admin, a.org.id, cancelled.id, {
      expectedStatus: "ordered",
      reason: "Avbestilt test",
    });

    const before = await counts();
    const errors = [
      await caught(restoreParty(a.admin, a.org.id, randomUUID(), "undo")),
      await caught(restoreParty(a.admin, a.org.id, partyB.id, "undo")),
      await caught(restoreParty(a.admin, a.org.id, "ikke-en-id", "undo")),
      await caught(restoreParty(a.admin, a.org.id, partyCancelled.id, "trash")),
    ];

    const messages = new Set<string>();
    for (const error of errors) {
      expect(error).toBeInstanceOf(AccessDeniedError);
      messages.add((error as Error).message);
    }
    expect(messages.size).toBe(1);
    expect(await counts()).toEqual(before);
    expect((await partyRow(partyB.id)).deletedAt).not.toBeNull();
    expect((await partyRow(partyCancelled.id)).deletedAt).not.toBeNull();
  });

  it("kansellert oppdrag gir avslag for alle roller, også admin (A416)", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, true);
    const party = await createParty(org.id, assignment.id);
    await removeNow(admin, org.id, party.id);
    await cancelAssignment(admin, org.id, assignment.id, {
      expectedStatus: "ordered",
      reason: "Avbestilt test",
    });
    const before = await counts();

    for (const roles of [["inspector"], ["office"], ["manager"], ["admin"]] as EmployeeRole[][]) {
      const { actor } = await person(org.id, roles);
      await expect(restoreParty(actor, org.id, party.id, "trash")).rejects.toBeInstanceOf(
        AccessDeniedError,
      );
    }
    await expect(restoreParty(admin, org.id, party.id, "undo")).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    expect(await counts()).toEqual(before);
    expect((await partyRow(party.id)).deletedAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// 5.5 Tenant-isolasjon (regel 2)
// ---------------------------------------------------------------------------------------------

describe("5.5 restoreParty: tenant-isolasjon", () => {
  it("expectTenantIsolation: gjenoppretting gir aldri en part fra en annen organisasjon", async () => {
    const partyFor = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const grant of [grantA, grantB]) {
          const assignment = await createAssignment(grant.organizationId);
          const party = await createParty(grant.organizationId, assignment.id);
          await db
            .update(assignmentParties)
            .set({ deletedAt: TEST_NOW, deletedBy: grant.employeeId })
            .where(eq(assignmentParties.id, party.id));
          partyFor.set(grant.organizationId, party.id);
        }
        return {
          a: [partyFor.get(grantA.organizationId)!],
          b: [partyFor.get(grantB.organizationId)!],
        };
      },
      query: async (actor, organizationId) =>
        (
          await restoreParty(
            actor,
            organizationId,
            partyFor.get(organizationId) ?? randomUUID(),
            "trash",
          )
        ).restored,
      idOf: (row) => row.id,
    });
  });
});
