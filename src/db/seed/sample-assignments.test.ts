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
import { AI_ENABLED_SETTING_KEY, requestSuggestion as requestSuggestionService } from "@/core/ai";
import { createOrder as createOrderService } from "@/core/orders";
import { findEmployeeGrant } from "@/core/organization";
import {
  TemplateNotFoundError,
  createDraftVersion,
  createTemplateFamily,
  getTemplateVersion,
  isSameTemplateContent,
  listTemplateFamilies,
  parseTemplateDocument,
  type TemplateDocumentInput,
} from "@/core/templates";
import { db } from "@/db/client";
import { brand } from "@/shared/config/brand";
import {
  TEST_NOW,
  activeAdminCount,
  createEmployee,
  createIntegrationConnection,
  createOffice,
  createOrder,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import {
  mergeOrganizationSettings,
  removeOrganizationSetting,
  requestSuggestion,
  validRequest,
} from "../../../tests/ai";
import { runSeed } from "./run";
import {
  ensureSampleAi,
  ensureSampleTemplate,
  findSampleOrders,
  prepareSampleSeed,
  runSampleSeed,
} from "./sample-assignments";
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
  // Systemmalen med badet (fase2a-mal-bad-testplan.md 3.9)
  "template_families",
  "template_versions",
  "template_sections",
  "template_elements",
  "template_element_options",
  "checkpoints",
  "deviation_questions",
  "outcomes",
  "standard_measures",
  "rules",
  "rule_conditions",
  "rule_test_cases",
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

/*
 * KI med den falske leverandøren i prøveorganisasjonen (docs/funksjoner/fase2a-ki-modul-logg-testplan.md
 * avsnitt 13, kortet Omfang 8, A160). Seed slår på `ai.enabled` og lager én `fake`-tilkobling bare
 * i organisasjonen med `sampleData`, bare når det mangler, og endrer aldri noe som finnes.
 *
 * Støtter hovedmål: de ansatte (KI kan prøves i testmiljøet uten kostnad) og KI i bunnen (én vei:
 * leverandøren kommer fra tilkoblingen, aldri fra miljøet). Byggcon får aldri KI av seed.
 */
type AiConnectionRow = {
  id: string;
  provider: string;
  status: string;
  deleted_at: string | null;
  row_version: number;
  updated_at: string;
};

async function aiConnections(organizationId: string): Promise<AiConnectionRow[]> {
  return rows<AiConnectionRow>(sql`
    select id, provider, status, deleted_at::text as deleted_at, row_version, updated_at::text as updated_at
    from integration_connections where organization_id = ${organizationId} and port = 'ai'
    order by created_at, id`);
}

async function settingsOf(organizationId: string): Promise<Loose> {
  const [row] = await rows<{ settings: Loose }>(
    sql`select settings from organizations where id = ${organizationId}`,
  );
  return row!.settings;
}

describe("seed-steget for testoppdragene: KI med fake i prøveorganisasjonen (13)", () => {
  beforeEach(async () => {
    await runSeed(env);
  });

  it("13.1 første kjøring: ai.enabled = true og én aktiv fake-tilkobling på porten ai", async () => {
    await runSampleSeed(env, TEST_NOW);
    const orgId = await sampleOrgId();
    const settings = await settingsOf(orgId);
    expect(settings["ai.enabled"]).toBe(true);
    expect(settings.sampleData).toBe(true);
    const connections = await aiConnections(orgId);
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({ provider: "fake", status: "active", deleted_at: null });
  });

  it("13.2 andre kjøring: ingen ny rad, ingen endring, samme settings", async () => {
    await runSampleSeed(env, TEST_NOW);
    const orgId = await sampleOrgId();
    const connectionsBefore = await aiConnections(orgId);
    const settingsBefore = await settingsOf(orgId);

    await runSampleSeed(env, TEST_NOW);

    expect(await aiConnections(orgId)).toEqual(connectionsBefore);
    expect(await settingsOf(orgId)).toEqual(settingsBefore);
  });

  it("13.3 admin har satt ai.enabled = false: seed slår det ikke på igjen", async () => {
    await runSampleSeed(env, TEST_NOW);
    const orgId = await sampleOrgId();
    await mergeOrganizationSettings(orgId, { "ai.enabled": false });

    await runSampleSeed(env, TEST_NOW);

    expect((await settingsOf(orgId))["ai.enabled"]).toBe(false);
  });

  it.each([
    { name: "deaktivert rad (status disabled)", change: sql`status = 'disabled'` },
    { name: "mykt slettet rad", change: sql`deleted_at = now(), deleted_by = 'oppdiktet-admin'` },
    { name: "rad med annen leverandørkode (13.5)", change: sql`provider = 'openai'` },
  ])(
    "13.4 $name på porten ai: ingen ny rad, og raden som finnes, endres ikke",
    async ({ change }) => {
      await runSampleSeed(env, TEST_NOW);
      const orgId = await sampleOrgId();
      const [existing] = await aiConnections(orgId);
      await db.execute(
        sql`update integration_connections set ${change} where id = ${existing!.id}`,
      );
      const before = await aiConnections(orgId);

      await runSampleSeed(env, TEST_NOW);

      expect(await aiConnections(orgId)).toEqual(before);
      expect(before).toHaveLength(1);
    },
  );

  it("13.6 andre nøkler i settings er uendret; ai.enabled settes bare når nøkkelen mangler", async () => {
    await runSampleSeed(env, TEST_NOW);
    const orgId = await sampleOrgId();
    await removeOrganizationSetting(orgId, "ai.enabled");
    await mergeOrganizationSettings(orgId, {
      "access.inspectors_edit_all": false,
      "oppdiktet.nokkel": { verdi: 7 },
    });
    const before = await settingsOf(orgId);
    expect(before["ai.enabled"]).toBeUndefined();

    await runSampleSeed(env, TEST_NOW);

    const after = await settingsOf(orgId);
    expect(after).toEqual({ ...before, "ai.enabled": true });
    expect(after["access.inspectors_edit_all"]).toBe(false);
    expect(after.sampleData).toBe(true);
    expect(after["oppdiktet.nokkel"]).toEqual({ verdi: 7 });
  });

  it("13.7 Byggcon og en organisasjon uten sampleData får verken ai.enabled eller tilkobling", async () => {
    const other = await rows<{ id: string }>(
      sql`insert into organizations (name, brand_name, settings) values ('Oppdiktet Takst Annen', 'Oppdiktet Takst Annen', '{}'::jsonb) returning id`,
    );
    await runSampleSeed(env, TEST_NOW);
    await runSampleSeed(env, TEST_NOW);
    for (const orgId of [await byggconId(), other[0]!.id]) {
      expect((await settingsOf(orgId))["ai.enabled"]).toBeUndefined();
      expect(await aiConnections(orgId)).toEqual([]);
    }
  });

  it("13.7 pnpm db:seed (runSeed) rører ikke KI", async () => {
    await runSeed(env);
    const byggcon = await byggconId();
    expect((await settingsOf(byggcon))["ai.enabled"]).toBeUndefined();
    expect(
      await count(sql`select count(*)::int as n from integration_connections where port = 'ai'`),
    ).toBe(0);
  });

  it("13.8 etter seed gir requestSuggestion for prøvetakstmannen et forslag", async () => {
    await runSampleSeed(env, TEST_NOW);
    const orgId = await sampleOrgId();
    const grant = await requireOrganizationAccess(await inspectorActor(), orgId);
    const result = await requestSuggestion(grant, validRequest());
    expect(result.kind).toBe("suggestion");
  });

  it("13.8 Byggcon-admin får disabled etter seed (KI er ikke slått på i Byggcon)", async () => {
    await runSampleSeed(env, TEST_NOW);
    const grant = await requireOrganizationAccess(await adminActor(), await byggconId());
    expect(await requestSuggestion(grant, validRequest())).toEqual({ kind: "disabled" });
  });
});

// ---------------------------------------------------------------------------------------------
// KI med den falske leverandøren i prøveorganisasjonen
// (docs/funksjoner/fase2a-ki-modul-logg-testplan.md avsnitt 13, A160)
// ---------------------------------------------------------------------------------------------

type DevAiConnectionRow = {
  id: string;
  provider: string;
  status: string;
  row_version: number;
  updated_at: string;
  deleted_at: string | null;
};

async function devAiConnections(organizationId: string): Promise<DevAiConnectionRow[]> {
  return rows<DevAiConnectionRow>(sql`
    select id::text as id, provider, status, row_version, updated_at::text as updated_at,
      deleted_at::text as deleted_at
    from integration_connections where organization_id = ${organizationId} and port = 'ai'
    order by created_at, id`);
}

async function devSettingsOf(organizationId: string): Promise<Loose> {
  const [row] = await rows<{ settings: Loose }>(
    sql`select settings from organizations where id = ${organizationId}`,
  );
  return row!.settings;
}

/** Prøveorganisasjonen med admin, laget før steget, slik at testen kan legge inn rader først. */
async function devPreparedSampleOrg(settings: Loose = { sampleData: true }): Promise<string> {
  const [org] = await rows<{ id: string }>(sql`
    insert into organizations (name, brand_name, settings)
    values (${SAMPLE_ORG}, ${SAMPLE_ORG}, ${JSON.stringify(settings)}::jsonb)
    returning id`);
  await createEmployee(await adminActor(), org!.id, ["admin"]);
  return org!.id;
}

describe("seed-steget for testoppdragene: KI med falsk leverandør, utviklerens tester (13)", () => {
  beforeEach(async () => {
    await runSeed(env);
  });

  it("13.1 første kjøring: ai.enabled = true og én aktiv tilkobling med fake", async () => {
    await runSampleSeed(env, TEST_NOW);
    const orgId = await sampleOrgId();
    expect((await devSettingsOf(orgId))[AI_ENABLED_SETTING_KEY]).toBe(true);
    const connections = await devAiConnections(orgId);
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({ provider: "fake", status: "active", deleted_at: null });
  });

  it("13.1 tilkoblingen er laget med tjenesten: linje i revisjonsloggen uten verdier", async () => {
    await runSampleSeed(env, TEST_NOW);
    const orgId = await sampleOrgId();
    const [connection] = await devAiConnections(orgId);
    const audit = await rows<{ action: string; changes: Loose }>(sql`
      select action, changes from audit_log
      where organization_id = ${orgId} and entity_type = 'integration_connection'
        and entity_id = ${connection!.id}`);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe("create");
    expect(audit[0]!.changes).toMatchObject({ port: "ai", provider: "fake", secretRef: null });
  });

  it("13.2 andre kjøring: ingen ny rad, raden og settings er uendret", async () => {
    await runSampleSeed(env, TEST_NOW);
    const orgId = await sampleOrgId();
    const connectionsBefore = await devAiConnections(orgId);
    const settingsBefore = await devSettingsOf(orgId);
    const [orgBefore] = await organizationsNamed(SAMPLE_ORG);
    await runSampleSeed(env, TEST_NOW);
    expect(await devAiConnections(orgId)).toEqual(connectionsBefore);
    expect(await devSettingsOf(orgId)).toEqual(settingsBefore);
    const [orgAfter] = await organizationsNamed(SAMPLE_ORG);
    expect(orgAfter!.updated_at).toBe(orgBefore!.updated_at);
  });

  it("13.3 admin har satt ai.enabled = false: seed slår det ikke på igjen", async () => {
    await runSampleSeed(env, TEST_NOW);
    const orgId = await sampleOrgId();
    await db.execute(sql`update organizations
      set settings = settings || ${JSON.stringify({ [AI_ENABLED_SETTING_KEY]: false })}::jsonb
      where id = ${orgId}`);
    await runSampleSeed(env, TEST_NOW);
    expect((await devSettingsOf(orgId))[AI_ENABLED_SETTING_KEY]).toBe(false);
  });

  it.each([
    ["deaktivert", { status: "disabled" }],
    ["med feil", { status: "error" }],
    ["mykt slettet", { deletedAt: TEST_NOW, deletedBy: "test" }],
    ["med annen leverandørkode", { provider: "other_vendor" }],
  ] as const)(
    "13.4–13.5 rad %s på porten ai: ingen ny rad, og raden er urørt",
    async (_, extra) => {
      const orgId = await devPreparedSampleOrg();
      const existing = await createIntegrationConnection(orgId, {
        port: "ai",
        provider: "fake",
        ...extra,
      });
      const before = await devAiConnections(orgId);
      await runSampleSeed(env, TEST_NOW);
      const after = await devAiConnections(orgId);
      expect(after).toEqual(before);
      expect(after.map((row) => row.id)).toEqual([existing.id]);
    },
  );

  it("13.6 andre nøkler i settings er uendret", async () => {
    const others = {
      sampleData: true,
      "access.inspectors_edit_all": false,
      "test.oppdiktet_nokkel": { verdi: 7 },
    };
    const orgId = await devPreparedSampleOrg(others);
    await runSampleSeed(env, TEST_NOW);
    expect(await devSettingsOf(orgId)).toEqual({ ...others, [AI_ENABLED_SETTING_KEY]: true });
  });

  it("13.6 en ugyldig verdi i ai.enabled (tekst) står urørt", async () => {
    const orgId = await devPreparedSampleOrg({ sampleData: true, [AI_ENABLED_SETTING_KEY]: "ja" });
    await runSampleSeed(env, TEST_NOW);
    expect((await devSettingsOf(orgId))[AI_ENABLED_SETTING_KEY]).toBe("ja");
  });

  it("13.7 Byggcon og en organisasjon uten sampleData får verken ai.enabled eller tilkobling", async () => {
    const other = await createOrganization("Annen organisasjon");
    await runSampleSeed(env, TEST_NOW);
    await runSeed(env);
    await runSampleSeed(env, TEST_NOW);
    for (const orgId of [await byggconId(), other.id]) {
      expect(await devSettingsOf(orgId)).not.toHaveProperty(AI_ENABLED_SETTING_KEY);
      expect(await devAiConnections(orgId)).toEqual([]);
    }
    expect(
      await count(sql`select count(*)::int as n from integration_connections where port = 'ai'`),
    ).toBe(1);
  });

  it("13.8 etter seed gir requestSuggestion et forslag for prøvetakstmannen", async () => {
    await runSampleSeed(env, TEST_NOW);
    const orgId = await sampleOrgId();
    const grant = await requireOrganizationAccess(await inspectorActor(), orgId, "report.edit");
    const result = await requestSuggestionService(grant, {
      requestId: crypto.randomUUID(),
      feature: "language_polish",
      assignmentId: null,
      reportId: null,
      target: { type: "answer", id: crypto.randomUUID(), fieldKey: "text" },
      fields: { text: "taket har noen sprekker i takstein ved mønet" },
    });
    expect(result.kind).toBe("suggestion");
    expect(
      await count(sql`select count(*)::int as n from ai_usage_log
        where organization_id = ${orgId} and provider = 'fake' and model = 'fake-v1'`),
    ).toBe(1);
  });

  it("13.9 loggen sier om KI ble slått på, uten e-post og navn", async () => {
    const first = await runAndLog();
    const second = await runAndLog();
    expect(first.some((line) => /KI på/.test(line) && /\blaget\b/.test(line))).toBe(true);
    const aiLine = second.find((line) => /KI på/.test(line));
    expect(aiLine).toMatch(/finnes fra før.*finnes fra før/);
    for (const line of [...first, ...second]) expect(line).not.toContain("@");
  });

  it("13.10 tenant-isolasjon: ensureSampleAi leser og skriver bare i egen organisasjon", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        // Begge har merket. A har en deaktivert rad, B en aktiv: ingen av dem får ny rad
        await mergeOrganizationSettings(grantA.organizationId, { sampleData: true });
        await mergeOrganizationSettings(grantB.organizationId, { sampleData: true });
        const a = await createIntegrationConnection(grantA.organizationId, {
          port: "ai",
          provider: "fake",
          status: "disabled",
        });
        const b = await createIntegrationConnection(grantB.organizationId, {
          port: "ai",
          provider: "fake",
        });
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
        await ensureSampleAi({
          actor,
          organizationId: grant.organizationId,
          officeId: "",
          inspectorEmployeeId: "",
          now: TEST_NOW,
        });
        return devAiConnections(grant.organizationId);
      },
      idOf: (row: DevAiConnectionRow) => row.id,
    });
  });

  it("13.10 en rad på porten ai i en annen organisasjon hindrer ikke at egen organisasjon får fake", async () => {
    const actor = await createUser({ name: "Admin Test" });
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    await mergeOrganizationSettings(orgA.id, { sampleData: true });
    await mergeOrganizationSettings(orgB.id, { sampleData: true });
    await createEmployee(actor, orgB.id, ["admin"]);
    const other = await createIntegrationConnection(orgA.id, {
      port: "ai",
      provider: "fake",
      status: "disabled",
    });
    const before = await devAiConnections(orgA.id);
    const result = await ensureSampleAi({
      actor,
      organizationId: orgB.id,
      officeId: "",
      inspectorEmployeeId: "",
      now: TEST_NOW,
    });
    expect(result).toEqual({ setting: "created", connection: "created" });
    expect(await devAiConnections(orgA.id)).toEqual(before);
    expect(before.map((row) => row.id)).toEqual([other.id]);
    expect(await devSettingsOf(orgA.id)).not.toHaveProperty(AI_ENABLED_SETTING_KEY);
    expect(await devAiConnections(orgB.id)).toHaveLength(1);
  });
});

/*
 * `ensureSampleAi` sjekker merket selv (docs/funksjoner/fase2a-forslagsmonster-testplan.md
 * avsnitt 9, kortet Omfang 7): `settings.sampleData = true` står i samme spørring som
 * oppdateringen, og tilkoblingen lages ikke uten merket. Kalt direkte, uten `prepareSampleSeed`.
 *
 * Støtter hovedmål: færre reklamasjoner og KI i bunnen (KI slås aldri på ved en feil i en ekte
 * organisasjon, heller ikke om steget kalles fra et annet sted).
 */
describe("ensureSampleAi sjekker merket selv (9)", () => {
  async function directContext(settings: Loose) {
    const actor = await createUser({ name: "Admin Test" });
    const organization = await createOrganization("Oppdiktet Takst Direkte");
    await db.execute(
      sql`update organizations set settings = ${JSON.stringify(settings)}::jsonb where id = ${organization.id}`,
    );
    await createEmployee(actor, organization.id, ["admin"]);
    return {
      organizationId: organization.id,
      context: {
        actor,
        organizationId: organization.id,
        officeId: "",
        inspectorEmployeeId: "",
        now: TEST_NOW,
      },
    };
  }

  async function organizationRow(organizationId: string) {
    const [row] = await rows<{ settings: Loose; updated_at: string }>(sql`
      select settings, updated_at::text as updated_at from organizations where id = ${organizationId}`);
    return row!;
  }

  it.each([
    { name: "nøkkelen mangler", settings: {} },
    { name: "false", settings: { sampleData: false } },
    { name: 'strengen "true"', settings: { sampleData: "true" } },
    { name: "tallet 1", settings: { sampleData: 1 } },
  ])(
    "9.1 uten merket ($name): settings og updated_at uendret, ingen tilkobling",
    async ({ settings }) => {
      const { organizationId, context } = await directContext(settings);
      const before = await organizationRow(organizationId);

      const result = await ensureSampleAi(context);

      expect(result).toEqual({ setting: "skipped", connection: "skipped" });
      expect(await organizationRow(organizationId)).toEqual(before);
      expect(await devAiConnections(organizationId)).toEqual([]);
    },
  );

  it("9.2 med merket: ai.enabled = true og én fake-tilkobling", async () => {
    const { organizationId, context } = await directContext({ sampleData: true });
    expect(await ensureSampleAi(context)).toEqual({ setting: "created", connection: "created" });
    expect((await devSettingsOf(organizationId))[AI_ENABLED_SETTING_KEY]).toBe(true);
    const connections = await devAiConnections(organizationId);
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({ provider: "fake", status: "active", deleted_at: null });
  });

  it("9.3 to kall gir samme resultat: samme settings, én tilkobling med samme row_version", async () => {
    const { organizationId, context } = await directContext({ sampleData: true });
    await ensureSampleAi(context);
    const orgBefore = await organizationRow(organizationId);
    const connectionsBefore = await devAiConnections(organizationId);

    expect(await ensureSampleAi(context)).toEqual({ setting: "existing", connection: "existing" });

    expect(await organizationRow(organizationId)).toEqual(orgBefore);
    expect(await devAiConnections(organizationId)).toEqual(connectionsBefore);
    expect(connectionsBefore).toHaveLength(1);
  });

  it("9.4 merket fjernes etter at konteksten er laget: ingenting endres, ingen tilkobling", async () => {
    const { organizationId, context } = await directContext({ sampleData: true, annen: "verdi" });
    await removeOrganizationSetting(organizationId, "sampleData");
    const before = await organizationRow(organizationId);

    expect(await ensureSampleAi(context)).toEqual({ setting: "skipped", connection: "skipped" });

    expect(await organizationRow(organizationId)).toEqual(before);
    expect(await devAiConnections(organizationId)).toEqual([]);
    expect(
      await count(sql`select count(*)::int as n from audit_log
        where organization_id = ${organizationId} and entity_type = 'integration_connection'`),
    ).toBe(0);
  });

  it("9.4 kildeteksten: merket står i where for oppdateringen og i spørringen før tilkoblingen", () => {
    const source = readFileSync(join(__dirname, "sample-assignments.ts"), "utf8");
    const start = source.indexOf("export async function ensureSampleAi");
    const body = source.slice(start, source.indexOf("\n}\n", start));
    expect(body.match(/IS_SAMPLE_ORGANIZATION/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toMatch(/IS_SAMPLE_ORGANIZATION = sql`[^`]*'sampleData' = 'true'::jsonb`/);
  });

  it("9.5 Byggcon etter pnpm db:seed: ensureSampleAi direkte gir verken ai.enabled eller tilkobling", async () => {
    await runSeed(env);
    const byggcon = await byggconId();
    const before = await organizationRow(byggcon);
    const result = await ensureSampleAi({
      actor: await adminActor(),
      organizationId: byggcon,
      officeId: "",
      inspectorEmployeeId: "",
      now: TEST_NOW,
    });
    expect(result).toEqual({ setting: "skipped", connection: "skipped" });
    expect(await organizationRow(byggcon)).toEqual(before);
    expect(await devAiConnections(byggcon)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Systemmalen med badet i prøveorganisasjonen (docs/funksjoner/fase2a-mal-bad-testplan.md avsnitt 3)
//
// Støtter hovedmål: de ansatte (badet finnes på testoppdragene, så regler, skjerm og PDF kan
// prøves), KI i bunnen (samme faste koder hver gang) og færre reklamasjoner (publiserte versjoner
// endres aldri, og tekstene er merket utkast til fagrådet har godkjent dem). Byggcon er urørt.
// ---------------------------------------------------------------------------------------------

const TEMPLATE_FAMILY_NAME = "Tilstandsrapport bolig";

/** Malfilen lastes dynamisk, så resten av filen kjører selv om den mangler. */
async function wetRoomDocument(): Promise<TemplateDocumentInput> {
  const { wetRoomTemplate } = await import("./templates/wet-room");
  return wetRoomTemplate;
}

async function parsedWetRoom() {
  const result = parseTemplateDocument(await wetRoomDocument());
  if (!result.success) throw new Error(`malen for badet er ugyldig: ${result.issues.length} feil`);
  return result.document;
}

async function sampleFamilies() {
  const orgId = await sampleOrgId();
  return listTemplateFamilies(await adminActor(), orgId);
}

const TEMPLATE_TABLES = [
  "template_families",
  "template_versions",
  "template_sections",
  "template_elements",
  "template_element_options",
  "checkpoints",
  "deviation_questions",
  "outcomes",
  "standard_measures",
  "rules",
  "rule_conditions",
  "rule_test_cases",
] as const;

/** Antall rader i alle maltabellene i organisasjonen (også slettede). */
async function templateRowCount(organizationId: string): Promise<number> {
  let total = 0;
  for (const table of TEMPLATE_TABLES) {
    total += await count(
      sql`select count(*)::int as n from ${sql.identifier(table)} where organization_id = ${organizationId}`,
    );
  }
  return total;
}

type TextRow = { id: string; text_status: string; deleted_at: string | null };

/** Utfall og tiltak (aktive og slettede) i én versjon, med tekststatus og slettemerke. */
async function textRowsOfVersion(versionId: string) {
  const outcomes = await rows<TextRow>(sql`
    select o.id, o.text_status, o.deleted_at::text as deleted_at from outcomes o
    join deviation_questions q on q.id = o.deviation_question_id
    join checkpoints c on c.id = q.checkpoint_id where c.version_id = ${versionId} order by o.id`);
  const measures = await rows<TextRow>(sql`
    select m.id, m.text_status, m.deleted_at::text as deleted_at from standard_measures m
    join outcomes o on o.id = m.outcome_id
    join deviation_questions q on q.id = o.deviation_question_id
    join checkpoints c on c.id = q.checkpoint_id where c.version_id = ${versionId} order by m.id`);
  return { outcomes, measures };
}

async function auditCount(organizationId: string): Promise<number> {
  return count(
    sql`select count(*)::int as n from audit_log where organization_id = ${organizationId}`,
  );
}

async function eventCount(organizationId: string): Promise<number> {
  return count(
    sql`select count(*)::int as n from events where organization_id = ${organizationId}`,
  );
}

const CHANGED_DEVIATION = "Oppdiktet endret avvikstekst for testen.";

async function changedWetRoom(): Promise<TemplateDocumentInput> {
  const changed = structuredClone(await wetRoomDocument());
  changed.outcomes![0]!.deviation_text = CHANGED_DEVIATION;
  return changed;
}

describe("seed-steget: systemmalen med badet (mal for bad 3)", () => {
  beforeEach(async () => {
    await runSeed(env);
  });

  it("3.1 seed_creates_published_v1: én familie, én publisert versjon, åtte punkter, alt utkast", async () => {
    const summary = await runSampleSeed(env, TEST_NOW);
    expect((summary as unknown as { template?: unknown }).template).toBe("created");
    const families = await sampleFamilies();
    expect(families).toHaveLength(1);
    const family = families[0]!;
    expect(family).toMatchObject({
      name: TEMPLATE_FAMILY_NAME,
      kind: "system",
      reportType: "condition_report",
    });
    expect(family.versions.map((v) => [v.versionNumber, v.status])).toEqual([[1, "published"]]);

    const orgId = await sampleOrgId();
    const { document } = await getTemplateVersion(
      await adminActor(),
      orgId,
      family.versions[0]!.id,
    );
    expect(document.checkpoints).toHaveLength(8);

    const statuses = await rows<{ t: string; text_status: string; n: number }>(sql`
      select 'outcomes' as t, text_status, count(*)::int as n from outcomes
        where organization_id = ${orgId} group by text_status
      union all
      select 'standard_measures' as t, text_status, count(*)::int as n from standard_measures
        where organization_id = ${orgId} group by text_status`);
    for (const row of statuses) expect(row.text_status, row.t).toBe("draft");
    expect(statuses.map((r) => r.t).sort()).toEqual(["outcomes", "standard_measures"]);
  });

  it("3.2 seed_matches_template_file: innholdet i databasen er det samme som malfilen", async () => {
    await runSampleSeed(env, TEST_NOW);
    const orgId = await sampleOrgId();
    const [family] = await sampleFamilies();
    const { document } = await getTemplateVersion(
      await adminActor(),
      orgId,
      family!.versions[0]!.id,
    );
    expect(isSameTemplateContent(document, await parsedWetRoom())).toBe(true);
  });

  it("3.3 seed_twice_no_new_version: andre kjøring gir existing, ingen ny versjon, ikke noe utkast, ingen loggrader", async () => {
    await runSampleSeed(env, TEST_NOW);
    const { context } = await prepareSampleSeed(env, TEST_NOW);
    const orgId = context.organizationId;
    const auditBefore = await auditCount(orgId);
    const eventsBefore = await eventCount(orgId);
    const rowsBefore = await templateRowCount(orgId);
    const updatedBefore = await updatedAtSnapshot(orgId);

    await expect(ensureSampleTemplate(context)).resolves.toBe("existing");
    const summary = await runSampleSeed(env, TEST_NOW);
    expect((summary as unknown as { template?: unknown }).template).toBe("existing");

    const families = await sampleFamilies();
    expect(families).toHaveLength(1);
    expect(families[0]!.versions.map((v) => v.status)).toEqual(["published"]);
    expect(await templateRowCount(orgId)).toBe(rowsBefore);
    expect(await auditCount(orgId)).toBe(auditBefore);
    expect(await eventCount(orgId)).toBe(eventsBefore);
    expect(await updatedAtSnapshot(orgId)).toEqual(updatedBefore);
  });

  it("3.4 seed_changed_document_new_version: endret avvikstekst gir v2 published, v1 retired og urørt", async () => {
    await runSampleSeed(env, TEST_NOW);
    const { context } = await prepareSampleSeed(env, TEST_NOW);
    const orgId = context.organizationId;
    const admin = await adminActor();
    const [family] = await sampleFamilies();
    const v1 = family!.versions[0]!.id;
    const v1Document = (await getTemplateVersion(admin, orgId, v1)).document;
    const v1Rows = await textRowsOfVersion(v1);
    const fileBefore = JSON.stringify(await wetRoomDocument());

    await expect(ensureSampleTemplate(context, await changedWetRoom())).resolves.toBe("created");

    const [after] = await sampleFamilies();
    expect(after!.versions.map((v) => [v.versionNumber, v.status])).toEqual([
      [2, "published"],
      [1, "retired"],
    ]);
    const v2 = after!.versions[0]!.id;
    const v2Document = (await getTemplateVersion(admin, orgId, v2)).document;
    expect(JSON.stringify(v2Document)).toContain(CHANGED_DEVIATION);
    // v1 er urørt: samme innhold, samme rader, ingenting slettet
    expect((await getTemplateVersion(admin, orgId, v1)).document).toEqual(v1Document);
    expect(await textRowsOfVersion(v1)).toEqual(v1Rows);
    for (const row of [...v1Rows.outcomes, ...v1Rows.measures]) expect(row.deleted_at).toBeNull();
    // Malfilen er ikke endret av testen
    expect(JSON.stringify(await wetRoomDocument())).toBe(fileBefore);
  });

  it("3.5 seed_existing_draft: utkast med samme innhold står, og seed gir existing uten feil", async () => {
    await runSampleSeed(env, TEST_NOW);
    const { context } = await prepareSampleSeed(env, TEST_NOW);
    const orgId = context.organizationId;
    const [family] = await sampleFamilies();
    const { versionId: draft } = await createDraftVersion(await adminActor(), orgId, family!.id);
    const rowsBefore = await templateRowCount(orgId);

    await expect(ensureSampleTemplate(context)).resolves.toBe("existing");
    const [after] = await sampleFamilies();
    expect(after!.versions.map((v) => [v.id, v.status])).toEqual([
      [draft, "draft"],
      [family!.versions[0]!.id, "published"],
    ]);
    expect(await templateRowCount(orgId)).toBe(rowsBefore);
  });

  it("3.5 seed_existing_draft: utkast og endret innhold bruker utkastet som finnes (ingen v3)", async () => {
    await runSampleSeed(env, TEST_NOW);
    const { context } = await prepareSampleSeed(env, TEST_NOW);
    const orgId = context.organizationId;
    const [family] = await sampleFamilies();
    const v1 = family!.versions[0]!.id;
    const { versionId: draft } = await createDraftVersion(await adminActor(), orgId, family!.id);

    await expect(ensureSampleTemplate(context, await changedWetRoom())).resolves.toBe("created");

    const [after] = await sampleFamilies();
    expect(after!.versions.map((v) => [v.id, v.versionNumber, v.status])).toEqual([
      [draft, 2, "published"],
      [v1, 1, "retired"],
    ]);
  });

  it("3.5 seed_existing_draft: familie med tomt utkast v1 (avbrutt kjøring) publiserer v1", async () => {
    const { context } = await prepareSampleSeed(env, TEST_NOW);
    const orgId = context.organizationId;
    const { familyId, versionId } = await createTemplateFamily(await adminActor(), orgId, {
      name: TEMPLATE_FAMILY_NAME,
      kind: "system",
      report_type: "condition_report",
    });

    await expect(ensureSampleTemplate(context)).resolves.toBe("created");
    const families = await sampleFamilies();
    expect(families.map((f) => f.id)).toEqual([familyId]);
    expect(families[0]!.versions.map((v) => [v.id, v.status])).toEqual([[versionId, "published"]]);
    const { document } = await getTemplateVersion(await adminActor(), orgId, versionId);
    expect(isSameTemplateContent(document, await parsedWetRoom())).toBe(true);
  });

  it.each<{ name: string; settings: Record<string, unknown> | "none" }>([
    { name: "nøkkelen sampleData mangler", settings: "none" },
    { name: "sampleData = false", settings: { sampleData: false } },
    { name: 'sampleData = "true" (tekst)', settings: { sampleData: "true" } },
    { name: "sampleData = 1", settings: { sampleData: 1 } },
  ])("3.6 seed_only_sample_org: $name gir skipped og ingen malrader", async ({ settings }) => {
    const organization = await createOrganization("Oppdiktet Malfirma");
    const value = JSON.stringify(settings === "none" ? {} : settings);
    await db.execute(
      sql`update organizations set settings = ${value}::jsonb where id = ${organization.id}`,
    );
    const admin = await createUser({ name: "Test Admin Mal" });
    await createEmployee(admin, organization.id, ["admin"]);
    const inspector = await createEmployee(
      await createUser({ name: "Test Takstmann Mal" }),
      organization.id,
      ["inspector"],
    );
    const office = await createOffice(organization.id);
    const auditBefore = await auditCount(organization.id);

    await expect(
      ensureSampleTemplate({
        actor: admin,
        organizationId: organization.id,
        officeId: office.id,
        inspectorEmployeeId: inspector.id,
        now: TEST_NOW,
      }),
    ).resolves.toBe("skipped");
    expect(await templateRowCount(organization.id)).toBe(0);
    expect(await auditCount(organization.id)).toBe(auditBefore);
  });

  it("3.6 seed_only_sample_org: Byggcon har ingen malfamilie etter db:seed:testoppdrag, heller ikke kalt direkte", async () => {
    await runSampleSeed(env, TEST_NOW);
    const byggcon = await byggconId();
    expect(await templateRowCount(byggcon)).toBe(0);
    expect(await listTemplateFamilies(await adminActor(), byggcon)).toEqual([]);

    await expect(
      ensureSampleTemplate({
        actor: await adminActor(),
        organizationId: byggcon,
        officeId: "",
        inspectorEmployeeId: "",
        now: TEST_NOW,
      }),
    ).resolves.toBe("skipped");
    expect(await templateRowCount(byggcon)).toBe(0);
  });

  it("3.7 seed_family_not_visible_in_other_org: annen organisasjon ser ingen familie og får nei på versjonen", async () => {
    await runSampleSeed(env, TEST_NOW);
    const orgId = await sampleOrgId();
    const [family] = await sampleFamilies();
    const versionId = family!.versions[0]!.id;

    const other = await createOrganization("Oppdiktet Annet Takstfirma");
    const otherAdmin = await createUser({ name: "Test Admin Annen" });
    await createEmployee(otherAdmin, other.id, ["admin"]);

    expect(await listTemplateFamilies(otherAdmin, other.id)).toEqual([]);
    await expect(getTemplateVersion(otherAdmin, other.id, versionId)).rejects.toThrow(
      TemplateNotFoundError,
    );
    await expect(getTemplateVersion(otherAdmin, orgId, versionId)).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(listTemplateFamilies(otherAdmin, orgId)).rejects.toThrow(AccessDeniedError);
    expect(await templateRowCount(other.id)).toBe(0);
  });

  it("3.8 seed_uses_services: created_by og published_by er admin i prøveorganisasjonen, og revisjonsloggen har radene", async () => {
    await runSampleSeed(env, TEST_NOW);
    const orgId = await sampleOrgId();
    const adminEmployeeId = await employeeIdOf(await adminActor(), orgId);
    const [family] = await sampleFamilies();
    const versionId = family!.versions[0]!.id;

    const [familyRow] = await rows<{ created_by: string | null }>(
      sql`select created_by from template_families where id = ${family!.id}`,
    );
    expect(familyRow!.created_by).toBe(adminEmployeeId);
    const [versionRow] = await rows<{ created_by: string | null; published_by: string | null }>(
      sql`select created_by, published_by::text as published_by from template_versions where id = ${versionId}`,
    );
    expect(versionRow!.published_by).toBe(adminEmployeeId);
    expect(versionRow!.created_by).toBe(adminEmployeeId);

    const audit = await rows<{ actor_employee_id: string | null }>(sql`
      select actor_employee_id::text as actor_employee_id from audit_log
      where organization_id = ${orgId}
        and (entity_id::text = ${versionId} or changes->>'versionId' = ${versionId})`);
    // Laget, lagret og publisert
    expect(audit.length).toBeGreaterThanOrEqual(3);
    for (const row of audit) expect(row.actor_employee_id).toBe(adminEmployeeId);
  });

  it("3.8 loggen fra seed har ingen tekst fra malen", async () => {
    const log = await runAndLog();
    const document = await parsedWetRoom();
    const texts = [
      ...document.outcomes.flatMap((o) => [o.deviation_text, o.default_consequence_text]),
      ...document.checkpoints.map((c) => c.name),
    ].filter((t): t is string => t !== null);
    for (const line of log) {
      for (const text of texts) expect(line.includes(text), line).toBe(false);
    }
  });

  it("kildeteksten: ensureSampleTemplate sjekker merket med samme vilkår som ensureSampleAi og har ingen rå spørring", () => {
    const source = readFileSync(join(__dirname, "sample-assignments.ts"), "utf8");
    const start = source.indexOf("export async function ensureSampleTemplate");
    expect(start, "ensureSampleTemplate finnes").toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf("\n}\n", start));
    expect(body).toMatch(/isSampleOrganization\(/);
    expect(body, "ingen egen spørring mot databasen i seed").not.toMatch(
      /\bdb\s*\.\s*(select|insert|update|delete|execute)/,
    );
    expect(body).not.toMatch(/organizations\.settings|sampleData/);

    const helperStart = source.indexOf("export async function isSampleOrganization");
    expect(helperStart, "isSampleOrganization finnes").toBeGreaterThan(-1);
    const helper = source.slice(helperStart, source.indexOf("\n}\n", helperStart));
    expect(helper).toMatch(/IS_SAMPLE_ORGANIZATION/);
  });
});
