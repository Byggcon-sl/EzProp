import { readFileSync } from "node:fs";
import path from "node:path";
import { count, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError, type Actor } from "@/core/access";
import { countWorkQueueByStatus, listWorkQueue } from "@/core/assignments";
import { db } from "@/db/client";
import {
  aiUsageLog,
  assignments,
  auditLog,
  cadastralUnits,
  events,
  orders,
  type EmployeeRole,
} from "@/db/schema";
import {
  createAiUsageLog,
  createAssignment,
  createAssignmentParty,
  createEmployee,
  createOrder as insertOrder,
  createOrganization,
  createProperty,
  createUser,
  resetDatabase,
  TEST_NOW,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { listOrders, orderListSummary } from "./index";
import { ORDER_LIST_LIMIT, type OrderListItem } from "./list";

/*
 * Søk, grense og total i ordrelisten mot databasen
 * (docs/funksjoner/fase2a-sok-ordre-arbeidsko-testplan.md avsnitt 3 og 6).
 *
 * Signaturen (testplanen, «Avtale om signaturer»):
 * - listOrders(actor, organizationId, { query? }) → { items, total }, ORDER_LIST_LIMIT = 50
 * - orderListSummary(shown, total) → «Viser 50 av N. Bruk søket for å finne flere.» eller null
 *
 * Testdata er oppdiktet: «Fjordgata 7», «Megler Fjordsen», gnr/bnr 12/34 og 999/999. Ingen ekte
 * navn, adresser eller matrikler.
 *
 * Søket trenger nett (listen hentes fra serveren). Befaringen og synken berøres ikke.
 *
 * Støtter hovedmål: de ansatte (kontoret finner ordren med ett søk uansett hvilket felt megleren
 * oppgir), reklamasjoner (matrikkel del for del, ingen treff fra andre organisasjoner, ingen doble
 * rader) og KI i bunnen (søket lager ingen rader i loggene og går aldri til KI).
 */

beforeEach(resetDatabase);

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

/** En person med rollene i organisasjonen. */
async function person(organizationId: string, roles: EmployeeRole[]) {
  const actor = await createUser();
  const employee = await createEmployee(actor, organizationId, roles);
  return { actor, employee };
}

/** Organisasjon med admin. */
async function orgWithAdmin(name = "Testfirma takst") {
  const org = await createOrganization(name);
  const { actor: admin, employee: adminEmployee } = await person(org.id, ["admin"]);
  return { org, admin, adminEmployee };
}

/** En ordre som er gjort om til et oppdrag (fabrikkene, ikke nummerserien). */
async function convertedOrder(
  organizationId: string,
  orderOverrides: Partial<typeof orders.$inferInsert> = {},
  assignmentOverrides: Partial<typeof assignments.$inferInsert> = {},
) {
  const order = await insertOrder(organizationId, orderOverrides);
  const assignment = await createAssignment(organizationId, {
    orderId: order.id,
    ...assignmentOverrides,
  });
  const [converted] = await db
    .update(orders)
    .set({ status: "converted", assignmentId: assignment.id })
    .where(eq(orders.id, order.id))
    .returning();
  if (!converted) throw new Error("kunne ikke gjøre om ordren");
  return { order: converted, assignment };
}

async function search(actor: Actor, organizationId: string, query?: string | null) {
  return listOrders(actor, organizationId, query === undefined ? undefined : { query });
}

async function searchIds(actor: Actor, organizationId: string, query: string) {
  return (await search(actor, organizationId, query)).items.map((row) => row.id);
}

// ---------------------------------------------------------------------------------------------
// Feltene som søkes. Hver sak legger inn én ordre som treffer i feltet, og gir id-en tilbake.
// `query` er en del av verdien med andre store/små bokstaver enn i databasen.
// ---------------------------------------------------------------------------------------------

type FieldCase = {
  name: string;
  value: string;
  query: string;
  /** Legger inn en ordre i organisasjonen som treffer på `value` i feltet. Gir ordrens id. */
  seed: (organizationId: string, value: string) => Promise<string>;
};

const FIELD_CASES: FieldCase[] = [
  {
    name: "orders.address_text",
    value: "Fjordgata 7, 8000 Bodø",
    query: "FJORDG",
    seed: async (org, value) => (await insertOrder(org, { addressText: value })).id,
  },
  {
    name: "properties.address",
    value: "Fjellveien 3",
    query: "fjellV",
    seed: async (org, value) => {
      const { order, assignment } = await convertedOrder(org);
      await createProperty(org, { assignmentId: assignment.id, address: value });
      return order.id;
    },
  },
  {
    name: "assignments.number",
    value: "2026-77001",
    query: "77001",
    seed: async (org, value) => (await convertedOrder(org, {}, { number: value })).order.id,
  },
  {
    name: "orders.external_ref",
    value: "ORD-ABC-551",
    query: "abc-551",
    seed: async (org, value) => (await insertOrder(org, { externalRef: value })).id,
  },
  {
    name: "orders.ordered_by_text",
    value: "Megler Fjordsen, Testmegleren AS",
    query: "FJORDSEN",
    seed: async (org, value) => (await insertOrder(org, { orderedByText: value })).id,
  },
  {
    name: "assignment_parties.name",
    value: "Kari Hansevik",
    query: "HANSEVIK",
    seed: async (org, value) => {
      const { order, assignment } = await convertedOrder(org);
      await createAssignmentParty(org, { assignmentId: assignment.id, name: value });
      return order.id;
    },
  },
  {
    name: "assignment_parties.firm_name",
    value: "Fjellmegleren Nord AS",
    query: "fjellmegleren NORD",
    seed: async (org, value) => {
      const { order, assignment } = await convertedOrder(org);
      await createAssignmentParty(org, {
        assignmentId: assignment.id,
        name: "Megler Test",
        firmName: value,
      });
      return order.id;
    },
  },
  {
    name: "matrikkel fra ordren (gnr, bnr, snr)",
    value: "12/34/0/5",
    query: "12/34",
    seed: async (org) => (await insertOrder(org, { gnr: "12", bnr: "34", snr: "5" })).id,
  },
  {
    name: "matrikkel fra cadastral_units",
    value: "12/34",
    query: "12/34",
    seed: async (org) => {
      const { order, assignment } = await convertedOrder(org);
      await createProperty(org, { assignmentId: assignment.id, gnr: "12", bnr: "34" });
      return order.id;
    },
  },
];

/** Ordre i samme organisasjon som ikke treffer noen av søkene i FIELD_CASES. */
async function seedNoise(organizationId: string): Promise<string[]> {
  const plain = await insertOrder(organizationId, {
    addressText: "Annenvei 1, 8000 Bodø",
    externalRef: "REF-0001",
    orderedByText: "Megler Test, Testmegleren AS",
    gnr: "999",
    bnr: "999",
  });
  const { order, assignment } = await convertedOrder(organizationId, {
    addressText: "Annenvei 2, 8000 Bodø",
  });
  await createProperty(organizationId, { assignmentId: assignment.id, address: "Testveien 1" });
  await createAssignmentParty(organizationId, {
    assignmentId: assignment.id,
    name: "Megler Test",
    firmName: "Testmegleren AS",
  });
  return [plain.id, order.id];
}

// ---------------------------------------------------------------------------------------------
// 3.1 Treff per felt
// ---------------------------------------------------------------------------------------------

describe("3.1 treff per felt", () => {
  it.each(FIELD_CASES)("$name", async ({ value, query, seed }) => {
    const { org, admin } = await orgWithAdmin();
    const hit = await seed(org.id, value);
    const noise = await seedNoise(org.id);

    const result = await search(admin, org.id, query);
    expect(result.items.map((row) => row.id)).toEqual([hit]);
    expect(result.total).toBe(1);
    for (const id of noise) expect(result.items.map((row) => row.id)).not.toContain(id);
  });

  it.each(FIELD_CASES.filter((c) => !c.name.startsWith("matrikkel")))(
    "$name: store og små bokstaver gir samme treff",
    async ({ value, query, seed }) => {
      const { org, admin } = await orgWithAdmin();
      const hit = await seed(org.id, value);
      await seedNoise(org.id);
      expect(await searchIds(admin, org.id, query.toLowerCase())).toEqual([hit]);
      expect(await searchIds(admin, org.id, query.toUpperCase())).toEqual([hit]);
    },
  );

  it("uten søk står alle ordrene i listen", async () => {
    const { org, admin } = await orgWithAdmin();
    const noise = await seedNoise(org.id);
    for (const query of [undefined, null, "", "   "]) {
      const result = await search(admin, org.id, query);
      expect(result.items.map((row) => row.id).sort()).toEqual([...noise].sort());
      expect(result.total).toBe(noise.length);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 3.2 Ingen doble rader
// ---------------------------------------------------------------------------------------------

describe("3.2 ingen doble rader", () => {
  it("3.2.1 to parter på samme oppdrag treffer: ordren én gang", async () => {
    const { org, admin } = await orgWithAdmin();
    const { order, assignment } = await convertedOrder(org.id);
    await createAssignmentParty(org.id, { assignmentId: assignment.id, name: "Ola Hansen" });
    await createAssignmentParty(org.id, {
      assignmentId: assignment.id,
      role: "buyer",
      name: "Kari Hansen",
    });

    const result = await search(admin, org.id, "Hansen");
    expect(result.items.map((row) => row.id)).toEqual([order.id]);
    expect(result.total).toBe(1);
  });

  it("3.2.2 part og adresse treffer samtidig: én rad", async () => {
    const { org, admin } = await orgWithAdmin();
    const { order, assignment } = await convertedOrder(org.id, {
      addressText: "Hansenveien 4, 8000 Bodø",
    });
    await createProperty(org.id, { assignmentId: assignment.id, address: "Hansenveien 4" });
    await createAssignmentParty(org.id, { assignmentId: assignment.id, name: "Ola Hansen" });

    const result = await search(admin, org.id, "hansen");
    expect(result.items.map((row) => row.id)).toEqual([order.id]);
    expect(result.total).toBe(1);
  });

  it("3.2.3 to matrikkelrader på samme eiendom treffer: én rad", async () => {
    const { org, admin } = await orgWithAdmin();
    const { order, assignment } = await convertedOrder(org.id);
    const { property } = await createProperty(org.id, {
      assignmentId: assignment.id,
      gnr: "12",
      bnr: "34",
    });
    await db
      .insert(cadastralUnits)
      .values({ organizationId: org.id, propertyId: property.id, gnr: "12", bnr: "34", snr: "5" });

    const result = await search(admin, org.id, "12/34");
    expect(result.items.map((row) => row.id)).toEqual([order.id]);
    expect(result.total).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// 3.3 Matrikkel del for del
// ---------------------------------------------------------------------------------------------

type Cadastre = { gnr: string; bnr: string; fnr?: string | null; snr?: string | null };

/** Ordre med oppdrag og eiendom med matrikkelen. */
async function orderWithCadastre(organizationId: string, cadastre: Cadastre) {
  const { order, assignment } = await convertedOrder(organizationId);
  await createProperty(organizationId, { assignmentId: assignment.id, ...cadastre });
  return order.id;
}

describe("3.3 matrikkel del for del", () => {
  it("3.3.1 «12/34» finner 12/34 og 12/34/0/5, ikke 112/34, 12/345, 2/34 eller 12/3", async () => {
    const { org, admin } = await orgWithAdmin();
    const onOrder = (await insertOrder(org.id, { gnr: "12", bnr: "34" })).id;
    const onUnit = await orderWithCadastre(org.id, { gnr: "12", bnr: "34", fnr: "0", snr: "5" });
    const wrong = [
      (await insertOrder(org.id, { gnr: "112", bnr: "34" })).id,
      (await insertOrder(org.id, { gnr: "12", bnr: "345" })).id,
      (await insertOrder(org.id, { gnr: "2", bnr: "34" })).id,
      (await insertOrder(org.id, { gnr: "12", bnr: "3" })).id,
      await orderWithCadastre(org.id, { gnr: "112", bnr: "34" }),
      await orderWithCadastre(org.id, { gnr: "12", bnr: "345" }),
      await orderWithCadastre(org.id, { gnr: "2", bnr: "34" }),
      await orderWithCadastre(org.id, { gnr: "12", bnr: "3" }),
    ];

    const ids = await searchIds(admin, org.id, "12/34");
    expect(ids.sort()).toEqual([onOrder, onUnit].sort());
    for (const id of wrong) expect(ids).not.toContain(id);
  });

  it("3.3.2 «12/34/0/5» finner 12/34/0/5 og 12/34 uten fnr med snr 5, ikke 12/34/0/6 eller 12/34/1/5", async () => {
    const { org, admin } = await orgWithAdmin();
    const exact = await orderWithCadastre(org.id, { gnr: "12", bnr: "34", fnr: "0", snr: "5" });
    const noFnr = await orderWithCadastre(org.id, { gnr: "12", bnr: "34", fnr: null, snr: "5" });
    const otherSnr = await orderWithCadastre(org.id, { gnr: "12", bnr: "34", fnr: "0", snr: "6" });
    const otherFnr = await orderWithCadastre(org.id, { gnr: "12", bnr: "34", fnr: "1", snr: "5" });

    const ids = await searchIds(admin, org.id, "12/34/0/5");
    expect(ids.sort()).toEqual([exact, noFnr].sort());
    expect(ids).not.toContain(otherSnr);
    expect(ids).not.toContain(otherFnr);
  });

  it("3.3.3 «12/34/0/5» mot ordren (uten fnr): gnr, bnr og snr like gir treff", async () => {
    const { org, admin } = await orgWithAdmin();
    const hit = (await insertOrder(org.id, { gnr: "12", bnr: "34", snr: "5" })).id;
    const otherSnr = (await insertOrder(org.id, { gnr: "12", bnr: "34", snr: "6" })).id;
    const otherBnr = (await insertOrder(org.id, { gnr: "12", bnr: "35", snr: "5" })).id;

    const ids = await searchIds(admin, org.id, "12/34/0/5");
    expect(ids).toEqual([hit]);
    expect(ids).not.toContain(otherSnr);
    expect(ids).not.toContain(otherBnr);
  });

  it.each([
    ["tom tekst", ""],
    ["null", null],
    ["mellomrom", "  "],
  ])("3.3.4 tomt fnr (%s) regnes som 0", async (_name, fnr) => {
    const { org, admin } = await orgWithAdmin();
    const hit = await orderWithCadastre(org.id, { gnr: "12", bnr: "34", fnr, snr: "5" });
    expect(await searchIds(admin, org.id, "12/34/0/5")).toEqual([hit]);
  });

  it("3.3.4 mellomrom i lagrede verdier trimmes (cadastral_units og ordren)", async () => {
    const { org, admin } = await orgWithAdmin();
    const onUnit = await orderWithCadastre(org.id, { gnr: " 12", bnr: "34 " });
    const onOrder = (await insertOrder(org.id, { gnr: " 12 ", bnr: " 34" })).id;
    expect((await searchIds(admin, org.id, "12/34")).sort()).toEqual([onUnit, onOrder].sort());
  });

  it("3.3.5 tekstsøket går i tillegg: «12/34» finner adressen «Gate 12/34»", async () => {
    const { org, admin } = await orgWithAdmin();
    const byAddress = (await insertOrder(org.id, { addressText: "Gate 12/34, 8000 Bodø" })).id;
    const byCadastre = (await insertOrder(org.id, { gnr: "12", bnr: "34" })).id;
    expect((await searchIds(admin, org.id, "12/34")).sort()).toEqual(
      [byAddress, byCadastre].sort(),
    );
  });
});

// ---------------------------------------------------------------------------------------------
// 3.4 Spesialtegn og felt som ikke søkes
// ---------------------------------------------------------------------------------------------

describe("3.4 spesialtegn og felt som ikke søkes", () => {
  it.each(["%", "_", "\\", "%%", "_%_"])(
    "3.4.1 «%s» gir ikke alle ordre (0 treff når ingen felt har tegnet)",
    async (query) => {
      const { org, admin } = await orgWithAdmin();
      await seedNoise(org.id);
      await insertOrder(org.id);
      const result = await search(admin, org.id, query);
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    },
  );

  it.each([
    ["%", "50% rabatt"],
    ["_", "REF_77"],
    ["\\", "REF\\77"],
  ])("3.4.1 «%s» treffer bare der tegnet står bokstavelig", async (query, externalRef) => {
    const { org, admin } = await orgWithAdmin();
    await seedNoise(org.id);
    const hit = (await insertOrder(org.id, { externalRef })).id;
    expect(await searchIds(admin, org.id, query)).toEqual([hit]);
  });

  it("3.4.2 e-post og telefon til en part gir ikke treff", async () => {
    const { org, admin } = await orgWithAdmin();
    const { assignment } = await convertedOrder(org.id);
    await createAssignmentParty(org.id, {
      assignmentId: assignment.id,
      name: "Megler Test",
      email: "oppdiktet.megler@example.com",
      phone: "40000123",
    });

    for (const query of ["oppdiktet.megler", "example.com", "40000123"]) {
      const result = await search(admin, org.id, query);
      expect(result.items, `søk på ${query}`).toEqual([]);
      expect(result.total).toBe(0);
    }
  });

  it("3.4.3 101 tegn der de første 100 treffer: kuttes og treffer, ingen krasj", async () => {
    const { org, admin } = await orgWithAdmin();
    const first100 = `REF-${"x".repeat(96)}`;
    expect(first100.length).toBe(100);
    const hit = (await insertOrder(org.id, { externalRef: first100 })).id;
    await seedNoise(org.id);

    const result = await search(admin, org.id, `${first100}Z`);
    expect(result.items.map((row) => row.id)).toEqual([hit]);
  });

  it("3.4.3 svært lang tekst (1000 tegn) krasjer ikke", async () => {
    const { org, admin } = await orgWithAdmin();
    await seedNoise(org.id);
    await expect(search(admin, org.id, "y".repeat(1000))).resolves.toEqual({
      items: [],
      total: 0,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// 3.5 Slettet og kansellert
// ---------------------------------------------------------------------------------------------

describe("3.5 slettet og kansellert", () => {
  it("3.5.1 slettet part gir ikke treff på navn eller firma", async () => {
    const { org, admin } = await orgWithAdmin();
    const { assignment } = await convertedOrder(org.id);
    await createAssignmentParty(org.id, {
      assignmentId: assignment.id,
      name: "Kari Hansevik",
      firmName: "Fjellmegleren Nord AS",
      deletedAt: TEST_NOW,
    });
    expect(await searchIds(admin, org.id, "Hansevik")).toEqual([]);
    expect(await searchIds(admin, org.id, "Fjellmegleren")).toEqual([]);
  });

  it("3.5.2 slettet matrikkelrad gir ikke treff på matrikkel", async () => {
    const { org, admin } = await orgWithAdmin();
    const { assignment } = await convertedOrder(org.id);
    const { cadastralUnit } = await createProperty(org.id, {
      assignmentId: assignment.id,
      gnr: "12",
      bnr: "34",
    });
    await db
      .update(cadastralUnits)
      .set({ deletedAt: TEST_NOW })
      .where(eq(cadastralUnits.id, cadastralUnit.id));
    expect(await searchIds(admin, org.id, "12/34")).toEqual([]);
  });

  it("3.5.3 slettet eiendom gir ikke treff på adressen eller matrikkelen", async () => {
    const { org, admin } = await orgWithAdmin();
    const { assignment } = await convertedOrder(org.id);
    await createProperty(org.id, {
      assignmentId: assignment.id,
      address: "Fjellveien 3",
      gnr: "12",
      bnr: "34",
      deletedAt: TEST_NOW,
    });
    expect(await searchIds(admin, org.id, "Fjellveien")).toEqual([]);
    expect(await searchIds(admin, org.id, "12/34")).toEqual([]);
  });

  it("3.5.4 slettet ordre står ikke i listen, verken med eller uten søk", async () => {
    const { org, admin } = await orgWithAdmin();
    const deleted = await insertOrder(org.id, {
      addressText: "Fjordgata 7, 8000 Bodø",
      deletedAt: TEST_NOW,
    });
    const without = await search(admin, org.id);
    expect(without.items.map((row) => row.id)).not.toContain(deleted.id);
    expect(without.total).toBe(0);
    expect(await searchIds(admin, org.id, "Fjordgata")).toEqual([]);
  });

  it("3.5.5 ordre med kansellert oppdrag står i listen og finnes på nummer, part og eiendom", async () => {
    const { org, admin } = await orgWithAdmin();
    const { order, assignment } = await convertedOrder(org.id, {}, { number: "2026-55501" });
    await createProperty(org.id, { assignmentId: assignment.id, address: "Fjellveien 3" });
    await createAssignmentParty(org.id, { assignmentId: assignment.id, name: "Kari Hansevik" });
    await db
      .update(assignments)
      .set({ deletedAt: TEST_NOW })
      .where(eq(assignments.id, assignment.id));

    const without = await search(admin, org.id);
    expect(without.items.map((row) => row.id)).toEqual([order.id]);
    expect(without.items[0]?.assignmentNumber).toBe("2026-55501");
    for (const query of ["55501", "Hansevik", "Fjellveien"]) {
      expect(await searchIds(admin, org.id, query), `søk på ${query}`).toEqual([order.id]);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 3.6 Grense, sortering og total
// ---------------------------------------------------------------------------------------------

/** Mottatt `minutes` minutter før TEST_NOW. */
function minutesBefore(minutes: number): Date {
  return new Date(TEST_NOW.getTime() - minutes * 60 * 1000);
}

describe("3.6 grense, sortering og total", () => {
  it("3.6.6 ORDER_LIST_LIMIT er 50", () => {
    expect(ORDER_LIST_LIMIT).toBe(50);
  });

  it("3.6.1 51 ordre uten søk: 50 rader, total 51, nyeste først, den eldste mangler", async () => {
    const { org, admin } = await orgWithAdmin();
    const created: string[] = [];
    for (let i = 0; i < 51; i += 1) {
      created.push((await insertOrder(org.id, { receivedAt: minutesBefore(i) })).id);
    }

    const result = await search(admin, org.id);
    expect(result.items).toHaveLength(50);
    expect(result.total).toBe(51);
    expect(result.items.map((row) => row.id)).toEqual(created.slice(0, 50));
    expect(result.items.map((row) => row.id)).not.toContain(created[50]);
  });

  it("3.6.2 lik received_at: id desc avgjør, og rekkefølgen er lik ved to kall", async () => {
    const { org, admin } = await orgWithAdmin();
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) ids.push((await insertOrder(org.id)).id);
    const expected = [...ids].sort().reverse();

    const first = (await search(admin, org.id)).items.map((row) => row.id);
    const second = (await search(admin, org.id)).items.map((row) => row.id);
    expect(first).toEqual(expected);
    expect(second).toEqual(first);
  });

  it("3.6.3 søk med 51 treff og 3 som ikke treffer: 50 rader, total 51", async () => {
    const { org, admin } = await orgWithAdmin();
    const hits: string[] = [];
    for (let i = 0; i < 51; i += 1) {
      hits.push(
        (await insertOrder(org.id, { addressText: `Sokegata ${i}`, receivedAt: minutesBefore(i) }))
          .id,
      );
    }
    for (let i = 0; i < 3; i += 1) {
      await insertOrder(org.id, { addressText: `Annenvei ${i}`, receivedAt: TEST_NOW });
    }

    const result = await search(admin, org.id, "sokegata");
    expect(result.items).toHaveLength(50);
    expect(result.total).toBe(51);
    expect(result.items.map((row) => row.id)).toEqual(hits.slice(0, 50));
  });

  it("3.6.4 under grensen: alle rader, total = antall rader", async () => {
    const { org, admin } = await orgWithAdmin();
    for (let i = 0; i < 7; i += 1) await insertOrder(org.id, { receivedAt: minutesBefore(i) });
    const result = await search(admin, org.id);
    expect(result.items).toHaveLength(7);
    expect(result.total).toBe(7);
  });

  it("3.6.5 tom organisasjon og søk uten treff gir { items: [], total: 0 }", async () => {
    const { org, admin } = await orgWithAdmin();
    expect(await search(admin, org.id)).toEqual({ items: [], total: 0 });
    await insertOrder(org.id);
    expect(await search(admin, org.id, "finnesikke")).toEqual({ items: [], total: 0 });
  });

  it("3.6.7 raden har ordrenummeret og fast feltliste uten sporingsfelt", async () => {
    const { org, admin } = await orgWithAdmin();
    await insertOrder(org.id, { externalRef: "ORD-ABC-551" });
    await convertedOrder(org.id, { externalRef: "ORD-ABC-552" });

    const { items } = await search(admin, org.id, "ORD-ABC");
    expect(items).toHaveLength(2);
    for (const row of items) {
      expect(Object.keys(row).sort()).toEqual(LIST_KEYS);
      expect(row.externalRef).toMatch(/^ORD-ABC-55[12]$/);
    }
  });

  it.each([
    [50, 51, "Viser 50 av 51. Bruk søket for å finne flere."],
    [50, 2000, "Viser 50 av 2000. Bruk søket for å finne flere."],
    [12, 12, null],
    [0, 0, null],
    [50, 50, null],
  ] as const)("3.6.8 meldingen for (%i, %i)", (shown, total, expected) => {
    expect(orderListSummary(shown, total) ?? null).toBe(expected);
  });
});

// ---------------------------------------------------------------------------------------------
// 3.7 Tilgang per rolle
// ---------------------------------------------------------------------------------------------

describe("3.7 tilgang per rolle", () => {
  it.each<[string, EmployeeRole[]]>([
    ["takstmann", ["inspector"]],
    ["kontor", ["office"]],
    ["leder", ["manager"]],
    ["admin", ["admin"]],
  ])("3.7.1 %s kan søke og får samme treff", async (_name, roles) => {
    const { org, admin } = await orgWithAdmin();
    const hit = (await insertOrder(org.id, { addressText: "Fjordgata 7, 8000 Bodø" })).id;
    await seedNoise(org.id);
    const { actor } = await person(org.id, roles);

    const expected = await searchIds(admin, org.id, "fjordgata");
    expect(expected).toEqual([hit]);
    expect(await searchIds(actor, org.id, "fjordgata")).toEqual(expected);
  });

  // Regel 11: admin stenges aldri ute. Testen skal aldri fjernes.
  it("3.7.2 admin uten andre roller kan søke", async () => {
    const { org, admin } = await orgWithAdmin();
    const hit = (await insertOrder(org.id, { externalRef: "ORD-ABC-551" })).id;
    expect(await searchIds(admin, org.id, "abc-551")).toEqual([hit]);
  });

  it("3.7.3 ansatt uten roller får AccessDeniedError", async () => {
    const org = await createOrganization();
    await insertOrder(org.id);
    const { actor } = await person(org.id, []);
    await expect(search(actor, org.id, "Testveien")).rejects.toThrow(AccessDeniedError);
  });

  it("3.7.3 bruker uten ansattrad får AccessDeniedError", async () => {
    const org = await createOrganization();
    await insertOrder(org.id);
    const stranger = await createUser();
    await expect(search(stranger, org.id, "Testveien")).rejects.toThrow(AccessDeniedError);
  });

  it("3.7.4 ansatt i B mot A sin id får AccessDeniedError", async () => {
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    await insertOrder(a.org.id, { addressText: "Fjordgata 7, 8000 Bodø" });
    await expect(search(b.admin, a.org.id, "Fjordgata")).rejects.toThrow(AccessDeniedError);
    await expect(search(b.admin, a.org.id)).rejects.toThrow(AccessDeniedError);
  });
});

// ---------------------------------------------------------------------------------------------
// 3.8 Tenant-isolasjon
// ---------------------------------------------------------------------------------------------

const FOREIGN_KEY = "23503";

/** Postgres-feilkoden, også når Drizzle har pakket feilen inn. */
function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

async function expectRejected(run: Promise<unknown>, code: string) {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, "databasen skulle avvist raden").not.toBeNull();
  expect(pgCode(error), `feilkode (fikk ${String(error)})`).toBe(code);
}

describe("3.8 tenant-isolasjon", () => {
  it.each(FIELD_CASES)(
    "3.8.1 listOrders med søk i $name: samme tekst i A og B gir bare egen ordre",
    async ({ value, query, seed }) => {
      await expectTenantIsolation<OrderListItem>({
        seed: async (grantA, grantB) => ({
          a: [await seed(grantA.organizationId, value)],
          b: [await seed(grantB.organizationId, value)],
        }),
        query: async (actor, organizationId) =>
          (await listOrders(actor, organizationId, { query })).items,
        idOf: (row) => row.id,
      });
    },
  );

  it("3.8.2 total lekker ikke: A sin total er antallet i A", async () => {
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    for (const org of [a.org.id, b.org.id]) {
      await insertOrder(org, { addressText: "Fjordgata 7, 8000 Bodø" });
      await insertOrder(org, { addressText: "Fjordgata 9, 8000 Bodø" });
    }
    await insertOrder(b.org.id, { addressText: "Fjordgata 11, 8000 Bodø" });

    const resultA = await search(a.admin, a.org.id, "fjordgata");
    expect(resultA.total).toBe(2);
    expect(resultA.items).toHaveLength(2);
    expect((await search(a.admin, a.org.id)).total).toBe(2);
    expect((await search(b.admin, b.org.id, "fjordgata")).total).toBe(3);
  });

  it("3.8.3 kryss-kobling: databasen avviser part, matrikkel og eiendom på tvers, og A finner ikke B-tekstene", async () => {
    // Postgres-brukeren i testene kan ikke slå av fremmednøklene, så kryss-koblingen kan ikke
    // legges inn. Testen viser derfor at databasen stopper den (sammensatte fremmednøkler), og at
    // søket i A ikke finner tekstene som bare står i B.
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    const { assignment: assignmentA } = await convertedOrder(a.org.id);
    const { property: propertyA } = await createProperty(a.org.id, {
      assignmentId: assignmentA.id,
    });
    const { property: propertyB } = await createProperty(b.org.id, {
      address: "Kryssveien 5",
      gnr: "77",
      bnr: "88",
    });

    // Part i B som peker på oppdraget i A
    await expectRejected(
      db.execute(sql`
        insert into assignment_parties (organization_id, assignment_id, role, name, firm_name)
        values (${b.org.id}, ${assignmentA.id}, 'broker', 'Kryss Partsen', 'Kryssfirma AS')`),
      FOREIGN_KEY,
    );
    // Matrikkelrad i B som peker på eiendommen i A
    await expectRejected(
      db.execute(sql`
        insert into cadastral_units (organization_id, property_id, gnr, bnr)
        values (${b.org.id}, ${propertyA.id}, '77', '88')`),
      FOREIGN_KEY,
    );
    // Oppdrag i A som peker på eiendommen i B
    await expectRejected(
      db.execute(sql`
        update assignments set property_id = ${propertyB.id}
        where id = ${assignmentA.id} and organization_id = ${a.org.id}`),
      FOREIGN_KEY,
    );

    for (const query of ["Kryss Partsen", "Kryssfirma", "Kryssveien", "77/88"]) {
      expect(await search(a.admin, a.org.id, query), `søk i A på ${query}`).toEqual({
        items: [],
        total: 0,
      });
    }
  });

  it("3.8.4 organisasjonen kommer fra tilgangssjekken: ordre i B med samme tekst finnes aldri fra A", async () => {
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    const orderB = await insertOrder(b.org.id, { externalRef: "ORD-ABC-551" });
    expect(await searchIds(a.admin, a.org.id, "ORD-ABC-551")).toEqual([]);
    expect(await searchIds(b.admin, b.org.id, "ORD-ABC-551")).toEqual([orderB.id]);
  });
});

// ---------------------------------------------------------------------------------------------
// 6 Loggene
// ---------------------------------------------------------------------------------------------

async function logCounts() {
  const [audit] = await db.select({ n: count() }).from(auditLog);
  const [event] = await db.select({ n: count() }).from(events);
  const [ai] = await db.select({ n: count() }).from(aiUsageLog);
  return { auditLog: audit?.n ?? 0, events: event?.n ?? 0, aiUsageLog: ai?.n ?? 0 };
}

const ROOT = path.resolve(__dirname, "../../..");

/** Filene der søketeksten går gjennom (kjernen, hjelperen og de to sidene). */
const SEARCH_FILES = [
  "src/shared/lib/like-pattern.ts",
  "src/core/assignments/search.ts",
  "src/core/assignments/work-queue.ts",
  "src/core/assignments/work-queue-params.ts",
  "src/core/orders/list.ts",
  "src/core/orders/orders.ts",
  "src/app/(ansatt)/ordre/page.tsx",
  "src/app/(ansatt)/arbeidskoe/page.tsx",
  "src/app/(ansatt)/arbeidskoe/queue-href.ts",
];

describe("6 loggene", () => {
  it("6.1 søket lager ingen rader i audit_log, events eller ai_usage_log", async () => {
    const { org, admin } = await orgWithAdmin();
    const { assignment } = await convertedOrder(org.id, { gnr: "12", bnr: "34" });
    await createAssignmentParty(org.id, { assignmentId: assignment.id, name: "Kari Hansevik" });
    // Én rad i KI-loggen på forhånd, slik at «uendret» ikke bare er 0 = 0 der
    await createAiUsageLog(org.id);
    const before = await logCounts();

    for (const query of ["Kari Hansevik", "12/34", "Fjordgata 7"]) {
      await listOrders(admin, org.id, { query });
      await listWorkQueue(admin, org.id, { status: "ordered", mineOnly: false, query });
      await countWorkQueueByStatus(admin, org.id, { mineOnly: false, query });
    }

    expect(await logCounts()).toEqual(before);
    const aiRows = await db.select().from(aiUsageLog);
    expect(JSON.stringify(aiRows)).not.toContain("Hansevik");
  });

  it.each(SEARCH_FILES)("6.2 %s skriver ikke til console og bruker ikke KI-modulen", (file) => {
    const source = readFileSync(path.join(ROOT, file), "utf8");
    expect(source).not.toMatch(/\bconsole\.(log|info|warn|error|debug)\b/);
    expect(source).not.toMatch(/from ["']@\/core\/ai["']/);
  });
});
