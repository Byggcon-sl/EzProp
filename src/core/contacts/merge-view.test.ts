import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { employees, organizations, type EmployeeRole } from "@/db/schema";
import {
  createAssignment,
  createAssignmentParty,
  createContact,
  createEmployee,
  createFirm,
  createOrder,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { getContactUsage, getFirmUsage, getRemovedContactName, getRemovedFirmName } from "./index";

/*
 * Lesingen bak skjermene «Fjern» og «Slå sammen» (src/core/contacts/merge-view.ts): antall
 * oppdrag, ordrer og kontakter per kontakt eller firma, og navnet på det som nettopp er fjernet.
 * Oppgavekort: docs/funksjoner/fase2a-fjerne-sla-sammen-kontakter.md (Omfang 3).
 * Testplan: docs/funksjoner/fase2a-fjerne-sla-sammen-kontakter-testplan.md. Funksjonene kom til
 * under byggingen og står ikke i testplanen; CLAUDE.md regel 2 krever likevel
 * `expectTenantIsolation` for hver ny spørring som tar `organizationId`. Rollene følger 2.2.
 *
 * Testdata er oppdiktet: «Megler Test», «Testmegling AS».
 *
 * Støtter hovedmål: reklamasjoner (tallene leder ser før sammenslåing er riktige, og ingen ser
 * tall eller navn fra en annen organisasjon) og tid (riktig valg første gang).
 */

beforeEach(async () => {
  await resetDatabase();
});

const DELETED = new Date("2026-11-01T08:00:00Z");

const FUNCTIONS = [
  "getContactUsage",
  "getFirmUsage",
  "getRemovedContactName",
  "getRemovedFirmName",
] as const;
type FunctionName = (typeof FUNCTIONS)[number];

async function person(organizationId: string, roles: EmployeeRole[]) {
  const actor = await createUser({ name: "Test Ansatt" });
  const employee = await createEmployee(actor, organizationId, roles);
  return { actor, employee };
}

async function setInspectorsEditAll(organizationId: string, value: boolean) {
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": value } })
    .where(eq(organizations.id, organizationId));
}

/**
 * Ett aktivt og ett fjernet firma og én aktiv og én fjernet kontakt, med én part, én ordre og ett
 * oppdrag med kontakten som bestiller (ADR 0011).
 */
async function seedOrganization(organizationId: string) {
  const firm = await createFirm(organizationId);
  const removedFirm = await createFirm(organizationId, { deletedAt: DELETED });
  const contact = await createContact(organizationId, { firmId: firm.id });
  const removedContact = await createContact(organizationId, { deletedAt: DELETED });
  await createAssignmentParty(organizationId, { contactId: contact.id, firmId: firm.id });
  await createOrder(organizationId, {
    orderedByContactId: contact.id,
    orderedByFirmId: firm.id,
  });
  await createAssignment(organizationId, {
    orderedByContactId: contact.id,
    orderedByFirmId: firm.id,
  });
  return { firm, removedFirm, contact, removedContact };
}

/** Kjører funksjonen med id-er fra organisasjonen og gir et svar som kan sammenlignes. */
async function run(name: FunctionName, actor: Actor, organizationId: string) {
  const seeded = await seedOrganization(organizationId);
  switch (name) {
    case "getContactUsage":
      return getContactUsage(actor, organizationId, [seeded.contact.id]);
    case "getFirmUsage":
      return getFirmUsage(actor, organizationId, [seeded.firm.id]);
    case "getRemovedContactName":
      return getRemovedContactName(actor, organizationId, seeded.removedContact.id);
    case "getRemovedFirmName":
      return getRemovedFirmName(actor, organizationId, seeded.removedFirm.id);
  }
}

async function expectDenied(promise: Promise<unknown>) {
  await expect(promise).rejects.toBeInstanceOf(AccessDeniedError);
}

// ---------------------------------------------------------------------------------------------
// Tenant-isolasjon (regel 2): én per funksjon
// ---------------------------------------------------------------------------------------------

describe("tenant-isolasjon", () => {
  it("getContactUsage_tenant_isolation: tall bare for kontakter i egen organisasjon", async () => {
    const all: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await seedOrganization(grantA.organizationId);
        const b = await seedOrganization(grantB.organizationId);
        all.push(a.contact.id, b.contact.id);
        return { a: [a.contact.id], b: [b.contact.id] };
      },
      // Begge organisasjonenes id-er sendes inn; bare egne skal få tall over 0
      query: async (actor, organizationId) => {
        const usage = await getContactUsage(actor, organizationId, all);
        return Object.entries(usage)
          .filter(([, u]) => u.assignmentCount > 0 || u.orderCount > 0)
          .map(([id]) => ({ id }));
      },
      idOf: (row) => row.id,
    });
  });

  it("getFirmUsage_tenant_isolation: tall bare for firma i egen organisasjon", async () => {
    const all: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await seedOrganization(grantA.organizationId);
        const b = await seedOrganization(grantB.organizationId);
        all.push(a.firm.id, b.firm.id);
        return { a: [a.firm.id], b: [b.firm.id] };
      },
      query: async (actor, organizationId) => {
        const usage = await getFirmUsage(actor, organizationId, all);
        return Object.entries(usage)
          .filter(([, u]) => u.contactCount > 0 || u.assignmentCount > 0 || u.orderCount > 0)
          .map(([id]) => ({ id }));
      },
      idOf: (row) => row.id,
    });
  });

  it("getRemovedContactName_tenant_isolation: navn bare for fjernet kontakt i egen organisasjon", async () => {
    const all: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await seedOrganization(grantA.organizationId);
        const b = await seedOrganization(grantB.organizationId);
        all.push(a.removedContact.id, b.removedContact.id);
        return { a: [a.removedContact.id], b: [b.removedContact.id] };
      },
      query: async (actor, organizationId) => {
        const rows: { id: string }[] = [];
        for (const id of all) {
          if (await getRemovedContactName(actor, organizationId, id)) rows.push({ id });
        }
        return rows;
      },
      idOf: (row) => row.id,
    });
  });

  it("getRemovedFirmName_tenant_isolation: navn bare for fjernet firma i egen organisasjon", async () => {
    const all: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await seedOrganization(grantA.organizationId);
        const b = await seedOrganization(grantB.organizationId);
        all.push(a.removedFirm.id, b.removedFirm.id);
        return { a: [a.removedFirm.id], b: [b.removedFirm.id] };
      },
      query: async (actor, organizationId) => {
        const rows: { id: string }[] = [];
        for (const id of all) {
          if (await getRemovedFirmName(actor, organizationId, id)) rows.push({ id });
        }
        return rows;
      },
      idOf: (row) => row.id,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Tilgang per rolle (som 2.2): bare contacts.manage
// ---------------------------------------------------------------------------------------------

describe("tilgang per rolle", () => {
  const deniedCases = FUNCTIONS.flatMap((fn) => [
    { label: "takstmann (innstillingen på)", role: "inspector" as const, editAll: true, fn },
    { label: "takstmann (innstillingen av)", role: "inspector" as const, editAll: false, fn },
    { label: "kontor", role: "office" as const, editAll: true, fn },
  ]);

  it.each(deniedCases)("$label får avslag: $fn", async ({ role, editAll, fn }) => {
    const org = await createOrganization();
    await setInspectorsEditAll(org.id, editAll);
    const { actor } = await person(org.id, [role]);
    await expectDenied(run(fn, actor, org.id));
  });

  const allowedCases = FUNCTIONS.flatMap((fn) => [
    { label: "leder", roles: ["manager"] as EmployeeRole[], fn },
    { label: "admin", roles: ["admin"] as EmployeeRole[], fn },
  ]);

  it.each(allowedCases)("$label får svar: $fn", async ({ roles, fn }) => {
    const org = await createOrganization();
    const { actor } = await person(org.id, roles);
    await expect(run(fn, actor, org.id)).resolves.toBeTruthy();
  });

  it.each(FUNCTIONS)("leder med slettet ansattkobling får avslag: %s", async (fn) => {
    const org = await createOrganization();
    const { actor, employee } = await person(org.id, ["manager"]);
    await db.update(employees).set({ deletedAt: DELETED }).where(eq(employees.id, employee.id));
    await expectDenied(run(fn, actor, org.id));
  });

  it.each(FUNCTIONS)("deaktivert leder får avslag: %s", async (fn) => {
    const org = await createOrganization();
    const { actor, employee } = await person(org.id, ["manager"]);
    await db.update(employees).set({ deactivatedAt: DELETED }).where(eq(employees.id, employee.id));
    await expectDenied(run(fn, actor, org.id));
  });

  // Regel 11: admin stenges aldri ute. Testen skal aldri fjernes.
  it.each(FUNCTIONS.flatMap((fn) => [true, false].map((editAll) => ({ fn, editAll }))))(
    "admin uten lederrolle stenges aldri ute, innstillingen $editAll: $fn",
    async ({ fn, editAll }) => {
      const org = await createOrganization();
      await setInspectorsEditAll(org.id, editAll);
      const { actor } = await person(org.id, ["admin"]);
      await expect(run(fn, actor, org.id)).resolves.toBeTruthy();
    },
  );
});

// ---------------------------------------------------------------------------------------------
// Tallene som vises side om side
// ---------------------------------------------------------------------------------------------

describe("getContactUsage", () => {
  it("teller hvert oppdrag én gang, og hopper over myk-slettede parter og ordrer", async () => {
    const org = await createOrganization();
    const { actor } = await person(org.id, ["manager"]);
    const contact = await createContact(org.id);
    const assignment = await createAssignment(org.id);
    // To aktive parter på samme oppdrag teller som ett oppdrag
    await createAssignmentParty(org.id, { assignmentId: assignment.id, contactId: contact.id });
    await createAssignmentParty(org.id, {
      assignmentId: assignment.id,
      contactId: contact.id,
      role: "seller",
    });
    await createAssignmentParty(org.id, { contactId: contact.id });
    await createAssignmentParty(org.id, { contactId: contact.id, deletedAt: DELETED });
    await createOrder(org.id, { orderedByContactId: contact.id });
    await createOrder(org.id, { orderedByContactId: contact.id, deletedAt: DELETED });

    const usage = await getContactUsage(actor, org.id, [contact.id]);

    expect(usage).toEqual({ [contact.id]: { assignmentCount: 2, orderCount: 1 } });
  });

  it("id uten rader gir 0; ugyldige id-er og dubletter tas ikke med", async () => {
    const org = await createOrganization();
    const { actor } = await person(org.id, ["manager"]);
    const contact = await createContact(org.id);
    const unknown = randomUUID();

    const usage = await getContactUsage(actor, org.id, [contact.id, contact.id, unknown, "abc"]);

    expect(usage).toEqual({
      [contact.id]: { assignmentCount: 0, orderCount: 0 },
      [unknown]: { assignmentCount: 0, orderCount: 0 },
    });
  });

  it("tall for en annen kontakt i samme organisasjon blandes ikke inn", async () => {
    const org = await createOrganization();
    const { actor } = await person(org.id, ["manager"]);
    const contact = await createContact(org.id);
    const other = await createContact(org.id, { firstName: "Annen", lastName: "Meglersen" });
    await createAssignmentParty(org.id, { contactId: other.id });
    await createOrder(org.id, { orderedByContactId: other.id });

    const usage = await getContactUsage(actor, org.id, [contact.id, other.id]);

    expect(usage[contact.id]).toEqual({ assignmentCount: 0, orderCount: 0 });
    expect(usage[other.id]).toEqual({ assignmentCount: 1, orderCount: 1 });
  });
});

describe("4.11.3 oppdrag med bestilleren telles (ADR 0011)", () => {
  it("kontakt: bestiller på oppdrag teller; part og bestiller på samme oppdrag teller én gang; kansellert teller ikke", async () => {
    const org = await createOrganization();
    const { actor } = await person(org.id, ["manager"]);
    const contact = await createContact(org.id);
    const both = await createAssignment(org.id, { orderedByContactId: contact.id });
    await createAssignmentParty(org.id, { assignmentId: both.id, contactId: contact.id });
    await createAssignment(org.id, { orderedByContactId: contact.id });
    await createAssignment(org.id, { orderedByContactId: contact.id, deletedAt: DELETED });
    await createAssignmentParty(org.id, { contactId: contact.id });

    const usage = await getContactUsage(actor, org.id, [contact.id]);

    expect(usage).toEqual({ [contact.id]: { assignmentCount: 3, orderCount: 0 } });
  });

  it("firma: bestillerfirma på oppdrag teller, også uten part", async () => {
    const org = await createOrganization();
    const { actor } = await person(org.id, ["manager"]);
    const firm = await createFirm(org.id);
    const both = await createAssignment(org.id, { orderedByFirmId: firm.id });
    await createAssignmentParty(org.id, { assignmentId: both.id, firmId: firm.id });
    await createAssignment(org.id, { orderId: null, orderedByFirmId: firm.id });

    const usage = await getFirmUsage(actor, org.id, [firm.id]);

    expect(usage).toEqual({ [firm.id]: { contactCount: 0, assignmentCount: 2, orderCount: 0 } });
  });

  it("bestiller på oppdrag i en annen organisasjon teller ikke", async () => {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const { actor } = await person(orgA.id, ["manager"]);
    const contact = await createContact(orgA.id);
    const contactB = await createContact(orgB.id);
    await createAssignment(orgB.id, { orderedByContactId: contactB.id });

    const usage = await getContactUsage(actor, orgA.id, [contact.id, contactB.id]);

    expect(usage[contact.id]).toEqual({ assignmentCount: 0, orderCount: 0 });
    expect(usage[contactB.id]).toEqual({ assignmentCount: 0, orderCount: 0 });
  });
});

describe("getFirmUsage", () => {
  it("teller aktive kontakter, oppdrag én gang og aktive ordrer", async () => {
    const org = await createOrganization();
    const { actor } = await person(org.id, ["manager"]);
    const firm = await createFirm(org.id);
    await createContact(org.id, { firmId: firm.id });
    await createContact(org.id, { firmId: firm.id, firstName: "Annen" });
    await createContact(org.id, { firmId: firm.id, deletedAt: DELETED });
    const assignment = await createAssignment(org.id);
    await createAssignmentParty(org.id, { assignmentId: assignment.id, firmId: firm.id });
    await createAssignmentParty(org.id, {
      assignmentId: assignment.id,
      firmId: firm.id,
      role: "seller",
    });
    await createAssignmentParty(org.id, { firmId: firm.id, deletedAt: DELETED });
    await createOrder(org.id, { orderedByFirmId: firm.id });
    await createOrder(org.id, { orderedByFirmId: firm.id });
    await createOrder(org.id, { orderedByFirmId: firm.id, deletedAt: DELETED });

    const usage = await getFirmUsage(actor, org.id, [firm.id, "abc"]);

    expect(usage).toEqual({
      [firm.id]: { contactCount: 2, assignmentCount: 1, orderCount: 2 },
    });
  });
});

describe("getRemovedContactName og getRemovedFirmName", () => {
  it("gir navnet bare for en fjernet rad; aktiv, ukjent og ugyldig id gir null", async () => {
    const org = await createOrganization();
    const { actor } = await person(org.id, ["manager"]);
    const active = await createContact(org.id);
    const removed = await createContact(org.id, { deletedAt: DELETED });
    const activeFirm = await createFirm(org.id);
    const removedFirm = await createFirm(org.id, { deletedAt: DELETED });

    expect(await getRemovedContactName(actor, org.id, removed.id)).toEqual({
      firstName: "Megler",
      lastName: "Test",
    });
    expect(await getRemovedContactName(actor, org.id, active.id)).toBeNull();
    expect(await getRemovedContactName(actor, org.id, randomUUID())).toBeNull();
    expect(await getRemovedContactName(actor, org.id, "abc")).toBeNull();

    expect(await getRemovedFirmName(actor, org.id, removedFirm.id)).toBe("Testmegling AS");
    expect(await getRemovedFirmName(actor, org.id, activeFirm.id)).toBeNull();
    expect(await getRemovedFirmName(actor, org.id, randomUUID())).toBeNull();
    expect(await getRemovedFirmName(actor, org.id, "")).toBeNull();
  });

  it("id fra en annen organisasjon gir null, også for admin", async () => {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const { actor } = await person(orgA.id, ["admin"]);
    const foreignContact = await createContact(orgB.id, { deletedAt: DELETED });
    const foreignFirm = await createFirm(orgB.id, { deletedAt: DELETED });

    expect(await getRemovedContactName(actor, orgA.id, foreignContact.id)).toBeNull();
    expect(await getRemovedFirmName(actor, orgA.id, foreignFirm.id)).toBeNull();
  });
});
