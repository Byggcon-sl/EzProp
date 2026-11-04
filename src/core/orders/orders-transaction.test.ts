import { count, eq } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireOrganizationAccess } from "@/core/access";
import { nextAssignmentNumber } from "@/core/assignments";
import { db } from "@/db/client";
import { assignments, auditLog, events, numberSequences, orders } from "@/db/schema";
import {
  createEmployee,
  createOffice,
  createOrder as insertOrder,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";

/*
 * Hendelser og revisjonslogg skrives i samme transaksjon som endringen (testplan
 * docs/funksjoner/fase2a-manuell-ordre-testplan.md 4.6.5, runde 2 punkt 3). `recordEvent` og
 * `recordAuditEvent` er pakket inn: de kaller den ekte funksjonen, og kaster bare der testen ber
 * om det. Feiler skrivingen, finnes verken ordre, oppdrag eller hendelse, og serien er uendret.
 * Ingen ny spørring her, så ingen tenant-test (den står i orders.test.ts).
 * Støtter hovedmål: reklamasjoner (ingen halve endringer uten spor i loggen).
 */

const mocks = vi.hoisted(() => ({
  recordEvent: vi.fn(),
  recordAuditEvent: vi.fn(),
}));

vi.mock("@/core/events", async () => {
  const actual = await vi.importActual<typeof import("@/core/events")>("@/core/events");
  mocks.recordEvent.mockImplementation(actual.recordEvent);
  return { ...actual, recordEvent: mocks.recordEvent };
});

vi.mock("@/core/audit", async () => {
  const actual = await vi.importActual<typeof import("@/core/audit")>("@/core/audit");
  mocks.recordAuditEvent.mockImplementation(actual.recordAuditEvent);
  return { ...actual, recordAuditEvent: mocks.recordAuditEvent };
});

const { convertOrderToAssignment, createOrder, rejectOrder } = await import("./index");

const NOW = new Date("2026-11-03T10:00:00Z");
const FAILURE = new Error("skrivingen feilet (test)");

function failOnce(mock: typeof mocks.recordEvent) {
  mock.mockImplementationOnce(async () => {
    throw FAILURE;
  });
}

async function rowCount(table: PgTable) {
  const [row] = await db.select({ n: count() }).from(table);
  return row!.n;
}

async function setup() {
  const org = await createOrganization();
  const office = await createOffice(org.id);
  const admin = await createUser({ name: "Test Admin" });
  await createEmployee(admin, org.id, ["admin"]);
  return { org, office, admin };
}

async function orderStatus(id: string) {
  const [row] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, id));
  return row?.status;
}

beforeEach(async () => {
  await resetDatabase();
  mocks.recordEvent.mockClear();
  mocks.recordAuditEvent.mockClear();
});

describe("4.6.5 feiler hendelsen eller loggen, finnes ingenting", () => {
  it("de ekte modulene brukes når testen ikke ber om feil", async () => {
    const { org, admin } = await setup();
    await createOrder(admin, org.id, { addressText: "Testveien 12, 8000 Bodø" }, NOW);
    expect(mocks.recordEvent).toHaveBeenCalledTimes(1);
    expect(mocks.recordAuditEvent).toHaveBeenCalledTimes(1);
    expect(await rowCount(events)).toBe(1);
    expect(await rowCount(auditLog)).toBe(1);
  });

  it("createOrder: recordEvent kaster → ingen ordre, ingen loggrad", async () => {
    const { org, admin } = await setup();
    failOnce(mocks.recordEvent);

    await expect(
      createOrder(admin, org.id, { addressText: "Testveien 12, 8000 Bodø" }, NOW),
    ).rejects.toThrow(FAILURE);

    expect(await rowCount(orders)).toBe(0);
    expect(await rowCount(events)).toBe(0);
    expect(await rowCount(auditLog)).toBe(0);
  });

  it("createOrder: recordAuditEvent kaster → ingen ordre, ingen hendelse", async () => {
    const { org, admin } = await setup();
    failOnce(mocks.recordAuditEvent);

    await expect(
      createOrder(admin, org.id, { addressText: "Testveien 12, 8000 Bodø" }, NOW),
    ).rejects.toThrow(FAILURE);

    expect(await rowCount(orders)).toBe(0);
    expect(await rowCount(events)).toBe(0);
  });

  it("convertOrderToAssignment: recordEvent kaster → ordren er mottatt, ingen oppdrag, ingen serie", async () => {
    const { org, office, admin } = await setup();
    const order = await insertOrder(org.id);
    failOnce(mocks.recordEvent);

    await expect(
      convertOrderToAssignment(admin, org.id, order.id, { officeId: office.id, now: NOW }),
    ).rejects.toThrow(FAILURE);

    expect(await orderStatus(order.id)).toBe("received");
    expect(await rowCount(assignments)).toBe(0);
    expect(await rowCount(numberSequences)).toBe(0);
    expect(await rowCount(events)).toBe(0);
    expect(await rowCount(auditLog)).toBe(0);
  });

  it("convertOrderToAssignment: siste loggrad kaster → serien står på samme next_value", async () => {
    const { org, office, admin } = await setup();
    // Serien finnes fra før (laget av en konvertering som lyktes)
    const grant = await requireOrganizationAccess(admin, org.id, "assignment.edit");
    await db.transaction((tx) => nextAssignmentNumber(tx, grant, "2026-11-03"));
    const [before] = await db.select().from(numberSequences);
    const order = await insertOrder(org.id);
    // Første loggrad (order/convert) skrives, andre (assignment/create) kaster
    const actual = await vi.importActual<typeof import("@/core/audit")>("@/core/audit");
    mocks.recordAuditEvent.mockImplementationOnce(actual.recordAuditEvent);
    failOnce(mocks.recordAuditEvent);

    await expect(
      convertOrderToAssignment(admin, org.id, order.id, { officeId: office.id, now: NOW }),
    ).rejects.toThrow(FAILURE);

    expect(mocks.recordAuditEvent).toHaveBeenCalledTimes(2);
    expect(await orderStatus(order.id)).toBe("received");
    expect(await rowCount(assignments)).toBe(0);
    expect(await rowCount(events)).toBe(0);
    expect(await rowCount(auditLog)).toBe(0);
    const [after] = await db.select().from(numberSequences);
    expect(after?.nextValue).toBe(before?.nextValue);
  });

  it("rejectOrder: recordAuditEvent kaster → ordren er mottatt, ingen hendelse", async () => {
    const { org, admin } = await setup();
    const order = await insertOrder(org.id);
    failOnce(mocks.recordAuditEvent);

    await expect(rejectOrder(admin, org.id, order.id, "Feil registrering")).rejects.toThrow(
      FAILURE,
    );

    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row).toMatchObject({ status: "received", rejectedReason: null });
    expect(await rowCount(events)).toBe(0);
    expect(await rowCount(auditLog)).toBe(0);
  });

  it("rejectOrder: recordEvent kaster → ordren er mottatt", async () => {
    const { org, admin } = await setup();
    const order = await insertOrder(org.id);
    failOnce(mocks.recordEvent);

    await expect(rejectOrder(admin, org.id, order.id, "Feil registrering")).rejects.toThrow(
      FAILURE,
    );
    expect(await orderStatus(order.id)).toBe("received");
    expect(await rowCount(auditLog)).toBe(0);
  });
});
