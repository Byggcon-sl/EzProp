import { randomBytes, randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS_FOLDER, runMigrations } from "./run-migrations";

/*
 * K3.4: migreringen for «KI i veien» (docs/funksjoner/fase2a-ki-i-veien-testplan.md avsnitt 3).
 * Lager en egen tom database (`ezprop_mig_<tilfeldig>`), kjører migreringene til og med
 * migreringen før `ki-i-veien` fra en kopi av mappen med kuttet journal, setter inn rader med rå
 * SQL slik de kan se ut i drift i dag (en rapport, KI-rader med `ai_trial`, `field_answer` og
 * `blocked`), og kjører så hele mappen. Migreringen skal gå uten feil og ikke endre en eneste
 * eksisterende rad. Databasen og kopien slettes i `afterAll`. Alle data er oppdiktet.
 *
 * Støtter hovedmål: KI i bunnen (KI-loggen tåler de nye kolonnene uten å miste noe) og de ansatte
 * (rapporter under arbeid er urørt).
 */

type Sql = ReturnType<typeof postgres>;

const TAG_PATTERN = /^\d{4}_ki-i-veien$/;

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

function tags(): { own: string; before: string } {
  const entries = journal().entries;
  const index = entries.findIndex((entry) => TAG_PATTERN.test(entry.tag));
  if (index < 1) throw new Error("Fant ikke migreringen for KI i veien i journalen");
  return { own: entries[index]!.tag, before: entries[index - 1]!.tag };
}

let admin: Sql;
let sql: Sql;
let name: string;
let folder: string;
let before: Record<string, Record<string, unknown>[]>;
let after: Record<string, Record<string, unknown>[]>;
let migrationError: unknown;

const ids = {
  org: randomUUID(),
  office: randomUUID(),
  user: randomUUID(),
  employee: randomUUID(),
  assignment: randomUUID(),
  family: randomUUID(),
  version: randomUUID(),
  report: randomUUID(),
  trial: randomUUID(),
  answer: randomUUID(),
  blocked: randomUUID(),
};

const SNAPSHOT_TABLES = ["assignments", "reports", "ai_usage_log"] as const;

/** Kolonnene migreringen legger til. De finnes ikke før, og er tomme etter. */
const ADDED: Record<string, string[]> = {
  reports: ["summary_text", "summary_basis"],
  ai_usage_log: ["candidate_refs", "chosen_candidate"],
};

async function snapshot(db: Sql) {
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const table of SNAPSHOT_TABLES) {
    out[table] = await db<Record<string, unknown>[]>`select * from ${db(table)} order by id`;
  }
  return out;
}

async function insertLog(
  db: Sql,
  id: string,
  target: { type: string; fieldKey: string },
  outcome: "ok" | "blocked",
) {
  const ok = outcome === "ok";
  await db`insert into ai_usage_log (id, organization_id, employee_id, feature, provider, model,
      prompt_version, assignment_id, report_id, target_ref, source_fields, input_summary, outcome,
      output_text, status, retain_until, created_at)
    values (${id}, ${ids.org}, ${ids.employee}, 'language_polish', 'fake', 'fake-v1',
      'language_polish.v2', ${ok ? null : ids.assignment}, null,
      ${db.json({ type: target.type, id: randomUUID(), fieldKey: target.fieldKey })},
      ${db.json(["text"])}, ${db.json(ok ? { text: 21 } : {})}, ${outcome},
      ${ok ? "Oppdiktet prøvetekst." : null}, ${ok ? "accepted" : null},
      '2036-11-10T12:00:00Z', '2026-11-10T12:00:00Z')`;
}

async function seed(db: Sql) {
  await db`insert into organizations (id, name, brand_name)
    values (${ids.org}, 'Oppdiktet migrering', 'Oppdiktet migrering')`;
  await db`insert into offices (id, organization_id, name) values (${ids.office}, ${ids.org}, 'Bodø')`;
  await db`insert into users (id, name, email)
    values (${ids.user}, 'Åse Testesen', 'ase.testesen@example.invalid')`;
  await db`insert into employees (id, organization_id, name, user_id)
    values (${ids.employee}, ${ids.org}, 'Åse Testesen', ${ids.user})`;
  await db`insert into assignments (id, organization_id, number, office_id, assignment_type,
      status, address_text, updated_at)
    values (${ids.assignment}, ${ids.org}, 'MIG-037', ${ids.office}, 'condition_report',
      'in_progress', 'Testveien 1, 8000 Bodø', '2026-11-10T12:00:00Z')`;
  await db`insert into template_families (id, organization_id, name, kind)
    values (${ids.family}, ${ids.org}, 'Oppdiktet mal', 'system')`;
  await db`insert into template_versions (id, organization_id, family_id, version_number, status,
      published_at)
    values (${ids.version}, ${ids.org}, ${ids.family}, 1, 'published', '2026-11-01T12:00:00Z')`;
  await db`insert into reports (id, organization_id, assignment_id, template_version_id,
      report_type, row_version, updated_at)
    values (${ids.report}, ${ids.org}, ${ids.assignment}, ${ids.version}, 'condition_report', 3,
      '2026-11-10T12:00:00Z')`;
  await insertLog(db, ids.trial, { type: "ai_trial", fieldKey: "text" }, "ok");
  await insertLog(db, ids.answer, { type: "field_answer", fieldKey: "text" }, "ok");
  await insertLog(db, ids.blocked, { type: "field_answer", fieldKey: "text" }, "blocked");
}

beforeAll(async () => {
  admin = postgres(testDatabaseUrl(), { max: 1, onnotice: () => {} });
  name = `ezprop_mig_${randomBytes(6).toString("hex")}`;
  await admin.unsafe(`create database "${name}"`);
  folder = mkdtempSync(join(tmpdir(), "ezprop-mig-ki-i-veien-"));
  cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
  const cutJournal = journal(folder);
  const cut = cutJournal.entries.findIndex((entry) => entry.tag === tags().before);
  cutJournal.entries = cutJournal.entries.slice(0, cut + 1);
  writeFileSync(join(folder, "meta", "_journal.json"), JSON.stringify(cutJournal));
  await runMigrations(urlFor(name), folder);
  sql = postgres(urlFor(name), { max: 1, onnotice: () => {} });
  await seed(sql);
  before = await snapshot(sql);
  migrationError = await runMigrations(urlFor(name)).then(
    () => null,
    (error: unknown) => error,
  );
  after = await snapshot(sql);
}, 240_000);

afterAll(async () => {
  await sql?.end();
  if (admin) {
    if (name) await admin.unsafe(`drop database if exists "${name}" with (force)`);
    await admin.end();
  }
  if (folder) rmSync(folder, { recursive: true, force: true });
}, 60_000);

function withoutAdded(table: string, rows: Record<string, unknown>[] | undefined) {
  return (rows ?? []).map((row) => {
    const copy = { ...row };
    for (const column of ADDED[table] ?? []) delete copy[column];
    return copy;
  });
}

describe("K3.4 migreringen for KI i veien på en database med data", () => {
  it("kjører uten feil", () => {
    expect(migrationError).toBeNull();
  });

  it("dataene er med (testen prøver noe)", () => {
    expect(before.reports).toHaveLength(1);
    expect(before.ai_usage_log).toHaveLength(3);
  });

  it.each(SNAPSHOT_TABLES)("%s: ingen rad er slettet eller endret", (table) => {
    expect(withoutAdded(table, after[table])).toEqual(before[table]);
  });

  it("de nye kolonnene er tomme på eksisterende rader", () => {
    for (const [table, columns] of Object.entries(ADDED)) {
      for (const row of after[table] ?? []) {
        for (const column of columns) expect(row[column], `${table}.${column}`).toBeNull();
      }
    }
  });

  it("K3.5 den gamle ai_trial-raden står som før", () => {
    const trial = after.ai_usage_log?.find((row) => row.id === ids.trial);
    expect(trial?.target_ref).toMatchObject({ type: "ai_trial", fieldKey: "text" });
    expect(trial?.status).toBe("accepted");
  });
});

describe("K3.4 migreringsfilen", () => {
  const file = () => {
    const own = tags().own;
    const found = readdirSync(MIGRATIONS_FOLDER).find((entry) => entry === `${own}.sql`);
    if (!found) throw new Error(`Fant ikke ${own}.sql`);
    return readFileSync(join(MIGRATIONS_FOLDER, found), "utf8");
  };

  it("har ingen DELETE, ingen UPDATE av ai_usage_log og ingen ON DELETE CASCADE", () => {
    const source = file();
    expect(source).not.toMatch(/\bdelete\s+from\b/iu);
    expect(source).not.toMatch(/\bupdate\s+"?ai_usage_log"?/iu);
    expect(source).not.toMatch(/on\s+delete\s+cascade/iu);
    expect(source).not.toMatch(/\bdrop\s+(table|column)\b/iu);
  });

  it("nummeret er brukt én gang i journalen (ingen kollisjon)", () => {
    const entries = journal().entries;
    const own = tags().own;
    const number = own.slice(0, 4);
    expect(entries.filter((entry) => entry.tag.startsWith(`${number}_`))).toHaveLength(1);
    expect(new Set(entries.map((entry) => entry.idx)).size).toBe(entries.length);
  });
});
