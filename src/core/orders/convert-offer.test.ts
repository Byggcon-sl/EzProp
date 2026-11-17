import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/core/access";
import { db } from "@/db/client";
import { assignments, events, orders } from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import {
  TEST_NOW,
  createAssignment,
  createEmployee,
  createOffice,
  createOrder,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { OfficeNotFoundError, OrderAlreadyHandledError } from "./errors";
import { convertOrderToAssignment, getOrder, listOrders, rejectOrder, updateOrder } from "./index";

/*
 * «Gjør om til oppdrag» og «Avslå tilbud» for tilbud (testplan 3.4, 3.5, 3.11 og 7.4.3;
 * ADR 0012, F4). Fast tid: TEST_NOW (03.11.2026). Oppdiktede adresser.
 *
 * Støtter hovedmål: de ansatte (ett trykk, også på utløpt tilbud, og dobbelttrykk gir ett
 * oppdrag) og færre reklamasjoner (bestillingen kopieres uten avskrift, og avslaget har en fast
 * grunn).
 */

beforeEach(resetDatabase);

const ADDRESS = "Gjøromveien 7, 8006 Bodø";

async function setup() {
  const org = await createOrganization("Oppdiktet Takst");
  const office = await createOffice(org.id);
  const admin = await createUser({ name: "Test Admin" });
  await createEmployee(admin, org.id, ["admin"]);
  return { org, office, admin };
}

async function orderRow(id: string) {
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  if (!row) throw new Error("fant ikke tilbudet");
  return row;
}

async function counts() {
  const [row] = await db.execute<{ assignments: number; events: number; sequences: number }>(sql`
    select (select count(*)::int from assignments) as assignments,
           (select count(*)::int from events) as events,
           (select coalesce(sum(next_value), 0)::int from number_sequences) as sequences`);
  return row!;
}

describe("3.4 gjør om til oppdrag", () => {
  it("3.4.1 åpent tilbud blir oppdrag med bestillingsfeltene", async () => {
    const { org, office, admin } = await setup();
    const offer = await createOrder(org.id, {
      addressText: ADDRESS,
      gnr: "9001",
      bnr: "1",
      validUntil: "2026-11-20",
    });
    const { assignment, order } = await convertOrderToAssignment(admin, org.id, offer.id, {
      officeId: office.id,
      now: TEST_NOW,
    });
    expect(order.status).toBe("converted");
    const [row] = await db.select().from(assignments).where(eq(assignments.id, assignment.id));
    expect(row).toMatchObject({ addressText: ADDRESS, gnr: "9001", bnr: "1", orderId: offer.id });
    const rows = await db.select().from(events).where(eq(events.organizationId, org.id));
    expect(rows.map((event) => event.type)).toEqual(["assignment.created"]);
    expect(rows[0]?.data).toMatchObject({ orderId: offer.id });
  });

  it("3.4.2 utløpt tilbud gjøres om på samme måte", async () => {
    const { org, office, admin } = await setup();
    const offer = await createOrder(org.id, { validUntil: "2026-10-01" });
    expect((await getOrder(admin, org.id, offer.id, TEST_NOW)).displayStatus).toBe("expired");
    const { order } = await convertOrderToAssignment(admin, org.id, offer.id, {
      officeId: office.id,
      now: TEST_NOW,
    });
    expect(order.status).toBe("converted");
    expect((await getOrder(admin, org.id, offer.id, TEST_NOW)).displayStatus).toBe("converted");
  });

  it("3.4.3 «Gyldig til» kopieres ikke: oppdraget har ingen kolonne for den", async () => {
    const { org, office, admin } = await setup();
    const offer = await createOrder(org.id, { validUntil: "2026-11-20" });
    const { assignment } = await convertOrderToAssignment(admin, org.id, offer.id, {
      officeId: office.id,
      now: TEST_NOW,
    });
    const columns = await db.execute<{ column_name: string }>(sql`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'assignments'`);
    expect(columns.map((column) => column.column_name)).not.toContain("valid_until");
    expect(assignment).not.toHaveProperty("validUntil");
    // Tilbudet beholder sin dato
    expect((await orderRow(offer.id)).validUntil).toBe("2026-11-20");
  });

  it.each([
    ["avslått", "rejected"],
    ["allerede gjort om", "converted"],
  ] as const)("3.4.4 %s gir OrderAlreadyHandledError og ingen endring", async (_name, status) => {
    const { org, office, admin } = await setup();
    const offer =
      status === "rejected"
        ? await createOrder(org.id, { status: "rejected", rejectedReasonKey: "price" })
        : await (async () => {
            const created = await createOrder(org.id);
            const assignment = await createAssignment(org.id, { orderId: created.id });
            await db
              .update(orders)
              .set({ status: "converted", assignmentId: assignment.id })
              .where(eq(orders.id, created.id));
            return created;
          })();
    const before = await counts();
    await expect(
      convertOrderToAssignment(admin, org.id, offer.id, { officeId: office.id, now: TEST_NOW }),
    ).rejects.toThrow(OrderAlreadyHandledError);
    expect(await counts()).toEqual(before);
  });

  it("3.4.5 to samtidige kall gir nøyaktig ett oppdrag og ett nummer", async () => {
    const { org, office, admin } = await setup();
    const offer = await createOrder(org.id, { validUntil: "2026-10-01" });
    const results = await Promise.allSettled([
      convertOrderToAssignment(admin, org.id, offer.id, { officeId: office.id, now: TEST_NOW }),
      convertOrderToAssignment(admin, org.id, offer.id, { officeId: office.id, now: TEST_NOW }),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(OrderAlreadyHandledError);
    const rows = await db.select().from(assignments).where(eq(assignments.orderId, offer.id));
    expect(rows).toHaveLength(1);
    const created = await db.select().from(events).where(eq(events.type, "assignment.created"));
    expect(created).toHaveLength(1);
    // Taperen brukte ikke opp et nummer
    expect(rows[0]?.number).toMatch(/-00001$/);
  });

  it("3.4.6 mykt slettet tilbud gir AccessDeniedError og ingen oppdrag", async () => {
    const { org, office, admin } = await setup();
    const offer = await createOrder(org.id, { deletedAt: TEST_NOW });
    await expect(
      convertOrderToAssignment(admin, org.id, offer.id, { officeId: office.id, now: TEST_NOW }),
    ).rejects.toThrow(AccessDeniedError);
    expect((await counts()).assignments).toBe(0);
  });

  it("3.4.7 admin uten kontor velger kontor og gjør om; kontor fra en annen organisasjon avvises", async () => {
    const { org, office } = await setup();
    const other = await createOrganization("Annen Takst");
    const otherOffice = await createOffice(other.id);
    const adminWithoutOffice = await createUser({ name: "Admin uten kontor" });
    await createEmployee(adminWithoutOffice, org.id, ["admin"]);
    const offer = await createOrder(org.id);
    await expect(
      convertOrderToAssignment(adminWithoutOffice, org.id, offer.id, {
        officeId: otherOffice.id,
        now: TEST_NOW,
      }),
    ).rejects.toThrow(OfficeNotFoundError);
    const { assignment } = await convertOrderToAssignment(adminWithoutOffice, org.id, offer.id, {
      officeId: office.id,
      now: TEST_NOW,
    });
    expect(assignment.officeId).toBe(office.id);
  });

  it("3.4.8 ingen ny hendelseskode: aldri order.converted", async () => {
    const { org, office, admin } = await setup();
    const offer = await createOrder(org.id);
    await convertOrderToAssignment(admin, org.id, offer.id, { officeId: office.id, now: TEST_NOW });
    const types = (await db.select().from(events)).map((event) => event.type);
    expect(types).not.toContain("order.converted");
    expect(types).toContain("assignment.created");
  });
});

describe("3.5 avslå (F4)", () => {
  it.each([
    ["uten kode", { reasonKey: undefined }],
    ["«Annet» uten tekst", { reasonKey: "other", reasonText: "" }],
    ["«Annet» med bare mellomrom", { reasonKey: "other", reasonText: "   " }],
  ])("3.5.1 %s avvises, og ingenting endres", async (_name, input) => {
    const { org, admin } = await setup();
    const offer = await createOrder(org.id);
    await expect(rejectOrder(admin, org.id, offer.id, input)).rejects.toThrow(
      /Velg en grunn\.|Skriv grunnen\./,
    );
    const row = await orderRow(offer.id);
    expect(row).toMatchObject({ status: "received", rowVersion: offer.rowVersion });
    expect((await counts()).events).toBe(0);
  });

  it.each([
    ["åpent", "2026-11-20"],
    ["utløpt", "2026-10-01"],
  ])(
    "3.5.2 %s tilbud avslås med kode og tekst; hendelsen har koden, aldri teksten",
    async (_name, validUntil) => {
      const { org, admin } = await setup();
      const offer = await createOrder(org.id, { validUntil });
      const result = await rejectOrder(admin, org.id, offer.id, {
        reasonKey: "chose_other",
        reasonText: "Kunden valgte et annet firma",
      });
      expect(result).toMatchObject({
        status: "rejected",
        rejectedReasonKey: "chose_other",
        rejectedReason: "Kunden valgte et annet firma",
      });
      const [event] = await db.select().from(events).where(eq(events.type, "order.rejected"));
      expect(event?.data).toEqual({ orderId: offer.id, reasonKey: "chose_other" });
      expect(JSON.stringify(event?.data)).not.toContain("Kunden valgte");
    },
  );

  it("3.5.3 «Pris» uten tekst godtas, og teksten er tom", async () => {
    const { org, admin } = await setup();
    const offer = await createOrder(org.id);
    const result = await rejectOrder(admin, org.id, offer.id, { reasonKey: "price" });
    expect(result).toMatchObject({
      status: "rejected",
      rejectedReasonKey: "price",
      rejectedReason: null,
    });
    const detail = await getOrder(admin, org.id, offer.id, TEST_NOW);
    expect(detail).toMatchObject({ rejectedReasonKey: "price", displayStatus: "rejected" });
  });

  it("3.5.4 avslått og gjort om kan ikke avslås", async () => {
    const { org, office, admin } = await setup();
    const rejected = await createOrder(org.id, { status: "rejected", rejectedReasonKey: "price" });
    await expect(rejectOrder(admin, org.id, rejected.id, { reasonKey: "timing" })).rejects.toThrow(
      OrderAlreadyHandledError,
    );
    const offer = await createOrder(org.id);
    await convertOrderToAssignment(admin, org.id, offer.id, { officeId: office.id, now: TEST_NOW });
    await expect(rejectOrder(admin, org.id, offer.id, { reasonKey: "timing" })).rejects.toThrow(
      OrderAlreadyHandledError,
    );
    expect((await orderRow(rejected.id)).rejectedReasonKey).toBe("price");
  });

  it("3.5.5 mykt slettet gir AccessDeniedError", async () => {
    const { org, admin } = await setup();
    const offer = await createOrder(org.id, { deletedAt: TEST_NOW });
    await expect(rejectOrder(admin, org.id, offer.id, { reasonKey: "price" })).rejects.toThrow(
      AccessDeniedError,
    );
  });
});

describe("myk sletting: endring", () => {
  it("3.6.10 mykt slettet tilbud kan ikke endres, heller ikke «Gyldig til»", async () => {
    const { org, admin } = await setup();
    const offer = await createOrder(org.id, { deletedAt: TEST_NOW });
    await expect(
      updateOrder(
        admin,
        org.id,
        offer.id,
        { addressText: ADDRESS, validUntil: "2026-11-30" },
        offer.rowVersion,
        TEST_NOW,
      ),
    ).rejects.toThrow(AccessDeniedError);
    expect(await listOrders(admin, org.id, { status: "all", now: TEST_NOW })).toMatchObject({
      total: 0,
    });
  });
});

describe("3.11 logg og myk sletting", () => {
  it("3.11.1 loggen får aldri adresse, matrikkel, grunn eller bestiller, heller ikke ved feil", async () => {
    const { org, office, admin } = await setup();
    const spies = (["debug", "info", "warn", "error"] as const).map((level) =>
      vi.spyOn(logger, level),
    );
    try {
      const secret = {
        addressText: "Hemmeligveien 99, 8000 Bodø",
        gnr: "8123",
        bnr: "4567",
        orderedByText: "Bestiller Hemmeligsen",
      };
      const offer = await createOrder(org.id, secret);
      await updateOrder(
        admin,
        org.id,
        offer.id,
        { ...secret, validUntil: "2026-11-30" },
        offer.rowVersion,
        TEST_NOW,
      );
      const second = await createOrder(org.id, secret);
      await rejectOrder(admin, org.id, second.id, {
        reasonKey: "other",
        reasonText: "Grunnen er hemmelig",
      });
      await expect(
        rejectOrder(admin, org.id, second.id, { reasonKey: "other", reasonText: "Ny hemmelig" }),
      ).rejects.toThrow(OrderAlreadyHandledError);
      await convertOrderToAssignment(admin, org.id, offer.id, {
        officeId: office.id,
        now: TEST_NOW,
      });
      const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
      for (const value of [
        secret.addressText,
        secret.gnr,
        secret.bnr,
        secret.orderedByText,
        "Grunnen er hemmelig",
        "Ny hemmelig",
      ]) {
        expect(logged).not.toContain(value);
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it("3.11.2 ingen permanent sletting i src/core/orders", () => {
    const files = readdirSync(__dirname).filter(
      (file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
    );
    for (const file of files) {
      const source = readFileSync(join(__dirname, file), "utf8");
      expect(source, file).not.toMatch(/\b(db|tx)\.delete\(/);
      expect(source, file).not.toMatch(/delete from/i);
    }
  });
});
