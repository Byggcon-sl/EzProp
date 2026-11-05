import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { AccessDeniedError, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { assignments, auditLog, employees, organizations, type EmployeeRole } from "@/db/schema";
import {
  auditRows,
  createAssignment,
  createEmployee,
  createOffice,
  createOrder,
  createOrganization,
  createProperty,
  createTeamMember,
  createUser,
  grantPermission,
  resetDatabase,
  TEST_NOW,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { ASSIGNMENT_STATUSES, TEAM_ROLES, type AssignmentStatus } from "./codes";
import { isCorrected } from "./status-flow";
import {
  countWorkQueueByStatus,
  listWorkQueue,
  setAssignmentSchedule,
  updateAssignmentNote,
} from "./work-queue";
import { WORK_QUEUE_LIMIT } from "./work-queue-params";

/*
 * Arbeidskøen mot databasen (docs/funksjoner/fase2a-arbeidsko-testplan.md avsnitt 2): migreringen,
 * faner og antall, «Mine», søk, kortet, sortering og grense, endring av notat, befaring og frist,
 * tilgang per rolle (med admin som aldri stenges ute) og tenant-isolasjon (regel 2).
 *
 * Signaturene (testplanen, «Avtale om signaturer»):
 * - listWorkQueue(actor, organizationId, { status, mineOnly, query }) → { items, total } eller items
 * - countWorkQueueByStatus(actor, organizationId, { mineOnly, query }) → { ordered, in_progress, … }
 * - updateAssignmentNote(actor, organizationId, assignmentId, note)
 * - setAssignmentSchedule(actor, organizationId, assignmentId, { inspectionAt, dueDate })
 *
 * Testdata er oppdiktet: «Testveien 12, 8000 Bodø», «Fjordgata 1», notatet «Venter på nøkkel».
 * «Fødselsnummeret» er 12345678901 (elleve sifre, ikke et gyldig nummer).
 *
 * Støtter hovedmål: tid (riktig fane, «Mine» og søk finner oppdraget raskt), reklamasjoner (frister
 * og befaring på kortet, ingenting fra andre organisasjoner, ingen fødselsnummer i loggen) og KI
 * først (kortet har en fast feltliste, så et KI-merke kan legges til senere uten å endre køen).
 */

// «Rettet» kommer fra statusflyten. Byttes ut med en spion som kaller den ekte funksjonen, så 2.5.3
// kan vise at kortet følger funksjonen.
vi.mock("./status-flow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./status-flow")>();
  return { ...actual, isCorrected: vi.fn(actual.isCorrected) };
});

beforeEach(resetDatabase);

const NOTE = "Venter på nøkkel";
const FAKE_NATIONAL_ID = "12345678901";
const ROLES: EmployeeRole[] = ["inspector", "office", "manager", "admin"];
const CARD_KEYS = [
  "address",
  "corrected",
  "dueDate",
  "id",
  "inspectionAt",
  "internalNote",
  "number",
  "responsibleName",
  "status",
].sort();

type Filter = { mineOnly: boolean; query: string };
type Item =
  Awaited<ReturnType<typeof listWorkQueue>> extends infer R
    ? R extends { items: (infer I)[] }
      ? I
      : R extends (infer I)[]
        ? I
        : never
    : never;
type ScheduleInput = Parameters<typeof setAssignmentSchedule>[3];

// ---------------------------------------------------------------------------------------------
// Hjelpere
// ---------------------------------------------------------------------------------------------

async function setInspectorsEditAll(organizationId: string, value: boolean) {
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": value } })
    .where(eq(organizations.id, organizationId));
}

/** Organisasjon med admin og ett kontor. */
async function orgWithAdmin(name = "Testfirma takst") {
  const org = await createOrganization(name);
  const admin = await createUser({ name: "Test Admin" });
  const adminEmployee = await createEmployee(admin, org.id, ["admin"]);
  const office = await createOffice(org.id, { name: `Testkontor ${name}` });
  return { org, admin, adminEmployee, office };
}

type Setup = Awaited<ReturnType<typeof orgWithAdmin>>;

async function person(organizationId: string, roles: EmployeeRole[], name = "Test Ansatt") {
  const actor = await createUser({ name });
  const employee = await createEmployee(actor, organizationId, roles);
  return { actor, employee };
}

function newAssignment(setup: Setup, overrides: Record<string, unknown> = {}) {
  return createAssignment(setup.org.id, {
    officeId: setup.office.id,
    ...overrides,
  } as Parameters<typeof createAssignment>[1]);
}

/** Kortene i fanen, uansett om funksjonen gir `{ items, total }` eller en liste. */
async function list(
  actor: Actor,
  organizationId: string,
  input: Filter & { status: AssignmentStatus },
): Promise<Item[]> {
  const result = (await listWorkQueue(actor, organizationId, input)) as unknown;
  if (Array.isArray(result)) return result as Item[];
  return (result as { items: Item[] }).items;
}

async function listAll(actor: Actor, organizationId: string, status: AssignmentStatus) {
  return list(actor, organizationId, { status, mineOnly: false, query: "" });
}

function count(actor: Actor, organizationId: string, filter: Filter) {
  return countWorkQueueByStatus(actor, organizationId, filter);
}

const ALL: Filter = { mineOnly: false, query: "" };
const MINE: Filter = { mineOnly: true, query: "" };

async function assignmentRow(id: string) {
  const [row] = await db.select().from(assignments).where(eq(assignments.id, id));
  if (!row) throw new Error("fant ikke oppdraget");
  return row as typeof row & {
    internalNote: string | null;
    inspectionAt: Date | null;
    dueDate: string | null;
  };
}

/** Feltene som ikke skal endres når et kall avvises. */
async function snapshot(id: string) {
  const row = await assignmentRow(id);
  return {
    internalNote: row.internalNote,
    inspectionAt: row.inspectionAt === null ? null : new Date(row.inspectionAt).toISOString(),
    dueDate: row.dueDate,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    status: row.status,
    deletedAt: row.deletedAt,
  };
}

async function auditFor(assignmentId: string) {
  return db.select().from(auditLog).where(eq(auditLog.entityId, assignmentId));
}

async function auditCount() {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(auditLog);
  return row?.n ?? 0;
}

/** «Ikke funnet»: `AccessDeniedError` eller en egen feil, aldri en databasefeil. */
async function expectNotFound(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, "kallet skulle blitt avvist").not.toBeNull();
  const isAccessDenied = error instanceof AccessDeniedError;
  const isOwnNotFound =
    error instanceof Error && /NotFound/i.test(error.name) && !/postgres|sql/i.test(error.name);
  expect(
    isAccessDenied || isOwnNotFound,
    `ventet «ikke funnet», fikk ${String((error as Error)?.name)}: ${String((error as Error)?.message)}`,
  ).toBe(true);
}

function note(actor: Actor, organizationId: string, assignmentId: string, text: string | null) {
  return updateAssignmentNote(actor, organizationId, assignmentId, text);
}

function schedule(
  actor: Actor,
  organizationId: string,
  assignmentId: string,
  input: Record<string, unknown>,
) {
  return setAssignmentSchedule(actor, organizationId, assignmentId, input as ScheduleInput);
}

// ---------------------------------------------------------------------------------------------
// 2.1 Migreringen
// ---------------------------------------------------------------------------------------------

describe("2.1 migreringen", () => {
  it("2.1.1 kolonnene finnes med riktig type og kan være tomme", async () => {
    const rows = (await db.execute(sql`
      select column_name, data_type, is_nullable
      from information_schema.columns
      where table_name = 'assignments'
        and column_name in ('inspection_at', 'due_date', 'internal_note')
      order by column_name
    `)) as unknown as { column_name: string; data_type: string; is_nullable: string }[];
    const found = Array.from(rows).map((row) => ({
      column: row.column_name,
      type: row.data_type,
      nullable: row.is_nullable,
    }));
    expect(found).toEqual([
      { column: "due_date", type: "date", nullable: "YES" },
      { column: "inspection_at", type: "timestamp with time zone", nullable: "YES" },
      { column: "internal_note", type: "text", nullable: "YES" },
    ]);
  });

  it("2.1.1 et oppdrag uten de nye feltene får null", async () => {
    const setup = await orgWithAdmin();
    const row = await assignmentRow((await newAssignment(setup)).id);
    expect(row.inspectionAt).toBeNull();
    expect(row.dueDate).toBeNull();
    expect(row.internalNote).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// 2.2 Faner og antall
// ---------------------------------------------------------------------------------------------

describe("2.2 faner og antall", () => {
  it("2.2.1 antall per status, alle fire nøkler finnes", async () => {
    const setup = await orgWithAdmin();
    for (const status of ["ordered", "ordered", "in_progress", "in_progress", "in_progress"]) {
      await newAssignment(setup, { status });
    }
    await newAssignment(setup, { status: "completed" });

    const counts = await count(setup.admin, setup.org.id, ALL);
    expect(counts).toEqual({ ordered: 2, in_progress: 3, completed: 1, invoiced: 0 });
  });

  it("2.2.1 tom organisasjon gir 0 i alle fire", async () => {
    const setup = await orgWithAdmin();
    expect(await count(setup.admin, setup.org.id, ALL)).toEqual({
      ordered: 0,
      in_progress: 0,
      completed: 0,
      invoiced: 0,
    });
  });

  it("2.2.2 antallene følger «Mine» og søket og er lik antall kort i hver fane", async () => {
    const setup = await orgWithAdmin();
    const statuses: AssignmentStatus[] = [
      "ordered",
      "ordered",
      "in_progress",
      "in_progress",
      "in_progress",
      "completed",
      "invoiced",
    ];
    for (const [index, status] of statuses.entries()) {
      const row = await newAssignment(setup, { status });
      await createProperty(setup.org.id, {
        assignmentId: row.id,
        address: index % 2 === 0 ? `Testveien ${index}` : `Fjordgata ${index}`,
      });
      if (index % 3 !== 0) {
        await createTeamMember(setup.org.id, {
          assignmentId: row.id,
          employeeId: setup.adminEmployee.id,
        });
      }
    }

    const filters: Filter[] = [
      ALL,
      MINE,
      { mineOnly: false, query: "testveien" },
      { mineOnly: true, query: "testveien" },
      { mineOnly: true, query: "Fjordgata" },
    ];
    for (const filter of filters) {
      const counts = await count(setup.admin, setup.org.id, filter);
      for (const status of ASSIGNMENT_STATUSES) {
        const items = await list(setup.admin, setup.org.id, { ...filter, status });
        expect(counts[status], `${status} med ${JSON.stringify(filter)}`).toBe(items.length);
      }
    }
    // Filteret gjør faktisk noe
    const all = await count(setup.admin, setup.org.id, ALL);
    const mine = await count(setup.admin, setup.org.id, MINE);
    expect(Object.values(all).reduce((a, b) => a + b, 0)).toBe(7);
    expect(Object.values(mine).reduce((a, b) => a + b, 0)).toBe(4);
  });

  it("2.2.2 total i listWorkQueue er antallet for fanen", async () => {
    const setup = await orgWithAdmin();
    for (let i = 0; i < 3; i += 1) await newAssignment(setup, { status: "in_progress" });
    const result = (await listWorkQueue(setup.admin, setup.org.id, {
      status: "in_progress",
      ...ALL,
    })) as unknown;
    if (!Array.isArray(result)) expect((result as { total: number }).total).toBe(3);
  });

  it.each(ASSIGNMENT_STATUSES)(
    "2.2.3 kansellerte oppdrag i %s telles ikke og vises ikke",
    async (status) => {
      const setup = await orgWithAdmin();
      const visible = await newAssignment(setup, { status });
      const cancelled = await newAssignment(setup, { status, deletedAt: TEST_NOW });
      for (const row of [visible, cancelled]) {
        await createTeamMember(setup.org.id, {
          assignmentId: row.id,
          employeeId: setup.adminEmployee.id,
        });
      }

      for (const filter of [ALL, MINE]) {
        const counts = await count(setup.admin, setup.org.id, filter);
        expect(counts[status]).toBe(1);
        const ids = (await list(setup.admin, setup.org.id, { ...filter, status })).map((r) => r.id);
        expect(ids).toEqual([visible.id]);
      }
    },
  );
});

// ---------------------------------------------------------------------------------------------
// 2.3 «Mine»
// ---------------------------------------------------------------------------------------------

describe("2.3 «Mine»", () => {
  it.each(TEAM_ROLES)("2.3.1 med i teamet som %s → vises", async (teamRole) => {
    const setup = await orgWithAdmin();
    const row = await newAssignment(setup, { status: "in_progress" });
    await createTeamMember(setup.org.id, {
      assignmentId: row.id,
      employeeId: setup.adminEmployee.id,
      teamRole,
    });
    const ids = (await list(setup.admin, setup.org.id, { status: "in_progress", ...MINE })).map(
      (r) => r.id,
    );
    expect(ids).toEqual([row.id]);
    expect((await count(setup.admin, setup.org.id, MINE)).in_progress).toBe(1);
  });

  it("2.3.2 ikke i teamet → ikke med «Mine», men med «Alle»", async () => {
    const setup = await orgWithAdmin();
    const row = await newAssignment(setup, { status: "in_progress" });
    // Noen andre er ansvarlig
    await createTeamMember(setup.org.id, { assignmentId: row.id });

    expect(await list(setup.admin, setup.org.id, { status: "in_progress", ...MINE })).toEqual([]);
    expect((await count(setup.admin, setup.org.id, MINE)).in_progress).toBe(0);
    expect((await listAll(setup.admin, setup.org.id, "in_progress")).map((r) => r.id)).toEqual([
      row.id,
    ]);
  });

  it("2.3.3 slettet teamrad → ikke med «Mine»", async () => {
    const setup = await orgWithAdmin();
    const row = await newAssignment(setup, { status: "in_progress" });
    await createTeamMember(setup.org.id, {
      assignmentId: row.id,
      employeeId: setup.adminEmployee.id,
      deletedAt: TEST_NOW,
    });
    expect(await list(setup.admin, setup.org.id, { status: "in_progress", ...MINE })).toEqual([]);
    expect((await count(setup.admin, setup.org.id, MINE)).in_progress).toBe(0);
  });

  it("2.3.4 avsluttet teamrad (overlevert, to_at satt) → ikke med «Mine» (valget i kortet)", async () => {
    // Kortet, «Valgt under bygging»: «Mine» teller bare aktive teamrader, som teamet på
    // oppdragssiden. Den som har overlevert oppdraget, ser det under «Alle».
    const setup = await orgWithAdmin();
    const row = await newAssignment(setup, { status: "in_progress" });
    await createTeamMember(setup.org.id, {
      assignmentId: row.id,
      employeeId: setup.adminEmployee.id,
      fromAt: new Date("2026-10-01T08:00:00Z"),
      toAt: new Date("2026-11-01T08:00:00Z"),
      handedOverReason: "Ferie",
    });
    expect(await list(setup.admin, setup.org.id, { status: "in_progress", ...MINE })).toEqual([]);
    expect((await count(setup.admin, setup.org.id, MINE)).in_progress).toBe(0);
    expect(await listAll(setup.admin, setup.org.id, "in_progress")).toHaveLength(1);
  });

  it("2.3.5 flere teamrader for samme ansatt → oppdraget vises én gang og telles én gang", async () => {
    const setup = await orgWithAdmin();
    const row = await newAssignment(setup, { status: "in_progress" });
    for (const teamRole of ["responsible", "inspector", "office"]) {
      await createTeamMember(setup.org.id, {
        assignmentId: row.id,
        employeeId: setup.adminEmployee.id,
        teamRole,
      });
    }
    const items = await list(setup.admin, setup.org.id, { status: "in_progress", ...MINE });
    expect(items.map((r) => r.id)).toEqual([row.id]);
    expect((await count(setup.admin, setup.org.id, MINE)).in_progress).toBe(1);
    expect((await count(setup.admin, setup.org.id, ALL)).in_progress).toBe(1);
  });

  it("2.3.6 «Mine» bruker innlogget ansatt: to ansatte ser hver sitt", async () => {
    const setup = await orgWithAdmin();
    const first = await person(setup.org.id, ["inspector"], "Takstmann En");
    const second = await person(setup.org.id, ["inspector"], "Takstmann To");
    const firstRow = await newAssignment(setup, { status: "in_progress" });
    const secondRow = await newAssignment(setup, { status: "in_progress" });
    await createTeamMember(setup.org.id, {
      assignmentId: firstRow.id,
      employeeId: first.employee.id,
    });
    await createTeamMember(setup.org.id, {
      assignmentId: secondRow.id,
      employeeId: second.employee.id,
    });

    const firstIds = (
      await list(first.actor, setup.org.id, { status: "in_progress", ...MINE })
    ).map((r) => r.id);
    const secondIds = (
      await list(second.actor, setup.org.id, { status: "in_progress", ...MINE })
    ).map((r) => r.id);
    expect(firstIds).toEqual([firstRow.id]);
    expect(secondIds).toEqual([secondRow.id]);
    // Admin er ikke med i noe team
    expect(await list(setup.admin, setup.org.id, { status: "in_progress", ...MINE })).toEqual([]);
  });

  it("2.3.6 ekstra felt employeeId i filteret endrer ikke hvem «Mine» gjelder", async () => {
    const setup = await orgWithAdmin();
    const other = await person(setup.org.id, ["inspector"]);
    const row = await newAssignment(setup, { status: "in_progress" });
    await createTeamMember(setup.org.id, { assignmentId: row.id, employeeId: other.employee.id });

    const input = {
      status: "in_progress",
      ...MINE,
      employeeId: other.employee.id,
    } as unknown as Filter & { status: AssignmentStatus };
    expect(await list(setup.admin, setup.org.id, input)).toEqual([]);
    const countInput = { ...MINE, employeeId: other.employee.id } as unknown as Filter;
    expect((await count(setup.admin, setup.org.id, countInput)).in_progress).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// 2.4 Søk
// ---------------------------------------------------------------------------------------------

describe("2.4 søk", () => {
  async function search(setup: Setup, query: string, status: AssignmentStatus = "ordered") {
    return (await list(setup.admin, setup.org.id, { status, mineOnly: false, query })).map(
      (r) => r.id,
    );
  }

  it("2.4.1 del av oppdragsnummer gir treff", async () => {
    const setup = await orgWithAdmin();
    const hit = await newAssignment(setup, { number: "2026-00004" });
    await newAssignment(setup, { number: "2026-00017" });
    expect(await search(setup, "0004")).toEqual([hit.id]);
    expect(
      (await count(setup.admin, setup.org.id, { mineOnly: false, query: "0004" })).ordered,
    ).toBe(1);
  });

  it("2.4.2 del av eiendomsadressen, store og små bokstaver", async () => {
    const setup = await orgWithAdmin();
    const hit = await newAssignment(setup);
    await createProperty(setup.org.id, { assignmentId: hit.id, address: "Testveien 12" });
    const miss = await newAssignment(setup);
    await createProperty(setup.org.id, { assignmentId: miss.id, address: "Fjordgata 1" });
    expect(await search(setup, "testVEIEN")).toEqual([hit.id]);
    expect(await search(setup, "eien 1")).toEqual([hit.id]);
  });

  it("2.4.3 adressen fra ordren når eiendom mangler", async () => {
    const setup = await orgWithAdmin();
    const order = await createOrder(setup.org.id, { addressText: "Ordreveien 3, 8000 Bodø" });
    const hit = await newAssignment(setup, { orderId: order.id });
    await newAssignment(setup);
    expect(await search(setup, "ORDREveien")).toEqual([hit.id]);
    const [item] = await listAll(setup.admin, setup.org.id, "ordered").then((items) =>
      items.filter((r) => r.id === hit.id),
    );
    expect(item?.address).toBe("Ordreveien 3, 8000 Bodø");
  });

  it("2.4.4 eiendomsadressen vinner over ordreadressen på kortet", async () => {
    const setup = await orgWithAdmin();
    const order = await createOrder(setup.org.id, { addressText: "Testveien 12, 8000 Bodø" });
    const row = await newAssignment(setup, { orderId: order.id });
    await createProperty(setup.org.id, { assignmentId: row.id, address: "Fjordgata 1" });
    const [item] = await listAll(setup.admin, setup.org.id, "ordered");
    expect(item?.address).toBe("Fjordgata 1");
    expect(await search(setup, "fjordgata")).toEqual([row.id]);
  });

  it.each([
    { query: "%", match: "Hundre%gata 1" },
    { query: "_", match: "Under_gata 2" },
    { query: "\\", match: "Skrå\\gata 3" },
  ])("2.4.5 «$query» tolkes som vanlig tegn", async ({ query, match }) => {
    const setup = await orgWithAdmin();
    const ids = new Map<string, string>();
    for (const address of ["Hundre%gata 1", "Under_gata 2", "Skrå\\gata 3", "Vanligveien 4"]) {
      const row = await newAssignment(setup);
      await createProperty(setup.org.id, { assignmentId: row.id, address });
      ids.set(address, row.id);
    }
    expect(await search(setup, query)).toEqual([ids.get(match)]);
  });

  it.each(["Bodø", "BODØ", "bodø", "Å", "æ"])("2.4.6 æøå: «%s» gir treff", async (query) => {
    const setup = await orgWithAdmin();
    const hit = await newAssignment(setup);
    await createProperty(setup.org.id, { assignmentId: hit.id, address: "Bodøgata 5 Åsæter" });
    const miss = await newAssignment(setup);
    await createProperty(setup.org.id, { assignmentId: miss.id, address: "Fjordgata 1" });
    expect(await search(setup, query)).toEqual([hit.id]);
  });

  it("2.4.7 tomt søk og bare mellomrom gir alle", async () => {
    const setup = await orgWithAdmin();
    for (let i = 0; i < 3; i += 1) await newAssignment(setup);
    expect(await search(setup, "")).toHaveLength(3);
    expect(await search(setup, "   ")).toHaveLength(3);
  });

  it("2.4 søk som ikke treffer gir tom liste og 0, aldri feil", async () => {
    const setup = await orgWithAdmin();
    await newAssignment(setup);
    expect(await search(setup, "finnes-ikke'; drop table assignments; --")).toEqual([]);
    const counts = await count(setup.admin, setup.org.id, {
      mineOnly: false,
      query: "finnes-ikke",
    });
    expect(counts).toEqual({ ordered: 0, in_progress: 0, completed: 0, invoiced: 0 });
  });

  it("2.4 slettet eiendom gir ikke adresse og ikke treff", async () => {
    const setup = await orgWithAdmin();
    const row = await newAssignment(setup);
    await createProperty(setup.org.id, {
      assignmentId: row.id,
      address: "Slettetveien 9",
      deletedAt: TEST_NOW,
    });
    expect(await search(setup, "Slettetveien")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 2.5 Kortet
// ---------------------------------------------------------------------------------------------

describe("2.5 kortet", () => {
  it("2.5.1 feltene på kortet", async () => {
    const setup = await orgWithAdmin();
    const responsible = await person(setup.org.id, ["inspector"], "Takstmann Testesen");
    const row = await newAssignment(setup, {
      status: "in_progress",
      number: "2026-00042",
      inspectionAt: new Date("2026-11-06T08:00:00Z"),
      dueDate: "2026-11-10",
      internalNote: NOTE,
    });
    await createProperty(setup.org.id, { assignmentId: row.id, address: "Testveien 12" });
    await createTeamMember(setup.org.id, {
      assignmentId: row.id,
      employeeId: responsible.employee.id,
      teamRole: "responsible",
    });

    const [item] = await listAll(setup.admin, setup.org.id, "in_progress");
    expect(item).toBeDefined();
    expect(item!.id).toBe(row.id);
    expect(item!.number).toBe("2026-00042");
    expect(item!.address).toBe("Testveien 12");
    expect(item!.status).toBe("in_progress");
    expect(new Date(item!.inspectionAt as Date).toISOString()).toBe("2026-11-06T08:00:00.000Z");
    expect(item!.dueDate).toBe("2026-11-10");
    expect(item!.internalNote).toBe(NOTE);
    expect(item!.responsibleName).toBe("Takstmann Testesen");
    expect(item!.corrected).toBe(false);
  });

  it("2.5.2 ingen ansvarlig → responsibleName er null", async () => {
    const setup = await orgWithAdmin();
    await newAssignment(setup);
    const [item] = await listAll(setup.admin, setup.org.id, "ordered");
    expect(item!.responsibleName).toBeNull();
    expect(item!.address).toBeNull();
    expect(item!.inspectionAt).toBeNull();
    expect(item!.dueDate).toBeNull();
    expect(item!.internalNote).toBeNull();
  });

  it("2.5.2 slettet ansvarlig og annen rolle i teamet teller ikke som ansvarlig", async () => {
    const setup = await orgWithAdmin();
    const row = await newAssignment(setup);
    const gone = await person(setup.org.id, ["inspector"], "Slettet Ansvarlig");
    const helper = await person(setup.org.id, ["inspector"], "Befaring Hjelper");
    await createTeamMember(setup.org.id, {
      assignmentId: row.id,
      employeeId: gone.employee.id,
      teamRole: "responsible",
      deletedAt: TEST_NOW,
    });
    await createTeamMember(setup.org.id, {
      assignmentId: row.id,
      employeeId: helper.employee.id,
      teamRole: "inspector",
    });
    const [item] = await listAll(setup.admin, setup.org.id, "ordered");
    expect(item!.responsibleName).toBeNull();
  });

  it("2.5.2 overlevert ansvarlig (to_at satt) teller ikke; den nye ansvarlige vises", async () => {
    const setup = await orgWithAdmin();
    const row = await newAssignment(setup);
    const before = await person(setup.org.id, ["inspector"], "Tidligere Ansvarlig");
    const now = await person(setup.org.id, ["inspector"], "Ny Ansvarlig");
    await createTeamMember(setup.org.id, {
      assignmentId: row.id,
      employeeId: before.employee.id,
      fromAt: new Date("2026-10-01T08:00:00Z"),
      toAt: new Date("2026-11-01T08:00:00Z"),
      handedOverReason: "Ferie",
    });
    await createTeamMember(setup.org.id, {
      assignmentId: row.id,
      employeeId: now.employee.id,
      fromAt: new Date("2026-11-01T08:00:00Z"),
    });
    const [item] = await listAll(setup.admin, setup.org.id, "ordered");
    expect(item!.responsibleName).toBe("Ny Ansvarlig");
  });

  it("2.5.3 «Rettet» kommer fra isCorrected i statusflyten", async () => {
    const setup = await orgWithAdmin();
    await newAssignment(setup, { status: "completed" });

    const [before] = await listAll(setup.admin, setup.org.id, "completed");
    expect(before!.corrected).toBe(false);
    expect(vi.mocked(isCorrected)).toHaveBeenCalled();

    vi.mocked(isCorrected).mockReturnValueOnce(true);
    const [after] = await listAll(setup.admin, setup.org.id, "completed");
    expect(after!.corrected).toBe(true);
  });

  it("2.5.4 feltlisten er fast (ingen e-post, telefon eller parter på kortet)", async () => {
    const setup = await orgWithAdmin();
    const row = await newAssignment(setup, { status: "in_progress" });
    await createTeamMember(setup.org.id, {
      assignmentId: row.id,
      employeeId: setup.adminEmployee.id,
    });
    const [item] = await listAll(setup.admin, setup.org.id, "in_progress");
    expect(Object.keys(item!).sort()).toEqual(CARD_KEYS);
    expect(JSON.stringify(item)).not.toContain("@example.com");
  });
});

// ---------------------------------------------------------------------------------------------
// 2.6 Sortering og grense
// ---------------------------------------------------------------------------------------------

describe("2.6 sortering og grense", () => {
  it("2.6.1 A103: nærmeste dato først, så rader uten dato etter nyeste nummer", async () => {
    const setup = await orgWithAdmin();
    const none1 = await newAssignment(setup, { number: "2026-00001" });
    const none2 = await newAssignment(setup, { number: "2026-00002" });
    const insp10 = await newAssignment(setup, {
      number: "2026-00003",
      inspectionAt: new Date("2026-11-10T08:00:00Z"),
    });
    const insp6 = await newAssignment(setup, {
      number: "2026-00004",
      inspectionAt: new Date("2026-11-06T08:00:00Z"),
    });
    const due5 = await newAssignment(setup, { number: "2026-00005", dueDate: "2026-11-05" });

    const ids = (await listAll(setup.admin, setup.org.id, "ordered")).map((r) => r.id);
    expect(ids).toEqual([due5.id, insp6.id, insp10.id, none2.id, none1.id]);
  });

  it("2.6.2 befaring brukes før frist på samme oppdrag", async () => {
    const setup = await orgWithAdmin();
    const late = await newAssignment(setup, {
      number: "2026-00001",
      inspectionAt: new Date("2026-11-20T08:00:00Z"),
      dueDate: "2026-11-06",
    });
    const middle = await newAssignment(setup, { number: "2026-00002", dueDate: "2026-11-10" });
    const ids = (await listAll(setup.admin, setup.org.id, "ordered")).map((r) => r.id);
    expect(ids).toEqual([middle.id, late.id]);
  });

  it("2.6.3 51 oppdrag → 50 kort, antall 51", async () => {
    const setup = await orgWithAdmin();
    for (let i = 0; i < 51; i += 1) await newAssignment(setup, { status: "in_progress" });
    expect(WORK_QUEUE_LIMIT).toBe(50);
    const result = (await listWorkQueue(setup.admin, setup.org.id, {
      status: "in_progress",
      ...ALL,
    })) as unknown;
    const items = Array.isArray(result) ? result : (result as { items: Item[] }).items;
    expect(items).toHaveLength(50);
    if (!Array.isArray(result)) expect((result as { total: number }).total).toBe(51);
    expect((await count(setup.admin, setup.org.id, ALL)).in_progress).toBe(51);
  });

  it("2.6.4 50 oppdrag → 50 kort, antall 50", async () => {
    const setup = await orgWithAdmin();
    for (let i = 0; i < 50; i += 1) await newAssignment(setup, { status: "in_progress" });
    expect(await listAll(setup.admin, setup.org.id, "in_progress")).toHaveLength(50);
    expect((await count(setup.admin, setup.org.id, ALL)).in_progress).toBe(50);
  });

  it("2.6 grensen gjelder per fane: 51 i Under arbeid påvirker ikke Bestilt", async () => {
    const setup = await orgWithAdmin();
    for (let i = 0; i < 51; i += 1) await newAssignment(setup, { status: "in_progress" });
    await newAssignment(setup, { status: "ordered" });
    expect(await listAll(setup.admin, setup.org.id, "ordered")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// 2.7 Endringer: notat, befaring og frist
// ---------------------------------------------------------------------------------------------

describe("2.7 endringer", () => {
  it("2.7.1 notatet lagres, endres og tømmes; updated_at og updated_by settes", async () => {
    const setup = await orgWithAdmin();
    const row = await newAssignment(setup);
    const startedAt = (await assignmentRow(row.id)).updatedAt.getTime();

    await note(setup.admin, setup.org.id, row.id, NOTE);
    let saved = await assignmentRow(row.id);
    expect(saved.internalNote).toBe(NOTE);
    expect(saved.updatedBy).toBe(setup.adminEmployee.id);
    expect(saved.updatedAt.getTime()).toBeGreaterThanOrEqual(startedAt);

    await note(setup.admin, setup.org.id, row.id, "  Nøkkel hos naboen  ");
    saved = await assignmentRow(row.id);
    expect(saved.internalNote).toBe("Nøkkel hos naboen");

    await note(setup.admin, setup.org.id, row.id, "   ");
    expect((await assignmentRow(row.id)).internalNote).toBeNull();

    await note(setup.admin, setup.org.id, row.id, "Igjen");
    await note(setup.admin, setup.org.id, row.id, null);
    expect((await assignmentRow(row.id)).internalNote).toBeNull();
  });

  it("2.7.1 notatet vises på kortet etterpå", async () => {
    const setup = await orgWithAdmin();
    const row = await newAssignment(setup);
    await note(setup.admin, setup.org.id, row.id, NOTE);
    const [item] = await listAll(setup.admin, setup.org.id, "ordered");
    expect(item!.internalNote).toBe(NOTE);
  });

  it.each([
    ["201 tegn", "a".repeat(201)],
    ["fødselsnummer", `Ring eier ${FAKE_NATIONAL_ID}`],
    ["fødselsnummer med mellomrom", ` ${FAKE_NATIONAL_ID} `],
  ])(
    "2.7.2 notat med %s → ZodError, raden uendret, ingen loggrad og ingen sifre i loggen",
    async (_name, text) => {
      const setup = await orgWithAdmin();
      const row = await newAssignment(setup, { internalNote: NOTE });
      const before = await snapshot(row.id);
      const beforeAudit = await auditCount();

      await expect(note(setup.admin, setup.org.id, row.id, text)).rejects.toBeInstanceOf(ZodError);
      expect(await snapshot(row.id)).toEqual(before);
      expect(await auditCount()).toBe(beforeAudit);
      expect(JSON.stringify(await auditRows(setup.org.id))).not.toContain(FAKE_NATIONAL_ID);
    },
  );

  it("2.7.2 et avvist fødselsnummer etter et godkjent notat havner heller ikke i loggen", async () => {
    const setup = await orgWithAdmin();
    const row = await newAssignment(setup);
    await note(setup.admin, setup.org.id, row.id, NOTE);
    await expect(note(setup.admin, setup.org.id, row.id, FAKE_NATIONAL_ID)).rejects.toBeInstanceOf(
      ZodError,
    );
    expect(await auditFor(row.id)).toHaveLength(1);
    expect(JSON.stringify(await auditRows(setup.org.id))).not.toContain(FAKE_NATIONAL_ID);
  });

  it.each([
    {
      name: "begge",
      input: { inspectionAt: "2026-11-06T09:00", dueDate: "2026-11-10" },
      inspection: "2026-11-06T08:00:00.000Z",
      due: "2026-11-10",
    },
    {
      name: "bare befaring",
      input: { inspectionAt: "2026-11-06T09:00", dueDate: "" },
      inspection: "2026-11-06T08:00:00.000Z",
      due: null,
    },
    {
      name: "bare frist",
      input: { inspectionAt: "", dueDate: "2026-11-10" },
      inspection: null,
      due: "2026-11-10",
    },
    { name: "ingen", input: { inspectionAt: "", dueDate: "" }, inspection: null, due: null },
  ])("2.7.3 befaring og frist: $name", async ({ input, inspection, due }) => {
    const setup = await orgWithAdmin();
    const row = await newAssignment(setup, {
      inspectionAt: new Date("2026-10-01T08:00:00Z"),
      dueDate: "2026-10-02",
    });
    await schedule(setup.admin, setup.org.id, row.id, input);
    const saved = await snapshot(row.id);
    expect(saved.inspectionAt).toBe(inspection);
    expect(saved.dueDate).toBe(due);
    expect(saved.updatedBy).toBe(setup.adminEmployee.id);
  });

  it("2.7.3 settes fra tomt og tømmes igjen", async () => {
    const setup = await orgWithAdmin();
    const row = await newAssignment(setup);
    await schedule(setup.admin, setup.org.id, row.id, {
      inspectionAt: "2026-11-06T09:00",
      dueDate: "2026-11-10",
    });
    expect((await snapshot(row.id)).dueDate).toBe("2026-11-10");
    await schedule(setup.admin, setup.org.id, row.id, { inspectionAt: null, dueDate: null });
    const cleared = await snapshot(row.id);
    expect(cleared.inspectionAt).toBeNull();
    expect(cleared.dueDate).toBeNull();
  });

  it("2.7.3 ugyldig dato → ZodError, raden uendret, ingen loggrad", async () => {
    const setup = await orgWithAdmin();
    const row = await newAssignment(setup, { dueDate: "2026-11-10" });
    const before = await snapshot(row.id);
    const beforeAudit = await auditCount();
    await expect(
      schedule(setup.admin, setup.org.id, row.id, { dueDate: "2026-13-40" }),
    ).rejects.toBeInstanceOf(ZodError);
    expect(await snapshot(row.id)).toEqual(before);
    expect(await auditCount()).toBe(beforeAudit);
  });

  it("2.7.4 revisjonslogg: én rad per endring av notatet, med fra og til", async () => {
    const setup = await orgWithAdmin();
    const row = await newAssignment(setup);
    await note(setup.admin, setup.org.id, row.id, NOTE);
    await note(setup.admin, setup.org.id, row.id, "Nøkkel hos naboen");

    const rows = await auditFor(row.id);
    expect(rows).toHaveLength(2);
    for (const entry of rows) {
      expect(entry.organizationId).toBe(setup.org.id);
      expect(entry.entityType).toBe("assignment");
      expect(entry.action).toBe("update");
      expect(Object.keys(entry.changes)).toHaveLength(1);
    }
    const changes = rows.map((entry) => Object.values(entry.changes)[0]);
    expect(changes).toEqual(
      expect.arrayContaining([
        { from: null, to: NOTE },
        { from: NOTE, to: "Nøkkel hos naboen" },
      ]),
    );
  });

  it("2.7.4 revisjonslogg for befaring og frist: bare feltet som endret seg", async () => {
    const setup = await orgWithAdmin();
    const row = await newAssignment(setup);
    await schedule(setup.admin, setup.org.id, row.id, {
      inspectionAt: "2026-11-06T09:00",
      dueDate: "2026-11-10",
    });
    await schedule(setup.admin, setup.org.id, row.id, {
      inspectionAt: "2026-11-06T09:00",
      dueDate: "2026-11-12",
    });

    const rows = await auditFor(row.id);
    expect(rows).toHaveLength(2);
    for (const entry of rows) {
      expect(entry.entityType).toBe("assignment");
      expect(entry.action).toBe("update");
    }
    const sizes = rows.map((entry) => Object.keys(entry.changes).length).sort();
    expect(sizes).toEqual([1, 2]);
    const single = rows.find((entry) => Object.keys(entry.changes).length === 1)!;
    expect(Object.values(single.changes)[0]).toEqual({ from: "2026-11-10", to: "2026-11-12" });
  });

  it("2.7.5 samme notat på nytt gir ingen ny loggrad (valget i kortet)", async () => {
    // Kortet, «Valgt under bygging»: samme notat, befaring eller frist på nytt skriver ingenting.
    const setup = await orgWithAdmin();
    const row = await newAssignment(setup);
    await note(setup.admin, setup.org.id, row.id, NOTE);
    await note(setup.admin, setup.org.id, row.id, ` ${NOTE} `);
    expect(await auditFor(row.id)).toHaveLength(1);
    expect((await assignmentRow(row.id)).internalNote).toBe(NOTE);
  });

  it("2.7.5 samme befaring og frist på nytt gir ingen ny loggrad", async () => {
    const setup = await orgWithAdmin();
    const row = await newAssignment(setup);
    const input = { inspectionAt: "2026-11-06T09:00", dueDate: "2026-11-10" };
    await schedule(setup.admin, setup.org.id, row.id, input);
    await schedule(setup.admin, setup.org.id, row.id, input);
    expect(await auditFor(row.id)).toHaveLength(1);
  });

  it("2.7.6 kansellert oppdrag → ikke funnet, raden uendret, ingen loggrad", async () => {
    const setup = await orgWithAdmin();
    const row = await newAssignment(setup, { deletedAt: TEST_NOW, internalNote: NOTE });
    const before = await snapshot(row.id);
    const beforeAudit = await auditCount();

    await expectNotFound(note(setup.admin, setup.org.id, row.id, "Ny tekst"));
    await expectNotFound(schedule(setup.admin, setup.org.id, row.id, { dueDate: "2026-11-10" }));
    expect(await snapshot(row.id)).toEqual(before);
    expect(await auditCount()).toBe(beforeAudit);
  });

  it.each([
    ["tilfeldig uuid", randomUUID()],
    ["ikke en id", "ikke-en-id"],
    ["tom", ""],
    ["SQL-aktig", "1' or '1'='1"],
  ])("2.7.7 %s → ikke funnet, aldri databasefeil", async (_name, id) => {
    const setup = await orgWithAdmin();
    const beforeAudit = await auditCount();
    await expectNotFound(note(setup.admin, setup.org.id, id, NOTE));
    await expectNotFound(schedule(setup.admin, setup.org.id, id, { dueDate: "2026-11-10" }));
    expect(await auditCount()).toBe(beforeAudit);
  });
});

// ---------------------------------------------------------------------------------------------
// 2.8 Tilgang per rolle
// ---------------------------------------------------------------------------------------------

describe("2.8 tilgang per rolle", () => {
  const READ_CASES = ROLES.flatMap((role) =>
    [true, false].map((editAll) => ({ role, editAll, setting: editAll ? "på" : "av" })),
  );

  it.each(READ_CASES)(
    "2.8.1 $role kan lese køen og antallene med innstillingen $setting",
    async ({ role, editAll }) => {
      const setup = await orgWithAdmin();
      await setInspectorsEditAll(setup.org.id, editAll);
      const row = await newAssignment(setup, { status: "in_progress" });
      const { actor } = await person(setup.org.id, [role]);

      expect((await listAll(actor, setup.org.id, "in_progress")).map((r) => r.id)).toEqual([
        row.id,
      ]);
      expect((await count(actor, setup.org.id, ALL)).in_progress).toBe(1);
    },
  );

  it.each(ROLES)("2.8.2 innstillingen på: %s kan lagre notat og befaring/frist", async (role) => {
    const setup = await orgWithAdmin();
    await setInspectorsEditAll(setup.org.id, true);
    const row = await newAssignment(setup);
    const { actor, employee } = await person(setup.org.id, [role]);

    await note(actor, setup.org.id, row.id, NOTE);
    await schedule(actor, setup.org.id, row.id, { dueDate: "2026-11-10" });
    const saved = await snapshot(row.id);
    expect(saved.internalNote).toBe(NOTE);
    expect(saved.dueDate).toBe("2026-11-10");
    expect(saved.updatedBy).toBe(employee.id);
    expect(await auditFor(row.id)).toHaveLength(2);
  });

  it.each(["office", "manager", "admin"] as const)(
    "2.8.3 innstillingen av: %s kan fortsatt lagre",
    async (role) => {
      const setup = await orgWithAdmin();
      await setInspectorsEditAll(setup.org.id, false);
      const row = await newAssignment(setup);
      const { actor } = await person(setup.org.id, [role]);

      await note(actor, setup.org.id, row.id, NOTE);
      await schedule(actor, setup.org.id, row.id, { dueDate: "2026-11-10" });
      expect((await snapshot(row.id)).internalNote).toBe(NOTE);
      expect((await snapshot(row.id)).dueDate).toBe("2026-11-10");
    },
  );

  it("2.8.3 innstillingen av: takstmann får AccessDeniedError, raden uendret, ingen loggrad, men kan lese", async () => {
    const setup = await orgWithAdmin();
    await setInspectorsEditAll(setup.org.id, false);
    const row = await newAssignment(setup, { status: "in_progress", internalNote: NOTE });
    const { actor } = await person(setup.org.id, ["inspector"]);
    const before = await snapshot(row.id);
    const beforeAudit = await auditCount();

    await expect(note(actor, setup.org.id, row.id, "Ny tekst")).rejects.toThrow(AccessDeniedError);
    await expect(schedule(actor, setup.org.id, row.id, { dueDate: "2026-11-10" })).rejects.toThrow(
      AccessDeniedError,
    );
    expect(await snapshot(row.id)).toEqual(before);
    expect(await auditCount()).toBe(beforeAudit);

    expect((await listAll(actor, setup.org.id, "in_progress")).map((r) => r.id)).toEqual([row.id]);
    expect((await count(actor, setup.org.id, ALL)).in_progress).toBe(1);
  });

  it("2.8.3 innstillingen av: takstmann avvises før skjemaet (ugyldig notat gir også AccessDeniedError)", async () => {
    const setup = await orgWithAdmin();
    await setInspectorsEditAll(setup.org.id, false);
    const row = await newAssignment(setup);
    const { actor } = await person(setup.org.id, ["inspector"]);
    await expect(note(actor, setup.org.id, row.id, "a".repeat(201))).rejects.toThrow(
      AccessDeniedError,
    );
  });

  it("2.8.4 takstmann med innstillingen av og enkeltrettigheten assignment.edit lykkes", async () => {
    const setup = await orgWithAdmin();
    await setInspectorsEditAll(setup.org.id, false);
    const row = await newAssignment(setup);
    const { actor, employee } = await person(setup.org.id, ["inspector"]);
    await grantPermission(employee, "assignment.edit", setup.admin.id);

    await note(actor, setup.org.id, row.id, NOTE);
    await schedule(actor, setup.org.id, row.id, { dueDate: "2026-11-10" });
    expect((await snapshot(row.id)).internalNote).toBe(NOTE);
    expect((await snapshot(row.id)).dueDate).toBe("2026-11-10");
  });

  const FUNCTIONS = ["listWorkQueue", "countWorkQueueByStatus", "note", "schedule"] as const;

  function callFn(
    fn: (typeof FUNCTIONS)[number],
    actor: Actor,
    organizationId: string,
    assignmentId: string,
  ): Promise<unknown> {
    switch (fn) {
      case "listWorkQueue":
        return listWorkQueue(actor, organizationId, { status: "ordered", ...ALL });
      case "countWorkQueueByStatus":
        return count(actor, organizationId, ALL);
      case "note":
        return note(actor, organizationId, assignmentId, NOTE);
      case "schedule":
        return schedule(actor, organizationId, assignmentId, { dueDate: "2026-11-10" });
    }
  }

  it.each(FUNCTIONS)("2.8.5 %s: bruker uten ansattrad får AccessDeniedError", async (fn) => {
    const setup = await orgWithAdmin();
    const row = await newAssignment(setup);
    const stranger = await createUser();
    const before = await snapshot(row.id);
    await expect(callFn(fn, stranger, setup.org.id, row.id)).rejects.toThrow(AccessDeniedError);
    expect(await snapshot(row.id)).toEqual(before);
  });

  const BLOCKED = FUNCTIONS.flatMap((fn) =>
    (
      [
        ["deaktivert", { deactivatedAt: new Date("2026-11-01T08:00:00Z") }],
        ["slettet", { deletedAt: new Date("2026-11-01T08:00:00Z") }],
      ] as const
    ).map(([state, set]) => ({ fn, state, set })),
  );

  it.each(BLOCKED)(
    "2.8.5 $fn: $state ansatt (admin) får AccessDeniedError",
    async ({ fn, set }) => {
      const setup = await orgWithAdmin();
      const row = await newAssignment(setup);
      const { actor, employee } = await person(setup.org.id, ["admin"]);
      await db.update(employees).set(set).where(eq(employees.id, employee.id));
      const before = await snapshot(row.id);
      const beforeAudit = await auditCount();

      await expect(callFn(fn, actor, setup.org.id, row.id)).rejects.toThrow(AccessDeniedError);
      expect(await snapshot(row.id)).toEqual(before);
      expect(await auditCount()).toBe(beforeAudit);
    },
  );

  it.each(FUNCTIONS)("2.8.5 %s: ansatt uten roller får AccessDeniedError", async (fn) => {
    const setup = await orgWithAdmin();
    const row = await newAssignment(setup);
    const { actor } = await person(setup.org.id, []);
    await expect(callFn(fn, actor, setup.org.id, row.id)).rejects.toThrow(AccessDeniedError);
  });

  // Regel 11: admin stenges aldri ute. Testen skal aldri fjernes.
  it("2.8.6 admin uten andre roller og med innstillingen av kan lese og endre", async () => {
    const setup = await orgWithAdmin();
    await setInspectorsEditAll(setup.org.id, false);
    const row = await newAssignment(setup, { status: "in_progress" });

    expect((await listAll(setup.admin, setup.org.id, "in_progress")).map((r) => r.id)).toEqual([
      row.id,
    ]);
    expect((await count(setup.admin, setup.org.id, ALL)).in_progress).toBe(1);
    await note(setup.admin, setup.org.id, row.id, NOTE);
    await schedule(setup.admin, setup.org.id, row.id, {
      inspectionAt: "2026-11-06T09:00",
      dueDate: "2026-11-10",
    });
    const saved = await snapshot(row.id);
    expect(saved.internalNote).toBe(NOTE);
    expect(saved.dueDate).toBe("2026-11-10");
    expect(saved.updatedBy).toBe(setup.adminEmployee.id);
  });
});

// ---------------------------------------------------------------------------------------------
// 2.9 Tenant-isolasjon (regel 2)
// ---------------------------------------------------------------------------------------------

describe("2.9 tenant-isolasjon", () => {
  /** Ett oppdrag Under arbeid i hver organisasjon, med admin som teammedlem. */
  function seedWithTeam(assignmentFor: Map<string, string>) {
    return async (
      grantA: { organizationId: string; employeeId: string },
      grantB: { organizationId: string; employeeId: string },
    ) => {
      for (const grant of [grantA, grantB]) {
        const row = await createAssignment(grant.organizationId, {
          status: "in_progress",
          internalNote: "Felles notat",
        } as Parameters<typeof createAssignment>[1]);
        await createProperty(grant.organizationId, {
          assignmentId: row.id,
          address: "Testveien 12",
        });
        await createTeamMember(grant.organizationId, {
          assignmentId: row.id,
          employeeId: grant.employeeId,
        });
        assignmentFor.set(grant.organizationId, row.id);
      }
      return {
        a: [assignmentFor.get(grantA.organizationId)!],
        b: [assignmentFor.get(grantB.organizationId)!],
      };
    };
  }

  it("2.9.1 listWorkQueue («Alle») gir aldri oppdrag fra en annen organisasjon", async () => {
    const assignmentFor = new Map<string, string>();
    await expectTenantIsolation<Item>({
      seed: seedWithTeam(assignmentFor),
      query: (actor, organizationId) =>
        list(actor, organizationId, { status: "in_progress", mineOnly: false, query: "" }),
      idOf: (row) => row.id,
    });
  });

  it("2.9.2 listWorkQueue med «Mine»: teamraden krysser ikke organisasjoner", async () => {
    const assignmentFor = new Map<string, string>();
    await expectTenantIsolation<Item>({
      seed: seedWithTeam(assignmentFor),
      query: (actor, organizationId) =>
        list(actor, organizationId, { status: "in_progress", mineOnly: true, query: "" }),
      idOf: (row) => row.id,
    });
  });

  it("2.9.3 countWorkQueueByStatus: B har 0 i alle fire, og A med Bs id avvises", async () => {
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    for (const status of ASSIGNMENT_STATUSES) {
      const row = await newAssignment(a, { status });
      await createProperty(a.org.id, { assignmentId: row.id, address: "Testveien 12" });
      await createTeamMember(a.org.id, { assignmentId: row.id, employeeId: a.adminEmployee.id });
    }
    const zero = { ordered: 0, in_progress: 0, completed: 0, invoiced: 0 };

    expect(await count(a.admin, a.org.id, ALL)).toEqual({
      ordered: 1,
      in_progress: 1,
      completed: 1,
      invoiced: 1,
    });
    for (const filter of [ALL, MINE, { mineOnly: false, query: "Testveien" }]) {
      expect(await count(b.admin, b.org.id, filter)).toEqual(zero);
    }
    await expect(count(a.admin, b.org.id, ALL)).rejects.toThrow(AccessDeniedError);
    await expect(count(b.admin, a.org.id, ALL)).rejects.toThrow(AccessDeniedError);
  });

  it("2.9.4 søket krysser ikke: samme adresse i A og B gir bare egen rad", async () => {
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    const rowA = await newAssignment(a, { number: "2026-00001" });
    const rowB = await newAssignment(b, { number: "2026-00001" });
    await createProperty(a.org.id, { assignmentId: rowA.id, address: "Testveien 12" });
    await createProperty(b.org.id, { assignmentId: rowB.id, address: "Testveien 12" });

    for (const query of ["Testveien", "00001"]) {
      const idsA = (
        await list(a.admin, a.org.id, { status: "ordered", mineOnly: false, query })
      ).map((r) => r.id);
      expect(idsA).toEqual([rowA.id]);
      expect((await count(a.admin, a.org.id, { mineOnly: false, query })).ordered).toBe(1);
    }
  });

  it("2.9.4 ordreadressen fra en annen organisasjon brukes aldri", async () => {
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    const orderB = await createOrder(b.org.id, { addressText: "Fremmedveien 7, 8000 Bodø" });
    await newAssignment(b, { orderId: orderB.id });
    const rowA = await newAssignment(a);

    const [item] = await listAll(a.admin, a.org.id, "ordered");
    expect(item!.id).toBe(rowA.id);
    expect(item!.address).toBeNull();
    expect(
      await list(a.admin, a.org.id, { status: "ordered", mineOnly: false, query: "Fremmedveien" }),
    ).toEqual([]);
  });

  it("2.9.5 updateAssignmentNote endrer aldri et oppdrag i en annen organisasjon", async () => {
    const assignmentFor = new Map<string, string>();
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        return seedWithTeam(assignmentFor)(grantA, grantB);
      },
      query: async (actor, organizationId) => [
        await note(
          actor,
          organizationId,
          assignmentFor.get(organizationId) ?? randomUUID(),
          `${NOTE} ${organizationId.slice(0, 4)}`,
        ),
      ],
      idOf: (row) => row.id,
    });

    const idB = assignmentFor.get(orgB)!;
    expect((await assignmentRow(idB)).internalNote).toBe(`${NOTE} ${orgB.slice(0, 4)}`);
    const rows = await auditFor(idB);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const row of rows) expect(row.organizationId).toBe(orgB);
  });

  it("2.9.5 setAssignmentSchedule endrer aldri et oppdrag i en annen organisasjon", async () => {
    const assignmentFor = new Map<string, string>();
    let orgB = "";
    let call = 0;
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        return seedWithTeam(assignmentFor)(grantA, grantB);
      },
      query: async (actor, organizationId) => {
        call += 1;
        return [
          await schedule(actor, organizationId, assignmentFor.get(organizationId) ?? randomUUID(), {
            inspectionAt: "2026-11-06T09:00",
            dueDate: `2026-11-${String(10 + call).padStart(2, "0")}`,
          }),
        ];
      },
      idOf: (row) => row.id,
    });

    const idB = assignmentFor.get(orgB)!;
    expect((await assignmentRow(idB)).dueDate).not.toBeNull();
    const rows = await auditFor(idB);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const row of rows) expect(row.organizationId).toBe(orgB);
  });

  it.each(["note", "schedule"] as const)(
    "2.9.6 %s: admin i A med Bs oppdrags-id → ikke funnet, B er urørt",
    async (fn) => {
      const a = await orgWithAdmin("Organisasjon A");
      const b = await orgWithAdmin("Organisasjon B");
      const rowB = await newAssignment(b, {
        internalNote: "Bs notat",
        inspectionAt: new Date("2026-11-06T08:00:00Z"),
        dueDate: "2026-11-10",
      });
      const before = await snapshot(rowB.id);
      const beforeAudit = await auditCount();

      const call =
        fn === "note"
          ? note(a.admin, a.org.id, rowB.id, "Endret av A")
          : schedule(a.admin, a.org.id, rowB.id, { inspectionAt: "", dueDate: "" });
      await expectNotFound(call);
      expect(await snapshot(rowB.id)).toEqual(before);
      expect(await auditCount()).toBe(beforeAudit);
      expect(await auditFor(rowB.id)).toEqual([]);
    },
  );

  it("2.9.7 organizationId i input ignoreres", async () => {
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    const rowA = await newAssignment(a);
    const rowB = await newAssignment(b);
    const beforeB = await snapshot(rowB.id);

    await schedule(a.admin, a.org.id, rowA.id, {
      dueDate: "2026-11-10",
      organizationId: b.org.id,
    });
    expect((await snapshot(rowA.id)).dueDate).toBe("2026-11-10");
    expect(await snapshot(rowB.id)).toEqual(beforeB);
    for (const row of await auditFor(rowA.id)) expect(row.organizationId).toBe(a.org.id);
    expect(await auditRows(b.org.id)).toEqual([]);

    // Det samme for lesingen: et ekstra felt bytter ikke organisasjon
    const input = {
      status: "ordered",
      ...ALL,
      organizationId: b.org.id,
    } as unknown as Filter & { status: AssignmentStatus };
    expect((await list(a.admin, a.org.id, input)).map((r) => r.id)).toEqual([rowA.id]);
  });
});
