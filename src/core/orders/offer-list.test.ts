import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { cancelAssignment } from "@/core/assignments";
import { db } from "@/db/client";
import { auditLog, events, orders } from "@/db/schema";
import {
  TEST_NOW,
  createAssignment,
  createEmployee,
  createOrder,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { OFFER_LIST_FILTERS, type OfferListFilter } from "./codes";
import { OFFER_LIST_INDEX } from "./contract";
import { listOrders, orderListSummary } from "./index";
import { ORDER_LIST_LIMIT } from "./list";

/*
 * Tilbudslisten med filter, søk og antall per filter (testplan 3.2 og 7.3; ADR 0012, F3).
 * Fast tid: TEST_NOW (03.11.2026), så «i dag» er 2026-11-03. Oppdiktede adresser.
 *
 * Støtter hovedmål: de ansatte (standardlisten viser bare åpne tilbud, de som går ut først står
 * øverst, og tallene på knappene stemmer) og færre reklamasjoner (et utløpt tilbud blir ikke borte,
 * det står under «Utløpt»).
 */

beforeEach(resetDatabase);

const TODAY = "2026-11-03";

async function orgWithAdmin() {
  const org = await createOrganization("Oppdiktet Takst");
  const admin = await createUser({ name: "Test Admin" });
  await createEmployee(admin, org.id, ["admin"]);
  return { org, admin };
}

/** Et tilbud som er gjort om til et oppdrag (fabrikkene). */
async function convertedOffer(organizationId: string, overrides: Record<string, unknown> = {}) {
  const order = await createOrder(organizationId, overrides);
  const assignment = await createAssignment(organizationId, { orderId: order.id });
  await db
    .update(orders)
    .set({ status: "converted", assignmentId: assignment.id })
    .where(eq(orders.id, order.id));
  return { order, assignment };
}

/** Ett tilbud per visningsstatus, pluss ett mykt slettet i hver. */
async function seedEachStatus(organizationId: string) {
  const open = await createOrder(organizationId, {
    addressText: "Åpenveien 1, 8000 Bodø",
    validUntil: "2026-11-20",
  });
  const expired = await createOrder(organizationId, {
    addressText: "Utløptveien 2, 8000 Bodø",
    validUntil: "2026-11-02",
  });
  const rejected = await createOrder(organizationId, {
    addressText: "Avslåttveien 3, 8000 Bodø",
    status: "rejected",
    rejectedReasonKey: "price",
  });
  const { order: converted } = await convertedOffer(organizationId, {
    addressText: "Gjortomveien 4, 8000 Bodø",
  });
  const deletedAt = new Date("2026-11-01T10:00:00Z");
  await createOrder(organizationId, { validUntil: "2026-11-20", deletedAt });
  await createOrder(organizationId, { validUntil: "2026-11-01", deletedAt });
  await createOrder(organizationId, {
    status: "rejected",
    rejectedReasonKey: "timing",
    deletedAt,
  });
  const { order: deletedConverted } = await convertedOffer(organizationId);
  await db.update(orders).set({ deletedAt }).where(eq(orders.id, deletedConverted.id));
  return { open, expired, rejected, converted };
}

async function list(
  admin: Parameters<typeof listOrders>[0],
  organizationId: string,
  status?: OfferListFilter | string,
  query?: string,
) {
  return listOrders(admin, organizationId, {
    status: status as OfferListFilter,
    query,
    now: TEST_NOW,
  });
}

describe("3.2 filtrene", () => {
  it("3.2.1 uten filter er standarden «Åpne»: bare det åpne", async () => {
    const { org, admin } = await orgWithAdmin();
    const seeded = await seedEachStatus(org.id);
    const result = await list(admin, org.id);
    expect(result.status).toBe("open");
    expect(result.items.map((item) => item.id)).toEqual([seeded.open.id]);
    expect(result.items[0]).toMatchObject({ displayStatus: "open", validUntil: "2026-11-20" });
  });

  it.each(["expired", "rejected", "converted"] as const)(
    "3.2.2 %s gir nøyaktig det ene tilbudet",
    async (status) => {
      const { org, admin } = await orgWithAdmin();
      const seeded = await seedEachStatus(org.id);
      const result = await list(admin, org.id, status);
      expect(result.items.map((item) => item.id)).toEqual([seeded[status].id]);
      expect(result.items[0]?.displayStatus).toBe(status);
      expect(result.total).toBe(1);
    },
  );

  it("3.2.3 «Alle» gir de fire, uten mykt slettede", async () => {
    const { org, admin } = await orgWithAdmin();
    const seeded = await seedEachStatus(org.id);
    const result = await list(admin, org.id, "all");
    expect(result.items.map((item) => item.id).sort()).toEqual(
      [seeded.open.id, seeded.expired.id, seeded.rejected.id, seeded.converted.id].sort(),
    );
    expect(result.total).toBe(4);
  });

  it.each([...OFFER_LIST_FILTERS])(
    "3.2.4 mykt slettet vises ikke i %s og telles ikke",
    async (status) => {
      const { org, admin } = await orgWithAdmin();
      await seedEachStatus(org.id);
      const deletedIds = (
        await db
          .select({ id: orders.id })
          .from(orders)
          .where(sql`${orders.deletedAt} is not null`)
      ).map((row) => row.id);
      const result = await list(admin, org.id, status);
      for (const id of deletedIds) expect(result.items.map((item) => item.id)).not.toContain(id);
      expect(result.counts).toEqual({ open: 1, expired: 1, rejected: 1, converted: 1, all: 4 });
    },
  );

  it.each(["slettet", "expired'--", "", "ALL"])(
    "3.2.5 ukjent filter «%s» gir «Åpne» og aldri databasefeil",
    async (status) => {
      const { org, admin } = await orgWithAdmin();
      const seeded = await seedEachStatus(org.id);
      const result = await list(admin, org.id, status);
      expect(result.status).toBe("open");
      expect(result.items.map((item) => item.id)).toEqual([seeded.open.id]);
    },
  );

  it("3.2.6 søket virker sammen med filteret", async () => {
    const { org, admin } = await orgWithAdmin();
    const seeded = await seedEachStatus(org.id);
    expect((await list(admin, org.id, "open", "Utløptveien")).items).toEqual([]);
    expect((await list(admin, org.id, "expired", "Utløptveien")).items.map((i) => i.id)).toEqual([
      seeded.expired.id,
    ]);
    expect((await list(admin, org.id, "all", "Utløptveien")).items.map((i) => i.id)).toEqual([
      seeded.expired.id,
    ]);
  });

  it("3.2.7 total og oppsummeringen følger filteret", async () => {
    const { org, admin } = await orgWithAdmin();
    for (let index = 0; index < ORDER_LIST_LIMIT + 2; index += 1) {
      await createOrder(org.id, { validUntil: "2026-11-01" });
    }
    await createOrder(org.id, { validUntil: "2026-11-30" });
    const expired = await list(admin, org.id, "expired");
    expect(expired.items).toHaveLength(ORDER_LIST_LIMIT);
    expect(expired.total).toBe(ORDER_LIST_LIMIT + 2);
    expect(orderListSummary(expired.items.length, expired.total)).toBe(
      `Viser ${ORDER_LIST_LIMIT} av ${ORDER_LIST_LIMIT + 2}. Bruk søket for å finne flere.`,
    );
    const open = await list(admin, org.id, "open");
    expect(open.total).toBe(1);
    expect(orderListSummary(open.items.length, open.total)).toBeNull();
  });

  it("3.2.8 grensedag: gyldig til i dag er åpent, ikke utløpt", async () => {
    const { org, admin } = await orgWithAdmin();
    const today = await createOrder(org.id, { validUntil: TODAY });
    expect((await list(admin, org.id, "open")).items.map((item) => item.id)).toEqual([today.id]);
    expect((await list(admin, org.id, "expired")).items).toEqual([]);
  });

  it("3.2.8 utløp regnes med norsk dato: 00:30 i Oslo er neste dag", async () => {
    const { org, admin } = await orgWithAdmin();
    const offer = await createOrder(org.id, { validUntil: "2026-01-14" });
    const before = await listOrders(admin, org.id, {
      status: "expired",
      now: new Date("2026-01-14T22:30:00Z"),
    });
    const after = await listOrders(admin, org.id, {
      status: "expired",
      now: new Date("2026-01-14T23:30:00Z"),
    });
    expect(before.items).toEqual([]);
    expect(after.items.map((item) => item.id)).toEqual([offer.id]);
  });

  it("3.2.9 «Gyldig til» og visningsstatusen står på hver rad", async () => {
    const { org, admin } = await orgWithAdmin();
    await seedEachStatus(org.id);
    for (const item of (await list(admin, org.id, "all")).items) {
      expect(item.validUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(["open", "expired", "rejected", "converted"]).toContain(item.displayStatus);
    }
  });

  it("3.2.10 T-0031: tilbud med kansellert oppdrag har nummeret og assignmentCancelled", async () => {
    const { org, admin } = await orgWithAdmin();
    const { order, assignment } = await convertedOffer(org.id);
    const { order: live } = await convertedOffer(org.id);
    await cancelAssignment(admin, org.id, assignment.id, {
      expectedStatus: "ordered",
      reason: "Kansellert i testen",
      now: TEST_NOW,
    });
    const items = (await list(admin, org.id, "converted")).items;
    const cancelled = items.find((item) => item.id === order.id);
    expect(cancelled).toMatchObject({
      assignmentNumber: assignment.number,
      assignmentCancelled: true,
    });
    expect(items.find((item) => item.id === live.id)?.assignmentCancelled).toBe(false);
  });

  it("3.2.11 standardlisten og tellingen bruker indeksen for tilbudslisten", async () => {
    const { org } = await orgWithAdmin();
    const values = Array.from({ length: 300 }, (_, index) => ({
      organizationId: org.id,
      addressText: `Indeksveien ${index}, 8099 Oppdiktet`,
      receivedAt: TEST_NOW,
      validUntil: index % 2 === 0 ? "2026-11-01" : "2026-12-01",
    }));
    await db.insert(orders).values(values);
    await db.execute(sql`analyze orders`);
    const plan = await db.transaction(async (tx) => {
      await tx.execute(sql`set local enable_seqscan = off`);
      const rows = await tx.execute<{ "QUERY PLAN": string }>(sql`
        explain select id from orders
        where organization_id = ${org.id} and deleted_at is null
          and status = 'received' and valid_until >= ${TODAY}
        order by valid_until asc, received_at desc, id desc limit 50`);
      return rows.map((row) => row["QUERY PLAN"]).join("\n");
    });
    expect(plan).not.toMatch(/Seq Scan on orders/);
    expect(plan).toContain(OFFER_LIST_INDEX);
  });

  it("bare lesing: ingen hendelser og ingen revisjonslogg", async () => {
    const { org, admin } = await orgWithAdmin();
    await seedEachStatus(org.id);
    const before = [
      (await db.select().from(events)).length,
      (await db.select().from(auditLog)).length,
    ];
    for (const status of OFFER_LIST_FILTERS) await list(admin, org.id, status, "veien");
    expect([
      (await db.select().from(events)).length,
      (await db.select().from(auditLog)).length,
    ]).toEqual(before);
  });
});

describe("7.3 antall per filter og sortering (F3)", () => {
  it.each(
    [...OFFER_LIST_FILTERS].flatMap(
      (filter) =>
        [
          [filter, undefined],
          [filter, "veien"],
          [filter, "Utløptveien"],
        ] as const,
    ),
  )("7.3.1 counts[%s] er lik total med samme filter (søk «%s»)", async (filter, query) => {
    const { org, admin } = await orgWithAdmin();
    await seedEachStatus(org.id);
    await createOrder(org.id, { addressText: "Annenvei 9, 8000 Bodø", validUntil: "2026-11-05" });
    const any = await list(admin, org.id, "all", query);
    const result = await list(admin, org.id, filter, query);
    expect(any.counts[filter]).toBe(result.total);
    expect(result.counts).toEqual(any.counts);
    expect(result.counts[result.status]).toBe(result.total);
  });

  it("7.3.1 tallene uten søk", async () => {
    const { org, admin } = await orgWithAdmin();
    await seedEachStatus(org.id);
    await createOrder(org.id, { validUntil: "2026-11-05" });
    expect((await list(admin, org.id)).counts).toEqual({
      open: 2,
      expired: 1,
      rejected: 1,
      converted: 1,
      all: 5,
    });
  });

  it("7.3.2 tellingen bruker samme uttrykk som filteret (offerCountSql og offerListFilterSql)", () => {
    const source = readFileSync(join(__dirname, "orders.ts"), "utf8");
    expect(source).toContain("offerCountSql(filter, today)");
    expect(source).toContain("offerListFilterSql(status, today)");
    const statusSource = readFileSync(join(__dirname, "offer-status.ts"), "utf8");
    expect(statusSource).toMatch(/offerCountSql[\s\S]*offerListFilterSql\(filter, today\)/);
  });

  it("7.3.3 «Åpne» er sortert etter «Gyldig til»: den som går ut først, øverst", async () => {
    const { org, admin } = await orgWithAdmin();
    const in20 = await createOrder(org.id, { validUntil: "2026-11-23" });
    const in2 = await createOrder(org.id, { validUntil: "2026-11-05" });
    const in9 = await createOrder(org.id, { validUntil: "2026-11-12" });
    expect((await list(admin, org.id, "open")).items.map((item) => item.id)).toEqual([
      in2.id,
      in9.id,
      in20.id,
    ]);
  });

  it("7.3.3 de andre filtrene sorteres nyeste mottatt først", async () => {
    const { org, admin } = await orgWithAdmin();
    const older = await createOrder(org.id, {
      validUntil: "2026-11-05",
      receivedAt: new Date("2026-10-01T10:00:00Z"),
    });
    const newer = await createOrder(org.id, {
      validUntil: "2026-11-23",
      receivedAt: new Date("2026-10-20T10:00:00Z"),
    });
    expect((await list(admin, org.id, "all")).items.map((item) => item.id)).toEqual([
      newer.id,
      older.id,
    ]);
  });
});
