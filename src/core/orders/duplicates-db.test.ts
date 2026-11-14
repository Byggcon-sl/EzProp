import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { AccessDeniedError, type Actor } from "@/core/access";
import { db } from "@/db/client";
import {
  assignments,
  auditLog,
  employees,
  events,
  orders,
  organizations,
  type EmployeeRole,
} from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import {
  createAssignment,
  createEmployee,
  createOrder,
  createOrganization,
  createUser,
  resetDatabase,
  TEST_NOW,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { possibleDuplicatesQuery } from "./duplicate-sql";
import { findPossibleDuplicateOrders, findPossibleDuplicateOrdersFor, updateOrder } from "./index";

/*
 * Varsel om mulig dublett i kjernen (T3, Ståle 12.11.2026: «fast regel uten KI, og varselet stopper
 * ikke lagringen»). Testplan: docs/funksjoner/fase2a-varsel-dublett-testplan.md avsnitt 3.
 *
 * Avtalen om signaturer (testplanen): `findPossibleDuplicateOrdersFor(actor, organizationId,
 * { addressText, gnr, bnr, snr, receivedAt, excludeOrderId? })` og
 * `findPossibleDuplicateOrders(actor, organizationId, orderId)`, begge med svaret
 * `{ items: PossibleDuplicateOrder[], hasMore }`. Spørringen (`possibleDuplicatesQuery` i
 * `duplicate-sql.ts`) brukes i EXPLAIN-testen, slik at testen prøver den ekte spørringen.
 *
 * «Denne» ordren er mottatt `TEST_NOW` (03.11.2026). Hver testsak lager den andre ordren direkte i
 * databasen (`createOrder`, og `createAssignment` når den er gjort om). Oppdiktede adresser og
 * matrikler; i loggtesten brukes gnr/bnr/snr med fem sifre, så de er lette å finne i teksten.
 *
 * Støtter hovedmål: de ansatte (kontoret ser samme bolig bestilt to ganger), KI i bunnen
 * (`findPossibleDuplicateOrdersFor` virker på et ordreforslag som ikke er lagret, uten å sende
 * adressen til KI) og færre reklamasjoner (ikke to oppdrag og to rapporter på samme bolig).
 */

beforeEach(resetDatabase);
afterEach(() => {
  vi.restoreAllMocks();
});

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const ADDRESS = "Storgata 1A, 8006 Bodø";
const OTHER_ADDRESS = "Prøvegata 7, 8006 Bodø";

function at(base: Date, ms: number): Date {
  return new Date(base.getTime() + ms);
}

async function orgWithAdmin(name = "Testfirma takst") {
  const org = await createOrganization(name);
  const admin = await createUser({ name: "Test Admin" });
  const adminEmployee = await createEmployee(admin, org.id, ["admin"]);
  return { org, admin, adminEmployee };
}

async function person(organizationId: string, roles: EmployeeRole[]) {
  const actor = await createUser({ name: "Test Ansatt" });
  const employee = await createEmployee(actor, organizationId, roles);
  return { actor, employee };
}

type OrderFields = {
  addressText?: string;
  gnr?: string | null;
  bnr?: string | null;
  snr?: string | null;
  receivedAt?: Date;
};

type Other = OrderFields & {
  status?: "received" | "rejected" | "converted";
  assignmentStatus?: "ordered" | "in_progress" | "completed" | "invoiced";
  assignmentDeleted?: boolean;
  deleted?: boolean;
};

/** En annen ordre i organisasjonen, satt inn direkte. */
async function otherOrder(organizationId: string, other: Other = {}) {
  const base = {
    addressText: other.addressText ?? ADDRESS,
    gnr: other.gnr ?? null,
    bnr: other.bnr ?? null,
    snr: other.snr ?? null,
    receivedAt: other.receivedAt ?? TEST_NOW,
    deletedAt: other.deleted ? new Date("2026-11-02T08:00:00Z") : null,
  };
  const status = other.status ?? (other.assignmentStatus ? "converted" : "received");
  if (status === "rejected") {
    const order = await createOrder(organizationId, {
      ...base,
      status: "rejected",
      rejectedReason: "Feil registrering",
    });
    return { ...order, assignmentNumber: null as string | null };
  }
  if (status === "converted") {
    // Oppdraget eier bestillingen (ADR 0011): feltene kopieres fra ordren, som i
    // `convertOrderToAssignment`, og oppdraget peker på ordren.
    const assignment = await createAssignment(organizationId, {
      addressText: base.addressText,
      gnr: base.gnr,
      bnr: base.bnr,
      snr: base.snr,
      receivedAt: base.receivedAt,
      status: other.assignmentStatus ?? "ordered",
      deletedAt: other.assignmentDeleted ? new Date("2026-11-02T08:00:00Z") : null,
    });
    const order = await createOrder(organizationId, {
      ...base,
      status: "converted",
      assignmentId: assignment.id,
    });
    await db
      .update(assignments)
      .set({ orderId: order.id })
      .where(eq(assignments.id, assignment.id));
    return { ...order, assignmentNumber: assignment.number as string | null };
  }
  return { ...(await createOrder(organizationId, base)), assignmentNumber: null as string | null };
}

/** «Denne» ordren, mottatt `TEST_NOW` med mindre noe annet er satt. */
async function thisOrder(organizationId: string, fields: OrderFields = {}) {
  return createOrder(organizationId, {
    addressText: fields.addressText ?? ADDRESS,
    gnr: fields.gnr ?? null,
    bnr: fields.bnr ?? null,
    snr: fields.snr ?? null,
    receivedAt: fields.receivedAt ?? TEST_NOW,
  });
}

/**
 * Treffene for «denne» ordren gjennom begge tjenestene. Krever at de gir samme svar, slik at
 * regelen bare finnes ett sted.
 */
async function lookup(actor: Actor, organizationId: string, order: typeof orders.$inferSelect) {
  const viaOrder = await findPossibleDuplicateOrders(actor, organizationId, order.id);
  const viaFields = await findPossibleDuplicateOrdersFor(actor, organizationId, {
    addressText: order.addressText,
    gnr: order.gnr,
    bnr: order.bnr,
    snr: order.snr,
    receivedAt: order.receivedAt,
    excludeOrderId: order.id,
  });
  expect(viaFields).toEqual(viaOrder);
  return viaOrder;
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// 3.1 Regelen mot databasen
// ---------------------------------------------------------------------------------------------

type RuleCase = [name: string, mine: OrderFields, other: Other, reasons: string[] | null];

const CADASTRE = { gnr: "9999", bnr: "123" };

const RULE_CASES: RuleCase[] = [
  // 3.1.1 samme adresse, ulik skrivemåte
  ["3.1.1 «storgata 1 a»", {}, { addressText: "storgata 1 a" }, ["address"]],
  ["3.1.1 «Storgata 1a»", {}, { addressText: "Storgata 1a" }, ["address"]],
  ["3.1.1 «STORGATA 1-A.»", {}, { addressText: "STORGATA 1-A." }, ["address"]],
  ["3.1.1 uten postnummer", {}, { addressText: "Storgata 1A" }, ["address"]],
  ["3.1.1 med bolignummer", {}, { addressText: "Storgata 1A, H0101, 8006 Bodø" }, ["address"]],
  // 3.1.2
  [
    "3.1.2 «Øvre gate 2» mot «Ovre gate 2»",
    { addressText: "Øvre gate 2" },
    { addressText: "Ovre gate 2" },
    null,
  ],
  [
    "3.1.2 «ØVRE GATE 2» mot «Øvre gate 2»",
    { addressText: "ØVRE GATE 2" },
    { addressText: "Øvre gate 2" },
    ["address"],
  ],
  // 3.1.3
  ["3.1.3 adresse «,» på begge", { addressText: "," }, { addressText: "," }, null],
  [
    "3.1.3 adresse « , 8006 Bodø» på begge",
    { addressText: " , 8006 Bodø" },
    { addressText: " , 8006 Bodø" },
    null,
  ],
  // 3.1.4
  [
    "3.1.4 ulik adresse, «012» mot «12»",
    { addressText: "Ett sted 1", gnr: "09999", bnr: "0123", snr: "2" },
    { addressText: "Annet sted 2", gnr: "9999", bnr: "123", snr: "2" },
    ["cadastre"],
  ],
  // 3.1.5
  [
    "3.1.5 gnr «0» på begge",
    { addressText: "Ett sted 1", gnr: "0", bnr: "123" },
    { addressText: "Annet sted 2", gnr: "0", bnr: "123" },
    null,
  ],
  [
    "3.1.5 gnr «000» på begge",
    { addressText: "Ett sted 1", gnr: "000", bnr: "123" },
    { addressText: "Annet sted 2", gnr: "000", bnr: "123" },
    null,
  ],
  [
    "3.1.5 bare gnr utfylt",
    { addressText: "Ett sted 1", gnr: "9999" },
    { addressText: "Annet sted 2", gnr: "9999" },
    null,
  ],
  [
    "3.1.5 ulikt snr",
    { addressText: "Ett sted 1", ...CADASTRE, snr: "2" },
    { addressText: "Annet sted 2", ...CADASTRE, snr: "3" },
    null,
  ],
  [
    "3.1.5 snr tomt mot «2»",
    { addressText: "Ett sted 1", ...CADASTRE },
    { addressText: "Annet sted 2", ...CADASTRE, snr: "2" },
    null,
  ],
  // 3.1.6
  [
    "3.1.6 snr tom mot «0»",
    { addressText: "Ett sted 1", ...CADASTRE },
    { addressText: "Annet sted 2", ...CADASTRE, snr: "0" },
    ["cadastre"],
  ],
  [
    "3.1.6 snr tom tekst mot null",
    { addressText: "Ett sted 1", ...CADASTRE, snr: "" },
    { addressText: "Annet sted 2", ...CADASTRE },
    ["cadastre"],
  ],
  // 3.1.7
  [
    "3.1.7 begge like",
    { ...CADASTRE },
    { addressText: "storgata 1 a", ...CADASTRE },
    ["address", "cadastre"],
  ],
  // 3.1.8 og 3.1.9
  ["3.1.8 den andre er avvist", {}, { status: "rejected" }, null],
  [
    "3.1.9 oppdraget er kansellert",
    {},
    { assignmentStatus: "ordered", assignmentDeleted: true },
    null,
  ],
  [
    "3.1.9 oppdraget er kansellert, også når det var under arbeid",
    {},
    {
      assignmentStatus: "in_progress",
      assignmentDeleted: true,
      receivedAt: at(TEST_NOW, -200 * DAY),
    },
    null,
  ],
  // 3.1.10
  ["3.1.10 gjort om, oppdrag bestilt", {}, { assignmentStatus: "ordered" }, ["address"]],
  ["3.1.10 gjort om, oppdrag under arbeid", {}, { assignmentStatus: "in_progress" }, ["address"]],
  // 3.1.11
  [
    "3.1.11 ferdig, 90 døgn før",
    {},
    { assignmentStatus: "completed", receivedAt: at(TEST_NOW, -90 * DAY) },
    ["address"],
  ],
  [
    "3.1.11 fakturert, 90 døgn før",
    {},
    { assignmentStatus: "invoiced", receivedAt: at(TEST_NOW, -90 * DAY) },
    ["address"],
  ],
  [
    "3.1.11 ferdig, 90 døgn og 1 s før",
    {},
    { assignmentStatus: "completed", receivedAt: at(TEST_NOW, -90 * DAY - 1000) },
    null,
  ],
  [
    "3.1.11 fakturert, 90 døgn og 1 s før",
    {},
    { assignmentStatus: "invoiced", receivedAt: at(TEST_NOW, -90 * DAY - 1000) },
    null,
  ],
  [
    "3.1.11 ferdig, 91 døgn før",
    {},
    { assignmentStatus: "completed", receivedAt: at(TEST_NOW, -91 * DAY) },
    null,
  ],
  [
    "3.1.11 fakturert, 91 døgn før",
    {},
    { assignmentStatus: "invoiced", receivedAt: at(TEST_NOW, -91 * DAY) },
    null,
  ],
  // 3.1.12 og 3.1.13
  [
    "3.1.12 mottatt 200 døgn før, fortsatt mottatt",
    {},
    { receivedAt: at(TEST_NOW, -200 * DAY) },
    ["address"],
  ],
  [
    "3.1.13 under arbeid, 200 døgn før",
    {},
    { assignmentStatus: "in_progress", receivedAt: at(TEST_NOW, -200 * DAY) },
    ["address"],
  ],
  [
    "3.1.13 bestilt, 200 døgn før",
    {},
    { assignmentStatus: "ordered", receivedAt: at(TEST_NOW, -200 * DAY) },
    ["address"],
  ],
  // 3.1.14
  [
    "3.1.14 ferdig, 90 døgn etter",
    {},
    { assignmentStatus: "completed", receivedAt: at(TEST_NOW, 90 * DAY) },
    ["address"],
  ],
  [
    "3.1.14 ferdig, 91 døgn etter",
    {},
    { assignmentStatus: "completed", receivedAt: at(TEST_NOW, 91 * DAY) },
    null,
  ],
  // 3.1.15 over skifte til sommertid
  [
    "3.1.15 sommertid: + 2160 timer",
    { receivedAt: new Date("2026-01-15T10:00:00Z") },
    {
      assignmentStatus: "completed",
      receivedAt: at(new Date("2026-01-15T10:00:00Z"), 2160 * HOUR),
    },
    ["address"],
  ],
  [
    "3.1.15 sommertid: + 2160 timer + 1 s",
    { receivedAt: new Date("2026-01-15T10:00:00Z") },
    {
      assignmentStatus: "completed",
      receivedAt: at(new Date("2026-01-15T10:00:00Z"), 2160 * HOUR + 1000),
    },
    null,
  ],
  // 3.1.16
  ["3.1.16 myk-slettet annen ordre", {}, { deleted: true }, null],
  [
    "3.1.16 myk-slettet annen ordre med samme matrikkel",
    { ...CADASTRE },
    { ...CADASTRE, deleted: true },
    null,
  ],
];

describe("3.1 regelen mot databasen", () => {
  it.each(RULE_CASES)("%s", async (_name, mine, other, reasons) => {
    const { org, admin } = await orgWithAdmin();
    const order = await thisOrder(org.id, mine);
    const duplicate = await otherOrder(org.id, other);

    const result = await lookup(admin, org.id, order);

    if (reasons === null) {
      expect(result.items).toEqual([]);
    } else {
      expect(result.items.map((item) => item.id)).toEqual([duplicate.id]);
      expect(result.items[0]!.reasons).toEqual(reasons);
    }
    expect(result.hasMore).toBe(false);
  });

  it.each(["ordered", "in_progress"] as const)(
    "3.1.10 gjort om med oppdrag %s gir oppdragsnummer og oppdragsstatus i svaret",
    async (assignmentStatus) => {
      const { org, admin } = await orgWithAdmin();
      const order = await thisOrder(org.id);
      const duplicate = await otherOrder(org.id, { assignmentStatus });
      const { items } = await lookup(admin, org.id, order);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        id: duplicate.id,
        status: "converted",
        assignmentNumber: duplicate.assignmentNumber,
        assignmentStatus,
      });
    },
  );

  it("3.1.17 ordren selv gir aldri treff (excludeOrderId), men uten den finnes den", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await thisOrder(org.id, { ...CADASTRE });
    const fields = {
      addressText: order.addressText,
      gnr: order.gnr,
      bnr: order.bnr,
      snr: order.snr,
      receivedAt: order.receivedAt,
    };
    expect((await findPossibleDuplicateOrders(admin, org.id, order.id)).items).toEqual([]);
    expect(
      (await findPossibleDuplicateOrdersFor(admin, org.id, { ...fields, excludeOrderId: order.id }))
        .items,
    ).toEqual([]);
    // Kontroll: uten excludeOrderId er ordren et treff, så det er unntaket som virker
    expect(
      (await findPossibleDuplicateOrdersFor(admin, org.id, fields)).items.map((item) => item.id),
    ).toEqual([order.id]);
  });

  it("3.1.7 samme adresse og matrikkel gir én rad, ikke to", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await thisOrder(org.id, { ...CADASTRE });
    await otherOrder(org.id, { ...CADASTRE });
    const { items } = await lookup(admin, org.id, order);
    expect(items).toHaveLength(1);
    expect(items[0]!.reasons).toEqual(["address", "cadastre"]);
  });
});

// ---------------------------------------------------------------------------------------------
// 3.2 Svaret
// ---------------------------------------------------------------------------------------------

describe("3.2 svaret", () => {
  it("3.2.1 feltene i PossibleDuplicateOrder er en fast liste uten matrikkel og kontakter", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await thisOrder(org.id, { ...CADASTRE });
    const received = await otherOrder(org.id, {
      ...CADASTRE,
      receivedAt: at(TEST_NOW, -DAY),
    });
    const converted = await otherOrder(org.id, {
      ...CADASTRE,
      assignmentStatus: "in_progress",
      receivedAt: at(TEST_NOW, -2 * DAY),
    });

    const { items } = await lookup(admin, org.id, order);
    expect(items.map((item) => item.id)).toEqual([received.id, converted.id]);
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(
        [
          "addressText",
          "assignmentNumber",
          "assignmentStatus",
          "id",
          "reasons",
          "receivedAt",
          "status",
        ].sort(),
      );
    }
    expect(items[0]).toEqual({
      id: received.id,
      receivedAt: received.receivedAt,
      addressText: ADDRESS,
      status: "received",
      assignmentNumber: null,
      assignmentStatus: null,
      reasons: ["address", "cadastre"],
    });
    expect(items[1]).toMatchObject({
      status: "converted",
      assignmentNumber: converted.assignmentNumber,
      assignmentStatus: "in_progress",
    });
    expect(items[0]!.receivedAt).toBeInstanceOf(Date);
  });

  it("3.2.2 elleve treff, tre med lik received_at: 10 i svaret, hasMore, nyeste først og så id", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await thisOrder(org.id);
    const created: { id: string; receivedAt: Date }[] = [];
    // Tre nyeste med lik tid, så åtte eldre med ulik tid
    for (let index = 0; index < 3; index += 1) {
      created.push(await otherOrder(org.id, { receivedAt: at(TEST_NOW, -HOUR) }));
    }
    for (let index = 0; index < 8; index += 1) {
      created.push(await otherOrder(org.id, { receivedAt: at(TEST_NOW, -(index + 2) * DAY) }));
    }

    const first = await lookup(admin, org.id, order);
    const second = await lookup(admin, org.id, order);
    expect(first.items).toHaveLength(10);
    expect(first.hasMore).toBe(true);
    expect(second.items.map((item) => item.id)).toEqual(first.items.map((item) => item.id));

    // Den eldste er den som ikke vises
    const oldest = created[created.length - 1]!;
    expect(first.items.map((item) => item.id)).not.toContain(oldest.id);

    // Nyeste først
    const times = first.items.map((item) => item.receivedAt.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);

    // Lik tid: fast rekkefølge på id (samme retning hele veien)
    const tied = first.items.slice(0, 3).map((item) => item.id);
    const ascending = [...tied].sort();
    expect([ascending, [...ascending].reverse()]).toContainEqual(tied);
  });

  it("3.2.3 nøyaktig 10 treff gir 10 og hasMore = false", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await thisOrder(org.id);
    for (let index = 0; index < 10; index += 1) {
      await otherOrder(org.id, { receivedAt: at(TEST_NOW, -(index + 1) * DAY) });
    }
    const result = await lookup(admin, org.id, order);
    expect(result.items).toHaveLength(10);
    expect(result.hasMore).toBe(false);
  });

  it("3.2.4 ingen treff gir tom liste og hasMore = false", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await thisOrder(org.id);
    await otherOrder(org.id, { addressText: OTHER_ADDRESS });
    expect(await lookup(admin, org.id, order)).toEqual({ items: [], hasMore: false });
  });
});

// ---------------------------------------------------------------------------------------------
// 3.3 findPossibleDuplicateOrdersFor med felt som ikke er lagret (KI i bunnen)
// ---------------------------------------------------------------------------------------------

async function counts() {
  const [o] = await db.select({ n: sql<number>`count(*)::int` }).from(orders);
  const [e] = await db.select({ n: sql<number>`count(*)::int` }).from(events);
  const [a] = await db.select({ n: sql<number>`count(*)::int` }).from(auditLog);
  const versions = await db.select({ id: orders.id, rowVersion: orders.rowVersion }).from(orders);
  return { orders: o?.n, events: e?.n, audit: a?.n, versions };
}

describe("3.3 findPossibleDuplicateOrdersFor med ordrefelt som ikke er lagret", () => {
  it("3.3.1 uten excludeOrderId gir adresse lik en lagret ordre treff", async () => {
    const { org, admin } = await orgWithAdmin();
    const saved = await otherOrder(org.id);
    const result = await findPossibleDuplicateOrdersFor(admin, org.id, {
      addressText: "storgata 1 a, 8006 Bodø",
      gnr: null,
      bnr: null,
      snr: null,
      receivedAt: TEST_NOW,
    });
    expect(result.items.map((item) => item.id)).toEqual([saved.id]);
    expect(result.items[0]!.reasons).toEqual(["address"]);
  });

  it("3.3.1 receivedAt kan sendes som ISO-tekst (som fra et forslag)", async () => {
    const { org, admin } = await orgWithAdmin();
    const saved = await otherOrder(org.id, { ...CADASTRE });
    const result = await findPossibleDuplicateOrdersFor(admin, org.id, {
      addressText: "Annet sted 2",
      gnr: "9999",
      bnr: "123",
      snr: null,
      receivedAt: TEST_NOW.toISOString(),
    });
    expect(result.items.map((item) => item.id)).toEqual([saved.id]);
  });

  it("3.3.2 kallet lagrer og endrer ingenting (orders, events og audit_log uendret)", async () => {
    const { org, admin } = await orgWithAdmin();
    await otherOrder(org.id, { ...CADASTRE });
    const order = await thisOrder(org.id, { ...CADASTRE });
    const before = await counts();
    await findPossibleDuplicateOrdersFor(admin, org.id, {
      addressText: ADDRESS,
      ...CADASTRE,
      snr: null,
      receivedAt: TEST_NOW,
    });
    await findPossibleDuplicateOrders(admin, org.id, order.id);
    expect(await counts()).toEqual(before);
  });

  it.each([
    ["ugyldig receivedAt", { receivedAt: "ikke-en-dato" }],
    ["excludeOrderId som ikke er uuid", { excludeOrderId: "ikke-en-id" }],
    ["excludeOrderId med SQL", { excludeOrderId: "'; drop table orders; --" }],
  ])("3.3.3 %s gir ZodError eller AccessDeniedError, aldri en databasefeil", async (_name, bad) => {
    const { org, admin } = await orgWithAdmin();
    await otherOrder(org.id);
    const error = await caught(
      findPossibleDuplicateOrdersFor(admin, org.id, {
        addressText: ADDRESS,
        gnr: null,
        bnr: null,
        snr: null,
        receivedAt: TEST_NOW,
        ...bad,
      } as Parameters<typeof findPossibleDuplicateOrdersFor>[2]),
    );
    expect(error, "kallet skal feile").toBeDefined();
    expect(
      error instanceof ZodError || error instanceof AccessDeniedError,
      `fikk ${(error as Error)?.name}`,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// 3.4 findPossibleDuplicateOrders (innpakningen)
// ---------------------------------------------------------------------------------------------

function editInput(row: typeof orders.$inferSelect, overrides: Record<string, unknown> = {}) {
  return {
    addressText: row.addressText,
    receivedAt: row.receivedAt.toISOString(),
    externalRef: row.externalRef ?? "",
    orderedByText: row.orderedByText ?? "",
    orderedByContactId: row.orderedByContactId ?? "",
    gnr: row.gnr ?? "",
    bnr: row.bnr ?? "",
    snr: row.snr ?? "",
    housingAssociationName: row.housingAssociationName ?? "",
    sellerDeclarationReceived: row.sellerDeclarationReceived,
    ...overrides,
  } as Parameters<typeof updateOrder>[3];
}

describe("3.4 findPossibleDuplicateOrders", () => {
  it("3.4.1 ordren selv er avvist: tom liste, selv om en åpen ordre har samme adresse", async () => {
    const { org, admin } = await orgWithAdmin();
    const rejected = await otherOrder(org.id, { status: "rejected", ...CADASTRE });
    await otherOrder(org.id, { ...CADASTRE });
    expect(await findPossibleDuplicateOrders(admin, org.id, rejected.id)).toEqual({
      items: [],
      hasMore: false,
    });
  });

  it("3.4.2 ordren er gjort om: treff som vanlig, ordren selv ikke med", async () => {
    const { org, admin } = await orgWithAdmin();
    const converted = await otherOrder(org.id, { assignmentStatus: "ordered" });
    const open = await otherOrder(org.id, { receivedAt: at(TEST_NOW, -DAY) });
    const { items } = await findPossibleDuplicateOrders(admin, org.id, converted.id);
    expect(items.map((item) => item.id)).toEqual([open.id]);
  });

  it("3.4.3 ukjent uuid, «ikke-en-id» og myk-slettet ordre gir AccessDeniedError", async () => {
    const { org, admin } = await orgWithAdmin();
    await otherOrder(org.id);
    const deleted = await otherOrder(org.id, { deleted: true, receivedAt: at(TEST_NOW, -DAY) });
    for (const id of ["00000000-0000-4000-8000-000000000999", "ikke-en-id", "", deleted.id]) {
      const error = await caught(findPossibleDuplicateOrders(admin, org.id, id));
      expect(error, `id «${id}»`).toBeInstanceOf(AccessDeniedError);
    }
  });

  it("3.4.4 treffene følger adressen når ordren rettes (T1), og forsvinner når den rettes tilbake", async () => {
    const { org, admin } = await orgWithAdmin();
    const open = await otherOrder(org.id, { addressText: OTHER_ADDRESS });
    const order = await thisOrder(org.id, { addressText: "Testveien 12, 8000 Bodø" });
    expect((await findPossibleDuplicateOrders(admin, org.id, order.id)).items).toEqual([]);

    const changed = await updateOrder(
      admin,
      org.id,
      order.id,
      editInput(order, { addressText: "prøvegata 7" }),
      order.rowVersion,
      TEST_NOW,
    );
    const after = await findPossibleDuplicateOrders(admin, org.id, order.id);
    expect(after.items.map((item) => item.id)).toEqual([open.id]);

    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    await updateOrder(
      admin,
      org.id,
      order.id,
      editInput(row!, { addressText: "Testveien 12, 8000 Bodø" }),
      changed.rowVersion,
      TEST_NOW,
    );
    expect((await findPossibleDuplicateOrders(admin, org.id, order.id)).items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 3.5 Tilgang per rolle
// ---------------------------------------------------------------------------------------------

async function bothServices(actor: Actor, organizationId: string, orderId: string) {
  const viaOrder = await findPossibleDuplicateOrders(actor, organizationId, orderId);
  const viaFields = await findPossibleDuplicateOrdersFor(actor, organizationId, {
    addressText: ADDRESS,
    gnr: null,
    bnr: null,
    snr: null,
    receivedAt: TEST_NOW,
    excludeOrderId: orderId,
  });
  return { viaOrder, viaFields };
}

describe("3.5 tilgang per rolle", () => {
  it.each<[string, EmployeeRole[]]>([
    ["takstmann", ["inspector"]],
    ["kontor", ["office"]],
    ["leder", ["manager"]],
    ["admin", ["admin"]],
    ["admin og takstmann", ["admin", "inspector"]],
  ])("3.5.1 og 3.5.2 %s får svar fra begge tjenestene", async (_name, roles) => {
    const { org } = await orgWithAdmin();
    const order = await thisOrder(org.id);
    const other = await otherOrder(org.id, { receivedAt: at(TEST_NOW, -DAY) });
    const { actor } = await person(org.id, roles);
    const { viaOrder, viaFields } = await bothServices(actor, org.id, order.id);
    expect(viaOrder.items.map((item) => item.id)).toEqual([other.id]);
    expect(viaFields.items.map((item) => item.id)).toEqual([other.id]);
  });

  it.each<[string, (employee: { id: string }) => Promise<unknown>, EmployeeRole[]]>([
    [
      "deaktivert ansatt (admin)",
      (employee) =>
        db
          .update(employees)
          .set({ deactivatedAt: new Date("2026-11-01T08:00:00Z") })
          .where(eq(employees.id, employee.id)),
      ["admin"],
    ],
    [
      "myk-slettet ansatt (admin)",
      (employee) =>
        db
          .update(employees)
          .set({ deletedAt: new Date("2026-11-01T08:00:00Z") })
          .where(eq(employees.id, employee.id)),
      ["admin"],
    ],
    ["ansatt uten roller", async () => undefined, []],
  ])("3.5.3 %s får AccessDeniedError på begge", async (_name, change, roles) => {
    const { org } = await orgWithAdmin();
    const order = await thisOrder(org.id);
    await otherOrder(org.id, { receivedAt: at(TEST_NOW, -DAY) });
    const { actor, employee } = await person(org.id, roles);
    await change(employee);
    await expect(findPossibleDuplicateOrders(actor, org.id, order.id)).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(
      findPossibleDuplicateOrdersFor(actor, org.id, {
        addressText: ADDRESS,
        gnr: null,
        bnr: null,
        snr: null,
        receivedAt: TEST_NOW,
      }),
    ).rejects.toThrow(AccessDeniedError);
  });

  it("3.5.3 innlogging uten ansattrad får AccessDeniedError på begge", async () => {
    const { org } = await orgWithAdmin();
    const order = await thisOrder(org.id);
    const stranger = await createUser({ name: "Uten Ansattrad" });
    await expect(findPossibleDuplicateOrders(stranger, org.id, order.id)).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(
      findPossibleDuplicateOrdersFor(stranger, org.id, {
        addressText: ADDRESS,
        gnr: null,
        bnr: null,
        snr: null,
        receivedAt: TEST_NOW,
      }),
    ).rejects.toThrow(AccessDeniedError);
  });

  it("3.5.4 access.inspectors_edit_all = false endrer ikke lesingen", async () => {
    const { org } = await orgWithAdmin();
    await db
      .update(organizations)
      .set({ settings: { "access.inspectors_edit_all": false } })
      .where(eq(organizations.id, org.id));
    const order = await thisOrder(org.id);
    const other = await otherOrder(org.id, { receivedAt: at(TEST_NOW, -DAY) });
    const { actor } = await person(org.id, ["inspector"]);
    const { viaOrder, viaFields } = await bothServices(actor, org.id, order.id);
    expect(viaOrder.items.map((item) => item.id)).toEqual([other.id]);
    expect(viaFields.items.map((item) => item.id)).toEqual([other.id]);
  });
});

// ---------------------------------------------------------------------------------------------
// 3.6 Tenant-isolasjon
// ---------------------------------------------------------------------------------------------

const ANCHOR_REF = "TEST-ANKER-0001";

describe("3.6 tenant-isolasjon", () => {
  it("3.6.1 expectTenantIsolation for findPossibleDuplicateOrdersFor", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a1 = await createOrder(grantA.organizationId, { addressText: ADDRESS });
        const a2 = await createOrder(grantA.organizationId, {
          addressText: "storgata 1 a",
          receivedAt: at(TEST_NOW, -DAY),
        });
        const b1 = await createOrder(grantB.organizationId, { addressText: ADDRESS });
        const b2 = await createOrder(grantB.organizationId, {
          addressText: "Storgata 1a",
          receivedAt: at(TEST_NOW, -DAY),
        });
        return { a: [a1.id, a2.id], b: [b1.id, b2.id] };
      },
      query: async (actor, organizationId) =>
        (
          await findPossibleDuplicateOrdersFor(actor, organizationId, {
            addressText: ADDRESS,
            gnr: null,
            bnr: null,
            snr: null,
            receivedAt: TEST_NOW,
          })
        ).items,
      idOf: (row) => row.id,
    });
  });

  it("3.6.2 expectTenantIsolation for findPossibleDuplicateOrders", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const seeded: { a: string[]; b: string[] } = { a: [], b: [] };
        for (const [side, organizationId] of [
          ["a", grantA.organizationId],
          ["b", grantB.organizationId],
        ] as const) {
          await createOrder(organizationId, { addressText: ADDRESS, externalRef: ANCHOR_REF });
          const one = await createOrder(organizationId, {
            addressText: "storgata 1 a",
            receivedAt: at(TEST_NOW, -DAY),
          });
          const two = await createOrder(organizationId, {
            addressText: ADDRESS,
            receivedAt: at(TEST_NOW, -2 * DAY),
          });
          seeded[side].push(one.id, two.id);
        }
        return seeded;
      },
      query: async (actor, organizationId) => {
        // Ankerordren i den organisasjonen det spørres om (en hjelper i testen, ikke i tjenesten)
        const [anchor] = await db
          .select({ id: orders.id })
          .from(orders)
          .where(
            and(eq(orders.organizationId, organizationId), eq(orders.externalRef, ANCHOR_REF)),
          );
        return (await findPossibleDuplicateOrders(actor, organizationId, anchor!.id)).items;
      },
      idOf: (row) => row.id,
    });
  });

  it("3.6.3 samme adresse og matrikkel i A og B: ingen treff på tvers, begge veier", async () => {
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    const orderA = await thisOrder(a.org.id, { ...CADASTRE });
    const orderB = await thisOrder(b.org.id, { ...CADASTRE });
    // Bare adresse og bare matrikkel i den andre organisasjonen også
    await otherOrder(b.org.id, { addressText: "Annet sted 2", ...CADASTRE });
    await otherOrder(a.org.id, { addressText: "Annet sted 2", ...CADASTRE });

    const fromA = await lookup(a.admin, a.org.id, orderA);
    const fromB = await lookup(b.admin, b.org.id, orderB);
    const idsInB = (
      await db.select({ id: orders.id }).from(orders).where(eq(orders.organizationId, b.org.id))
    ).map((row) => row.id);
    const idsInA = (
      await db.select({ id: orders.id }).from(orders).where(eq(orders.organizationId, a.org.id))
    ).map((row) => row.id);

    expect(fromA.items).toHaveLength(1);
    expect(fromB.items).toHaveLength(1);
    for (const item of fromA.items) expect(idsInB).not.toContain(item.id);
    for (const item of fromB.items) expect(idsInA).not.toContain(item.id);

    // Ordrefelt som ikke er lagret, uten exclude: bare egne treff
    const unsaved = {
      addressText: ADDRESS,
      ...CADASTRE,
      snr: null,
      receivedAt: TEST_NOW,
    };
    for (const item of (await findPossibleDuplicateOrdersFor(a.admin, a.org.id, unsaved)).items) {
      expect(idsInA).toContain(item.id);
    }
    for (const item of (await findPossibleDuplicateOrdersFor(b.admin, b.org.id, unsaved)).items) {
      expect(idsInB).toContain(item.id);
    }
  });

  it("3.6.4 IDOR: admin i A med orgA og Bs ordre-id gir AccessDeniedError", async () => {
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    await thisOrder(a.org.id);
    const orderB = await thisOrder(b.org.id);
    await otherOrder(b.org.id, { receivedAt: at(TEST_NOW, -DAY) });
    await expect(findPossibleDuplicateOrders(a.admin, a.org.id, orderB.id)).rejects.toThrow(
      AccessDeniedError,
    );
    // excludeOrderId fra B gir ingen informasjon om B: A får egne treff som før
    const result = await findPossibleDuplicateOrdersFor(a.admin, a.org.id, {
      addressText: ADDRESS,
      gnr: null,
      bnr: null,
      snr: null,
      receivedAt: TEST_NOW,
      excludeOrderId: orderB.id,
    });
    const idsInB = (
      await db.select({ id: orders.id }).from(orders).where(eq(orders.organizationId, b.org.id))
    ).map((row) => row.id);
    for (const item of result.items) expect(idsInB).not.toContain(item.id);
  });

  it("3.6.5 admin i A med orgB som argument gir AccessDeniedError på begge", async () => {
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    const orderB = await thisOrder(b.org.id);
    await otherOrder(b.org.id, { receivedAt: at(TEST_NOW, -DAY) });
    await expect(findPossibleDuplicateOrders(a.admin, b.org.id, orderB.id)).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(
      findPossibleDuplicateOrdersFor(a.admin, b.org.id, {
        addressText: ADDRESS,
        gnr: null,
        bnr: null,
        snr: null,
        receivedAt: TEST_NOW,
      }),
    ).rejects.toThrow(AccessDeniedError);
  });
});

// ---------------------------------------------------------------------------------------------
// 3.7 Logg uten persondata
// ---------------------------------------------------------------------------------------------

const LEAK_ADDRESS = "Lekkasjeveien 47Q, 8099 Prøvested";
const LEAK_KEY = "lekkasjeveien47q";
const LEAK_GNR = "87123";
const LEAK_BNR = "45678";
const LEAK_SNR = "73519";
const SECRETS = [
  LEAK_ADDRESS,
  "Lekkasjeveien",
  LEAK_KEY,
  "Prøvested",
  LEAK_GNR,
  LEAK_BNR,
  LEAK_SNR,
];

function spyOnLogger() {
  return (["debug", "info", "warn", "error"] as const).map((level) => vi.spyOn(logger, level));
}

function loggedText(spies: ReturnType<typeof spyOnLogger>): string {
  return spies
    .flatMap((spy) => spy.mock.calls)
    .map((call) =>
      JSON.stringify(call, (_key, value) =>
        value instanceof Error
          ? { name: value.name, message: value.message, stack: value.stack, cause: value.cause }
          : value,
      ),
    )
    .join("\n");
}

function expectNoSecrets(text: string, where: string) {
  for (const secret of SECRETS) {
    expect(text.includes(secret), `«${secret}» i ${where}`).toBe(false);
  }
}

describe("3.7 logg uten persondata", () => {
  it("3.7.1 vanlig kall med treff: ingen adresse, nøkkel, gnr, bnr eller snr i loggen", async () => {
    const spies = spyOnLogger();
    const { org, admin } = await orgWithAdmin();
    const leak = { gnr: LEAK_GNR, bnr: LEAK_BNR, snr: LEAK_SNR };
    const order = await thisOrder(org.id, { addressText: LEAK_ADDRESS, ...leak });
    await otherOrder(org.id, {
      addressText: LEAK_ADDRESS,
      ...leak,
      receivedAt: at(TEST_NOW, -DAY),
    });

    const viaOrder = await findPossibleDuplicateOrders(admin, org.id, order.id);
    const viaFields = await findPossibleDuplicateOrdersFor(admin, org.id, {
      addressText: LEAK_ADDRESS,
      ...leak,
      receivedAt: TEST_NOW,
    });
    expect(viaOrder.items).toHaveLength(1);
    expect(viaFields.items).toHaveLength(2);
    expectNoSecrets(loggedText(spies), "loggen");
  });

  it("3.7.2 feilgrenen: databasefeil gir feil og logg uten verdier og uten SQL med parametre", async () => {
    const { org, admin } = await orgWithAdmin();
    const leak = { gnr: LEAK_GNR, bnr: LEAK_BNR, snr: LEAK_SNR };
    const order = await thisOrder(org.id, { addressText: LEAK_ADDRESS, ...leak });

    // Tving en databasefeil bare i oppslaget av treff (spørringen som henter adressen til andre
    // ordre). Feilen ligner en PostgreSQL-feil med SQL-tekst og parametre.
    const rawSql = `select ... where address_text = $1 and gnr = $2 -- params: ${LEAK_KEY}, ${LEAK_GNR}, ${LEAK_BNR}, ${LEAK_SNR}`;
    const original = db.select.bind(db);
    let injected = 0;
    vi.spyOn(db, "select").mockImplementation(((fields?: Record<string, unknown>) => {
      const builder = original(fields as never);
      const isDuplicateLookup =
        fields !== undefined &&
        "addressText" in fields &&
        "receivedAt" in fields &&
        !("rowVersion" in fields) &&
        !("housingAssociationName" in fields);
      if (!isDuplicateLookup) return builder;
      injected += 1;
      const failure = Object.assign(new Error(`Failed query: ${rawSql}`), {
        name: "PostgresError",
        code: "57014",
        query: rawSql,
        parameters: [LEAK_KEY, LEAK_GNR, LEAK_BNR, LEAK_SNR, LEAK_ADDRESS],
        cause: new Error(`canceling statement due to statement timeout: ${LEAK_ADDRESS}`),
      });
      // Hele kjeden (`from`, `leftJoin`, `where` …) pakkes inn, og `await` på slutten feiler.
      const failing = (target: object): object =>
        new Proxy(target, {
          get(inner, property, receiver) {
            if (property === "then") {
              return (_resolve: unknown, reject: (reason: unknown) => void) => reject(failure);
            }
            const value = Reflect.get(inner, property, receiver);
            if (typeof value !== "function") return value;
            return (...args: unknown[]) => {
              const next = value.apply(inner, args);
              if (next === inner) return receiver;
              return next !== null && typeof next === "object" ? failing(next) : next;
            };
          },
        });
      return failing(builder);
    }) as never);
    const spies = spyOnLogger();

    const errors = [
      await caught(findPossibleDuplicateOrders(admin, org.id, order.id)),
      await caught(
        findPossibleDuplicateOrdersFor(admin, org.id, {
          addressText: LEAK_ADDRESS,
          ...leak,
          receivedAt: TEST_NOW,
        }),
      ),
    ];
    expect(injected, "feilen ble tvunget i oppslaget").toBeGreaterThan(0);
    for (const error of errors) {
      expect(error, "oppslaget feiler").toBeDefined();
      const shown =
        error instanceof Error
          ? `${error.name} ${error.message} ${String(error.cause ?? "")}`
          : String(error);
      expectNoSecrets(shown, "feilen som kastes");
      expect(shown).not.toContain("address_text = $1");
    }
    const logged = loggedText(spies);
    expectNoSecrets(logged, "loggen");
    expect(logged).not.toContain("address_text = $1");
  });
});

// ---------------------------------------------------------------------------------------------
// 3.8 Ytelse (A291)
// ---------------------------------------------------------------------------------------------

/** Gjør `toSQL()` med `$1 …` om til et SQL-objekt med de samme parametrene. */
function withParams(text: string, params: unknown[]): SQL {
  const parts = text.split(/\$(\d+)/);
  const chunks: SQL[] = [];
  parts.forEach((part, index) => {
    if (index % 2 === 0) chunks.push(sql.raw(part));
    else chunks.push(sql`${params[Number(part) - 1]}`);
  });
  return sql.join(chunks, sql.raw(""));
}

async function explain(
  organizationId: string,
  criteria: Parameters<typeof possibleDuplicatesQuery>[1],
): Promise<string> {
  const query = possibleDuplicatesQuery(organizationId, criteria).toSQL();
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local enable_seqscan = off`);
    const result = (await tx.execute(
      sql`explain ${withParams(query.sql, query.params)}`,
    )) as unknown as { "QUERY PLAN": string }[];
    return result.map((row) => row["QUERY PLAN"]).join("\n");
  });
}

async function indexNames(): Promise<{ address: string; cadastre: string }> {
  const rows = (await db.execute(sql`
    select indexname, indexdef from pg_indexes
    where schemaname = current_schema() and tablename = 'orders'`)) as unknown as {
    indexname: string;
    indexdef: string;
  }[];
  const address = rows.find((row) => /split_part/i.test(row.indexdef));
  const cadastre = rows.find((row) => /\bgnr\b/.test(row.indexdef) && /\bbnr\b/.test(row.indexdef));
  return {
    address: address?.indexname ?? "(mangler)",
    cadastre: cadastre?.indexname ?? "(mangler)",
  };
}

describe("3.8 ytelse", () => {
  async function seedMany(organizationId: string) {
    for (let index = 0; index < 60; index += 1) {
      await createOrder(organizationId, {
        addressText: `Testveien ${index + 1}, 8000 Bodø`,
        gnr: String(1000 + index),
        bnr: String(index + 1),
        receivedAt: at(TEST_NOW, -index * DAY),
      });
    }
    await db.execute(sql`analyze orders`);
  }

  it("3.8.1 og 3.8.3 adresse: ingen Seq Scan på orders, og adresseindeksen brukes", async () => {
    const { org } = await orgWithAdmin();
    await seedMany(org.id);
    const plan = await explain(org.id, {
      addressKey: "testveien12",
      cadastre: null,
      receivedAt: TEST_NOW,
      excludeOrderId: null,
    });
    expect(plan).not.toMatch(/Seq Scan on orders/);
    expect(plan).toContain((await indexNames()).address);
  });

  it("3.8.2 og 3.8.3 matrikkel: ingen Seq Scan på orders, og matrikkelindeksen brukes", async () => {
    const { org } = await orgWithAdmin();
    await seedMany(org.id);
    const plan = await explain(org.id, {
      addressKey: null,
      cadastre: { gnr: "1011", bnr: "12", snr: "" },
      receivedAt: TEST_NOW,
      excludeOrderId: null,
    });
    expect(plan).not.toMatch(/Seq Scan on orders/);
    expect(plan).toContain((await indexNames()).cadastre);
  });
});

// ---------------------------------------------------------------------------------------------
// 3.9 Myk sletting
// ---------------------------------------------------------------------------------------------

describe("3.9 myk sletting", () => {
  it("3.9.1 de nye filene for mulig dublett sletter aldri permanent", () => {
    const dir = join(process.cwd(), "src/core/orders");
    const files = readdirSync(dir).filter(
      (name) => /dup/i.test(name) && name.endsWith(".ts") && !name.endsWith(".test.ts"),
    );
    expect(files.length, "filene for mulig dublett finnes").toBeGreaterThan(0);
    for (const name of files) {
      const source = readFileSync(join(dir, name), "utf8");
      expect(source, name).not.toMatch(/\b(db|tx)\.delete\(/);
      expect(source, name).not.toMatch(/DELETE\s+FROM/i);
    }
  });
});
