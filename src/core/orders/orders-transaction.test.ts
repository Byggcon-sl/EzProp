import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordAuditEvent } from "@/core/audit";
import { recordEvent } from "@/core/events";
import { db } from "@/db/client";
import { assignments, auditLog, events, numberSequences, orders } from "@/db/schema";
import {
  createEmployee,
  createNumberSequence,
  createOffice,
  createOrder as insertOrder,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { convertOrderToAssignment, createOrder, rejectOrder } from "./index";

/*
 * Hendelser og revisjonslogg skrives i samme transaksjon som endringen
 * (docs/funksjoner/fase2a-manuell-ordre-testplan.md 4.6.5, egen fil etter runde 2).
 *
 * `recordEvent` og `recordAuditEvent` er pakket inn: de kaller den ekte funksjonen, og kaster
 * bare der testen ber om det. Kaster en av dem, skal verken ordre, oppdrag, hendelse eller
 * loggrad finnes, og nummerserien skal stå som før.
 *
 * Ingen ny spørring her, så filen trenger ikke expectTenantIsolation. Testdata er oppdiktet.
 * Støtter hovedmål: reklamasjoner (aldri en endring uten spor, aldri et brukt nummer uten oppdrag).
 */

vi.mock("@/core/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/events")>();
  return { ...actual, recordEvent: vi.fn(actual.recordEvent) };
});

vi.mock("@/core/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/audit")>();
  return { ...actual, recordAuditEvent: vi.fn(actual.recordAuditEvent) };
});

const NOW = new Date("2026-11-03T10:00:00Z");

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(recordEvent).mockClear();
  vi.mocked(recordAuditEvent).mockClear();
});

function failEventOnce() {
  vi.mocked(recordEvent).mockImplementationOnce(async () => {
    throw new Error("hendelsen feilet (test)");
  });
}

function failAuditOnce() {
  vi.mocked(recordAuditEvent).mockImplementationOnce(async () => {
    throw new Error("revisjonsloggen feilet (test)");
  });
}

async function rowCount(
  table: typeof orders | typeof assignments | typeof events | typeof auditLog,
) {
  const [row] = await db.select({ n: count() }).from(table);
  return row?.n ?? 0;
}

async function orgWithAdmin() {
  const org = await createOrganization();
  const admin = await createUser({ name: "Test Admin" });
  await createEmployee(admin, org.id, ["admin"]);
  const office = await createOffice(org.id);
  return { org, admin, office };
}

async function orderStatus(id: string) {
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  return row?.status;
}

describe("4.6.5 feiler hendelsen eller loggen, finnes ingenting", () => {
  it("modulene er pakket inn (ellers tester filen ingenting)", async () => {
    const { org, admin } = await orgWithAdmin();
    await createOrder(admin, org.id, { addressText: "Testveien 12, 8000 Bodø" }, NOW);
    expect(vi.mocked(recordEvent)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordAuditEvent)).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["recordEvent", failEventOnce],
    ["recordAuditEvent", failAuditOnce],
  ])("createOrder: %s kaster, og orders, events og audit_log er tomme", async (_name, fail) => {
    const { org, admin } = await orgWithAdmin();
    fail();

    await expect(
      createOrder(admin, org.id, { addressText: "Testveien 12, 8000 Bodø" }, NOW),
    ).rejects.toThrow();

    expect(await rowCount(orders)).toBe(0);
    expect(await rowCount(events)).toBe(0);
    expect(await rowCount(auditLog)).toBe(0);
  });

  it.each([
    ["recordEvent", failEventOnce],
    ["recordAuditEvent", failAuditOnce],
  ])("rejectOrder: %s kaster, og ordren står som mottatt uten spor", async (_name, fail) => {
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    fail();

    await expect(rejectOrder(admin, org.id, order.id, "Feil registrering")).rejects.toThrow();

    expect(await orderStatus(order.id)).toBe("received");
    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row?.rejectedReason).toBeNull();
    expect(await rowCount(events)).toBe(0);
    expect(await rowCount(auditLog)).toBe(0);
  });

  it.each([
    ["recordEvent", failEventOnce],
    ["recordAuditEvent", failAuditOnce],
  ])(
    "convertOrderToAssignment: %s kaster, ingen serie lages, ingen oppdrag, ordren er mottatt",
    async (_name, fail) => {
      const { org, admin, office } = await orgWithAdmin();
      const order = await insertOrder(org.id);
      fail();

      await expect(
        convertOrderToAssignment(admin, org.id, order.id, { officeId: office.id, now: NOW }),
      ).rejects.toThrow();

      expect(await orderStatus(order.id)).toBe("received");
      expect(await rowCount(assignments)).toBe(0);
      expect(await rowCount(events)).toBe(0);
      expect(await rowCount(auditLog)).toBe(0);
      expect(await db.select().from(numberSequences)).toEqual([]);
    },
  );

  it.each([
    ["recordEvent", failEventOnce],
    ["recordAuditEvent", failAuditOnce],
  ])(
    "convertOrderToAssignment: %s kaster, og en serie som fantes, har samme next_value",
    async (_name, fail) => {
      const { org, admin, office } = await orgWithAdmin();
      const order = await insertOrder(org.id);
      await createNumberSequence(org.id, { nextValue: 4 });
      fail();

      await expect(
        convertOrderToAssignment(admin, org.id, order.id, { officeId: office.id, now: NOW }),
      ).rejects.toThrow();

      const [sequence] = await db.select().from(numberSequences);
      expect(sequence?.nextValue).toBe(4);
      expect(await rowCount(assignments)).toBe(0);

      // Neste forsøk lykkes og får nummeret som ikke ble brukt
      const result = await convertOrderToAssignment(admin, org.id, order.id, {
        officeId: office.id,
        now: NOW,
      });
      expect(result.assignment.number).toBe("2026-00004");
    },
  );
});
