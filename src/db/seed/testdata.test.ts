import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql, type SQL } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import { loadKnownValues, redactText } from "@/core/ai/redaction";
import {
  ASSIGNMENT_STATUSES,
  listWorkQueue,
  updateAssignmentNote,
  type AssignmentStatus,
} from "@/core/assignments";
import { suggestAreaType } from "@/core/buildings";
import { CLAIM_OUTCOMES, getClaim, listClaimsForAssignment } from "@/core/claims";
import { listOrders, orderListSummary } from "@/core/orders";
import { ORDER_LIST_LIMIT } from "@/core/orders/list";
import { findEmployeeGrant } from "@/core/organization";
import { getTimeStatistics } from "@/core/work-sessions";
import { db } from "@/db/client";
import { employeeRoles } from "@/db/schema";
import { brand } from "@/shared/config/brand";
import { addDays, todayInOslo } from "@/shared/lib/dates";
import {
  TEST_NOW,
  activeAdminCount,
  createAssignment,
  createContact,
  createEmployee,
  createFirm,
  createOrder,
  createOrganization,
  createProperty,
  createTeamMember,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { mergeOrganizationSettings } from "../../../tests/ai";
import { runSeed } from "./run";
import { runSampleSeed } from "./sample-assignments";
import {
  findTestdataAssignmentParts,
  findTestdataContacts,
  findTestdataEmployees,
  findTestdataFirms,
  findTestdataOrders,
  findTestdataProperties,
  runTestdataSeed,
} from "./testdata";
import {
  TESTDATA_EMPLOYEES,
  TESTDATA_FIRMS,
  TESTDATA_ORDERS,
  TESTDATA_PHONE_PATTERN,
  TESTDATA_PROPERTIES,
  TESTDATA_STREETS,
  type TestdataOrder,
} from "./testdata.data";
import { TestdataGuardError } from "./testdata-guard";

/*
 * Seed-steget for testdataene (`pnpm db:seed:testdata`), mot testdatabasen. Testplan:
 * docs/funksjoner/fase2a-testdata-arbeidshverdag-testplan.md avsnitt 4 og 6.
 *
 * `runSeed` kjøres først (Byggcon og admin finnes, som i drift). Steget får fast tid (`TEST_NOW`),
 * så datoene i testene er faste. Testdata er oppdiktet; testene setter ingen TG og ingen fagtekst.
 * Testene som bare leser, deler én kjøring (`beforeAll`); testene som endrer data, får sin egen.
 *
 * Støtter hovedmål: de ansatte (testmiljøet viser en full arbeidsdag i organisasjonen de logger inn
 * i, og skriptet rører aldri ekte arbeid, admin eller produksjon), KI i bunnen (vasken prøves på
 * oppdiktede parter, ingen KI-kall) og færre reklamasjoner (lister, reklamasjoner og ytelse prøves
 * med en driftslik mengde, og dataene følger faget).
 */

// ---------------------------------------------------------------------------------------------
// Avbrudd: tjenestene kan få beskjed om å kaste midt i en kjøring (4.3). Ellers som før.
// ---------------------------------------------------------------------------------------------

const interrupt = vi.hoisted(() => ({
  /** Kast ved første kall til `createFirm` (etter de ansatte). */
  beforeFirms: false,
  /** Kast når `createOrder` kalles mer enn så mange ganger. */
  afterOrders: Number.POSITIVE_INFINITY,
  orderCalls: 0,
}));

vi.mock("@/core/contacts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/contacts")>();
  return {
    ...actual,
    createFirm: (async (...args: Parameters<typeof actual.createFirm>) => {
      if (interrupt.beforeFirms) throw new Error("avbrutt i testen (før firma)");
      return actual.createFirm(...args);
    }) as typeof actual.createFirm,
  };
});

vi.mock("@/core/orders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/orders")>();
  return {
    ...actual,
    createOrder: (async (...args: Parameters<typeof actual.createOrder>) => {
      interrupt.orderCalls += 1;
      if (interrupt.orderCalls > interrupt.afterOrders) {
        throw new Error("avbrutt i testen (midt i ordrene)");
      }
      return actual.createOrder(...args);
    }) as typeof actual.createOrder,
  };
});

function resetInterrupt() {
  interrupt.beforeFirms = false;
  interrupt.afterOrders = Number.POSITIVE_INFINITY;
  interrupt.orderCalls = 0;
}

// ---------------------------------------------------------------------------------------------
// Felles
// ---------------------------------------------------------------------------------------------

const SEED_ENV = { SEED_ADMIN_EMAIL: "admin@example.com", SEED_ADMIN_NAME: "Test Admin" };
const ANCHOR = todayInOslo(TEST_NOW);
const TD_EMAIL = "%@testdata.invalid";
const ASSIGNMENT_ORDERS = TESTDATA_ORDERS.filter((order) => order.target !== "order_only");
const ORDER_ONLY = TESTDATA_ORDERS.filter((order) => order.target === "order_only");
const DONE_ORDERS = ASSIGNMENT_ORDERS.filter(
  (order) => order.target === "completed" || order.target === "invoiced",
);
const ORDER_BY_REF = new Map<string, TestdataOrder>(
  TESTDATA_ORDERS.map((order) => [order.externalRef, order]),
);
const PROPERTY_BY_KEY = new Map(TESTDATA_PROPERTIES.map((property) => [property.key, property]));
const EMPLOYEE_BY_KEY = new Map(TESTDATA_EMPLOYEES.map((employee) => [employee.key, employee]));
const CLAIM_ORDERS = TESTDATA_ORDERS.filter((order) => order.claim);

function testdataEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    ...SEED_ENV,
    APP_ENVIRONMENT: "test",
    DATABASE_URL: process.env.DATABASE_URL,
    ...overrides,
  };
}

async function seedTestdata(now: Date = TEST_NOW) {
  return runTestdataSeed(testdataEnv(), now);
}

type Row = Record<string, unknown>;

async function rows<T = Row>(query: SQL): Promise<T[]> {
  return (await db.execute(query)) as unknown as T[];
}

async function one<T = Row>(query: SQL): Promise<T> {
  const [row] = await rows<T>(query);
  if (!row) throw new Error("fant ingen rad");
  return row;
}

async function byggconId(): Promise<string> {
  const row = await one<{ id: string }>(sql`
    select id from organizations
    where name = ${brand.companyName}
      and coalesce(settings -> 'sampleData', 'false'::jsonb) <> 'true'::jsonb
      and deleted_at is null`);
  return row.id;
}

async function sampleOrgId(): Promise<string | null> {
  const [row] = await rows<{ id: string }>(sql`
    select id from organizations where settings ->> 'sampleData' = 'true'`);
  return row?.id ?? null;
}

async function adminActor(): Promise<Actor> {
  const row = await one<{ id: string; email: string; name: string }>(sql`
    select id, email, name from users where email = ${SEED_ENV.SEED_ADMIN_EMAIL}`);
  return row;
}

async function adminEmployeeId(organizationId: string): Promise<string> {
  const row = await one<{ id: string }>(sql`
    select e.id from employees e join users u on u.id = e.user_id
    where u.email = ${SEED_ENV.SEED_ADMIN_EMAIL} and e.organization_id = ${organizationId}`);
  return row.id;
}

/** Brukeren til en oppdiktet ansatt som aktør (kan ikke logge inn, men tilgangen er den samme). */
async function tdActor(employeeKey: string): Promise<Actor> {
  const employee = EMPLOYEE_BY_KEY.get(employeeKey);
  if (!employee) throw new Error(`ukjent ansatt ${employeeKey}`);
  return one<Actor>(sql`
    select id, email, name from users where email = ${employee.email.toLowerCase()}`);
}

/** Tabellene i «Data» i kortet, pluss de som aldri skal få rader. */
const COUNTED_TABLES = [
  "users",
  "employees",
  "employee_roles",
  "certifications",
  "firms",
  "contacts",
  "orders",
  "assignments",
  "assignment_team_members",
  "assignment_parties",
  "properties",
  "cadastral_units",
  "common_areas",
  "report_buildings",
  "floors",
  "rooms",
  "floor_areas",
  "work_sessions",
  "claims",
  "events",
  "audit_log",
  "number_sequences",
  "ai_usage_log",
  "sessions",
  "accounts",
  "files",
  "client_agreements",
  "template_families",
  "template_versions",
  "rules",
  "rule_test_cases",
  "trial_answers",
] as const;
const TABLES_WITHOUT_ORG = new Set(["users", "sessions", "accounts"]);

/** Antall rader per tabell (i organisasjonen når den er gitt) og summen i nummerserien. */
async function countRows(organizationId?: string): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const table of COUNTED_TABLES) {
    // Tabeller uten organisasjon (brukere og innlogging) telles bare samlet
    if (organizationId && TABLES_WITHOUT_ORG.has(table)) continue;
    const where = organizationId ? sql` where organization_id = ${organizationId}` : sql``;
    const row = await one<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(table)}${where}`,
    );
    result[table] = Number(row.n);
  }
  const where = organizationId ? sql` where organization_id = ${organizationId}` : sql``;
  const sequence = await one<{ n: number }>(
    sql`select coalesce(sum(next_value), 0)::int as n from number_sequences${where}`,
  );
  result["number_sequences.next_value"] = Number(sequence.n);
  return result;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DROPPED_COLUMNS = new Set(["id", "created_at", "updated_at", "created_by", "updated_by"]);

/** Fjerner id-er og tidsstempler for rad-livet; datoer blir ISO-tekst; uuid i jsonb blir «<id>». */
function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return UUID.test(value) ? "<id>" : value;
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !DROPPED_COLUMNS.has(key) && !key.endsWith("_id"))
        .map(([key, item]) => [key, normalize(item)])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    );
  }
  return value;
}

/**
 * Alle TD-rader i organisasjonen som sortert JSON uten id, med naturlig nøkkel i stedet for
 * fremmednøkler (`_ref`, `_email`, `_building`, `_floor`) og uten `created_at`/`updated_at`.
 */
async function snapshot(organizationId: string): Promise<Record<string, string[]>> {
  const td = sql`o.organization_id = ${organizationId} and o.external_ref like 'TD-%'`;
  const queries: Record<string, SQL> = {
    users: sql`select u.name, u.email from users u where u.email like ${TD_EMAIL}`,
    employees: sql`
      select e.*, u.email as _email, c.legal_name as _company, f.name as _office,
        (select array_agg(r.role::text order by r.role) from employee_roles r
          where r.employee_id = e.id and r.deleted_at is null) as _roles
      from employees e join users u on u.id = e.user_id
      left join companies c on c.id = e.company_id
      left join offices f on f.id = e.office_id
      where e.organization_id = ${organizationId} and u.email like ${TD_EMAIL}`,
    certifications: sql`
      select c.*, u.email as _email from certifications c
      join employees e on e.id = c.employee_id join users u on u.id = e.user_id
      where c.organization_id = ${organizationId} and u.email like ${TD_EMAIL}`,
    firms: sql`
      select f.* from firms f where f.organization_id = ${organizationId}
        and f.name in ${sql.raw(`(${TESTDATA_FIRMS.map((firm) => `'${firm.name.replace(/'/g, "''")}'`).join(",")})`)}`,
    contacts: sql`
      select c.*, f.name as _firm from contacts c left join firms f on f.id = c.firm_id
      where c.organization_id = ${organizationId} and c.email like ${TD_EMAIL}`,
    orders: sql`select o.* from orders o where ${td}`,
    assignments: sql`
      select a.*, o.external_ref as _ref, f.name as _office, c.legal_name as _company
      from assignments a join orders o on o.assignment_id = a.id
      left join offices f on f.id = a.office_id left join companies c on c.id = a.company_id
      where ${td}`,
    team: sql`
      select t.*, o.external_ref as _ref, u.email as _email from assignment_team_members t
      join orders o on o.assignment_id = t.assignment_id
      join employees e on e.id = t.employee_id join users u on u.id = e.user_id
      where ${td}`,
    parties: sql`
      select p.*, o.external_ref as _ref from assignment_parties p
      join orders o on o.assignment_id = p.assignment_id where ${td}`,
    properties: sql`
      select p.*, cu.gnr, cu.bnr, cu.fnr, cu.snr, cu.association_name, cu.share_number,
        o.external_ref as _ref
      from properties p join cadastral_units cu on cu.property_id = p.id
      join assignments a on a.property_id = p.id join orders o on o.assignment_id = a.id
      where ${td}`,
    common_areas: sql`
      select c.*, o.external_ref as _ref from common_areas c
      join orders o on o.assignment_id = c.assignment_id where ${td}`,
    buildings: sql`
      select b.*, o.external_ref as _ref from report_buildings b
      join orders o on o.assignment_id = b.assignment_id where ${td}`,
    floors: sql`
      select f.*, o.external_ref as _ref, b.name as _building from floors f
      join report_buildings b on b.id = f.report_building_id
      join orders o on o.assignment_id = b.assignment_id where ${td}`,
    floor_areas: sql`
      select fa.*, o.external_ref as _ref, b.name as _building, f.name as _floor
      from floor_areas fa join floors f on f.id = fa.floor_id
      join report_buildings b on b.id = f.report_building_id
      join orders o on o.assignment_id = b.assignment_id where ${td}`,
    rooms: sql`
      select r.*, o.external_ref as _ref, b.name as _building, f.name as _floor from rooms r
      join floors f on f.id = r.floor_id join report_buildings b on b.id = f.report_building_id
      join orders o on o.assignment_id = b.assignment_id where ${td}`,
    work_sessions: sql`
      select w.*, o.external_ref as _ref, u.email as _email from work_sessions w
      join orders o on o.assignment_id = w.assignment_id
      join employees e on e.id = w.employee_id join users u on u.id = e.user_id where ${td}`,
    claims: sql`
      select c.*, o.external_ref as _ref, p.name as _claimant from claims c
      join orders o on o.assignment_id = c.assignment_id
      left join assignment_parties p on p.id = c.claimant_party_id where ${td}`,
    events: sql`
      select ev.type, ev.occurred_at, ev.received_at, ev.actor_type, ev.data,
        o.external_ref as _ref
      from events ev join orders o
        on (o.assignment_id = ev.assignment_id or ev.data ->> 'orderId' = o.id::text)
      where ${td}`,
  };
  const result: Record<string, string[]> = {};
  for (const [name, query] of Object.entries(queries)) {
    result[name] = (await rows(query)).map((row) => JSON.stringify(normalize(row))).sort();
  }
  return result;
}

/** `updated_at` på alle rader i organisasjonen i tabellene seed-steget skriver i. */
async function updatedAtByRow(organizationId: string): Promise<Map<string, string>> {
  const tables = COUNTED_TABLES.filter(
    (table) => !TABLES_WITHOUT_ORG.has(table) && table !== "number_sequences",
  );
  const map = new Map<string, string>();
  for (const table of tables) {
    const found = await rows<{ id: string; updated_at: Date | string | null }>(
      sql`select id::text as id, updated_at from ${sql.identifier(table)} where organization_id = ${organizationId}`,
    );
    for (const row of found) {
      map.set(`${table}:${row.id}`, row.updated_at ? new Date(row.updated_at).toISOString() : "");
    }
  }
  return map;
}

function osloDate(column: SQL): SQL {
  return sql`to_char((${column} at time zone 'Europe/Oslo')::date, 'YYYY-MM-DD')`;
}

/** TD-oppdragene med ordre-nøkkel, status og datoene i norsk tid. */
type AssignmentRow = {
  ref: string;
  assignment_id: string;
  order_id: string;
  status: AssignmentStatus;
  number: string;
  office_id: string | null;
  property_id: string | null;
  inspection_date: string | null;
  due_date: string | null;
  received_date: string;
  created_by: string | null;
};

async function tdAssignments(organizationId: string): Promise<AssignmentRow[]> {
  return rows<AssignmentRow>(sql`
    select o.external_ref as ref, a.id as assignment_id, o.id as order_id, a.status, a.number,
      a.office_id, a.property_id, ${osloDate(sql`a.inspection_at`)} as inspection_date,
      to_char(a.due_date, 'YYYY-MM-DD') as due_date,
      ${osloDate(sql`o.received_at`)} as received_date, o.created_by
    from orders o join assignments a on a.id = o.assignment_id
    where o.organization_id = ${organizationId} and o.external_ref like 'TD-%'
      and a.organization_id = ${organizationId}
    order by o.external_ref`);
}

function day(offset: number): string {
  return addDays(ANCHOR, offset);
}

/** Fanger alt seed-steget skriver til konsollen og stdout/stderr. */
function captureOutput() {
  const lines: string[] = [];
  const push = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  vi.spyOn(console, "log").mockImplementation(push);
  vi.spyOn(console, "info").mockImplementation(push);
  vi.spyOn(console, "warn").mockImplementation(push);
  vi.spyOn(console, "error").mockImplementation(push);
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  return lines;
}

afterEach(() => {
  vi.restoreAllMocks();
  resetInterrupt();
});

// ---------------------------------------------------------------------------------------------
// 4.1 Første kjøring, og alt som bare leser (én kjøring for hele blokken)
// ---------------------------------------------------------------------------------------------

describe("med full testdata (én kjøring)", () => {
  let organizationId = "";
  let sampleId: string | null = null;
  let sampleBefore: Record<string, number> = {};
  let sampleAfter: Record<string, number> = {};
  let countsBefore: Record<string, number> = {};
  let adminEventsBefore = 0;
  let adminAuditBefore = 0;
  let adminCountBefore = 0;
  let assignmentsInDb: AssignmentRow[] = [];

  beforeAll(async () => {
    await resetDatabase();
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runSeed(SEED_ENV);
    await runSampleSeed(SEED_ENV, TEST_NOW);
    organizationId = await byggconId();
    sampleId = await sampleOrgId();
    if (sampleId) sampleBefore = await countRows(sampleId);
    countsBefore = await countRows(organizationId);
    const adminId = await adminEmployeeId(organizationId);
    adminEventsBefore = (
      await one<{ n: number }>(
        sql`select count(*)::int as n from events where actor_id = ${adminId}`,
      )
    ).n;
    adminAuditBefore = (
      await one<{ n: number }>(
        sql`select count(*)::int as n from audit_log where actor_employee_id = ${adminId}`,
      )
    ).n;
    adminCountBefore = await activeAdminCount(organizationId);
    await seedTestdata();
    if (sampleId) sampleAfter = await countRows(sampleId);
    assignmentsInDb = await tdAssignments(organizationId);
    vi.restoreAllMocks();
  }, 120_000);

  describe("4.1 innhold", () => {
    it("4.1.1 alle TD-rader ligger i Byggcon, og prøveorganisasjonen har ingen nye rader", async () => {
      expect(sampleId).not.toBeNull();
      expect(sampleAfter).toEqual(sampleBefore);
      const foreign = await one<{
        orders: number;
        employees: number;
        contacts: number;
        firms: number;
        properties: number;
      }>(sql`
        select
          (select count(*)::int from orders where external_ref like 'TD-%' and organization_id <> ${organizationId}) as orders,
          (select count(*)::int from employees e join users u on u.id = e.user_id
            where u.email like ${TD_EMAIL} and e.organization_id <> ${organizationId}) as employees,
          (select count(*)::int from contacts where email like ${TD_EMAIL} and organization_id <> ${organizationId}) as contacts,
          (select count(*)::int from firms where name in ${sql.raw(`(${TESTDATA_FIRMS.map((firm) => `'${firm.name}'`).join(",")})`)} and organization_id <> ${organizationId}) as firms,
          (select count(*)::int from cadastral_units where gnr ~ '^90[0-9][0-9]$' and organization_id <> ${organizationId}) as properties`);
      expect(foreign).toEqual({ orders: 0, employees: 0, contacts: 0, firms: 0, properties: 0 });
    });

    it("4.1.2 antall ansatte, firma, meglere, eiendommer, statuser, ordre og reklamasjoner", async () => {
      const counts = await one<Row>(sql`
        select
          (select count(*)::int from employees e join users u on u.id = e.user_id
            where u.email like ${TD_EMAIL} and e.organization_id = ${organizationId}) as employees,
          (select count(*)::int from firms where organization_id = ${organizationId} and firm_type = 'broker_firm') as firms,
          (select count(*)::int from contacts c join firms f on f.id = c.firm_id
            where c.organization_id = ${organizationId} and c.email like ${TD_EMAIL}) as brokers,
          (select count(distinct p.id)::int from properties p join cadastral_units cu on cu.property_id = p.id
            where p.organization_id = ${organizationId} and cu.gnr ~ '^90[0-9][0-9]$') as properties,
          (select count(*)::int from orders where organization_id = ${organizationId}
            and external_ref like 'TD-%' and assignment_id is null and status = 'received') as order_only,
          (select count(*)::int from orders where organization_id = ${organizationId} and external_ref like 'TD-%') as orders`);
      expect(counts.employees).toBe(TESTDATA_EMPLOYEES.length);
      expect(Number(counts.employees)).toBeGreaterThanOrEqual(10);
      expect(Number(counts.employees)).toBeLessThanOrEqual(15);
      expect(counts.firms).toBe(TESTDATA_FIRMS.length);
      expect(counts.brokers).toBe(TESTDATA_FIRMS.flatMap((firm) => firm.brokers).length);
      expect(counts.properties).toBe(TESTDATA_PROPERTIES.length);
      expect(Number(counts.properties)).toBeGreaterThanOrEqual(45);
      expect(Number(counts.properties)).toBeLessThanOrEqual(55);
      expect(counts.order_only).toBe(ORDER_ONLY.length);
      expect(Number(counts.order_only)).toBeGreaterThanOrEqual(2);
      expect(counts.orders).toBe(TESTDATA_ORDERS.length);

      const statuses = new Set(assignmentsInDb.map((row) => row.status));
      for (const status of ASSIGNMENT_STATUSES) expect(statuses.has(status), status).toBe(true);
      for (const row of assignmentsInDb) {
        expect(row.status, row.ref).toBe(ORDER_BY_REF.get(row.ref)?.target);
      }

      const kinds = await rows<{ housing_type: string; ownership_form: string }>(sql`
        select distinct p.housing_type, p.ownership_form from properties p
        join assignments a on a.property_id = p.id join orders o on o.assignment_id = a.id
        where o.organization_id = ${organizationId} and o.external_ref like 'TD-%'`);
      const pairs = kinds.map((row) => `${row.housing_type}/${row.ownership_form}`);
      for (const pair of [
        "detached/freehold",
        "terraced/freehold",
        "semi_detached/freehold",
        "apartment/section",
        "apartment/cooperative",
        "holiday_home/freehold",
      ]) {
        expect(pairs, pair).toContain(pair);
      }

      const outcomes = await rows<{ outcome: string }>(sql`
        select c.outcome from claims c join orders o on o.assignment_id = c.assignment_id
        where o.organization_id = ${organizationId} and o.external_ref like 'TD-%'`);
      expect(outcomes.length).toBeGreaterThanOrEqual(4);
      expect(outcomes.length).toBeLessThanOrEqual(5);
      expect(new Set(outcomes.map((row) => row.outcome))).toEqual(new Set(CLAIM_OUTCOMES));
    });

    it("4.1.2 ordre fra minst 3 måneder bakover til befaringer minst 3 uker fremover", () => {
      const received = assignmentsInDb.map((row) => row.received_date).sort();
      const inspections = assignmentsInDb
        .flatMap((row) => (row.inspection_date ? [row.inspection_date] : []))
        .sort();
      expect(received[0]! <= day(-90)).toBe(true);
      expect(inspections.at(-1)! >= day(21)).toBe(true);
      expect(inspections[0]! >= day(-123)).toBe(true);
    });

    it("4.1.3 hvert TD-oppdrag har ansvarlig, sidemann (annen person), kontor og minst én part", async () => {
      const team = await rows<{
        ref: string;
        team_role: string;
        email: string;
        employee_id: string;
      }>(sql`
        select o.external_ref as ref, t.team_role, u.email, t.employee_id
        from assignment_team_members t join orders o on o.assignment_id = t.assignment_id
        join employees e on e.id = t.employee_id join users u on u.id = e.user_id
        where o.organization_id = ${organizationId} and o.external_ref like 'TD-%'
          and t.deleted_at is null and t.to_at is null`);
      const parties = await rows<{ ref: string; n: number }>(sql`
        select o.external_ref as ref, count(p.id)::int as n from orders o
        left join assignment_parties p on p.assignment_id = o.assignment_id and p.deleted_at is null
        where o.organization_id = ${organizationId} and o.external_ref like 'TD-%' and o.assignment_id is not null
        group by o.external_ref`);
      expect(assignmentsInDb).toHaveLength(ASSIGNMENT_ORDERS.length);
      for (const row of assignmentsInDb) {
        const members = team.filter((member) => member.ref === row.ref);
        const responsible = members.filter((member) => member.team_role === "responsible");
        const second = members.filter((member) => member.team_role === "peer_reviewer");
        const office = members.filter((member) => member.team_role === "office");
        expect(responsible, `${row.ref} ansvarlig`).toHaveLength(1);
        expect(second, `${row.ref} sidemann`).toHaveLength(1);
        expect(office.length, `${row.ref} kontor`).toBeGreaterThan(0);
        expect(second[0]!.employee_id).not.toBe(responsible[0]!.employee_id);
        expect(row.office_id, `${row.ref} kontor på oppdraget`).not.toBeNull();
        for (const member of members) expect(member.email, row.ref).toMatch(/@testdata\.invalid$/);
        const plan = ORDER_BY_REF.get(row.ref)!;
        expect(responsible[0]!.email).toBe(
          EMPLOYEE_BY_KEY.get(plan.responsibleKey!)!.email.toLowerCase(),
        );
        expect(second[0]!.email).toBe(EMPLOYEE_BY_KEY.get(plan.secondKey!)!.email.toLowerCase());
        expect(parties.find((party) => party.ref === row.ref)?.n ?? 0, row.ref).toBeGreaterThan(0);
      }
    });

    it("4.1.4 befarte oppdrag har bygning, etasje, rom og areal; bestilte har ingen", async () => {
      const tree = await rows<{
        ref: string;
        buildings: number;
        floors: number;
        rooms: number;
        areas: number;
      }>(sql`
        select o.external_ref as ref,
          count(distinct b.id)::int as buildings, count(distinct f.id)::int as floors,
          count(distinct r.id)::int as rooms, count(distinct fa.id)::int as areas
        from orders o
        left join report_buildings b on b.assignment_id = o.assignment_id
        left join floors f on f.report_building_id = b.id
        left join rooms r on r.floor_id = f.id
        left join floor_areas fa on fa.floor_id = f.id
        where o.organization_id = ${organizationId} and o.external_ref like 'TD-%' and o.assignment_id is not null
        group by o.external_ref`);
      for (const row of assignmentsInDb) {
        const found = tree.find((item) => item.ref === row.ref)!;
        if (row.status === "ordered") {
          expect(found, row.ref).toMatchObject({ buildings: 0, floors: 0, rooms: 0, areas: 0 });
        } else {
          expect(found.buildings, row.ref).toBeGreaterThan(0);
          expect(found.floors, row.ref).toBeGreaterThan(0);
          expect(found.rooms, row.ref).toBeGreaterThan(0);
          expect(found.areas, row.ref).toBeGreaterThan(0);
        }
      }
    });

    it("4.1.5 work_sessions på alle ferdige og fakturerte, bare med oppdiktede ansatte", async () => {
      const sessions = await rows<{ ref: string; status: string; email: string }>(sql`
        select o.external_ref as ref, a.status, u.email from work_sessions w
        join assignments a on a.id = w.assignment_id join orders o on o.assignment_id = a.id
        join employees e on e.id = w.employee_id join users u on u.id = e.user_id
        where w.organization_id = ${organizationId} and o.external_ref like 'TD-%'`);
      for (const session of sessions) {
        expect(session.email, session.ref).toMatch(/@testdata\.invalid$/);
        expect(session.email).not.toBe(SEED_ENV.SEED_ADMIN_EMAIL);
        expect(["completed", "invoiced"], session.ref).toContain(session.status);
      }
      for (const row of assignmentsInDb) {
        const has = sessions.some((session) => session.ref === row.ref);
        expect(has, row.ref).toBe(row.status === "completed" || row.status === "invoiced");
      }
    });

    it("4.1.6 ansvarlig har gyldig sertifisering på befaringsdagen; én har utløpt og mister report.publish", async () => {
      const certs = await rows<{ email: string; valid_from: string; valid_to: string | null }>(sql`
        select u.email, to_char(c.valid_from, 'YYYY-MM-DD') as valid_from,
          to_char(c.valid_to, 'YYYY-MM-DD') as valid_to
        from certifications c join employees e on e.id = c.employee_id join users u on u.id = e.user_id
        where c.organization_id = ${organizationId} and c.deleted_at is null and u.email like ${TD_EMAIL}`);
      for (const order of DONE_ORDERS) {
        const email = EMPLOYEE_BY_KEY.get(order.responsibleKey!)!.email.toLowerCase();
        const inspection = assignmentsInDb.find(
          (row) => row.ref === order.externalRef,
        )!.inspection_date!;
        const valid = certs.some(
          (cert) =>
            cert.email === email &&
            cert.valid_from <= inspection &&
            (cert.valid_to === null || cert.valid_to >= inspection),
        );
        expect(valid, `${order.externalRef} ${email}`).toBe(true);
      }
      const inspectors = TESTDATA_EMPLOYEES.filter((employee) =>
        employee.roles.includes("inspector"),
      );
      const expired = inspectors.filter((employee) =>
        certs
          .filter((cert) => cert.email === employee.email.toLowerCase())
          .every((cert) => cert.valid_to !== null && cert.valid_to < ANCHOR),
      );
      expect(expired).toHaveLength(1);
      for (const employee of inspectors) {
        const actor = await tdActor(employee.key);
        const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
        const canPublish = grant.permissions.includes("report.publish");
        // Sertifiseringen regnes fra dagens dato i tilgangssjekken; den utløpte gjelder uansett
        if (employee.key === expired[0]!.key) expect(canPublish, employee.key).toBe(false);
      }
      const valid = inspectors.filter((employee) => employee.key !== expired[0]!.key);
      const validGrants = await Promise.all(
        valid.map(async (employee) =>
          requireOrganizationAccess(
            await tdActor(employee.key),
            organizationId,
            "organization.read",
          ),
        ),
      );
      for (const [index, grant] of validGrants.entries()) {
        expect(grant.permissions, valid[index]!.key).toContain("report.publish");
      }
    });

    it("4.1.7 laget gjennom tjenestene: kontor lager ordre, ansvarlig bytter status, leder registrerer reklamasjon", async () => {
      const roleOf = await rows<{ employee_id: string; email: string; roles: string[] }>(sql`
        select e.id as employee_id, u.email, array_agg(r.role::text) as roles
        from employees e join users u on u.id = e.user_id
        join employee_roles r on r.employee_id = e.id and r.deleted_at is null
        where e.organization_id = ${organizationId} group by e.id, u.email`);
      const byId = new Map(roleOf.map((row) => [row.employee_id, row]));

      // Ordre: laget av en kontoransatt
      const creators = await rows<{ ref: string; created_by: string | null }>(sql`
        select external_ref as ref, created_by from orders
        where organization_id = ${organizationId} and external_ref like 'TD-%'`);
      for (const row of creators) {
        const employee = byId.get(row.created_by ?? "");
        expect(employee?.roles, row.ref).toContain("office");
        expect(employee?.email).toMatch(/@testdata\.invalid$/);
      }

      // Hendelser for opprettelse og hvert statusbytte
      const events = await rows<{
        ref: string;
        type: string;
        actor_id: string | null;
        data: Row;
      }>(sql`
        select o.external_ref as ref, ev.type, ev.actor_id::text as actor_id, ev.data
        from events ev join orders o
          on (o.assignment_id = ev.assignment_id or ev.data ->> 'orderId' = o.id::text)
        where o.organization_id = ${organizationId} and o.external_ref like 'TD-%'`);
      const responsibleByRef = new Map(
        (
          await rows<{ ref: string; employee_id: string }>(sql`
            select o.external_ref as ref, t.employee_id::text as employee_id
            from assignment_team_members t join orders o on o.assignment_id = t.assignment_id
            where o.organization_id = ${organizationId} and o.external_ref like 'TD-%'
              and t.team_role = 'responsible' and t.to_at is null`)
        ).map((row) => [row.ref, row.employee_id]),
      );
      for (const order of TESTDATA_ORDERS) {
        const own = events.filter((event) => event.ref === order.externalRef);
        expect(
          own.some((event) => event.type === "order.received"),
          order.externalRef,
        ).toBe(true);
        if (order.target === "order_only") continue;
        expect(
          own.some((event) => event.type === "assignment.created"),
          order.externalRef,
        ).toBe(true);
        const changes = own.filter((event) => event.type === "assignment.status_changed");
        const steps = ASSIGNMENT_STATUSES.indexOf(order.target as AssignmentStatus);
        expect(changes, order.externalRef).toHaveLength(steps);
        for (const change of changes) {
          expect(change.actor_id, order.externalRef).toBe(responsibleByRef.get(order.externalRef));
        }
      }
      const claimEvents = events.filter((event) => event.type === "claim.registered");
      expect(claimEvents).toHaveLength(CLAIM_ORDERS.length);
      for (const event of claimEvents) {
        expect(byId.get(event.actor_id ?? "")?.roles, event.ref).toContain("manager");
      }
      const claimCreators = await rows<{ created_by: string }>(sql`
        select c.created_by::text as created_by from claims c join orders o on o.assignment_id = c.assignment_id
        where o.organization_id = ${organizationId} and o.external_ref like 'TD-%'`);
      for (const row of claimCreators) expect(byId.get(row.created_by)?.roles).toContain("manager");
    });

    it("4.1.7 seed-admin er aldri aktør i events eller audit_log for testdataene", async () => {
      const adminId = await adminEmployeeId(organizationId);
      const eventsNow = await one<{ n: number }>(
        sql`select count(*)::int as n from events where actor_id = ${adminId}`,
      );
      const auditNow = await one<{ n: number }>(
        sql`select count(*)::int as n from audit_log where actor_employee_id = ${adminId}`,
      );
      expect(eventsNow.n).toBe(adminEventsBefore);
      expect(auditNow.n).toBe(adminAuditBefore);
    });

    it("4.1.8 hvert fakturert oppdrag har rekken bestilt → under arbeid → ferdig → fakturert", async () => {
      const changes = await rows<{ ref: string; from: string; to: string }>(sql`
        select o.external_ref as ref, ev.data ->> 'from' as "from", ev.data ->> 'to' as "to"
        from events ev join orders o on o.assignment_id = ev.assignment_id
        where o.organization_id = ${organizationId} and o.external_ref like 'TD-%'
          and ev.type = 'assignment.status_changed'
        order by ev.occurred_at, ev.id`);
      const invoiced = assignmentsInDb.filter((row) => row.status === "invoiced");
      expect(invoiced.length).toBeGreaterThan(0);
      for (const row of invoiced) {
        const path = changes
          .filter((change) => change.ref === row.ref)
          .map((change) => `${change.from}>${change.to}`);
        expect(path, row.ref).toEqual([
          "ordered>in_progress",
          "in_progress>completed",
          "completed>invoiced",
        ]);
      }
    });

    it("4.1.9 tidspunktene er flyttet til planlagt dato, i riktig rekkefølge", async () => {
      for (const row of assignmentsInDb) {
        const plan = ORDER_BY_REF.get(row.ref)!;
        expect(row.received_date, `${row.ref} mottatt`).toBe(day(plan.createdDay));
        expect(row.inspection_date, `${row.ref} befaring`).toBe(day(plan.inspectionDay!));
        if (plan.dueDay !== undefined)
          expect(row.due_date, `${row.ref} frist`).toBe(day(plan.dueDay));
      }
      const orderOnly = await rows<{ ref: string; received: string }>(sql`
        select external_ref as ref, ${osloDate(sql`received_at`)} as received from orders
        where organization_id = ${organizationId} and external_ref like 'TD-%' and assignment_id is null`);
      for (const row of orderOnly) {
        expect(row.received, row.ref).toBe(day(ORDER_BY_REF.get(row.ref)!.createdDay));
      }

      const events = await rows<{
        ref: string;
        type: string;
        to: string | null;
        date: string;
        at: Date;
      }>(sql`
        select o.external_ref as ref, ev.type, ev.data ->> 'to' as "to",
          ${osloDate(sql`ev.occurred_at`)} as date, ev.occurred_at as at
        from events ev join orders o
          on (o.assignment_id = ev.assignment_id or ev.data ->> 'orderId' = o.id::text)
        where o.organization_id = ${organizationId} and o.external_ref like 'TD-%'
        order by ev.occurred_at, ev.id`);
      for (const event of events) {
        // Ingen hendelse på TD-rader står på «nå» (kjøringens klokke), alle er planlagt
        expect(event.date <= ANCHOR, `${event.ref} ${event.type}`).toBe(true);
      }
      for (const plan of ASSIGNMENT_ORDERS) {
        const own = events.filter((event) => event.ref === plan.externalRef);
        const dateOf = (to: string) =>
          own.find((event) => event.type === "assignment.status_changed" && event.to === to)?.date;
        if (plan.startedDay !== undefined)
          expect(dateOf("in_progress"), plan.externalRef).toBe(day(plan.startedDay));
        if (plan.completedDay !== undefined)
          expect(dateOf("completed"), plan.externalRef).toBe(day(plan.completedDay));
        if (plan.invoicedDay !== undefined)
          expect(dateOf("invoiced"), plan.externalRef).toBe(day(plan.invoicedDay));
        const times = own.map((event) => new Date(event.at).getTime());
        expect(
          [...times].sort((a, b) => a - b),
          plan.externalRef,
        ).toEqual(times);
        const received = own.find((event) => event.type === "order.received");
        const created = own.find((event) => event.type === "assignment.created");
        expect(new Date(received!.at).getTime()).toBeLessThanOrEqual(
          new Date(created!.at).getTime(),
        );
      }

      const claims = await rows<{ ref: string; received: string }>(sql`
        select o.external_ref as ref, to_char(c.received_at, 'YYYY-MM-DD') as received
        from claims c join orders o on o.assignment_id = c.assignment_id
        where o.organization_id = ${organizationId} and o.external_ref like 'TD-%'`);
      for (const claim of claims) {
        expect(claim.received, claim.ref).toBe(
          day(ORDER_BY_REF.get(claim.ref)!.claim!.receivedDay),
        );
      }
    });

    it("4.1.10 oppdragsnumrene er unike, og telleren har økt med antall TD-oppdrag", async () => {
      const numbers = assignmentsInDb.map((row) => row.number);
      expect(new Set(numbers).size).toBe(numbers.length);
      const after = await countRows(organizationId);
      expect(
        after["number_sequences.next_value"]! - countsBefore["number_sequences.next_value"]!,
      ).toBe(
        // Første oppdrag lager serien med neste verdi 2 (etter nummer 1)
        countsBefore["number_sequences"] === 0
          ? ASSIGNMENT_ORDERS.length + 1
          : ASSIGNMENT_ORDERS.length,
      );
    });
  });

  // -------------------------------------------------------------------------------------------
  // 4.1.11 De faglige kravene mot radene i databasen
  // -------------------------------------------------------------------------------------------

  describe("4.1.11 faglige krav i databasen", () => {
    type DbRoom = {
      ref: string;
      building: string;
      floor: string;
      level: number;
      floor_below: boolean;
      room_type: string;
      room_name: string;
      area_type: string;
      room_below: boolean;
    };
    type DbArea = {
      ref: string;
      building: string;
      floor: string;
      bra_i: number | null;
      bra_e: number | null;
      bra_b: number | null;
      alh: number | null;
      method: string | null;
      measured_by_email: string | null;
    };
    let dbRooms: DbRoom[] = [];
    let dbAreas: DbArea[] = [];

    beforeAll(async () => {
      dbRooms = await rows<DbRoom>(sql`
        select o.external_ref as ref, b.name as building, f.name as floor, f.level,
          f.below_ground as floor_below, r.room_type, r.name as room_name, r.area_type,
          r.below_ground as room_below
        from rooms r join floors f on f.id = r.floor_id
        join report_buildings b on b.id = f.report_building_id
        join orders o on o.assignment_id = b.assignment_id
        where o.organization_id = ${organizationId} and o.external_ref like 'TD-%'
          and r.deleted_at is null and f.deleted_at is null and b.deleted_at is null`);
      dbAreas = (
        await rows<DbArea>(sql`
          select o.external_ref as ref, b.name as building, f.name as floor,
            fa.bra_i::float8 as bra_i, fa.bra_e::float8 as bra_e, fa.bra_b::float8 as bra_b,
            fa.alh::float8 as alh, fa.method, u.email as measured_by_email
          from floor_areas fa join floors f on f.id = fa.floor_id
          join report_buildings b on b.id = f.report_building_id
          join orders o on o.assignment_id = b.assignment_id
          left join employees e on e.id = fa.measured_by left join users u on u.id = e.user_id
          where o.organization_id = ${organizationId} and o.external_ref like 'TD-%'
            and fa.deleted_at is null`)
      ).map((row) => ({
        ...row,
        bra_i: row.bra_i === null ? null : Number(row.bra_i),
        bra_e: row.bra_e === null ? null : Number(row.bra_e),
        bra_b: row.bra_b === null ? null : Number(row.bra_b),
        alh: row.alh === null ? null : Number(row.alh),
      }));
    });

    const BEFART = ASSIGNMENT_ORDERS.filter((order) => order.target !== "ordered").map(
      (order) => [order.externalRef, order] as const,
    );

    it.each(BEFART)("bygninger, etasjer, areal og rom er som i datafilen (%s)", (ref, order) => {
      const property = PROPERTY_BY_KEY.get(order.propertyKey!)!;
      const expectedRooms = property.buildings
        .flatMap((building) =>
          building.floors.flatMap((floor) =>
            floor.rooms.map((room) =>
              [
                building.name,
                floor.name,
                floor.level,
                floor.belowGround,
                room.roomType,
                room.name,
                room.areaType,
                room.belowGround,
              ].join("|"),
            ),
          ),
        )
        .sort();
      const actualRooms = dbRooms
        .filter((room) => room.ref === ref)
        .map((room) =>
          [
            room.building,
            room.floor,
            room.level,
            room.floor_below,
            room.room_type,
            room.room_name,
            room.area_type,
            room.room_below,
          ].join("|"),
        )
        .sort();
      expect(actualRooms).toEqual(expectedRooms);

      const expectedAreas = property.buildings
        .flatMap((building) =>
          building.floors.map((floor) => {
            const area = floor.area as Record<string, unknown>;
            return [
              building.name,
              floor.name,
              area.braI ?? null,
              area.braE ?? null,
              area.braB ?? null,
              area.alh ?? null,
              area.method,
            ].join("|");
          }),
        )
        .sort();
      const actualAreas = dbAreas
        .filter((area) => area.ref === ref)
        .map((area) =>
          [
            area.building,
            area.floor,
            area.bra_i,
            area.bra_e,
            area.bra_b,
            area.alh,
            area.method,
          ].join("|"),
        )
        .sort();
      expect(actualAreas).toEqual(expectedAreas);
    });

    it("arealtype følger romtypen, not_bra på kryperom og uinnredet loft, «under terreng» følger etasjen", () => {
      expect(dbRooms.length).toBeGreaterThan(100);
      for (const room of dbRooms) {
        const label = `${room.ref} ${room.floor} ${room.room_name}`;
        expect(room.area_type, label).toBe(suggestAreaType(room.room_type));
        expect(room.area_type === "not_bra", label).toBe(
          room.room_type === "crawl_space" || room.room_type === "unfinished_attic",
        );
        if (room.room_type !== "crawl_space") expect(room.room_below, label).toBe(room.floor_below);
      }
    });

    it("BRA-e/BRA-b har rom med samme arealtype, ALH bare på loft og hems, drawing bare på fellesbod", () => {
      for (const area of dbAreas) {
        const label = `${area.ref} ${area.building} ${area.floor}`;
        const types = new Set(
          dbRooms
            .filter(
              (room) =>
                room.ref === area.ref &&
                room.building === area.building &&
                room.floor === area.floor,
            )
            .map((room) => room.area_type),
        );
        const roomTypes = new Set(
          dbRooms
            .filter(
              (room) =>
                room.ref === area.ref &&
                room.building === area.building &&
                room.floor === area.floor,
            )
            .map((room) => room.room_type),
        );
        expect((area.bra_e ?? 0) > 0, `${label} BRA-e`).toBe(types.has("bra_e"));
        expect((area.bra_b ?? 0) > 0, `${label} BRA-b`).toBe(types.has("bra_b"));
        if ((area.alh ?? 0) > 0) {
          expect(area.floor, label).toMatch(/loft|hems/i);
          expect((area.bra_i ?? 0) + (area.bra_e ?? 0) + (area.bra_b ?? 0), label).toBe(0);
        }
        const sharedStorage =
          roomTypes.size === 1 && roomTypes.has("external_storage") && area.method === "drawing";
        expect(area.method, label).toBe(sharedStorage ? "drawing" : "laser");
        // Målt av en oppdiktet takstmann, aldri admin
        if (area.measured_by_email !== null) {
          expect(area.measured_by_email, label).toMatch(/@testdata\.invalid$/);
        }
      }
    });

    it("hver befart bolig har bad og kjøkken", () => {
      for (const [ref] of BEFART) {
        const types = dbRooms.filter((room) => room.ref === ref).map((room) => room.room_type);
        expect(
          types.some((type) => type === "bathroom" || type === "bathroom_laundry"),
          ref,
        ).toBe(true);
        expect(
          types.some((type) => type === "kitchen" || type === "living_kitchen"),
          ref,
        ).toBe(true);
      }
    });

    it("eierform og matrikkel henger sammen; fellesarealer bare på sameie og borettslag", async () => {
      const found = await rows<{
        ref: string;
        housing_type: string;
        ownership_form: string;
        gnr: string;
        snr: string | null;
        fnr: string | null;
        share_number: string | null;
        association_name: string | null;
        common: number;
      }>(sql`
        select o.external_ref as ref, p.housing_type, p.ownership_form, cu.gnr, cu.snr, cu.fnr,
          cu.share_number, cu.association_name,
          (select count(*)::int from common_areas c where c.assignment_id = a.id and c.deleted_at is null) as common
        from orders o join assignments a on a.id = o.assignment_id
        join properties p on p.id = a.property_id join cadastral_units cu on cu.property_id = p.id
        where o.organization_id = ${organizationId} and o.external_ref like 'TD-%'`);
      expect(found).toHaveLength(ASSIGNMENT_ORDERS.length);
      for (const row of found) {
        expect(Number(row.gnr), row.ref).toBeGreaterThanOrEqual(9001);
        expect(Number(row.gnr), row.ref).toBeLessThanOrEqual(9099);
        if (row.ownership_form === "section") {
          expect(row.snr, row.ref).toBeTruthy();
          expect(row.share_number, row.ref).toBeNull();
        } else if (row.ownership_form === "cooperative") {
          expect(row.association_name, row.ref).toBeTruthy();
          expect(row.share_number, row.ref).toBeTruthy();
          expect(row.snr, row.ref).toBeNull();
        } else {
          expect(row.ownership_form, row.ref).toBe("freehold");
          expect(row.snr, row.ref).toBeNull();
          expect(row.share_number, row.ref).toBeNull();
        }
        const shared = row.ownership_form === "section" || row.ownership_form === "cooperative";
        expect(row.common > 0, row.ref).toBe(shared);
      }
      expect(found.some((row) => row.housing_type === "holiday_home" && row.fnr)).toBe(true);
    });

    it("reklamasjoner: bare på ferdige og fakturerte, mottatt etter ferdig, beløp bare ved medhold og forlik", async () => {
      const found = await rows<{
        ref: string;
        status: string;
        outcome: string;
        amount: number | null;
        received: string;
        completed: string | null;
        part: string;
      }>(sql`
        select o.external_ref as ref, a.status, c.outcome, c.amount,
          to_char(c.received_at, 'YYYY-MM-DD') as received, c.building_part_text as part,
          (select ${osloDate(sql`ev.occurred_at`)} from events ev
            where ev.assignment_id = a.id and ev.type = 'assignment.status_changed'
              and ev.data ->> 'to' = 'completed' order by ev.occurred_at limit 1) as completed
        from claims c join assignments a on a.id = c.assignment_id join orders o on o.assignment_id = a.id
        where o.organization_id = ${organizationId} and o.external_ref like 'TD-%'`);
      expect(found.length).toBe(CLAIM_ORDERS.length);
      for (const claim of found) {
        expect(["completed", "invoiced"], claim.ref).toContain(claim.status);
        expect(claim.completed, claim.ref).not.toBeNull();
        expect(claim.received > claim.completed!, claim.ref).toBe(true);
        if (claim.outcome === "upheld" || claim.outcome === "settled") {
          expect(claim.amount, claim.ref).toBeGreaterThan(0);
        } else {
          expect(claim.amount, claim.ref).toBeNull();
        }
      }
      const parts = found.map((claim) => claim.part.toLocaleLowerCase("nb"));
      for (const part of ["våtrom", "tak", "drenering", "areal"]) expect(parts).toContain(part);
    });

    it("befaring før ferdig, og egenerklæring mottatt på ferdige og fakturerte", async () => {
      const found = await rows<{ ref: string; declaration: boolean | null; status: string }>(sql`
        select o.external_ref as ref, o.seller_declaration_received as declaration, a.status
        from orders o join assignments a on a.id = o.assignment_id
        where o.organization_id = ${organizationId} and o.external_ref like 'TD-%'`);
      for (const row of found) {
        if (row.status === "completed" || row.status === "invoiced") {
          expect(row.declaration, row.ref).toBe(true);
          const plan = ORDER_BY_REF.get(row.ref)!;
          const inspection = assignmentsInDb.find((item) => item.ref === row.ref)!.inspection_date!;
          expect(inspection < day(plan.completedDay!), row.ref).toBe(true);
          expect(inspection < ANCHOR, row.ref).toBe(true);
        }
      }
    });
  });

  // -------------------------------------------------------------------------------------------
  // 4.6.5 Ansatt i en annen organisasjon, 4.8 tilgang per rolle, 4.9 vask, 4.11 ytelse
  // -------------------------------------------------------------------------------------------

  describe("4.6.5 ansatt i en annen organisasjon", () => {
    it("ser ingen TD-oppdrag i egne lister og får AccessDeniedError mot Byggcon", async () => {
      const other = await createOrganization("Annen takst (oppdiktet)");
      const user = await createUser({ name: "Annen Admin", email: "annen.admin@annen.invalid" });
      await createEmployee(user, other.id, ["admin"]);
      for (const status of ASSIGNMENT_STATUSES) {
        const own = await listWorkQueue(user, other.id, { status, mineOnly: false, query: "" });
        expect(own.total, status).toBe(0);
        await expect(
          listWorkQueue(user, organizationId, { status, mineOnly: false, query: "" }),
        ).rejects.toBeInstanceOf(AccessDeniedError);
      }
      const orders = await listOrders(user, other.id);
      expect(orders.items.filter((item) => item.externalRef?.startsWith("TD-"))).toEqual([]);
      await expect(listOrders(user, organizationId)).rejects.toBeInstanceOf(AccessDeniedError);
      const stats = await getTimeStatistics(user, other.id);
      expect(stats.assignmentCount).toBe(0);
      await expect(getTimeStatistics(user, organizationId)).rejects.toBeInstanceOf(
        AccessDeniedError,
      );
    });
  });

  describe("4.8 tilgang per rolle med testdata", () => {
    async function workQueueIds(actor: Actor, mineOnly: boolean): Promise<Set<string>> {
      const ids = new Set<string>();
      for (const status of ASSIGNMENT_STATUSES) {
        const result = await listWorkQueue(actor, organizationId, { status, mineOnly, query: "" });
        for (const item of result.items) ids.add(item.id);
      }
      return ids;
    }

    const ROLE_KEYS: [string, string | null][] = [
      ["takstmann", "emp01"],
      ["kontor", "emp04"],
      ["leder", "emp05"],
      ["admin", null],
    ];

    it.each(ROLE_KEYS)(
      "4.8.1 %s ser alle TD-oppdrag i arbeidskøen og TD-ordre i ordrelisten",
      async (_label, key) => {
        const actor = key ? await tdActor(key) : await adminActor();
        const ids = await workQueueIds(actor, false);
        for (const row of assignmentsInDb) expect(ids.has(row.assignment_id), row.ref).toBe(true);
        const orders = await listOrders(actor, organizationId);
        expect(orders.total).toBeGreaterThanOrEqual(TESTDATA_ORDERS.length);
        expect(orders.items.some((item) => item.externalRef?.startsWith("TD-"))).toBe(true);
      },
    );

    it("4.8.1 rollene i oppslaget er de i datafilen", () => {
      expect(EMPLOYEE_BY_KEY.get("emp01")?.roles).toEqual(["inspector"]);
      expect(EMPLOYEE_BY_KEY.get("emp04")?.roles).toEqual(["office"]);
      expect(EMPLOYEE_BY_KEY.get("emp05")?.roles).toEqual(["manager"]);
    });

    it("4.8.2 «mine» gir bare oppdrag der takstmannen er i teamet, og noen har befaring denne uken", async () => {
      const inspectors = TESTDATA_EMPLOYEES.filter((employee) =>
        employee.roles.includes("inspector"),
      );
      // Uken (mandag–søndag) som ankeret ligger i
      const weekday = (new Date(`${ANCHOR}T12:00:00Z`).getUTCDay() + 6) % 7;
      const monday = day(-weekday);
      const sunday = addDays(monday, 6);
      let someoneThisWeek = false;
      for (const employee of inspectors) {
        const actor = await tdActor(employee.key);
        const mine = await workQueueIds(actor, true);
        const team = new Set(
          (
            await rows<{ assignment_id: string }>(sql`
              select t.assignment_id::text as assignment_id from assignment_team_members t
              join employees e on e.id = t.employee_id join users u on u.id = e.user_id
              where t.organization_id = ${organizationId} and u.email = ${employee.email.toLowerCase()}
                and t.deleted_at is null and t.to_at is null`)
          ).map((row) => row.assignment_id),
        );
        for (const id of mine) expect(team.has(id), `${employee.key} ${id}`).toBe(true);
        const thisWeek = assignmentsInDb.filter(
          (row) =>
            mine.has(row.assignment_id) &&
            row.inspection_date !== null &&
            row.inspection_date >= monday &&
            row.inspection_date <= sunday,
        );
        if (thisWeek.length > 0) someoneThisWeek = true;
      }
      expect(someoneThisWeek).toBe(true);
    });

    it("4.8.3 leder og admin ser reklamasjonene; takstmann og kontor får AccessDeniedError", async () => {
      const [claim] = await rows<{ id: string; assignment_id: string }>(sql`
        select c.id::text as id, c.assignment_id::text as assignment_id from claims c
        join orders o on o.assignment_id = c.assignment_id
        where o.organization_id = ${organizationId} and o.external_ref like 'TD-%' limit 1`);
      expect(claim).toBeDefined();
      for (const actor of [await tdActor("emp05"), await adminActor()]) {
        const list = await listClaimsForAssignment(actor, organizationId, claim!.assignment_id);
        expect(list.map((item) => item.id)).toContain(claim!.id);
        const detail = await getClaim(actor, organizationId, claim!.id);
        expect(detail.id).toBe(claim!.id);
      }
      for (const key of ["emp01", "emp04"]) {
        const actor = await tdActor(key);
        await expect(
          listClaimsForAssignment(actor, organizationId, claim!.assignment_id),
          key,
        ).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(getClaim(actor, organizationId, claim!.id), key).rejects.toBeInstanceOf(
          AccessDeniedError,
        );
      }
    });

    it("4.9.1 vasken bytter ut partens navn, e-post, telefon, adresse og matrikkel (ingen KI-kall)", async () => {
      const [target] = await rows<{
        assignment_id: string;
        name: string;
        email: string;
        phone: string;
        address: string;
        gnr: string;
        bnr: string;
      }>(sql`
        select a.id::text as assignment_id, p.name, p.email, p.phone, pr.address, cu.gnr, cu.bnr
        from orders o join assignments a on a.id = o.assignment_id
        join assignment_parties p on p.assignment_id = a.id and p.role = 'seller' and p.deleted_at is null
        join properties pr on pr.id = a.property_id join cadastral_units cu on cu.property_id = pr.id
        where o.organization_id = ${organizationId} and o.external_ref like 'TD-%'
          and p.email is not null and p.phone is not null
        order by o.external_ref limit 1`);
      expect(target).toBeDefined();
      expect(target!.phone).toMatch(TESTDATA_PHONE_PATTERN);
      const grant = await requireOrganizationAccess(await adminActor(), organizationId);
      const known = await loadKnownValues(grant, target!.assignment_id);
      const text =
        `Selger ${target!.name} (${target!.email}, tlf. ${target!.phone}) eier ${target!.address}, ` +
        `gnr ${target!.gnr}/${target!.bnr}. Badet har sprekk i flisene.`;
      const result = redactText(text, known);
      for (const value of [target!.name, target!.email, target!.phone, target!.address]) {
        expect(result.text, value).not.toContain(value);
      }
      expect(result.text).not.toMatch(new RegExp(`\\b${target!.gnr}\\s*/\\s*${target!.bnr}\\b`));
      for (const part of target!.name.split(" ")) expect(result.text).not.toContain(part);
      expect(result.text.replace(/\s+/g, "")).not.toContain(
        target!.phone.replace(/[\s+]/g, "").slice(2),
      );
      expect(result.count).toBeGreaterThanOrEqual(5);
      expect(result.text).toContain("Badet har sprekk i flisene.");

      // 4.9.2 telefonnummeret fanges også i andre skrivemåter
      const national = target!.phone.replace(/^\+47\s*/, "");
      const digits = national.replace(/\s+/g, "");
      for (const variant of [`0047 ${national}`, `00047 ${national}`, digits, `+47${digits}`]) {
        const redacted = redactText(`Ring ${variant} før befaringen.`, known);
        expect(redacted.text.replace(/\s+/g, ""), variant).not.toContain(digits);
      }

      // 4.9.3 ingen KI-kall
      const log = await one<{ n: number }>(sql`select count(*)::int as n from ai_usage_log`);
      expect(log.n).toBe(0);
    });

    it("4.11.1 arbeidskøen og ordrelisten svarer på under 2 sekunder med full testdata", async () => {
      const actor = await tdActor("emp04");
      async function median(call: () => Promise<unknown>): Promise<number> {
        await call();
        const times: number[] = [];
        for (let i = 0; i < 3; i += 1) {
          const start = performance.now();
          await call();
          times.push(performance.now() - start);
        }
        return times.sort((a, b) => a - b)[1]!;
      }
      for (const status of ASSIGNMENT_STATUSES) {
        const ms = await median(() =>
          listWorkQueue(actor, organizationId, { status, mineOnly: false, query: "" }),
        );
        expect(ms, `arbeidskø ${status}`).toBeLessThan(2000);
      }
      const street = TESTDATA_STREETS[0]!;
      expect(await median(() => listOrders(actor, organizationId))).toBeLessThan(2000);
      expect(await median(() => listOrders(actor, organizationId, { query: street }))).toBeLessThan(
        2000,
      );
      expect(
        await median(() =>
          listWorkQueue(actor, organizationId, {
            status: "invoiced",
            mineOnly: false,
            query: street,
          }),
        ),
      ).toBeLessThan(2000);
    });

    it("4.11.2 ordrelisten over grensen gir 50 rader, riktig total og teksten om at ikke alle vises", async () => {
      const actor = await tdActor("emp04");
      const result = await listOrders(actor, organizationId);
      expect(TESTDATA_ORDERS.length).toBeGreaterThan(ORDER_LIST_LIMIT);
      expect(result.items).toHaveLength(ORDER_LIST_LIMIT);
      const total = await one<{ n: number }>(sql`
        select count(*)::int as n from orders where organization_id = ${organizationId} and deleted_at is null`);
      expect(result.total).toBe(total.n);
      expect(orderListSummary(result.items.length, result.total)).toContain(
        `Viser ${ORDER_LIST_LIMIT} av ${total.n}`,
      );
      // Søket finner TD-ordre på et oppdiktet gatenavn
      const search = await listOrders(actor, organizationId, { query: TESTDATA_STREETS[0]! });
      expect(search.total).toBeGreaterThan(0);
    });

    it("4.11.3 tidsstatistikken svarer på under 2 sekunder og gir tall > 0", async () => {
      const actor = await tdActor("emp05");
      const start = performance.now();
      const stats = await getTimeStatistics(actor, organizationId);
      expect(performance.now() - start).toBeLessThan(2000);
      expect(stats.assignmentCount).toBe(DONE_ORDERS.length);
      expect(stats.total.averageSeconds).toBeGreaterThan(0);
    });

    // Sist i blokken, fordi den endrer et notat og en innstilling
    it("4.8.4 takstmann kan endre med access.inspectors_edit_all på, ikke med den av; admin alltid", async () => {
      const inspector = await tdActor("emp01");
      const inspectorEmail = EMPLOYEE_BY_KEY.get("emp01")!.email.toLowerCase();
      const [notInTeam] = await rows<{ assignment_id: string }>(sql`
        select a.id::text as assignment_id from assignments a join orders o on o.assignment_id = a.id
        where o.organization_id = ${organizationId} and o.external_ref like 'TD-%'
          and not exists (
            select 1 from assignment_team_members t join employees e on e.id = t.employee_id
            join users u on u.id = e.user_id
            where t.assignment_id = a.id and u.email = ${inspectorEmail})
        order by o.external_ref limit 1`);
      expect(notInTeam).toBeDefined();
      await updateAssignmentNote(inspector, organizationId, notInTeam!.assignment_id, "Notat 1");
      await mergeOrganizationSettings(organizationId, { "access.inspectors_edit_all": false });
      try {
        await expect(
          updateAssignmentNote(inspector, organizationId, notInTeam!.assignment_id, "Notat 2"),
        ).rejects.toBeInstanceOf(AccessDeniedError);
        await updateAssignmentNote(
          await adminActor(),
          organizationId,
          notInTeam!.assignment_id,
          "Notat 3",
        );
      } finally {
        await mergeOrganizationSettings(organizationId, { "access.inspectors_edit_all": true });
      }
    });
  });

  // -------------------------------------------------------------------------------------------
  // 4.7 Admin og ingen oppdiktet admin, 6 ting som ikke skal skje
  // -------------------------------------------------------------------------------------------

  describe("4.7 admin og oppdiktede ansatte", () => {
    it("4.7.2 seed-admin har samme roller, er aktiv og har fortsatt organization.manage", async () => {
      const admin = await adminActor();
      expect(await activeAdminCount(organizationId)).toBe(adminCountBefore);
      const roles = await rows<{ role: string }>(sql`
        select r.role::text as role from employee_roles r join employees e on e.id = r.employee_id
        join users u on u.id = e.user_id
        where u.email = ${SEED_ENV.SEED_ADMIN_EMAIL} and r.deleted_at is null and e.organization_id = ${organizationId}`);
      expect(roles.map((row) => row.role)).toEqual(["admin"]);
      const grant = await findEmployeeGrant(admin);
      expect(grant?.grant.organizationId).toBe(organizationId);
      const manage = await requireOrganizationAccess(admin, organizationId, "organization.manage");
      expect(manage.roles).toContain("admin");
      const state = await one<{ deleted_at: Date | null; deactivated_at: Date | null }>(sql`
        select e.deleted_at, e.deactivated_at from employees e join users u on u.id = e.user_id
        where u.email = ${SEED_ENV.SEED_ADMIN_EMAIL} and e.organization_id = ${organizationId}`);
      expect(state).toEqual({ deleted_at: null, deactivated_at: null });
    });

    it("4.7.3 ingen oppdiktet ansatt har admin, sessions, accounts, eller deler navn/domene med seed-admin", async () => {
      const found = await rows<{
        email: string;
        name: string;
        roles: string[] | null;
        sessions: number;
        accounts: number;
      }>(sql`
        select u.email, u.name,
          (select array_agg(r.role::text) from employee_roles r where r.employee_id = e.id) as roles,
          (select count(*)::int from sessions s where s.user_id = u.id) as sessions,
          (select count(*)::int from accounts a where a.user_id = u.id) as accounts
        from employees e join users u on u.id = e.user_id
        where e.organization_id = ${organizationId} and u.email like ${TD_EMAIL}`);
      expect(found).toHaveLength(TESTDATA_EMPLOYEES.length);
      const adminDomain = SEED_ENV.SEED_ADMIN_EMAIL.split("@")[1];
      for (const row of found) {
        expect(row.roles ?? [], row.email).not.toContain("admin");
        expect(row.sessions, row.email).toBe(0);
        expect(row.accounts, row.email).toBe(0);
        expect(row.name).not.toBe(SEED_ENV.SEED_ADMIN_NAME);
        expect(row.email.split("@")[1]).not.toBe(adminDomain);
      }
      // Alle rollene unntatt admin finnes blant de oppdiktede
      const roles = new Set(found.flatMap((row) => row.roles ?? []));
      expect([...roles].sort()).toEqual(employeeRoles.filter((role) => role !== "admin").sort());
    });

    it("4.7.4 de oppdiktede kan ikke logge inn: e-posten er på .invalid og ingen har innlogging", async () => {
      const users = await rows<{ email: string; sessions: number; accounts: number }>(sql`
        select u.email,
          (select count(*)::int from sessions s where s.user_id = u.id) as sessions,
          (select count(*)::int from accounts a where a.user_id = u.id) as accounts
        from users u where u.email like ${TD_EMAIL}`);
      expect(users.length).toBe(TESTDATA_EMPLOYEES.length);
      for (const user of users) {
        expect(user.email).toMatch(/@testdata\.invalid$/);
        expect(user.sessions + user.accounts, user.email).toBe(0);
      }
    });
  });

  describe("6 ting som ikke skal skje", () => {
    it("6.1–6.5 ingen KI-logg, ingen innlogging, ingen filer, maler, regler, svar, TG eller avtaler", async () => {
      const after = await countRows(organizationId);
      for (const table of [
        "ai_usage_log",
        "files",
        "client_agreements",
        "template_families",
        "template_versions",
        "rules",
        "rule_test_cases",
        "trial_answers",
      ]) {
        expect(after[table], table).toBe(countsBefore[table]);
      }
      const all = await countRows();
      expect(all.ai_usage_log).toBe(0);
      const tdLogins = await one<{ n: number }>(sql`
        select (select count(*) from sessions s join users u on u.id = s.user_id where u.email like ${TD_EMAIL})::int
          + (select count(*) from accounts a join users u on u.id = a.user_id where u.email like ${TD_EMAIL})::int as n`);
      expect(tdLogins.n).toBe(0);
      // Ingen TG noe sted i TD-radene
      const json = JSON.stringify(await snapshot(organizationId));
      expect(json).not.toMatch(/\bTG\s?[0-3]\b/);
      expect(json).not.toMatch(/tilstandsgrad/i);
    });

    it("6.3 prøveorganisasjonen er uendret", () => {
      expect(sampleAfter).toEqual(sampleBefore);
    });
  });

  // -------------------------------------------------------------------------------------------
  // 4.6.4 Fremmednøkler peker aldri til en annen organisasjon
  // -------------------------------------------------------------------------------------------

  describe("4.6.4 fremmednøkler", () => {
    const LINKS: [string, string, string][] = [
      ["assignments", "office_id", "offices"],
      ["assignments", "company_id", "companies"],
      ["assignments", "property_id", "properties"],
      ["assignments", "order_id", "orders"],
      ["orders", "assignment_id", "assignments"],
      ["orders", "ordered_by_contact_id", "contacts"],
      ["orders", "ordered_by_firm_id", "firms"],
      ["contacts", "firm_id", "firms"],
      ["employees", "company_id", "companies"],
      ["employees", "office_id", "offices"],
      ["employee_roles", "employee_id", "employees"],
      ["certifications", "employee_id", "employees"],
      ["cadastral_units", "property_id", "properties"],
      ["common_areas", "assignment_id", "assignments"],
      ["report_buildings", "assignment_id", "assignments"],
      ["floors", "report_building_id", "report_buildings"],
      ["floor_areas", "floor_id", "floors"],
      ["floor_areas", "measured_by", "employees"],
      ["rooms", "floor_id", "floors"],
      ["work_sessions", "assignment_id", "assignments"],
      ["work_sessions", "employee_id", "employees"],
      ["claims", "assignment_id", "assignments"],
      ["claims", "claimant_party_id", "assignment_parties"],
      ["assignment_team_members", "assignment_id", "assignments"],
      ["assignment_team_members", "employee_id", "employees"],
      ["assignment_parties", "assignment_id", "assignments"],
      ["assignment_parties", "contact_id", "contacts"],
      ["assignment_parties", "firm_id", "firms"],
    ];
    it.each(LINKS)(
      "%s.%s peker bare til %s i samme organisasjon",
      async (child, column, parent) => {
        const row = await one<{ n: number }>(sql`
        select count(*)::int as n from ${sql.identifier(child)} c
        join ${sql.identifier(parent)} p on p.id = c.${sql.identifier(column)}
        where c.organization_id <> p.organization_id`);
        expect(row.n).toBe(0);
      },
    );
  });
});

// ---------------------------------------------------------------------------------------------
// 4.2 Idempotens
// ---------------------------------------------------------------------------------------------

describe("4.2 idempotens", () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runSeed(SEED_ENV);
  });

  it("4.2.1, 4.2.2, 4.2.4 og 4.2.5: andre og tredje kjøring skriver ingenting", async () => {
    const organizationId = await byggconId();
    const first = await seedTestdata();
    const counts = await countRows();
    const updated = await updatedAtByRow(organizationId);

    const second = await seedTestdata();
    expect(await countRows()).toEqual(counts);
    expect(await updatedAtByRow(organizationId)).toEqual(updated);

    const third = await seedTestdata();
    expect(await countRows()).toEqual(counts);
    expect(third).toEqual(second);

    expect(first.orders.every((item) => item.result === "created")).toBe(true);
    expect(second.orders.every((item) => item.result === "existing")).toBe(true);
    expect(Object.values(second.created).every((value) => value === 0)).toBe(true);
    expect(Object.values(first.created).some((value) => value > 0)).toBe(true);
    expect(counts.ai_usage_log).toBe(0);
  }, 120_000);

  it("4.2.5 loggen sier «laget» ved første og «finnes fra før» ved andre kjøring", async () => {
    const lines = captureOutput();
    await seedTestdata();
    const firstRun = lines.splice(0).join("\n");
    await seedTestdata();
    const secondRun = lines.join("\n");
    expect(firstRun).toContain("laget");
    expect(secondRun).toContain("finnes fra før");
    expect(secondRun).not.toMatch(/TD-\d{4}: laget/);
  }, 120_000);

  it("4.2.3 klokka 30 dager fram: samme radtall og samme data (ingen datoer flytter seg)", async () => {
    const organizationId = await byggconId();
    await seedTestdata(TEST_NOW);
    const counts = await countRows();
    const before = await snapshot(organizationId);
    const later = new Date(TEST_NOW.getTime() + 30 * 24 * 60 * 60 * 1000);
    await seedTestdata(later);
    expect(await countRows()).toEqual(counts);
    expect(await snapshot(organizationId)).toEqual(before);
  }, 120_000);

  it("4.2.3 ankeret er datoen for created_at på TD-0001", async () => {
    const organizationId = await byggconId();
    await seedTestdata(TEST_NOW);
    const row = await one<{ created: string; received: string }>(sql`
      select ${osloDate(sql`created_at`)} as created, ${osloDate(sql`received_at`)} as received
      from orders where organization_id = ${organizationId} and external_ref = 'TD-0001'`);
    expect(row.created).toBe(ANCHOR);
    expect(row.received).toBe(day(TESTDATA_ORDERS[0]!.createdDay));
  }, 120_000);
});

// ---------------------------------------------------------------------------------------------
// 4.3 Avbrutt kjøring og myk sletting
// ---------------------------------------------------------------------------------------------

describe("4.3 avbrutt kjøring og myk sletting", () => {
  let cleanCounts: Record<string, number> | null = null;

  beforeEach(async () => {
    await resetDatabase();
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runSeed(SEED_ENV);
  });

  async function cleanRunCounts(): Promise<Record<string, number>> {
    if (cleanCounts) return cleanCounts;
    await seedTestdata();
    cleanCounts = await countRows();
    await resetDatabase();
    await runSeed(SEED_ENV);
    return cleanCounts;
  }

  it("4.3.1 bare ansatte finnes: neste kjøring gir samme radtall som en ren kjøring", async () => {
    const expected = await cleanRunCounts();
    interrupt.beforeFirms = true;
    await expect(seedTestdata()).rejects.toThrow(/avbrutt i testen/);
    interrupt.beforeFirms = false;
    const organizationId = await byggconId();
    const partial = await one<{ employees: number; orders: number; firms: number }>(sql`
      select
        (select count(*)::int from employees e join users u on u.id = e.user_id
          where u.email like ${TD_EMAIL} and e.organization_id = ${organizationId}) as employees,
        (select count(*)::int from orders where external_ref like 'TD-%') as orders,
        (select count(*)::int from firms) as firms`);
    expect(partial).toEqual({ employees: TESTDATA_EMPLOYEES.length, orders: 0, firms: 0 });

    await seedTestdata();
    expect(await countRows()).toEqual(expected);
    const duplicates = await rows(sql`
      select email from users group by email having count(*) > 1`);
    expect(duplicates).toEqual([]);
  }, 180_000);

  it("4.3.2 avbrutt midt i ordrene: resten fylles ut, hver nøkkel én gang, ankeret uendret", async () => {
    const expected = await cleanRunCounts();
    interrupt.afterOrders = 10;
    await expect(seedTestdata()).rejects.toThrow(/avbrutt i testen/);
    resetInterrupt();
    const organizationId = await byggconId();
    const partial = await rows<{ ref: string }>(sql`
      select external_ref as ref from orders where organization_id = ${organizationId}
        and external_ref like 'TD-%' order by external_ref`);
    expect(partial.map((row) => row.ref)).toEqual(
      TESTDATA_ORDERS.slice(0, 10).map((order) => order.externalRef),
    );
    const anchorBefore = await one<{ created: string }>(sql`
      select created_at::text as created from orders
      where organization_id = ${organizationId} and external_ref = 'TD-0001'`);

    // Neste kjøring en annen dag: ankeret leses fra TD-0001, ikke fra klokka
    await seedTestdata(new Date(TEST_NOW.getTime() + 2 * 24 * 60 * 60 * 1000));
    const refs = await rows<{ ref: string; n: number }>(sql`
      select external_ref as ref, count(*)::int as n from orders
      where organization_id = ${organizationId} and external_ref like 'TD-%' group by external_ref`);
    expect(refs).toHaveLength(TESTDATA_ORDERS.length);
    for (const row of refs) expect(row.n, row.ref).toBe(1);
    const anchorAfter = await one<{ created: string }>(sql`
      select created_at::text as created from orders
      where organization_id = ${organizationId} and external_ref = 'TD-0001'`);
    expect(anchorAfter).toEqual(anchorBefore);
    expect(await countRows()).toEqual(expected);
    // Datoene på de nye ordrene regnes fra samme anker
    const last = TESTDATA_ORDERS.at(-1)!;
    const received = await one<{ received: string }>(sql`
      select ${osloDate(sql`received_at`)} as received from orders
      where organization_id = ${organizationId} and external_ref = ${last.externalRef}`);
    expect(received.received).toBe(day(last.createdDay));
  }, 180_000);

  it("4.3.3 mykt slettet ordre gjenopplives ikke og får ingen ny TD-0005", async () => {
    const organizationId = await byggconId();
    await seedTestdata();
    const deletedAt = "2026-11-02T08:00:00.000Z";
    await db.execute(sql`
      update orders set deleted_at = ${deletedAt} where organization_id = ${organizationId} and external_ref = 'TD-0005'`);
    const counts = await countRows();
    await seedTestdata();
    const found = await rows<{ deleted_at: Date | null }>(sql`
      select deleted_at from orders where organization_id = ${organizationId} and external_ref = 'TD-0005'`);
    expect(found).toHaveLength(1);
    expect(new Date(found[0]!.deleted_at!).toISOString()).toBe(deletedAt);
    expect(await countRows()).toEqual(counts);
  }, 120_000);

  it("4.3.3 mykt slettet oppdragsordre gjenopplives ikke og får ingen kopi", async () => {
    const organizationId = await byggconId();
    await seedTestdata();
    const ref = ASSIGNMENT_ORDERS[0]!.externalRef;
    const deletedAt = "2026-11-02T08:00:00.000Z";
    await db.execute(sql`
      update orders set deleted_at = ${deletedAt} where organization_id = ${organizationId} and external_ref = ${ref}`);
    await db.execute(sql`
      update assignments set deleted_at = ${deletedAt} where organization_id = ${organizationId}
        and id = (select assignment_id from orders where organization_id = ${organizationId} and external_ref = ${ref})`);
    const counts = await countRows();
    await seedTestdata();
    expect(await countRows()).toEqual(counts);
    const found = await rows<{ deleted_at: Date | null }>(sql`
      select deleted_at from orders where organization_id = ${organizationId} and external_ref = ${ref}`);
    expect(found).toHaveLength(1);
    expect(found[0]!.deleted_at).not.toBeNull();
  }, 120_000);

  it("4.3.4 mykt slettet kontakt og ansatt gjenopplives ikke og får ingen kopi", async () => {
    const organizationId = await byggconId();
    await seedTestdata();
    const brokerEmail = TESTDATA_FIRMS[0]!.brokers[0]!.email.toLowerCase();
    const employeeEmail = EMPLOYEE_BY_KEY.get("emp08")!.email.toLowerCase();
    const deletedAt = "2026-11-02T08:00:00.000Z";
    await db.execute(sql`
      update contacts set deleted_at = ${deletedAt} where organization_id = ${organizationId} and lower(email) = ${brokerEmail}`);
    await db.execute(sql`
      update employees set deleted_at = ${deletedAt} where organization_id = ${organizationId}
        and user_id = (select id from users where email = ${employeeEmail})`);
    const counts = await countRows();
    await seedTestdata();
    expect(await countRows()).toEqual(counts);
    const contactsFound = await rows<{ deleted_at: Date | null }>(sql`
      select deleted_at from contacts where organization_id = ${organizationId} and lower(email) = ${brokerEmail}`);
    expect(contactsFound).toHaveLength(1);
    expect(contactsFound[0]!.deleted_at).not.toBeNull();
    const employeesFound = await rows<{ deleted_at: Date | null }>(sql`
      select e.deleted_at from employees e join users u on u.id = e.user_id
      where e.organization_id = ${organizationId} and u.email = ${employeeEmail}`);
    expect(employeesFound).toHaveLength(1);
    expect(employeesFound[0]!.deleted_at).not.toBeNull();
  }, 120_000);

  it("4.3.5 skriptet setter aldri deleted_at", async () => {
    const organizationId = await byggconId();
    await seedTestdata();
    await seedTestdata();
    for (const table of COUNTED_TABLES) {
      if (TABLES_WITHOUT_ORG.has(table) || table === "number_sequences" || table === "ai_usage_log")
        continue;
      const hasColumn = await rows(sql`
        select 1 from information_schema.columns where table_name = ${table} and column_name = 'deleted_at'`);
      if (hasColumn.length === 0) continue;
      const row = await one<{ n: number }>(sql`
        select count(*)::int as n from ${sql.identifier(table)}
        where organization_id = ${organizationId} and deleted_at is not null`);
      expect(row.n, table).toBe(0);
    }
  }, 120_000);

  it("4.3.5 kildeteksten sletter ingenting", () => {
    for (const file of [
      "testdata.ts",
      "testdata.data.ts",
      "testdata-guard.ts",
      "testdata-index.ts",
    ]) {
      const text = readFileSync(join(process.cwd(), "src/db/seed", file), "utf8");
      expect(text, file).not.toMatch(/\bdb\.delete\b/);
      expect(text, file).not.toMatch(/\btx\.delete\b/);
      expect(text, file).not.toMatch(/DELETE\s+FROM/i);
      // `deletedAt: tabell.deletedAt` (lesing) og `deletedAt: null` er lov; å sette en verdi er det ikke
      expect(text, file).not.toMatch(
        /deletedAt\s*:\s*(?!\s|(?:\w+\.deletedAt|null|Date\s*\|\s*null)\b)/,
      );
      expect(text, file).not.toMatch(/set\s+deleted_at/i);
      expect(text, file).not.toMatch(/\btruncate\b/i);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 4.4 Determinisme
// ---------------------------------------------------------------------------------------------

describe("4.4 determinisme", () => {
  it("to tomme databaser gir like nøkler og feltverdier", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await resetDatabase();
    await runSeed(SEED_ENV);
    await seedTestdata();
    const first = await snapshot(await byggconId());
    await resetDatabase();
    await runSeed(SEED_ENV);
    await seedTestdata();
    const second = await snapshot(await byggconId());
    for (const [table, list] of Object.entries(first)) {
      expect(list.length, table).toBeGreaterThan(0);
    }
    expect(second).toEqual(first);
  }, 180_000);
});

// ---------------------------------------------------------------------------------------------
// 4.5 Vakten mot databasen
// ---------------------------------------------------------------------------------------------

describe("4.5 vakten mot databasen", () => {
  beforeAll(async () => {
    await resetDatabase();
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runSeed(SEED_ENV);
    vi.restoreAllMocks();
  });

  const LOCAL = "postgres://ezprop:ezprop@localhost:5432/ezprop";
  const CASES: [string, Record<string, string | undefined>][] = [
    ["production", { APP_ENVIRONMENT: "production", DATABASE_URL: LOCAL }],
    ["Production", { APP_ENVIRONMENT: "Production", DATABASE_URL: LOCAL }],
    ["mangler", { APP_ENVIRONMENT: undefined, DATABASE_URL: LOCAL }],
    ["tom", { APP_ENVIRONMENT: "", DATABASE_URL: LOCAL }],
    ["' test '", { APP_ENVIRONMENT: " test ", DATABASE_URL: LOCAL }],
    ["staging", { APP_ENVIRONMENT: "staging", DATABASE_URL: LOCAL }],
    [
      "test med prodvert",
      {
        APP_ENVIRONMENT: "test",
        DATABASE_URL: "postgres://u:p@psql-ezprop-prod.postgres.database.azure.com:5432/ezprop",
      },
    ],
    [
      "test med testprod-vert",
      {
        APP_ENVIRONMENT: "test",
        DATABASE_URL: "postgres://u:p@psql-ezprop-testprod.postgres.database.azure.com:5432/ezprop",
      },
    ],
    ["test uten DATABASE_URL", { APP_ENVIRONMENT: "test", DATABASE_URL: undefined }],
    [
      "test med ukjent vert",
      { APP_ENVIRONMENT: "test", DATABASE_URL: "postgres://u:p@10.0.0.5:5432/ezprop" },
    ],
  ];

  it.each(CASES)("4.5.1 og 4.5.2 stopper før skriving (%s)", async (_label, overrides) => {
    const before = await countRows();
    const transaction = vi.spyOn(db, "transaction");
    const insert = vi.spyOn(db, "insert");
    const select = vi.spyOn(db, "select");
    const execute = vi.spyOn(db, "execute");
    await expect(runTestdataSeed({ ...SEED_ENV, ...overrides }, TEST_NOW)).rejects.toBeInstanceOf(
      TestdataGuardError,
    );
    expect(transaction).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect(await countRows()).toEqual(before);
  });

  describe("4.5.3 inngangen (barneprosess)", () => {
    function runEntry(env: Record<string, string>) {
      const cleanEnv: Record<string, string> = {};
      for (const key of ["PATH", "HOME", "NODE_OPTIONS", "TMPDIR"]) {
        const value = process.env[key];
        if (value !== undefined) cleanEnv[key] = value;
      }
      return spawnSync(
        join(process.cwd(), "node_modules/.bin/tsx"),
        ["src/db/seed/testdata-index.ts"],
        {
          cwd: process.cwd(),
          env: { ...cleanEnv, ...env } as NodeJS.ProcessEnv,
          encoding: "utf8",
          timeout: 60_000,
        },
      );
    }

    const SECRET =
      "postgres://hemmeligbruker:hemmeligpassord@psql-ezprop-prod.postgres.database.azure.com:5432/ezprop";

    it.each([
      ["APP_ENVIRONMENT=production", { APP_ENVIRONMENT: "production", DATABASE_URL: SECRET }],
      ["APP_ENVIRONMENT=test med prodvert", { APP_ENVIRONMENT: "test", DATABASE_URL: SECRET }],
    ])(
      "%s avslutter med kode ≠ 0 og norsk melding uten adressen",
      (_label, env) => {
        const result = runEntry({ ...env, SEED_ADMIN_EMAIL: SEED_ENV.SEED_ADMIN_EMAIL });
        expect(result.status).not.toBe(0);
        expect(result.status).not.toBeNull();
        expect(result.stderr).toMatch(/APP_ENVIRONMENT|database/i);
        expect(result.stderr).toMatch(/\b(bare|ikke|stoppet|ingenting)\b/i);
        const output = `${result.stdout}\n${result.stderr}`;
        for (const secret of ["hemmeligbruker", "hemmeligpassord", "psql-ezprop-prod", SECRET]) {
          expect(output).not.toContain(secret);
        }
      },
      60_000,
    );
  });
});

// ---------------------------------------------------------------------------------------------
// 4.6 Tenant-isolasjon
// ---------------------------------------------------------------------------------------------

describe("4.6 tenant-isolasjon", () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  const TD_EMPLOYEE_EMAIL = TESTDATA_EMPLOYEES[0]!.email.toLowerCase();
  const TD_BROKER_EMAIL = TESTDATA_FIRMS[0]!.brokers[0]!.email.toLowerCase();
  const TD_FIRM_NAME = TESTDATA_FIRMS[0]!.name;
  const TD_PROPERTY = TESTDATA_PROPERTIES[0]!;

  it("4.6.1 findTestdataOrders gir bare egne TD-ordre", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createOrder(grantA.organizationId, { externalRef: "TD-0001" });
        const b = await createOrder(grantB.organizationId, { externalRef: "TD-0001" });
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) =>
        findTestdataOrders(await requireOrganizationAccess(actor, organizationId)),
      idOf: (row) => row.id,
    });
  });

  it("4.6.1 findTestdataEmployees gir bare egne TD-ansatte (samme e-post i begge)", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const user = await createUser({ name: "Oppdiktet Testvik", email: TD_EMPLOYEE_EMAIL });
        const a = await createEmployee(user, grantA.organizationId, ["inspector"]);
        const b = await createEmployee(user, grantB.organizationId, ["inspector"]);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) =>
        findTestdataEmployees(await requireOrganizationAccess(actor, organizationId)),
      idOf: (row) => row.id,
    });
  });

  it("4.6.1 findTestdataFirms gir bare egne firma (samme navn i begge)", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createFirm(grantA.organizationId, { name: TD_FIRM_NAME, orgNumber: null });
        const b = await createFirm(grantB.organizationId, { name: TD_FIRM_NAME, orgNumber: null });
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) =>
        findTestdataFirms(await requireOrganizationAccess(actor, organizationId)),
      idOf: (row) => row.id,
    });
  });

  it("4.6.1 findTestdataContacts gir bare egne kontakter (samme e-post i begge)", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createContact(grantA.organizationId, { email: TD_BROKER_EMAIL });
        const b = await createContact(grantB.organizationId, { email: TD_BROKER_EMAIL });
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) =>
        findTestdataContacts(await requireOrganizationAccess(actor, organizationId)),
      idOf: (row) => row.id,
    });
  });

  it("4.6.1 findTestdataProperties gir bare egne eiendommer (samme kommune/gnr/bnr i begge)", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const values = {
          municipalityNumber: TD_PROPERTY.municipalityNumber,
          gnr: TD_PROPERTY.gnr,
          bnr: TD_PROPERTY.bnr,
        };
        const a = await createProperty(grantA.organizationId, values);
        const b = await createProperty(grantB.organizationId, values);
        return { a: [a.property.id], b: [b.property.id] };
      },
      query: async (actor, organizationId) =>
        findTestdataProperties(await requireOrganizationAccess(actor, organizationId)),
      idOf: (row) => row.id,
    });
  });

  it("4.6.1 findTestdataAssignmentParts gir bare deler fra egen organisasjon", async () => {
    const all: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids: { a: string[]; b: string[] } = { a: [], b: [] };
        for (const [side, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const assignment = await createAssignment(grant.organizationId);
          const user = await createUser({ name: `Takstmann ${side}` });
          const employee = await createEmployee(user, grant.organizationId, ["inspector"]);
          await createTeamMember(grant.organizationId, {
            assignmentId: assignment.id,
            employeeId: employee.id,
            teamRole: "responsible",
          });
          ids[side].push(assignment.id);
          all.push(assignment.id);
        }
        return ids;
      },
      query: async (actor, organizationId) => {
        const parts = await findTestdataAssignmentParts(
          await requireOrganizationAccess(actor, organizationId),
          all,
        );
        return [...parts.teamRoles.keys()].map((id) => ({ id }));
      },
      idOf: (row) => row.id,
    });
  });

  it("4.6.2 og 4.6.3 en annen organisasjon med like nøkler røres ikke og styrer ikke ankeret", async () => {
    await runSeed(SEED_ENV);
    const other = await createOrganization("Annen takst (oppdiktet)");
    const old = new Date("2026-06-01T08:00:00Z");
    // Eldre TD-0001 i en annen organisasjon
    const otherOrder = await createOrder(other.id, {
      externalRef: "TD-0001",
      receivedAt: old,
      createdAt: old,
    } as Parameters<typeof createOrder>[1]);
    const otherContact = await createContact(other.id, { email: TD_BROKER_EMAIL });
    const otherUser = await createUser({ name: "Oppdiktet annen", email: TD_EMPLOYEE_EMAIL });
    const otherEmployee = await createEmployee(otherUser, other.id, ["office"]);
    const otherFirm = await createFirm(other.id, { name: TD_FIRM_NAME, orgNumber: null });
    const read = async () =>
      rows(sql`
        select 'order' as kind, id::text, updated_at::text, status, null as extra from orders where id = ${otherOrder.id}
        union all select 'contact', id::text, updated_at::text, null, email from contacts where id = ${otherContact.id}
        union all select 'employee', id::text, updated_at::text, null, name from employees where id = ${otherEmployee.id}
        union all select 'firm', id::text, updated_at::text, null, name from firms where id = ${otherFirm.id}
        union all select 'events', ${other.id}::text, count(*)::text, null, null from events where organization_id = ${other.id}
        union all select 'roles', ${otherEmployee.id}::text, count(*)::text, null, null from employee_roles where employee_id = ${otherEmployee.id}`);
    const before = await read();
    const otherCountsBefore = await countRows(other.id);

    await seedTestdata();

    expect(await read()).toEqual(before);
    expect(await countRows(other.id)).toEqual(otherCountsBefore);
    const organizationId = await byggconId();
    const td = await one<{ n: number }>(sql`
      select count(*)::int as n from orders where organization_id = ${organizationId} and external_ref like 'TD-%'`);
    expect(td.n).toBe(TESTDATA_ORDERS.length);
    const anchor = await one<{ received: string }>(sql`
      select ${osloDate(sql`received_at`)} as received from orders
      where organization_id = ${organizationId} and external_ref = 'TD-0001'`);
    expect(anchor.received).toBe(day(TESTDATA_ORDERS[0]!.createdDay));
    // Den oppdiktede ansatte med samme e-post finnes i Byggcon som egen ansatt-rad
    const byggconEmployee = await rows(sql`
      select e.id from employees e join users u on u.id = e.user_id
      where u.email = ${TD_EMPLOYEE_EMAIL} and e.organization_id = ${organizationId}`);
    expect(byggconEmployee).toHaveLength(1);
  }, 120_000);

  it("4.6.6 ingen ny tabell: tenant-tables er uendret i denne oppgaven", () => {
    const text = readFileSync(join(process.cwd(), "tests/tenant-tables.ts"), "utf8");
    expect(text).not.toMatch(/testdata/i);
  });
});

// ---------------------------------------------------------------------------------------------
// 4.7.1 Ekte arbeid røres ikke
// ---------------------------------------------------------------------------------------------

describe("4.7.1 ekte arbeid røres ikke", () => {
  it("en ordre, en kontakt og en ansatt uten TD er uendret, og ingen TD-rad peker på dem", async () => {
    await resetDatabase();
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runSeed(SEED_ENV);
    const organizationId = await byggconId();
    const order = await createOrder(organizationId, {
      externalRef: "MEGLER-77",
      addressText: "Oppdiktet vei 3, 8006 Bodø",
    });
    const contact = await createContact(organizationId, {
      firstName: "Ekte",
      lastName: "Kontakt",
      email: "kontakt@eksempel.invalid",
    });
    const user = await createUser({
      name: "Ekte Takstmann",
      email: "ekte.takstmann@eksempel.invalid",
    });
    const employee = await createEmployee(user, organizationId, ["inspector"]);
    const snapshotReal = async () => ({
      order: await rows(sql`select * from orders where id = ${order.id}`),
      contact: await rows(sql`select * from contacts where id = ${contact.id}`),
      employee: await rows(sql`select * from employees where id = ${employee.id}`),
      roles: await rows(
        sql`select role::text, deleted_at from employee_roles where employee_id = ${employee.id}`,
      ),
      user: await rows(sql`select * from users where id = ${user.id}`),
    });
    const before = await snapshotReal();

    await seedTestdata();

    expect(await snapshotReal()).toEqual(before);
    const references = await one<Row>(sql`
      select
        (select count(*)::int from assignment_team_members where employee_id = ${employee.id}) as team,
        (select count(*)::int from work_sessions where employee_id = ${employee.id}) as sessions,
        (select count(*)::int from certifications where employee_id = ${employee.id}) as certifications,
        (select count(*)::int from events where actor_id = ${employee.id}) as events,
        (select count(*)::int from audit_log where actor_employee_id = ${employee.id}) as audit,
        (select count(*)::int from assignment_parties where contact_id = ${contact.id}) as parties,
        (select count(*)::int from orders where ordered_by_contact_id = ${contact.id}) as ordered_by,
        (select count(*)::int from claims where created_by = ${employee.id}) as claims,
        (select count(*)::int from events where data ->> 'orderId' = ${order.id}) as order_events`);
    expect(references).toEqual({
      team: 0,
      sessions: 0,
      certifications: 0,
      events: 0,
      audit: 0,
      parties: 0,
      ordered_by: 0,
      claims: 0,
      order_events: 0,
    });
  }, 120_000);
});

// ---------------------------------------------------------------------------------------------
// 4.10 Logging
// ---------------------------------------------------------------------------------------------

describe("4.10 logging", () => {
  /** Navn, gatenavn, telefonnummer, e-post, firmanavn og fritekst fra datafilen. */
  const SENSITIVE = [
    ...new Set(
      [
        ...TESTDATA_EMPLOYEES.flatMap((employee) => [
          employee.name,
          employee.email,
          employee.phone,
        ]),
        ...TESTDATA_FIRMS.flatMap((firm) => [
          firm.name,
          ...firm.brokers.flatMap((broker) => [broker.name, broker.email, broker.phone]),
        ]),
        ...TESTDATA_STREETS,
        ...TESTDATA_PROPERTIES.flatMap((property) => [
          property.street,
          property.cooperativeName ?? "",
        ]),
        ...TESTDATA_ORDERS.flatMap((order: TestdataOrder) => [
          order.address ?? "",
          order.note ?? "",
          order.orderedByText ?? "",
          order.claim?.description ?? "",
          ...order.parties.flatMap((party) => [party.name, party.email ?? "", party.phone ?? ""]),
        ]),
      ].filter((value) => value.length >= 4),
    ),
  ];

  it("4.10.1 to kjøringer og en vaktstopp logger bare antall og TD-nøkler", async () => {
    await resetDatabase();
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runSeed(SEED_ENV);
    vi.restoreAllMocks();
    const lines = captureOutput();
    await seedTestdata();
    await seedTestdata();
    await expect(
      runTestdataSeed(
        { ...SEED_ENV, APP_ENVIRONMENT: "production", DATABASE_URL: process.env.DATABASE_URL },
        TEST_NOW,
      ),
    ).rejects.toBeInstanceOf(TestdataGuardError);
    vi.restoreAllMocks();
    const output = lines.join("\n");
    expect(output.length).toBeGreaterThan(0);
    expect(output).not.toContain("@");
    expect(SENSITIVE.length).toBeGreaterThan(100);
    for (const value of SENSITIVE) expect(output, value).not.toContain(value);
    // Bare TD-nøkler som nøkler: ingen andre ord med store forbokstaver fra datafilen
    expect(output).toMatch(/TD-\d{4}/);
  }, 180_000);
});

afterAll(async () => {
  vi.restoreAllMocks();
});
