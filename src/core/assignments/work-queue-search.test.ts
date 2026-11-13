import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { assignments, cadastralUnits, orders, type EmployeeRole } from "@/db/schema";
import {
  createAssignment,
  createAssignmentParty,
  createEmployee,
  createOrder,
  createOrganization,
  createProperty,
  createTeamMember,
  createUser,
  resetDatabase,
  TEST_NOW,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import type { AssignmentStatus } from "./codes";
import { countWorkQueueByStatus, listWorkQueue, type WorkQueueItem } from "./work-queue";

/*
 * Søket i arbeidskøen mot databasen (docs/funksjoner/fase2a-sok-ordre-arbeidsko-testplan.md
 * avsnitt 4). Samme felt som ordrelisten: feltene på oppdraget direkte, og feltene på ordren via
 * begge koblingene (`orders.id = assignments.order_id` og `orders.assignment_id = assignments.id`).
 * De eksisterende testene i `work-queue.test.ts` (2.4) gjelder fortsatt.
 *
 * Testdata er oppdiktet: «Fjordgata 7», «Kari Hansevik», gnr/bnr 12/34 og 999/999.
 * Søket trenger nett (køen hentes fra serveren). Befaringen og synken berøres ikke.
 *
 * Støtter hovedmål: de ansatte (takstmannen og kontoret finner oppdraget med ett søk, og ser når
 * treffet ligger i en annen fane) og reklamasjoner (matrikkel del for del, aldri treff fra andre
 * organisasjoner, kansellerte oppdrag vises aldri).
 */

beforeEach(resetDatabase);

async function person(organizationId: string, roles: EmployeeRole[]) {
  const actor = await createUser();
  const employee = await createEmployee(actor, organizationId, roles);
  return { actor, employee };
}

async function orgWithAdmin(name = "Testfirma takst") {
  const org = await createOrganization(name);
  const { actor: admin, employee: adminEmployee } = await person(org.id, ["admin"]);
  return { org, admin, adminEmployee };
}

async function queue(
  actor: Actor,
  organizationId: string,
  query: string,
  options: { status?: AssignmentStatus; mineOnly?: boolean } = {},
): Promise<WorkQueueItem[]> {
  const result = await listWorkQueue(actor, organizationId, {
    status: options.status ?? "ordered",
    mineOnly: options.mineOnly ?? false,
    query,
  });
  return result.items;
}

async function queueIds(actor: Actor, organizationId: string, query: string) {
  return (await queue(actor, organizationId, query)).map((row) => row.id);
}

async function counts(actor: Actor, organizationId: string, query: string, mineOnly = false) {
  return countWorkQueueByStatus(actor, organizationId, { mineOnly, query });
}

type OrderFields = Partial<typeof orders.$inferInsert>;

/** Oppdrag (Bestilt) der ordren peker på oppdraget via `assignments.order_id`. */
async function viaOrderId(organizationId: string, fields: OrderFields, status?: AssignmentStatus) {
  const order = await createOrder(organizationId, fields);
  return createAssignment(organizationId, { orderId: order.id, ...(status ? { status } : {}) });
}

/** Oppdrag (Bestilt) der ordren peker på oppdraget via `orders.assignment_id` (gjort om). */
async function viaAssignmentId(
  organizationId: string,
  fields: OrderFields,
  status?: AssignmentStatus,
) {
  const assignment = await createAssignment(organizationId, status ? { status } : {});
  await createOrder(organizationId, {
    ...fields,
    status: "converted",
    assignmentId: assignment.id,
  });
  return assignment;
}

type FieldCase = {
  name: string;
  value: string;
  query: string;
  /** Legger inn et oppdrag (Bestilt) som treffer på `value`. Gir oppdragets id. */
  seed: (organizationId: string, value: string) => Promise<string>;
};

/** Feltene på ordren, hver gjennom begge koblingene. */
const ORDER_FIELD_CASES: FieldCase[] = (
  [
    [
      "orders.address_text",
      "Fjordgata 7, 8000 Bodø",
      "FJORDG",
      (v: string) => ({ addressText: v }),
    ],
    ["orders.external_ref", "ORD-ABC-551", "abc-551", (v: string) => ({ externalRef: v })],
    [
      "orders.ordered_by_text",
      "Megler Fjordsen, Testmegleren AS",
      "FJORDSEN",
      (v: string) => ({ orderedByText: v }),
    ],
    ["matrikkel fra ordren", "12/34/0/5", "12/34", () => ({ gnr: "12", bnr: "34", snr: "5" })],
  ] as const
).flatMap(([name, value, query, fields]) => [
  {
    name: `${name} via assignments.order_id`,
    value,
    query,
    seed: async (org: string, v: string) => (await viaOrderId(org, fields(v))).id,
  },
  {
    name: `${name} via orders.assignment_id`,
    value,
    query,
    seed: async (org: string, v: string) => (await viaAssignmentId(org, fields(v))).id,
  },
]);

const ASSIGNMENT_FIELD_CASES: FieldCase[] = [
  {
    name: "properties.address",
    value: "Fjellveien 3",
    query: "fjellV",
    seed: async (org, value) => {
      const assignment = await createAssignment(org);
      await createProperty(org, { assignmentId: assignment.id, address: value });
      return assignment.id;
    },
  },
  {
    name: "assignments.number",
    value: "2026-77001",
    query: "77001",
    seed: async (org, value) => (await createAssignment(org, { number: value })).id,
  },
  {
    name: "assignment_parties.name",
    value: "Kari Hansevik",
    query: "HANSEVIK",
    seed: async (org, value) => {
      const assignment = await createAssignment(org);
      await createAssignmentParty(org, { assignmentId: assignment.id, name: value });
      return assignment.id;
    },
  },
  {
    name: "assignment_parties.firm_name",
    value: "Fjellmegleren Nord AS",
    query: "fjellmegleren NORD",
    seed: async (org, value) => {
      const assignment = await createAssignment(org);
      await createAssignmentParty(org, { assignmentId: assignment.id, firmName: value });
      return assignment.id;
    },
  },
  {
    name: "matrikkel fra cadastral_units",
    value: "12/34",
    query: "12/34",
    seed: async (org) => {
      const assignment = await createAssignment(org);
      await createProperty(org, { assignmentId: assignment.id, gnr: "12", bnr: "34" });
      return assignment.id;
    },
  },
];

const FIELD_CASES = [...ORDER_FIELD_CASES, ...ASSIGNMENT_FIELD_CASES];

/** Oppdrag (Bestilt) i samme organisasjon som ikke treffer noen av søkene over. */
async function seedNoise(organizationId: string): Promise<string[]> {
  const first = await viaOrderId(organizationId, {
    addressText: "Annenvei 1, 8000 Bodø",
    externalRef: "REF-0001",
    orderedByText: "Megler Test, Testmegleren AS",
    gnr: "999",
    bnr: "999",
  });
  const second = await createAssignment(organizationId);
  await createProperty(organizationId, { assignmentId: second.id, address: "Testveien 1" });
  await createAssignmentParty(organizationId, {
    assignmentId: second.id,
    name: "Megler Test",
    firmName: "Testmegleren AS",
  });
  return [first.id, second.id];
}

// ---------------------------------------------------------------------------------------------
// 4.1 Treff per felt
// ---------------------------------------------------------------------------------------------

describe("4.1 treff per felt", () => {
  it.each(FIELD_CASES)("$name", async ({ value, query, seed }) => {
    const { org, admin } = await orgWithAdmin();
    const hit = await seed(org.id, value);
    const noise = await seedNoise(org.id);

    const ids = await queueIds(admin, org.id, query);
    expect(ids).toEqual([hit]);
    for (const id of noise) expect(ids).not.toContain(id);
    expect((await counts(admin, org.id, query)).ordered).toBe(1);
  });

  it("uten søk står alle oppdragene i fanen", async () => {
    const { org, admin } = await orgWithAdmin();
    const noise = await seedNoise(org.id);
    expect((await queueIds(admin, org.id, "")).sort()).toEqual([...noise].sort());
  });

  it("slettet ordre gir ikke treff på ordrefeltene", async () => {
    const { org, admin } = await orgWithAdmin();
    await viaOrderId(org.id, { externalRef: "ORD-ABC-551", deletedAt: TEST_NOW });
    await viaAssignmentId(org.id, { externalRef: "ORD-ABC-552", deletedAt: TEST_NOW });
    expect(await queueIds(admin, org.id, "ORD-ABC")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 4.2 Ingen doble kort
// ---------------------------------------------------------------------------------------------

describe("4.2 ingen doble kort", () => {
  it("to parter treffer: ett kort, telling 1", async () => {
    const { org, admin } = await orgWithAdmin();
    const assignment = await createAssignment(org.id);
    await createAssignmentParty(org.id, { assignmentId: assignment.id, name: "Ola Hansen" });
    await createAssignmentParty(org.id, {
      assignmentId: assignment.id,
      role: "buyer",
      name: "Kari Hansen",
    });
    expect(await queueIds(admin, org.id, "Hansen")).toEqual([assignment.id]);
    expect((await counts(admin, org.id, "Hansen")).ordered).toBe(1);
  });

  it("to matrikkelrader treffer: ett kort, telling 1", async () => {
    const { org, admin } = await orgWithAdmin();
    const assignment = await createAssignment(org.id);
    const { property } = await createProperty(org.id, {
      assignmentId: assignment.id,
      gnr: "12",
      bnr: "34",
    });
    await db
      .insert(cadastralUnits)
      .values({ organizationId: org.id, propertyId: property.id, gnr: "12", bnr: "34", snr: "5" });
    expect(await queueIds(admin, org.id, "12/34")).toEqual([assignment.id]);
    expect((await counts(admin, org.id, "12/34")).ordered).toBe(1);
  });

  it("ordren via begge koblinger, part og eiendom treffer samtidig: ett kort", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await createOrder(org.id, { addressText: "Hansenveien 4, 8000 Bodø" });
    const assignment = await createAssignment(org.id, { orderId: order.id });
    await db
      .update(orders)
      .set({ status: "converted", assignmentId: assignment.id })
      .where(eq(orders.id, order.id));
    await createProperty(org.id, { assignmentId: assignment.id, address: "Hansenveien 4" });
    await createAssignmentParty(org.id, { assignmentId: assignment.id, name: "Ola Hansen" });

    expect(await queueIds(admin, org.id, "hansen")).toEqual([assignment.id]);
    expect((await counts(admin, org.id, "hansen")).ordered).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// 4.3 Matrikkel del for del
// ---------------------------------------------------------------------------------------------

async function withCadastre(
  organizationId: string,
  cadastre: { gnr: string; bnr: string; fnr?: string | null; snr?: string | null },
) {
  const assignment = await createAssignment(organizationId);
  await createProperty(organizationId, { assignmentId: assignment.id, ...cadastre });
  return assignment.id;
}

describe("4.3 matrikkel del for del", () => {
  it("«12/34» finner 12/34 og 12/34/0/5, ikke 112/34, 12/345, 2/34 eller 12/3", async () => {
    const { org, admin } = await orgWithAdmin();
    const onOrder = (await viaOrderId(org.id, { gnr: "12", bnr: "34" })).id;
    const onUnit = await withCadastre(org.id, { gnr: "12", bnr: "34", fnr: "0", snr: "5" });
    const wrong = [
      (await viaOrderId(org.id, { gnr: "112", bnr: "34" })).id,
      (await viaOrderId(org.id, { gnr: "12", bnr: "345" })).id,
      await withCadastre(org.id, { gnr: "112", bnr: "34" }),
      await withCadastre(org.id, { gnr: "12", bnr: "345" }),
      await withCadastre(org.id, { gnr: "2", bnr: "34" }),
      await withCadastre(org.id, { gnr: "12", bnr: "3" }),
    ];

    const ids = await queueIds(admin, org.id, "12/34");
    expect(ids.sort()).toEqual([onOrder, onUnit].sort());
    for (const id of wrong) expect(ids).not.toContain(id);
  });

  it("«12/34/0/5» finner 12/34/0/5 og tomt fnr med snr 5, ikke 12/34/0/6 eller 12/34/1/5", async () => {
    const { org, admin } = await orgWithAdmin();
    const exact = await withCadastre(org.id, { gnr: "12", bnr: "34", fnr: "0", snr: "5" });
    const noFnr = await withCadastre(org.id, { gnr: "12", bnr: "34", fnr: "", snr: "5" });
    const otherSnr = await withCadastre(org.id, { gnr: "12", bnr: "34", fnr: "0", snr: "6" });
    const otherFnr = await withCadastre(org.id, { gnr: "12", bnr: "34", fnr: "1", snr: "5" });

    const ids = await queueIds(admin, org.id, "12/34/0/5");
    expect(ids.sort()).toEqual([exact, noFnr].sort());
    expect(ids).not.toContain(otherSnr);
    expect(ids).not.toContain(otherFnr);
  });
});

// ---------------------------------------------------------------------------------------------
// 4.4 Spesialtegn, e-post og telefon
// ---------------------------------------------------------------------------------------------

describe("4.4 spesialtegn, e-post og telefon", () => {
  it.each(["%", "_", "\\"])("«%s» gir ikke alle oppdrag", async (query) => {
    const { org, admin } = await orgWithAdmin();
    await seedNoise(org.id);
    expect(await queueIds(admin, org.id, query)).toEqual([]);
    expect(await counts(admin, org.id, query)).toEqual({
      ordered: 0,
      in_progress: 0,
      completed: 0,
      invoiced: 0,
    });
  });

  it.each([
    ["%", "50% rabatt"],
    ["_", "REF_77"],
    ["\\", "REF\\77"],
  ])("«%s» treffer bare der tegnet står bokstavelig", async (query, externalRef) => {
    const { org, admin } = await orgWithAdmin();
    await seedNoise(org.id);
    const hit = (await viaOrderId(org.id, { externalRef })).id;
    expect(await queueIds(admin, org.id, query)).toEqual([hit]);
  });

  it("e-post og telefon til en part gir ikke treff", async () => {
    const { org, admin } = await orgWithAdmin();
    const assignment = await createAssignment(org.id);
    await createAssignmentParty(org.id, {
      assignmentId: assignment.id,
      name: "Megler Test",
      email: "oppdiktet.megler@example.com",
      phone: "40000123",
    });
    for (const query of ["oppdiktet.megler", "example.com", "40000123"]) {
      expect(await queueIds(admin, org.id, query), `søk på ${query}`).toEqual([]);
    }
  });

  it("101 tegn der de første 100 treffer: kuttes og treffer", async () => {
    const { org, admin } = await orgWithAdmin();
    const first100 = `REF-${"x".repeat(96)}`;
    const hit = (await viaOrderId(org.id, { externalRef: first100 })).id;
    expect(await queueIds(admin, org.id, `${first100}Z`)).toEqual([hit]);
  });
});

// ---------------------------------------------------------------------------------------------
// 4.5 Slettet og kansellert
// ---------------------------------------------------------------------------------------------

describe("4.5 slettet og kansellert", () => {
  it("slettet part gir ikke treff på navn eller firma", async () => {
    const { org, admin } = await orgWithAdmin();
    const assignment = await createAssignment(org.id);
    await createAssignmentParty(org.id, {
      assignmentId: assignment.id,
      name: "Kari Hansevik",
      firmName: "Fjellmegleren Nord AS",
      deletedAt: TEST_NOW,
    });
    expect(await queueIds(admin, org.id, "Hansevik")).toEqual([]);
    expect(await queueIds(admin, org.id, "Fjellmegleren")).toEqual([]);
  });

  it("slettet matrikkelrad gir ikke treff", async () => {
    const { org, admin } = await orgWithAdmin();
    const assignment = await createAssignment(org.id);
    const { cadastralUnit } = await createProperty(org.id, {
      assignmentId: assignment.id,
      gnr: "12",
      bnr: "34",
    });
    await db
      .update(cadastralUnits)
      .set({ deletedAt: TEST_NOW })
      .where(eq(cadastralUnits.id, cadastralUnit.id));
    expect(await queueIds(admin, org.id, "12/34")).toEqual([]);
  });

  it("slettet eiendom gir ikke treff på adressen eller matrikkelen", async () => {
    const { org, admin } = await orgWithAdmin();
    const assignment = await createAssignment(org.id);
    await createProperty(org.id, {
      assignmentId: assignment.id,
      address: "Fjellveien 3",
      gnr: "12",
      bnr: "34",
      deletedAt: TEST_NOW,
    });
    expect(await queueIds(admin, org.id, "Fjellveien")).toEqual([]);
    expect(await queueIds(admin, org.id, "12/34")).toEqual([]);
  });

  it("kansellert oppdrag finnes aldri, heller ikke ved søk på nummeret, part eller eiendom", async () => {
    const { org, admin } = await orgWithAdmin();
    const assignment = await createAssignment(org.id, { number: "2026-55501" });
    await createProperty(org.id, { assignmentId: assignment.id, address: "Fjellveien 3" });
    await createAssignmentParty(org.id, { assignmentId: assignment.id, name: "Kari Hansevik" });
    await db
      .update(assignments)
      .set({ deletedAt: TEST_NOW })
      .where(eq(assignments.id, assignment.id));

    for (const query of ["", "2026-55501", "55501", "Hansevik", "Fjellveien"]) {
      expect(await queueIds(admin, org.id, query), `søk på «${query}»`).toEqual([]);
      expect((await counts(admin, org.id, query)).ordered).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 4.6 Tellingene per fane følger søket
// ---------------------------------------------------------------------------------------------

describe("4.6 tellingene per fane", () => {
  it("«fjordgata»: Bestilt 1, Under arbeid 0, Ferdig 2, Fakturert 0", async () => {
    const { org, admin } = await orgWithAdmin();
    await viaOrderId(org.id, { addressText: "Fjordgata 1, 8000 Bodø" }, "ordered");
    await viaAssignmentId(org.id, { addressText: "Fjordgata 2, 8000 Bodø" }, "completed");
    const completed = await createAssignment(org.id, { status: "completed" });
    await createProperty(org.id, { assignmentId: completed.id, address: "Fjordgata 3" });
    await viaOrderId(org.id, { addressText: "Annenvei 1, 8000 Bodø" }, "in_progress");

    expect(await counts(admin, org.id, "fjordgata")).toEqual({
      ordered: 1,
      in_progress: 0,
      completed: 2,
      invoiced: 0,
    });
    expect(await counts(admin, org.id, "")).toEqual({
      ordered: 1,
      in_progress: 1,
      completed: 2,
      invoiced: 0,
    });
    const inProgress = await listWorkQueue(admin, org.id, {
      status: "in_progress",
      mineOnly: false,
      query: "fjordgata",
    });
    expect(inProgress).toEqual({ items: [], total: 0 });
    const done = await listWorkQueue(admin, org.id, {
      status: "completed",
      mineOnly: false,
      query: "fjordgata",
    });
    expect(done.items).toHaveLength(2);
    expect(done.total).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------
// 4.8 «Mine» og søk sammen
// ---------------------------------------------------------------------------------------------

describe("4.8 «Mine» og søk", () => {
  it("mineOnly + søk gir bare egne treff, og tellingene følger", async () => {
    const { org } = await orgWithAdmin();
    const { actor, employee } = await person(org.id, ["inspector"]);
    const mine = await viaOrderId(org.id, { addressText: "Fjordgata 1, 8000 Bodø" });
    await createTeamMember(org.id, { assignmentId: mine.id, employeeId: employee.id });
    const others = await viaOrderId(org.id, { addressText: "Fjordgata 2, 8000 Bodø" });
    await createTeamMember(org.id, { assignmentId: others.id });
    const mineDone = await viaOrderId(org.id, { addressText: "Fjordgata 3" }, "completed");
    await createTeamMember(org.id, { assignmentId: mineDone.id, employeeId: employee.id });
    const mineOther = await viaOrderId(org.id, { addressText: "Annenvei 1" });
    await createTeamMember(org.id, { assignmentId: mineOther.id, employeeId: employee.id });

    const items = await queue(actor, org.id, "fjordgata", { mineOnly: true });
    expect(items.map((row) => row.id)).toEqual([mine.id]);
    expect(await counts(actor, org.id, "fjordgata", true)).toEqual({
      ordered: 1,
      in_progress: 0,
      completed: 1,
      invoiced: 0,
    });
    expect(await counts(actor, org.id, "fjordgata", false)).toEqual({
      ordered: 2,
      in_progress: 0,
      completed: 1,
      invoiced: 0,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// 4.9 Tilgang per rolle
// ---------------------------------------------------------------------------------------------

describe("4.9 tilgang per rolle", () => {
  it.each<[string, EmployeeRole[]]>([
    ["takstmann", ["inspector"]],
    ["kontor", ["office"]],
    ["leder", ["manager"]],
    ["admin", ["admin"]],
  ])("%s kan søke og får samme treff", async (_name, roles) => {
    const { org, admin } = await orgWithAdmin();
    const hit = (await viaOrderId(org.id, { externalRef: "ORD-ABC-551" })).id;
    await seedNoise(org.id);
    const { actor } = await person(org.id, roles);
    expect(await queueIds(admin, org.id, "abc-551")).toEqual([hit]);
    expect(await queueIds(actor, org.id, "abc-551")).toEqual([hit]);
    expect((await counts(actor, org.id, "abc-551")).ordered).toBe(1);
  });

  // Regel 11: admin stenges aldri ute. Testen skal aldri fjernes.
  it("admin uten andre roller kan søke", async () => {
    const { org, admin } = await orgWithAdmin();
    const assignment = await createAssignment(org.id);
    await createAssignmentParty(org.id, { assignmentId: assignment.id, name: "Kari Hansevik" });
    expect(await queueIds(admin, org.id, "Hansevik")).toEqual([assignment.id]);
  });

  it("ansatt uten roller får AccessDeniedError", async () => {
    const org = await createOrganization();
    await createAssignment(org.id);
    const { actor } = await person(org.id, []);
    await expect(queue(actor, org.id, "TEST")).rejects.toThrow(AccessDeniedError);
    await expect(counts(actor, org.id, "TEST")).rejects.toThrow(AccessDeniedError);
  });

  it("bruker uten ansattrad får AccessDeniedError", async () => {
    const org = await createOrganization();
    const stranger = await createUser();
    await expect(queue(stranger, org.id, "TEST")).rejects.toThrow(AccessDeniedError);
  });
});

// ---------------------------------------------------------------------------------------------
// 4.10 Tenant-isolasjon
// ---------------------------------------------------------------------------------------------

const FOREIGN_KEY = "23503";

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

describe("4.10 tenant-isolasjon", () => {
  it.each(FIELD_CASES)(
    "listWorkQueue med søk i $name: samme tekst i A og B gir bare eget oppdrag",
    async ({ value, query, seed }) => {
      await expectTenantIsolation<WorkQueueItem>({
        seed: async (grantA, grantB) => ({
          a: [await seed(grantA.organizationId, value)],
          b: [await seed(grantB.organizationId, value)],
        }),
        query: async (actor, organizationId) =>
          (
            await listWorkQueue(actor, organizationId, {
              status: "ordered",
              mineOnly: false,
              query,
            })
          ).items,
        idOf: (row) => row.id,
      });
    },
  );

  it("tellingene i A teller aldri B-rader, og A mot B sin id avvises", async () => {
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    await viaOrderId(a.org.id, { addressText: "Fjordgata 1" });
    for (const status of ["ordered", "completed", "completed"] as const) {
      await viaOrderId(b.org.id, { addressText: "Fjordgata 1" }, status);
    }
    const bAssignment = await createAssignment(b.org.id);
    await createAssignmentParty(b.org.id, { assignmentId: bAssignment.id, name: "Fjordgata Part" });

    expect(await counts(a.admin, a.org.id, "fjordgata")).toEqual({
      ordered: 1,
      in_progress: 0,
      completed: 0,
      invoiced: 0,
    });
    await expect(counts(a.admin, b.org.id, "fjordgata")).rejects.toThrow(AccessDeniedError);
    await expect(queue(b.admin, a.org.id, "fjordgata")).rejects.toThrow(AccessDeniedError);
  });

  it("kryss-kobling: databasen avviser part, matrikkel og eiendom på tvers, og A finner ikke B-tekstene", async () => {
    // Som 3.8.3 i order-search.test.ts: fremmednøklene kan ikke slås av i testene, så testen viser
    // at databasen stopper kryss-koblingen og at søket i A ikke finner tekstene fra B.
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    const assignmentA = await createAssignment(a.org.id);
    const { property: propertyA } = await createProperty(a.org.id, {
      assignmentId: assignmentA.id,
    });
    const { property: propertyB } = await createProperty(b.org.id, {
      address: "Kryssveien 5",
      gnr: "77",
      bnr: "88",
    });

    await expectRejected(
      db.execute(sql`
        insert into assignment_parties (organization_id, assignment_id, role, name, firm_name)
        values (${b.org.id}, ${assignmentA.id}, 'broker', 'Kryss Partsen', 'Kryssfirma AS')`),
      FOREIGN_KEY,
    );
    await expectRejected(
      db.execute(sql`
        insert into cadastral_units (organization_id, property_id, gnr, bnr)
        values (${b.org.id}, ${propertyA.id}, '77', '88')`),
      FOREIGN_KEY,
    );
    await expectRejected(
      db.execute(sql`
        update assignments set property_id = ${propertyB.id}
        where id = ${assignmentA.id} and organization_id = ${a.org.id}`),
      FOREIGN_KEY,
    );
    // Ordre i B som peker på oppdraget i A
    await expectRejected(
      db.execute(sql`
        insert into orders (organization_id, address_text, received_at, source, status,
          requested_report_type, assignment_id, external_ref)
        values (${b.org.id}, 'Kryssveien 5', now(), 'manual', 'converted', 'condition_report',
          ${assignmentA.id}, 'KRYSS-REF')`),
      FOREIGN_KEY,
    );

    for (const query of ["Kryss Partsen", "Kryssfirma", "Kryssveien", "77/88", "KRYSS-REF"]) {
      expect(await queueIds(a.admin, a.org.id, query), `søk i A på ${query}`).toEqual([]);
      expect((await counts(a.admin, a.org.id, query)).ordered).toBe(0);
    }
  });
});
