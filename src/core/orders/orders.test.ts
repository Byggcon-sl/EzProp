import { randomUUID } from "node:crypto";
import { and, asc, count, eq } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { AccessDeniedError, type Actor } from "@/core/access";
import { db } from "@/db/client";
import {
  assignments,
  auditLog,
  employees,
  events,
  numberSequences,
  offices,
  orders,
  organizations,
  type EmployeeRole,
} from "@/db/schema";
import {
  createAssignment,
  createEmployee,
  createOffice,
  createOrder as insertOrder,
  createOrganization,
  createUser,
  grantPermission,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import {
  convertOrderToAssignment,
  createOrder,
  getOrder,
  listOrders,
  OfficeNotFoundError,
  OrderAlreadyHandledError,
  rejectOrder,
} from "./index";

/*
 * Ordre og konvertering til oppdrag (testplan docs/funksjoner/fase2a-manuell-ordre-testplan.md
 * avsnitt 4, med runde 1 og 2). Ekte hendelses- og loggmoduler, ingen mock; 4.6.5 (feil i
 * hendelsen ruller tilbake alt) står i orders-transaction.test.ts. Testdata er oppdiktet.
 * Støtter hovedmål: reklamasjoner (tenant-isolasjon, statusreglene, aldri to like numre, alt
 * logges uten personopplysninger) og KI først (`source = manual` settes alltid av kjernen).
 */

beforeEach(resetDatabase);

const NOW = new Date("2026-11-03T10:00:00Z");
const ADDRESS = "Testveien 12, 8000 Bodø";
const ORDERED_BY = "Megler Testesen, Testmegleren AS";
const HOUSING = "Testtoppen borettslag";
const EXTERNAL_REF = "TEST-ORD-0001";

type CreateInput = Parameters<typeof createOrder>[2];

function fullInput(overrides: Record<string, unknown> = {}): CreateInput {
  return {
    addressText: ADDRESS,
    receivedAt: "2026-11-02T08:30:00.000Z",
    externalRef: EXTERNAL_REF,
    orderedByText: ORDERED_BY,
    gnr: "12",
    bnr: "34",
    snr: "5",
    housingAssociationName: HOUSING,
    sellerDeclarationReceived: true,
    ...overrides,
  } as CreateInput;
}

async function setInspectorsEditAll(organizationId: string, value: boolean) {
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": value } })
    .where(eq(organizations.id, organizationId));
}

/** En person ansatt i organisasjonen med rollene. Oppdiktet navn. */
async function person(organizationId: string, roles: EmployeeRole[], name = "Test Ansatt") {
  const actor = await createUser({ name });
  const employee = await createEmployee(actor, organizationId, roles);
  return { actor, employee };
}

async function setup(name = "Testfirma takst") {
  const org = await createOrganization(name);
  const office = await createOffice(org.id);
  const { actor: admin, employee } = await person(org.id, ["admin"], "Test Admin");
  return { org, office, admin, employee };
}

/** En ordre som er gjort om, med et ekte oppdrag (fabrikken teller TEST-0000N). */
async function convertedOrder(organizationId: string) {
  const order = await insertOrder(organizationId);
  const assignment = await createAssignment(organizationId, { orderId: order.id });
  const [converted] = await db
    .update(orders)
    .set({ status: "converted", assignmentId: assignment.id })
    .where(eq(orders.id, order.id))
    .returning();
  return { order: converted!, assignment };
}

async function rowCount(table: PgTable) {
  const [row] = await db.select({ n: count() }).from(table);
  return row!.n;
}

/** Antall rader i tabellene en endring kan røre. */
async function counts() {
  return {
    orders: await rowCount(orders),
    assignments: await rowCount(assignments),
    events: await rowCount(events),
    auditLog: await rowCount(auditLog),
    numberSequences: await rowCount(numberSequences),
  };
}

async function orderRow(id: string) {
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  return row!;
}

async function eventsFor(organizationId: string) {
  return db
    .select()
    .from(events)
    .where(eq(events.organizationId, organizationId))
    .orderBy(asc(events.occurredAt), asc(events.createdAt));
}

async function auditFor(organizationId: string) {
  return db
    .select()
    .from(auditLog)
    .where(eq(auditLog.organizationId, organizationId))
    .orderBy(asc(auditLog.receivedAt), asc(auditLog.createdAt));
}

async function sequenceRows(organizationId: string) {
  return db
    .select()
    .from(numberSequences)
    .where(eq(numberSequences.organizationId, organizationId));
}

function numbers(from: number, to: number) {
  return Array.from(
    { length: to - from + 1 },
    (_, i) => `2026-${String(from + i).padStart(5, "0")}`,
  );
}

// 4.1 Tilgang per rolle

type RoleCase = { label: string; roles: EmployeeRole[]; editAll: boolean; canEdit: boolean };

const ROLE_CASES: RoleCase[] = [
  { label: "takstmann, innstillingen på", roles: ["inspector"], editAll: true, canEdit: true },
  { label: "takstmann, innstillingen av", roles: ["inspector"], editAll: false, canEdit: false },
  { label: "kontor", roles: ["office"], editAll: false, canEdit: true },
  { label: "leder", roles: ["manager"], editAll: false, canEdit: true },
  { label: "admin", roles: ["admin"], editAll: false, canEdit: true },
];

describe("4.1 tilgang per rolle", () => {
  it.each(ROLE_CASES)("4.1.1 $label kan se ordrene (listOrders)", async ({ roles, editAll }) => {
    const org = await createOrganization();
    await setInspectorsEditAll(org.id, editAll);
    const order = await insertOrder(org.id);
    const { actor } = await person(org.id, roles);

    const rows = await listOrders(actor, org.id);
    expect(rows.map((row) => row.id)).toEqual([order.id]);
    expect((await getOrder(actor, org.id, order.id)).id).toBe(order.id);
  });

  it.each(ROLE_CASES)(
    "4.1.2 $label: legge inn (createOrder) er tillatt = $canEdit",
    async ({ roles, editAll, canEdit }) => {
      const org = await createOrganization();
      await setInspectorsEditAll(org.id, editAll);
      const { actor } = await person(org.id, roles);
      const before = await counts();

      const attempt = createOrder(actor, org.id, fullInput(), NOW);
      if (canEdit) {
        const row = await attempt;
        expect(row.organizationId).toBe(org.id);
        expect(row.status).toBe("received");
      } else {
        await expect(attempt).rejects.toThrow(AccessDeniedError);
        expect(await counts()).toEqual(before);
      }
    },
  );

  it("4.1.2 takstmann med innstillingen av får ikke avvist eller gjort om; ingenting endres", async () => {
    const { org, office } = await setup();
    await setInspectorsEditAll(org.id, false);
    const order = await insertOrder(org.id);
    const { actor } = await person(org.id, ["inspector"]);
    const before = await counts();
    const rowBefore = await orderRow(order.id);

    await expect(rejectOrder(actor, org.id, order.id, "Feil registrering")).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(
      convertOrderToAssignment(actor, org.id, order.id, { officeId: office.id, now: NOW }),
    ).rejects.toThrow(AccessDeniedError);

    expect(await counts()).toEqual(before);
    expect(await orderRow(order.id)).toEqual(rowBefore);
    expect(await sequenceRows(org.id)).toEqual([]);
  });

  it("4.1.3 takstmann med innstillingen av og enkeltrettigheten assignment.edit kan alle tre", async () => {
    const { org, office } = await setup();
    await setInspectorsEditAll(org.id, false);
    const { actor, employee } = await person(org.id, ["inspector"]);
    await grantPermission(employee, "assignment.edit");

    const first = await createOrder(actor, org.id, fullInput(), NOW);
    const second = await createOrder(actor, org.id, fullInput(), NOW);
    expect((await rejectOrder(actor, org.id, first.id, "Feil registrering")).status).toBe(
      "rejected",
    );
    const result = await convertOrderToAssignment(actor, org.id, second.id, {
      officeId: office.id,
      now: NOW,
    });
    expect(result.assignment.number).toBe("2026-00001");
  });

  it.each([
    ["ingen ansattrad", "none"],
    ["deaktivert ansatt", "deactivated"],
    ["slettet ansatt", "deleted"],
  ] as const)("4.1.4 %s får AccessDeniedError på listOrders og createOrder", async (_l, kind) => {
    const org = await createOrganization();
    await insertOrder(org.id);
    let actor: Actor;
    if (kind === "none") {
      actor = await createUser();
    } else {
      const created = await person(org.id, ["admin"]);
      actor = created.actor;
      await db
        .update(employees)
        .set(kind === "deactivated" ? { deactivatedAt: new Date() } : { deletedAt: new Date() })
        .where(eq(employees.id, created.employee.id));
    }
    const before = await counts();

    await expect(listOrders(actor, org.id)).rejects.toThrow(AccessDeniedError);
    await expect(createOrder(actor, org.id, fullInput(), NOW)).rejects.toThrow(AccessDeniedError);
    expect(await counts()).toEqual(before);
  });

  // Regel 11: admin stenges aldri ute. Denne testen skal aldri fjernes.
  it("4.1.5 ADMIN STENGES ALDRI UTE: admin uten andre roller og med innstillingen av kan alt", async () => {
    const org = await createOrganization();
    const office = await createOffice(org.id);
    await setInspectorsEditAll(org.id, false);
    const { actor: admin } = await person(org.id, ["admin"], "Test Admin");

    const first = await createOrder(admin, org.id, fullInput(), NOW);
    const second = await createOrder(admin, org.id, fullInput(), NOW);
    expect((await listOrders(admin, org.id)).length).toBe(2);
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

// 4.2 Tenant-isolasjon (ett expectTenantIsolation per funksjon)

describe("4.2 tenant-isolasjon", () => {
  it("4.2.1 listOrders gir aldri ordre eller oppdragsnummer fra en annen organisasjon", async () => {
    const answers = new Map<string, Awaited<ReturnType<typeof listOrders>>>();
    const numberOf = new Map<string, string>();
    let deletedId = "";

    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await convertedOrder(grantA.organizationId);
        const aOpen = await insertOrder(grantA.organizationId);
        const aDeleted = await insertOrder(grantA.organizationId, { deletedAt: new Date() });
        const b = await convertedOrder(grantB.organizationId);
        deletedId = aDeleted.id;
        numberOf.set(grantA.organizationId, a.assignment.number);
        numberOf.set(grantB.organizationId, b.assignment.number);
        return { a: [a.order.id, aOpen.id], b: [b.order.id] };
      },
      query: async (actor, organizationId) => {
        const rows = await listOrders(actor, organizationId);
        answers.set(organizationId, rows);
        return rows;
      },
      idOf: (row) => row.id,
    });

    const [orgA, orgB] = [...numberOf.keys()] as [string, string];
    const numberA = numberOf.get(orgA)!;
    const numberB = numberOf.get(orgB)!;
    expect(numberA).not.toBe(numberB);
    const rowsA = answers.get(orgA)!;
    const rowsB = answers.get(orgB)!;
    expect(rowsA.map((row) => row.assignmentNumber).filter(Boolean)).toEqual([numberA]);
    expect(rowsB.map((row) => row.assignmentNumber)).toEqual([numberB]);
    expect(JSON.stringify(rowsA)).not.toContain(numberB);
    expect(JSON.stringify(rowsB)).not.toContain(numberA);
    expect(rowsA.map((row) => row.id)).not.toContain(deletedId);
  });

  it("4.2.2 getOrder gir aldri ordren eller oppdragsnummeret til en annen organisasjon", async () => {
    const orderOf = new Map<string, string>();
    const numberOf = new Map<string, string>();
    const answers = new Map<string, Awaited<ReturnType<typeof getOrder>>>();

    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await convertedOrder(grantA.organizationId);
        const b = await convertedOrder(grantB.organizationId);
        orderOf.set(grantA.organizationId, a.order.id);
        orderOf.set(grantB.organizationId, b.order.id);
        numberOf.set(grantA.organizationId, a.assignment.number);
        numberOf.set(grantB.organizationId, b.assignment.number);
        return { a: [a.order.id], b: [b.order.id] };
      },
      query: async (actor, organizationId) => {
        // Ordren som hører til organisasjonen; ukjent organisasjon får en tilfeldig id
        const row = await getOrder(
          actor,
          organizationId,
          orderOf.get(organizationId) ?? randomUUID(),
        );
        answers.set(organizationId, row);
        return [row];
      },
      idOf: (row) => row.id,
    });

    for (const [organizationId, row] of answers) {
      expect(row.assignmentNumber).toBe(numberOf.get(organizationId));
      for (const [otherId, otherNumber] of numberOf) {
        if (otherId !== organizationId) expect(JSON.stringify(row)).not.toContain(otherNumber);
      }
    }
  });

  it("4.2.3 createOrder legger alltid ordren i organisasjonen fra tilgangssjekken", async () => {
    const orgIds: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgIds.push(grantA.organizationId, grantB.organizationId);
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor, organizationId) => [
        await createOrder(actor, organizationId, fullInput(), NOW),
      ],
      idOf: (row) => row.organizationId,
    });

    const orgB = orgIds[1]!;
    const ordersB = await db.select().from(orders).where(eq(orders.organizationId, orgB));
    expect(ordersB).toHaveLength(1);
    expect(await rowCount(orders)).toBe(2);
    // Alle hendelser og loggrader om ordren i B står i B
    for (const event of await db.select().from(events)) {
      const orderId = (event.data as Record<string, unknown>).orderId;
      const [owner] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, String(orderId)));
      expect(event.organizationId).toBe(owner!.organizationId);
    }
    for (const row of await db.select().from(auditLog)) {
      const [owner] = await db.select().from(orders).where(eq(orders.id, row.entityId));
      expect(row.organizationId).toBe(owner!.organizationId);
    }
    expect((await eventsFor(orgB)).length).toBe(1);
    expect((await auditFor(orgB)).length).toBe(1);
  });

  it("4.2.4 rejectOrder avviser bare ordren i egen organisasjon", async () => {
    const orderOf = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await insertOrder(grantA.organizationId);
        const b = await insertOrder(grantB.organizationId);
        orderOf.set(grantA.organizationId, a.id);
        orderOf.set(grantB.organizationId, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => [
        await rejectOrder(
          actor,
          organizationId,
          orderOf.get(organizationId) ?? randomUUID(),
          "Feil registrering",
        ),
      ],
      idOf: (row) => row.id,
    });

    for (const [organizationId, orderId] of orderOf) {
      const row = await orderRow(orderId);
      expect(row.status).toBe("rejected");
      expect(row.rowVersion).toBe(2); // avvist nøyaktig én gang, ikke rørt av den andre
      const rejects = (await auditFor(organizationId)).filter((r) => r.action === "reject");
      expect(rejects).toHaveLength(1);
      expect(rejects[0]!.entityId).toBe(orderId);
    }
  });

  it("4.2.5 convertOrderToAssignment lager oppdrag og serie bare i egen organisasjon", async () => {
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
        const own = seeded.get(organizationId);
        const result = await convertOrderToAssignment(
          actor,
          organizationId,
          own?.orderId ?? randomUUID(),
          { officeId: own?.officeId ?? randomUUID(), now: NOW },
        );
        return [{ id: result.order.id }];
      },
      idOf: (row) => row.id,
    });

    for (const [organizationId, { orderId, officeId }] of seeded) {
      const rows = await db
        .select()
        .from(assignments)
        .where(eq(assignments.organizationId, organizationId));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ number: "2026-00001", orderId, officeId });
      const series = await sequenceRows(organizationId);
      expect(series).toHaveLength(1);
      expect(series[0]!.nextValue).toBe(2);
    }
  });
});

// 4.3 Fremmed id i egen organisasjon (regel 2)

describe("4.3 fremmed, ukjent og slettet id", () => {
  it("4.3.1 ordre-id fra B gir AccessDeniedError, og ingenting skrives", async () => {
    const a = await setup("Organisasjon A");
    const b = await setup("Organisasjon B");
    const orderB = await insertOrder(b.org.id);
    const before = await counts();

    await expect(getOrder(a.admin, a.org.id, orderB.id)).rejects.toThrow(AccessDeniedError);
    await expect(rejectOrder(a.admin, a.org.id, orderB.id, "Feil registrering")).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(
      convertOrderToAssignment(a.admin, a.org.id, orderB.id, { officeId: a.office.id, now: NOW }),
    ).rejects.toThrow(AccessDeniedError);

    expect((await orderRow(orderB.id)).status).toBe("received");
    expect(await counts()).toEqual(before);
  });

  it("4.3.2 kontor fra B gir OfficeNotFoundError; ingen oppdrag, serie eller hendelse", async () => {
    const a = await setup("Organisasjon A");
    const b = await setup("Organisasjon B");
    const order = await insertOrder(a.org.id);
    const before = await counts();

    await expect(
      convertOrderToAssignment(a.admin, a.org.id, order.id, { officeId: b.office.id, now: NOW }),
    ).rejects.toThrow(OfficeNotFoundError);

    expect((await orderRow(order.id)).status).toBe("received");
    expect(await counts()).toEqual(before);
    expect(await sequenceRows(a.org.id)).toEqual([]);
  });

  it("4.3.3 slettet kontor i egen organisasjon gir OfficeNotFoundError", async () => {
    const { org, admin, office } = await setup();
    await db.update(offices).set({ deletedAt: new Date() }).where(eq(offices.id, office.id));
    const order = await insertOrder(org.id);

    await expect(
      convertOrderToAssignment(admin, org.id, order.id, { officeId: office.id, now: NOW }),
    ).rejects.toThrow(OfficeNotFoundError);
    expect(await sequenceRows(org.id)).toEqual([]);
  });

  it.each([
    ["tilfeldig uuid", randomUUID()],
    ["ikke en id", "ikke-en-id"],
  ])("4.3.4 %s som ordre-id gir AccessDeniedError, aldri databasefeil", async (_l, id) => {
    const { org, admin, office } = await setup();
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
  ])("4.3.4 %s som kontor-id gir OfficeNotFoundError, aldri databasefeil", async (_l, id) => {
    const { org, admin } = await setup();
    const order = await insertOrder(org.id);
    await expect(
      convertOrderToAssignment(admin, org.id, order.id, { officeId: id, now: NOW }),
    ).rejects.toThrow(OfficeNotFoundError);
    expect((await orderRow(order.id)).status).toBe("received");
  });

  it("4.3.5 slettet ordre gir AccessDeniedError og står ikke i listen", async () => {
    const { org, admin, office } = await setup();
    const order = await insertOrder(org.id, { deletedAt: new Date() });

    await expect(getOrder(admin, org.id, order.id)).rejects.toThrow(AccessDeniedError);
    await expect(rejectOrder(admin, org.id, order.id, "Feil registrering")).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(
      convertOrderToAssignment(admin, org.id, order.id, { officeId: office.id, now: NOW }),
    ).rejects.toThrow(AccessDeniedError);
    expect(await listOrders(admin, org.id)).toEqual([]);
    expect((await orderRow(order.id)).status).toBe("received");
  });
});

// 4.4 Legge inn og liste

describe("4.4 legge inn og liste", () => {
  it("4.4.1 createOrder lagrer alle feltene; organisasjonen kommer fra tilgangssjekken", async () => {
    const a = await setup("Organisasjon A");
    const b = await setup("Organisasjon B");

    const row = await createOrder(
      a.admin,
      a.org.id,
      fullInput({ organizationId: b.org.id, source: "email", requestedReportType: "bolig" }),
      NOW,
    );

    expect(row).toMatchObject({
      organizationId: a.org.id,
      addressText: ADDRESS,
      externalRef: EXTERNAL_REF,
      orderedByText: ORDERED_BY,
      gnr: "12",
      bnr: "34",
      snr: "5",
      housingAssociationName: HOUSING,
      sellerDeclarationReceived: true,
      source: "manual",
      requestedReportType: "condition_report",
      status: "received",
      rejectedReason: null,
      assignmentId: null,
      createdBy: a.employee.id,
      deletedAt: null,
    });
    expect(row.receivedAt.toISOString()).toBe("2026-11-02T08:30:00.000Z");
    expect(await db.select().from(orders).where(eq(orders.organizationId, b.org.id))).toEqual([]);
  });

  it("4.4.2 minimal ordre: bare adresse gir tomme valgfrie felt, nei og mottatt = now", async () => {
    const { org, admin } = await setup();
    const row = await createOrder(admin, org.id, { addressText: ADDRESS }, NOW);

    expect(row).toMatchObject({
      externalRef: null,
      orderedByText: null,
      gnr: null,
      bnr: null,
      snr: null,
      housingAssociationName: null,
      sellerDeclarationReceived: false,
      source: "manual",
      status: "received",
    });
    expect(row.receivedAt.getTime()).toBe(NOW.getTime());
  });

  it.each([
    ["tom adresse", { addressText: "" }],
    ["gnr med bokstav", { gnr: "12a" }],
    ["mottatt frem i tid", { receivedAt: "2026-11-03T10:01:00.000Z" }],
    ["fødselsnummer hos bestiller", { orderedByText: "Ola 12345678901" }],
  ])(
    "4.4.3 valideringsfeil (%s) gir ZodError, ingen rad, hendelse eller loggrad",
    async (_l, o) => {
      const { org, admin } = await setup();
      const before = await counts();

      await expect(createOrder(admin, org.id, fullInput(o), NOW)).rejects.toThrow(ZodError);
      expect(await counts()).toEqual(before);
    },
  );

  it("4.4.4 listOrders: nyeste mottatt først, slettede aldri med, nummer bare for konverterte", async () => {
    const { org, admin } = await setup();
    const old = await insertOrder(org.id, { receivedAt: new Date("2026-10-01T08:00:00Z") });
    const newest = await insertOrder(org.id, { receivedAt: new Date("2026-11-03T09:00:00Z") });
    const middle = await convertedOrder(org.id);
    await db
      .update(orders)
      .set({ receivedAt: new Date("2026-10-15T08:00:00Z") })
      .where(eq(orders.id, middle.order.id));
    await insertOrder(org.id, {
      deletedAt: new Date(),
      receivedAt: new Date("2026-11-03T09:30:00Z"),
    });

    const rows = await listOrders(admin, org.id);
    expect(rows.map((row) => row.id)).toEqual([newest.id, middle.order.id, old.id]);
    expect(rows.map((row) => row.assignmentNumber)).toEqual([null, middle.assignment.number, null]);
    expect(rows[1]!.assignmentId).toBe(middle.assignment.id);
  });

  it("4.4.4 tom organisasjon gir tom liste (skjermen viser «Ingen ordre er lagt inn ennå.»)", async () => {
    const { org, admin } = await setup();
    expect(await listOrders(admin, org.id)).toEqual([]);
  });

  it("4.4.5 listOrders og getOrder gir faste feltlister uten sporingsfelt", async () => {
    const { org, admin } = await setup();
    const order = await insertOrder(org.id);

    const [listed] = await listOrders(admin, org.id);
    expect(Object.keys(listed!).sort()).toEqual(
      [
        "addressText",
        "assignmentId",
        "assignmentNumber",
        "externalRef",
        "id",
        "orderedByText",
        "receivedAt",
        "source",
        "status",
      ].sort(),
    );

    const one = await getOrder(admin, org.id, order.id);
    expect(Object.keys(one).sort()).toEqual(
      [
        "addressText",
        "assignmentId",
        "assignmentNumber",
        "bnr",
        "externalRef",
        "gnr",
        "housingAssociationName",
        "id",
        "orderedByText",
        "receivedAt",
        "rejectedReason",
        "requestedReportType",
        "sellerDeclarationReceived",
        "snr",
        "source",
        "status",
      ].sort(),
    );
    for (const key of ["organizationId", "deletedAt", "deletedBy", "rowVersion", "createdBy"]) {
      expect(Object.keys(one)).not.toContain(key);
    }
  });
});

// 4.5 Avvise og gjøre om (statusreglene som data)

describe("4.5 avvise og gjøre om", () => {
  it("4.5.1 rejectOrder fra received: avvist med trimmet grunn, ikke slettet, fortsatt i listen", async () => {
    const { org, admin } = await setup();
    const order = await insertOrder(org.id);

    const row = await rejectOrder(admin, org.id, order.id, "  Feil registrering  ");

    expect(row).toMatchObject({
      status: "rejected",
      rejectedReason: "Feil registrering",
      assignmentId: null,
      deletedAt: null,
    });
    const listed = await listOrders(admin, org.id);
    expect(listed.map((r) => [r.id, r.status])).toEqual([[order.id, "rejected"]]);
    expect((await getOrder(admin, org.id, order.id)).rejectedReason).toBe("Feil registrering");
  });

  it("4.5.1 tom grunn gir ZodError og ingen endring", async () => {
    const { org, admin } = await setup();
    const order = await insertOrder(org.id);
    const before = await counts();

    await expect(rejectOrder(admin, org.id, order.id, "   ")).rejects.toThrow(ZodError);
    expect((await orderRow(order.id)).status).toBe("received");
    expect(await counts()).toEqual(before);
  });

  it("4.5.2 convertOrderToAssignment fra received: oppdrag 2026-00001, kobling begge veier", async () => {
    const { org, admin, office } = await setup();
    const order = await insertOrder(org.id, { externalRef: EXTERNAL_REF });

    const result = await convertOrderToAssignment(admin, org.id, order.id, {
      officeId: office.id,
      now: NOW,
    });

    expect(Object.keys(result.assignment).sort()).toEqual(
      ["id", "number", "officeId", "orderId", "status"].sort(),
    );
    expect(result.assignment).toMatchObject({
      number: "2026-00001",
      status: "ordered",
      officeId: office.id,
      orderId: order.id,
    });
    expect(result.order).toMatchObject({
      id: order.id,
      status: "converted",
      assignmentId: result.assignment.id,
    });

    const [stored] = await db
      .select()
      .from(assignments)
      .where(eq(assignments.id, result.assignment.id));
    expect(stored).toMatchObject({
      organizationId: org.id,
      number: "2026-00001",
      status: "ordered",
      assignmentType: "condition_report",
      officeId: office.id,
      orderId: order.id,
      deletedAt: null,
    });
    expect((await orderRow(order.id)).assignmentId).toBe(result.assignment.id);
    expect((await getOrder(admin, org.id, order.id)).assignmentNumber).toBe("2026-00001");
  });

  it.each([
    { from: "converted", action: "reject" },
    { from: "converted", action: "convert" },
    { from: "rejected", action: "reject" },
    { from: "rejected", action: "convert" },
  ] as const)(
    "4.5.3 fra $from gir $action OrderAlreadyHandledError og ingen endring",
    async ({ from, action }) => {
      const { org, admin, office } = await setup();
      const order = await insertOrder(org.id);
      if (from === "converted") {
        await convertOrderToAssignment(admin, org.id, order.id, { officeId: office.id, now: NOW });
      } else {
        await rejectOrder(admin, org.id, order.id, "Feil registrering");
      }
      const before = await counts();
      const rowBefore = await orderRow(order.id);
      const seriesBefore = await sequenceRows(org.id);

      const attempt =
        action === "reject"
          ? rejectOrder(admin, org.id, order.id, "Ny grunn")
          : convertOrderToAssignment(admin, org.id, order.id, { officeId: office.id, now: NOW });
      await expect(attempt).rejects.toThrow(OrderAlreadyHandledError);
      await expect(attempt).rejects.toThrow("Ordren er allerede behandlet.");

      const rowAfter = await orderRow(order.id);
      expect(rowAfter.updatedAt.getTime()).toBe(rowBefore.updatedAt.getTime());
      expect(rowAfter.rowVersion).toBe(rowBefore.rowVersion);
      expect(rowAfter).toEqual(rowBefore);
      expect(await counts()).toEqual(before);
      expect(await sequenceRows(org.id)).toEqual(seriesBefore);
    },
  );

  it("4.5.4 to samtidige konverteringer av samme ordre gir ett oppdrag, og taperen bruker ikke et nummer", async () => {
    const { org, admin, office } = await setup();
    const order = await insertOrder(org.id);
    const convert = () =>
      convertOrderToAssignment(admin, org.id, order.id, { officeId: office.id, now: NOW });

    const results = await Promise.allSettled([convert(), convert()]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(OrderAlreadyHandledError);
    expect(await rowCount(assignments)).toBe(1);
    const series = await sequenceRows(org.id);
    expect(series).toHaveLength(1);
    expect(series[0]!.nextValue).toBe(2);
  });

  it(
    "4.5.5 tjue samtidige konverteringer av tjue ordre gir 00001–00020 og next_value 21",
    { timeout: 30_000 },
    async () => {
      const { org, admin, office } = await setup();
      const created = [];
      for (let i = 0; i < 20; i += 1) created.push(await insertOrder(org.id));

      const results = await Promise.all(
        created.map((order) =>
          convertOrderToAssignment(admin, org.id, order.id, { officeId: office.id, now: NOW }),
        ),
      );

      expect(results.map((r) => r.assignment.number).sort()).toEqual(numbers(1, 20));
      const rows = await db.select().from(orders).where(eq(orders.organizationId, org.id));
      expect(rows.every((row) => row.status === "converted")).toBe(true);
      expect(new Set(rows.map((row) => row.assignmentId)).size).toBe(20);
      expect(await rowCount(assignments)).toBe(20);
      expect((await sequenceRows(org.id))[0]!.nextValue).toBe(21);
    },
  );

  it("4.5.6 årsskiftet via now: 31.12.2026 23:30 UTC gir 2027-00001 etter 2026-00001", async () => {
    const { org, admin, office } = await setup();
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
    const series = (await sequenceRows(org.id)).map((row) => [row.prefix, row.nextValue]).sort();
    expect(series).toEqual([
      ["2026-", 2],
      ["2027-", 2],
    ]);
  });

  it("4.5.7 to organisasjoner får begge 2026-00001", async () => {
    const a = await setup("Organisasjon A");
    const b = await setup("Organisasjon B");
    const orderA = await insertOrder(a.org.id);
    const orderB = await insertOrder(b.org.id);

    const ra = await convertOrderToAssignment(a.admin, a.org.id, orderA.id, {
      officeId: a.office.id,
      now: NOW,
    });
    const rb = await convertOrderToAssignment(b.admin, b.org.id, orderB.id, {
      officeId: b.office.id,
      now: NOW,
    });
    expect([ra.assignment.number, rb.assignment.number]).toEqual(["2026-00001", "2026-00001"]);
  });
});

// 4.6 Hendelser og revisjonslogg i samme transaksjon (4.6.5 i orders-transaction.test.ts)

/** Hendelser og logg skal aldri ha adresse, bestiller, matrikkel eller borettslag. */
function expectNoPersonalData(value: unknown) {
  const text = JSON.stringify(value);
  for (const forbidden of [ADDRESS, "Testveien", ORDERED_BY, "Testesen", HOUSING, EXTERNAL_REF]) {
    expect(text).not.toContain(forbidden);
  }
  expect(text).not.toMatch(/"(gnr|bnr|snr|addressText|orderedByText)"/);
}

describe("4.6 hendelser og revisjonslogg", () => {
  it("4.6.1 createOrder skriver order.received og loggraden create, uten personopplysninger", async () => {
    const { org, admin, employee } = await setup();
    const row = await createOrder(admin, org.id, fullInput(), NOW);

    const rows = await eventsFor(org.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "order.received",
      actorType: "employee",
      actorId: employee.id,
      assignmentId: null,
      data: { orderId: row.id, source: "manual" },
    });
    expect(rows[0]!.data).toEqual({ orderId: row.id, source: "manual" });

    const audit = await auditFor(org.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ entityType: "order", action: "create", entityId: row.id });
    expect(audit[0]!.changes).toEqual({
      status: "received",
      source: "manual",
      requestedReportType: "condition_report",
    });
    expectNoPersonalData([rows, audit.map((r) => r.changes)]);
  });

  it("4.6.2 rejectOrder skriver order.rejected uten grunnen; grunnen står i loggen", async () => {
    const { org, admin } = await setup();
    const order = await insertOrder(org.id, {
      orderedByText: ORDERED_BY,
      housingAssociationName: HOUSING,
      gnr: "12",
    });

    await rejectOrder(admin, org.id, order.id, "Feil registrering");

    const rows = await eventsFor(org.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "order.rejected", assignmentId: null });
    expect(rows[0]!.data).toEqual({ orderId: order.id });

    const audit = await auditFor(org.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ entityType: "order", action: "reject", entityId: order.id });
    expect(audit[0]!.changes).toEqual({
      status: { from: "received", to: "rejected" },
      rejectedReason: "Feil registrering",
    });
    expectNoPersonalData([rows, audit.map((r) => r.changes)]);
  });

  it("4.6.3 konvertering skriver assignment.created og to loggrader (order/convert, assignment/create)", async () => {
    const { org, admin, office } = await setup();
    const order = await insertOrder(org.id, {
      orderedByText: ORDERED_BY,
      housingAssociationName: HOUSING,
      gnr: "12",
    });

    const { assignment } = await convertOrderToAssignment(admin, org.id, order.id, {
      officeId: office.id,
      now: NOW,
    });

    const rows = await eventsFor(org.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "assignment.created", assignmentId: assignment.id });
    expect(rows[0]!.data).toEqual({ number: "2026-00001", orderId: order.id });

    const audit = await auditFor(org.id);
    expect(audit).toHaveLength(2);
    const convert = audit.find((r) => r.entityType === "order");
    const create = audit.find((r) => r.entityType === "assignment");
    expect(convert).toMatchObject({ action: "convert", entityId: order.id });
    expect(convert!.changes).toEqual({
      status: { from: "received", to: "converted" },
      assignmentId: assignment.id,
      number: "2026-00001",
    });
    expect(create).toMatchObject({ action: "create", entityId: assignment.id });
    expect(create!.changes).toEqual({
      number: "2026-00001",
      status: "ordered",
      officeId: office.id,
    });
    expectNoPersonalData([rows, audit.map((r) => r.changes)]);
  });

  it("4.6.4 ingen hendelse ved avvist tilgang, valideringsfeil eller OrderAlreadyHandledError", async () => {
    const { org, admin, office } = await setup();
    await setInspectorsEditAll(org.id, false);
    const { actor: inspector } = await person(org.id, ["inspector"]);
    const order = await insertOrder(org.id);

    await expect(createOrder(inspector, org.id, fullInput(), NOW)).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(createOrder(admin, org.id, fullInput({ addressText: "" }), NOW)).rejects.toThrow(
      ZodError,
    );
    await expect(rejectOrder(admin, org.id, order.id, "")).rejects.toThrow(ZodError);
    expect(await eventsFor(org.id)).toEqual([]);
    expect(await auditFor(org.id)).toEqual([]);

    await rejectOrder(admin, org.id, order.id, "Feil registrering");
    const eventsBefore = (await eventsFor(org.id)).length;
    const auditBefore = (await auditFor(org.id)).length;
    await expect(
      convertOrderToAssignment(admin, org.id, order.id, { officeId: office.id, now: NOW }),
    ).rejects.toThrow(OrderAlreadyHandledError);
    expect((await eventsFor(org.id)).length).toBe(eventsBefore);
    expect((await auditFor(org.id)).length).toBe(auditBefore);
  });

  it("4.6.6 events.assignment_id peker på et ekte oppdrag i samme organisasjon", async () => {
    const { org, admin, office } = await setup();
    const order = await insertOrder(org.id);
    const { assignment } = await convertOrderToAssignment(admin, org.id, order.id, {
      officeId: office.id,
      now: NOW,
    });

    const joined = await db
      .select({ number: assignments.number, eventOrg: events.organizationId })
      .from(events)
      .innerJoin(
        assignments,
        and(
          eq(assignments.id, events.assignmentId),
          eq(assignments.organizationId, events.organizationId),
        ),
      )
      .where(eq(events.organizationId, org.id));
    expect(joined).toEqual([{ number: assignment.number, eventOrg: org.id }]);
  });
});
