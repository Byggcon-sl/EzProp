import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { assignments, orders, type EmployeeRole } from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import {
  createAssignment,
  createEmployee,
  createOrder as insertOrder,
  createOrganization,
  createUser,
  resetDatabase,
  TEST_NOW,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import {
  ORDER_ADDRESS_KEY_INDEX,
  ORDER_ADDRESS_KEY_SQL,
  ORDER_BNR_KEY_SQL,
  ORDER_CADASTRE_KEY_INDEX,
  ORDER_GNR_KEY_SQL,
  ORDER_SNR_KEY_SQL,
  possibleDuplicatesQuery,
} from "./duplicate-sql";
import {
  DUPLICATE_REASONS,
  duplicateReasonLabel,
  duplicateReasons,
  findPossibleDuplicateOrders,
  findPossibleDuplicateOrdersFor,
  isWithinDuplicateWindow,
  MAX_DUPLICATE_WINDOW_DAYS,
  normalizeAddressKey,
  normalizeCadastreNumber,
} from "./index";

/*
 * Utviklerens tester for kjernen i varsel om mulig dublett (T3,
 * docs/funksjoner/fase2a-varsel-dublett.md). Testskriveren dekker hele testplanen i egne filer.
 * Testdata er oppdiktet: «Fjordbakken 7», gnr/bnr 9999/123.
 *
 * Støtter hovedmål: færre reklamasjoner (regelen er låst med testsaker), KI i bunnen (tjenesten
 * virker for ordrefelt som ikke er lagret) og de ansatte (oppslaget bruker indeks).
 */

beforeEach(resetDatabase);

const DAY_MS = 24 * 3600 * 1000;
const ADDRESS = "Fjordbakken 7B, 8099 Oppdiktet";

async function orgWithAdmin(name = "Testfirma takst") {
  const org = await createOrganization(name);
  const admin = await createUser();
  await createEmployee(admin, org.id, ["admin"]);
  return { org, admin };
}

async function convertedOrder(
  organizationId: string,
  orderOverrides: Partial<typeof orders.$inferInsert>,
  assignmentOverrides: Partial<typeof assignments.$inferInsert> = {},
) {
  const order = await insertOrder(organizationId, orderOverrides);
  // Oppdraget eier bestillingen (ADR 0011): feltene kopieres fra ordren, som i
  // `convertOrderToAssignment`.
  const assignment = await createAssignment(organizationId, {
    orderId: order.id,
    addressText: order.addressText,
    gnr: order.gnr,
    bnr: order.bnr,
    snr: order.snr,
    receivedAt: order.receivedAt,
    ...assignmentOverrides,
  });
  await db
    .update(orders)
    .set({ status: "converted", assignmentId: assignment.id })
    .where(eq(orders.id, order.id));
  return { order, assignment };
}

describe("rene funksjoner", () => {
  it.each([
    ["Storgata 1A, 8006 Bodø", "storgata1a"],
    ["STORGATA 1-A.", "storgata1a"],
    ["ØVRE GATE 2", "øvregate2"],
    ["Ærfuglveien 3", "ærfuglveien3"],
    [" , 8006 Bodø", null],
    ["-.", null],
    ["", null],
  ])("adressenøkkel for %j", (text, expected) => {
    expect(normalizeAddressKey(text)).toBe(expected);
  });

  it.each([
    ["012", "12"],
    [" 1 2 ", "12"],
    ["000", null],
    ["", null],
    [null, null],
  ])("matrikkelnummer for %j", (text, expected) => {
    expect(normalizeCadastreNumber(text)).toBe(expected);
  });

  it("grunner i fast rekkefølge, snr tom = «0», gnr «0» gir ikke treff", () => {
    const base = { addressText: "Fjordbakken 7", gnr: "9999", bnr: "123", snr: null };
    expect(duplicateReasons(base, { ...base, snr: "0" })).toEqual(["address", "cadastre"]);
    expect(duplicateReasons(base, { ...base, addressText: "Annen vei 1", gnr: "09999" })).toEqual([
      "cadastre",
    ]);
    expect(duplicateReasons({ ...base, gnr: "0" }, { ...base, gnr: "000" })).toEqual(["address"]);
    expect(duplicateReasons(base, { ...base, snr: "2" })).toEqual(["address"]);
  });

  it("tidsvinduet er 90 × 24 timer og grensen teller med", () => {
    expect(MAX_DUPLICATE_WINDOW_DAYS).toBe(90);
    const a = new Date("2026-01-15T10:00:00Z");
    expect(isWithinDuplicateWindow(a, new Date(a.getTime() + 90 * DAY_MS))).toBe(true);
    expect(isWithinDuplicateWindow(new Date(a.getTime() + 90 * DAY_MS + 1000), a)).toBe(false);
  });

  it("hver grunn har tekst", () => {
    expect(DUPLICATE_REASONS).toEqual(["address", "cadastre"]);
    expect(DUPLICATE_REASONS.map(duplicateReasonLabel)).toEqual([
      "samme adresse",
      "samme matrikkel",
    ]);
  });
});

describe("paritet TS mot SQL", () => {
  const addresses = [
    "Storgata 1A, 8006 Bodø",
    "storgata 1 a",
    "ØVRE GATE 2",
    "Ovre gate 2",
    "Ærfuglveien 3",
    "André-vei 4",
    ",",
    " , 8006 Bodø",
    "-.",
    "",
  ];
  const numbers = ["012", " 1 2 ", "0", "000", "", "  ", "1 2", "\t7\n"];

  async function evaluate(expression: string, column: string, values: string[]) {
    const rows = await db.execute<{ v: string; k: string | null }>(
      sql`select t.${sql.identifier(column)} as v, ${sql.raw(expression)} as k
          from unnest(${sql.param(values)}::text[]) with ordinality as t(${sql.identifier(column)}, n)
          order by n`,
    );
    return rows.map((row) => row.k);
  }

  it("adressen gir samme nøkkel", async () => {
    expect(await evaluate(ORDER_ADDRESS_KEY_SQL, "address_text", addresses)).toEqual(
      addresses.map(normalizeAddressKey),
    );
  });

  it.each([
    ["gnr", ORDER_GNR_KEY_SQL],
    ["bnr", ORDER_BNR_KEY_SQL],
    ["snr", ORDER_SNR_KEY_SQL],
  ])("%s gir samme nøkkel", async (column, expression) => {
    expect(await evaluate(expression, column, numbers)).toEqual(
      numbers.map(normalizeCadastreNumber),
    );
  });

  it("indeksene finnes med organization_id først", async () => {
    const rows = await db.execute<{ indexname: string; indexdef: string }>(sql`
      select indexname, indexdef from pg_indexes
      where tablename = 'orders' and indexname in (${ORDER_ADDRESS_KEY_INDEX}, ${ORDER_CADASTRE_KEY_INDEX})
      order by indexname
    `);
    expect(rows.map((row) => row.indexname)).toEqual([
      ORDER_ADDRESS_KEY_INDEX,
      ORDER_CADASTRE_KEY_INDEX,
    ]);
    for (const row of rows) expect(row.indexdef).toContain("btree (organization_id, ");
  });
});

describe("oppslaget mot databasen", () => {
  it("finner samme adresse og matrikkel, én rad per ordre, ikke ordren selv", async () => {
    const { org, admin } = await orgWithAdmin();
    const self = await insertOrder(org.id, { addressText: ADDRESS, gnr: "9999", bnr: "123" });
    const both = await insertOrder(org.id, {
      addressText: "fjordbakken 7 b",
      gnr: "09999",
      bnr: "123",
      snr: "0",
    });
    const cadastreOnly = await insertOrder(org.id, {
      addressText: "Annen vei 1",
      gnr: "9999",
      bnr: "123",
      receivedAt: new Date(TEST_NOW.getTime() - 1000),
    });
    await insertOrder(org.id, { addressText: "Fjordbakken 7C", gnr: "9999", bnr: "124" });

    const result = await findPossibleDuplicateOrders(admin, org.id, self.id);
    expect(result.hasMore).toBe(false);
    expect(result.items.map((item) => [item.id, item.reasons])).toEqual([
      [both.id, ["address", "cadastre"]],
      [cadastreOnly.id, ["cadastre"]],
    ]);
    expect(Object.keys(result.items[0] ?? {}).sort()).toEqual(
      [
        "addressText",
        "assignmentNumber",
        "assignmentStatus",
        "id",
        "kind",
        "reasons",
        "receivedAt",
        "status",
      ].sort(),
    );
    expect(result.items[0]?.receivedAt).toBeInstanceOf(Date);
  });

  it("status og tidsvindu", async () => {
    const { org, admin } = await orgWithAdmin();
    const at = (days: number, seconds = 0) =>
      new Date(TEST_NOW.getTime() - days * DAY_MS - seconds * 1000);

    const oldOpen = await insertOrder(org.id, { addressText: ADDRESS, receivedAt: at(200) });
    await insertOrder(org.id, {
      addressText: ADDRESS,
      status: "rejected",
      rejectedReason: "Dobbel",
    });
    const deleted = await insertOrder(org.id, { addressText: ADDRESS });
    await db.update(orders).set({ deletedAt: TEST_NOW }).where(eq(orders.id, deleted.id));
    const inProgress = await convertedOrder(
      org.id,
      { addressText: ADDRESS, receivedAt: at(300) },
      { status: "in_progress" },
    );
    await convertedOrder(
      org.id,
      { addressText: ADDRESS, receivedAt: at(1) },
      { status: "ordered", deletedAt: TEST_NOW },
    );
    const edge = await convertedOrder(
      org.id,
      { addressText: ADDRESS, receivedAt: at(90) },
      { status: "completed" },
    );
    await convertedOrder(
      org.id,
      { addressText: ADDRESS, receivedAt: at(90, 1) },
      { status: "invoiced" },
    );
    const after = await convertedOrder(
      org.id,
      { addressText: ADDRESS, receivedAt: new Date(TEST_NOW.getTime() + 90 * DAY_MS) },
      { status: "invoiced" },
    );

    const result = await findPossibleDuplicateOrdersFor(admin, org.id, {
      addressText: ADDRESS,
      gnr: null,
      bnr: null,
      snr: null,
      receivedAt: TEST_NOW,
    });
    expect(result.items.map((item) => item.id)).toEqual([
      after.order.id,
      edge.order.id,
      oldOpen.id,
      inProgress.order.id,
    ]);
    const converted = result.items.find((item) => item.id === inProgress.order.id);
    expect(converted?.assignmentNumber).toBe(inProgress.assignment.number);
    expect(converted?.assignmentStatus).toBe("in_progress");
    expect(converted?.status).toBe("converted");
  });

  it("11 treff gir 10 og hasMore, fast rekkefølge", async () => {
    const { org, admin } = await orgWithAdmin();
    for (let i = 0; i < 11; i += 1) {
      await insertOrder(org.id, {
        addressText: ADDRESS,
        receivedAt: new Date(TEST_NOW.getTime() - (i < 3 ? 0 : i) * DAY_MS),
      });
    }
    const fields = { addressText: ADDRESS, gnr: null, bnr: null, snr: null, receivedAt: TEST_NOW };
    const first = await findPossibleDuplicateOrdersFor(admin, org.id, fields);
    const second = await findPossibleDuplicateOrdersFor(admin, org.id, fields);
    expect(first.items).toHaveLength(10);
    expect(first.hasMore).toBe(true);
    expect(second.items.map((item) => item.id)).toEqual(first.items.map((item) => item.id));
  });

  it("avvist ordre gir tom liste; ugyldig id og ugyldige felt gir feil uten databasefeil", async () => {
    const { org, admin } = await orgWithAdmin();
    await insertOrder(org.id, { addressText: ADDRESS });
    const rejected = await insertOrder(org.id, {
      addressText: ADDRESS,
      status: "rejected",
      rejectedReason: "Dobbel",
    });
    expect(await findPossibleDuplicateOrders(admin, org.id, rejected.id)).toEqual({
      items: [],
      hasMore: false,
    });
    await expect(findPossibleDuplicateOrders(admin, org.id, "ikke-en-id")).rejects.toThrow(
      AccessDeniedError,
    );
    const base = { addressText: ADDRESS, gnr: null, bnr: null, snr: null };
    await expect(
      findPossibleDuplicateOrdersFor(admin, org.id, { ...base, receivedAt: "ikke en dato" }),
    ).rejects.toMatchObject({ name: "ZodError" });
    await expect(
      findPossibleDuplicateOrdersFor(admin, org.id, {
        ...base,
        receivedAt: TEST_NOW,
        excludeOrderId: "ikke-en-id",
      }),
    ).rejects.toMatchObject({ name: "ZodError" });
  });
});

describe("tilgang og tenant-isolasjon", () => {
  it.each<EmployeeRole[]>([["inspector"], ["office"], ["manager"], ["admin"]])(
    "%s får svar",
    async (role) => {
      const { org } = await orgWithAdmin();
      const actor = await createUser();
      await createEmployee(actor, org.id, [role]);
      const order = await insertOrder(org.id, { addressText: ADDRESS });
      await insertOrder(org.id, { addressText: ADDRESS });
      expect((await findPossibleDuplicateOrders(actor, org.id, order.id)).items).toHaveLength(1);
    },
  );

  it("bruker uten ansattrad får AccessDeniedError", async () => {
    const { org } = await orgWithAdmin();
    const stranger: Actor = await createUser();
    const order = await insertOrder(org.id, { addressText: ADDRESS });
    await expect(findPossibleDuplicateOrders(stranger, org.id, order.id)).rejects.toThrow(
      AccessDeniedError,
    );
  });

  it("findPossibleDuplicateOrdersFor holder organisasjonene adskilt", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = [
          await insertOrder(grantA.organizationId, {
            addressText: ADDRESS,
            gnr: "9999",
            bnr: "123",
          }),
          await insertOrder(grantA.organizationId, { addressText: ADDRESS }),
        ];
        const b = [
          await insertOrder(grantB.organizationId, {
            addressText: ADDRESS,
            gnr: "9999",
            bnr: "123",
          }),
          await insertOrder(grantB.organizationId, { addressText: ADDRESS }),
        ];
        return { a: a.map((row) => row.id), b: b.map((row) => row.id) };
      },
      query: async (actor, organizationId) =>
        (
          await findPossibleDuplicateOrdersFor(actor, organizationId, {
            addressText: ADDRESS,
            gnr: "9999",
            bnr: "123",
            snr: null,
            receivedAt: TEST_NOW,
          })
        ).items,
      idOf: (row) => row.id,
    });
  });

  it("findPossibleDuplicateOrders holder organisasjonene adskilt", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = [
          await insertOrder(grantA.organizationId, { addressText: ADDRESS }),
          await insertOrder(grantA.organizationId, { addressText: ADDRESS }),
          await insertOrder(grantA.organizationId, { addressText: ADDRESS }),
        ];
        const b = [
          await insertOrder(grantB.organizationId, { addressText: ADDRESS }),
          await insertOrder(grantB.organizationId, { addressText: ADDRESS }),
          await insertOrder(grantB.organizationId, { addressText: ADDRESS }),
        ];
        return { a: a.slice(1).map((row) => row.id), b: b.slice(1).map((row) => row.id) };
      },
      query: async (actor, organizationId) => {
        // Den eldste-id-ordren i organisasjonen er «denne»; de to andre er treffene.
        const [own] = await db
          .select({ id: orders.id })
          .from(orders)
          .where(eq(orders.organizationId, organizationId))
          .orderBy(orders.createdAt, orders.id)
          .limit(1);
        if (!own) return [];
        return (await findPossibleDuplicateOrders(actor, organizationId, own.id)).items;
      },
      idOf: (row) => row.id,
    });
  });

  it("IDOR: ordre-id fra en annen organisasjon gir AccessDeniedError", async () => {
    const a = await orgWithAdmin("Testfirma A");
    const b = await orgWithAdmin("Testfirma B");
    const foreign = await insertOrder(b.org.id, { addressText: ADDRESS });
    await expect(findPossibleDuplicateOrders(a.admin, a.org.id, foreign.id)).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(findPossibleDuplicateOrders(a.admin, b.org.id, foreign.id)).rejects.toThrow(
      AccessDeniedError,
    );
  });
});

describe("logg og ytelse", () => {
  it("loggen har aldri adresse eller matrikkel, heller ikke ved feil", async () => {
    const { org, admin } = await orgWithAdmin();
    const address = "Qzxyveien 4417, 8099 Oppdiktet";
    await insertOrder(org.id, { addressText: address, gnr: "77311", bnr: "88422" });
    const spies = (["debug", "info", "warn", "error"] as const).map((level) =>
      vi.spyOn(logger, level),
    );
    const fields = {
      addressText: address,
      gnr: "77311",
      bnr: "88422",
      snr: "99533",
      receivedAt: TEST_NOW,
    };
    await findPossibleDuplicateOrdersFor(admin, org.id, fields);
    // Bare spørringen for mulig dublett feiler (tilgangssjekken bruker også `db.select`).
    const originalSelect = db.select.bind(db);
    const failing = vi.spyOn(db, "select").mockImplementation(((selection?: object) => {
      if (selection && "addressMatch" in selection) {
        throw new Error(`Failed query: select ... params: ${address},77311`);
      }
      return selection ? originalSelect(selection as never) : originalSelect();
    }) as typeof db.select);
    await expect(findPossibleDuplicateOrdersFor(admin, org.id, fields)).rejects.toThrow(
      "Oppslaget om mulig dublett feilet.",
    );
    failing.mockRestore();
    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    for (const secret of [
      "Qzxyveien",
      "qzxyveien4417",
      "77311",
      "88422",
      "99533",
      "Failed query",
    ]) {
      expect(logged).not.toContain(secret);
    }
    expect(spies.some((spy) => spy.mock.calls.length > 0)).toBe(true);
    for (const spy of spies) spy.mockRestore();
  });

  it.each([
    ["adresse", { addressKey: "fjordbakken7b", cadastre: null }, ORDER_ADDRESS_KEY_INDEX],
    [
      "matrikkel",
      { addressKey: null, cadastre: { gnr: "9999", bnr: "123", snr: "" } },
      ORDER_CADASTRE_KEY_INDEX,
    ],
  ] as const)("oppslaget på %s bruker indeksen", async (_name, keys, indexName) => {
    const { org } = await orgWithAdmin();
    // Med tom tabell velger planleggeren indeksen på mottatt-tid (sorteringen). Med noen hundre
    // ulike ordre og ferske statistikker viser planen at uttrykksindeksen kan brukes.
    await db.insert(orders).values(
      Array.from({ length: 500 }, (_, i) => ({
        organizationId: org.id,
        addressText: `Testgate ${i}, 8099 Oppdiktet`,
        gnr: String(1000 + i),
        bnr: String(i),
        receivedAt: new Date(TEST_NOW.getTime() - i * 3600 * 1000),
      })),
    );
    await db.execute(sql`analyze orders`);
    const query = possibleDuplicatesQuery(org.id, {
      ...keys,
      receivedAt: TEST_NOW,
      excludeOrderId: null,
    });
    const plan = await db.transaction(async (tx) => {
      await tx.execute(sql`set local enable_seqscan = off`);
      const rows = await tx.execute<{ "QUERY PLAN": string }>(sql`explain ${query}`);
      return rows.map((row) => row["QUERY PLAN"]).join("\n");
    });
    expect(plan).not.toMatch(/Seq Scan on orders/);
    expect(plan).toContain(indexName);
  });

  it("filen sletter aldri permanent", () => {
    for (const file of ["possible-duplicates.ts", "duplicate-sql.ts", "duplicates.ts"]) {
      const source = readFileSync(path.join(__dirname, file), "utf8");
      expect(source).not.toMatch(/\.delete\(|DELETE FROM/i);
    }
  });
});
