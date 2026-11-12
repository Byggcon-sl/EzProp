import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { AccessDeniedError, type Actor } from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { ContactNotFoundError } from "@/core/contacts";
import { db } from "@/db/client";
import {
  assignmentParties,
  assignments,
  auditLog,
  employees,
  events,
  orders,
  organizations,
  properties,
  type EmployeeRole,
} from "@/db/schema";
import {
  createAssignment,
  createAssignmentParty,
  createContact,
  createEmployee,
  createFirm,
  createOffice,
  createOrder as insertOrder,
  createOrganization,
  createProperty,
  createUser,
  grantPermission,
  resetDatabase,
  TEST_NOW,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { ORDER_EDITABLE_FIELDS } from "./codes";
import { OrderChangedError } from "./errors";
import {
  convertOrderToAssignment,
  createOrder,
  getOrder,
  listOrderHistory,
  orderInputSchema,
  rejectOrder,
  updateOrder,
} from "./index";

/*
 * Rette en ordre etter at den er lagret (T1, A249–A253).
 * Testplan: docs/funksjoner/fase2a-rette-ordre-testplan.md avsnitt 2 (2.6.8 og 2.6.9 står i
 * orders-transaction.test.ts). Nummereringen i testnavnene følger testplanen.
 *
 * Fast tid: TEST_NOW (03.11.2026 kl. 11 i Oslo). Testdata er oppdiktet: «Testveien 12, 8000 Bodø»
 * rettes til «Prøvegata 7, 8006 Bodø», gnr/bnr 12/34 til 56/78, TEST-ORD-0001 til TEST-ORD-0002.
 *
 * Støtter hovedmål:
 * - de ansatte: alle roller som skal kunne rette, kan det, også admin med innstillingen av;
 * - færre reklamasjoner: ingen stille overskriving (versjonssjekk), oppdraget røres ikke, og
 *   loggen viser hvem, når og hvilke felt, uten personopplysninger;
 * - KI i bunnen: `changedFields` har fast form og fast rekkefølge.
 */

beforeEach(resetDatabase);

const ADDRESS = "Testveien 12, 8000 Bodø";
const NEW_ADDRESS = "Prøvegata 7, 8006 Bodø";
const ORDERED_BY = "Megler Testesen";
const HOUSING = "Testtoppen borettslag";
const EXTERNAL_REF = "TEST-ORD-0001";
const NEW_EXTERNAL_REF = "TEST-ORD-0002";
const CONTACT_FIRST_NAME = "Kari";
const CONTACT_LAST_NAME = "Prøvesen";
const OTHER_CONTACT_FIRST_NAME = "Ola";
const OTHER_CONTACT_LAST_NAME = "Fiktivsen";

type Input = Parameters<typeof updateOrder>[3];

function input(overrides: Record<string, unknown> = {}): Input {
  return { addressText: NEW_ADDRESS, ...overrides } as Input;
}

async function setInspectorsEditAll(organizationId: string, value: boolean) {
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": value } })
    .where(eq(organizations.id, organizationId));
}

/** Organisasjon med admin og ett kontor. Innstillingen er på, som i dag. */
async function orgWithAdmin(name = "Testfirma takst") {
  const org = await createOrganization(name);
  await setInspectorsEditAll(org.id, true);
  const admin = await createUser({ name: "Test Admin" });
  const adminEmployee = await createEmployee(admin, org.id, ["admin"]);
  const office = await createOffice(org.id, { name: `Testkontor ${name}` });
  return { org, admin, adminEmployee, office };
}

async function person(organizationId: string, roles: EmployeeRole[], name?: string) {
  const actor = await createUser(name ? { name } : {});
  const employee = await createEmployee(actor, organizationId, roles);
  return { actor, employee };
}

async function orderRow(id: string) {
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  if (!row) throw new Error("fant ikke ordren");
  return row;
}

async function auditFor(orderId: string) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, "order"), eq(auditLog.entityId, orderId)));
}

async function updateRowsFor(orderId: string) {
  return (await auditFor(orderId)).filter((row) => row.action === "update");
}

async function updatedEventsFor(orderId: string) {
  const rows = await db.select().from(events).where(eq(events.type, "order.updated"));
  return rows.filter((row) => row.data.orderId === orderId);
}

/** Versjonen slik skjemaet får den: fra `getOrder`. */
async function versionOf(actor: Actor, organizationId: string, orderId: string) {
  return (await getOrder(actor, organizationId, orderId)).rowVersion;
}

/** Verdiene, versjonen, loggen og hendelsene som skal være urørt når noe avvises. */
async function snapshot(orderId: string) {
  return {
    order: await orderRow(orderId),
    audit: await auditFor(orderId),
    events: (await db.select().from(events)).filter((row) => row.data.orderId === orderId),
  };
}

async function expectUntouched(orderId: string, before: Awaited<ReturnType<typeof snapshot>>) {
  expect(await snapshot(orderId)).toEqual(before);
}

async function captureError(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => null,
    (error: unknown) => error,
  );
}

/** En ordre som er gjort om til et ekte oppdrag (fabrikkene, ikke nummerserien). */
async function insertConvertedOrder(
  organizationId: string,
  overrides: Record<string, unknown> = {},
) {
  const order = await insertOrder(organizationId, overrides);
  const assignment = await createAssignment(organizationId, { orderId: order.id });
  const [converted] = await db
    .update(orders)
    .set({ status: "converted", assignmentId: assignment.id })
    .where(eq(orders.id, order.id))
    .returning();
  if (!converted) throw new Error("kunne ikke gjøre om ordren");
  return { order: converted, assignment };
}

// ---------------------------------------------------------------------------------------------
// 2.1 Tilgang per rolle
// ---------------------------------------------------------------------------------------------

describe("2.1 tilgang per rolle", () => {
  it.each([
    ["2.1.1 kontor", ["office"] as EmployeeRole[]],
    ["2.1.2 leder", ["manager"] as EmployeeRole[]],
  ])("%s kan rette og se endringene", async (_name, roles) => {
    const { org } = await orgWithAdmin();
    const { actor } = await person(org.id, roles);
    const order = await insertOrder(org.id);

    const result = await updateOrder(actor, org.id, order.id, input(), 1, TEST_NOW);
    expect(result.addressText).toBe(NEW_ADDRESS);
    expect(result.changedFields).toEqual(["addressText"]);

    const history = await listOrderHistory(actor, org.id, order.id);
    expect(history.map((row) => row.action)).toEqual(["update"]);
  });

  it("2.1.3 takstmann med access.inspectors_edit_all på kan rette", async () => {
    const { org } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, true);
    const { actor } = await person(org.id, ["inspector"]);
    const order = await insertOrder(org.id);

    const result = await updateOrder(actor, org.id, order.id, input(), 1, TEST_NOW);
    expect(result.addressText).toBe(NEW_ADDRESS);
    expect((await orderRow(order.id)).addressText).toBe(NEW_ADDRESS);
  });

  it("2.1.4 takstmann med innstillingen av får AccessDeniedError ved retting, men kan se endringene; ordren er urørt, ingen loggrad, ingen hendelse", async () => {
    const { org, admin } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);
    const { actor } = await person(org.id, ["inspector"]);
    const order = await insertOrder(org.id);
    await updateOrder(admin, org.id, order.id, input({ gnr: "12" }), 1, TEST_NOW);
    const before = await snapshot(order.id);

    await expect(
      updateOrder(actor, org.id, order.id, input({ addressText: ADDRESS }), 2, TEST_NOW),
    ).rejects.toBeInstanceOf(AccessDeniedError);

    await expectUntouched(order.id, before);
    const history = await listOrderHistory(actor, org.id, order.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ action: "update", changedFields: ["addressText", "gnr"] });
  });

  it("2.1.5 takstmann med innstillingen av og enkeltrettigheten assignment.edit kan rette", async () => {
    const { org } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);
    const { actor, employee } = await person(org.id, ["inspector"]);
    await grantPermission(employee, "assignment.edit");
    const order = await insertOrder(org.id);

    const result = await updateOrder(actor, org.id, order.id, input(), 1, TEST_NOW);
    expect(result.addressText).toBe(NEW_ADDRESS);
  });

  it("2.1.6 admin uten andre roller og med innstillingen av kan rette og se (regel 11)", async () => {
    const { org, admin } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);
    const order = await insertOrder(org.id);

    const result = await updateOrder(admin, org.id, order.id, input(), 1, TEST_NOW);
    expect(result.addressText).toBe(NEW_ADDRESS);
    expect((await orderRow(order.id)).addressText).toBe(NEW_ADDRESS);

    const history = await listOrderHistory(admin, org.id, order.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      action: "update",
      changedFields: ["addressText"],
      actorName: "Test Admin",
    });
  });

  it("2.1.7 bruker uten ansattrad og ansatt uten roller får AccessDeniedError for både updateOrder og listOrderHistory", async () => {
    const { org } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    const outsider = await createUser({ name: "Uten Ansattrad" });
    const { actor: noRoles } = await person(org.id, []);
    const before = await snapshot(order.id);

    for (const actor of [outsider, noRoles]) {
      await expect(
        updateOrder(actor, org.id, order.id, input(), 1, TEST_NOW),
      ).rejects.toBeInstanceOf(AccessDeniedError);
      await expect(listOrderHistory(actor, org.id, order.id)).rejects.toBeInstanceOf(
        AccessDeniedError,
      );
    }
    await expectUntouched(order.id, before);
  });

  it("2.1.7 tilgangssjekken kommer før id- og skjemasjekken: ugyldig input gir AccessDeniedError", async () => {
    const { org } = await orgWithAdmin();
    const outsider = await createUser();
    await expect(
      updateOrder(outsider, org.id, "ikke-en-id", input({ addressText: "", gnr: "x" }), 1.5),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(listOrderHistory(outsider, org.id, "ikke-en-id")).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
  });

  it.each([
    ["deaktivert", { deactivatedAt: TEST_NOW }],
    ["myk-slettet", { deletedAt: TEST_NOW }],
  ])("2.1.8 %s ansatt får AccessDeniedError", async (_name, change) => {
    const { org } = await orgWithAdmin();
    const { actor, employee } = await person(org.id, ["office"]);
    await db.update(employees).set(change).where(eq(employees.id, employee.id));
    const order = await insertOrder(org.id);
    const before = await snapshot(order.id);

    await expect(updateOrder(actor, org.id, order.id, input(), 1, TEST_NOW)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    await expect(listOrderHistory(actor, org.id, order.id)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    await expectUntouched(order.id, before);
  });
});

// ---------------------------------------------------------------------------------------------
// 2.2 Tenant-isolasjon
// ---------------------------------------------------------------------------------------------

/**
 * Kjører `run` for hver id. Avslag for en enkelt id (fremmed ordre) hoppes over; nektes alle,
 * kastes avslaget videre (fremmed organisasjon).
 */
async function forEachAllowed<T>(ids: string[], run: (id: string) => Promise<T>) {
  const results: T[] = [];
  let lastDenied: unknown = null;
  for (const id of ids) {
    try {
      results.push(await run(id));
    } catch (error) {
      if (!(error instanceof AccessDeniedError)) throw error;
      lastDenied = error;
    }
  }
  if (results.length === 0 && lastDenied) throw lastDenied;
  return results;
}

describe("2.2 tenant-isolasjon", () => {
  it("2.2.1 expectTenantIsolation for updateOrder", async () => {
    let allIds: string[] = [];
    let counter = 0;
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a1 = await insertOrder(grantA.organizationId);
        const a2 = await insertOrder(grantA.organizationId);
        const b1 = await insertOrder(grantB.organizationId);
        allIds = [a1.id, a2.id, b1.id];
        return { a: [a1.id, a2.id], b: [b1.id] };
      },
      query: (actor, organizationId) =>
        forEachAllowed(allIds, async (id) => {
          counter += 1;
          // Versjonen leses direkte; tilgangen prøves av updateOrder
          const { rowVersion } = await orderRow(id);
          return updateOrder(
            actor,
            organizationId,
            id,
            input({ addressText: `Prøvegata ${counter}, 8006 Bodø` }),
            rowVersion,
            TEST_NOW,
          );
        }),
      idOf: (row) => row.id,
    });

    // Hver ordre er rettet bare av sin egen organisasjon
    for (const id of allIds) {
      const row = await orderRow(id);
      const [editor] = await db.select().from(employees).where(eq(employees.id, row.updatedBy!));
      expect(editor?.organizationId).toBe(row.organizationId);
      for (const log of await updateRowsFor(id)) {
        expect(log.organizationId).toBe(row.organizationId);
      }
    }
  });

  it("2.2.2 expectTenantIsolation for listOrderHistory", async () => {
    let orderIds: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const orderA = await insertOrder(grantA.organizationId);
        const orderB = await insertOrder(grantB.organizationId);
        orderIds = [orderA.id, orderB.id];
        for (const [grant, order] of [
          [grantA, orderA],
          [grantB, orderB],
        ] as const) {
          await recordAuditEvent(db, grant, {
            entityType: "order",
            entityId: order.id,
            action: "create",
            changes: { status: "received" },
          });
          await recordAuditEvent(db, grant, {
            entityType: "order",
            entityId: order.id,
            action: "update",
            changes: { changedFields: ["addressText"] },
          });
        }
        const rowsA = await db
          .select({ id: auditLog.id })
          .from(auditLog)
          .where(eq(auditLog.organizationId, grantA.organizationId));
        const rowsB = await db
          .select({ id: auditLog.id })
          .from(auditLog)
          .where(eq(auditLog.organizationId, grantB.organizationId));
        return { a: rowsA.map((row) => row.id), b: rowsB.map((row) => row.id) };
      },
      query: async (actor, organizationId) =>
        (
          await forEachAllowed(orderIds, (id) => listOrderHistory(actor, organizationId, id))
        ).flat(),
      idOf: (row) => row.id,
    });
  });

  it("2.2.3 admin i A med A sin organisasjons-id og en ordre-id fra B får AccessDeniedError; B er urørt", async () => {
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    const orderB = await createOrder(b.admin, b.org.id, { addressText: ADDRESS }, TEST_NOW);
    const before = await snapshot(orderB.id);

    await expect(
      updateOrder(a.admin, a.org.id, orderB.id, input(), orderB.rowVersion, TEST_NOW),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(listOrderHistory(a.admin, a.org.id, orderB.id)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    // Med B sin organisasjons-id hjelper heller ikke
    await expect(
      updateOrder(a.admin, b.org.id, orderB.id, input(), orderB.rowVersion, TEST_NOW),
    ).rejects.toBeInstanceOf(AccessDeniedError);

    await expectUntouched(orderB.id, before);
  });

  it("2.2.4 listOrderHistory for A-ordre viser aldri loggrader fra B, selv med samme entity_id", async () => {
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    const orderA = await createOrder(a.admin, a.org.id, { addressText: ADDRESS }, TEST_NOW);
    const [foreign] = await db
      .insert(auditLog)
      .values({
        organizationId: b.org.id,
        actorEmployeeId: b.adminEmployee.id,
        entityType: "order",
        entityId: orderA.id,
        action: "update",
        changes: { changedFields: ["gnr"] },
      })
      .returning();

    const history = await listOrderHistory(a.admin, a.org.id, orderA.id);
    expect(history.map((row) => row.id)).not.toContain(foreign!.id);
    expect(history.map((row) => row.action)).toEqual(["create"]);
  });

  it("2.2.5 kobling til kontakt fra B gir ContactNotFoundError; A-ordren, loggen og hendelsene er urørt", async () => {
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    const firmB = await createFirm(b.org.id);
    const contactB = await createContact(b.org.id, { firmId: firmB.id });
    const orderA = await insertOrder(a.org.id);
    const before = await snapshot(orderA.id);

    await expect(
      updateOrder(
        a.admin,
        a.org.id,
        orderA.id,
        input({ addressText: ADDRESS, orderedByContactId: contactB.id }),
        1,
        TEST_NOW,
      ),
    ).rejects.toBeInstanceOf(ContactNotFoundError);
    await expectUntouched(orderA.id, before);
  });
});

// ---------------------------------------------------------------------------------------------
// 2.3 Fremmed, ukjent, slettet og ugyldig id
// ---------------------------------------------------------------------------------------------

describe("2.3 fremmed, ukjent, slettet og ugyldig id", () => {
  it("2.3.1 ukjent uuid gir AccessDeniedError", async () => {
    const { org, admin } = await orgWithAdmin();
    const unknown = randomUUID();
    await expect(updateOrder(admin, org.id, unknown, input(), 1, TEST_NOW)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    await expect(listOrderHistory(admin, org.id, unknown)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
  });

  it("2.3.2 myk-slettet ordre gir AccessDeniedError for både updateOrder og listOrderHistory, og raden er fortsatt slettet", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id, { deletedAt: TEST_NOW });
    const before = await snapshot(order.id);

    await expect(
      updateOrder(admin, org.id, order.id, input(), order.rowVersion, TEST_NOW),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(listOrderHistory(admin, org.id, order.id)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );

    await expectUntouched(order.id, before);
    expect((await orderRow(order.id)).deletedAt).toEqual(TEST_NOW);
  });

  it.each(["ikke-en-id", "1", "", "' or 1=1 --", `${randomUUID()}x`])(
    "2.3.3 ugyldig id «%s» gir AccessDeniedError, ikke databasefeil",
    async (id) => {
      const { org, admin } = await orgWithAdmin();
      await expect(updateOrder(admin, org.id, id, input(), 1, TEST_NOW)).rejects.toBeInstanceOf(
        AccessDeniedError,
      );
      await expect(listOrderHistory(admin, org.id, id)).rejects.toBeInstanceOf(AccessDeniedError);
    },
  );

  it("2.3.4 ukjent og myk-slettet kontakt i egen organisasjon gir ContactNotFoundError, ingenting endres", async () => {
    const { org, admin } = await orgWithAdmin();
    const deleted = await createContact(org.id, { deletedAt: TEST_NOW });
    const order = await insertOrder(org.id);
    const before = await snapshot(order.id);

    for (const contactId of [randomUUID(), deleted.id]) {
      await expect(
        updateOrder(admin, org.id, order.id, input({ orderedByContactId: contactId }), 1, TEST_NOW),
      ).rejects.toBeInstanceOf(ContactNotFoundError);
    }
    await expectUntouched(order.id, before);
  });
});

// ---------------------------------------------------------------------------------------------
// 2.4 Retting
// ---------------------------------------------------------------------------------------------

const FULL_BEFORE = {
  addressText: ADDRESS,
  receivedAt: new Date("2026-11-02T08:00:00.000Z"),
  externalRef: EXTERNAL_REF,
  orderedByText: ORDERED_BY,
  gnr: "12",
  bnr: "34",
  snr: null,
  housingAssociationName: null,
  sellerDeclarationReceived: false,
};

describe("2.4 retting", () => {
  it("2.4.1 mottatt ordre: alle rettbare felt endres, og getOrder viser de nye verdiene", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await createFirm(org.id);
    const contact = await createContact(org.id, { firmId: firm.id });
    const order = await insertOrder(org.id, FULL_BEFORE);

    const result = await updateOrder(
      admin,
      org.id,
      order.id,
      input({
        receivedAt: "2026-11-01T07:30:00.000Z",
        orderedByContactId: contact.id,
        orderedByText: "Megler Prøvesen",
        externalRef: NEW_EXTERNAL_REF,
        gnr: "56",
        bnr: "78",
        snr: "9",
        housingAssociationName: HOUSING,
        sellerDeclarationReceived: true,
      }),
      1,
      TEST_NOW,
    );
    expect(result.changedFields).toEqual([...ORDER_EDITABLE_FIELDS]);

    const read = await getOrder(admin, org.id, order.id);
    expect(read).toMatchObject({
      addressText: NEW_ADDRESS,
      receivedAt: new Date("2026-11-01T07:30:00.000Z"),
      orderedByContactId: contact.id,
      orderedByFirmId: firm.id,
      orderedByText: "Megler Prøvesen",
      externalRef: NEW_EXTERNAL_REF,
      gnr: "56",
      bnr: "78",
      snr: "9",
      housingAssociationName: HOUSING,
      sellerDeclarationReceived: true,
      status: "received",
      rowVersion: 2,
    });
    // Svaret fra updateOrder har samme form som getOrder, pluss changedFields
    const { changedFields, ...rest } = result;
    expect(changedFields).toBeDefined();
    expect(rest).toEqual(read);
  });

  it("2.4.1 mangler mottatt i input, beholdes lagret verdi (ikke now)", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id, FULL_BEFORE);

    for (const receivedAt of [undefined, null, ""]) {
      const version = await versionOf(admin, org.id, order.id);
      await updateOrder(
        admin,
        org.id,
        order.id,
        input({ ...FULL_BEFORE, receivedAt, addressText: `${NEW_ADDRESS} ${String(version)}` }),
        version,
        TEST_NOW,
      );
      expect((await orderRow(order.id)).receivedAt).toEqual(FULL_BEFORE.receivedAt);
    }
    const updates = await updateRowsFor(order.id);
    expect(updates.map((row) => row.changes)).toEqual([
      { changedFields: ["addressText"] },
      { changedFields: ["addressText"] },
      { changedFields: ["addressText"] },
    ]);
  });

  it("2.4.2 gjort-om ordre kan rettes; status, oppdrag og nummer står; oppdraget er uendret", async () => {
    const { org, admin } = await orgWithAdmin();
    const { order, assignment } = await insertConvertedOrder(org.id, FULL_BEFORE);
    const { property } = await createProperty(org.id, {
      assignmentId: assignment.id,
      address: ADDRESS,
    });
    await createAssignmentParty(org.id, { assignmentId: assignment.id, name: ORDERED_BY });
    const [assignmentBefore] = await db
      .select()
      .from(assignments)
      .where(eq(assignments.id, assignment.id));
    const propertiesBefore = await db.select().from(properties);
    const partiesBefore = await db.select().from(assignmentParties);

    const version = await versionOf(admin, org.id, order.id);
    const result = await updateOrder(
      admin,
      org.id,
      order.id,
      input({
        ...FULL_BEFORE,
        receivedAt: undefined,
        addressText: NEW_ADDRESS,
        gnr: "56",
        bnr: "78",
      }),
      version,
      TEST_NOW,
    );
    expect(result.changedFields).toEqual(["addressText", "gnr", "bnr"]);
    expect(result).toMatchObject({
      status: "converted",
      assignmentId: assignment.id,
      assignmentNumber: assignment.number,
      addressText: NEW_ADDRESS,
    });

    const [assignmentAfter] = await db
      .select()
      .from(assignments)
      .where(eq(assignments.id, assignment.id));
    expect(assignmentAfter).toEqual(assignmentBefore);
    expect(assignmentAfter?.propertyId).toBe(property.id);
    expect(await db.select().from(properties)).toEqual(propertiesBefore);
    expect(await db.select().from(assignmentParties)).toEqual(partiesBefore);
    expect(propertiesBefore[0]?.address).toBe(ADDRESS);
  });

  it("2.4.3 avvist ordre kan rettes; status rejected og avvisningsgrunnen står", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    await rejectOrder(admin, org.id, order.id, "Feil registrering");

    const version = await versionOf(admin, org.id, order.id);
    const result = await updateOrder(admin, org.id, order.id, input(), version, TEST_NOW);
    expect(result).toMatchObject({
      status: "rejected",
      rejectedReason: "Feil registrering",
      addressText: NEW_ADDRESS,
    });
    expect(await orderRow(order.id)).toMatchObject({
      status: "rejected",
      rejectedReason: "Feil registrering",
    });
  });

  it("2.4.4 status, rejectReason, assignmentId, source, requestedReportType og organizationId i input blir aldri brukt", async () => {
    const { org, admin } = await orgWithAdmin();
    const other = await createOrganization("Organisasjon B");
    const { order: otherConverted, assignment: foreignAssignment } = await insertConvertedOrder(
      other.id,
    );
    const order = await insertOrder(org.id);
    const pick = (row: Awaited<ReturnType<typeof orderRow>>) => ({
      status: row.status,
      rejectedReason: row.rejectedReason,
      assignmentId: row.assignmentId,
      source: row.source,
      requestedReportType: row.requestedReportType,
      organizationId: row.organizationId,
    });
    const before = pick(await orderRow(order.id));

    const result = await updateOrder(
      admin,
      org.id,
      order.id,
      {
        addressText: NEW_ADDRESS,
        status: "converted",
        rejectReason: "Feil registrering",
        rejectedReason: "Feil registrering",
        assignmentId: foreignAssignment.id,
        source: "email",
        requestedReportType: "bolig",
        organizationId: other.id,
      } as never,
      1,
      TEST_NOW,
    );
    expect(result.changedFields).toEqual(["addressText"]);
    expect(pick(await orderRow(order.id))).toEqual(before);
    expect(before).toMatchObject({ status: "received", source: "manual", organizationId: org.id });
    // Den andre organisasjonens ordre er urørt
    expect((await orderRow(otherConverted.id)).rowVersion).toBe(otherConverted.rowVersion);
  });

  it("2.4.5 koble kontakt etter lagring: kontakt og kontaktens firma lagres", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await createFirm(org.id);
    const contact = await createContact(org.id, { firmId: firm.id });
    const order = await insertOrder(org.id, { orderedByText: ORDERED_BY });

    const result = await updateOrder(
      admin,
      org.id,
      order.id,
      input({ addressText: ADDRESS, orderedByText: ORDERED_BY, orderedByContactId: contact.id }),
      1,
      TEST_NOW,
    );
    expect(result.changedFields).toEqual(["orderedByContactId"]);
    expect(await orderRow(order.id)).toMatchObject({
      orderedByContactId: contact.id,
      orderedByFirmId: firm.id,
      orderedByText: ORDERED_BY,
    });
  });

  it("2.4.6 bytte kontakt: nytt firma følger; uten firma gir null; slettet firma gir null", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm1 = await createFirm(org.id, { name: "Testmegling Nord AS" });
    const firm2 = await createFirm(org.id, { name: "Testmegling Sør AS" });
    const deletedFirm = await createFirm(org.id, { deletedAt: TEST_NOW });
    const first = await createContact(org.id, { firmId: firm1.id });
    const second = await createContact(org.id, { firmId: firm2.id });
    const withoutFirm = await createContact(org.id);
    const withDeletedFirm = await createContact(org.id, { firmId: deletedFirm.id });
    const order = await insertOrder(org.id, {
      orderedByContactId: first.id,
      orderedByFirmId: firm1.id,
    });

    const steps = [
      [second.id, firm2.id],
      [withoutFirm.id, null],
      [first.id, firm1.id],
      [withDeletedFirm.id, null],
    ] as const;
    for (const [contactId, firmId] of steps) {
      const version = await versionOf(admin, org.id, order.id);
      await updateOrder(
        admin,
        org.id,
        order.id,
        input({ addressText: ADDRESS, orderedByContactId: contactId }),
        version,
        TEST_NOW,
      );
      expect(await orderRow(order.id)).toMatchObject({
        orderedByContactId: contactId,
        orderedByFirmId: firmId,
      });
    }
  });

  it("2.4.7 fjerne kontakt: begge kolonnene null, fritekst-bestilleren står", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await createFirm(org.id);
    const contact = await createContact(org.id, { firmId: firm.id });
    const order = await insertOrder(org.id, {
      orderedByText: ORDERED_BY,
      orderedByContactId: contact.id,
      orderedByFirmId: firm.id,
    });

    for (const orderedByContactId of [null, ""]) {
      await db
        .update(orders)
        .set({ orderedByContactId: contact.id, orderedByFirmId: firm.id })
        .where(eq(orders.id, order.id));
      const version = await versionOf(admin, org.id, order.id);
      const result = await updateOrder(
        admin,
        org.id,
        order.id,
        input({ addressText: ADDRESS, orderedByText: ORDERED_BY, orderedByContactId }),
        version,
        TEST_NOW,
      );
      expect(result.changedFields).toEqual(["orderedByContactId"]);
      expect(await orderRow(order.id)).toMatchObject({
        orderedByContactId: null,
        orderedByFirmId: null,
        orderedByText: ORDERED_BY,
      });
    }
  });

  it("2.4.8 orderedByFirmId fra input brukes aldri", async () => {
    const { org, admin } = await orgWithAdmin();
    const ownFirm = await createFirm(org.id, { name: "Testmegling Nord AS" });
    const otherFirm = await createFirm(org.id, { name: "Testmegling Sør AS" });
    const contact = await createContact(org.id, { firmId: ownFirm.id });
    const order = await insertOrder(org.id);

    await updateOrder(
      admin,
      org.id,
      order.id,
      input({ orderedByContactId: contact.id, orderedByFirmId: otherFirm.id }),
      1,
      TEST_NOW,
    );
    expect((await orderRow(order.id)).orderedByFirmId).toBe(ownFirm.id);

    // Uten kontakt blir et firma fra input heller ikke lagret
    const second = await insertOrder(org.id);
    await updateOrder(
      admin,
      org.id,
      second.id,
      input({ orderedByFirmId: otherFirm.id }),
      1,
      TEST_NOW,
    );
    expect((await orderRow(second.id)).orderedByFirmId).toBeNull();
  });

  it.each([
    ["tom adresse", { addressText: "" }],
    ["adresse med bare mellomrom", { addressText: "   " }],
    ["gnr med bokstav", { gnr: "12a" }],
    ["bnr med mellomrom", { bnr: "3 4" }],
    ["snr negativt", { snr: "-1" }],
    ["ugyldig dato", { receivedAt: "ikke en dato" }],
    ["mottatt frem i tid", { receivedAt: "2026-11-04T10:00:00.000Z" }],
    ["fødselsnummer i bestiller", { orderedByText: "Ola 12345678901" }],
    ["ugyldig kontakt-id", { orderedByContactId: "abc" }],
  ])(
    "2.4.9 %s gir ZodError med samme meldinger som «Ny ordre», og ingenting endres",
    async (_name, overrides) => {
      const { org, admin } = await orgWithAdmin();
      const order = await insertOrder(org.id, FULL_BEFORE);
      const before = await snapshot(order.id);
      const bad = input({ ...FULL_BEFORE, receivedAt: undefined, ...overrides });

      const error = await captureError(updateOrder(admin, org.id, order.id, bad, 1, TEST_NOW));
      expect(error).toBeInstanceOf(ZodError);

      const expected = orderInputSchema(TEST_NOW).safeParse({
        ...FULL_BEFORE,
        receivedAt: undefined,
        ...overrides,
      });
      expect(expected.success).toBe(false);
      const messages = (e: ZodError) =>
        e.issues.map((issue) => `${String(issue.path[0])}: ${issue.message}`).sort();
      expect(messages(error as ZodError)).toEqual(messages(expected.error!));

      await expectUntouched(order.id, before);
    },
  );

  it("2.4.10 updated_by blir den som rettet, created_by og created_at er uendret, row_version øker med 1", async () => {
    const { org, admin, adminEmployee } = await orgWithAdmin();
    const { actor: office, employee: officeEmployee } = await person(org.id, ["office"]);
    const created = await createOrder(admin, org.id, { addressText: ADDRESS }, TEST_NOW);
    const before = await orderRow(created.id);
    expect(before.createdBy).toBe(adminEmployee.id);

    await updateOrder(office, org.id, created.id, input(), before.rowVersion, TEST_NOW);

    const after = await orderRow(created.id);
    expect(after.updatedBy).toBe(officeEmployee.id);
    expect(after.createdBy).toBe(adminEmployee.id);
    expect(after.createdAt).toEqual(before.createdAt);
    expect(after.rowVersion).toBe(before.rowVersion + 1);
    expect(after.deletedAt).toBeNull();
  });

  it.each(["externalRef", "orderedByText", "gnr", "bnr", "snr", "housingAssociationName"] as const)(
    "2.4.11 %s: tomt valgfritt felt til verdi og tilbake til tomt virker (tom streng blir null)",
    async (field) => {
      const { org, admin } = await orgWithAdmin();
      const order = await insertOrder(org.id);
      const value = field === "gnr" || field === "bnr" || field === "snr" ? "56" : NEW_EXTERNAL_REF;

      const first = await updateOrder(
        admin,
        org.id,
        order.id,
        input({ addressText: ADDRESS, [field]: value }),
        1,
        TEST_NOW,
      );
      expect(first.changedFields).toEqual([field]);
      expect((await orderRow(order.id))[field]).toBe(value);

      const second = await updateOrder(
        admin,
        org.id,
        order.id,
        input({ addressText: ADDRESS, [field]: "  " }),
        2,
        TEST_NOW,
      );
      expect(second.changedFields).toEqual([field]);
      expect((await orderRow(order.id))[field]).toBeNull();
    },
  );

  it("2.4.11 egenerklæring kan krysses av og tas bort igjen", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    await updateOrder(
      admin,
      org.id,
      order.id,
      input({ addressText: ADDRESS, sellerDeclarationReceived: "on" }),
      1,
      TEST_NOW,
    );
    expect((await orderRow(order.id)).sellerDeclarationReceived).toBe(true);
    const result = await updateOrder(
      admin,
      org.id,
      order.id,
      input({ addressText: ADDRESS }),
      2,
      TEST_NOW,
    );
    expect(result.changedFields).toEqual(["sellerDeclarationReceived"]);
    expect((await orderRow(order.id)).sellerDeclarationReceived).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// 2.5 Versjonssjekk (A253)
// ---------------------------------------------------------------------------------------------

describe("2.5 versjonssjekk", () => {
  it("2.5.1 første retting rett etter oppretting med rowVersion fra getOrder godtas", async () => {
    const { org, admin } = await orgWithAdmin();
    const created = await createOrder(admin, org.id, { addressText: ADDRESS }, TEST_NOW);
    const version = await versionOf(admin, org.id, created.id);

    const result = await updateOrder(admin, org.id, created.id, input(), version, TEST_NOW);
    expect(result.addressText).toBe(NEW_ADDRESS);
    expect(result.rowVersion).toBe(version + 1);
  });

  it("2.5.2 to rettinger med samme rowVersion: den andre gir OrderChangedError, verdiene er fra den første, én loggrad", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    const version = await versionOf(admin, org.id, order.id);

    await updateOrder(admin, org.id, order.id, input({ gnr: "56" }), version, TEST_NOW);
    const afterFirst = await snapshot(order.id);
    await expect(
      updateOrder(
        admin,
        org.id,
        order.id,
        input({ addressText: "Prøvegata 9, 8006 Bodø", gnr: "99" }),
        version,
        TEST_NOW,
      ),
    ).rejects.toBeInstanceOf(OrderChangedError);

    await expectUntouched(order.id, afterFirst);
    expect(await orderRow(order.id)).toMatchObject({ addressText: NEW_ADDRESS, gnr: "56" });
    expect(await updateRowsFor(order.id)).toHaveLength(1);
  });

  it("2.5.3 retting med versjonen fra før avvisning gir OrderChangedError, ordren er avvist og uendret", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    const version = await versionOf(admin, org.id, order.id);
    await rejectOrder(admin, org.id, order.id, "Feil registrering");
    const before = await snapshot(order.id);
    expect(before.order.rowVersion).toBe(version + 1);

    await expect(
      updateOrder(admin, org.id, order.id, input(), version, TEST_NOW),
    ).rejects.toBeInstanceOf(OrderChangedError);
    await expectUntouched(order.id, before);
    expect(before.order).toMatchObject({ status: "rejected", addressText: ADDRESS });
  });

  it("2.5.4 retting med versjonen fra før konvertering gir OrderChangedError", async () => {
    const { org, admin, office } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    const version = await versionOf(admin, org.id, order.id);
    await convertOrderToAssignment(admin, org.id, order.id, { officeId: office.id, now: TEST_NOW });
    const before = await snapshot(order.id);

    await expect(
      updateOrder(admin, org.id, order.id, input(), version, TEST_NOW),
    ).rejects.toBeInstanceOf(OrderChangedError);
    await expectUntouched(order.id, before);
    expect(before.order.status).toBe("converted");
  });

  it("2.5.5 to samtidige updateOrder med samme versjon: nøyaktig én lykkes, én gir OrderChangedError, én loggrad", async () => {
    const { org, admin } = await orgWithAdmin();
    const { actor: office } = await person(org.id, ["office"]);
    const order = await insertOrder(org.id);
    const version = await versionOf(admin, org.id, order.id);

    const results = await Promise.allSettled([
      updateOrder(admin, org.id, order.id, input({ gnr: "56" }), version, TEST_NOW),
      updateOrder(
        office,
        org.id,
        order.id,
        input({ addressText: "Prøvegata 9, 8006 Bodø", bnr: "78" }),
        version,
        TEST_NOW,
      ),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(OrderChangedError);
    expect(await updateRowsFor(order.id)).toHaveLength(1);
    expect(await updatedEventsFor(order.id)).toHaveLength(1);
    expect((await orderRow(order.id)).rowVersion).toBe(version + 1);
  });

  it.each([
    ["for høy", (v: number) => v + 1],
    ["mye for høy", (v: number) => v + 1000],
    ["for lav", (v: number) => v - 1],
    ["null", () => 0],
    ["negativ", () => -1],
    ["ikke heltall", (v: number) => v + 0.5],
    ["NaN", () => Number.NaN],
    ["uendelig", () => Number.POSITIVE_INFINITY],
  ])("2.5.6 versjon %s gir OrderChangedError (likhetssjekk)", async (_name, wrong) => {
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    await updateOrder(admin, org.id, order.id, input({ gnr: "12" }), 1, TEST_NOW);
    const version = await versionOf(admin, org.id, order.id);
    expect(version).toBe(2);
    const before = await snapshot(order.id);

    await expect(
      updateOrder(admin, org.id, order.id, input({ gnr: "56" }), wrong(version), TEST_NOW),
    ).rejects.toBeInstanceOf(OrderChangedError);
    await expectUntouched(order.id, before);
  });
});

// ---------------------------------------------------------------------------------------------
// 2.6 Revisjonslogg og hendelse (A252)
// ---------------------------------------------------------------------------------------------

describe("2.6 revisjonslogg og hendelse", () => {
  it("2.6.1 én retting gir nøyaktig én loggrad med hvem, hva og hvilken ordre", async () => {
    const { org } = await orgWithAdmin();
    const { actor, employee } = await person(org.id, ["office"]);
    const order = await insertOrder(org.id);

    await updateOrder(actor, org.id, order.id, input(), 1, TEST_NOW);

    const rows = await db.select().from(auditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entityType: "order",
      action: "update",
      entityId: order.id,
      organizationId: org.id,
      actorEmployeeId: employee.id,
    });
  });

  it("2.6.2 changes er nøyaktig { changedFields } i rekkefølgen fra ORDER_EDITABLE_FIELDS, uansett rekkefølge i input", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id);

    // Bevisst motsatt rekkefølge i input
    const result = await updateOrder(
      admin,
      org.id,
      order.id,
      {
        sellerDeclarationReceived: true,
        housingAssociationName: HOUSING,
        snr: "9",
        bnr: "78",
        gnr: "56",
        externalRef: NEW_EXTERNAL_REF,
        addressText: NEW_ADDRESS,
      } as Input,
      1,
      TEST_NOW,
    );
    const expected = [
      "addressText",
      "externalRef",
      "gnr",
      "bnr",
      "snr",
      "housingAssociationName",
      "sellerDeclarationReceived",
    ];
    expect(result.changedFields).toEqual(expected);
    const [row] = await updateRowsFor(order.id);
    expect(row!.changes).toEqual({ changedFields: expected });
    expect(Object.keys(row!.changes)).toEqual(["changedFields"]);
  });

  it("2.6.3 personopplysninger lekker ikke: loggradene og hendelsene inneholder ingen av de gamle eller nye verdiene", async () => {
    const { org, admin } = await orgWithAdmin();
    const firmName = "Testmegling Lekkasjesjekk AS";
    const firm = await createFirm(org.id, { name: firmName });
    const firstContact = await createContact(org.id, {
      firstName: CONTACT_FIRST_NAME,
      lastName: CONTACT_LAST_NAME,
      firmId: firm.id,
      email: "kari.provesen@example.com",
      phone: "40000001",
    });
    const secondContact = await createContact(org.id, {
      firstName: OTHER_CONTACT_FIRST_NAME,
      lastName: OTHER_CONTACT_LAST_NAME,
      email: "ola.fiktivsen@example.com",
    });
    const created = await createOrder(
      admin,
      org.id,
      {
        addressText: ADDRESS,
        receivedAt: "2026-11-02T08:00:00.000Z",
        orderedByText: ORDERED_BY,
        orderedByContactId: firstContact.id,
        externalRef: EXTERNAL_REF,
        gnr: "12",
        bnr: "34",
        housingAssociationName: HOUSING,
      },
      TEST_NOW,
    );

    await updateOrder(
      admin,
      org.id,
      created.id,
      {
        addressText: NEW_ADDRESS,
        receivedAt: "2026-11-01T07:30:00.000Z",
        orderedByText: "Megler Prøvesen",
        orderedByContactId: secondContact.id,
        externalRef: NEW_EXTERNAL_REF,
        gnr: "56",
        bnr: "78",
        snr: "9",
        housingAssociationName: "Prøvetoppen sameie",
        sellerDeclarationReceived: true,
      },
      created.rowVersion,
      TEST_NOW,
    );
    // Og tilbake, så også de gamle verdiene har vært «nye»
    await updateOrder(
      admin,
      org.id,
      created.id,
      {
        addressText: ADDRESS,
        receivedAt: "2026-11-02T08:00:00.000Z",
        orderedByText: ORDERED_BY,
        orderedByContactId: firstContact.id,
        externalRef: EXTERNAL_REF,
        gnr: "12",
        bnr: "34",
        housingAssociationName: HOUSING,
      },
      created.rowVersion + 1,
      TEST_NOW,
    );

    const auditRows = await db.select().from(auditLog).where(eq(auditLog.organizationId, org.id));
    const eventRows = await db.select().from(events).where(eq(events.organizationId, org.id));
    expect(auditRows.filter((row) => row.action === "update")).toHaveLength(2);
    expect(eventRows.filter((row) => row.type === "order.updated")).toHaveLength(2);
    const dump = JSON.stringify({ auditRows, eventRows });

    for (const value of [
      ADDRESS,
      NEW_ADDRESS,
      "Testveien",
      "Prøvegata",
      ORDERED_BY,
      "Megler Prøvesen",
      "Testesen",
      EXTERNAL_REF,
      NEW_EXTERNAL_REF,
      "TEST-ORD",
      HOUSING,
      "Testtoppen",
      "Prøvetoppen",
      CONTACT_FIRST_NAME,
      CONTACT_LAST_NAME,
      OTHER_CONTACT_FIRST_NAME,
      OTHER_CONTACT_LAST_NAME,
      "kari.provesen@example.com",
      "ola.fiktivsen@example.com",
      "40000001",
      firmName,
      "2026-11-01T07:30",
    ]) {
      expect(dump, `fant «${value}» i loggen eller hendelsen`).not.toContain(value);
    }
    // Matrikkelverdier og andre felt som nøkkel med verdi, i `changes` og `data`
    // (`receivedAt` er også en kolonne i loggen, så hele raden kan ikke brukes her)
    const payloads = JSON.stringify([
      ...auditRows.map((row) => row.changes),
      ...eventRows.map((row) => row.data),
    ]);
    for (const key of [
      "addressText",
      "gnr",
      "bnr",
      "snr",
      "orderedByText",
      "externalRef",
      "housingAssociationName",
      "receivedAt",
    ]) {
      expect(payloads).not.toContain(`"${key}":`);
    }
  });

  it("2.6.4 hendelsen order.updated har data lik { orderId, changedFields }, i samme organisasjon", async () => {
    const { org, admin, adminEmployee } = await orgWithAdmin();
    const order = await insertOrder(org.id);

    await updateOrder(admin, org.id, order.id, input({ gnr: "56" }), 1, TEST_NOW);

    const rows = await db.select().from(events);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "order.updated",
      organizationId: org.id,
      actorType: "employee",
      actorId: adminEmployee.id,
      assignmentId: null,
    });
    expect(rows[0]!.data).toEqual({ orderId: order.id, changedFields: ["addressText", "gnr"] });
  });

  it("2.6.5 lagring uten endring (også med annen trimming) gir ingen loggrad, ingen hendelse og samme row_version", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await createFirm(org.id);
    const contact = await createContact(org.id, { firmId: firm.id });
    const order = await insertOrder(org.id, {
      ...FULL_BEFORE,
      orderedByContactId: contact.id,
      orderedByFirmId: firm.id,
      housingAssociationName: HOUSING,
    });
    const before = await snapshot(order.id);

    const result = await updateOrder(
      admin,
      org.id,
      order.id,
      {
        addressText: `  ${ADDRESS}  `,
        receivedAt: FULL_BEFORE.receivedAt.toISOString(),
        externalRef: ` ${EXTERNAL_REF} `,
        orderedByText: `${ORDERED_BY}   `,
        orderedByContactId: ` ${contact.id} `,
        gnr: " 12",
        bnr: "34 ",
        snr: "   ",
        housingAssociationName: HOUSING,
        sellerDeclarationReceived: false,
      },
      1,
      TEST_NOW,
    );
    expect(result.changedFields).toEqual([]);
    expect(result.rowVersion).toBe(1);
    await expectUntouched(order.id, before);

    // Uten mottatt i input er det heller ingen endring
    const again = await updateOrder(
      admin,
      org.id,
      order.id,
      {
        ...FULL_BEFORE,
        receivedAt: undefined,
        housingAssociationName: HOUSING,
        orderedByContactId: contact.id,
      },
      1,
      TEST_NOW,
    );
    expect(again.changedFields).toEqual([]);
    await expectUntouched(order.id, before);
  });

  it("2.6.6 bare kontakten byttes: changedFields er bare orderedByContactId, også når firmaet endres", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm1 = await createFirm(org.id, { name: "Testmegling Nord AS" });
    const firm2 = await createFirm(org.id, { name: "Testmegling Sør AS" });
    const first = await createContact(org.id, { firmId: firm1.id });
    const second = await createContact(org.id, { firmId: firm2.id });
    const sameFirm = await createContact(org.id, { firmId: firm2.id });
    const order = await insertOrder(org.id, {
      ...FULL_BEFORE,
      orderedByContactId: first.id,
      orderedByFirmId: firm1.id,
    });
    const same = { ...FULL_BEFORE, receivedAt: undefined };

    // Ny kontakt med nytt firma
    const firstResult = await updateOrder(
      admin,
      org.id,
      order.id,
      input({ ...same, orderedByContactId: second.id }),
      1,
      TEST_NOW,
    );
    expect(firstResult.changedFields).toEqual(["orderedByContactId"]);
    expect(firstResult.orderedByFirmId).toBe(firm2.id);

    // Ny kontakt i samme firma
    const secondResult = await updateOrder(
      admin,
      org.id,
      order.id,
      input({ ...same, orderedByContactId: sameFirm.id }),
      2,
      TEST_NOW,
    );
    expect(secondResult.changedFields).toEqual(["orderedByContactId"]);

    const rows = await updateRowsFor(order.id);
    expect(rows.map((row) => row.changes)).toEqual([
      { changedFields: ["orderedByContactId"] },
      { changedFields: ["orderedByContactId"] },
    ]);
    for (const event of await updatedEventsFor(order.id)) {
      expect(event.data.changedFields).toEqual(["orderedByContactId"]);
    }
  });

  it("2.6.7 ingen loggrad eller hendelse ved avslått tilgang, ZodError, ContactNotFoundError eller OrderChangedError", async () => {
    const { org, admin } = await orgWithAdmin();
    const outsider = await createUser();
    const order = await insertOrder(org.id);
    const before = await snapshot(order.id);

    const attempts: [string, () => Promise<unknown>, abstract new (...args: never[]) => Error][] = [
      [
        "tilgang",
        () => updateOrder(outsider, org.id, order.id, input(), 1, TEST_NOW),
        AccessDeniedError,
      ],
      [
        "Zod",
        () => updateOrder(admin, org.id, order.id, input({ gnr: "x" }), 1, TEST_NOW),
        ZodError,
      ],
      [
        "kontakt",
        () =>
          updateOrder(
            admin,
            org.id,
            order.id,
            input({ orderedByContactId: randomUUID() }),
            1,
            TEST_NOW,
          ),
        ContactNotFoundError,
      ],
      [
        "versjon",
        () => updateOrder(admin, org.id, order.id, input(), 7, TEST_NOW),
        OrderChangedError,
      ],
    ];
    for (const [name, attempt, type] of attempts) {
      expect(await captureError(attempt()), name).toBeInstanceOf(type);
    }

    await expectUntouched(order.id, before);
    expect(await db.select().from(auditLog)).toEqual([]);
    expect(await db.select().from(events)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 2.7 Endringsloggen (listOrderHistory)
// ---------------------------------------------------------------------------------------------

const HISTORY_KEYS = ["actorName", "changedFields", "createdAt", "id", "action"].sort();

describe("2.7 endringsloggen", () => {
  it("2.7.1 opprettet, rettet to ganger og gjort om gir fire rader, nyeste først", async () => {
    const { org, admin, office } = await orgWithAdmin();
    const created = await createOrder(admin, org.id, { addressText: ADDRESS }, TEST_NOW);
    await updateOrder(admin, org.id, created.id, input(), created.rowVersion, TEST_NOW);
    await updateOrder(
      admin,
      org.id,
      created.id,
      input({ gnr: "56", bnr: "78" }),
      created.rowVersion + 1,
      TEST_NOW,
    );
    await convertOrderToAssignment(admin, org.id, created.id, {
      officeId: office.id,
      now: TEST_NOW,
    });

    const history = await listOrderHistory(admin, org.id, created.id);
    expect(history.map((row) => row.action)).toEqual(["convert", "update", "update", "create"]);
    expect(history.map((row) => row.changedFields)).toEqual([
      null,
      ["gnr", "bnr"],
      ["addressText"],
      null,
    ]);
    const times = history.map((row) => row.createdAt.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("2.7.1 avvist ordre viser også avvisningen", async () => {
    const { org, admin } = await orgWithAdmin();
    const created = await createOrder(admin, org.id, { addressText: ADDRESS }, TEST_NOW);
    await rejectOrder(admin, org.id, created.id, "Feil registrering");
    await updateOrder(admin, org.id, created.id, input(), created.rowVersion + 1, TEST_NOW);

    const history = await listOrderHistory(admin, org.id, created.id);
    expect(history.map((row) => row.action)).toEqual(["update", "reject", "create"]);
  });

  it("2.7.2 actorName er navnet til den ansatte; ukjent ansatt og systemrad gir null, og raden står", async () => {
    const { org, admin } = await orgWithAdmin();
    const other = await orgWithAdmin("Organisasjon B");
    const { actor: office, employee: officeEmployee } = await person(
      org.id,
      ["office"],
      "Kontor Testdatter",
    );
    const order = await insertOrder(org.id);
    await updateOrder(office, org.id, order.id, input(), 1, TEST_NOW);

    const base = { organizationId: org.id, entityType: "order", entityId: order.id };
    await db.insert(auditLog).values([
      {
        ...base,
        action: "update",
        actorEmployeeId: null,
        changes: { changedFields: ["gnr"] },
        occurredAt: new Date("2026-11-03T09:00:00Z"),
      },
      {
        ...base,
        action: "update",
        actorEmployeeId: randomUUID(),
        changes: { changedFields: ["bnr"] },
        occurredAt: new Date("2026-11-03T08:00:00Z"),
      },
      {
        ...base,
        action: "update",
        // Ansatt i en annen organisasjon: navnet vises aldri
        actorEmployeeId: other.adminEmployee.id,
        changes: { changedFields: ["snr"] },
        occurredAt: new Date("2026-11-03T07:00:00Z"),
      },
    ]);

    // En ansatt som har sluttet, beholder navnet i historikken
    await db
      .update(employees)
      .set({ deletedAt: TEST_NOW })
      .where(eq(employees.id, officeEmployee.id));

    const history = await listOrderHistory(admin, org.id, order.id);
    expect(history).toHaveLength(4);
    const byField = new Map(history.map((row) => [row.changedFields?.[0], row.actorName]));
    expect(byField.get("addressText")).toBe("Kontor Testdatter");
    expect(byField.get("gnr")).toBeNull();
    expect(byField.get("bnr")).toBeNull();
    expect(byField.get("snr")).toBeNull();
  });

  it("2.7.3 rader for en annen ordre i samme organisasjon står ikke i listen", async () => {
    const { org, admin } = await orgWithAdmin();
    const first = await insertOrder(org.id);
    const second = await insertOrder(org.id);
    await updateOrder(admin, org.id, first.id, input(), 1, TEST_NOW);
    await updateOrder(admin, org.id, second.id, input({ gnr: "56" }), 1, TEST_NOW);

    const history = await listOrderHistory(admin, org.id, first.id);
    expect(history).toHaveLength(1);
    expect(history[0]!.changedFields).toEqual(["addressText"]);
    expect(await listOrderHistory(admin, org.id, second.id)).toHaveLength(1);
  });

  it("2.7.4 rader med annen entity_type og samme entity_id står ikke i listen", async () => {
    const { org, admin, adminEmployee } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    await db.insert(auditLog).values(
      ["assignment", "contact", "orders"].map((entityType) => ({
        organizationId: org.id,
        actorEmployeeId: adminEmployee.id,
        entityType,
        entityId: order.id,
        action: "update",
        changes: { changedFields: ["addressText"] },
      })),
    );

    expect(await listOrderHistory(admin, org.id, order.id)).toEqual([]);
  });

  it("2.7.5 svaret har faste felt: ingen changes rått, ingen avvisningsgrunn eller verdier", async () => {
    const { org, admin, office } = await orgWithAdmin();
    const created = await createOrder(admin, org.id, { addressText: ADDRESS }, TEST_NOW);
    await updateOrder(admin, org.id, created.id, input(), created.rowVersion, TEST_NOW);
    const rejectedOrder = await createOrder(admin, org.id, { addressText: ADDRESS }, TEST_NOW);
    await rejectOrder(admin, org.id, rejectedOrder.id, "Feil registrering hos Testmegleren");
    await convertOrderToAssignment(admin, org.id, created.id, {
      officeId: office.id,
      now: TEST_NOW,
    });

    const rows = [
      ...(await listOrderHistory(admin, org.id, created.id)),
      ...(await listOrderHistory(admin, org.id, rejectedOrder.id)),
    ];
    expect(rows.map((row) => row.action).sort()).toEqual(
      ["convert", "create", "create", "reject", "update"].sort(),
    );
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(HISTORY_KEYS);
      expect(row.createdAt).toBeInstanceOf(Date);
      expect(row).not.toHaveProperty("changes");
      expect(row).not.toHaveProperty("organizationId");
    }
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain("Feil registrering");
    expect(dump).not.toContain("Testmegleren");
    expect(dump).not.toContain("Testveien");
  });

  it("2.7.6 getOrder gir rowVersion, som øker ved retting", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    expect((await getOrder(admin, org.id, order.id)).rowVersion).toBe(1);
    await updateOrder(admin, org.id, order.id, input(), 1, TEST_NOW);
    expect((await getOrder(admin, org.id, order.id)).rowVersion).toBe(2);
  });
});
