import { randomBytes, randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS_FOLDER, runMigrations } from "./run-migrations";

/*
 * I14: migreringen for publisering (docs/funksjoner/fase2a-publisering-badet-testplan.md 3.5).
 * Lager en egen tom database (`ezprop_mig_<tilfeldig>`), kjører migreringene til og med
 * migreringen før publiseringen fra en kopi av mappen med kuttet journal, setter inn rapporter med
 * status `draft` og `published` og en sertifisering med rå SQL, og kjører så hele mappen.
 *
 * Databasen og kopien slettes i `afterAll`. Alle data er oppdiktet («Testveien», «Åse Testesen»).
 *
 * Støtter hovedmål: færre reklamasjoner og de ansatte (rapporter som alt er publisert, røres ikke
 * når utgivelsene kommer).
 */

type Sql = ReturnType<typeof postgres>;

const PUBLISH_TAG_PATTERN = /^\d{4}_publisering-badet$/;

function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL mangler (se .env.example)");
  return url;
}

function urlFor(database: string): string {
  const url = new URL(testDatabaseUrl());
  url.pathname = `/${database}`;
  return url.toString();
}

type JournalEntry = { idx: number; tag: string };

function journal(folder = MIGRATIONS_FOLDER): { entries: JournalEntry[] } {
  return JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8")) as {
    entries: JournalEntry[];
  };
}

function tags(): { publish: string; before: string } {
  const entries = journal().entries;
  const index = entries.findIndex((entry) => PUBLISH_TAG_PATTERN.test(entry.tag));
  if (index < 1) throw new Error("Fant ikke migreringen for publisering i journalen");
  return { publish: entries[index]!.tag, before: entries[index - 1]!.tag };
}

let admin: Sql;
let target: Sql;
let targetName = "";
let folder = "";

const ids = {
  org: randomUUID(),
  office: randomUUID(),
  user: randomUUID(),
  employee: randomUUID(),
  certification: randomUUID(),
  family: randomUUID(),
  version: randomUUID(),
  assignmentDraft: randomUUID(),
  assignmentPublished: randomUUID(),
  reportDraft: randomUUID(),
  reportPublished: randomUUID(),
};

const UPDATED_AT = "2026-11-10T12:00:00.000Z";

async function seed(sql: Sql) {
  await sql`insert into organizations (id, name, brand_name)
    values (${ids.org}, 'Oppdiktet migrering', 'Oppdiktet migrering')`;
  await sql`insert into offices (id, organization_id, name) values (${ids.office}, ${ids.org}, 'Bodø')`;
  await sql`insert into users (id, name, email)
    values (${ids.user}, 'Åse Testesen', 'ase.testesen@example.invalid')`;
  await sql`insert into employees (id, organization_id, name, user_id)
    values (${ids.employee}, ${ids.org}, 'Åse Testesen', ${ids.user})`;
  await sql`insert into certifications (id, organization_id, employee_id, area, valid_to)
    values (${ids.certification}, ${ids.org}, ${ids.employee}, 'Oppdiktet område', '2027-12-31')`;
  await sql`insert into template_families (id, organization_id, name, kind)
    values (${ids.family}, ${ids.org}, 'Tilstandsrapport', 'system')`;
  await sql`insert into template_versions (id, organization_id, family_id, version_number, status,
      published_at)
    values (${ids.version}, ${ids.org}, ${ids.family}, 1, 'published', ${UPDATED_AT})`;
  for (const [assignment, number] of [
    [ids.assignmentDraft, "MIG-037A"],
    [ids.assignmentPublished, "MIG-037B"],
  ] as const) {
    await sql`insert into assignments (id, organization_id, number, office_id, assignment_type,
        status, address_text, row_version, updated_at)
      values (${assignment}, ${ids.org}, ${number}, ${ids.office}, 'condition_report',
        'in_progress', 'Testveien 12, 8000 Bodø', 3, ${UPDATED_AT})`;
  }
  await sql`insert into reports (id, organization_id, assignment_id, template_version_id,
      report_type, status, updated_at)
    values (${ids.reportDraft}, ${ids.org}, ${ids.assignmentDraft}, ${ids.version},
      'condition_report', 'draft', ${UPDATED_AT})`;
  await sql`insert into reports (id, organization_id, assignment_id, template_version_id,
      report_type, status, updated_at)
    values (${ids.reportPublished}, ${ids.org}, ${ids.assignmentPublished}, ${ids.version},
      'condition_report', 'published', ${UPDATED_AT})`;
}

const SNAPSHOT_TABLES = [
  "organizations",
  "employees",
  "certifications",
  "assignments",
  "template_versions",
  "reports",
] as const;

type Snapshot = Record<string, Record<string, unknown>[]>;

async function snapshot(sql: Sql): Promise<Snapshot> {
  const out: Snapshot = {};
  for (const table of SNAPSHOT_TABLES) {
    out[table] = await sql<Record<string, unknown>[]>`select * from ${sql(table)} order by id`;
  }
  return out;
}

async function tableExists(sql: Sql, table: string): Promise<boolean> {
  const [row] = await sql<
    { found: string | null }[]
  >`select to_regclass(${`public.${table}`}) as found`;
  return row?.found !== null && row?.found !== undefined;
}

let before: Snapshot;
let after: Snapshot;
let migrationError: unknown;
let existedBefore = { releases: true, results: true };

beforeAll(async () => {
  admin = postgres(testDatabaseUrl(), { max: 1, onnotice: () => {} });
  targetName = `ezprop_mig_${randomBytes(6).toString("hex")}`;
  await admin.unsafe(`create database "${targetName}"`);
  folder = mkdtempSync(join(tmpdir(), "ezprop-mig-publisering-"));
  cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
  const cutJournal = journal(folder);
  const cut = cutJournal.entries.findIndex((entry) => entry.tag === tags().before);
  cutJournal.entries = cutJournal.entries.slice(0, cut + 1);
  writeFileSync(join(folder, "meta", "_journal.json"), JSON.stringify(cutJournal));
  await runMigrations(urlFor(targetName), folder);
  target = postgres(urlFor(targetName), { max: 1, onnotice: () => {} });

  await seed(target);
  existedBefore = {
    releases: await tableExists(target, "report_releases"),
    results: await tableExists(target, "publish_check_results"),
  };
  before = await snapshot(target);
  migrationError = await runMigrations(urlFor(targetName)).then(
    () => null,
    (error: unknown) => error,
  );
  after = await snapshot(target);
}, 240_000);

afterAll(async () => {
  await target?.end();
  if (admin) {
    if (targetName) await admin.unsafe(`drop database if exists "${targetName}" with (force)`);
    await admin.end();
  }
  if (folder) rmSync(folder, { recursive: true, force: true });
}, 60_000);

describe("3.5 (I14) migreringen for publisering på en database med rapporter", () => {
  it("journalen har ett innslag per nummer (kollisjon med en annen 0038 stoppes)", () => {
    const numbers = journal().entries.map((entry) => entry.tag.slice(0, 4));
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(tags().publish).toMatch(PUBLISH_TAG_PATTERN);
  });

  it("tabellene fantes ikke før migreringen", () => {
    expect(existedBefore).toEqual({ releases: false, results: false });
  });

  it("kjører uten feil når det finnes rapporter med status draft og published", () => {
    expect(migrationError).toBeNull();
    expect(before.reports?.map((r) => r.status).sort()).toEqual(["draft", "published"]);
  });

  it.each(SNAPSHOT_TABLES)("%s: ingen rad er slettet eller endret", (table) => {
    expect(after[table]).toEqual(before[table]);
  });

  it("report_releases og publish_check_results finnes og er tomme", async () => {
    for (const table of ["report_releases", "publish_check_results"]) {
      expect(await tableExists(target, table), table).toBe(true);
      const [row] = await target<{ count: string }[]>`select count(*)::text as count
        from ${target(table)}`;
      expect(row?.count, table).toBe("0");
    }
  });

  it("en utgivelse kan lages for den publiserte rapporten etter migreringen", async () => {
    const companyId = randomUUID();
    await target`insert into companies (id, organization_id, legal_name)
      values (${companyId}, ${ids.org}, 'Oppdiktet Takst AS')`;
    await target`insert into report_releases (organization_id, report_id, version_number,
        released_at, released_by, signed_by_employee_id, certification_id, company_id,
        original_release_date, snapshot, content_hash, retain_until)
      values (${ids.org}, ${ids.reportPublished}, 1, now(), ${ids.employee}, ${ids.employee},
        ${ids.certification}, ${companyId}, '2026-11-17', ${target.json({ schema_version: 1 })},
        ${"a".repeat(64)}, now() + interval '10 years')`;
    const [row] = await target<{ count: string }[]>`select count(*)::text as count
      from report_releases`;
    expect(row?.count).toBe("1");
  });

  it("migreringen kan kjøres på nytt uten feil", async () => {
    await expect(runMigrations(urlFor(targetName))).resolves.toBeUndefined();
  }, 60_000);
});
