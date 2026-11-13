import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { AccessDeniedError, type Actor } from "@/core/access";
import { cancelAssignment } from "@/core/assignments";
import { ContactNotFoundError } from "@/core/contacts";
import { db } from "@/db/client";
import {
  aiUsageLog,
  assignments,
  auditLog,
  cadastralUnits,
  employees,
  events,
  numberSequences,
  offices,
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
  createNumberSequence,
  createOffice,
  createOrder as insertOrder,
  createOrganization,
  createProperty,
  createUser,
  grantPermission,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { OfficeNotFoundError, OrderAlreadyHandledError } from "./errors";
import {
  ORDER_LIST_LIMIT,
  convertOrderToAssignment,
  createOrder,
  getOrder,
  listOrders,
  orderListSummary,
  rejectOrder,
} from "./index";

/** Radene i ordrelisten, for testene som bare ser på radene. */
async function listOrderItems(actor: Actor, organizationId: string, query?: string) {
  return (await listOrders(actor, organizationId, { query })).items;
}

/*
 * Manuell ordre og oppdragsnummer: kjernen i src/core/orders.
 * Testplan: docs/funksjoner/fase2a-manuell-ordre-testplan.md avsnitt 4, med rettelsene i runde 1
 * (rollematrisen én gang for lesing og én for skriving, ingen `note`, ingen `externalRef` eller
 * `statusChangedAt` på oppdraget, hendelser og logg uten personopplysninger) og runde 2
 * (konvertert ordre i begge organisasjoner i tenant-testene for liste og enkeltordre).
 * 4.6.5 (feil i hendelsen ruller tilbake) står i orders-transaction.test.ts.
 *
 * Fast tid: NOW = 03.11.2026 kl. 11 i Oslo. Testdata er oppdiktet.
 *
 * Støtter hovedmål: tid (nummeret kommer fra serveren), reklamasjoner (ordre og oppdrag er
 * adskilt, avvisning har grunn, alt logges, aldri to oppdrag med samme nummer) og KI først
 * (`source` er kroken for ordreforslag fra e-post).
 */

beforeEach(resetDatabase);

const NOW = new Date("2026-11-03T10:00:00Z");
const ADDRESS = "Testveien 12, 8000 Bodø";
const ORDERED_BY = "Megler Testesen, Testmegleren AS";
const HOUSING = "Testtoppen borettslag";
const EXTERNAL_REF = "TEST-ORD-0001";

type OrderInput = Parameters<typeof createOrder>[2];

function orderInput(overrides: Record<string, unknown> = {}): OrderInput {
  return { addressText: ADDRESS, ...overrides } as OrderInput;
}

function fullInput(overrides: Record<string, unknown> = {}): OrderInput {
  return orderInput({
    receivedAt: "2026-11-02T08:00:00.000Z",
    externalRef: EXTERNAL_REF,
    orderedByText: ORDERED_BY,
    gnr: "12",
    bnr: "34",
    snr: "5",
    housingAssociationName: HOUSING,
    sellerDeclarationReceived: true,
    ...overrides,
  });
}

async function setInspectorsEditAll(organizationId: string, value: boolean) {
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": value } })
    .where(eq(organizations.id, organizationId));
}

/** Organisasjon med admin og ett kontor. */
async function orgWithAdmin(name = "Testfirma takst") {
  const org = await createOrganization(name);
  const admin = await createUser({ name: "Test Admin" });
  const adminEmployee = await createEmployee(admin, org.id, ["admin"]);
  const office = await createOffice(org.id, { name: "Testkontor Bodø" });
  return { org, admin, adminEmployee, office };
}

/** En person med rollene i organisasjonen. */
async function person(organizationId: string, roles: EmployeeRole[]) {
  const actor = await createUser();
  const employee = await createEmployee(actor, organizationId, roles);
  return { actor, employee };
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

async function orderRow(id: string) {
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  if (!row) throw new Error("fant ikke ordren");
  return row;
}

async function rowCount(
  table:
    typeof orders | typeof assignments | typeof events | typeof auditLog | typeof numberSequences,
) {
  const [row] = await db.select({ n: count() }).from(table);
  return row?.n ?? 0;
}

async function tableCounts() {
  return {
    orders: await rowCount(orders),
    assignments: await rowCount(assignments),
    events: await rowCount(events),
    auditLog: await rowCount(auditLog),
    numberSequences: await rowCount(numberSequences),
  };
}

async function eventsFor(organizationId: string) {
  return db.select().from(events).where(eq(events.organizationId, organizationId));
}

async function auditFor(organizationId: string) {
  return db.select().from(auditLog).where(eq(auditLog.organizationId, organizationId));
}

const LIST_KEYS = [
  "addressText",
  "assignmentId",
  "assignmentNumber",
  "externalRef",
  "id",
  "orderedByText",
  "receivedAt",
  "source",
  "status",
].sort();

const DETAIL_KEYS = [
  "addressText",
  // Statusflyten 3.7.2 (docs/funksjoner/fase2a-statusflyt-testplan.md)
  "assignmentCancelled",
  "assignmentId",
  "assignmentNumber",
  "bnr",
  "externalRef",
  "gnr",
  "housingAssociationName",
  "id",
  // Koble kontakter (docs/funksjoner/fase2a-koble-kontakter-testplan.md avsnitt 5)
  "orderedByContactId",
  "orderedByFirmId",
  "orderedByText",
  "receivedAt",
  "rejectedReason",
  "requestedReportType",
  // Endre ordren (docs/funksjoner/fase2a-rette-ordre-testplan.md 2.7.8): låsen med row_version
  "rowVersion",
  "sellerDeclarationReceived",
  "snr",
  "source",
  "status",
].sort();

const TRACKING_KEYS = ["createdBy", "updatedBy", "deletedAt", "deletedBy"];

// ---------------------------------------------------------------------------------------------
// 4.1 Tilgang per rolle
// ---------------------------------------------------------------------------------------------

type RoleCase = { name: string; roles: EmployeeRole[]; editAll: boolean };

const allRoleCases: RoleCase[] = [
  { name: "takstmann, innstillingen på", roles: ["inspector"], editAll: true },
  { name: "takstmann, innstillingen av", roles: ["inspector"], editAll: false },
  { name: "kontor", roles: ["office"], editAll: false },
  { name: "leder", roles: ["manager"], editAll: false },
  { name: "admin", roles: ["admin"], editAll: false },
];

describe("4.1 tilgang per rolle", () => {
  it.each(allRoleCases)("4.1.1 $name kan se listen og ordren", async ({ roles, editAll }) => {
    const org = await createOrganization();
    await setInspectorsEditAll(org.id, editAll);
    const order = await insertOrder(org.id);
    const { actor } = await person(org.id, roles);

    const rows = await listOrderItems(actor, org.id);
    expect(rows.map((row) => row.id)).toEqual([order.id]);
    const detail = await getOrder(actor, org.id, order.id);
    expect(detail.id).toBe(order.id);
  });

  it.each(allRoleCases.filter((c) => !(c.roles[0] === "inspector" && !c.editAll)))(
    "4.1.2 $name kan legge inn en ordre",
    async ({ roles, editAll }) => {
      const org = await createOrganization();
      await setInspectorsEditAll(org.id, editAll);
      const { actor } = await person(org.id, roles);

      const row = await createOrder(actor, org.id, orderInput(), NOW);
      expect((await orderRow(row.id)).organizationId).toBe(org.id);
    },
  );

  it("4.1.2 takstmann med innstillingen av får ikke legge inn, avvise eller gjøre om; ingenting endres", async () => {
    const { org, office } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);
    const order = await insertOrder(org.id);
    await createNumberSequence(org.id, { nextValue: 3 });
    const { actor } = await person(org.id, ["inspector"]);
    const before = await tableCounts();
    const orderBefore = await orderRow(order.id);

    await expect(createOrder(actor, org.id, orderInput(), NOW)).rejects.toThrow(AccessDeniedError);
    await expect(rejectOrder(actor, org.id, order.id, "Feil registrering")).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(
      convertOrderToAssignment(actor, org.id, order.id, { officeId: office.id, now: NOW }),
    ).rejects.toThrow(AccessDeniedError);

    expect(await tableCounts()).toEqual(before);
    const orderAfter = await orderRow(order.id);
    expect(orderAfter.status).toBe("received");
    expect(orderAfter.rowVersion).toBe(orderBefore.rowVersion);
    const [sequence] = await db.select().from(numberSequences);
    expect(sequence?.nextValue).toBe(3);
  });

  it("4.1.3 takstmann med innstillingen av og enkeltrettigheten assignment.edit kan alle tre", async () => {
    const { org, office } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);
    const { actor, employee } = await person(org.id, ["inspector"]);
    await grantPermission(employee, "assignment.edit");

    const created = await createOrder(actor, org.id, orderInput(), NOW);
    const rejected = await rejectOrder(actor, org.id, created.id, "Feil registrering");
    expect(rejected.status).toBe("rejected");

    const second = await createOrder(actor, org.id, orderInput(), NOW);
    const result = await convertOrderToAssignment(actor, org.id, second.id, {
      officeId: office.id,
      now: NOW,
    });
    expect(result.assignment.number).toBe("2026-00001");
  });

  it("4.1.4 bruker uten ansattrad ser ingenting og får ikke legge inn", async () => {
    const org = await createOrganization();
    await insertOrder(org.id);
    const stranger = await createUser();

    await expect(listOrders(stranger, org.id)).rejects.toThrow(AccessDeniedError);
    await expect(createOrder(stranger, org.id, orderInput(), NOW)).rejects.toThrow(
      AccessDeniedError,
    );
    expect(await rowCount(orders)).toBe(1);
  });

  it.each([
    ["deaktivert", { deactivatedAt: new Date("2026-11-01T08:00:00Z") }],
    ["slettet", { deletedAt: new Date("2026-11-01T08:00:00Z") }],
  ] as const)("4.1.4 %s ansatt (admin) ser ingenting og får ikke legge inn", async (_name, set) => {
    const org = await createOrganization();
    await insertOrder(org.id);
    const { actor, employee } = await person(org.id, ["admin"]);
    await db.update(employees).set(set).where(eq(employees.id, employee.id));

    await expect(listOrders(actor, org.id)).rejects.toThrow(AccessDeniedError);
    await expect(createOrder(actor, org.id, orderInput(), NOW)).rejects.toThrow(AccessDeniedError);
    expect(await rowCount(orders)).toBe(1);
  });

  it("4.1.4 ansatt uten roller ser ingenting", async () => {
    const org = await createOrganization();
    await insertOrder(org.id);
    const { actor } = await person(org.id, []);
    await expect(listOrders(actor, org.id)).rejects.toThrow(AccessDeniedError);
  });

  // Regel 11: admin stenges aldri ute. Testen skal aldri fjernes.
  it("4.1.5 admin uten andre roller og med innstillingen av kan se, legge inn, avvise og gjøre om", async () => {
    const { org, admin, office } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);

    const first = await createOrder(admin, org.id, orderInput(), NOW);
    const second = await createOrder(admin, org.id, orderInput(), NOW);
    expect((await listOrderItems(admin, org.id)).map((row) => row.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect((await getOrder(admin, org.id, first.id)).id).toBe(first.id);
    expect((await rejectOrder(admin, org.id, first.id, "Feil registrering")).status).toBe(
      "rejected",
    );
    const result = await convertOrderToAssignment(admin, org.id, second.id, {
      officeId: office.id,
      now: NOW,
    });
    expect(result.order.status).toBe("converted");
  });
});

// ---------------------------------------------------------------------------------------------
// 4.2 Tenant-isolasjon: ett expectTenantIsolation per funksjon
// ---------------------------------------------------------------------------------------------

describe("4.2 tenant-isolasjon", () => {
  it("4.2.1 listOrders viser aldri ordre eller oppdragsnummer fra en annen organisasjon", async () => {
    let orgA = "";
    let numberA = "";
    let numberB = "";
    let deletedA = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgA = grantA.organizationId;
        const convertedA = await insertConvertedOrder(grantA.organizationId);
        const receivedA = await insertOrder(grantA.organizationId);
        deletedA = (await insertOrder(grantA.organizationId, { deletedAt: new Date() })).id;
        const convertedB = await insertConvertedOrder(grantB.organizationId);
        numberA = convertedA.assignment.number;
        numberB = convertedB.assignment.number;
        return { a: [convertedA.order.id, receivedA.id], b: [convertedB.order.id] };
      },
      query: listOrderItems,
      idOf: (row) => row.id,
    });

    expect(numberA).not.toBe(numberB);
    const [adminA] = await db
      .select({ userId: employees.userId })
      .from(employees)
      .where(eq(employees.organizationId, orgA));
    const actorA: Actor = { id: adminA!.userId!, email: "a@example.com", name: "Admin A" };
    const rowsA = await listOrderItems(actorA, orgA);
    expect(rowsA.map((row) => row.id)).not.toContain(deletedA);
    expect(rowsA.map((row) => row.assignmentNumber).filter(Boolean)).toEqual([numberA]);
    expect(JSON.stringify(rowsA)).not.toContain(numberB);
  });

  it("4.2.2 getOrder gir aldri en ordre eller et oppdragsnummer fra en annen organisasjon", async () => {
    const orderFor = new Map<string, string>();
    let numberB = "";
    let orgA = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgA = grantA.organizationId;
        const a = await insertConvertedOrder(grantA.organizationId);
        const b = await insertConvertedOrder(grantB.organizationId);
        orderFor.set(grantA.organizationId, a.order.id);
        orderFor.set(grantB.organizationId, b.order.id);
        numberB = b.assignment.number;
        return { a: [a.order.id], b: [b.order.id] };
      },
      query: async (actor, organizationId) => [
        await getOrder(actor, organizationId, orderFor.get(organizationId) ?? randomUUID()),
      ],
      idOf: (row) => row.id,
    });

    const [adminA] = await db
      .select({ userId: employees.userId })
      .from(employees)
      .where(eq(employees.organizationId, orgA));
    const actorA: Actor = { id: adminA!.userId!, email: "a@example.com", name: "Admin A" };
    const detail = await getOrder(actorA, orgA, orderFor.get(orgA)!);
    expect(detail.assignmentNumber).not.toBe(numberB);
    expect(JSON.stringify(detail)).not.toContain(numberB);
  });

  it("4.2.3 createOrder legger alltid ordren i egen organisasjon", async () => {
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor, organizationId) => [
        await createOrder(actor, organizationId, orderInput(), NOW),
      ],
      idOf: (row) => row.organizationId,
    });

    const ordersB = await db.select().from(orders).where(eq(orders.organizationId, orgB));
    expect(ordersB).toHaveLength(1);
    for (const row of await eventsFor(orgB)) expect(row.organizationId).toBe(orgB);
    expect(await eventsFor(orgB)).toHaveLength(1);
    expect(await auditFor(orgB)).toHaveLength(1);
    expect(await rowCount(orders)).toBe(2);
  });

  it("4.2.4 rejectOrder avviser bare ordre i egen organisasjon", async () => {
    const orderFor = new Map<string, string>();
    let orderB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await insertOrder(grantA.organizationId);
        const b = await insertOrder(grantB.organizationId);
        orderFor.set(grantA.organizationId, a.id);
        orderFor.set(grantB.organizationId, b.id);
        orderB = b.id;
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => [
        await rejectOrder(
          actor,
          organizationId,
          orderFor.get(organizationId) ?? randomUUID(),
          "Feil registrering",
        ),
      ],
      idOf: (row) => row.id,
    });

    // B-raden er avvist nøyaktig én gang (av B), A har ikke rørt den
    const rowB = await orderRow(orderB);
    expect(rowB.status).toBe("rejected");
    expect(rowB.rowVersion).toBe(2);
    const rejectedEvents = (await db.select().from(events)).filter(
      (row) => row.type === "order.rejected",
    );
    expect(rejectedEvents).toHaveLength(2);
  });

  it("4.2.5 convertOrderToAssignment gjør bare om ordre i egen organisasjon, og hver får 2026-00001", async () => {
    const seeded = new Map<string, { orderId: string; officeId: string }>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const grant of [grantA, grantB]) {
          const order = await insertOrder(grant.organizationId);
          const office = await createOffice(grant.organizationId);
          seeded.set(grant.organizationId, { orderId: order.id, officeId: office.id });
        }
        return {
          a: [seeded.get(grantA.organizationId)!.orderId],
          b: [seeded.get(grantB.organizationId)!.orderId],
        };
      },
      query: async (actor, organizationId) => {
        const target = seeded.get(organizationId) ?? {
          orderId: randomUUID(),
          officeId: randomUUID(),
        };
        const result = await convertOrderToAssignment(actor, organizationId, target.orderId, {
          officeId: target.officeId,
          now: NOW,
        });
        return [{ id: result.order.id }];
      },
      idOf: (row) => row.id,
    });

    for (const [organizationId, target] of seeded) {
      const rows = await db
        .select()
        .from(assignments)
        .where(eq(assignments.organizationId, organizationId));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ number: "2026-00001", orderId: target.orderId });
      const sequences = await db
        .select()
        .from(numberSequences)
        .where(eq(numberSequences.organizationId, organizationId));
      expect(sequences).toHaveLength(1);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 4.3 Fremmed id i egen organisasjon (regel 2)
// ---------------------------------------------------------------------------------------------

describe("4.3 fremmed, ukjent og slettet id", () => {
  async function twoOrgs() {
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    return { a, b };
  }

  it("4.3.1 ordre-id fra B gir AccessDeniedError, og B-ordren og tabellene er urørt", async () => {
    const { a, b } = await twoOrgs();
    const orderB = await insertOrder(b.org.id);
    const before = await tableCounts();

    await expect(getOrder(a.admin, a.org.id, orderB.id)).rejects.toThrow(AccessDeniedError);
    await expect(rejectOrder(a.admin, a.org.id, orderB.id, "Feil registrering")).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(
      convertOrderToAssignment(a.admin, a.org.id, orderB.id, { officeId: a.office.id, now: NOW }),
    ).rejects.toThrow(AccessDeniedError);

    expect(await tableCounts()).toEqual(before);
    expect((await orderRow(orderB.id)).status).toBe("received");
  });

  it("4.3.2 kontor fra B gir OfficeNotFoundError; ingen oppdrag, ingen serie, ingen hendelse", async () => {
    const { a, b } = await twoOrgs();
    const order = await insertOrder(a.org.id);
    const before = await tableCounts();

    await expect(
      convertOrderToAssignment(a.admin, a.org.id, order.id, { officeId: b.office.id, now: NOW }),
    ).rejects.toThrow(OfficeNotFoundError);

    expect(await tableCounts()).toEqual(before);
    expect((await orderRow(order.id)).status).toBe("received");
  });

  it("4.3.2 OfficeNotFoundError har meldingen «Kontoret finnes ikke.»", () => {
    expect(new OfficeNotFoundError().message).toBe("Kontoret finnes ikke.");
    expect(new OrderAlreadyHandledError().message).toBe("Ordren er allerede behandlet.");
  });

  it("4.3.3 slettet kontor i egen organisasjon gir OfficeNotFoundError", async () => {
    const { org, admin } = await orgWithAdmin();
    const removed = await createOffice(org.id);
    await db.update(offices).set({ deletedAt: new Date() }).where(eq(offices.id, removed.id));
    const order = await insertOrder(org.id);

    await expect(
      convertOrderToAssignment(admin, org.id, order.id, { officeId: removed.id, now: NOW }),
    ).rejects.toThrow(OfficeNotFoundError);
    expect(await rowCount(assignments)).toBe(0);
    expect(await rowCount(numberSequences)).toBe(0);
  });

  it.each([
    ["tilfeldig uuid", randomUUID()],
    ["ikke en id", "ikke-en-id"],
  ])("4.3.4 %s som ordre-id gir AccessDeniedError, aldri databasefeil", async (_name, id) => {
    const { org, admin, office } = await orgWithAdmin();
    await expect(getOrder(admin, org.id, id)).rejects.toThrow(AccessDeniedError);
    await expect(rejectOrder(admin, org.id, id, "Feil registrering")).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(
      convertOrderToAssignment(admin, org.id, id, { officeId: office.id, now: NOW }),
    ).rejects.toThrow(AccessDeniedError);
  });

  it.each([
    ["tilfeldig uuid", randomUUID()],
    ["ikke en id", "ikke-en-id"],
  ])(
    "4.3.4 %s som kontor-id gir OfficeNotFoundError eller AccessDeniedError",
    async (_name, id) => {
      const { org, admin } = await orgWithAdmin();
      const order = await insertOrder(org.id);
      const error = await convertOrderToAssignment(admin, org.id, order.id, {
        officeId: id,
        now: NOW,
      }).then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(
        error instanceof OfficeNotFoundError || error instanceof AccessDeniedError,
        `fikk ${String(error)}`,
      ).toBe(true);
      expect((await orderRow(order.id)).status).toBe("received");
      expect(await rowCount(numberSequences)).toBe(0);
    },
  );

  it("4.3.5 slettet ordre gir AccessDeniedError og står ikke i listen", async () => {
    const { org, admin, office } = await orgWithAdmin();
    const deleted = await insertOrder(org.id, { deletedAt: new Date() });

    await expect(getOrder(admin, org.id, deleted.id)).rejects.toThrow(AccessDeniedError);
    await expect(rejectOrder(admin, org.id, deleted.id, "Feil registrering")).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(
      convertOrderToAssignment(admin, org.id, deleted.id, { officeId: office.id, now: NOW }),
    ).rejects.toThrow(AccessDeniedError);
    expect(await listOrderItems(admin, org.id)).toEqual([]);
    expect((await orderRow(deleted.id)).status).toBe("received");
  });
});

// ---------------------------------------------------------------------------------------------
// 4.4 Legge inn og liste
// ---------------------------------------------------------------------------------------------

describe("4.4 legge inn og liste", () => {
  it("4.4.1 createOrder lagrer alle feltene, i egen organisasjon, som manuell og mottatt", async () => {
    const { org, admin, adminEmployee } = await orgWithAdmin();
    const other = await createOrganization("Organisasjon B");

    const created = await createOrder(
      admin,
      org.id,
      fullInput({ organizationId: other.id }),
      NOW,
    ).catch((error: unknown) => {
      // Å avvise et fremmed felt er også lov; da prøves uten feltet
      if (error instanceof ZodError) return createOrder(admin, org.id, fullInput(), NOW);
      throw error;
    });

    const row = await orderRow(created.id);
    expect(row).toMatchObject({
      organizationId: org.id,
      addressText: ADDRESS,
      gnr: "12",
      bnr: "34",
      snr: "5",
      housingAssociationName: HOUSING,
      sellerDeclarationReceived: true,
      orderedByText: ORDERED_BY,
      externalRef: EXTERNAL_REF,
      source: "manual",
      status: "received",
      requestedReportType: "condition_report",
      rejectedReason: null,
      assignmentId: null,
      createdBy: adminEmployee.id,
      deletedAt: null,
    });
    expect(row.receivedAt.toISOString()).toBe("2026-11-02T08:00:00.000Z");
    const inOther = await db.select().from(orders).where(eq(orders.organizationId, other.id));
    expect(inOther).toEqual([]);
  });

  it("4.4.1 source og requestedReportType fra input blir aldri brukt", async () => {
    const { org, admin } = await orgWithAdmin();
    const created = await createOrder(
      admin,
      org.id,
      orderInput({ source: "email", requestedReportType: "bolig" }),
      NOW,
    ).catch((error: unknown) => {
      if (error instanceof ZodError) return null;
      throw error;
    });
    if (created) {
      const row = await orderRow(created.id);
      expect(row.source).toBe("manual");
      expect(row.requestedReportType).toBe("condition_report");
    } else {
      expect(await rowCount(orders)).toBe(0);
    }
  });

  it("4.4.2 minimal ordre: bare adresse gir tomme valgfrie felt, nei på egenerklæring og mottatt = now", async () => {
    const { org, admin } = await orgWithAdmin();
    const created = await createOrder(admin, org.id, orderInput(), NOW);
    const row = await orderRow(created.id);
    expect(row).toMatchObject({
      externalRef: null,
      orderedByText: null,
      gnr: null,
      bnr: null,
      snr: null,
      housingAssociationName: null,
      sellerDeclarationReceived: false,
    });
    expect(row.receivedAt.toISOString()).toBe(NOW.toISOString());
  });

  it.each([
    ["tom adresse", { addressText: "  " }],
    ["gnr med bokstav", { gnr: "12a" }],
    ["mottatt frem i tid", { receivedAt: "2026-11-03T10:01:00.000Z" }],
    ["fødselsnummer hos bestiller", { orderedByText: "Ola 12345678901" }],
  ])(
    "4.4.3 valideringsfeil (%s) gir ZodError, ingen rad, ingen hendelse, ingen loggrad",
    async (_name, overrides) => {
      const { org, admin } = await orgWithAdmin();
      const before = await tableCounts();
      await expect(createOrder(admin, org.id, orderInput(overrides), NOW)).rejects.toThrow(
        ZodError,
      );
      expect(await tableCounts()).toEqual(before);
    },
  );

  it("4.4.4 listOrders sorterer nyeste mottatt først, uten slettede, og nummeret bare for konverterte", async () => {
    const { org, admin } = await orgWithAdmin();
    const oldest = await insertOrder(org.id, { receivedAt: new Date("2026-10-01T08:00:00Z") });
    const { order: middle, assignment } = await insertConvertedOrder(org.id, {
      receivedAt: new Date("2026-10-15T08:00:00Z"),
    });
    const newest = await insertOrder(org.id, {
      receivedAt: new Date("2026-11-02T08:00:00Z"),
      status: "rejected",
      rejectedReason: "Feil registrering",
    });
    await insertOrder(org.id, {
      receivedAt: new Date("2026-11-03T08:00:00Z"),
      deletedAt: new Date(),
    });

    const rows = await listOrderItems(admin, org.id);
    expect(rows.map((row) => row.id)).toEqual([newest.id, middle.id, oldest.id]);
    expect(rows.map((row) => row.assignmentNumber ?? null)).toEqual([
      null,
      assignment.number,
      null,
    ]);
    expect(rows[1]?.assignmentId).toBe(assignment.id);
  });

  it("4.4.4 tom organisasjon gir tom liste", async () => {
    const { org, admin } = await orgWithAdmin();
    expect(await listOrderItems(admin, org.id)).toEqual([]);
  });

  it("4.4.5 listOrders og getOrder gir faste feltlister uten sporingsfelt", async () => {
    const { org, admin } = await orgWithAdmin();
    const { order } = await insertConvertedOrder(org.id);
    await insertOrder(org.id);

    const rows = await listOrderItems(admin, org.id);
    expect(rows.length).toBe(2);
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(LIST_KEYS);

    const detail = await getOrder(admin, org.id, order.id);
    expect(Object.keys(detail).sort()).toEqual(DETAIL_KEYS);
    for (const key of [...TRACKING_KEYS, "organizationId"]) expect(detail).not.toHaveProperty(key);
  });
});

// ---------------------------------------------------------------------------------------------
// 4.5 Avvise og gjøre om (statusreglene som data)
// ---------------------------------------------------------------------------------------------

describe("4.5 avvise og gjøre om", () => {
  it("4.5.1 rejectOrder fra mottatt: avvist med trimmet grunn, ikke slettet, fortsatt i listen", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id);

    const result = await rejectOrder(admin, org.id, order.id, "  Feil registrering  ");
    expect(result.status).toBe("rejected");

    const row = await orderRow(order.id);
    expect(row).toMatchObject({
      status: "rejected",
      rejectedReason: "Feil registrering",
      assignmentId: null,
      deletedAt: null,
    });
    const list = await listOrderItems(admin, org.id);
    expect(list.map((item) => [item.id, item.status])).toEqual([[order.id, "rejected"]]);
    expect((await getOrder(admin, org.id, order.id)).rejectedReason).toBe("Feil registrering");
  });

  it("4.5.1 tom grunn gir ZodError og ingen endring", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    const before = await tableCounts();
    await expect(rejectOrder(admin, org.id, order.id, "   ")).rejects.toThrow(ZodError);
    expect(await tableCounts()).toEqual(before);
    expect((await orderRow(order.id)).status).toBe("received");
  });

  it("4.5.2 convertOrderToAssignment fra mottatt lager oppdrag 2026-00001 og kobler begge veier", async () => {
    const { org, admin, office } = await orgWithAdmin();
    const order = await insertOrder(org.id, { externalRef: EXTERNAL_REF });

    const result = await convertOrderToAssignment(admin, org.id, order.id, {
      officeId: office.id,
      now: NOW,
    });

    expect(result.assignment).toMatchObject({
      number: "2026-00001",
      officeId: office.id,
      status: "ordered",
      orderId: order.id,
    });
    expect(result.order).toMatchObject({ id: order.id, status: "converted" });

    const [assignment] = await db
      .select()
      .from(assignments)
      .where(eq(assignments.id, result.assignment.id));
    expect(assignment).toMatchObject({
      organizationId: org.id,
      number: "2026-00001",
      status: "ordered",
      assignmentType: "condition_report",
      officeId: office.id,
      orderId: order.id,
      deletedAt: null,
    });
    const row = await orderRow(order.id);
    expect(row).toMatchObject({ status: "converted", assignmentId: result.assignment.id });
    const detail = await getOrder(admin, org.id, order.id);
    expect(detail.assignmentNumber).toBe("2026-00001");
  });

  const transitions = [
    { fra: "converted", handling: "reject" },
    { fra: "converted", handling: "convert" },
    { fra: "rejected", handling: "reject" },
    { fra: "rejected", handling: "convert" },
  ] as const;

  it.each(transitions)(
    "4.5.3 fra $fra med $handling gir OrderAlreadyHandledError og ingen endring",
    async ({ fra, handling }) => {
      const { org, admin, office } = await orgWithAdmin();
      const order =
        fra === "converted"
          ? (await insertConvertedOrder(org.id)).order
          : await insertOrder(org.id, { status: "rejected", rejectedReason: "Feil registrering" });
      await createNumberSequence(org.id, { nextValue: 7 });
      const before = await tableCounts();
      const orderBefore = await orderRow(order.id);

      const run =
        handling === "reject"
          ? rejectOrder(admin, org.id, order.id, "Ny grunn")
          : convertOrderToAssignment(admin, org.id, order.id, { officeId: office.id, now: NOW });
      await expect(run).rejects.toThrow(OrderAlreadyHandledError);

      expect(await tableCounts()).toEqual(before);
      const orderAfter = await orderRow(order.id);
      expect(orderAfter.updatedAt.toISOString()).toBe(orderBefore.updatedAt.toISOString());
      expect(orderAfter.rowVersion).toBe(orderBefore.rowVersion);
      expect(orderAfter.status).toBe(fra);
      expect(orderAfter.rejectedReason).toBe(orderBefore.rejectedReason);
      const [sequence] = await db.select().from(numberSequences);
      expect(sequence?.nextValue).toBe(7);
    },
  );

  it(
    "4.5.4 to samtidige konverteringer av samme ordre gir ett oppdrag, og taperen bruker ikke opp et nummer",
    { timeout: 30_000 },
    async () => {
      const { org, admin, office } = await orgWithAdmin();
      const order = await insertOrder(org.id);

      const results = await Promise.allSettled([
        convertOrderToAssignment(admin, org.id, order.id, { officeId: office.id, now: NOW }),
        convertOrderToAssignment(admin, org.id, order.id, { officeId: office.id, now: NOW }),
      ]);

      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        OrderAlreadyHandledError,
      );

      expect(await rowCount(assignments)).toBe(1);
      const [sequence] = await db.select().from(numberSequences);
      expect(sequence?.nextValue).toBe(2);
      const created = (await eventsFor(org.id)).filter((row) => row.type === "assignment.created");
      expect(created).toHaveLength(1);
    },
  );

  it(
    "4.5.5 20 samtidige konverteringer av 20 ordre gir numrene 00001–00020",
    { timeout: 30_000 },
    async () => {
      const { org, admin, office } = await orgWithAdmin();
      const created = [];
      for (let i = 0; i < 20; i += 1) created.push(await insertOrder(org.id));

      const results = await Promise.all(
        created.map((order) =>
          convertOrderToAssignment(admin, org.id, order.id, { officeId: office.id, now: NOW }),
        ),
      );

      expect(results.map((result) => result.assignment.number).sort()).toEqual(
        Array.from({ length: 20 }, (_, i) => `2026-${String(i + 1).padStart(5, "0")}`),
      );
      const rows = await db.select().from(orders).where(eq(orders.organizationId, org.id));
      expect(rows.every((row) => row.status === "converted")).toBe(true);
      expect(new Set(rows.map((row) => row.assignmentId)).size).toBe(20);
      expect(await rowCount(assignments)).toBe(20);
      const [sequence] = await db.select().from(numberSequences);
      expect(sequence?.nextValue).toBe(21);
    },
  );

  it("4.5.6 årsskiftet i norsk tid: 31.12.2026 kl. 23:30 UTC gir 2027-00001 etter 2026-00001", async () => {
    const { org, admin, office } = await orgWithAdmin();
    const first = await insertOrder(org.id);
    const second = await insertOrder(org.id);

    const a = await convertOrderToAssignment(admin, org.id, first.id, {
      officeId: office.id,
      now: NOW,
    });
    const b = await convertOrderToAssignment(admin, org.id, second.id, {
      officeId: office.id,
      now: new Date("2026-12-31T23:30:00Z"),
    });

    expect(a.assignment.number).toBe("2026-00001");
    expect(b.assignment.number).toBe("2027-00001");
    expect(await rowCount(numberSequences)).toBe(2);
  });

  it("4.5.7 to organisasjoner får begge 2026-00001", async () => {
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    const orderA = await insertOrder(a.org.id);
    const orderB = await insertOrder(b.org.id);

    const resultA = await convertOrderToAssignment(a.admin, a.org.id, orderA.id, {
      officeId: a.office.id,
      now: NOW,
    });
    const resultB = await convertOrderToAssignment(b.admin, b.org.id, orderB.id, {
      officeId: b.office.id,
      now: NOW,
    });
    expect(resultA.assignment.number).toBe("2026-00001");
    expect(resultB.assignment.number).toBe("2026-00001");
  });
});

// ---------------------------------------------------------------------------------------------
// 4.6 Hendelser og revisjonslogg i samme transaksjon
// ---------------------------------------------------------------------------------------------

describe("4.6 hendelser og revisjonslogg", () => {
  /** Ingen personopplysninger fra ordren i hendelser eller logg. */
  async function expectNoPersonalData(organizationId: string) {
    const text = JSON.stringify([await eventsFor(organizationId), await auditFor(organizationId)]);
    for (const value of [ADDRESS, ORDERED_BY, HOUSING, "Testveien"]) {
      expect(text).not.toContain(value);
    }
  }

  it("4.6.1 createOrder skriver order.received og loggraden create, uten adresse eller bestiller", async () => {
    const { org, admin, adminEmployee } = await orgWithAdmin();
    const created = await createOrder(admin, org.id, fullInput(), NOW);

    const rows = await eventsFor(org.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "order.received",
      actorType: "employee",
      actorId: adminEmployee.id,
      assignmentId: null,
    });
    expect(rows[0]?.data).toEqual({ orderId: created.id, source: "manual" });

    const audit = await auditFor(org.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      entityType: "order",
      entityId: created.id,
      action: "create",
      actorEmployeeId: adminEmployee.id,
    });
    expect(audit[0]?.changes).toEqual({
      status: "received",
      source: "manual",
      requestedReportType: "condition_report",
    });
    await expectNoPersonalData(org.id);
  });

  it("4.6.2 rejectOrder skriver order.rejected uten grunnen, og loggraden reject med grunnen", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id);

    await rejectOrder(admin, org.id, order.id, "Feil registrering");

    const rows = await eventsFor(org.id);
    expect(rows.map((row) => row.type)).toEqual(["order.rejected"]);
    expect(rows[0]?.data).toEqual({ orderId: order.id });
    expect(rows[0]?.assignmentId).toBeNull();

    const audit = await auditFor(org.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ entityType: "order", entityId: order.id, action: "reject" });
    expect(audit[0]?.changes).toEqual({
      status: { from: "received", to: "rejected" },
      rejectedReason: "Feil registrering",
    });
    await expectNoPersonalData(org.id);
  });

  it("4.6.3 convertOrderToAssignment skriver assignment.created og to loggrader", async () => {
    const { org, admin, office } = await orgWithAdmin();
    const order = await insertOrder(org.id);

    const result = await convertOrderToAssignment(admin, org.id, order.id, {
      officeId: office.id,
      now: NOW,
    });
    const assignmentId = result.assignment.id;

    const rows = await eventsFor(org.id);
    expect(rows.map((row) => row.type)).toEqual(["assignment.created"]);
    expect(rows[0]?.assignmentId).toBe(assignmentId);
    expect(rows[0]?.data).toEqual({ number: "2026-00001", orderId: order.id });

    const audit = await auditFor(org.id);
    expect(audit).toHaveLength(2);
    const convert = audit.find((row) => row.entityType === "order");
    const create = audit.find((row) => row.entityType === "assignment");
    expect(convert).toMatchObject({ entityId: order.id, action: "convert" });
    expect(convert?.changes).toEqual({
      status: { from: "received", to: "converted" },
      assignmentId,
      number: "2026-00001",
    });
    expect(create).toMatchObject({ entityId: assignmentId, action: "create" });
    expect(create?.changes).toEqual({
      number: "2026-00001",
      status: "ordered",
      officeId: office.id,
    });
    await expectNoPersonalData(org.id);
  });

  it("4.6.4 ingen hendelse ved avvist tilgang, valideringsfeil eller behandlet ordre", async () => {
    const { org, admin, office } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);
    const { actor: inspector } = await person(org.id, ["inspector"]);
    const order = await insertOrder(org.id);
    const handled = await insertOrder(org.id, {
      status: "rejected",
      rejectedReason: "Feil registrering",
    });

    await expect(createOrder(inspector, org.id, orderInput(), NOW)).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(createOrder(admin, org.id, orderInput({ gnr: "12a" }), NOW)).rejects.toThrow(
      ZodError,
    );
    await expect(rejectOrder(admin, org.id, order.id, "")).rejects.toThrow(ZodError);
    await expect(rejectOrder(admin, org.id, handled.id, "Ny grunn")).rejects.toThrow(
      OrderAlreadyHandledError,
    );
    await expect(
      convertOrderToAssignment(admin, org.id, handled.id, { officeId: office.id, now: NOW }),
    ).rejects.toThrow(OrderAlreadyHandledError);

    expect(await rowCount(events)).toBe(0);
    expect(await rowCount(auditLog)).toBe(0);
  });

  it("4.6.6 events.assignment_id peker på et ekte oppdrag i samme organisasjon", async () => {
    const { org, admin, office } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    await convertOrderToAssignment(admin, org.id, order.id, { officeId: office.id, now: NOW });

    const joined = await db
      .select({ eventId: events.id, number: assignments.number })
      .from(events)
      .innerJoin(assignments, eq(assignments.id, events.assignmentId))
      .where(eq(events.organizationId, org.id));
    expect(joined).toHaveLength(1);
    expect(joined[0]?.number).toBe("2026-00001");
    const [assignment] = await db.select().from(assignments);
    expect(assignment?.organizationId).toBe(org.id);
  });
});

// ---------------------------------------------------------------------------------------------
// Statusflyten 3.7.2: getOrder(...).assignmentCancelled
// (docs/funksjoner/fase2a-statusflyt-testplan.md). Tenant-isolasjonen for getOrder er dekket
// over (4.3); joinen endres, så den skal fortsatt være grønn.
// ---------------------------------------------------------------------------------------------

describe("statusflyt 3.7.2 getOrder(...).assignmentCancelled", () => {
  it("false for en ordre med aktivt oppdrag", async () => {
    const { org, admin } = await orgWithAdmin();
    const { order } = await insertConvertedOrder(org.id);
    const detail = await getOrder(admin, org.id, order.id);
    expect(detail).toHaveProperty("assignmentCancelled", false);
  });

  it("true etter cancelAssignment; nummeret og koblingen står fortsatt", async () => {
    const { org, admin } = await orgWithAdmin();
    const { order, assignment } = await insertConvertedOrder(org.id);

    await cancelAssignment(admin, org.id, assignment.id, {
      expectedStatus: "ordered",
      reason: "Kunden trakk bestillingen",
    });

    const detail = await getOrder(admin, org.id, order.id);
    expect(detail).toHaveProperty("assignmentCancelled", true);
    expect(detail.status).toBe("converted");
    expect(detail.assignmentId).toBe(assignment.id);
    expect(detail.assignmentNumber).toBe(assignment.number);
  });

  it("false for en ordre uten oppdrag", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    const detail = await getOrder(admin, org.id, order.id);
    expect(detail).toHaveProperty("assignmentCancelled", false);
  });
});

// ---------------------------------------------------------------------------------------------
// 5. Bestilleren koblet til kontaktregisteret
// (docs/funksjoner/fase2a-koble-kontakter-testplan.md avsnitt 5; tilgang per rolle for
// `createOrder` med kontakt står i src/core/assignments/assignment-contact-link.test.ts 6).
// `orderedByContactId` kommer i input; kjernen setter `orderedByFirmId` fra kontakten.
// ---------------------------------------------------------------------------------------------

describe("5. bestiller fra kontaktregisteret", () => {
  const DELETED_AT = new Date("2026-11-01T08:00:00Z");

  async function withContact(withFirm = true) {
    const base = await orgWithAdmin();
    const firm = withFirm ? await createFirm(base.org.id) : null;
    const contact = await createContact(base.org.id, {
      firstName: "Megler",
      lastName: "Testesen",
      email: "megler@example.com",
      phone: "00000000",
      firmId: firm?.id ?? null,
    });
    return { ...base, firm, contact };
  }

  it("5.1 createOrder_with_contact: kontakten og kontaktens firma lagres; revisjonsloggen har id-ene", async () => {
    const s = await withContact();
    const created = await createOrder(
      s.admin,
      s.org.id,
      fullInput({ orderedByContactId: s.contact.id }),
      NOW,
    );

    const row = await orderRow(created.id);
    expect(row.orderedByContactId).toBe(s.contact.id);
    expect(row.orderedByFirmId).toBe(s.firm!.id);
    // Friteksten lagres som sendt (øyeblikksbilde)
    expect(row.orderedByText).toBe(ORDERED_BY);

    const audit = await auditFor(s.org.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.changes).toMatchObject({
      orderedByContactId: s.contact.id,
      orderedByFirmId: s.firm!.id,
    });
    const text = JSON.stringify([await eventsFor(s.org.id), audit]).replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      "<id>",
    );
    for (const value of [ORDERED_BY, "Testesen", "megler@example.com", "00000000", "Testveien"]) {
      expect(text, value).not.toContain(value);
    }
  });

  it("5.1b orderedByFirmId fra input brukes aldri; firmaet følger kontakten", async () => {
    const s = await withContact();
    const otherFirm = await createFirm(s.org.id, { name: "Annet Firma AS" });
    const created = await createOrder(
      s.admin,
      s.org.id,
      orderInput({ orderedByContactId: s.contact.id, orderedByFirmId: otherFirm.id }),
      NOW,
    );
    expect((await orderRow(created.id)).orderedByFirmId).toBe(s.firm!.id);
  });

  it("5.2 createOrder_contact_without_firm: firma null", async () => {
    const s = await withContact(false);
    const created = await createOrder(
      s.admin,
      s.org.id,
      orderInput({ orderedByContactId: s.contact.id }),
      NOW,
    );
    const row = await orderRow(created.id);
    expect(row.orderedByContactId).toBe(s.contact.id);
    expect(row.orderedByFirmId).toBeNull();
  });

  it("5.2b kontakt med slettet firma: firma null", async () => {
    const s = await orgWithAdmin();
    const firm = await createFirm(s.org.id, { deletedAt: DELETED_AT });
    const contact = await createContact(s.org.id, { firmId: firm.id });
    const created = await createOrder(
      s.admin,
      s.org.id,
      orderInput({ orderedByContactId: contact.id }),
      NOW,
    );
    const row = await orderRow(created.id);
    expect(row.orderedByContactId).toBe(contact.id);
    expect(row.orderedByFirmId).toBeNull();
  });

  it("5.3 createOrder_foreign_contact_throws_and_no_order (IDOR): ingen ordre, ingen hendelse, ingen revisjonsrad", async () => {
    const s = await orgWithAdmin();
    const orgB = await createOrganization("Organisasjon B");
    const firmB = await createFirm(orgB.id);
    const contactB = await createContact(orgB.id, { firmId: firmB.id });
    const before = await tableCounts();

    await expect(
      createOrder(s.admin, s.org.id, fullInput({ orderedByContactId: contactB.id }), NOW),
    ).rejects.toThrow(ContactNotFoundError);

    expect(await tableCounts()).toEqual(before);
    expect(await eventsFor(s.org.id)).toHaveLength(0);
    expect(await auditFor(s.org.id)).toHaveLength(0);
  });

  it.each([
    ["slettet kontakt i egen organisasjon", "deleted"],
    ["ukjent uuid", "unknown"],
  ] as const)("5.4 createOrder_deleted_contact_throws_and_no_order: %s", async (_name, kind) => {
    const s = await orgWithAdmin();
    const contactId =
      kind === "deleted"
        ? (await createContact(s.org.id, { deletedAt: DELETED_AT })).id
        : randomUUID();
    const before = await tableCounts();

    await expect(
      createOrder(s.admin, s.org.id, orderInput({ orderedByContactId: contactId }), NOW),
    ).rejects.toThrow(ContactNotFoundError);

    expect(await tableCounts()).toEqual(before);
  });

  it("5.5 createOrder_without_contact: som før, begge kolonnene null", async () => {
    const { org, admin } = await orgWithAdmin();
    const created = await createOrder(admin, org.id, fullInput(), NOW);
    const row = await orderRow(created.id);
    expect(row.orderedByContactId).toBeNull();
    expect(row.orderedByFirmId).toBeNull();
    expect(row.orderedByText).toBe(ORDERED_BY);
  });

  it("5.6 getOrder_returns_link: koblet ordre gir id-ene, ukoblet gir null", async () => {
    const s = await withContact();
    const linked = await createOrder(
      s.admin,
      s.org.id,
      orderInput({ orderedByContactId: s.contact.id }),
      NOW,
    );
    const plain = await createOrder(s.admin, s.org.id, orderInput(), NOW);

    expect(await getOrder(s.admin, s.org.id, linked.id)).toMatchObject({
      orderedByContactId: s.contact.id,
      orderedByFirmId: s.firm!.id,
    });
    expect(await getOrder(s.admin, s.org.id, plain.id)).toMatchObject({
      orderedByContactId: null,
      orderedByFirmId: null,
    });
  });

  it("5.6b getOrder slår ikke opp kontakten: ingen navn, e-post eller telefon fra registeret i svaret", async () => {
    const s = await withContact();
    const linked = await createOrder(
      s.admin,
      s.org.id,
      orderInput({ orderedByContactId: s.contact.id }),
      NOW,
    );
    const text = JSON.stringify(await getOrder(s.admin, s.org.id, linked.id));
    expect(text).not.toContain("Testesen");
    expect(text).not.toContain("megler@example.com");
  });

  it("5.7 tenant-isolasjon: getOrder med kobling gir aldri en ordre eller kontakt fra en annen organisasjon", async () => {
    const orderFor = new Map<string, string>();
    const contactFor = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids: Record<string, string[]> = {};
        for (const grant of [grantA, grantB]) {
          const firm = await createFirm(grant.organizationId);
          const contact = await createContact(grant.organizationId, { firmId: firm.id });
          const order = await insertOrder(grant.organizationId, {
            orderedByContactId: contact.id,
            orderedByFirmId: firm.id,
          });
          orderFor.set(grant.organizationId, order.id);
          contactFor.set(grant.organizationId, contact.id);
          ids[grant.organizationId] = [order.id];
        }
        return { a: ids[grantA.organizationId]!, b: ids[grantB.organizationId]! };
      },
      query: async (actor, organizationId) => {
        const order = await getOrder(
          actor,
          organizationId,
          orderFor.get(organizationId) ?? randomUUID(),
        );
        expect(order.orderedByContactId).toBe(contactFor.get(organizationId));
        return [order];
      },
      idOf: (row) => row.id,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Søk og grense i ordrelisten (docs/funksjoner/fase2a-sok-ordre-arbeidsko.md, ADR 0010)
// ---------------------------------------------------------------------------------------------

describe("søk og grense i ordrelisten", () => {
  /** Ordre med oppdrag, eiendom, matrikkel og to parter. Alt oppdiktet. */
  async function searchableOrder(organizationId: string) {
    const { order, assignment } = await insertConvertedOrder(organizationId, {
      addressText: "Søkeveien 7, 8000 Bodø",
      externalRef: "MEGL-4711",
      orderedByText: "Bestiller Bestillersen",
      gnr: "41",
      bnr: "7",
      snr: null,
    });
    await createProperty(organizationId, {
      assignmentId: assignment.id,
      address: "Eiendomsgata 3",
      gnr: "77",
      bnr: "88",
      fnr: null,
      snr: "2",
    });
    await createAssignmentParty(organizationId, {
      assignmentId: assignment.id,
      name: "Parti Partisen",
      firmName: "Firmaet Fiktiv AS",
      email: "parti@example.com",
      phone: "99999999",
    });
    await createAssignmentParty(organizationId, {
      assignmentId: assignment.id,
      name: "Parti Partisen junior",
      firmName: "Firmaet Fiktiv AS",
    });
    return { order, assignment };
  }

  it("finner på alle feltene, uten forskjell på store og små bokstaver, og uten doble rader", async () => {
    const { org, admin } = await orgWithAdmin();
    const { order, assignment } = await searchableOrder(org.id);
    const other = await insertOrder(org.id, { addressText: "Annenveien 1" });

    for (const query of [
      "søkeveien", // adresse på ordren
      "EIENDOMSGATA", // adresse på eiendommen
      assignment.number.toLowerCase(), // oppdragsnummer
      "megl-47", // ordrenummer
      "bestillersen", // oppdragsgiver
      "partisen", // partsnavn (to parter treffer)
      "fiktiv", // partens firma (to parter treffer)
      "41/7", // matrikkel på ordren
      "77 / 88", // matrikkel fra cadastral_units
      "77/88/0/2", // med festenummer 0 og seksjonsnummer
    ]) {
      const result = await listOrders(admin, org.id, { query });
      expect(
        result.items.map((row) => row.id),
        query,
      ).toEqual([order.id]);
      expect(result.total, query).toBe(1);
    }
    expect((await listOrders(admin, org.id, { query: "  " })).total).toBe(2);
    expect((await listOrderItems(admin, org.id, "Annenveien")).map((row) => row.id)).toEqual([
      other.id,
    ]);
  });

  it("matrikkel sammenlignes del for del", async () => {
    const { org, admin } = await orgWithAdmin();
    const exact = await insertOrder(org.id, { gnr: "12", bnr: "34", snr: null });
    const withSection = await insertOrder(org.id, { gnr: "12", bnr: "34", snr: "5" });
    await insertOrder(org.id, { gnr: "112", bnr: "34" });
    await insertOrder(org.id, { gnr: "12", bnr: "345" });

    const ids = (await listOrderItems(admin, org.id, "12/34")).map((row) => row.id).sort();
    expect(ids).toEqual([exact.id, withSection.id].sort());
    expect((await listOrderItems(admin, org.id, "12/34/0/5")).map((row) => row.id)).toEqual([
      withSection.id,
    ]);
  });

  it("e-post, telefon og jokertegn gir ikke treff; slettet ordre og part gir ikke treff", async () => {
    const { org, admin } = await orgWithAdmin();
    const { assignment } = await searchableOrder(org.id);
    await insertOrder(org.id, { addressText: "Slettaveien 9", deletedAt: new Date() });
    await createAssignmentParty(org.id, {
      assignmentId: assignment.id,
      name: "Slettet Person",
      deletedAt: new Date(),
    });

    for (const query of ["parti@example.com", "99999999", "%", "_", "\\", "Slettaveien"]) {
      expect((await listOrders(admin, org.id, { query })).total, query).toBe(0);
    }
    expect(await listOrderItems(admin, org.id, "Slettet Person")).toEqual([]);
  });

  it("slettet matrikkel og slettet eiendom gir ikke treff", async () => {
    const { org, admin } = await orgWithAdmin();
    const { assignment } = await insertConvertedOrder(org.id, { addressText: "Ordreveien 1" });
    const { property, cadastralUnit } = await createProperty(org.id, {
      assignmentId: assignment.id,
      address: "Borteveien 2",
      gnr: "61",
      bnr: "62",
    });
    expect((await listOrders(admin, org.id, { query: "61/62" })).total).toBe(1);
    expect((await listOrders(admin, org.id, { query: "Borteveien" })).total).toBe(1);
    await db
      .update(cadastralUnits)
      .set({ deletedAt: new Date() })
      .where(eq(cadastralUnits.id, cadastralUnit.id));
    expect((await listOrders(admin, org.id, { query: "61/62" })).total).toBe(0);
    await db
      .update(properties)
      .set({ deletedAt: new Date() })
      .where(eq(properties.id, property.id));
    expect((await listOrders(admin, org.id, { query: "Borteveien" })).total).toBe(0);
  });

  it("ordre med kansellert oppdrag finnes ved søk på oppdragsnummer, parter og eiendom", async () => {
    const { org, admin } = await orgWithAdmin();
    const { order, assignment } = await searchableOrder(org.id);
    await cancelAssignment(admin, org.id, assignment.id, {
      expectedStatus: "ordered",
      reason: "Kunden trakk bestillingen",
    });
    for (const query of [assignment.number, "Partisen", "Eiendomsgata"]) {
      expect(
        (await listOrderItems(admin, org.id, query)).map((row) => row.id),
        query,
      ).toEqual([order.id]);
    }
  });

  it("viser høyst 50, nyeste først, og total stemmer med og uten søk", async () => {
    const { org, admin } = await orgWithAdmin();
    const base = Date.parse("2026-01-01T08:00:00Z");
    for (let index = 0; index < ORDER_LIST_LIMIT + 3; index += 1) {
      await insertOrder(org.id, {
        addressText: index % 2 === 0 ? `Partallsveien ${index}` : `Oddeveien ${index}`,
        receivedAt: new Date(base + index * 60_000),
      });
    }

    const all = await listOrders(admin, org.id);
    expect(all.items).toHaveLength(ORDER_LIST_LIMIT);
    expect(all.total).toBe(ORDER_LIST_LIMIT + 3);
    expect(all.items[0]?.addressText).toBe(`Partallsveien ${ORDER_LIST_LIMIT + 2}`);
    const times = all.items.map((row) => row.receivedAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));

    const even = await listOrders(admin, org.id, { query: "partallsveien" });
    expect(even.total).toBe(27);
    expect(even.items).toHaveLength(27);
  });

  it("orderListSummary gir meldingen bare når listen er kuttet", () => {
    expect(orderListSummary(50, 50)).toBeNull();
    expect(orderListSummary(3, 3)).toBeNull();
    expect(orderListSummary(50, 73)).toBe("Viser 50 av 73. Bruk søket for å finne flere.");
  });

  it("søket lager ingen rader i revisjonsloggen, hendelsene eller KI-loggen", async () => {
    const { org, admin } = await orgWithAdmin();
    await searchableOrder(org.id);
    const counts = async () => {
      const [ai] = await db.select({ n: count() }).from(aiUsageLog);
      return [await rowCount(auditLog), await rowCount(events), ai?.n ?? 0];
    };
    const before = await counts();
    await listOrders(admin, org.id, { query: "Partisen" });
    await listOrders(admin, org.id, { query: "12/34" });
    expect(await counts()).toEqual(before);
  });

  it("tenant-isolasjon: samme tekst i A og B gir bare A sine ordre", async () => {
    for (const query of [
      "Partisen",
      "Fiktiv",
      "Søkeveien",
      "Eiendomsgata",
      "MEGL-4711",
      "Bestillersen",
      "77/88",
      "41/7",
    ]) {
      await expectTenantIsolation({
        seed: async (grantA, grantB) => {
          const a = await searchableOrder(grantA.organizationId);
          const b = await searchableOrder(grantB.organizationId);
          return { a: [a.order.id], b: [b.order.id] };
        },
        query: (actor, organizationId) => listOrderItems(actor, organizationId, query),
        idOf: (row) => row.id,
      });
    }
  });

  it("tenant-isolasjon: eiendom og matrikkel i B gir ikke treff i A, og B får ikke tilgang", async () => {
    const { org: orgA, admin: adminA } = await orgWithAdmin("Testfirma A");
    const { org: orgB, admin: adminB } = await orgWithAdmin("Testfirma B");
    const { assignment } = await insertConvertedOrder(orgA.id, { addressText: "Aveien 1" });

    // Partsraden i B kan ikke peke på oppdraget i A (sammensatt fremmednøkkel i databasen).
    await expect(
      createAssignmentParty(orgB.id, { assignmentId: assignment.id, name: "Fremmed Navn" }),
    ).rejects.toThrow();
    await createProperty(orgB.id, { address: "Fremmedveien 5", gnr: "91", bnr: "92" });

    for (const query of ["Fremmed Navn", "Fremmedveien", "91/92"]) {
      expect((await listOrders(adminA, orgA.id, { query })).total, query).toBe(0);
    }
    await expect(listOrders(adminB, orgA.id, { query: "Aveien" })).rejects.toThrow(
      AccessDeniedError,
    );
  });
});
