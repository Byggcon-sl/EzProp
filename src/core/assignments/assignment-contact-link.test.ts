import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError } from "@/core/access";
import { ContactNotFoundError } from "@/core/contacts";
import { createOrder } from "@/core/orders";
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
  createAssignment,
  createAssignmentParty,
  createContact,
  createEmployee,
  createFirm,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { addParty, getAssignment, removeParty, updateParty } from "./index";

/*
 * Partene koblet til kontaktregisteret: kjernen i src/core/assignments
 * (docs/funksjoner/fase2a-koble-kontakter-testplan.md avsnitt 4, 6 og 7). Ordren står i
 * src/core/orders/orders.test.ts, transaksjonen i assignment-team-parties-transaction.test.ts.
 *
 * Ingen ny spørring med `organizationId` her: oppslaget i registeret (`findContactForLink`) har
 * tenant-testen sin i src/core/contacts/link.test.ts. Fremmed kontakt prøves som IDOR under.
 *
 * Testdata er oppdiktet: kontakten «Kari Kontaktesen» (kari@example.com, 11111111) i
 * «Testmegling AS»; friteksten på parten «Megler Fritekst» (fritekst@example.com, 22222222).
 *
 * Støtter hovedmål: reklamasjoner (koblingen peker aldri på en fremmed eller slettet kontakt,
 * aldri personopplysninger i logg og hendelser) og KI først (kroken for e-post-til-ordre).
 */

beforeEach(resetDatabase);

const DELETED = new Date("2026-11-01T08:00:00Z");
const NOW = new Date("2026-11-03T10:00:00Z");

const CONTACT = {
  firstName: "Kari",
  lastName: "Kontaktesen",
  email: "kari@example.com",
  phone: "11111111",
};
const FREE_TEXT = {
  name: "Megler Fritekst",
  firmName: "Fritekst Megling AS",
  email: "fritekst@example.com",
  phone: "22222222",
};
const PERSONAL_VALUES = [...Object.values(CONTACT), ...Object.values(FREE_TEXT)];

type PartyInput = Parameters<typeof addParty>[3];

function partyInput(overrides: Record<string, unknown> = {}): PartyInput {
  return {
    role: "broker",
    ...FREE_TEXT,
    receivesReport: true,
    receivesInvoice: false,
    receivesMessages: false,
    ...overrides,
  } as PartyInput;
}

async function setInspectorsEditAll(organizationId: string, value: boolean) {
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": value } })
    .where(eq(organizations.id, organizationId));
}

/** Organisasjon med admin, oppdrag, firma og en kontakt i firmaet. */
async function setup(name = "Testfirma takst") {
  const org = await createOrganization(name);
  const admin = await createUser({ name: "Test Admin" });
  await createEmployee(admin, org.id, ["admin"]);
  const assignment = await createAssignment(org.id);
  const firm = await createFirm(org.id, { name: "Testmegling AS" });
  const contact = await createContact(org.id, { ...CONTACT, firmId: firm.id });
  return { org, admin, assignment, firm, contact };
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

// ---------------------------------------------------------------------------------------------
// 4. Kjernen, partene
// ---------------------------------------------------------------------------------------------

describe("4. partene koblet til kontakter", () => {
  it.each([
    ["med firma", true],
    ["uten firma", false],
  ])("4.1 addParty_with_contact_sets_firm: kontakt %s", async (_name, withFirm) => {
    const { org, admin, assignment, firm } = await setup();
    const contact = await createContact(org.id, withFirm ? { firmId: firm.id } : {});

    const { id } = await addParty(
      admin,
      org.id,
      assignment.id,
      partyInput({ contactId: contact.id }),
    );

    const row = await partyRow(id);
    expect(row.contactId).toBe(contact.id);
    expect(row.firmId).toBe(withFirm ? firm.id : null);
  });

  it("4.2 addParty_contact_with_deleted_firm_sets_firm_null", async () => {
    const { org, admin, assignment } = await setup();
    const deletedFirm = await createFirm(org.id, { deletedAt: DELETED });
    const contact = await createContact(org.id, { firmId: deletedFirm.id });

    const { id } = await addParty(
      admin,
      org.id,
      assignment.id,
      partyInput({ contactId: contact.id }),
    );

    expect(await partyRow(id)).toMatchObject({ contactId: contact.id, firmId: null });
  });

  it("4.3 addParty_foreign_contact_throws_ContactNotFoundError_and_no_row (IDOR)", async () => {
    const { org, admin, assignment } = await setup("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const contactB = await createContact(orgB.id, CONTACT);
    const before = await tableCounts();

    await expect(
      addParty(admin, org.id, assignment.id, partyInput({ contactId: contactB.id })),
    ).rejects.toThrow(ContactNotFoundError);

    expect(await tableCounts()).toEqual(before);
    expect(await eventsFor(org.id)).toHaveLength(0);
    expect(await auditFor(org.id)).toHaveLength(0);
  });

  it("4.4 addParty_deleted_contact_throws_and_no_row", async () => {
    const { org, admin, assignment } = await setup();
    const deleted = await createContact(org.id, { deletedAt: DELETED });
    const before = await tableCounts();

    await expect(
      addParty(admin, org.id, assignment.id, partyInput({ contactId: deleted.id })),
    ).rejects.toThrow(ContactNotFoundError);

    expect(await tableCounts()).toEqual(before);
  });

  it("4.5 addParty_without_contact_free_text_only", async () => {
    const { org, admin, assignment } = await setup();

    const { id } = await addParty(admin, org.id, assignment.id, partyInput());

    expect(await partyRow(id)).toMatchObject({ ...FREE_TEXT, contactId: null, firmId: null });
  });

  it("4.6 updateParty_sets_link: contactId og firmId med fra/til i revisjonsloggen", async () => {
    const { org, admin, assignment, firm, contact } = await setup();
    const party = await createAssignmentParty(org.id, {
      assignmentId: assignment.id,
      ...FREE_TEXT,
      receivesReport: true,
    });

    const result = await updateParty(
      admin,
      org.id,
      party.id,
      partyInput({ contactId: contact.id }),
    );

    expect(result).toEqual({ id: party.id, changed: true });
    expect(await partyRow(party.id)).toMatchObject({ contactId: contact.id, firmId: firm.id });
    const [audit] = await auditFor(org.id, "assignment_party");
    expect(audit?.action).toBe("update");
    expect(audit?.changes).toMatchObject({
      fields: ["contactId", "firmId"],
      contactId: { from: null, to: contact.id },
      firmId: { from: null, to: firm.id },
    });
  });

  it("4.7 updateParty_foreign_contact_unchanged_row (IDOR): raden er uendret, ingen hendelse", async () => {
    const { org, admin, assignment, contact } = await setup("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const contactB = await createContact(orgB.id);
    const party = await createAssignmentParty(org.id, {
      assignmentId: assignment.id,
      ...FREE_TEXT,
      contactId: contact.id,
      firmId: contact.firmId,
    });
    const before = await partyRow(party.id);
    const counts = await tableCounts();

    await expect(
      updateParty(
        admin,
        org.id,
        party.id,
        partyInput({ name: "Megler Endret", contactId: contactB.id }),
      ),
    ).rejects.toThrow(ContactNotFoundError);

    const after = await partyRow(party.id);
    expect(after).toEqual(before);
    expect(after.rowVersion).toBe(before.rowVersion);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(await tableCounts()).toEqual(counts);
  });

  it.each([
    ['contactId: "" (8)', { contactId: "" }],
    ["contactId mangler (9)", {}],
  ])("4.8/4.9 updateParty_clear_link: %s setter begge til null", async (_name, overrides) => {
    const { org, admin, assignment, contact } = await setup();
    const party = await createAssignmentParty(org.id, {
      assignmentId: assignment.id,
      ...FREE_TEXT,
      receivesReport: true,
      contactId: contact.id,
      firmId: contact.firmId,
    });

    const result = await updateParty(admin, org.id, party.id, partyInput(overrides));

    expect(result.changed).toBe(true);
    expect(await partyRow(party.id)).toMatchObject({
      ...FREE_TEXT,
      contactId: null,
      firmId: null,
    });
  });

  it("4.10 updateParty_same_link_no_change: changed false og ingen hendelse", async () => {
    const { org, admin, assignment, contact } = await setup();
    const party = await createAssignmentParty(org.id, {
      assignmentId: assignment.id,
      ...FREE_TEXT,
      receivesReport: true,
      contactId: contact.id,
      firmId: contact.firmId,
    });
    const before = await partyRow(party.id);
    const counts = await tableCounts();

    const result = await updateParty(
      admin,
      org.id,
      party.id,
      partyInput({ contactId: contact.id }),
    );

    expect(result).toEqual({ id: party.id, changed: false });
    expect((await partyRow(party.id)).rowVersion).toBe(before.rowVersion);
    expect(await tableCounts()).toEqual(counts);
  });

  it("4.11 free_text_not_overwritten: friteksten lagres slik den ble sendt", async () => {
    const { org, admin, assignment, contact } = await setup();

    const { id } = await addParty(
      admin,
      org.id,
      assignment.id,
      partyInput({ contactId: contact.id }),
    );
    expect(await partyRow(id)).toMatchObject({ ...FREE_TEXT, contactId: contact.id });

    const changed = { name: "Megler Annen", firmName: null, email: null, phone: "33333333" };
    await updateParty(admin, org.id, id, partyInput({ ...changed, contactId: contact.id }));
    expect(await partyRow(id)).toMatchObject({ ...changed, contactId: contact.id });
  });

  it("4.12 getAssignment_returns_link: koblet part gir id-ene, ukoblet gir null", async () => {
    const { org, admin, assignment, firm, contact } = await setup();
    const linked = await createAssignmentParty(org.id, {
      assignmentId: assignment.id,
      contactId: contact.id,
      firmId: firm.id,
    });
    const plain = await createAssignmentParty(org.id, {
      assignmentId: assignment.id,
      role: "seller",
    });

    const { parties } = await getAssignment(admin, org.id, assignment.id);

    expect(parties.find((p) => p.id === linked.id)).toMatchObject({
      contactId: contact.id,
      firmId: firm.id,
    });
    expect(parties.find((p) => p.id === plain.id)).toMatchObject({
      contactId: null,
      firmId: null,
    });
  });

  it("4.13 removed_party_not_updatable: fjernet part kan ikke kobles", async () => {
    const { org, admin, assignment, contact } = await setup();
    const party = await createAssignmentParty(org.id, {
      assignmentId: assignment.id,
      deletedAt: DELETED,
    });

    await expect(
      updateParty(admin, org.id, party.id, partyInput({ contactId: contact.id })),
    ).rejects.toThrow(AccessDeniedError);

    const row = await partyRow(party.id);
    expect(row.deletedAt).not.toBeNull();
    expect(row.contactId).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// 6. Tilgang per rolle
// ---------------------------------------------------------------------------------------------

type RoleCase = { name: string; roles: EmployeeRole[]; editAll: boolean };

const ALLOWED: RoleCase[] = [
  { name: "takstmann, innstillingen på", roles: ["inspector"], editAll: true },
  { name: "kontor", roles: ["office"], editAll: false },
  { name: "leder", roles: ["manager"], editAll: false },
  { name: "admin, innstillingen på", roles: ["admin"], editAll: true },
  // Admin stenges aldri ute (regel 11)
  { name: "admin, innstillingen av", roles: ["admin"], editAll: false },
];

describe("6. tilgang per rolle", () => {
  it.each(["addParty", "updateParty"] as const)(
    "6.1 takstmann med innstillingen av får AccessDeniedError på %s med kontakt; ingenting endres",
    async (name) => {
      const { org, assignment, contact } = await setup();
      await setInspectorsEditAll(org.id, false);
      const { actor } = await person(org.id, ["inspector"]);
      const party = await createAssignmentParty(org.id, { assignmentId: assignment.id });
      const before = await partyRow(party.id);
      const counts = await tableCounts();

      const run =
        name === "addParty"
          ? addParty(actor, org.id, assignment.id, partyInput({ contactId: contact.id }))
          : updateParty(actor, org.id, party.id, partyInput({ contactId: contact.id }));
      await expect(run).rejects.toThrow(AccessDeniedError);

      expect(await tableCounts()).toEqual(counts);
      expect(await partyRow(party.id)).toEqual(before);
    },
  );

  it.each(ALLOWED)("6.2/6.3 $name kan koble på addParty og updateParty", async (c) => {
    const { org, assignment, firm, contact } = await setup();
    await setInspectorsEditAll(org.id, c.editAll);
    const { actor } = await person(org.id, c.roles);
    const party = await createAssignmentParty(org.id, { assignmentId: assignment.id });

    const added = await addParty(
      actor,
      org.id,
      assignment.id,
      partyInput({ contactId: contact.id }),
    );
    await updateParty(actor, org.id, party.id, partyInput({ contactId: contact.id }));

    expect(await partyRow(added.id)).toMatchObject({ contactId: contact.id, firmId: firm.id });
    expect(await partyRow(party.id)).toMatchObject({ contactId: contact.id, firmId: firm.id });
  });

  it("6.4 ansatt med slettet ansattkobling får AccessDeniedError; ingenting endres", async () => {
    const { org, assignment, contact } = await setup();
    const { actor, employee } = await person(org.id, ["office"]);
    await db.update(employees).set({ deletedAt: DELETED }).where(eq(employees.id, employee.id));
    const party = await createAssignmentParty(org.id, { assignmentId: assignment.id });
    const before = await partyRow(party.id);
    const counts = await tableCounts();

    await expect(
      addParty(actor, org.id, assignment.id, partyInput({ contactId: contact.id })),
    ).rejects.toThrow(AccessDeniedError);
    await expect(
      updateParty(actor, org.id, party.id, partyInput({ contactId: contact.id })),
    ).rejects.toThrow(AccessDeniedError);

    expect(await tableCounts()).toEqual(counts);
    expect(await partyRow(party.id)).toEqual(before);
  });

  it("6.5 ansatt i en annen organisasjon får AccessDeniedError på oppdrag og part i A", async () => {
    const { org, assignment, contact } = await setup("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const adminB = await createUser({ name: "Admin B" });
    await createEmployee(adminB, orgB.id, ["admin"]);
    const party = await createAssignmentParty(org.id, { assignmentId: assignment.id });
    const before = await partyRow(party.id);
    const counts = await tableCounts();

    // Mot A sin organisasjons-id: ingen tilgang
    await expect(
      addParty(adminB, org.id, assignment.id, partyInput({ contactId: contact.id })),
    ).rejects.toThrow(AccessDeniedError);
    await expect(
      updateParty(adminB, org.id, party.id, partyInput({ contactId: contact.id })),
    ).rejects.toThrow(AccessDeniedError);
    // Mot egen organisasjon med A sine id-er: oppdraget og parten finnes ikke
    await expect(
      addParty(adminB, orgB.id, assignment.id, partyInput({ contactId: contact.id })),
    ).rejects.toThrow(AccessDeniedError);
    await expect(
      updateParty(adminB, orgB.id, party.id, partyInput({ contactId: contact.id })),
    ).rejects.toThrow(AccessDeniedError);

    expect(await tableCounts()).toEqual(counts);
    expect(await partyRow(party.id)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------
// 7. Logg og personvern
// ---------------------------------------------------------------------------------------------

describe("7. logg og personvern", () => {
  it("7.1 audit_and_events_contain_no_pii: ingen navn, e-post eller telefon; id-ene står der", async () => {
    const { org, admin, assignment, firm, contact } = await setup();
    const other = await createContact(org.id, {
      firstName: "Ola",
      lastName: "Andresen",
      email: "ola@example.com",
      phone: "44444444",
    });

    const { id } = await addParty(
      admin,
      org.id,
      assignment.id,
      partyInput({ contactId: contact.id }),
    );
    await updateParty(admin, org.id, id, partyInput({ contactId: other.id }));
    await removeParty(admin, org.id, id);
    const order = await createOrder(
      admin,
      org.id,
      {
        addressText: "Testveien 12, 8000 Bodø",
        orderedByText: `${CONTACT.firstName} ${CONTACT.lastName}, Testmegling AS`,
        orderedByContactId: contact.id,
      },
      NOW,
    );

    const text = JSON.stringify([await auditFor(org.id), await eventsFor(org.id)]);
    for (const value of [...PERSONAL_VALUES, "Ola", "Andresen", "ola@example.com", "44444444"]) {
      expect(text, `fant «${value}» i loggen`).not.toContain(value);
    }
    for (const value of [contact.id, other.id, firm.id, id, order.id]) {
      expect(text).toContain(value);
    }
  });

  it("7.2 party_events_shape_unchanged: party_added og party_updated har bare partyId og role", async () => {
    const { org, admin, assignment, contact } = await setup();

    const { id } = await addParty(
      admin,
      org.id,
      assignment.id,
      partyInput({ contactId: contact.id }),
    );
    await updateParty(admin, org.id, id, partyInput({ contactId: "" }));

    for (const type of ["assignment.party_added", "assignment.party_updated"]) {
      const rows = await eventsFor(org.id, type);
      expect(rows, type).toHaveLength(1);
      expect(rows[0]?.data).toEqual({ partyId: id, role: "broker" });
    }
  });
});
