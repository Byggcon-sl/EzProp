import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AccessDeniedError,
  permissions as PERMISSIONS,
  requireOrganizationAccess,
  type Actor,
} from "@/core/access";
import { countWorkQueueByStatus, listWorkQueue } from "@/core/assignments";
import { getClaim, listClaimsForAssignment, updateClaim } from "@/core/claims";
import { listOrders } from "@/core/orders";
import { db } from "@/db/client";
import { resetEnvCache } from "@/shared/config/env";
import { brand } from "@/shared/config/brand";
import {
  TEST_NOW,
  activeAdminCount,
  createContact,
  createEmployee,
  createFirm,
  createIntegrationConnection,
  createOrder,
  createOrganization,
  createProperty,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { runSeed } from "./run";
import { runSampleSeed } from "./sample-assignments";
import * as testdataModule from "./testdata";
import { seedTestdata } from "./testdata";
import { TESTDATA_EMAIL_DOMAIN, TESTDATA_LAST_NAMES, TESTDATA_SEED } from "./testdata.data";
import { buildTestdataPlan } from "./testdata-plan";
import type { TestdataAssignment, TestdataOrder, TestdataPlan } from "./testdata.types";

/*
 * Seed-steget for testdataene mot testdatabasen (`pnpm db:seed:testdata`). Testplan:
 * docs/funksjoner/fase2a-testdata-arbeidshverdag-testplan.md avsnitt 4 (4.1–4.8 og 4.10).
 * Vasken (4.9) står i `testdata-redaction.test.ts`, inngangen og loggen (5) i
 * `testdata-index.test.ts`.
 *
 * Alle data er oppdiktet. Admin fra seed er `admin@example.com` (som i run.test.ts). Steget får
 * fast tid (`TEST_NOW`) og det faste frøet. Feil midt i en kjøring lages med en midlertidig
 * trigger i databasen, slik at testen ikke binder seg til hvordan skriptet er delt opp.
 *
 * Støtter hovedmål: de ansatte (testmiljøet har alltid en full, lik arbeidsdag, og skriptet rører
 * aldri ekte arbeid, admin eller innstillinger), KI i bunnen (ingen KI-kall, ingen rader i
 * `ai_usage_log`) og færre reklamasjoner (listene er raske med mengde som ligner drift, og
 * reklamasjonene er bare synlige for leder og admin).
 */

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

const env = { SEED_ADMIN_EMAIL: "admin@example.com", SEED_ADMIN_NAME: "Test Admin" };
const DAY = 86_400_000;
const plan: TestdataPlan = buildTestdataPlan({ seed: TESTDATA_SEED, anchor: TEST_NOW });
const planAssignments = plan.orders.flatMap((order) =>
  order.converted ? [{ order, assignment: order.converted.assignment }] : [],
);
const planByRef = new Map(plan.orders.map((order) => [order.externalRef, order]));

/** Tabellene skriptet fyller (kortet, «Data»), og de testplanen ber om i tillegg. */
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
  "sessions",
  "accounts",
  "ai_usage_log",
  "organizations",
  "integration_connections",
] as const;

/** Tabellene med `organization_id`, `updated_at` og `deleted_at` som skriptet kan røre. */
const TIMESTAMPED_ORG_TABLES = [
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
  "companies",
  "offices",
] as const;

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(query)) as unknown as T[];
}

async function count(query: ReturnType<typeof sql>): Promise<number> {
  const [row] = await rows<{ n: number }>(query);
  return row?.n ?? -1;
}

/** Antall rader per tabell i hele databasen, og verdiene i nummerserien. */
async function countRows(): Promise<Record<string, number | string[]>> {
  const out: Record<string, number | string[]> = {};
  for (const table of COUNTED_TABLES) {
    out[table] = await count(sql`select count(*)::int as n from ${sql.identifier(table)}`);
  }
  out.number_sequence_values = await sequenceValues();
  return out;
}

async function sequenceValues(): Promise<string[]> {
  const found = await rows<{ organization_id: string; prefix: string; next_value: number }>(
    sql`select organization_id::text, prefix, next_value from number_sequences order by organization_id, prefix`,
  );
  return found.map((row) => `${row.organization_id}:${row.prefix}:${row.next_value}`);
}

/** `id:updated_at:deleted_at` for alle rader i tabellene over (alle organisasjoner). */
async function updatedAtSnapshot(): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const table of TIMESTAMPED_ORG_TABLES) {
    const found = await rows<{ line: string }>(
      sql`select id::text || ':' || updated_at::text || ':' || coalesce(deleted_at::text, '-') as line from ${sql.identifier(table)} order by id`,
    );
    out[table] = found.map((row) => row.line);
  }
  const orgs = await rows<{ line: string }>(
    sql`select id::text || ':' || updated_at::text || ':' || settings::text as line from organizations order by id`,
  );
  out.organizations = orgs.map((row) => row.line);
  return out;
}

/** Antall rader med `deleted_at` satt, per tabell. */
async function deletedCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of TIMESTAMPED_ORG_TABLES) {
    out[table] = await count(
      sql`select count(*)::int as n from ${sql.identifier(table)} where deleted_at is not null`,
    );
  }
  return out;
}

async function organizationsNamed(name: string) {
  return rows<{ id: string; settings: Record<string, unknown> }>(
    sql`select id, settings from organizations where name = ${name} order by created_at`,
  );
}

async function byggconId(): Promise<string> {
  const found = await organizationsNamed(brand.companyName);
  expect(found, "nøyaktig én Byggcon").toHaveLength(1);
  return found[0]!.id;
}

async function actorByEmail(email: string): Promise<Actor> {
  const [user] = await rows<Actor>(
    sql`select id, name, email from users where email = ${email.toLowerCase()}`,
  );
  if (!user) throw new Error(`Fant ikke brukeren (${email.split("@")[1]})`);
  return user;
}

const adminActor = () => actorByEmail(env.SEED_ADMIN_EMAIL);

async function employeeIdOf(actor: Actor, organizationId: string): Promise<string> {
  const [row] = await rows<{ id: string }>(
    sql`select id from employees where user_id = ${actor.id} and organization_id = ${organizationId}`,
  );
  if (!row) throw new Error("Fant ikke den ansatte i organisasjonen");
  return row.id;
}

/** Første oppdiktede ansatte i planen med rollen (og bare den rollen, om mulig). */
function planEmployeeWithRole(role: "inspector" | "office" | "manager") {
  const only = plan.employees.find((e) => e.roles.length === 1 && e.roles[0] === role);
  const any = plan.employees.find((e) => (e.roles as readonly string[]).includes(role));
  const found = only ?? any;
  if (!found) throw new Error(`Planen har ingen ansatt med rollen ${role}`);
  return found;
}

/** Kjører seed-steget med fast frø. */
function seed(now: Date = TEST_NOW) {
  return seedTestdata({ db, now, seed: TESTDATA_SEED });
}

/** Seed (Byggcon og admin) og testdataene, som i testmiljøet. */
async function seedAll(now: Date = TEST_NOW) {
  await runSeed(env);
  await seed(now);
  return byggconId();
}

/** Feilen fra et kall, eller en testfeil hvis kallet ikke kastet. */
async function errorFrom(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }
  throw new Error("kallet kastet ikke");
}

type TdOrderRow = {
  external_ref: string;
  order_id: string;
  received_at: Date;
  created_at: Date;
  updated_at: string;
  row_version: number;
  order_status: string;
  address_text: string;
  ordered_by_text: string | null;
  gnr: string | null;
  bnr: string | null;
  snr: string | null;
  assignment_id: string | null;
  status: string | null;
  inspection_at: Date | null;
  due_date: string | null;
  internal_note: string | null;
  office_name: string | null;
};

/** Ordre (og oppdrag) med `TD-` i organisasjonen. */
async function tdOrders(organizationId: string): Promise<Map<string, TdOrderRow>> {
  const found = await rows<TdOrderRow>(sql`
    select o.external_ref, o.id as order_id, o.received_at, o.created_at, o.updated_at::text as updated_at,
      o.row_version, o.status as order_status, o.address_text, o.ordered_by_text, o.gnr, o.bnr, o.snr,
      a.id as assignment_id, a.status, a.inspection_at, a.due_date::text as due_date, a.internal_note,
      off.name as office_name
    from orders o
    left join assignments a on a.id = o.assignment_id and a.organization_id = o.organization_id
    left join offices off on off.id = a.office_id and off.organization_id = o.organization_id
    where o.organization_id = ${organizationId} and o.external_ref like 'TD-%'
    order by o.external_ref`);
  return new Map(found.map((row) => [row.external_ref, row]));
}

/** Oppslagene i skriptet som tar `organizationId` (kontrakten i testplanen). */
const td = testdataModule as unknown as Record<string, unknown>;
async function lookup(name: string, organizationId: string): Promise<{ id: string }[]> {
  const fn = td[name];
  if (typeof fn !== "function") throw new Error(`testdata.ts eksporterer ikke ${name}`);
  const call = fn as (...args: unknown[]) => Promise<unknown>;
  const result = call.length >= 2 ? await call(db, organizationId) : await call(organizationId);
  if (result === null || result === undefined) return [];
  return (Array.isArray(result) ? result : [result]) as { id: string }[];
}

/** Lager en trigger som stopper innsetting i tabellen når betingelsen holder. */
async function failInsertWhen(table: string, condition: string) {
  await db.execute(
    sql.raw(`create or replace function testdata_test_fail() returns trigger language plpgsql as $$
      begin
        if ${condition} then
          raise exception 'påtvunget feil i testen' using errcode = '23514';
        end if;
        return new;
      end $$`),
  );
  await db.execute(
    sql.raw(`create trigger testdata_test_fail before insert on ${table}
      for each row execute function testdata_test_fail()`),
  );
  return async () => {
    await db.execute(sql.raw(`drop trigger if exists testdata_test_fail on ${table}`));
    await db.execute(sql.raw(`drop function if exists testdata_test_fail()`));
  };
}

const savedEnv = { app: process.env.APP_ENVIRONMENT, url: process.env.DATABASE_URL };

beforeEach(async () => {
  await resetDatabase();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  process.env.APP_ENVIRONMENT = savedEnv.app;
  process.env.DATABASE_URL = savedEnv.url;
  resetEnvCache();
});

describe("testdata: første kjøring (4.1)", () => {
  it("4.1.1 alt ligger i Byggcon, med antallene fra planen", async () => {
    const orgId = await seedAll();
    const orders = await tdOrders(orgId);
    expect([...orders.keys()].sort()).toEqual(plan.orders.map((o) => o.externalRef).sort());
    expect([...orders.values()].filter((o) => o.assignment_id !== null)).toHaveLength(
      planAssignments.length,
    );
    const employees = await count(sql`
      select count(*)::int as n from employees e join users u on u.id = e.user_id
      where e.organization_id = ${orgId} and u.email like ${`%@${TESTDATA_EMAIL_DOMAIN}`}`);
    expect(employees).toBe(plan.employees.length);
    expect(
      await count(sql`select count(*)::int as n from firms where organization_id = ${orgId}`),
    ).toBe(plan.firms.length);
    expect(
      await count(
        sql`select count(*)::int as n from contacts where organization_id = ${orgId} and email like ${`%@${TESTDATA_EMAIL_DOMAIN}`}`,
      ),
    ).toBe(plan.contacts.length);
    const propertyKeys = new Set(planAssignments.map((p) => p.assignment.property.key));
    expect(
      await count(sql`select count(*)::int as n from properties where organization_id = ${orgId}`),
    ).toBe(propertyKeys.size);
    expect(
      await count(sql`select count(*)::int as n from claims where organization_id = ${orgId}`),
    ).toBe(planAssignments.filter((p) => p.assignment.claim).length);
    // Ingenting havner utenfor Byggcon
    expect(
      await count(sql`select count(*)::int as n from orders where organization_id <> ${orgId}`),
    ).toBe(0);
  });

  it("4.1.2 hvert oppdrag har ansvarlig, sidemann (annen person), kontor og parter", async () => {
    const orgId = await seedAll();
    const team = await rows<{ external_ref: string; team_role: string; email: string }>(sql`
      select o.external_ref, t.team_role, u.email
      from orders o
      join assignment_team_members t on t.assignment_id = o.assignment_id and t.organization_id = o.organization_id
      join employees e on e.id = t.employee_id
      join users u on u.id = e.user_id
      where o.organization_id = ${orgId} and o.external_ref like 'TD-%' and t.to_at is null and t.deleted_at is null`);
    const orders = await tdOrders(orgId);
    for (const { order, assignment } of planAssignments) {
      const lines = team.filter((t) => t.external_ref === order.externalRef);
      const responsible = lines.filter((t) => t.team_role === "responsible").map((t) => t.email);
      const second = lines.filter((t) => t.team_role === "peer_reviewer").map((t) => t.email);
      expect(responsible, order.externalRef).toEqual([assignment.responsibleKey.toLowerCase()]);
      expect(second, order.externalRef).toEqual([assignment.secondKey.toLowerCase()]);
      expect(responsible[0]).not.toBe(second[0]);
      expect(orders.get(order.externalRef)?.office_name).toBe(assignment.officeName);
      const parties = await count(sql`
        select count(*)::int as n from assignment_parties
        where organization_id = ${orgId} and assignment_id = ${orders.get(order.externalRef)!.assignment_id}`);
      expect(parties, order.externalRef).toBe(assignment.parties.length);
      expect(parties).toBeGreaterThan(0);
    }
  });

  it("4.1.3 befarte oppdrag har bygning, etasje, rom og floor_areas; de andre har ingen", async () => {
    const orgId = await seedAll();
    const orders = await tdOrders(orgId);
    for (const { order, assignment } of planAssignments) {
      const id = orders.get(order.externalRef)!.assignment_id!;
      const buildings = await count(
        sql`select count(*)::int as n from report_buildings where organization_id = ${orgId} and assignment_id = ${id}`,
      );
      const floors = await count(sql`
        select count(*)::int as n from floors f join report_buildings b on b.id = f.report_building_id
        where b.organization_id = ${orgId} and b.assignment_id = ${id}`);
      const rooms = await count(sql`
        select count(*)::int as n from rooms r join floors f on f.id = r.floor_id
        join report_buildings b on b.id = f.report_building_id
        where b.organization_id = ${orgId} and b.assignment_id = ${id}`);
      const areas = await count(sql`
        select count(*)::int as n from floor_areas a join floors f on f.id = a.floor_id
        join report_buildings b on b.id = f.report_building_id
        where b.organization_id = ${orgId} and b.assignment_id = ${id}`);
      if (assignment.buildings.length > 0) {
        expect(buildings, order.externalRef).toBe(assignment.buildings.length);
        expect(floors).toBeGreaterThan(0);
        expect(rooms).toBeGreaterThan(0);
        expect(areas).toBeGreaterThan(0);
      } else {
        expect(buildings + floors + rooms + areas, order.externalRef).toBe(0);
      }
    }
  });

  it("4.1.4 ferdige og fakturerte har work_sessions, bare på oppdiktede ansatte", async () => {
    const orgId = await seedAll();
    const sessions = await rows<{ external_ref: string; email: string; status: string }>(sql`
      select o.external_ref, u.email, a.status
      from work_sessions w
      join assignments a on a.id = w.assignment_id
      join orders o on o.assignment_id = a.id
      join employees e on e.id = w.employee_id
      join users u on u.id = e.user_id
      where w.organization_id = ${orgId}`);
    expect(sessions.length).toBeGreaterThan(0);
    for (const s of sessions) {
      expect(s.email.endsWith(`@${TESTDATA_EMAIL_DOMAIN}`)).toBe(true);
      expect(["completed", "invoiced"]).toContain(s.status);
    }
    for (const { order, assignment } of planAssignments) {
      const n = sessions.filter((s) => s.external_ref === order.externalRef).length;
      expect(n, order.externalRef).toBe(assignment.workSessions.length);
      if (assignment.status === "completed" || assignment.status === "invoiced") {
        expect(n, order.externalRef).toBeGreaterThan(0);
      }
    }
  });

  it("4.1.5 fakturert nås gjennom gyldige statusbytter i økende tid", async () => {
    const orgId = await seedAll();
    const orders = await tdOrders(orgId);
    const invoiced = planAssignments.filter((p) => p.assignment.status === "invoiced");
    expect(invoiced.length).toBeGreaterThan(0);
    for (const { order } of invoiced) {
      const id = orders.get(order.externalRef)!.assignment_id!;
      const changes = await rows<{ from: string; to: string; at: Date }>(sql`
        select data->>'from' as "from", data->>'to' as "to", occurred_at as at from events
        where organization_id = ${orgId} and assignment_id = ${id} and type = 'assignment.status_changed'
        order by occurred_at, received_at`);
      expect(
        changes.map((c) => `${c.from}>${c.to}`),
        order.externalRef,
      ).toEqual(["ordered>in_progress", "in_progress>completed", "completed>invoiced"]);
      const times = changes.map((c) => new Date(c.at).getTime());
      expect([...times].sort((a, b) => a - b)).toEqual(times);
      expect(new Set(times).size).toBe(times.length);
    }
  });

  it("4.1.6 laget gjennom tjenestene med oppdiktede aktører i riktig rolle; admin er aldri aktør", async () => {
    const orgId = await seedAll();
    const adminEmployee = await employeeIdOf(await adminActor(), orgId);
    const actors = await rows<{ type: string; email: string | null; roles: string[] }>(sql`
      select ev.type, u.email,
        array(select r.role::text from employee_roles r where r.employee_id = e.id and r.deleted_at is null) as roles
      from events ev
      left join employees e on e.id = ev.actor_id
      left join users u on u.id = e.user_id
      where ev.organization_id = ${orgId}`);
    const types = new Set(actors.map((a) => a.type));
    expect(types.has("order.received")).toBe(true);
    expect(types.has("assignment.created")).toBe(true);
    expect(types.has("assignment.status_changed")).toBe(true);
    expect(types.has("claim.registered")).toBe(true);
    for (const actor of actors) {
      expect(actor.email, actor.type).not.toBeNull();
      expect(actor.email!.endsWith(`@${TESTDATA_EMAIL_DOMAIN}`), actor.type).toBe(true);
    }
    const roleOf = (type: string) => actors.filter((a) => a.type === type).map((a) => a.roles);
    for (const roles of roleOf("order.received")) expect(roles).toContain("office");
    for (const roles of roleOf("assignment.created")) expect(roles).toContain("office");
    for (const roles of roleOf("assignment.status_changed")) expect(roles).toContain("inspector");
    for (const roles of roleOf("claim.registered")) expect(roles).toContain("manager");

    expect(
      await count(
        sql`select count(*)::int as n from events where organization_id = ${orgId} and actor_id = ${adminEmployee}`,
      ),
    ).toBe(0);
    expect(
      await count(
        sql`select count(*)::int as n from audit_log where organization_id = ${orgId} and actor_employee_id = ${adminEmployee}`,
      ),
    ).toBe(0);
  });

  it("4.1.6 statusbyttene gjøres av ansvarlig takstmann på oppdraget", async () => {
    const orgId = await seedAll();
    const mismatched = await count(sql`
      select count(*)::int as n from events ev
      join orders o on o.assignment_id = ev.assignment_id and o.organization_id = ev.organization_id
      where ev.organization_id = ${orgId} and ev.type = 'assignment.status_changed'
        and o.external_ref like 'TD-%'
        and not exists (
          select 1 from assignment_team_members t
          where t.assignment_id = ev.assignment_id and t.employee_id = ev.actor_id
            and t.team_role = 'responsible')`);
    expect(mismatched).toBe(0);
  });

  it("4.1.7 domenetidspunktene er flyttet bakover til planen", async () => {
    const orgId = await seedAll();
    const orders = await tdOrders(orgId);
    for (const order of plan.orders) {
      const row = orders.get(order.externalRef)!;
      expect(new Date(row.received_at).toISOString(), order.externalRef).toBe(
        order.receivedAt.toISOString(),
      );
      if (!order.converted) continue;
      const a = order.converted.assignment;
      expect(row.inspection_at === null ? null : new Date(row.inspection_at).toISOString()).toBe(
        a.inspectionAt?.toISOString() ?? null,
      );
      expect(row.due_date).toBe(a.dueDate);
      const changes = await rows<{ to: string; at: Date }>(sql`
        select data->>'to' as "to", occurred_at as at from events
        where organization_id = ${orgId} and assignment_id = ${row.assignment_id}
          and type = 'assignment.status_changed'
        order by occurred_at`);
      expect(
        changes.map((c) => `${c.to}@${new Date(c.at).toISOString()}`),
        order.externalRef,
      ).toEqual(a.statusTimes.map((s) => `${s.toStatus}@${s.at.toISOString()}`));
      if (a.claim) {
        const [claim] = await rows<{ received_at: string; closed_at: Date | null; at: Date }>(sql`
          select c.received_at::text as received_at, c.closed_at,
            (select occurred_at from events e where e.organization_id = c.organization_id
              and e.assignment_id = c.assignment_id and e.type = 'claim.registered' limit 1) as at
          from claims c where c.organization_id = ${orgId} and c.assignment_id = ${row.assignment_id}`);
        expect(claim!.received_at).toBe(a.claim.receivedAt);
        expect(claim!.closed_at === null ? null : new Date(claim!.closed_at).toISOString()).toBe(
          a.claim.closedAt?.toISOString() ?? null,
        );
        expect(new Date(claim!.at).toISOString()).toBe(a.claim.registeredAt.toISOString());
      }
    }
    // Ingen hendelse på et TD-oppdrag ligger i framtiden for en status som er nådd
    const future = await count(sql`
      select count(*)::int as n from events ev join orders o on o.assignment_id = ev.assignment_id
      where ev.organization_id = ${orgId} and o.external_ref like 'TD-%'
        and ev.type = 'assignment.status_changed' and ev.occurred_at > ${TEST_NOW}`);
    expect(future).toBe(0);
  });

  it("4.1.8 revisjonsloggen er urørt: TD-radene har kjøretidspunktet, ikke planlagt dato", async () => {
    await runSeed(env);
    const start = await rows<{ now: Date }>(sql`select clock_timestamp() as now`);
    await seed();
    const end = await rows<{ now: Date }>(sql`select clock_timestamp() as now`);
    const orgId = await byggconId();
    const outside = await count(sql`
      select count(*)::int as n from audit_log
      where organization_id = ${orgId}
        and (received_at < ${start[0]!.now} or received_at > ${end[0]!.now}
          or occurred_at < ${start[0]!.now} - interval '1 minute' or occurred_at > ${end[0]!.now})`);
    expect(
      await count(sql`select count(*)::int as n from audit_log where organization_id = ${orgId}`),
    ).toBeGreaterThan(0);
    expect(outside).toBe(0);
  });

  it("4.1.8 kildeteksten oppdaterer aldri audit_log", () => {
    const source = readFileSync(join(process.cwd(), "src/db/seed/testdata.ts"), "utf8");
    expect(source).not.toMatch(/update\s*\(\s*auditLog\s*\)/);
    expect(source).not.toMatch(/update\s+audit_log/i);
    expect(source).not.toMatch(/delete\s*\(\s*auditLog\s*\)|delete\s+from\s+audit_log/i);
  });

  it("4.1.9 sertifisering: ansvarlig med gyldig sertifisering får report.publish, den utløpte ikke", async () => {
    const orgId = await seedAll();
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(new Date());
    const certs = await rows<{ email: string; valid_to: string }>(sql`
      select u.email, c.valid_to::text as valid_to from certifications c
      join employees e on e.id = c.employee_id join users u on u.id = e.user_id
      where c.organization_id = ${orgId} and c.deleted_at is null`);
    const expired = certs.filter((c) => c.valid_to < today);
    const valid = certs.filter((c) => c.valid_to >= today);
    expect(expired).toHaveLength(1);
    expect(valid.length).toBeGreaterThan(0);
    const responsible = planAssignments.find(
      (p) => p.assignment.status === "completed" || p.assignment.status === "invoiced",
    )!.assignment.responsibleKey;
    expect(valid.map((c) => c.email)).toContain(responsible.toLowerCase());
    const grant = await requireOrganizationAccess(
      await actorByEmail(responsible),
      orgId,
      "report.publish",
    );
    expect(grant.organizationId).toBe(orgId);
    await expect(
      requireOrganizationAccess(await actorByEmail(expired[0]!.email), orgId, "report.publish"),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("4.1.10 radene stemmer med planen i nøkler og feltverdier (uten id og tidsstempler)", async () => {
    const orgId = await seedAll();
    const orders = await tdOrders(orgId);
    for (const order of plan.orders) {
      const row = orders.get(order.externalRef)!;
      expect(
        {
          addressText: row.address_text,
          orderedByText: row.ordered_by_text,
          gnr: row.gnr,
          bnr: row.bnr,
          snr: row.snr,
          converted: row.assignment_id !== null,
          status: row.status,
          internalNote: row.internal_note,
        },
        order.externalRef,
      ).toEqual({
        addressText: order.fields.addressText,
        orderedByText: order.fields.orderedByText,
        gnr: order.fields.gnr,
        bnr: order.fields.bnr,
        snr: order.fields.snr,
        converted: order.converted !== false,
        status: order.converted ? order.converted.assignment.status : null,
        internalNote: order.converted ? order.converted.assignment.internalNote : null,
      });
    }
    for (const { order, assignment } of planAssignments) {
      const id = orders.get(order.externalRef)!.assignment_id!;
      expect(await propertyOf(orgId, id), order.externalRef).toEqual(planProperty(assignment));
      expect(await partiesOf(orgId, id), order.externalRef).toEqual(planParties(assignment));
      expect(await buildingsOf(orgId, id), order.externalRef).toEqual(planBuildings(assignment));
    }
    const employees = await rows<{ email: string; name: string; roles: string[] }>(sql`
      select u.email, e.name,
        array(select r.role::text from employee_roles r where r.employee_id = e.id and r.deleted_at is null order by r.role) as roles
      from employees e join users u on u.id = e.user_id
      where e.organization_id = ${orgId} and u.email like ${`%@${TESTDATA_EMAIL_DOMAIN}`}
      order by u.email`);
    expect(employees).toEqual(
      [...plan.employees]
        .map((e) => ({
          email: e.email.toLowerCase(),
          name: e.name,
          roles: [...e.roles].sort(),
        }))
        .sort((a, b) => a.email.localeCompare(b.email)),
    );
  });

  it("4.1.11 ingen innlogging: ingen sessions eller accounts, og ingen oppdiktet admin", async () => {
    const orgId = await seedAll();
    const logins = await count(sql`
      select count(*)::int as n from users u
      where u.email like ${`%@${TESTDATA_EMAIL_DOMAIN}`}
        and (exists (select 1 from sessions s where s.user_id = u.id)
          or exists (select 1 from accounts a where a.user_id = u.id))`);
    expect(logins).toBe(0);
    const admins = await count(sql`
      select count(*)::int as n from employee_roles r join employees e on e.id = r.employee_id
      join users u on u.id = e.user_id
      where r.organization_id = ${orgId} and r.role = 'admin' and u.email like ${`%@${TESTDATA_EMAIL_DOMAIN}`}`);
    expect(admins).toBe(0);
  });

  it("4.1.12 ingen KI: ai_usage_log har samme antall rader før og etter", async () => {
    await runSeed(env);
    const before = await count(sql`select count(*)::int as n from ai_usage_log`);
    await seed();
    expect(await count(sql`select count(*)::int as n from ai_usage_log`)).toBe(before);
  });
});

async function propertyOf(orgId: string, assignmentId: string) {
  const [row] = await rows<Record<string, unknown>>(sql`
    select p.address, p.postal_code as "postalCode", p.city, p.municipality_number as "municipalityNumber",
      p.municipality_name as "municipalityName", p.housing_type as "housingType",
      p.ownership_form as "ownershipForm", c.gnr, c.bnr, c.fnr, c.snr,
      c.association_name as "associationName", c.share_number as "shareNumber"
    from assignments a
    join properties p on p.id = a.property_id and p.organization_id = a.organization_id
    left join cadastral_units c on c.property_id = p.id and c.deleted_at is null
    where a.organization_id = ${orgId} and a.id = ${assignmentId}`);
  return row ?? null;
}

function planProperty(a: TestdataAssignment) {
  const p = a.property;
  return {
    address: p.address,
    postalCode: p.postalCode,
    city: p.city,
    municipalityNumber: p.municipalityNumber,
    municipalityName: p.municipalityName,
    housingType: p.housingType,
    ownershipForm: p.ownershipForm,
    gnr: p.gnr,
    bnr: p.bnr,
    fnr: p.fnr,
    snr: p.snr,
    associationName: p.associationName,
    shareNumber: p.shareNumber,
  };
}

async function partiesOf(orgId: string, assignmentId: string) {
  return rows<Record<string, unknown>>(sql`
    select role, name, email, phone from assignment_parties
    where organization_id = ${orgId} and assignment_id = ${assignmentId} and deleted_at is null
    order by role, name`);
}

function planParties(a: TestdataAssignment) {
  return a.parties
    .map((p) => ({ role: p.role, name: p.name, email: p.email, phone: p.phone }))
    .sort((x, y) => x.role.localeCompare(y.role) || x.name.localeCompare(y.name));
}

async function buildingsOf(orgId: string, assignmentId: string) {
  const found = await rows<{
    building: string;
    floor: string;
    level: number;
    below: boolean;
    rooms: { roomType: string; name: string; areaType: string; belowGround: boolean }[];
    bra_i: string | null;
    bra_e: string | null;
    bra_b: string | null;
    alh: string | null;
    method: string | null;
  }>(sql`
    select b.name as building, f.name as floor, f.level, f.below_ground as below,
      coalesce((select json_agg(json_build_object('roomType', r.room_type, 'name', r.name,
          'areaType', r.area_type, 'belowGround', r.below_ground) order by r.room_type, r.name)
        from rooms r where r.floor_id = f.id and r.deleted_at is null), '[]'::json) as rooms,
      fa.bra_i::text as bra_i, fa.bra_e::text as bra_e, fa.bra_b::text as bra_b, fa.alh::text as alh, fa.method
    from report_buildings b
    join floors f on f.report_building_id = b.id and f.deleted_at is null
    left join floor_areas fa on fa.floor_id = f.id and fa.deleted_at is null
    where b.organization_id = ${orgId} and b.assignment_id = ${assignmentId} and b.deleted_at is null
    order by b.name, f.level, f.name`);
  const num = (v: string | null) => (v === null ? null : Number(v));
  return found.map((row) => ({
    building: row.building,
    floor: row.floor,
    level: row.level,
    belowGround: row.below,
    rooms: row.rooms,
    area:
      row.method === null
        ? null
        : {
            braI: num(row.bra_i),
            braE: num(row.bra_e),
            braB: num(row.bra_b),
            alh: num(row.alh),
            method: row.method,
          },
  }));
}

function planBuildings(a: TestdataAssignment) {
  const out = a.buildings.flatMap((b) =>
    b.floors.map((f) => ({
      building: b.name,
      floor: f.name,
      level: f.level,
      belowGround: f.belowGround,
      rooms: f.rooms
        .map((r) => ({
          roomType: r.roomType,
          name: r.name,
          areaType: r.areaType,
          belowGround: r.belowGround,
        }))
        .sort((x, y) => x.roomType.localeCompare(y.roomType) || x.name.localeCompare(y.name)),
      area: f.area
        ? {
            braI: f.area.braI,
            braE: f.area.braE,
            braB: f.area.braB,
            alh: f.area.alh,
            method: f.area.method,
          }
        : null,
    })),
  );
  return out.sort(
    (x, y) =>
      x.building.localeCompare(y.building) || x.level - y.level || x.floor.localeCompare(y.floor),
  );
}

describe("testdata: idempotens (4.2)", () => {
  it("4.2.13 andre kjøring skriver ingenting: like radtall, nummerserie og updated_at", async () => {
    await seedAll();
    const counts = await countRows();
    const stamps = await updatedAtSnapshot();
    await seed();
    expect(await countRows()).toEqual(counts);
    expect(await updatedAtSnapshot()).toEqual(stamps);
  });

  it("4.2.14 andre kjøring med now 30 dager fram endrer ingenting og flytter ingen datoer", async () => {
    const orgId = await seedAll();
    const counts = await countRows();
    const stamps = await updatedAtSnapshot();
    const orders = await tdOrders(orgId);
    await seed(new Date(TEST_NOW.getTime() + 30 * DAY));
    expect(await countRows()).toEqual(counts);
    expect(await updatedAtSnapshot()).toEqual(stamps);
    expect(await tdOrders(orgId)).toEqual(orders);
  });

  it("4.2.15 tredje kjøring gir det samme som andre", async () => {
    await seedAll();
    await seed();
    const counts = await countRows();
    const stamps = await updatedAtSnapshot();
    await seed();
    expect(await countRows()).toEqual(counts);
    expect(await updatedAtSnapshot()).toEqual(stamps);
  });
});

describe("testdata: avbrutt kjøring og myk sletting (4.3)", () => {
  /** Radtallene etter én full kjøring i en tom database (uten nummerseriens id). */
  async function referenceCounts() {
    await resetDatabase();
    await seedAll();
    const counts = await countRows();
    await resetDatabase();
    return withoutOrgIds(counts);
  }

  function withoutOrgIds(counts: Record<string, number | string[]>) {
    const values = counts.number_sequence_values as string[];
    return {
      ...counts,
      number_sequence_values: values.map((line) => line.split(":").slice(1).join(":")),
    };
  }

  it("4.3.16 kjøring avbrutt etter ansatte (feil ved første firma) fylles ut av neste, uten kopier", async () => {
    const reference = await referenceCounts();
    await runSeed(env);
    const firmNames = plan.firms.map((f) => `'${f.name.replace(/'/g, "''")}'`).join(", ");
    const drop = await failInsertWhen("firms", `new.name in (${firmNames})`);
    try {
      await errorFrom(seed());
    } finally {
      await drop();
    }
    await seed();
    expect(withoutOrgIds(await countRows())).toEqual(reference);
  });

  it("4.3.16 bare ansatte finnes (lagt inn som skriptet gjør): neste kjøring fyller ut resten uten kopier", async () => {
    const reference = await referenceCounts();
    await runSeed(env);
    const orgId = await byggconId();
    for (const employee of plan.employees) {
      const user = await createUser({ name: employee.name, email: employee.email.toLowerCase() });
      const [ids] = await rows<{ company_id: string | null; office_id: string | null }>(sql`
        select (select id from companies where organization_id = ${orgId} and legal_name = ${employee.companyLegalName}) as company_id,
          (select id from offices where organization_id = ${orgId} and name = ${employee.officeName}) as office_id`);
      await createEmployee(user, orgId, [...employee.roles], {
        companyId: ids!.company_id ?? undefined,
        officeId: ids!.office_id ?? undefined,
      });
    }
    await seed();
    const after = withoutOrgIds(await countRows());
    // Sertifiseringene legges på av skriptet hvis de mangler; resten skal være likt.
    expect(after).toEqual(reference);
  });

  it("4.3.17 avbrutt midt i oppdragene (feil på TD-0021) fylles ut, uten dobbel ordre og uten hull", async () => {
    const reference = await referenceCounts();
    await runSeed(env);
    const drop = await failInsertWhen("orders", `new.external_ref = 'TD-0021'`);
    let partial: Map<string, TdOrderRow>;
    try {
      await errorFrom(seed());
      partial = await tdOrders(await byggconId());
    } finally {
      await drop();
    }
    expect(partial.has("TD-0021")).toBe(false);
    await seed();
    const orgId = await byggconId();
    const refs = await rows<{ external_ref: string; n: number }>(sql`
      select external_ref, count(*)::int as n from orders
      where organization_id = ${orgId} and external_ref like 'TD-%' group by external_ref`);
    expect(refs.filter((r) => r.n !== 1)).toEqual([]);
    expect(refs).toHaveLength(plan.orders.length);
    expect(withoutOrgIds(await countRows())).toEqual(reference);
    // Ordrene fra før avbruddet er de samme radene (ikke laget på nytt)
    const now = await tdOrders(orgId);
    for (const [ref, row] of partial) expect(now.get(ref)?.order_id).toBe(row.order_id);
  });

  it("4.3.18 mykt slettet TD-ordre gjenopplives ikke og får ingen kopi", async () => {
    const orgId = await seedAll();
    await db.execute(sql`
      update orders set deleted_at = now(), deleted_by = 'test'
      where organization_id = ${orgId} and external_ref = 'TD-0002'`);
    const counts = await countRows();
    await seed();
    expect(await countRows()).toEqual(counts);
    const found = await rows<{ deleted_at: Date | null }>(sql`
      select deleted_at from orders where organization_id = ${orgId} and external_ref = 'TD-0002'`);
    expect(found).toHaveLength(1);
    expect(found[0]!.deleted_at).not.toBeNull();
  });

  it("4.3.19 mykt slettet TD-kontakt gjenopplives ikke og får ingen kopi", async () => {
    const orgId = await seedAll();
    const email = plan.contacts[0]!.email.toLowerCase();
    await db.execute(sql`
      update contacts set deleted_at = now(), deleted_by = 'test'
      where organization_id = ${orgId} and lower(email) = ${email}`);
    const counts = await countRows();
    await seed();
    expect(await countRows()).toEqual(counts);
    const found = await rows<{ deleted_at: Date | null }>(sql`
      select deleted_at from contacts where organization_id = ${orgId} and lower(email) = ${email}`);
    expect(found).toHaveLength(1);
    expect(found[0]!.deleted_at).not.toBeNull();
  });

  it("4.3.20 mykt slettet oppdiktet ansatt gjenopplives ikke og får ingen kopi", async () => {
    const orgId = await seedAll();
    const email = planEmployeeWithRole("office").email.toLowerCase();
    await db.execute(sql`
      update employees set deleted_at = now(), deleted_by = 'test'
      where organization_id = ${orgId} and user_id = (select id from users where email = ${email})`);
    const counts = await countRows();
    await seed();
    expect(await countRows()).toEqual(counts);
    const found = await rows<{ deleted_at: Date | null }>(sql`
      select e.deleted_at from employees e join users u on u.id = e.user_id
      where e.organization_id = ${orgId} and u.email = ${email}`);
    expect(found).toHaveLength(1);
    expect(found[0]!.deleted_at).not.toBeNull();
  });

  it("4.3.21 skriptet setter aldri deleted_at (radtall med deleted_at er 0 etter kjøring)", async () => {
    await runSeed(env);
    const before = await deletedCounts();
    await seed();
    expect(await deletedCounts()).toEqual(before);
    await seed();
    expect(await deletedCounts()).toEqual(before);
  });

  it("4.3.21 kildeteksten skriver ikke til deleted_at", () => {
    const source = readFileSync(join(process.cwd(), "src/db/seed/testdata.ts"), "utf8");
    expect(source).not.toMatch(/\.set\(\s*\{[^}]*deletedAt/s);
    expect(source).not.toMatch(/set\s+deleted_at\s*=/i);
    expect(source).not.toMatch(/deletedAt:\s*(new Date|now|sql)/);
  });
});

describe("testdata: organisasjonen mangler og bruker i annen organisasjon (4.4)", () => {
  it("4.4.22 Byggcon mangler: norsk melding «Kjør pnpm db:seed først.» og ingen skriving", async () => {
    const counts = await countRows();
    const error = await errorFrom(seed());
    expect(error.message).toContain("Kjør pnpm db:seed først.");
    expect(await countRows()).toEqual(counts);
  });

  it("4.4.22 bare en annen organisasjon finnes: samme stopp, den andre er urørt", async () => {
    await createOrganization("Annen takst AS");
    const counts = await countRows();
    const stamps = await updatedAtSnapshot();
    const error = await errorFrom(seed());
    expect(error.message).toContain("Kjør pnpm db:seed først.");
    expect(await countRows()).toEqual(counts);
    expect(await updatedAtSnapshot()).toEqual(stamps);
  });

  it("4.4.23 TD-e-post er bruker hos en ansatt i en annen organisasjon: stopp før skriving", async () => {
    await runSeed(env);
    const other = await createOrganization("Annen takst AS");
    const email = plan.employees[3]!.email.toLowerCase();
    const user = await createUser({ name: "Oppdiktet Annen", email });
    const employee = await createEmployee(user, other.id, ["inspector", "office"]);
    const counts = await countRows();
    const stamps = await updatedAtSnapshot();
    const error = await errorFrom(seed());
    expect(error.message).not.toContain(email);
    expect(error.message).not.toContain("@");
    expect(error.message).toMatch(/[æøåÆØÅ]|organisasjon|bruker|ansatt/i);
    expect(await countRows()).toEqual(counts);
    expect(await updatedAtSnapshot()).toEqual(stamps);
    const byggcon = await byggconId();
    expect(
      await count(
        sql`select count(*)::int as n from employees where user_id = ${user.id} and organization_id = ${byggcon}`,
      ),
    ).toBe(0);
    const roles = await rows<{ role: string }>(
      sql`select role::text as role from employee_roles where employee_id = ${employee.id} and deleted_at is null order by role`,
    );
    expect(roles.map((r) => r.role)).toEqual(["inspector", "office"]);
  });

  it("4.4.24 TD-e-post er bruker uten ansatt noe sted: brukeren gjenbrukes og kobles til Byggcon", async () => {
    await runSeed(env);
    const email = plan.employees[0]!.email.toLowerCase();
    const user = await createUser({ name: plan.employees[0]!.name, email });
    await seed();
    const orgId = await byggconId();
    expect(await count(sql`select count(*)::int as n from users where email = ${email}`)).toBe(1);
    expect(
      await count(
        sql`select count(*)::int as n from employees where user_id = ${user.id} and organization_id = ${orgId}`,
      ),
    ).toBe(1);
  });
});

describe("testdata: vakten i seed-steget (4.5)", () => {
  const PROD = "psql-ezprop-prod.postgres.database.azure.com";
  const local = () => process.env.DATABASE_URL!;
  const withHost = (host: string, query = "") => {
    const url = new URL(local());
    return `postgres://${url.username}:${url.password}@${host}:5432${url.pathname}${query}`;
  };

  it.each([
    ["APP_ENVIRONMENT=production", { app: "production" }],
    ["tom APP_ENVIRONMENT", { app: "" }],
    ["produksjonsvert", { url: () => withHost(PROD) }],
    ["komma i vertsdelen", { url: () => withHost(`localhost,${PROD}`) }],
    ["?host= i spørredelen", { url: () => withHost("localhost", `?host=${PROD}`) }],
  ] as const)("4.5.25 %s: stopp før første skriving, ingen transaksjon", async (_, change) => {
    await runSeed(env);
    const counts = await countRows();
    const transaction = vi.spyOn(db, "transaction");
    const insert = vi.spyOn(db, "insert");
    if ("app" in change) process.env.APP_ENVIRONMENT = change.app;
    if ("url" in change) process.env.DATABASE_URL = change.url();
    resetEnvCache();
    let error: Error;
    try {
      error = await errorFrom(seed());
    } finally {
      process.env.APP_ENVIRONMENT = savedEnv.app;
      process.env.DATABASE_URL = savedEnv.url;
      resetEnvCache();
    }
    expect(error.message).toMatch(/^Testdata kan /);
    expect(error.message).not.toContain(PROD);
    expect(error.message).not.toContain("localhost");
    expect(error.message).not.toContain(new URL(local()).password || "§");
    expect(transaction).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(await countRows()).toEqual(counts);
  });
});

describe("testdata: tenant-isolasjon (4.6)", () => {
  it("4.6.26 prøveorganisasjonen er urørt", async () => {
    await runSeed(env);
    await runSampleSeed(env, TEST_NOW);
    const [sample] = await organizationsNamed(`${brand.companyName} prøve`);
    expect(sample).toBeTruthy();
    const tables = ["orders", "assignments", "employees", "properties", "events", "audit_log"];
    const before: Record<string, number> = {};
    for (const table of tables) {
      before[table] = await count(
        sql`select count(*)::int as n from ${sql.identifier(table)} where organization_id = ${sample!.id}`,
      );
    }
    const stamps = await updatedAtSnapshot();
    await seed();
    for (const table of tables) {
      expect(
        await count(
          sql`select count(*)::int as n from ${sql.identifier(table)} where organization_id = ${sample!.id}`,
        ),
        table,
      ).toBe(before[table]);
    }
    const after = await updatedAtSnapshot();
    for (const table of Object.keys(stamps)) {
      const sampleLines = (lines: string[]) =>
        lines.filter((line) => stamps[table]!.includes(line));
      // Alle radene som fantes før (prøveorganisasjonen og Byggcon), er uendret
      expect(sampleLines(after[table]!), table).toEqual(stamps[table]);
    }
  });

  it("4.6.27 annen organisasjon med ordre TD-0001 tolkes ikke som «finnes» og endres ikke", async () => {
    await runSeed(env);
    const other = await createOrganization("Annen takst AS");
    const foreign = await createOrder(other.id, { externalRef: "TD-0001" });
    await seed();
    const orgId = await byggconId();
    expect((await tdOrders(orgId)).has("TD-0001")).toBe(true);
    const [after] = await rows<{
      updated_at: string;
      row_version: number;
      deleted_at: Date | null;
    }>(
      sql`select updated_at::text as updated_at, row_version, deleted_at from orders where id = ${foreign.id}`,
    );
    expect(after!.row_version).toBe(foreign.rowVersion);
    expect(new Date(after!.updated_at).getTime()).toBe(foreign.updatedAt.getTime());
    expect(after!.deleted_at).toBeNull();
  });

  it("4.6.28 annen organisasjon med kontakt med samme TD-e-post tolkes ikke som «finnes»", async () => {
    await runSeed(env);
    const other = await createOrganization("Annen takst AS");
    const email = plan.contacts[0]!.email.toLowerCase();
    const foreign = await createContact(other.id, { email, firstName: "Annen", lastName: "Kopi" });
    await seed();
    const orgId = await byggconId();
    expect(
      await count(
        sql`select count(*)::int as n from contacts where organization_id = ${orgId} and lower(email) = ${email}`,
      ),
    ).toBe(1);
    const [after] = await rows<{ updated_at: string; row_version: number; first_name: string }>(
      sql`select updated_at::text as updated_at, row_version, first_name from contacts where id = ${foreign.id}`,
    );
    expect(after!.row_version).toBe(foreign.rowVersion);
    expect(after!.first_name).toBe("Annen");
  });

  it("4.6.29 annen organisasjon med firma med samme navn og type tolkes ikke som «finnes»", async () => {
    await runSeed(env);
    const other = await createOrganization("Annen takst AS");
    const firm = plan.firms[0]!;
    const foreign = await createFirm(other.id, {
      name: firm.name,
      firmType: firm.firmType,
      orgNumber: null,
    });
    await seed();
    const orgId = await byggconId();
    expect(
      await count(
        sql`select count(*)::int as n from firms where organization_id = ${orgId} and name = ${firm.name}`,
      ),
    ).toBe(1);
    const [after] = await rows<{ row_version: number }>(
      sql`select row_version from firms where id = ${foreign.id}`,
    );
    expect(after!.row_version).toBe(foreign.rowVersion);
  });

  it("4.6.30 annen organisasjon med eiendom med samme kommune + gnr + bnr tolkes ikke som «finnes»", async () => {
    await runSeed(env);
    const other = await createOrganization("Annen takst AS");
    const p = planAssignments[0]!.assignment.property;
    const foreign = await createProperty(other.id, {
      address: "Annen vei 1",
      municipalityNumber: p.municipalityNumber,
      gnr: p.gnr,
      bnr: p.bnr,
      fnr: p.fnr,
      snr: p.snr,
    });
    const before = await rows<{ line: string }>(
      sql`select updated_at::text || ':' || row_version as line from properties where id = ${foreign.property.id}`,
    );
    await seed();
    const orgId = await byggconId();
    expect(
      await count(sql`
        select count(*)::int as n from properties p join cadastral_units c on c.property_id = p.id
        where p.organization_id = ${orgId} and p.municipality_number = ${p.municipalityNumber}
          and c.gnr = ${p.gnr} and c.bnr = ${p.bnr}`),
    ).toBeGreaterThanOrEqual(1);
    const after = await rows<{ line: string }>(
      sql`select updated_at::text || ':' || row_version as line from properties where id = ${foreign.property.id}`,
    );
    expect(after).toEqual(before);
  });

  it("4.6.31 ankeret leses bare i Byggcon: TD-0001 i en annen organisasjon flytter ingen datoer", async () => {
    await runSeed(env);
    const other = await createOrganization("Annen takst AS");
    const old = new Date(TEST_NOW.getTime() - 60 * DAY);
    await createOrder(other.id, { externalRef: "TD-0001", receivedAt: old, createdAt: old });
    await seed();
    const orders = await tdOrders(await byggconId());
    for (const order of plan.orders) {
      expect(new Date(orders.get(order.externalRef)!.received_at).toISOString()).toBe(
        order.receivedAt.toISOString(),
      );
    }
  });

  const LOOKUPS: {
    name: string;
    seed: (orgId: string, side: "a" | "b") => Promise<string>;
  }[] = [
    {
      name: "findTestdataOrders",
      seed: async (orgId) => (await createOrder(orgId, { externalRef: "TD-0001" })).id,
    },
    {
      name: "findTestdataContacts",
      seed: async (orgId) =>
        (await createContact(orgId, { email: plan.contacts[0]!.email.toLowerCase() })).id,
    },
    {
      name: "findTestdataFirms",
      seed: async (orgId) =>
        (
          await createFirm(orgId, {
            name: plan.firms[0]!.name,
            firmType: plan.firms[0]!.firmType,
            orgNumber: null,
          })
        ).id,
    },
    {
      name: "findTestdataProperties",
      seed: async (orgId) => {
        const p = planAssignments[0]!.assignment.property;
        const created = await createProperty(orgId, {
          address: p.address,
          municipalityNumber: p.municipalityNumber,
          housingType: p.housingType,
          ownershipForm: p.ownershipForm,
          gnr: p.gnr,
          bnr: p.bnr,
          fnr: p.fnr,
          snr: p.snr,
        });
        return created.property.id;
      },
    },
    {
      name: "findTestdataEmployees",
      seed: async (orgId, side) => {
        const employee = plan.employees[side === "a" ? 0 : 1]!;
        const user = await createUser({ name: employee.name, email: employee.email.toLowerCase() });
        return (await createEmployee(user, orgId, ["inspector"])).id;
      },
    },
    {
      name: "findAnchorOrder",
      seed: async (orgId) => (await createOrder(orgId, { externalRef: "TD-0001" })).id,
    },
  ];

  it.each(LOOKUPS)(
    "4.6.32 $name gir bare rader fra egen organisasjon",
    async ({ name, seed: put }) => {
      await expectTenantIsolation({
        seed: async (grantA, grantB) => ({
          a: [await put(grantA.organizationId, "a")],
          b: [await put(grantB.organizationId, "b")],
        }),
        query: async (actor, organizationId) => {
          const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
          return lookup(name, grant.organizationId);
        },
        idOf: (row: { id: string }) => row.id,
      });
    },
  );

  it("4.6.33 ingen ny tabell: tests/tenant-tables.ts har ingen testdata-tabell", () => {
    const source = readFileSync(join(process.cwd(), "tests/tenant-tables.ts"), "utf8");
    expect(source).not.toMatch(/testdata/i);
    const schemaDir = readFileSync(join(process.cwd(), "src/db/schema/index.ts"), "utf8");
    expect(schemaDir).not.toMatch(/testdata/i);
  });
});

describe("testdata: ekte arbeid og admin røres ikke (4.7)", () => {
  it("4.7.34 ordre, kontakt og ansatt uten TD er uendret", async () => {
    await runSeed(env);
    const orgId = await byggconId();
    const order = await createOrder(orgId, {
      externalRef: "megler-77",
      addressText: "Oppdiktet gate 3, 8006 Bodø",
    });
    const contact = await createContact(orgId, {
      firstName: "Ekte",
      lastName: "Kontaktsen",
      email: "kontakt@eksempel.invalid",
    });
    const user = await createUser({ name: "Oppdiktet Ekte Ansatt" });
    const employee = await createEmployee(user, orgId, ["inspector"]);
    const snapshot = async () => ({
      order: await rows(sql`select * from orders where id = ${order.id}`),
      contact: await rows(sql`select * from contacts where id = ${contact.id}`),
      employee: await rows(sql`select * from employees where id = ${employee.id}`),
      roles: await rows(
        sql`select role::text, deleted_at from employee_roles where employee_id = ${employee.id} order by role`,
      ),
      team: await count(
        sql`select count(*)::int as n from assignment_team_members where employee_id = ${employee.id}`,
      ),
      sessions: await count(
        sql`select count(*)::int as n from work_sessions where employee_id = ${employee.id}`,
      ),
    });
    const before = await snapshot();
    await seed();
    expect(await snapshot()).toEqual(before);
  });

  it("4.7.35 seed-admin har samme roller, er aktiv, og antall aktive admin er likt", async () => {
    await runSeed(env);
    const orgId = await byggconId();
    const admin = await adminActor();
    const adminEmployee = await employeeIdOf(admin, orgId);
    const snapshot = async () => ({
      employee: await rows(sql`select * from employees where id = ${adminEmployee}`),
      roles: await rows(
        sql`select role::text, deleted_at from employee_roles where employee_id = ${adminEmployee} order by role`,
      ),
      admins: await activeAdminCount(orgId),
    });
    const before = await snapshot();
    expect(before.admins).toBe(1);
    await seed();
    expect(await snapshot()).toEqual(before);
  });

  it("4.7.36 admin ser fortsatt reklamasjonene (claims.read via tjenesten)", async () => {
    const orgId = await seedAll();
    const admin = await adminActor();
    const withClaim = await claimAssignmentIds(orgId);
    expect(withClaim.length).toBe(planAssignments.filter((p) => p.assignment.claim).length);
    for (const id of withClaim) {
      const claims = await listClaimsForAssignment(admin, orgId, id);
      expect(claims.length).toBe(1);
    }
  });

  it.each([
    ["av", {}],
    [
      "på",
      {
        "time_tracking.enabled": true,
        "time_tracking.baseline": { source: "oppdiktet" },
        "ai.enabled": true,
        "access.inspectors_edit_all": false,
      },
    ],
  ])(
    "4.7.37 organizations.settings er like før og etter (innstillingene %s)",
    async (_, settings) => {
      await runSeed(env);
      const orgId = await byggconId();
      if (Object.keys(settings).length > 0) {
        await db.execute(
          sql`update organizations set settings = settings || ${JSON.stringify(settings)}::jsonb where id = ${orgId}`,
        );
      }
      const before = await rows(sql`select settings, updated_at from organizations order by id`);
      await seed();
      expect(await rows(sql`select settings, updated_at from organizations order by id`)).toEqual(
        before,
      );
    },
  );

  it("4.7.38 integration_connections er like før og etter", async () => {
    await runSeed(env);
    const orgId = await byggconId();
    await createIntegrationConnection(orgId);
    const before = await rows(sql`select * from integration_connections order by id`);
    await seed();
    expect(await rows(sql`select * from integration_connections order by id`)).toEqual(before);
  });
});

async function claimAssignmentIds(orgId: string): Promise<string[]> {
  const found = await rows<{ assignment_id: string }>(sql`
    select c.assignment_id from claims c join orders o on o.assignment_id = c.assignment_id
    where c.organization_id = ${orgId} and o.external_ref like 'TD-%' and c.deleted_at is null`);
  return found.map((row) => row.assignment_id);
}

describe("testdata: tilgang per rolle (4.8)", () => {
  type Role = "inspector" | "office" | "manager" | "admin";
  const actorFor = async (role: Role) =>
    role === "admin" ? adminActor() : actorByEmail(planEmployeeWithRole(role).email);

  it.each(["inspector", "office", "manager", "admin"] as const)(
    "4.8.39 %s ser TD-oppdragene i arbeidskøen og ordrelisten",
    async (role) => {
      const orgId = await seedAll();
      const actor = await actorFor(role);
      const counts = await countWorkQueueByStatus(actor, orgId, { mineOnly: false, query: "" });
      for (const status of ["ordered", "in_progress", "completed", "invoiced"] as const) {
        const expected = planAssignments.filter((p) => p.assignment.status === status).length;
        expect(counts[status], status).toBe(expected);
        const list = await listWorkQueue(actor, orgId, { mineOnly: false, query: "", status });
        expect(list.total, status).toBe(expected);
        expect(list.items.length).toBeGreaterThan(0);
      }
      const orders = await listOrders(actor, orgId);
      expect(orders.total).toBe(plan.orders.length);
      expect(
        orders.items.some((o) => o.externalRef === "TD-0001" || o.externalRef?.startsWith("TD-")),
      ).toBe(true);
    },
  );

  it.each(["inspector", "office"] as const)(
    "4.8.40 %s får AccessDeniedError på reklamasjonene",
    async (role) => {
      const orgId = await seedAll();
      const actor = await actorFor(role);
      const [assignmentId] = await claimAssignmentIds(orgId);
      await expect(listClaimsForAssignment(actor, orgId, assignmentId!)).rejects.toBeInstanceOf(
        AccessDeniedError,
      );
      const [claim] = await rows<{ id: string }>(
        sql`select id from claims where organization_id = ${orgId} limit 1`,
      );
      await expect(getClaim(actor, orgId, claim!.id)).rejects.toBeInstanceOf(AccessDeniedError);
    },
  );

  it.each(["manager", "admin"] as const)("4.8.40 %s ser reklamasjonene", async (role) => {
    const orgId = await seedAll();
    const actor = await actorFor(role);
    for (const id of await claimAssignmentIds(orgId)) {
      expect((await listClaimsForAssignment(actor, orgId, id)).length).toBe(1);
    }
  });

  async function claimInputFrom(orgId: string) {
    const [row] = await rows<{ id: string }>(sql`
      select id from claims where organization_id = ${orgId} and outcome = 'open' limit 1`);
    const admin = await adminActor();
    const claim = await getClaim(admin, orgId, row!.id);
    return {
      id: claim.id,
      input: {
        claimType: claim.claimType,
        receivedAt: claim.receivedAt,
        claimantPartyId: claim.claimantPartyId,
        claimantText: claim.claimantText,
        description: `${claim.description} Oppdatert i testen.`,
        buildingPartText: claim.buildingPartText,
        outcome: claim.outcome,
        amount: claim.amount,
      },
    };
  }

  it.each(["inspector", "office"] as const)(
    "4.8.41 %s kan ikke endre en reklamasjon",
    async (role) => {
      const orgId = await seedAll();
      const { id, input } = await claimInputFrom(orgId);
      const actor = await actorFor(role);
      await expect(updateClaim(actor, orgId, id, input as never)).rejects.toBeInstanceOf(
        AccessDeniedError,
      );
    },
  );

  it.each(["manager", "admin"] as const)("4.8.41 %s kan endre en reklamasjon", async (role) => {
    const orgId = await seedAll();
    const { id, input } = await claimInputFrom(orgId);
    const actor = await actorFor(role);
    const updated = await updateClaim(actor, orgId, id, input as never);
    expect(updated.description).toContain("Oppdatert i testen.");
  });

  it("4.8.42 takstmannen med utløpt sertifisering mangler report.publish, men kan lese", async () => {
    const orgId = await seedAll();
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(new Date());
    const [expired] = await rows<{ email: string }>(sql`
      select u.email from certifications c join employees e on e.id = c.employee_id
      join users u on u.id = e.user_id
      where c.organization_id = ${orgId} and c.deleted_at is null and c.valid_to < ${today}`);
    expect(expired).toBeTruthy();
    const actor = await actorByEmail(expired!.email);
    await expect(requireOrganizationAccess(actor, orgId, "report.publish")).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    const grant = await requireOrganizationAccess(actor, orgId, "organization.read");
    expect(grant.roles).toContain("inspector");
    const queue = await listWorkQueue(actor, orgId, {
      mineOnly: false,
      query: "",
      status: "in_progress",
    });
    expect(queue.total).toBeGreaterThan(0);
  });

  it("4.8.43 admin stenges ikke ute: tilgang til hver rettighet etter kjøringen", async () => {
    const orgId = await seedAll();
    const admin = await adminActor();
    for (const permission of PERMISSIONS) {
      const grant = await requireOrganizationAccess(admin, orgId, permission);
      expect(grant.organizationId, permission).toBe(orgId);
    }
  });
});

describe("testdata: ytelse med full testdata (4.10, A306)", () => {
  const LIMIT_MS = 2000;

  async function timed<T>(fn: () => Promise<T>): Promise<number> {
    await fn(); // oppvarming
    const start = performance.now();
    await fn();
    return performance.now() - start;
  }

  it("4.10.46–48 listWorkQueue, countWorkQueueByStatus og listOrders svarer under 2 s", async () => {
    const orgId = await seedAll();
    const actor = await actorByEmail(planEmployeeWithRole("office").email);
    const lastName = TESTDATA_LAST_NAMES.find((name) =>
      plan.contacts.some((c) => c.lastName === name),
    )!;
    const cases: [string, () => Promise<unknown>][] = [
      [
        "listWorkQueue uten filter",
        () => listWorkQueue(actor, orgId, { mineOnly: false, query: "", status: "in_progress" }),
      ],
      [
        "listWorkQueue med søketekst",
        () =>
          listWorkQueue(actor, orgId, { mineOnly: false, query: lastName, status: "completed" }),
      ],
      [
        "listWorkQueue med statusfilter",
        () => listWorkQueue(actor, orgId, { mineOnly: false, query: "", status: "invoiced" }),
      ],
      [
        "countWorkQueueByStatus uten filter",
        () => countWorkQueueByStatus(actor, orgId, { mineOnly: false, query: "" }),
      ],
      [
        "countWorkQueueByStatus med søketekst",
        () => countWorkQueueByStatus(actor, orgId, { mineOnly: false, query: lastName }),
      ],
      ["listOrders uten filter", () => listOrders(actor, orgId)],
      ["listOrders med søketekst", () => listOrders(actor, orgId, { query: lastName })],
      // listOrders har ikke statusfilter i tjenesten (ListOrdersOptions = { query }); søk på
      // TD-prefikset dekker filtrert liste.
      ["listOrders med smal søketekst", () => listOrders(actor, orgId, { query: "TD-0001" })],
    ];
    for (const [name, fn] of cases) {
      expect(await timed(fn), name).toBeLessThan(LIMIT_MS);
    }
  });

  it("4.10.46 søket på et etternavn fra listen finner TD-oppdrag", async () => {
    const orgId = await seedAll();
    const actor = await adminActor();
    const order = plan.orders.find(
      (o): o is TestdataOrder & { converted: { assignment: TestdataAssignment } } =>
        o.converted !== false && o.orderedByContactKey !== null,
    )!;
    const contact = plan.contacts.find((c) => c.key === order.orderedByContactKey)!;
    const counts = await countWorkQueueByStatus(actor, orgId, {
      mineOnly: false,
      query: contact.lastName,
    });
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    const orders = await listOrders(actor, orgId, { query: contact.lastName });
    expect(orders.total).toBeGreaterThan(0);
  });
});

// Sørger for at planen har det testene over trenger, slik at en tom plan ikke gir grønne tester.
describe("testdata: forutsetninger for testene", () => {
  it("planen har ordre, oppdrag, reklamasjoner og ansatte i alle tre rollene", () => {
    expect(plan.orders.length).toBeGreaterThan(40);
    expect(planAssignments.some((p) => p.assignment.claim)).toBe(true);
    for (const role of ["inspector", "office", "manager"] as const) {
      expect(planEmployeeWithRole(role)).toBeTruthy();
    }
    expect(planByRef.get("TD-0001")).toBeTruthy();
  });
});
