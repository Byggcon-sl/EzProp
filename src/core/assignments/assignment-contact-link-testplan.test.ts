import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError, type Actor } from "@/core/access";
import { ContactNotFoundError } from "@/core/contacts";
import { createOrder } from "@/core/orders";
import { db } from "@/db/client";
import {
  assignmentParties,
  auditLog,
  employees,
  events,
  orders,
  organizations,
  type EmployeeRole,
} from "@/db/schema";
import {
  createAssignment,
  createAssignmentParty,
  createContact,
  createEmployee,
  createFirm,
  createOffice,
  createOrganization,
  createUser,
  resetDatabase,
  TEST_NOW,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { addParty, getAssignment, removeParty, updateParty } from "./index";

/*
 * Partene på oppdraget koblet til kontaktregisteret: kjernen i src/core/assignments.
 * Testplan: docs/funksjoner/fase2a-koble-kontakter-testplan.md avsnitt 4, 6 og 7 (ordren har
 * sine i src/core/orders/orders.test.ts; 7.3 står i assignment-team-parties-transaction.test.ts).
 *
 * Avtalte signaturer (testplanen, «Avtale om signaturer»): `addParty`, `updateParty` og
 * `createOrder` har uendret signatur; `contactId` (parten) og `orderedByContactId` (ordren) kommer
 * i `input`. Kjernen slår opp kontakten i organisasjonen fra tilgangssjekken og setter firmaet
 * fra kontakten. Fremmed, ukjent eller slettet kontakt gir `ContactNotFoundError`, og ingenting
 * lagres. `getAssignment` gir `contactId` og `firmId` på hver part (rene kolonner).
 *
 * Testdata er oppdiktet: «Megler Test», «Testmegling AS», megler@example.com, telefon 00000000.
 * Fast tid: TEST_NOW.
 *
 * Støtter hovedmål: tid (megleren hentes fra registeret i stedet for å skrives på nytt),
 * reklamasjoner (koblingen kan aldri peke på en kontakt i en annen organisasjon eller en slettet
 * kontakt) og KI først (koblingen er kroken for e-post-til-ordre; ingen personopplysninger i
 * hendelser og logg).
 */

beforeEach(resetDatabase);

const FIRST_NAME = "Megler";
const LAST_NAME = "Testesen";
const CONTACT_EMAIL = "megler@example.com";
const CONTACT_PHONE = "00000000";
const FIRM_NAME = "Testmegling AS";
const DELETED_AT = new Date("2026-11-01T08:00:00Z");

/** Fritekst på parten som avviker fra kontakten (4.11). */
const OTHER_FREE_TEXT = {
  name: "Annen Fritekst",
  firmName: "Annet Firma AS",
  email: "annen@example.com",
  phone: "11111111",
};

type PartyInput = Parameters<typeof addParty>[3];

function partyInput(overrides: Record<string, unknown> = {}): PartyInput {
  return {
    role: "broker",
    name: `${FIRST_NAME} ${LAST_NAME}`,
    firmName: FIRM_NAME,
    email: CONTACT_EMAIL,
    phone: CONTACT_PHONE,
    receivesReport: true,
    receivesInvoice: false,
    receivesMessages: true,
    ...overrides,
  } as PartyInput;
}

async function setInspectorsEditAll(organizationId: string, value: boolean) {
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": value } })
    .where(eq(organizations.id, organizationId));
}

/** Organisasjon med admin, ett oppdrag, et firma og en kontakt i firmaet. */
async function setup(name = "Testfirma takst") {
  const org = await createOrganization(name);
  const admin = await createUser({ name: "Test Admin" });
  await createEmployee(admin, org.id, ["admin"]);
  const office = await createOffice(org.id, { name: "Testkontor Bodø" });
  const assignment = await createAssignment(org.id, { officeId: office.id });
  const firm = await createFirm(org.id, { name: FIRM_NAME });
  const contact = await createContact(org.id, {
    firstName: FIRST_NAME,
    lastName: LAST_NAME,
    email: CONTACT_EMAIL,
    phone: CONTACT_PHONE,
    firmId: firm.id,
  });
  return { org, admin, office, assignment, firm, contact };
}

/** En kontakt i en annen organisasjon (med firma), til IDOR-testene. */
async function foreignContact() {
  const orgB = await createOrganization("Organisasjon B");
  const firmB = await createFirm(orgB.id, { name: "Fremmedmegling AS" });
  const contactB = await createContact(orgB.id, { firstName: "Fremmed", firmId: firmB.id });
  return { orgB, firmB, contactB };
}

async function person(organizationId: string, roles: EmployeeRole[]) {
  const actor = await createUser();
  const employee = await createEmployee(actor, organizationId, roles);
  return { actor, employee };
}

async function partyRow(id: string) {
  const [row] = await db.select().from(assignmentParties).where(eq(assignmentParties.id, id));
  if (!row) throw new Error("fant ikke parten");
  return row;
}

async function rowCount(table: typeof assignmentParties | typeof events | typeof auditLog) {
  const [row] = await db.select({ n: count() }).from(table);
  return row?.n ?? 0;
}

async function tableCounts() {
  return {
    parties: await rowCount(assignmentParties),
    events: await rowCount(events),
    auditLog: await rowCount(auditLog),
  };
}

async function eventsFor(organizationId: string, type?: string) {
  const rows = await db.select().from(events).where(eq(events.organizationId, organizationId));
  return rows.filter((row) => type === undefined || row.type === type);
}

async function auditFor(organizationId: string, entityType?: string) {
  const rows = await db.select().from(auditLog).where(eq(auditLog.organizationId, organizationId));
  return rows.filter((row) => entityType === undefined || row.entityType === entityType);
}

/** Uuid-er byttet ut med «<id>», så oppdiktede verdier som 00000000 ikke treffer inni id-ene. */
function withoutIds(text: string): string {
  return text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>");
}

// ---------------------------------------------------------------------------------------------
// 4. Kjernen, partene
// ---------------------------------------------------------------------------------------------

describe("4. partene koblet til kontakter", () => {
  it.each([
    ["kontakt med firma", true],
    ["kontakt uten firma", false],
  ] as const)(
    "4.1 addParty_with_contact_sets_firm: %s gir contact_id og kontaktens firm_id",
    async (_name, withFirm) => {
      const s = await setup();
      const contact = withFirm
        ? s.contact
        : await createContact(s.org.id, { firstName: "Uten", lastName: "Firma" });

      const created = await addParty(
        s.admin,
        s.org.id,
        s.assignment.id,
        partyInput({ contactId: contact.id }),
      );

      const row = await partyRow(created.id);
      expect(row.contactId).toBe(contact.id);
      expect(row.firmId).toBe(withFirm ? s.firm.id : null);
      expect(row.organizationId).toBe(s.org.id);
    },
  );

  it("4.2 addParty_contact_with_deleted_firm_sets_firm_null", async () => {
    const s = await setup();
    const deletedFirm = await createFirm(s.org.id, { name: "Nedlagt AS", deletedAt: DELETED_AT });
    const contact = await createContact(s.org.id, { firmId: deletedFirm.id });

    const created = await addParty(
      s.admin,
      s.org.id,
      s.assignment.id,
      partyInput({ contactId: contact.id }),
    );

    const row = await partyRow(created.id);
    expect(row.contactId).toBe(contact.id);
    expect(row.firmId).toBeNull();
  });

  it("4.3 addParty_foreign_contact_throws_ContactNotFoundError_and_no_row (IDOR)", async () => {
    const s = await setup();
    const { orgB, contactB } = await foreignContact();
    const before = await tableCounts();

    await expect(
      addParty(s.admin, s.org.id, s.assignment.id, partyInput({ contactId: contactB.id })),
    ).rejects.toThrow(ContactNotFoundError);

    expect(await tableCounts()).toEqual(before);
    expect(await eventsFor(s.org.id)).toHaveLength(0);
    expect(await auditFor(s.org.id, "assignment_party")).toHaveLength(0);
    expect(await eventsFor(orgB.id)).toHaveLength(0);
  });

  it("4.3 ContactNotFoundError har meldingen «Kontakten finnes ikke.»", async () => {
    const s = await setup();
    const { contactB } = await foreignContact();
    const error = await addParty(
      s.admin,
      s.org.id,
      s.assignment.id,
      partyInput({ contactId: contactB.id }),
    ).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ContactNotFoundError);
    expect((error as Error).message).toBe("Kontakten finnes ikke.");
  });

  it.each([
    ["slettet kontakt i egen organisasjon", "deleted"],
    ["ukjent uuid", "unknown"],
  ] as const)(
    "4.4 addParty_deleted_contact_throws_and_no_row: %s gir ContactNotFoundError",
    async (_name, kind) => {
      const s = await setup();
      const contactId =
        kind === "deleted"
          ? (await createContact(s.org.id, { deletedAt: DELETED_AT })).id
          : randomUUID();
      const before = await tableCounts();

      await expect(
        addParty(s.admin, s.org.id, s.assignment.id, partyInput({ contactId })),
      ).rejects.toThrow(ContactNotFoundError);

      expect(await tableCounts()).toEqual(before);
    },
  );

  it("4.5 addParty_without_contact_free_text_only: begge kolonnene null, friteksten lagres", async () => {
    const s = await setup();

    const created = await addParty(s.admin, s.org.id, s.assignment.id, partyInput());

    const row = await partyRow(created.id);
    expect(row).toMatchObject({
      contactId: null,
      firmId: null,
      name: `${FIRST_NAME} ${LAST_NAME}`,
      firmName: FIRM_NAME,
      email: CONTACT_EMAIL,
      phone: CONTACT_PHONE,
    });
  });

  it("4.6 updateParty_sets_link: contact_id og firm_id settes; revisjonsloggen har fra/til med id-er", async () => {
    const s = await setup();
    const party = await createAssignmentParty(s.org.id, { assignmentId: s.assignment.id });

    const result = await updateParty(
      s.admin,
      s.org.id,
      party.id,
      partyInput({
        name: party.name,
        firmName: null,
        email: null,
        phone: null,
        receivesReport: false,
        receivesMessages: false,
        contactId: s.contact.id,
      }),
    );

    expect(result).toEqual({ id: party.id, changed: true });
    const row = await partyRow(party.id);
    expect(row.contactId).toBe(s.contact.id);
    expect(row.firmId).toBe(s.firm.id);

    const update = (await auditFor(s.org.id, "assignment_party")).find(
      (entry) => entry.action === "update",
    );
    expect(update).toBeDefined();
    const changes = update!.changes as Record<string, unknown>;
    expect(changes.fields).toEqual(expect.arrayContaining(["contactId", "firmId"]));
    expect(changes.contactId).toEqual({ from: null, to: s.contact.id });
    expect(changes.firmId).toEqual({ from: null, to: s.firm.id });
    expect(await eventsFor(s.org.id, "assignment.party_updated")).toHaveLength(1);
  });

  it("4.6b updateParty bytter fra én kontakt til en annen: firmaet følger den nye kontakten", async () => {
    const s = await setup();
    const otherFirm = await createFirm(s.org.id, { name: "Nordmegling AS" });
    const other = await createContact(s.org.id, { firstName: "Annen", firmId: otherFirm.id });
    const party = await createAssignmentParty(s.org.id, {
      assignmentId: s.assignment.id,
      contactId: s.contact.id,
      firmId: s.firm.id,
    });

    await updateParty(s.admin, s.org.id, party.id, partyInput({ contactId: other.id }));

    const row = await partyRow(party.id);
    expect(row.contactId).toBe(other.id);
    expect(row.firmId).toBe(otherFirm.id);
  });

  it.each([
    ["kontakt fra en annen organisasjon", "foreign"],
    ["slettet kontakt i egen organisasjon", "deleted"],
  ] as const)(
    "4.7 updateParty_foreign_contact_unchanged_row (IDOR): %s gir ContactNotFoundError, raden uendret",
    async (_name, kind) => {
      const s = await setup();
      const party = await createAssignmentParty(s.org.id, {
        assignmentId: s.assignment.id,
        contactId: s.contact.id,
        firmId: s.firm.id,
      });
      const contactId =
        kind === "foreign"
          ? (await foreignContact()).contactB.id
          : (await createContact(s.org.id, { deletedAt: DELETED_AT })).id;
      const before = await partyRow(party.id);
      const counts = await tableCounts();

      await expect(
        updateParty(s.admin, s.org.id, party.id, partyInput({ name: "Megler Endret", contactId })),
      ).rejects.toThrow(ContactNotFoundError);

      const after = await partyRow(party.id);
      expect(after).toEqual(before);
      expect(after.rowVersion).toBe(before.rowVersion);
      expect(after.updatedAt).toEqual(before.updatedAt);
      expect(await tableCounts()).toEqual(counts);
    },
  );

  it('4.8 updateParty_clear_link_sets_both_null: contactId "" fjerner koblingen', async () => {
    const s = await setup();
    const party = await createAssignmentParty(s.org.id, {
      assignmentId: s.assignment.id,
      contactId: s.contact.id,
      firmId: s.firm.id,
    });

    const result = await updateParty(
      s.admin,
      s.org.id,
      party.id,
      partyInput({ name: party.name, contactId: "" }),
    );

    expect(result.changed).toBe(true);
    const row = await partyRow(party.id);
    expect(row.contactId).toBeNull();
    expect(row.firmId).toBeNull();
    expect(row.name).toBe(party.name);
  });

  it("4.9 updateParty_omitted_contactId_sets_both_null: contactId mangler i input", async () => {
    const s = await setup();
    const party = await createAssignmentParty(s.org.id, {
      assignmentId: s.assignment.id,
      contactId: s.contact.id,
      firmId: s.firm.id,
    });
    const input = partyInput({ name: party.name }) as Record<string, unknown>;
    expect(input).not.toHaveProperty("contactId");

    await updateParty(s.admin, s.org.id, party.id, input as PartyInput);

    const row = await partyRow(party.id);
    expect(row.contactId).toBeNull();
    expect(row.firmId).toBeNull();
  });

  it("4.10 updateParty_same_link_no_change: samme kontakt og samme fritekst gir changed: false og ingen hendelse", async () => {
    const s = await setup();
    const created = await addParty(
      s.admin,
      s.org.id,
      s.assignment.id,
      partyInput({ contactId: s.contact.id }),
    );
    const before = await partyRow(created.id);
    const counts = await tableCounts();

    const result = await updateParty(
      s.admin,
      s.org.id,
      created.id,
      partyInput({ contactId: s.contact.id }),
    );

    expect(result).toEqual({ id: created.id, changed: false });
    expect(await tableCounts()).toEqual(counts);
    expect((await partyRow(created.id)).rowVersion).toBe(before.rowVersion);
  });

  it("4.11 free_text_not_overwritten: addParty og updateParty lagrer friteksten som sendt, også når den avviker fra kontakten", async () => {
    const s = await setup();

    const created = await addParty(
      s.admin,
      s.org.id,
      s.assignment.id,
      partyInput({ ...OTHER_FREE_TEXT, contactId: s.contact.id }),
    );
    expect(await partyRow(created.id)).toMatchObject({
      ...OTHER_FREE_TEXT,
      contactId: s.contact.id,
      firmId: s.firm.id,
    });

    const changed = { ...OTHER_FREE_TEXT, name: "Tredje Fritekst" };
    await updateParty(
      s.admin,
      s.org.id,
      created.id,
      partyInput({ ...changed, contactId: s.contact.id }),
    );
    expect(await partyRow(created.id)).toMatchObject({
      ...changed,
      contactId: s.contact.id,
      firmId: s.firm.id,
    });
  });

  it("4.12 getAssignment_returns_link: koblet part gir contactId/firmId, ukoblet gir null", async () => {
    const s = await setup();
    const linked = await addParty(
      s.admin,
      s.org.id,
      s.assignment.id,
      partyInput({ contactId: s.contact.id }),
    );
    const plain = await addParty(
      s.admin,
      s.org.id,
      s.assignment.id,
      partyInput({ role: "seller", name: "Selger Test" }),
    );

    const result = await getAssignment(s.admin, s.org.id, s.assignment.id);
    const byId = new Map(result.parties.map((row) => [row.id, row]));
    expect(byId.get(linked.id)).toMatchObject({ contactId: s.contact.id, firmId: s.firm.id });
    expect(byId.get(plain.id)).toMatchObject({ contactId: null, firmId: null });
  });

  it("4.12b getAssignment slår ikke opp kontakten: navnet er friteksten, ikke kontaktens navn", async () => {
    const s = await setup();
    await addParty(
      s.admin,
      s.org.id,
      s.assignment.id,
      partyInput({ ...OTHER_FREE_TEXT, contactId: s.contact.id }),
    );

    const [party] = (await getAssignment(s.admin, s.org.id, s.assignment.id)).parties;
    expect(party!.name).toBe(OTHER_FREE_TEXT.name);
    expect(JSON.stringify(party)).not.toContain(LAST_NAME);
  });

  it("4.12c tenant-isolasjon: getAssignment(...).parties med kobling viser aldri parter eller kontakter fra en annen organisasjon", async () => {
    const assignmentFor = new Map<string, string>();
    const contactFor = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids: Record<string, string[]> = {};
        for (const grant of [grantA, grantB]) {
          const firm = await createFirm(grant.organizationId);
          const contact = await createContact(grant.organizationId, { firmId: firm.id });
          const party = await createAssignmentParty(grant.organizationId, {
            contactId: contact.id,
            firmId: firm.id,
          });
          assignmentFor.set(grant.organizationId, party.assignmentId);
          contactFor.set(grant.organizationId, contact.id);
          ids[grant.organizationId] = [party.id];
        }
        return { a: ids[grantA.organizationId]!, b: ids[grantB.organizationId]! };
      },
      query: async (actor, organizationId) => {
        const parties = (
          await getAssignment(
            actor,
            organizationId,
            assignmentFor.get(organizationId) ?? randomUUID(),
          )
        ).parties;
        for (const party of parties) {
          expect(party.contactId).toBe(contactFor.get(organizationId));
        }
        return parties;
      },
      idOf: (row) => row.id,
    });
  });

  it("4.13 removed_party_not_updatable: myk slettet part kan ikke kobles; raden har fortsatt deleted_at", async () => {
    const s = await setup();
    const party = await createAssignmentParty(s.org.id, {
      assignmentId: s.assignment.id,
      deletedAt: DELETED_AT,
    });

    await expect(
      updateParty(s.admin, s.org.id, party.id, partyInput({ contactId: s.contact.id })),
    ).rejects.toThrow(AccessDeniedError);

    const row = await partyRow(party.id);
    expect(row.deletedAt).toEqual(DELETED_AT);
    expect(row.contactId).toBeNull();
    expect(row.firmId).toBeNull();
  });

  it("4.13b part på et annet oppdrag i en annen organisasjon kan ikke kobles til egen kontakt", async () => {
    const s = await setup();
    const { orgB } = await foreignContact();
    const partyB = await createAssignmentParty(orgB.id);

    await expect(
      updateParty(s.admin, s.org.id, partyB.id, partyInput({ contactId: s.contact.id })),
    ).rejects.toThrow(AccessDeniedError);
    expect((await partyRow(partyB.id)).contactId).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// 6. Tilgang per rolle (partene; ordren står i orders.test.ts)
// ---------------------------------------------------------------------------------------------

type RoleCase = { name: string; roles: EmployeeRole[]; editAll: boolean };

const ALLOWED: RoleCase[] = [
  { name: "takstmann med innstillingen på", roles: ["inspector"], editAll: true },
  { name: "kontor", roles: ["office"], editAll: false },
  { name: "leder", roles: ["manager"], editAll: false },
  { name: "admin", roles: ["admin"], editAll: false },
  { name: "admin med innstillingen på", roles: ["admin"], editAll: true },
];

/** De tre skrivefunksjonene med kontakt, hver for seg. */
function linkCalls(actor: Actor, s: Awaited<ReturnType<typeof setup>>, toUpdate: { id: string }) {
  return {
    addParty: () =>
      addParty(actor, s.org.id, s.assignment.id, partyInput({ contactId: s.contact.id })),
    updateParty: () =>
      updateParty(actor, s.org.id, toUpdate.id, partyInput({ contactId: s.contact.id })),
    createOrder: () =>
      createOrder(
        actor,
        s.org.id,
        { addressText: "Testveien 12, 8000 Bodø", orderedByContactId: s.contact.id } as Parameters<
          typeof createOrder
        >[2],
        TEST_NOW,
      ),
  };
}

async function orderCount() {
  const [row] = await db.select({ n: count() }).from(orders);
  return row?.n ?? 0;
}

describe("6. tilgang per rolle ved kobling", () => {
  it.each(["addParty", "updateParty", "createOrder"] as const)(
    "6.1 takstmann med access.inspectors_edit_all av får AccessDeniedError på %s med contactId; ingenting lagres",
    async (name) => {
      const s = await setup();
      await setInspectorsEditAll(s.org.id, false);
      const { actor } = await person(s.org.id, ["inspector"]);
      const toUpdate = await createAssignmentParty(s.org.id, { assignmentId: s.assignment.id });
      const before = { ...(await tableCounts()), orders: await orderCount() };
      const rowBefore = await partyRow(toUpdate.id);

      await expect(linkCalls(actor, s, toUpdate)[name]()).rejects.toThrow(AccessDeniedError);

      expect({ ...(await tableCounts()), orders: await orderCount() }).toEqual(before);
      expect(await partyRow(toUpdate.id)).toEqual(rowBefore);
    },
  );

  it.each(ALLOWED)("6.2 $name kan koble på addParty, updateParty og createOrder", async (c) => {
    const s = await setup();
    await setInspectorsEditAll(s.org.id, c.editAll);
    const { actor } = await person(s.org.id, c.roles);
    const toUpdate = await createAssignmentParty(s.org.id, { assignmentId: s.assignment.id });
    const calls = linkCalls(actor, s, toUpdate);

    const added = await calls.addParty();
    await calls.updateParty();
    const order = await calls.createOrder();

    expect((await partyRow(added.id)).contactId).toBe(s.contact.id);
    expect((await partyRow(toUpdate.id)).contactId).toBe(s.contact.id);
    const [orderRow] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(orderRow!.orderedByContactId).toBe(s.contact.id);
    expect(orderRow!.orderedByFirmId).toBe(s.firm.id);
  });

  // Regel 11: admin stenges aldri ute. Testen skal aldri fjernes.
  it("6.3 admin uten andre roller og med innstillingen av kan koble alle tre", async () => {
    const s = await setup();
    await setInspectorsEditAll(s.org.id, false);
    const toUpdate = await createAssignmentParty(s.org.id, { assignmentId: s.assignment.id });
    const calls = linkCalls(s.admin, s, toUpdate);

    const added = await calls.addParty();
    await calls.updateParty();
    const order = await calls.createOrder();

    expect((await partyRow(added.id)).firmId).toBe(s.firm.id);
    expect((await partyRow(toUpdate.id)).firmId).toBe(s.firm.id);
    const [orderRow] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(orderRow!.orderedByContactId).toBe(s.contact.id);
  });

  it.each([
    ["slettet ansattkobling", { deletedAt: DELETED_AT }],
    ["deaktivert ansatt", { deactivatedAt: DELETED_AT }],
  ] as const)(
    "6.4 %s (admin) får AccessDeniedError på alle tre; ingenting lagres",
    async (_name, set) => {
      const s = await setup();
      const { actor, employee } = await person(s.org.id, ["admin"]);
      await db.update(employees).set(set).where(eq(employees.id, employee.id));
      const toUpdate = await createAssignmentParty(s.org.id, { assignmentId: s.assignment.id });
      const before = { ...(await tableCounts()), orders: await orderCount() };
      const calls = linkCalls(actor, s, toUpdate);

      for (const call of [calls.addParty, calls.updateParty, calls.createOrder]) {
        await expect(call()).rejects.toThrow(AccessDeniedError);
      }
      expect({ ...(await tableCounts()), orders: await orderCount() }).toEqual(before);
      expect((await partyRow(toUpdate.id)).contactId).toBeNull();
    },
  );

  it("6.5 admin i en annen organisasjon får AccessDeniedError på oppdrag, part og ordre i A", async () => {
    const s = await setup();
    const orgB = await createOrganization("Organisasjon B");
    const adminB = await createUser({ name: "Admin B" });
    await createEmployee(adminB, orgB.id, ["admin"]);
    const toUpdate = await createAssignmentParty(s.org.id, { assignmentId: s.assignment.id });
    const before = { ...(await tableCounts()), orders: await orderCount() };
    const calls = linkCalls(adminB, s, toUpdate);

    for (const call of [calls.addParty, calls.updateParty, calls.createOrder]) {
      await expect(call()).rejects.toThrow(AccessDeniedError);
    }
    expect({ ...(await tableCounts()), orders: await orderCount() }).toEqual(before);
  });

  it("6.5b admin i B som sender sin egen organisasjon, men A sitt oppdrag og A sin kontakt, får ingen kobling", async () => {
    const s = await setup();
    const orgB = await createOrganization("Organisasjon B");
    const adminB = await createUser({ name: "Admin B" });
    await createEmployee(adminB, orgB.id, ["admin"]);
    const assignmentB = await createAssignment(orgB.id);

    // A sitt oppdrag fra B: nektet
    await expect(
      addParty(adminB, orgB.id, s.assignment.id, partyInput({ contactId: s.contact.id })),
    ).rejects.toThrow(AccessDeniedError);
    // Eget oppdrag i B med A sin kontakt: kontakten finnes ikke i B
    await expect(
      addParty(adminB, orgB.id, assignmentB.id, partyInput({ contactId: s.contact.id })),
    ).rejects.toThrow(ContactNotFoundError);
    expect(await rowCount(assignmentParties)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// 7. Logg og personvern
// ---------------------------------------------------------------------------------------------

describe("7. logg og personvern", () => {
  it("7.1 audit_and_events_contain_no_pii: ingen navn, e-post, telefon eller fritekst i revisjonslogg og hendelser; id-ene står der", async () => {
    const s = await setup();
    const created = await addParty(
      s.admin,
      s.org.id,
      s.assignment.id,
      partyInput({ ...OTHER_FREE_TEXT, contactId: s.contact.id }),
    );
    const plain = await addParty(s.admin, s.org.id, s.assignment.id, partyInput());
    await updateParty(
      s.admin,
      s.org.id,
      plain.id,
      partyInput({ name: "Megler Endret", contactId: s.contact.id }),
    );
    await updateParty(s.admin, s.org.id, created.id, partyInput({ ...OTHER_FREE_TEXT }));
    await removeParty(s.admin, s.org.id, created.id);
    const order = await createOrder(
      s.admin,
      s.org.id,
      {
        addressText: "Testveien 12, 8000 Bodø",
        orderedByText: `${FIRST_NAME} ${LAST_NAME}, ${FIRM_NAME}`,
        orderedByContactId: s.contact.id,
      } as Parameters<typeof createOrder>[2],
      TEST_NOW,
    );

    const allEvents = await eventsFor(s.org.id);
    const allAudit = await auditFor(s.org.id);
    expect(allEvents.length).toBeGreaterThanOrEqual(6);
    expect(allAudit.length).toBeGreaterThanOrEqual(6);
    const raw = JSON.stringify([allEvents, allAudit]);
    const text = withoutIds(raw);

    const forbidden = [
      FIRST_NAME,
      LAST_NAME,
      CONTACT_EMAIL,
      CONTACT_PHONE,
      FIRM_NAME,
      "Testmegling",
      ...Object.values(OTHER_FREE_TEXT),
      "Megler Endret",
    ];
    for (const value of forbidden) expect(text, value).not.toContain(value);

    // Id-ene står der (koblingen er sporbar)
    expect(raw).toContain(s.contact.id);
    expect(raw).toContain(s.firm.id);
    const orderAudit = allAudit.find(
      (row) => row.entityType === "order" && row.entityId === order.id,
    );
    expect(orderAudit).toBeDefined();
    expect(orderAudit!.changes).toMatchObject({
      orderedByContactId: s.contact.id,
      orderedByFirmId: s.firm.id,
    });
  });

  it("7.2 party_events_shape_unchanged: party_added og party_updated har nøyaktig partyId og role", async () => {
    const s = await setup();
    const created = await addParty(
      s.admin,
      s.org.id,
      s.assignment.id,
      partyInput({ contactId: s.contact.id }),
    );
    await updateParty(s.admin, s.org.id, created.id, partyInput({ contactId: "" }));

    for (const type of ["assignment.party_added", "assignment.party_updated"]) {
      const rows = await eventsFor(s.org.id, type);
      expect(rows, type).toHaveLength(1);
      expect(Object.keys(rows[0]!.data as object).sort(), type).toEqual(["partyId", "role"]);
      expect(rows[0]!.data, type).toEqual({ partyId: created.id, role: "broker" });
    }
  });

  it("7.2b fjernet kobling står i revisjonsloggen med fra/til som id-er", async () => {
    const s = await setup();
    const created = await addParty(
      s.admin,
      s.org.id,
      s.assignment.id,
      partyInput({ contactId: s.contact.id }),
    );
    await updateParty(s.admin, s.org.id, created.id, partyInput({ contactId: "" }));

    const update = (await auditFor(s.org.id, "assignment_party")).find(
      (row) => row.action === "update",
    );
    const changes = update!.changes as Record<string, unknown>;
    expect(changes.fields).toEqual(expect.arrayContaining(["contactId", "firmId"]));
    expect(changes.contactId).toEqual({ from: s.contact.id, to: null });
    expect(changes.firmId).toEqual({ from: s.firm.id, to: null });
  });
});
