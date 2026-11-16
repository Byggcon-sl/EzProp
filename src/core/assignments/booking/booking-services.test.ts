import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError, type Actor } from "@/core/access";
import { ContactNotFoundError } from "@/core/contacts";
import { db } from "@/db/client";
import { assignmentTeamMembers, assignments, auditLog, events, numberSequences } from "@/db/schema";
import {
  TEST_NOW,
  createAssignment as createAssignmentRow,
  createCompany,
  createContact,
  createEmployee,
  createFirm,
  createOffice,
  createOrder as createOrderRow,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../../tests/factories";
import { expectTenantIsolation } from "../../../../tests/tenant-isolation";
import {
  AssignmentChangedError,
  EmployeeNotFoundError,
  OfficeNotFoundError,
  ResponsibleNotInspectorError,
  createAssignment,
  findPossibleDuplicatesFor,
  findPossibleDuplicatesForAssignment,
  getNewAssignmentFormOptions,
  listAssignmentBookingHistory,
  updateAssignmentBooking,
} from "../index";

/*
 * Utviklerens egne tester for tjenestene i «Nytt oppdrag» (ADR 0011, kontrakten i
 * `./contract.ts`). Den fulle testplanen (docs/funksjoner/fase2a-nytt-oppdrag-testplan.md)
 * dekkes av testskriverens filer. Oppdiktede adresser og navn.
 *
 * Støtter hovedmål: de ansatte (oppdrag uten ordre), KI i bunnen (bestillingen står som egne
 * felt med kilde) og færre reklamasjoner (dublett på tvers av ordre og oppdrag).
 */

beforeEach(resetDatabase);

const NOW = TEST_NOW;
const ADDRESS = "Prøvegata 3, 8000 Bodø";

async function setup(name = "Testfirma takst") {
  const org = await createOrganization(name);
  const company = await createCompany(org.id);
  const office = await createOffice(org.id);
  const admin = await createUser({ name: "Test Admin" });
  const adminEmployee = await createEmployee(admin, org.id, ["admin"], { officeId: office.id });
  const inspectorUser = await createUser({ name: "Test Takstmann" });
  const inspector = await createEmployee(inspectorUser, org.id, ["inspector"], {
    companyId: company.id,
    officeId: office.id,
  });
  return { org, company, office, admin, adminEmployee, inspector, inspectorUser };
}

function input(office: { id: string }, inspector: { id: string }, extra = {}) {
  return {
    addressText: ADDRESS,
    gnr: "9001",
    bnr: "1",
    officeId: office.id,
    responsibleEmployeeId: inspector.id,
    ...extra,
  };
}

async function count(table: typeof assignments | typeof events | typeof auditLog) {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(table);
  return row?.n ?? 0;
}

describe("createAssignment", () => {
  it("lager oppdraget uten ordre, med team, selskap, hendelse og logg uten verdier", async () => {
    const { org, admin, office, inspector, company } = await setup();
    const result = await createAssignment(
      admin,
      org.id,
      input(office, inspector, {
        organizationId: "00000000-0000-4000-8000-000000000000",
        status: "invoiced",
        source: "email",
        orderedByText: "Megler Oppdiktet",
      }),
      { now: NOW },
    );
    expect(result).toMatchObject({ status: "ordered", rowVersion: 1, created: true });
    expect(result.number).toBe("2026-00001");

    const [row] = await db.select().from(assignments).where(eq(assignments.id, result.id));
    expect(row).toMatchObject({
      organizationId: org.id,
      orderId: null,
      propertyId: null,
      status: "ordered",
      source: "manual",
      assignmentType: "condition_report",
      officeId: office.id,
      companyId: company.id,
      addressText: ADDRESS,
      receivedAt: NOW,
      inspectionAt: null,
    });
    const team = await db
      .select()
      .from(assignmentTeamMembers)
      .where(eq(assignmentTeamMembers.assignmentId, result.id));
    expect(team).toHaveLength(1);
    expect(team[0]).toMatchObject({ employeeId: inspector.id, teamRole: "responsible" });

    const [event] = await db.select().from(events).where(eq(events.assignmentId, result.id));
    expect(event).toMatchObject({ type: "assignment.created" });
    expect(event?.data).toEqual({ number: result.number, orderId: null });

    const logs = await db.select().from(auditLog).where(eq(auditLog.entityId, result.id));
    expect(logs).toHaveLength(1);
    const text = JSON.stringify(logs[0]?.changes);
    for (const secret of ["Prøvegata", "9001", "Megler Oppdiktet"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("samme engangsnøkkel, også samtidig, gir ett oppdrag og ett nummer", async () => {
    const { org, admin, office, inspector } = await setup();
    const creationKey = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
    const data = input(office, inspector, { creationKey });
    const [a, b] = await Promise.all([
      createAssignment(admin, org.id, data, { now: NOW }),
      createAssignment(admin, org.id, data, { now: NOW }),
    ]);
    const again = await createAssignment(admin, org.id, data, { now: NOW });
    expect(new Set([a.id, b.id, again.id]).size).toBe(1);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    expect(again.created).toBe(false);
    expect(await count(assignments)).toBe(1);
    expect(await count(events)).toBe(1);
    const [sequence] = await db.select().from(numberSequences);
    expect(sequence?.nextValue).toBe(2);
  });

  it("avviser fremmed og ugyldig kontor, ansvarlig og kontakt, og lagrer ingenting", async () => {
    const own = await setup("Organisasjon A");
    const other = await setup("Organisasjon B");
    const officeOnly = await createUser({ name: "Test Kontor" });
    const officeEmployee = await createEmployee(officeOnly, own.org.id, ["office"]);
    const foreignContact = await createContact(other.org.id);
    const cases: [object, new () => Error][] = [
      [{ officeId: other.office.id }, OfficeNotFoundError],
      [{ responsibleEmployeeId: other.inspector.id }, EmployeeNotFoundError],
      [{ responsibleEmployeeId: officeEmployee.id }, ResponsibleNotInspectorError],
      [{ orderedByContactId: foreignContact.id }, ContactNotFoundError],
    ];
    for (const [extra, error] of cases) {
      await expect(
        createAssignment(own.admin, own.org.id, input(own.office, own.inspector, extra)),
      ).rejects.toBeInstanceOf(error);
    }
    expect(await count(assignments)).toBe(0);
    expect(await count(events)).toBe(0);
  });

  it("firmaet settes fra kontakten", async () => {
    const { org, admin, office, inspector } = await setup();
    const firm = await createFirm(org.id);
    const contact = await createContact(org.id, { firmId: firm.id });
    const { id } = await createAssignment(
      admin,
      org.id,
      input(office, inspector, { orderedByContactId: contact.id, orderedByFirmId: null }),
    );
    const [row] = await db.select().from(assignments).where(eq(assignments.id, id));
    expect(row?.orderedByFirmId).toBe(firm.id);
  });

  it("holder organisasjonene adskilt", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const result = { a: [] as string[], b: [] as string[] };
        for (const [key, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const office = await createOffice(grant.organizationId);
          const user = await createUser();
          const inspector = await createEmployee(user, grant.organizationId, ["inspector"]);
          const created = await createAssignment(user, grant.organizationId, {
            addressText: ADDRESS,
            officeId: office.id,
            responsibleEmployeeId: inspector.id,
          });
          result[key].push(created.id);
        }
        return result;
      },
      query: async (actor, organizationId) => {
        // Fremmed organisasjon: tilgangssjekken stopper med AccessDeniedError. Egen: et ukjent
        // kontor gir OfficeNotFoundError, og ingenting lagres.
        const error = await createAssignment(actor, organizationId, {
          addressText: ADDRESS,
          officeId: "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c",
          responsibleEmployeeId: "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d",
        }).catch((caught: unknown) => caught);
        if (!(error instanceof OfficeNotFoundError)) throw error;
        return db
          .select({ id: assignments.id })
          .from(assignments)
          .where(eq(assignments.organizationId, organizationId));
      },
      idOf: (row) => row.id,
    });
  });
});

describe("updateAssignmentBooking og historikken", () => {
  it("endrer, logger fra og til, og gir konflikt ved gammel versjon", async () => {
    const { org, admin, office, inspector } = await setup();
    const { id } = await createAssignment(admin, org.id, input(office, inspector), { now: NOW });

    const same = await updateAssignmentBooking(
      admin,
      org.id,
      id,
      { addressText: ADDRESS, gnr: "9001", bnr: "1" },
      1,
      NOW,
    );
    expect(same.fields).toEqual([]);
    expect(same.rowVersion).toBe(1);

    const changed = await updateAssignmentBooking(
      admin,
      org.id,
      id,
      { addressText: "Testveien 12, 8000 Bodø", gnr: "9001", bnr: "1" },
      1,
      NOW,
    );
    expect(changed.fields).toEqual(["addressText"]);
    expect(changed.rowVersion).toBe(2);
    expect(changed.booking.addressText).toBe("Testveien 12, 8000 Bodø");

    await expect(
      updateAssignmentBooking(admin, org.id, id, { addressText: "Annen vei 1" }, 1, NOW),
    ).rejects.toBeInstanceOf(AssignmentChangedError);

    const history = await listAssignmentBookingHistory(admin, org.id, id);
    expect(history.map((entry) => entry.action)).toEqual(["update", "create"]);
    expect(history[0]?.values).toEqual([
      { field: "addressText", from: ADDRESS, to: "Testveien 12, 8000 Bodø" },
    ]);
    const [event] = await db
      .select()
      .from(events)
      .where(and(eq(events.assignmentId, id), eq(events.type, "assignment.booking_updated")));
    expect(event?.data).toEqual({ assignmentId: id, fields: ["addressText"] });
  });

  it("fremmed og ugyldig id gir AccessDeniedError", async () => {
    const own = await setup("Organisasjon A");
    const other = await setup("Organisasjon B");
    const { id } = await createAssignment(
      other.admin,
      other.org.id,
      input(other.office, other.inspector),
    );
    for (const bad of [id, "ikke-en-id"]) {
      await expect(
        updateAssignmentBooking(own.admin, own.org.id, bad, { addressText: ADDRESS }, 1),
      ).rejects.toBeInstanceOf(AccessDeniedError);
      await expect(listAssignmentBookingHistory(own.admin, own.org.id, bad)).rejects.toBeInstanceOf(
        AccessDeniedError,
      );
      await expect(
        findPossibleDuplicatesForAssignment(own.admin, own.org.id, bad),
      ).rejects.toBeInstanceOf(AccessDeniedError);
    }
  });

  it("historikken holder organisasjonene adskilt", async () => {
    const ids = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const result = { a: [] as string[], b: [] as string[] };
        for (const [key, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const office = await createOffice(grant.organizationId);
          const user = await createUser();
          const inspector = await createEmployee(user, grant.organizationId, ["inspector"]);
          const created = await createAssignment(user, grant.organizationId, {
            addressText: ADDRESS,
            officeId: office.id,
            responsibleEmployeeId: inspector.id,
          });
          ids.set(grant.organizationId, created.id);
          const [log] = await db
            .select({ id: auditLog.id })
            .from(auditLog)
            .where(eq(auditLog.entityId, created.id));
          if (log) result[key].push(log.id);
        }
        return result;
      },
      query: (actor, organizationId) =>
        listAssignmentBookingHistory(
          actor,
          organizationId,
          ids.get(organizationId) ?? [...ids.values()][0] ?? "",
        ),
      idOf: (row) => row.id,
    });
  });
});

describe("dublett på tvers av ordre og oppdrag", () => {
  it("oppdrag fra ordre gir ett treff, og oppdraget varsler ikke om seg selv eller ordren sin", async () => {
    const { org, admin, office, inspector } = await setup();
    // Gjort om: oppdraget har kopien av bestillingen og peker på ordren (som i
    // `convertOrderToAssignment`, som er prøvd i `@/core/orders`).
    const assignment = await createAssignmentRow(org.id, {
      addressText: ADDRESS,
      officeId: office.id,
    });
    const order = await createOrderRow(org.id, {
      addressText: ADDRESS,
      status: "converted",
      assignmentId: assignment.id,
    });
    await db
      .update(assignments)
      .set({ orderId: order.id })
      .where(eq(assignments.id, assignment.id));
    const direct = await createAssignment(admin, org.id, input(office, inspector), { now: NOW });
    const open = await createOrderRow(org.id, { addressText: ADDRESS });

    const draft = await findPossibleDuplicatesFor(admin, org.id, {
      addressText: ADDRESS,
      gnr: null,
      bnr: null,
      snr: null,
      receivedAt: NOW,
    });
    expect(draft.items.map((item) => [item.kind, item.id]).sort()).toEqual(
      [
        ["assignment", assignment.id],
        ["assignment", direct.id],
        ["order", open.id],
      ].sort(),
    );
    for (const item of draft.items) {
      expect(Object.keys(item).sort()).toEqual(
        ["addressText", "id", "kind", "number", "reasons", "receivedAt", "status"].sort(),
      );
    }

    const fromAssignment = await findPossibleDuplicatesForAssignment(admin, org.id, assignment.id);
    expect(fromAssignment.items.map((item) => item.id).sort()).toEqual([direct.id, open.id].sort());
  });

  it("holder organisasjonene adskilt", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const result = { a: [] as string[], b: [] as string[] };
        for (const [key, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const office = await createOffice(grant.organizationId);
          const user = await createUser();
          const inspector = await createEmployee(user, grant.organizationId, ["inspector"]);
          const created = await createAssignment(user, grant.organizationId, {
            addressText: ADDRESS,
            officeId: office.id,
            responsibleEmployeeId: inspector.id,
          });
          result[key].push(created.id);
        }
        return result;
      },
      query: async (actor: Actor, organizationId) =>
        (
          await findPossibleDuplicatesFor(actor, organizationId, {
            addressText: ADDRESS,
            gnr: null,
            bnr: null,
            snr: null,
            receivedAt: new Date(),
          })
        ).items,
      idOf: (row) => row.id,
    });
  });
});

describe("getNewAssignmentFormOptions", () => {
  it("gir kontor og takstmenn i egen organisasjon og forhåndsvalg", async () => {
    const own = await setup("Organisasjon A");
    await setup("Organisasjon B");
    const options = await getNewAssignmentFormOptions(own.inspectorUser, own.org.id);
    expect(options.offices).toEqual([{ id: own.office.id, name: own.office.name }]);
    expect(options.inspectors).toEqual([{ id: own.inspector.id, name: "Test Takstmann" }]);
    expect(options.defaultOfficeId).toBe(own.office.id);
    expect(options.defaultResponsibleEmployeeId).toBe(own.inspector.id);

    const forAdmin = await getNewAssignmentFormOptions(own.admin, own.org.id);
    expect(forAdmin.defaultResponsibleEmployeeId).toBeNull();
  });

  it("holder organisasjonene adskilt", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const result = { a: [] as string[], b: [] as string[] };
        for (const [key, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const office = await createOffice(grant.organizationId);
          const user = await createUser();
          const inspector = await createEmployee(user, grant.organizationId, ["inspector"]);
          result[key].push(office.id, inspector.id);
        }
        return result;
      },
      query: async (actor, organizationId) => {
        const options = await getNewAssignmentFormOptions(actor, organizationId);
        return [...options.offices, ...options.inspectors];
      },
      idOf: (row) => row.id,
    });
  });
});
