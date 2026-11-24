import { randomBytes, randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS_FOLDER, runMigrations } from "./run-migrations";

/*
 * B3.6 og B7.1: migreringen for badet (docs/funksjoner/fase2a-badet-pc-testplan.md avsnitt 3 og 7,
 * A397). Lager egne tomme databaser (`ezprop_mig_<tilfeldig>`), kjører migreringene til og med
 * migreringen før badet fra en kopi av mappen med kuttet journal, setter inn rader med rå SQL slik de
 * kan se ut i drift i dag, og kjører så hele mappen.
 *
 * - Med vanlige data: migreringen går uten feil og endrer ingen eksisterende rad.
 * - Med en `ai_usage_log`-rad som har `report_id`: migreringen stopper med en tydelig melding, og
 *   ingenting er endret (ingen nye tabeller, raden står som før, migreringen er ikke ført som kjørt).
 *
 * Databasene og kopien slettes i `afterAll`. Alle data er oppdiktet («Testveien», «Åse Testesen»).
 *
 * Støtter hovedmål: de ansatte og færre reklamasjoner (ingen data går tapt eller endres når
 * rapporttabellene kommer), og KI i bunnen (KI-loggen røres ikke).
 */

type Sql = ReturnType<typeof postgres>;

const BADET_TAG_PATTERN = /^\d{4}_badet-pc$/;

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

/** Taggen til badets migrering og taggen rett før (leses fra journalen, så nytt nummer går bra). */
function tags(): { badet: string; before: string } {
  const entries = journal().entries;
  const index = entries.findIndex((entry) => BADET_TAG_PATTERN.test(entry.tag));
  if (index < 1) throw new Error("Fant ikke badets migrering i journalen");
  return { badet: entries[index]!.tag, before: entries[index - 1]!.tag };
}

let admin: Sql;
const databases: string[] = [];
const folders: string[] = [];

/** Ny database migrert til og med migreringen før badet. */
async function databaseBeforeBadet(): Promise<{ name: string; sql: Sql }> {
  const name = `ezprop_mig_${randomBytes(6).toString("hex")}`;
  await admin.unsafe(`create database "${name}"`);
  databases.push(name);
  const folder = mkdtempSync(join(tmpdir(), "ezprop-mig-badet-"));
  folders.push(folder);
  cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
  const cutJournal = journal(folder);
  const cut = cutJournal.entries.findIndex((entry) => entry.tag === tags().before);
  cutJournal.entries = cutJournal.entries.slice(0, cut + 1);
  writeFileSync(join(folder, "meta", "_journal.json"), JSON.stringify(cutJournal));
  await runMigrations(urlFor(name), folder);
  return { name, sql: postgres(urlFor(name), { max: 1, onnotice: () => {} }) };
}

const ids = {
  org: randomUUID(),
  office: randomUUID(),
  user: randomUUID(),
  employee: randomUUID(),
  assignment: randomUUID(),
  assignmentDeleted: randomUUID(),
  logOpen: randomUUID(),
  logDeleted: randomUUID(),
  logWithReport: randomUUID(),
};

const UPDATED_AT = "2026-11-10T12:00:00.000Z";
const DELETED_AT = "2026-11-11T12:00:00.000Z";

async function insertAiUsageLog(
  sql: Sql,
  id: string,
  extra: { reportId?: string | null; deleted?: boolean } = {},
) {
  await sql`insert into ai_usage_log (id, organization_id, employee_id, feature, provider, model,
      prompt_version, assignment_id, report_id, target_ref, source_fields, input_summary, outcome,
      output_text, status, retain_until, created_at, deleted_at)
    values (${id}, ${ids.org}, ${ids.employee}, 'language_polish', 'fake', 'fake-v1',
      'language_polish.v1', ${ids.assignment}, ${extra.reportId ?? null},
      ${sql.json({ type: "field_answer", id: randomUUID(), fieldKey: "text" })},
      ${sql.json(["text"])}, ${sql.json({ text: 37 })}, 'ok', 'Oppdiktet tekst.', 'suggested',
      '2036-11-10T12:00:00Z', ${UPDATED_AT}, ${extra.deleted ? DELETED_AT : null})`;
}

async function seedCommon(sql: Sql) {
  await sql`insert into organizations (id, name, brand_name)
    values (${ids.org}, 'Oppdiktet migrering', 'Oppdiktet migrering')`;
  await sql`insert into offices (id, organization_id, name) values (${ids.office}, ${ids.org}, 'Bodø')`;
  await sql`insert into users (id, name, email)
    values (${ids.user}, 'Åse Testesen', 'ase.testesen@example.invalid')`;
  await sql`insert into employees (id, organization_id, name, user_id)
    values (${ids.employee}, ${ids.org}, 'Åse Testesen', ${ids.user})`;
  await sql`insert into assignments (id, organization_id, number, office_id, assignment_type,
      status, address_text, row_version, updated_at)
    values (${ids.assignment}, ${ids.org}, 'MIG-036', ${ids.office}, 'condition_report',
      'in_progress', 'Testveien 12, 8000 Bodø', 4, ${UPDATED_AT})`;
  await sql`insert into assignments (id, organization_id, number, office_id, assignment_type,
      status, address_text, deleted_at)
    values (${ids.assignmentDeleted}, ${ids.org}, 'MIG-036B', ${ids.office}, 'condition_report',
      'ordered', 'Prøvegata 3, 8006 Bodø', ${DELETED_AT})`;
  await insertAiUsageLog(sql, ids.logOpen);
  await insertAiUsageLog(sql, ids.logDeleted, { deleted: true });
}

const SNAPSHOT_TABLES = [
  "organizations",
  "users",
  "offices",
  "employees",
  "assignments",
  "ai_usage_log",
  "standard_measures",
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

async function appliedMigrations(sql: Sql): Promise<number> {
  const [row] = await sql<{ count: string }[]>`select count(*)::text as count
    from drizzle.__drizzle_migrations`;
  return Number(row?.count ?? 0);
}

// Vanlig kjøring
let ordinary: Sql;
let ordinaryBefore: Snapshot;
let ordinaryAfter: Snapshot;
let ordinaryError: unknown;
let ordinaryName: string;

// Kjøring med en KI-rad som har report_id
let blocked: Sql;
let blockedBefore: Snapshot;
let blockedAfter: Snapshot;
let blockedError: unknown;
let blockedMigrationsBefore = 0;
let blockedMigrationsAfter = 0;

beforeAll(async () => {
  admin = postgres(testDatabaseUrl(), { max: 1, onnotice: () => {} });

  const first = await databaseBeforeBadet();
  ordinary = first.sql;
  ordinaryName = first.name;
  await seedCommon(ordinary);
  ordinaryBefore = await snapshot(ordinary);
  ordinaryError = await runMigrations(urlFor(first.name)).then(
    () => null,
    (error: unknown) => error,
  );
  ordinaryAfter = await snapshot(ordinary);

  const second = await databaseBeforeBadet();
  blocked = second.sql;
  await seedCommon(blocked);
  await insertAiUsageLog(blocked, ids.logWithReport, { reportId: randomUUID() });
  blockedBefore = await snapshot(blocked);
  blockedMigrationsBefore = await appliedMigrations(blocked);
  blockedError = await runMigrations(urlFor(second.name)).then(
    () => null,
    (error: unknown) => error,
  );
  blockedAfter = await snapshot(blocked);
  blockedMigrationsAfter = await appliedMigrations(blocked);
}, 240_000);

afterAll(async () => {
  await ordinary?.end();
  await blocked?.end();
  if (admin) {
    for (const name of databases) {
      await admin.unsafe(`drop database if exists "${name}" with (force)`);
    }
    await admin.end();
  }
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
}, 60_000);

/** Fjerner kolonner migreringen legger til (de finnes ikke før). */
function withoutNewColumns(rows: Record<string, unknown>[] | undefined, columns: string[]) {
  return (rows ?? []).map((row) => {
    const copy = { ...row };
    for (const column of columns) delete copy[column];
    return copy;
  });
}

describe("B3.6 migreringen for badet på en database med data", () => {
  it("B3.6 kjører uten feil", () => {
    expect(ordinaryError).toBeNull();
  });

  it("B3.6 dataene er med (testen prøver noe)", () => {
    expect(ordinaryBefore.assignments).toHaveLength(2);
    expect(ordinaryBefore.ai_usage_log).toHaveLength(2);
  });

  it.each(SNAPSHOT_TABLES)("B3.6 %s: ingen rad er slettet eller endret (A397)", (table) => {
    // Testen kjører til siste migrering. Kolonnene under er lagt til etter at dataene ble satt
    // inn: `applies_to_tg` av badets migrering, de to på KI-loggen av `0037_ki-i-veien`.
    const added: Record<string, string[]> = {
      standard_measures: ["applies_to_tg"],
      ai_usage_log: ["candidate_refs", "chosen_candidate"],
    };
    expect(withoutNewColumns(ordinaryAfter[table], added[table] ?? [])).toEqual(
      ordinaryBefore[table],
    );
  });

  it("B3.6 de sju rapporttabellene finnes etter migreringen, og er tomme", async () => {
    for (const table of [
      "reports",
      "field_answers",
      "checkpoint_results",
      "deviations",
      "deviation_measures",
      "tgiu_details",
      "rule_suggestion_decisions",
    ]) {
      expect(await tableExists(ordinary, table), table).toBe(true);
      const [row] = await ordinary<{ count: string }[]>`select count(*)::text as count
        from ${ordinary(table)}`;
      expect(row?.count, table).toBe("0");
    }
  });

  it("B3.6 migreringen kan kjøres på nytt uten feil (ingenting å gjøre)", async () => {
    await expect(runMigrations(urlFor(ordinaryName))).resolves.toBeUndefined();
    expect(await snapshot(ordinary)).toEqual(ordinaryAfter);
  }, 60_000);
});

describe("B3.6 migreringen stopper når ai_usage_log har report_id", () => {
  it("B3.6 stopper med en tydelig norsk melding", () => {
    expect(blockedError).not.toBeNull();
    const messages: string[] = [];
    let current: unknown = blockedError;
    for (let depth = 0; depth < 5 && current; depth += 1) {
      const message = (current as { message?: unknown }).message;
      if (typeof message === "string") messages.push(message);
      current = (current as { cause?: unknown }).cause;
    }
    const all = messages.join(" | ");
    expect(all).toContain(tags().badet);
    expect(all).toMatch(/report_id/);
    expect(all).toMatch(/Ingenting er endret/);
  });

  it("B3.6 ingenting er endret: ingen rapporttabeller, radene står, migreringen er ikke ført", async () => {
    expect(await tableExists(blocked, "reports")).toBe(false);
    expect(await tableExists(blocked, "field_answers")).toBe(false);
    expect(blockedAfter).toEqual(blockedBefore);
    expect(blockedMigrationsAfter).toBe(blockedMigrationsBefore);
    const [column] = await blocked<{ count: string }[]>`select count(*)::text as count
      from information_schema.columns
      where table_schema = 'public' and table_name = 'standard_measures'
        and column_name = 'applies_to_tg'`;
    expect(column?.count).toBe("0");
  });
});

describe("B3.6 og B7.1 kilden til migreringen", () => {
  it("B3.6 migreringen har ingen UPDATE eller DELETE på ai_usage_log", () => {
    const source = readFileSync(join(MIGRATIONS_FOLDER, `${tags().badet}.sql`), "utf8");
    expect(source).not.toMatch(/\bupdate\s+"?ai_usage_log"?/i);
    expect(source).not.toMatch(/\bdelete\s+from\s+"?ai_usage_log"?/i);
  });

  it("B7.1 journalen har ett innslag per nummer, og badet har ett nummer", () => {
    const entries = journal().entries;
    const numbers = entries.map((entry) => entry.tag.slice(0, 4));
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(new Set(entries.map((entry) => entry.idx)).size).toBe(entries.length);
    expect(entries.filter((entry) => BADET_TAG_PATTERN.test(entry.tag))).toHaveLength(1);
    for (const entry of entries) {
      expect(Number(entry.tag.slice(0, 4)), entry.tag).toBe(entry.idx);
    }
  });

  it("B7.1 badet kommer etter tilbudet (0035_tilbud), ikke på samme nummer", () => {
    const entries = journal().entries;
    const tilbud = entries.find((entry) => entry.tag === "0035_tilbud");
    const badet = entries.find((entry) => BADET_TAG_PATTERN.test(entry.tag));
    expect(tilbud).toBeDefined();
    expect(badet!.idx).toBeGreaterThan(tilbud!.idx);
  });
});
