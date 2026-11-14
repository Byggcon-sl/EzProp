import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { assignments, events, orders } from "@/db/schema";
import {
  TEST_NOW,
  createContact,
  createEmployee,
  createFirm,
  createOffice,
  createOrder,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { convertOrderToAssignment, updateOrder } from "./index";

/*
 * Regresjon for ordren etter ADR 0011 (testplan for «Nytt oppdrag» 4.9.1, 4.9.2 og 4.7.8):
 * `convertOrderToAssignment` kopierer bestillingsfeltene til oppdraget i samme transaksjon, og en
 * gjort-om ordre kan rettes uten at oppdraget flyttes. Oppdiktede data.
 *
 * Støtter hovedmål: færre reklamasjoner (oppdraget får nøyaktig bestillingen som kom) og de
 * ansatte (den gamle veien med ordre virker som før).
 */

beforeEach(resetDatabase);

async function setup() {
  const org = await createOrganization("Oppdiktet Takst A");
  const office = await createOffice(org.id);
  const admin = await createUser({ name: "Test Admin" });
  await createEmployee(admin, org.id, ["admin"]);
  const firm = await createFirm(org.id, { name: "Testmegling AS" });
  const contact = await createContact(org.id, { firmId: firm.id });
  const order = await createOrder(org.id, {
    receivedAt: new Date("2026-11-01T07:45:00Z"),
    source: "email",
    externalRef: "ORD-2026-0042",
    orderedByText: "Megler Oppdiktet",
    orderedByContactId: contact.id,
    orderedByFirmId: firm.id,
    addressText: "Prøvegata 3, 8006 Bodø",
    gnr: "9001",
    bnr: "1",
    snr: "2",
    housingAssociationName: "Prøvetunet Borettslag",
    sellerDeclarationReceived: true,
  });
  return { org, office, admin, firm, contact, order };
}

const BOOKING_FIELDS = [
  "receivedAt",
  "source",
  "externalRef",
  "orderedByText",
  "orderedByContactId",
  "orderedByFirmId",
  "addressText",
  "gnr",
  "bnr",
  "snr",
  "housingAssociationName",
  "sellerDeclarationReceived",
] as const;

describe("4.9 omgjøring kopierer bestillingen", () => {
  it("4.9.1 alle tolv bestillingsfeltene kopieres, order_id settes og hendelsen har orderId", async () => {
    const { org, office, admin, order } = await setup();
    const result = await convertOrderToAssignment(admin, org.id, order.id, {
      officeId: office.id,
      now: TEST_NOW,
    });
    const assignmentId = (result as { assignment?: { id: string } }).assignment?.id;
    const [row] = await db.select().from(assignments).where(eq(assignments.orderId, order.id));
    expect(row).toBeDefined();
    if (assignmentId) expect(row?.id).toBe(assignmentId);
    for (const field of BOOKING_FIELDS) {
      expect(row?.[field], field).toEqual(order[field]);
    }
    expect(row?.creationKey).toBeNull();

    const [event] = await db.select().from(events).where(eq(events.assignmentId, row!.id));
    expect(event?.type).toBe("assignment.created");
    expect((event?.data as { orderId?: string }).orderId).toBe(order.id);
  });

  it("4.9.2 feiler kopien til oppdraget, gjøres ordren ikke om, og ingenting er endret", async () => {
    const { org, office, admin, order } = await setup();
    const [before] = await db.select().from(orders).where(eq(orders.id, order.id));
    await db.execute(
      sql.raw(`create or replace function test_fail_assignment_copy() returns trigger
        language plpgsql as $$ begin raise exception 'oppdiktet feil i testen'; end $$`),
    );
    await db.execute(
      sql.raw(`create trigger test_fail_assignment_copy before insert on assignments
        for each row execute function test_fail_assignment_copy()`),
    );
    try {
      const error = await convertOrderToAssignment(admin, org.id, order.id, {
        officeId: office.id,
        now: TEST_NOW,
      }).then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(Error);
    } finally {
      await db.execute(sql.raw(`drop trigger if exists test_fail_assignment_copy on assignments`));
      await db.execute(sql.raw(`drop function if exists test_fail_assignment_copy()`));
    }
    const [after] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(after).toEqual(before);
    const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(assignments);
    expect(count?.n).toBe(0);
    const [eventCount] = await db.select({ n: sql<number>`count(*)::int` }).from(events);
    expect(eventCount?.n).toBe(0);
  });

  it("4.7.8 en gjort-om ordre kan rettes, men oppdraget endres ikke (A251)", async () => {
    const { org, office, admin, order } = await setup();
    await convertOrderToAssignment(admin, org.id, order.id, { officeId: office.id, now: TEST_NOW });
    const [assignmentBefore] = await db
      .select()
      .from(assignments)
      .where(eq(assignments.orderId, order.id));
    const [current] = await db.select().from(orders).where(eq(orders.id, order.id));

    await updateOrder(
      admin,
      org.id,
      order.id,
      { addressText: "Rettetveien 7, 8006 Bodø", gnr: "9002", bnr: "3" },
      current!.rowVersion,
      TEST_NOW,
    );

    const [orderAfter] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(orderAfter?.addressText).toBe("Rettetveien 7, 8006 Bodø");
    const [assignmentAfter] = await db
      .select()
      .from(assignments)
      .where(eq(assignments.orderId, order.id));
    expect(assignmentAfter).toEqual(assignmentBefore);
  });
});
