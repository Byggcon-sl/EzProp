import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import {
  cancelAssignment,
  getAssignment,
  listWorkQueue,
  updateAssignmentNote,
  type AssignmentStatus,
} from "@/core/assignments";
import { createOrder as createOrderService } from "@/core/orders";
import { findEmployeeGrant } from "@/core/organization";
import { db } from "@/db/client";
import { brand } from "@/shared/config/brand";
import {
  TEST_NOW,
  activeAdminCount,
  createEmployee,
  createOrder,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { runSeed } from "./run";
import { findSampleOrders, runSampleSeed } from "./sample-assignments";
import { SAMPLE_ASSIGNMENTS, SAMPLE_INSPECTOR } from "./sample-assignments.data";

/*
 * Seed-steget for de fire testoppdragene (`pnpm db:seed:testoppdrag`), mot testdatabasen.
 * Testplan: docs/funksjoner/fase2a-testoppdrag-testplan.md avsnitt 2.
 *
 * Alle data er oppdiktet. Admin er `admin@example.com` (som i run.test.ts). Steget får fast tid
 * (`TEST_NOW`), så oppdragsnumrene får året 2026.
 *
 * Støtter hovedmål: tid (fire ferdige testoppdrag uten inntasting), reklamasjoner (grunnlaget for
 * regeltestene endrer seg ikke i det stille) og KI først (KI-forslagene måles mot de samme
 * oppdragene). Testene låser også at Byggcons ekte organisasjon er urørt, at admin aldri stenges
 * ute og at ingenting slettes.
 */

const env = { SEED_ADMIN_EMAIL: "admin@example.com", SEED_ADMIN_NAME: "Test Admin" };
const SAMPLE_ORG = `${brand.companyName} prøve`;

type Loose = Record<string, unknown>;
type SampleFloor = Loose & {
  name: string;
  belowGround?: unknown;
  area?:
    | (Loose & {
        braI?: number | null;
        braB?: number | null;
        alh?: number | null;
        method?: string | null;
      })
    | null;
  rooms?: (Loose & { roomType: string; belowGround?: unknown })[];
};
type Sample = {
  externalRef: string;
  status: AssignmentStatus;
  property: Loose & {
    address: string;
    housingType: string;
    ownershipForm: string;
    municipalityNumber?: string | null;
    gnr?: string | null;
    bnr?: string | null;
    snr?: string | null;
    associationName?: string | null;
  };
  commonAreas?: Loose | null;
  buildings: (Loose & { name: string; floors: SampleFloor[] })[];
  parties: (Loose & { role: string; name: string })[];
};
const samples = (SAMPLE_ASSIGNMENTS as readonly unknown[]).map((sample) => sample as Sample);
const REFS = [
  "sample:detached-garage",
  "sample:apartment-section",
  "sample:apartment-cooperative",
  "sample:holiday-home",
] as const;
const sampleByRef = (ref: string) => samples.find((sample) => sample.externalRef === ref)!;

/** Tabellene med `organization_id` som steget kan røre (testplanen, `countRows`). */
const ORG_TABLES = [
  "employees",
  "employee_roles",
  "companies",
  "offices",
  "orders",
  "assignments",
  "assignment_team_members",
  "assignment_parties",
  "properties",
  "cadastral_units",
  "common_areas",
  "report_buildings",
  "floors",
  "floor_areas",
  "rooms",
  "number_sequences",
  "events",
  "audit_log",
  "files",
] as const;
/** Tabellene over med `updated_at` og `deleted_at` (alle unntatt `number_sequences`). */
const ORG_TABLES_WITH_TIMESTAMPS = ORG_TABLES.filter((table) => table !== "number_sequences");

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(query)) as unknown as T[];
}

async function count(query: ReturnType<typeof sql>): Promise<number> {
  const [row] = await rows<{ n: number }>(query);
  return row?.n ?? -1;
}

/**
 * Antall rader per tabell. Uten organisasjon: hele databasen, også `organizations` og `users`.
 * Med organisasjon: bare radene med den `organization_id`.
 */
async function countRows(organizationId?: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (organizationId === undefined) {
    for (const table of ["organizations", "users", ...ORG_TABLES]) {
      out[table] = await count(sql`select count(*)::int as n from ${sql.identifier(table)}`);
    }
    return out;
  }
  for (const table of ORG_TABLES) {
    out[table] = await count(
      sql`select count(*)::int as n from ${sql.identifier(table)} where organization_id = ${organizationId}`,
    );
  }
  return out;
}

/** Tellerne i `number_sequences` for organisasjonen («prefiks:neste»). */
async function sequenceValues(organizationId: string): Promise<string[]> {
  const found = await rows<{ prefix: string; next_value: number }>(
    sql`select prefix, next_value from number_sequences where organization_id = ${organizationId} order by prefix`,
  );
  return found.map((row) => `${row.prefix}:${row.next_value}`);
}

/** `id:updated_at` for alle rader i organisasjonen, og for organisasjonsraden selv. */
async function updatedAtSnapshot(organizationId: string): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const table of ORG_TABLES_WITH_TIMESTAMPS) {
    const found = await rows<{ id: string; at: string }>(
      sql`select id::text as id, updated_at::text as at from ${sql.identifier(table)} where organization_id = ${organizationId} order by id`,
    );
    out[table] = found.map((row) => `${row.id}:${row.at}`);
  }
  const org = await rows<{ id: string; at: string; settings: string }>(
    sql`select id::text as id, updated_at::text as at, settings::text as settings from organizations where id = ${organizationId}`,
  );
  out.organizations = org.map((row) => `${row.id}:${row.at}:${row.settings}`);
  return out;
}

async function organizationsNamed(name: string) {
  return rows<{ id: string; settings: Loose; updated_at: string }>(
    sql`select id, settings, updated_at::text as updated_at from organizations where name = ${name} order by created_at`,
  );
}

async function sampleOrgId(): Promise<string> {
  const found = await organizationsNamed(SAMPLE_ORG);
  expect(found, "nøyaktig én prøveorganisasjon").toHaveLength(1);
  return found[0]!.id;
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
const inspectorActor = () => actorByEmail(SAMPLE_INSPECTOR.email);

async function employeeIdOf(actor: Actor, organizationId: string): Promise<string> {
  const [row] = await rows<{ id: string }>(
    sql`select id from employees where user_id = ${actor.id} and organization_id = ${organizationId} and deleted_at is null`,
  );
  if (!row) throw new Error("Fant ikke den ansatte i organisasjonen");
  return row.id;
}

type SampleAssignmentRow = {
  external_ref: string;
  order_id: string;
  order_status: string;
  assignment_id: string;
  number: string;
  status: string;
  company_id: string | null;
  property_id: string | null;
  deleted_at: string | null;
};

/** Ordre og oppdrag per testoppdrag i prøveorganisasjonen (også kansellerte oppdrag). */
async function sampleAssignments(
  organizationId: string,
): Promise<Map<string, SampleAssignmentRow>> {
  const found = await rows<SampleAssignmentRow>(sql`
    select o.external_ref, o.id as order_id, o.status as order_status, a.id as assignment_id,
      a.number, a.status, a.company_id, a.property_id, a.deleted_at::text as deleted_at
    from orders o
    left join assignments a on a.id = o.assignment_id and a.organization_id = o.organization_id
    where o.organization_id = ${organizationId} and o.external_ref like 'sample:%'
    order by o.external_ref`);
  return new Map(found.map((row) => [row.external_ref, row]));
}

/** Kjører steget og gir loggen fra kjøringen. */
async function runAndLog(): Promise<string[]> {
  const log = vi.mocked(console.log);
  log.mockClear();
  await runSampleSeed(env, TEST_NOW);
  return log.mock.calls.map((args) => args.map(String).join(" "));
}

beforeEach(async () => {
  await resetDatabase();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("seed-steget for testoppdragene: første kjøring (2.1)", () => {
  beforeEach(async () => {
    await runSeed(env);
  });

  it("2.1.1 lager prøveorganisasjonen med merket, og Byggcons innstillinger er uendret", async () => {
    const [byggconBefore] = await organizationsNamed(brand.companyName);
    await runSampleSeed(env, TEST_NOW);
    const sample = await organizationsNamed(SAMPLE_ORG);
    expect(sample).toHaveLength(1);
    expect(sample[0]!.settings.sampleData).toBe(true);
    const [byggconAfter] = await organizationsNamed(brand.companyName);
    expect(byggconAfter!.settings).toEqual(byggconBefore!.settings);
    expect(byggconAfter!.settings.sampleData).toBeUndefined();
  });

  it("2.1.2 grunndata: Prøveselskap AS uten org.nr., Prøvekontor og én takstmann i selskapet", async () => {
    await runSampleSeed(env, TEST_NOW);
    const orgId = await sampleOrgId();
    const companies = await rows<{ id: string; legal_name: string; org_number: string | null }>(
      sql`select id, legal_name, org_number from companies where organization_id = ${orgId}`,
    );
    expect(companies.map((row) => row.legal_name)).toEqual(["Prøveselskap AS"]);
    expect(companies[0]!.org_number).toBeNull();
    const offices = await rows<{ name: string }>(
      sql`select name from offices where organization_id = ${orgId}`,
    );
    expect(offices.map((row) => row.name)).toEqual(["Prøvekontor"]);

    const inspectors = await rows<{ email: string; name: string; company_id: string | null }>(sql`
      select u.email, e.name, e.company_id from employees e
      join users u on u.id = e.user_id
      join employee_roles r on r.employee_id = e.id and r.organization_id = e.organization_id
      where e.organization_id = ${orgId} and r.role = 'inspector' and r.deleted_at is null
        and e.deleted_at is null`);
    expect(inspectors).toHaveLength(1);
    expect(inspectors[0]!.email).toBe(SAMPLE_INSPECTOR.email.toLowerCase());
    expect(inspectors[0]!.email.endsWith("@example.invalid")).toBe(true);
    expect(inspectors[0]!.company_id).toBe(companies[0]!.id);
  });

  it("2.1.3 fire ordrer med riktig external_ref, hver gjort om til oppdrag med riktig status", async () => {
    await runSampleSeed(env, TEST_NOW);
    const orgId = await sampleOrgId();
    const found = await sampleAssignments(orgId);
    expect([...found.keys()].sort()).toEqual([...REFS].sort());
    for (const ref of REFS) {
      const row = found.get(ref)!;
      expect(row.order_status, ref).toBe("converted");
      expect(row.assignment_id, ref).not.toBeNull();
      expect(row.status, ref).toBe(sampleByRef(ref).status);
      expect(row.deleted_at, ref).toBeNull();
    }
    expect(found.get("sample:detached-garage")!.status).toBe("ordered");
  });

  it("2.1.4 oppdragsnumrene kommer fra nummerserien, og bare prøveorganisasjonens teller øker", async () => {
    const byggcon = await byggconId();
    const byggconSequences = await sequenceValues(byggcon);
    await runSampleSeed(env, TEST_NOW);
    const orgId = await sampleOrgId();
    const numbers = [...(await sampleAssignments(orgId)).values()].map((row) => row.number);
    expect(new Set(numbers).size).toBe(4);
    for (const number of numbers) expect(number).toMatch(/^2026-\d{5,}$/);
    // Serien starter på 1 (ingen rad) og står på 5 etter fire oppdrag.
    expect(await sequenceValues(orgId)).toEqual(["2026-:5"]);
    expect(await sequenceValues(byggcon)).toEqual(byggconSequences);
  });

  it("2.1.5 takstmannen er ansvarlig på alle fire", async () => {
    await runSampleSeed(env, TEST_NOW);
    const orgId = await sampleOrgId();
    const inspectorEmployee = await employeeIdOf(await inspectorActor(), orgId);
    for (const [ref, row] of await sampleAssignments(orgId)) {
      const team = await rows<{ employee_id: string; team_role: string }>(sql`
        select employee_id, team_role from assignment_team_members
        where organization_id = ${orgId} and assignment_id = ${row.assignment_id}
          and to_at is null and deleted_at is null`);
      expect(team, ref).toEqual([{ employee_id: inspectorEmployee, team_role: "responsible" }]);
    }
  });

  it("2.1.6 utstedende selskap er Prøveselskap AS, satt av regelen når ansvarlig settes (A67)", async () => {
    await runSampleSeed(env, TEST_NOW);
    const orgId = await sampleOrgId();
    const [company] = await rows<{ id: string }>(
      sql`select id from companies where organization_id = ${orgId} and legal_name = 'Prøveselskap AS'`,
    );
    for (const [ref, row] of await sampleAssignments(orgId)) {
      expect(row.company_id, ref).toBe(company!.id);
      // Regelen i setTeamMember lager hendelsen; et direkte UPDATE ville ikke gjort det.
      const changed = await rows<{
        data: { fromCompanyId: string | null; toCompanyId: string };
      }>(sql`
        select data from events where organization_id = ${orgId}
          and assignment_id = ${row.assignment_id} and type = 'assignment.company_changed'`);
      expect(changed, ref).toHaveLength(1);
      expect(changed[0]!.data.fromCompanyId, ref).toBeNull();
      expect(changed[0]!.data.toCompanyId, ref).toBe(company!.id);
    }
  });

  it("2.1.7 eiendom: boligtype, eierform, matrikkel 9999, seksjonsnummer, borettslag og fellesdeler", async () => {
    await runSampleSeed(env, TEST_NOW);
    const orgId = await sampleOrgId();
    for (const [ref, row] of await sampleAssignments(orgId)) {
      const sample = sampleByRef(ref);
      expect(row.property_id, `${ref} har eiendom`).not.toBeNull();
      const [property] = await rows<{
        address: string;
        housing_type: string;
        ownership_form: string;
        municipality_number: string | null;
      }>(sql`select address, housing_type, ownership_form, municipality_number from properties
        where organization_id = ${orgId} and id = ${row.property_id}`);
      expect(property, ref).toMatchObject({
        address: sample.property.address,
        housing_type: sample.property.housingType,
        ownership_form: sample.property.ownershipForm,
        municipality_number: "9999",
      });
      const units = await rows<{
        gnr: string;
        bnr: string;
        snr: string | null;
        association_name: string | null;
      }>(
        sql`select gnr, bnr, snr, association_name from cadastral_units
          where organization_id = ${orgId} and property_id = ${row.property_id} and deleted_at is null`,
      );
      expect(units, `${ref} har én matrikkelrad`).toHaveLength(1);
      expect(units[0]!.gnr).toBe(sample.property.gnr);
      expect(units[0]!.bnr).toBe(sample.property.bnr);
      const common = await count(sql`select count(*)::int as n from common_areas
        where organization_id = ${orgId} and assignment_id = ${row.assignment_id}`);
      if (ref === "sample:apartment-section") {
        expect(units[0]!.snr).toBe(sample.property.snr);
        expect(units[0]!.snr).not.toBeNull();
        expect(common, "fellesdeler på sameie").toBe(1);
      }
      if (ref === "sample:apartment-cooperative") {
        expect(units[0]!.association_name).toBe(sample.property.associationName);
        expect(units[0]!.association_name).not.toBeNull();
        expect(common, "fellesdeler på borettslag").toBe(1);
      }
      if (!sample.commonAreas) expect(common, `${ref} har ikke fellesdeler`).toBe(0);
    }
  });

  it("2.1.8 bygninger, etasjer, areal og rom: antall som i datafilen, og utvalgte verdier", async () => {
    await runSampleSeed(env, TEST_NOW);
    const orgId = await sampleOrgId();
    const inspectorEmployee = await employeeIdOf(await inspectorActor(), orgId);
    for (const [ref, row] of await sampleAssignments(orgId)) {
      const sample = sampleByRef(ref);
      const floors = sample.buildings.flatMap((building) => building.floors);
      const rooms = floors.flatMap((floor) => floor.rooms ?? []);

      const buildings = await rows<{
        id: string;
        name: string;
      }>(sql`select id, name from report_buildings
        where organization_id = ${orgId} and assignment_id = ${row.assignment_id} and deleted_at is null`);
      expect(buildings.map((b) => b.name).sort(), ref).toEqual(
        sample.buildings.map((b) => b.name).sort(),
      );
      const dbFloors = await rows<{
        id: string;
        name: string;
        building: string;
        below_ground: boolean;
      }>(sql`
        select f.id, f.name, b.name as building, f.below_ground from floors f
        join report_buildings b on b.id = f.report_building_id
        where f.organization_id = ${orgId} and b.assignment_id = ${row.assignment_id}
          and f.deleted_at is null`);
      expect(dbFloors, `${ref}: etasjer`).toHaveLength(floors.length);
      const dbAreas = await rows<{
        floor: string;
        building: string;
        bra_i: number | null;
        bra_b: number | null;
        alh: number | null;
        method: string | null;
        measured_by: string | null;
      }>(sql`
        select f.name as floor, b.name as building, a.bra_i::float8 as bra_i,
          a.bra_b::float8 as bra_b, a.alh::float8 as alh, a.method, a.measured_by
        from floor_areas a
        join floors f on f.id = a.floor_id
        join report_buildings b on b.id = f.report_building_id
        where a.organization_id = ${orgId} and b.assignment_id = ${row.assignment_id}
          and a.deleted_at is null`);
      expect(dbAreas, `${ref}: areal per etasje`).toHaveLength(
        floors.filter((floor) => floor.area).length,
      );
      for (const area of dbAreas) {
        if (area.method !== null)
          expect(area.measured_by, `${ref}: hvem som målte`).toBe(inspectorEmployee);
      }
      const dbRooms = await rows<{
        floor: string;
        room_type: string;
        area_type: string;
        below_ground: boolean;
      }>(sql`
        select f.name as floor, r.room_type, r.area_type, r.below_ground from rooms r
        join floors f on f.id = r.floor_id
        join report_buildings b on b.id = f.report_building_id
        where r.organization_id = ${orgId} and b.assignment_id = ${row.assignment_id}
          and r.deleted_at is null`);
      expect(dbRooms.map((r) => r.room_type).sort(), `${ref}: romtypene`).toEqual(
        rooms.map((r) => r.roomType).sort(),
      );

      if (ref === "sample:detached-garage") {
        const garage = sample.buildings.find((b) => /garasje/i.test(b.name))!;
        const garageBraB = garage.floors.map((f) => f.area?.braB).find((v) => (v ?? 0) > 0);
        const dbGarage = dbAreas.find((a) => a.building === garage.name && (a.bra_b ?? 0) > 0);
        expect(dbGarage?.bra_b, "garasjens BRA-b").toBe(garageBraB);
        const basementFloors = dbFloors.filter((f) => f.below_ground);
        expect(basementFloors.length, "kjeller under terreng").toBeGreaterThan(0);
        const basementRooms = dbRooms.filter((r) => basementFloors.some((f) => f.name === r.floor));
        expect(basementRooms.length, "rom i kjelleren").toBeGreaterThan(0);
        for (const room of basementRooms) expect(room.below_ground, room.room_type).toBe(true);
      }
      if (ref === "sample:holiday-home") {
        const loft = floors.find((f) => /hems/i.test(f.name))!;
        const dbLoft = dbAreas.find((a) => a.floor === loft.name);
        expect(dbLoft?.alh, "hemsens ALH").toBe(loft.area?.alh);
      }
    }
  });

  it("2.1.9 partene har roller og navn som i datafilen, alle som fritekst", async () => {
    await runSampleSeed(env, TEST_NOW);
    const orgId = await sampleOrgId();
    for (const [ref, row] of await sampleAssignments(orgId)) {
      const parties = await rows<{
        role: string;
        name: string;
        contact_id: string | null;
        firm_id: string | null;
      }>(
        sql`select role, name, contact_id, firm_id from assignment_parties
          where organization_id = ${orgId} and assignment_id = ${row.assignment_id} and deleted_at is null`,
      );
      expect(parties.map((p) => `${p.role}:${p.name}`).sort(), ref).toEqual(
        sampleByRef(ref)
          .parties.map((p) => `${p.role}:${p.name}`)
          .sort(),
      );
      for (const party of parties) {
        expect(party.contact_id, ref).toBeNull();
        expect(party.firm_id, ref).toBeNull();
      }
    }
    expect(
      await count(sql`select count(*)::int as n from contacts where organization_id = ${orgId}`),
    ).toBe(0);
    expect(
      await count(sql`select count(*)::int as n from firms where organization_id = ${orgId}`),
    ).toBe(0);
  });

  it("2.1.10 laget gjennom tjenestene: hendelser for opprettelse og omgjøring, created_by er admin", async () => {
    await runSampleSeed(env, TEST_NOW);
    const orgId = await sampleOrgId();
    const adminEmployee = await employeeIdOf(await adminActor(), orgId);
    for (const [ref, row] of await sampleAssignments(orgId)) {
      const received = await count(sql`select count(*)::int as n from events
        where organization_id = ${orgId} and type = 'order.received' and data->>'orderId' = ${row.order_id}`);
      expect(received, `${ref}: order.received`).toBe(1);
      const created = await count(sql`select count(*)::int as n from events
        where organization_id = ${orgId} and type = 'assignment.created' and assignment_id = ${row.assignment_id}`);
      expect(created, `${ref}: assignment.created`).toBe(1);
    }
    // Alt innhold i oppdragene er laget av admin-ansatt i prøveorganisasjonen (grant.employeeId).
    for (const table of [
      "orders",
      "assignments",
      "assignment_team_members",
      "assignment_parties",
      "properties",
      "cadastral_units",
      "common_areas",
      "report_buildings",
      "floors",
      "floor_areas",
      "rooms",
    ]) {
      const other = await count(sql`select count(*)::int as n from ${sql.identifier(table)}
        where organization_id = ${orgId} and created_by is distinct from ${adminEmployee}`);
      expect(other, `${table}: created_by er admin`).toBe(0);
    }
    const auditByOthers = await count(sql`select count(*)::int as n from audit_log
      where organization_id = ${orgId} and actor_employee_id is distinct from ${adminEmployee}`);
    expect(auditByOthers, "revisjonsloggen viser admin").toBe(0);
  });

  it("2.1.11 ingen bilder og ingen filer (A134)", async () => {
    await runSampleSeed(env, TEST_NOW);
    const orgId = await sampleOrgId();
    expect(
      await count(sql`select count(*)::int as n from files where organization_id = ${orgId}`),
    ).toBe(0);
    expect(await count(sql`select count(*)::int as n from files`)).toBe(0);
  });
});

describe("seed-steget for testoppdragene: gjentatt kjøring og kansellert testoppdrag (2.2)", () => {
  beforeEach(async () => {
    await runSeed(env);
  });

  it("2.2.1 andre kjøring endrer ingenting, og et kansellert testoppdrag lages ikke på nytt", async () => {
    await runSampleSeed(env, TEST_NOW);
    const orgId = await sampleOrgId();
    const coop = (await sampleAssignments(orgId)).get("sample:apartment-cooperative")!;
    await cancelAssignment(await adminActor(), orgId, coop.assignment_id, {
      expectedStatus: coop.status as AssignmentStatus,
      reason: "Kansellert i testen",
      now: TEST_NOW,
    });

    const before = await countRows();
    const sequencesBefore = await sequenceValues(orgId);
    await runSampleSeed(env, TEST_NOW);
    expect(await countRows()).toEqual(before);
    expect(await sequenceValues(orgId)).toEqual(sequencesBefore);

    const coopOrders = await count(sql`select count(*)::int as n from orders
      where organization_id = ${orgId} and external_ref = 'sample:apartment-cooperative'`);
    expect(coopOrders).toBe(1);
    const after = (await sampleAssignments(orgId)).get("sample:apartment-cooperative")!;
    expect(after.assignment_id).toBe(coop.assignment_id);
    expect(after.deleted_at, "fortsatt kansellert").not.toBeNull();
  });

  it("2.2.2 updated_at er uendret på alle rader i prøveorganisasjonen etter andre kjøring", async () => {
    await runSampleSeed(env, TEST_NOW);
    const orgId = await sampleOrgId();
    const before = await updatedAtSnapshot(orgId);
    await runSampleSeed(env, TEST_NOW);
    expect(await updatedAtSnapshot(orgId)).toEqual(before);
  });

  it("2.2.3 tredje kjøring gir det samme som andre", async () => {
    await runSampleSeed(env, TEST_NOW);
    await runSampleSeed(env, TEST_NOW);
    const orgId = await sampleOrgId();
    const counts = await countRows();
    const sequences = await sequenceValues(orgId);
    const snapshot = await updatedAtSnapshot(orgId);
    await runSampleSeed(env, TEST_NOW);
    expect(await countRows()).toEqual(counts);
    expect(await sequenceValues(orgId)).toEqual(sequences);
    expect(await updatedAtSnapshot(orgId)).toEqual(snapshot);
  });
});

describe("seed-steget for testoppdragene: kjøring som stoppet halvveis (2.3)", () => {
  it("2.3.1–2.3.2 bare ordren finnes: neste kjøring fullfører uten å røre ordren", async () => {
    // Tallene fra en ren kjøring
    await runSeed(env);
    await runSampleSeed(env, TEST_NOW);
    const cleanCounts = await countRows();
    const cleanSequences = await sequenceValues(await sampleOrgId());

    // Ny runde: prøveorganisasjonen med admin, og bare ordren for eneboligen (laget med tjenesten)
    await resetDatabase();
    await runSeed(env);
    const [org] = await rows<{ id: string }>(sql`
      insert into organizations (name, brand_name, settings)
      values (${SAMPLE_ORG}, ${SAMPLE_ORG}, ${JSON.stringify({ sampleData: true })}::jsonb)
      returning id`);
    const admin = await adminActor();
    await createEmployee(admin, org!.id, ["admin"]);
    const detached = sampleByRef("sample:detached-garage");
    const order = await createOrderService(
      admin,
      org!.id,
      { addressText: detached.property.address, externalRef: detached.externalRef },
      TEST_NOW,
    );
    // Delen som finnes, røres ikke: en annen merknad på ordren står igjen etterpå.
    await db.execute(
      sql`update orders set ordered_by_text = 'Merknad satt i testen' where id = ${order.id}`,
    );

    await runSampleSeed(env, TEST_NOW);

    const orgId = await sampleOrgId();
    expect(orgId).toBe(org!.id);
    expect(await countRows()).toEqual(cleanCounts);
    expect(await sequenceValues(orgId)).toEqual(cleanSequences);
    const detachedOrders = await rows<{
      id: string;
      ordered_by_text: string | null;
      status: string;
    }>(
      sql`select id, ordered_by_text, status from orders
        where organization_id = ${orgId} and external_ref = 'sample:detached-garage'`,
    );
    expect(detachedOrders, "ordren er ikke laget to ganger").toHaveLength(1);
    expect(detachedOrders[0]!.id).toBe(order.id);
    expect(detachedOrders[0]!.status, "gjort om til oppdrag").toBe("converted");
    expect(detachedOrders[0]!.ordered_by_text, "merknaden er urørt").toBe("Merknad satt i testen");
    const found = await sampleAssignments(orgId);
    expect([...found.keys()].sort()).toEqual([...REFS].sort());
  });
});

describe("seed-steget for testoppdragene: vern mot feil organisasjon (2.4)", () => {
  async function expectRejectsWithoutWriting(
    message: RegExp,
    run = () => runSampleSeed(env, TEST_NOW),
  ) {
    const before = await countRows();
    const error = await run().then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error, "steget skal stoppe").toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(message);
    expect(await countRows(), "ingenting skrevet").toEqual(before);
  }

  async function createNamedOrganization(settings: unknown) {
    await db.execute(sql`
      insert into organizations (name, brand_name, settings)
      values (${SAMPLE_ORG}, ${SAMPLE_ORG}, ${JSON.stringify(settings)}::jsonb)`);
  }

  /** Norsk melding som nevner organisasjonen eller merket. */
  const NORWEGIAN_ORG_MESSAGE = /organisasjon|prøve|merke|sampleData/i;

  it("2.4.1 samme navn uten merket: stopper med norsk melding og skriver ingenting", async () => {
    await runSeed(env);
    await createNamedOrganization({});
    await expectRejectsWithoutWriting(NORWEGIAN_ORG_MESSAGE);
  });

  it.each([["true"], [1], [false], [null]])(
    "2.4.2 sampleData = %j er ikke true: stopper og skriver ingenting",
    async (value) => {
      await runSeed(env);
      await createNamedOrganization({ sampleData: value });
      await expectRejectsWithoutWriting(NORWEGIAN_ORG_MESSAGE);
    },
  );

  it("2.4.3 to organisasjoner med navnet, begge med merket: stopper og skriver ingenting", async () => {
    await runSeed(env);
    await createNamedOrganization({ sampleData: true });
    await createNamedOrganization({ sampleData: true });
    await expectRejectsWithoutWriting(NORWEGIAN_ORG_MESSAGE);
  });

  it("2.4.4 SEED_ADMIN_EMAIL mangler: stopper før noe skrives", async () => {
    await runSeed(env);
    await expectRejectsWithoutWriting(/SEED_ADMIN_EMAIL mangler/, () =>
      runSampleSeed({ SEED_ADMIN_NAME: "Test Admin" }, TEST_NOW),
    );
    await expectRejectsWithoutWriting(/SEED_ADMIN_EMAIL mangler/, () =>
      runSampleSeed({ SEED_ADMIN_EMAIL: "   " }, TEST_NOW),
    );
  });

  it("2.4.5 admin finnes ikke (pnpm db:seed ikke kjørt): stopper og ber om pnpm db:seed", async () => {
    await expectRejectsWithoutWriting(/pnpm db:seed/);
  });
});

describe("seed-steget for testoppdragene: Byggcon er urørt (2.5)", () => {
  it("2.5.1 ingen nye rader i Byggcon etter to kjøringer", async () => {
    await runSeed(env);
    const byggcon = await byggconId();
    const before = await countRows(byggcon);
    const snapshot = await updatedAtSnapshot(byggcon);
    await runSampleSeed(env, TEST_NOW);
    await runSampleSeed(env, TEST_NOW);
    expect(await countRows(byggcon)).toEqual(before);
    expect(await updatedAtSnapshot(byggcon)).toEqual(snapshot);
  });

  it("2.5.2 runSeed alene lager ingen prøveorganisasjon og ingen ordrer", async () => {
    await runSeed(env);
    await runSeed(env);
    expect(await organizationsNamed(SAMPLE_ORG)).toHaveLength(0);
    expect(await count(sql`select count(*)::int as n from orders`)).toBe(0);
    expect(await count(sql`select count(*)::int as n from assignments`)).toBe(0);
  });

  it("2.5.3 package.json: db:seed er uendret, db:seed:testoppdrag peker på sample-index.ts", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["db:seed"]).toBe("tsx src/db/seed/index.ts");
    expect(pkg.scripts["db:seed:testoppdrag"]).toMatch(/^tsx src\/db\/seed\/sample-index\.ts$/);
  });
});

describe("seed-steget for testoppdragene: tilgang per rolle og admin (2.6)", () => {
  beforeEach(async () => {
    await runSeed(env);
  });

  it("2.6.1 admin fra SEED_ADMIN_EMAIL er admin i prøveorganisasjonen", async () => {
    await runSampleSeed(env, TEST_NOW);
    const grant = await requireOrganizationAccess(
      await adminActor(),
      await sampleOrgId(),
      "organization.manage",
    );
    expect(grant.roles).toContain("admin");
  });

  it("2.6.2 admin i Byggcon finnes fortsatt etter to kjøringer", async () => {
    await runSampleSeed(env, TEST_NOW);
    await runSampleSeed(env, TEST_NOW);
    const byggcon = await byggconId();
    expect(await activeAdminCount(byggcon)).toBeGreaterThanOrEqual(1);
    const grant = await requireOrganizationAccess(
      await adminActor(),
      byggcon,
      "organization.manage",
    );
    expect(grant.organizationId).toBe(byggcon);
    expect(grant.roles).toContain("admin");
  });

  it("2.6.3 admin lander fortsatt i Byggcon (navnet sorteres etter «Byggcon», A135)", async () => {
    await runSampleSeed(env, TEST_NOW);
    await runSampleSeed(env, TEST_NOW);
    const byggcon = await byggconId();
    const grant = await findEmployeeGrant(await adminActor());
    expect(grant?.grant.organizationId).toBe(byggcon);
    // Låser forutsetningen: prøveorganisasjonen kommer etter Byggcon i navnerekkefølgen.
    const sorted = await rows<{ name: string }>(
      sql`select name from organizations where name in (${brand.companyName}, ${SAMPLE_ORG}) order by name`,
    );
    expect(sorted.map((row) => row.name)).toEqual([brand.companyName, SAMPLE_ORG]);
  });

  it("2.6.4 takstmannen har lese- og skriverett i prøveorganisasjonen og ingen tilgang i Byggcon", async () => {
    await runSampleSeed(env, TEST_NOW);
    const orgId = await sampleOrgId();
    const inspector = await inspectorActor();
    const read = await requireOrganizationAccess(inspector, orgId, "organization.read");
    expect(read.organizationId).toBe(orgId);
    expect(read.roles).toEqual(["inspector"]);
    await requireOrganizationAccess(inspector, orgId, "assignment.edit");
    await expect(
      requireOrganizationAccess(inspector, await byggconId(), "organization.read"),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    expect((await findEmployeeGrant(inspector))?.grant.organizationId).toBe(orgId);
  });

  it("2.6.5 takstmannen ser alle fire i arbeidskøen og kan endre (access.inspectors_edit_all)", async () => {
    await runSampleSeed(env, TEST_NOW);
    const orgId = await sampleOrgId();
    const inspector = await inspectorActor();
    const found = await sampleAssignments(orgId);
    const ordered = await listWorkQueue(inspector, orgId, {
      status: "ordered",
      mineOnly: false,
      query: "",
    });
    const inProgress = await listWorkQueue(inspector, orgId, {
      status: "in_progress",
      mineOnly: false,
      query: "",
    });
    expect(ordered.items.map((item) => item.id)).toEqual([
      found.get("sample:detached-garage")!.assignment_id,
    ]);
    expect(inProgress.items.map((item) => item.id).sort()).toEqual(
      ["sample:apartment-section", "sample:apartment-cooperative", "sample:holiday-home"]
        .map((ref) => found.get(ref)!.assignment_id)
        .sort(),
    );
    const mine = await listWorkQueue(inspector, orgId, {
      status: "in_progress",
      mineOnly: true,
      query: "",
    });
    expect(mine.items, "«Mine» viser de tre under arbeid").toHaveLength(3);
    const result = await updateAssignmentNote(
      inspector,
      orgId,
      found.get("sample:holiday-home")!.assignment_id,
      "Notat fra testen",
    );
    expect(result).toBeTruthy();
  });
});

describe("seed-steget for testoppdragene: tenant-isolasjon (2.7)", () => {
  it("2.7.1 findSampleOrders gir bare ordrene i egen organisasjon", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createOrder(grantA.organizationId, {
          externalRef: "sample:detached-garage",
        });
        const b = await createOrder(grantB.organizationId, {
          externalRef: "sample:detached-garage",
        });
        // Ordre uten sample:-prefiks er ikke med
        await createOrder(grantA.organizationId, { externalRef: "megler-123" });
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
        return findSampleOrders(grant.organizationId);
      },
      idOf: (row: { id: string }) => row.id,
    });
  });

  it("2.7.1 findSampleOrders tar med avviste ordrer og ordrer med kansellert oppdrag, ikke andre ordrer", async () => {
    await runSeed(env);
    await runSampleSeed(env, TEST_NOW);
    const orgId = await sampleOrgId();
    const coop = (await sampleAssignments(orgId)).get("sample:apartment-cooperative")!;
    await cancelAssignment(await adminActor(), orgId, coop.assignment_id, {
      expectedStatus: coop.status as AssignmentStatus,
      reason: "Kansellert i testen",
      now: TEST_NOW,
    });
    const rejected = await createOrder(orgId, {
      externalRef: "sample:rejected-in-test",
      status: "rejected",
      rejectedReason: "Avvist i testen",
    });
    const other = await createOrder(orgId, { externalRef: "megler-123" });
    const found = (await findSampleOrders(orgId)) as { id: string }[];
    const ids = found.map((row) => row.id);
    expect(ids).toContain(coop.order_id);
    expect(ids).toContain(rejected.id);
    expect(ids).not.toContain(other.id);
    expect(ids).toHaveLength(5);
  });

  it("2.7.2 ansatt i Byggcon ser ingen testoppdrag og får nei på getAssignment", async () => {
    await runSeed(env);
    await runSampleSeed(env, TEST_NOW);
    const orgId = await sampleOrgId();
    const byggcon = await byggconId();
    const byggconInspector = await createUser({
      name: "Oppdiktet Byggcon-takstmann",
      email: "byggcon-takstmann@example.invalid",
    });
    await createEmployee(byggconInspector, byggcon, ["inspector"]);
    const ids = [...(await sampleAssignments(orgId)).values()].map((row) => row.assignment_id);

    for (const status of ["ordered", "in_progress", "completed", "invoiced"] as const) {
      const queue = await listWorkQueue(byggconInspector, byggcon, {
        status,
        mineOnly: false,
        query: "",
      });
      for (const item of queue.items) expect(ids).not.toContain(item.id);
    }
    for (const id of ids) {
      await expect(getAssignment(byggconInspector, orgId, id)).rejects.toBeInstanceOf(
        AccessDeniedError,
      );
      // Fremmed id i egen organisasjon: ikke funnet, aldri databasefeil og aldri data.
      await expect(getAssignment(byggconInspector, byggcon, id)).rejects.toBeInstanceOf(
        AccessDeniedError,
      );
    }
  });

  it("2.7.3 en ordre i Byggcon med samme external_ref røres ikke og stopper ikke steget", async () => {
    await runSeed(env);
    const byggcon = await byggconId();
    const byggconOrder = await createOrder(byggcon, { externalRef: "sample:holiday-home" });
    const [before] = await rows<{ updated_at: string; status: string }>(
      sql`select updated_at::text as updated_at, status from orders where id = ${byggconOrder.id}`,
    );
    const byggconEvents = await count(
      sql`select count(*)::int as n from events where organization_id = ${byggcon}`,
    );

    await runSampleSeed(env, TEST_NOW);
    await runSampleSeed(env, TEST_NOW);

    const orgId = await sampleOrgId();
    const holiday = (await sampleAssignments(orgId)).get("sample:holiday-home");
    expect(holiday?.order_status, "fritidsboligen er laget i prøveorganisasjonen").toBe(
      "converted",
    );
    expect(holiday?.order_id).not.toBe(byggconOrder.id);
    const [after] = await rows<{ updated_at: string; status: string; organization_id: string }>(
      sql`select updated_at::text as updated_at, status, organization_id from orders where id = ${byggconOrder.id}`,
    );
    expect(after).toEqual({ ...before, organization_id: byggcon });
    expect(after!.status).toBe("received");
    expect(
      await count(sql`select count(*)::int as n from events where organization_id = ${byggcon}`),
    ).toBe(byggconEvents);
  });

  it("2.7.4 alle rader steget lager er i prøveorganisasjonen, og koblingene peker innenfor den", async () => {
    await runSeed(env);
    const byggcon = await byggconId();
    const totalBefore = await countRows();
    const byggconBefore = await countRows(byggcon);
    await runSampleSeed(env, TEST_NOW);
    const orgId = await sampleOrgId();
    const totalAfter = await countRows();
    const sampleCounts = await countRows(orgId);
    for (const table of ORG_TABLES) {
      expect(totalAfter[table]! - totalBefore[table]!, `${table}: nye rader er i prøveorg.`).toBe(
        sampleCounts[table],
      );
    }
    expect(await countRows(byggcon)).toEqual(byggconBefore);

    const mismatches: [string, ReturnType<typeof sql>][] = [
      [
        "orders.assignment_id",
        sql`select count(*)::int as n from orders c join assignments p on p.id = c.assignment_id where c.organization_id <> p.organization_id`,
      ],
      [
        "assignments.order_id",
        sql`select count(*)::int as n from assignments c join orders p on p.id = c.order_id where c.organization_id <> p.organization_id`,
      ],
      [
        "assignments.office_id",
        sql`select count(*)::int as n from assignments c join offices p on p.id = c.office_id where c.organization_id <> p.organization_id`,
      ],
      [
        "assignments.company_id",
        sql`select count(*)::int as n from assignments c join companies p on p.id = c.company_id where c.organization_id <> p.organization_id`,
      ],
      [
        "assignments.property_id",
        sql`select count(*)::int as n from assignments c join properties p on p.id = c.property_id where c.organization_id <> p.organization_id`,
      ],
      [
        "cadastral_units.property_id",
        sql`select count(*)::int as n from cadastral_units c join properties p on p.id = c.property_id where c.organization_id <> p.organization_id`,
      ],
      [
        "common_areas.assignment_id",
        sql`select count(*)::int as n from common_areas c join assignments p on p.id = c.assignment_id where c.organization_id <> p.organization_id`,
      ],
      [
        "assignment_team_members.assignment_id",
        sql`select count(*)::int as n from assignment_team_members c join assignments p on p.id = c.assignment_id where c.organization_id <> p.organization_id`,
      ],
      [
        "assignment_team_members.employee_id",
        sql`select count(*)::int as n from assignment_team_members c join employees p on p.id = c.employee_id where c.organization_id <> p.organization_id`,
      ],
      [
        "assignment_parties.assignment_id",
        sql`select count(*)::int as n from assignment_parties c join assignments p on p.id = c.assignment_id where c.organization_id <> p.organization_id`,
      ],
      [
        "report_buildings.assignment_id",
        sql`select count(*)::int as n from report_buildings c join assignments p on p.id = c.assignment_id where c.organization_id <> p.organization_id`,
      ],
      [
        "floors.report_building_id",
        sql`select count(*)::int as n from floors c join report_buildings p on p.id = c.report_building_id where c.organization_id <> p.organization_id`,
      ],
      [
        "floor_areas.floor_id",
        sql`select count(*)::int as n from floor_areas c join floors p on p.id = c.floor_id where c.organization_id <> p.organization_id`,
      ],
      [
        "floor_areas.measured_by",
        sql`select count(*)::int as n from floor_areas c join employees p on p.id = c.measured_by where c.organization_id <> p.organization_id`,
      ],
      [
        "rooms.floor_id",
        sql`select count(*)::int as n from rooms c join floors p on p.id = c.floor_id where c.organization_id <> p.organization_id`,
      ],
      [
        "events.assignment_id",
        sql`select count(*)::int as n from events c join assignments p on p.id = c.assignment_id where c.organization_id <> p.organization_id`,
      ],
      [
        "employees.company_id",
        sql`select count(*)::int as n from employees c join companies p on p.id = c.company_id where c.organization_id <> p.organization_id`,
      ],
      [
        "employees.office_id",
        sql`select count(*)::int as n from employees c join offices p on p.id = c.office_id where c.organization_id <> p.organization_id`,
      ],
      [
        "employee_roles.employee_id",
        sql`select count(*)::int as n from employee_roles c join employees p on p.id = c.employee_id where c.organization_id <> p.organization_id`,
      ],
      [
        "audit_log.actor_employee_id",
        sql`select count(*)::int as n from audit_log c join employees p on p.id = c.actor_employee_id where c.organization_id <> p.organization_id`,
      ],
      [
        "created_by (oppdrag)",
        sql`select count(*)::int as n from assignments c join employees p on p.id::text = c.created_by where c.organization_id <> p.organization_id`,
      ],
    ];
    for (const [name, query] of mismatches) expect(await count(query), name).toBe(0);
  });
});

describe("seed-steget for testoppdragene: myk sletting (2.8)", () => {
  beforeEach(async () => {
    await runSeed(env);
  });

  it("2.8.1 steget setter aldri deleted_at, heller ikke ved andre kjøring", async () => {
    await runSampleSeed(env, TEST_NOW);
    await runSampleSeed(env, TEST_NOW);
    const orgId = await sampleOrgId();
    for (const table of ORG_TABLES_WITH_TIMESTAMPS) {
      const deleted = await count(sql`select count(*)::int as n from ${sql.identifier(table)}
        where organization_id = ${orgId} and deleted_at is not null`);
      expect(deleted, `${table}: deleted_at`).toBe(0);
    }
    expect(
      await count(sql`select count(*)::int as n from organizations where deleted_at is not null`),
    ).toBe(0);
  });

  it("2.8.1 etter kansellering: bare radene kanselleringen selv slettet mykt, ingen nye", async () => {
    await runSampleSeed(env, TEST_NOW);
    const orgId = await sampleOrgId();
    const coop = (await sampleAssignments(orgId)).get("sample:apartment-cooperative")!;
    await cancelAssignment(await adminActor(), orgId, coop.assignment_id, {
      expectedStatus: coop.status as AssignmentStatus,
      reason: "Kansellert i testen",
      now: TEST_NOW,
    });
    const deletedAfterCancel = async () => {
      const out: Record<string, string[]> = {};
      for (const table of ORG_TABLES_WITH_TIMESTAMPS) {
        const found = await rows<{
          id: string;
        }>(sql`select id::text as id from ${sql.identifier(table)}
          where organization_id = ${orgId} and deleted_at is not null order by id`);
        out[table] = found.map((row) => row.id);
      }
      return out;
    };
    const before = await deletedAfterCancel();
    expect(before.assignments).toEqual([coop.assignment_id]);
    await runSampleSeed(env, TEST_NOW);
    expect(await deletedAfterCancel()).toEqual(before);
  });

  it("2.8.2 kildeteksten sletter aldri og setter aldri deleted_at", () => {
    for (const file of ["src/db/seed/sample-assignments.ts", "src/db/seed/sample-index.ts"]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source, file).not.toMatch(/\bdb\.delete\b/);
      expect(source, file).not.toMatch(/\btx\.delete\b/);
      expect(source, file).not.toMatch(/DELETE\s+FROM/i);
      expect(source, file).not.toMatch(/deletedAt\s*:/);
      expect(source, file).not.toMatch(/deleted_at/);
      expect(source, file).not.toMatch(/\bcancelAssignment\b/);
      expect(source, file).not.toMatch(/\btruncate\b/i);
    }
  });
});

describe("seed-steget for testoppdragene: loggen (2.9)", () => {
  beforeEach(async () => {
    await runSeed(env);
  });

  it("2.9.1 ingen e-postadresse og ingen navn i loggen", async () => {
    const first = await runAndLog();
    const second = await runAndLog();
    const names = [
      SAMPLE_INSPECTOR.name,
      env.SEED_ADMIN_NAME,
      ...samples.flatMap((sample) => sample.parties.map((party) => party.name)),
    ];
    expect(first.length, "første kjøring logger noe").toBeGreaterThan(0);
    for (const line of [...first, ...second]) {
      expect(line).not.toContain("@");
      for (const name of names) expect(line, "navn i loggen").not.toContain(name);
    }
  });

  it("2.9.2 sammendraget sier «laget» først og «finnes fra før» eller «hoppet over» etterpå, per testoppdrag", async () => {
    const first = await runAndLog();
    const second = await runAndLog();
    for (const ref of REFS) {
      expect(
        first.some((line) => line.includes(ref) && /laget/i.test(line)),
        `første kjøring: ${ref} laget`,
      ).toBe(true);
      expect(
        second.some((line) => line.includes(ref) && /finnes fra før|hoppet over/i.test(line)),
        `andre kjøring: ${ref} finnes fra før`,
      ).toBe(true);
      expect(
        second.some(
          (line) =>
            line.includes(ref) &&
            /\blaget\b/i.test(line) &&
            !/finnes fra før|hoppet over/i.test(line),
        ),
        `andre kjøring: ${ref} er ikke laget på nytt`,
      ).toBe(false);
    }
  });
});
