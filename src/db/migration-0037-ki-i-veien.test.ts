import { randomBytes, randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql as dsql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { requireOrganizationAccess } from "@/core/access";
import { db } from "@/db/client";
import {
  createAiUsageLog,
  createEmployee,
  createOrganization,
  createReportRow,
  createUser,
  resetDatabase,
} from "../../tests/factories";
import { MIGRATIONS_FOLDER, runMigrations } from "./run-migrations";

vi.mock("server-only", () => ({}));

/*
 * K3.1–K3.5: skjemaet og migreringen for «KI i veien» (docs/funksjoner/fase2a-ki-i-veien-testplan.md
 * avsnitt 3). Del 1 prøver CHECK-reglene og indeksene i testdatabasen. Del 2 lager en egen tom
 * database (`ezprop_mig_<tilfeldig>`), kjører migreringene til og med migreringen før «KI i veien»,
 * setter inn rader slik de kan se ut i drift (rapport, KI-rader med `ai_trial` og `field_answer`)
 * og kjører så hele mappen. Ingen rad skal endres. Alle data er oppdiktet.
 *
 * Støtter hovedmål: KI i bunnen (KI-loggen tåler bare lovlige utfall, kandidater og valg) og færre
 * reklamasjoner (et stoppet KI-svar kan aldri stå som et godtatt forslag).
 */

type Sql = ReturnType<typeof postgres>;

const KI_TAG_PATTERN = /^\d{4}_ki-i-veien$/;

type JournalEntry = { idx: number; tag: string };

function journal(folder = MIGRATIONS_FOLDER): { entries: JournalEntry[] } {
  return JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8")) as {
    entries: JournalEntry[];
  };
}

function tags(): { ki: string; before: string } {
  const entries = journal().entries;
  const index = entries.findIndex((entry) => KI_TAG_PATTERN.test(entry.tag));
  if (index < 1) throw new Error("Fant ikke migreringen for KI i veien i journalen");
  return { ki: entries[index]!.tag, before: entries[index - 1]!.tag };
}

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

/** Feilen Postgres gir, med navnet på regelen (også når den ligger i `cause`). */
async function pgError(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const parts: string[] = [];
    let current: unknown = error;
    for (let depth = 0; depth < 5 && current; depth += 1) {
      const c = current as { message?: unknown; constraint_name?: unknown; constraint?: unknown };
      if (typeof c.message === "string") parts.push(c.message);
      if (typeof c.constraint_name === "string") parts.push(c.constraint_name);
      if (typeof c.constraint === "string") parts.push(c.constraint);
      current = (current as { cause?: unknown }).cause;
    }
    return parts.join(" | ");
  }
  return "";
}

// --- Del 1: testdatabasen ---------------------------------------------------------------------

describe("K3.1–K3.3 skjemaet i testdatabasen", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("K3.1 de fire nye kolonnene finnes og tillater tom verdi", async () => {
    const rows = (await db.execute(dsql`
      select table_name, column_name, data_type, is_nullable
      from information_schema.columns
      where table_schema = 'public'
        and ((table_name = 'reports' and column_name in ('summary_text', 'summary_basis'))
          or (table_name = 'ai_usage_log' and column_name in ('candidate_refs', 'chosen_candidate')))
      order by table_name, column_name`)) as unknown as {
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
    }[];
    expect(rows.map((r) => [r.table_name, r.column_name, r.data_type, r.is_nullable])).toEqual([
      ["ai_usage_log", "candidate_refs", "jsonb", "YES"],
      ["ai_usage_log", "chosen_candidate", "jsonb", "YES"],
      ["reports", "summary_basis", "jsonb", "YES"],
      ["reports", "summary_text", "text", "YES"],
    ]);
  });

  it("K3.1 jsonb_typeof: candidate_refs er liste, chosen_candidate er objekt", async () => {
    const org = await createOrganization("Oppdiktet Takst K3");
    const refs = [
      { source: "template_outcome", id: randomUUID() },
      { source: "template_measure", id: randomUUID() },
    ];
    const row = await createAiUsageLog(org.id, { feature: "phrase_suggest", status: "suggested" });
    await db.execute(dsql`update ai_usage_log set candidate_refs = ${JSON.stringify(refs)}::jsonb,
      status = 'accepted', chosen_candidate = ${JSON.stringify(refs[1])}::jsonb
      where id = ${row.id}`);
    const [types] = (await db.execute(dsql`select jsonb_typeof(candidate_refs) as refs,
      jsonb_typeof(chosen_candidate) as chosen from ai_usage_log where id = ${row.id}`)) as unknown as {
      refs: string;
      chosen: string;
    }[];
    expect(types).toEqual({ refs: "array", chosen: "object" });
  });

  describe("K3.2 CHECK for utfallet stopped", () => {
    it.each(["tg_guard", "number_guard", "coverage_guard", "placeholder_guard"])(
      "K3.2 stopped med %s godtas (status tom, tokens og kostnad beholdt)",
      async (code) => {
        const org = await createOrganization("Oppdiktet Takst K3");
        const row = await createAiUsageLog(org.id, {
          outcome: "stopped",
          errorCode: code,
          status: null,
          outputText: "Oppdiktet stoppet svar Mxq-merke-ÆØ",
          tokensIn: 120,
          tokensOut: 40,
          cost: "0.12",
        });
        expect(row.outcome).toBe("stopped");
        expect(row.error_code).toBe(code);
        expect(row.status).toBeNull();
        expect(row.tokens_in).toBe(120);
      },
    );

    it("K3.2 stopped uten error_code avvises", async () => {
      const org = await createOrganization("Oppdiktet Takst K3");
      const message = await pgError(() =>
        createAiUsageLog(org.id, { outcome: "stopped", errorCode: null, status: null }),
      );
      expect(message).toMatch(/ai_usage_log_stopped_check|ai_usage_log_error_code_check/);
    });

    it.each(["timeout", "unknown", "invented_guard"])(
      "K3.2 stopped med annen kode (%s) avvises",
      async (code) => {
        const org = await createOrganization("Oppdiktet Takst K3");
        const message = await pgError(() =>
          createAiUsageLog(org.id, { outcome: "stopped", errorCode: code, status: null }),
        );
        expect(message).toMatch(/ai_usage_log_error_code_check/);
      },
    );

    it("K3.2 en vaktkode på utfallet error avvises", async () => {
      const org = await createOrganization("Oppdiktet Takst K3");
      const message = await pgError(() =>
        createAiUsageLog(org.id, { outcome: "error", errorCode: "tg_guard", status: null }),
      );
      expect(message).toMatch(/ai_usage_log_error_code_check/);
    });

    it.each(["suggested", "accepted", "rejected"])(
      "K3.2 stopped med status %s avvises",
      async (status) => {
        const org = await createOrganization("Oppdiktet Takst K3");
        const message = await pgError(() =>
          createAiUsageLog(org.id, { outcome: "stopped", errorCode: "tg_guard", status }),
        );
        expect(message).toMatch(/ai_usage_log_outcome_status_check/);
      },
    );
  });

  describe("K3.2a CHECK for kandidater og sammendrag", () => {
    const ref = (source = "template_outcome") => ({ source, id: randomUUID() });

    async function phraseRow(orgId: string, refs: unknown, extra: Record<string, unknown> = {}) {
      const row = await createAiUsageLog(orgId, {
        feature: "phrase_suggest",
        outputText: null,
        ...extra,
      });
      return db.execute(
        dsql`update ai_usage_log set candidate_refs = ${JSON.stringify(refs)}::jsonb
          where id = ${row.id} returning id`,
      );
    }

    it("K3.2a ok-rad med 1 og med 5 kandidater godtas", async () => {
      const org = await createOrganization("Oppdiktet Takst K3");
      await expect(phraseRow(org.id, [ref()])).resolves.toBeDefined();
      await expect(
        phraseRow(org.id, [ref(), ref("template_measure"), ref(), ref(), ref()]),
      ).resolves.toBeDefined();
    });

    it.each([
      ["tom liste", []],
      ["seks kandidater", [1, 2, 3, 4, 5, 6].map(() => ({ source: "phrase", id: randomUUID() }))],
      ["objekt i stedet for liste", { source: "template_outcome", id: "x" }],
      ["tekst", "K1"],
    ])("K3.2a candidate_refs som %s avvises", async (_name, refs) => {
      const org = await createOrganization("Oppdiktet Takst K3");
      const message = await pgError(() => phraseRow(org.id, refs));
      expect(message).toMatch(/ai_usage_log_candidate_refs_check/);
    });

    it("K3.2a en no_match-rad kan ikke ha candidate_refs", async () => {
      const org = await createOrganization("Oppdiktet Takst K3");
      const message = await pgError(() =>
        phraseRow(org.id, [ref()], { outcome: "no_match", status: null }),
      );
      expect(message).toMatch(/ai_usage_log_candidate_refs_check/);
    });

    async function chosenRow(orgId: string, chosen: unknown, status = "accepted") {
      const refs = [
        { source: "template_outcome", id: "11111111-1111-4111-8111-111111111111" },
        { source: "template_measure", id: "22222222-2222-4222-8222-222222222222" },
      ];
      const row = await createAiUsageLog(orgId, { feature: "phrase_suggest", outputText: null });
      return db.execute(dsql`update ai_usage_log set candidate_refs = ${JSON.stringify(refs)}::jsonb,
        status = ${status}, chosen_candidate = ${JSON.stringify(chosen)}::jsonb
        where id = ${row.id} returning id`);
    }

    it("K3.2a chosen_candidate som står i listen og status accepted godtas", async () => {
      const org = await createOrganization("Oppdiktet Takst K3");
      await expect(
        chosenRow(org.id, {
          source: "template_measure",
          id: "22222222-2222-4222-8222-222222222222",
        }),
      ).resolves.toBeDefined();
    });

    it.each([
      ["status rejected", { source: "template_outcome", id: "11111111-1111-4111-8111-111111111111" }, "rejected"],
      ["status suggested", { source: "template_outcome", id: "11111111-1111-4111-8111-111111111111" }, "suggested"],
      ["ikke i listen", { source: "template_outcome", id: "33333333-3333-4333-8333-333333333333" }, "accepted"],
      ["tomt objekt", {}, "accepted"],
      ["uten source", { id: "11111111-1111-4111-8111-111111111111" }, "accepted"],
      ["ukjent source", { source: "free_text", id: "11111111-1111-4111-8111-111111111111" }, "accepted"],
      ["ekstra nøkkel med tekst", { source: "template_outcome", id: "11111111-1111-4111-8111-111111111111", text: "Mxq-merke-ÆØ" }, "accepted"],
      ["id som tall", { source: "template_outcome", id: 1 }, "accepted"],
      ["liste i stedet for objekt", [{ source: "template_outcome", id: "11111111-1111-4111-8111-111111111111" }], "accepted"],
    ])("K3.2a chosen_candidate %s avvises", async (_name, chosen, status) => {
      const org = await createOrganization("Oppdiktet Takst K3");
      const message = await pgError(() => chosenRow(org.id, chosen, status));
      expect(message).toMatch(/ai_usage_log_chosen_candidate_check/);
    });

    it("K3.2a chosen_candidate uten candidate_refs avvises", async () => {
      const org = await createOrganization("Oppdiktet Takst K3");
      const row = await createAiUsageLog(org.id, { status: "accepted" });
      const message = await pgError(() =>
        db.execute(dsql`update ai_usage_log
          set chosen_candidate = ${JSON.stringify({ source: "template_outcome", id: randomUUID() })}::jsonb
          where id = ${row.id}`),
      );
      expect(message).toMatch(/ai_usage_log_chosen_candidate_check/);
    });

    it("K3.2a summary_text på 10 000 tegn godtas, 10 001 avvises", async () => {
      const org = await createOrganization("Oppdiktet Takst K3");
      const report = await createReportRow(org.id);
      await db.execute(
        dsql`update reports set summary_text = ${"a".repeat(10_000)} where id = ${report.id}`,
      );
      const message = await pgError(() =>
        db.execute(
          dsql`update reports set summary_text = ${"a".repeat(10_001)} where id = ${report.id}`,
        ),
      );
      expect(message).toMatch(/reports_summary_text_check/);
    });

    it("K3.2a summary_basis med 200 funn godtas, 201 og objekt avvises", async () => {
      const org = await createOrganization("Oppdiktet Takst K3");
      const report = await createReportRow(org.id);
      const entry = () => ({ source: "deviation", id: randomUUID(), group: "tg2", rowVersion: 1 });
      const list = (n: number) => JSON.stringify(Array.from({ length: n }, entry));
      await db.execute(
        dsql`update reports set summary_basis = ${list(200)}::jsonb where id = ${report.id}`,
      );
      expect(
        await pgError(() =>
          db.execute(
            dsql`update reports set summary_basis = ${list(201)}::jsonb where id = ${report.id}`,
          ),
        ),
      ).toMatch(/reports_summary_basis_check/);
      expect(
        await pgError(() =>
          db.execute(
            dsql`update reports set summary_basis = ${JSON.stringify(entry())}::jsonb where id = ${report.id}`,
          ),
        ),
      ).toMatch(/reports_summary_basis_check/);
    });
  });

  it("K3.3 indeksen (organization_id, feature, target_ref) for ikke-slettede rader finnes", async () => {
    const rows = (await db.execute(dsql`select indexname, indexdef from pg_indexes
      where tablename = 'ai_usage_log' and indexname in
        ('ai_usage_log_target_idx', 'ai_usage_log_chosen_candidate_idx')
      order by indexname`)) as unknown as { indexname: string; indexdef: string }[];
    expect(rows.map((r) => r.indexname)).toEqual([
      "ai_usage_log_chosen_candidate_idx",
      "ai_usage_log_target_idx",
    ]);
    const target = rows.find((r) => r.indexname === "ai_usage_log_target_idx")!.indexdef;
    expect(target).toMatch(/\(organization_id, feature, target_ref\)/);
    expect(target).toMatch(/WHERE \(deleted_at IS NULL\)/);
    const chosen = rows.find((r) => r.indexname === "ai_usage_log_chosen_candidate_idx")!.indexdef;
    expect(chosen).toMatch(/chosen_candidate IS NOT NULL/);
    expect(chosen).toMatch(/deleted_at IS NULL/);
  });

  it("K3.5 en gammel ai_trial-rad kan fortsatt leses med getSuggestionStatus", async () => {
    const org = await createOrganization("Oppdiktet Takst K3");
    const user = await createUser({ name: "Oppdiktet Takstmann" });
    const employee = await createEmployee(user, org.id, ["inspector"]);
    const grant = await requireOrganizationAccess(user, org.id);
    const row = await createAiUsageLog(org.id, {
      employeeId: employee.id,
      targetRef: { type: "ai_trial", id: randomUUID(), fieldKey: "text" },
    });
    const { getSuggestionStatus } = await import("@/core/ai");
    await expect(getSuggestionStatus(grant, row.id)).resolves.toEqual({
      status: "suggested",
      outcome: "ok",
    });
  });
});

// --- Del 2: migreringen på en database med data -------------------------------------------------

let admin: Sql;
const databases: string[] = [];
const folders: string[] = [];

async function databaseBeforeKi(): Promise<{ name: string; sql: Sql }> {
  const name = `ezprop_mig_${randomBytes(6).toString("hex")}`;
  await admin.unsafe(`create database "${name}"`);
  databases.push(name);
  const folder = mkdtempSync(join(tmpdir(), "ezprop-mig-ki-"));
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
  family: randomUUID(),
  version: randomUUID(),
  report: randomUUID(),
  logTrial: randomUUID(),
  logAnswer: randomUUID(),
  logError: randomUUID(),
  logDeleted: randomUUID(),
};

const CREATED_AT = "2026-11-12T12:00:00.000Z";

async function seed(sql: Sql) {
  await sql`insert into organizations (id, name, brand_name)
    values (${ids.org}, 'Oppdiktet migrering KI', 'Oppdiktet migrering KI')`;
  await sql`insert into offices (id, organization_id, name) values (${ids.office}, ${ids.org}, 'Bodø')`;
  await sql`insert into users (id, name, email)
    values (${ids.user}, 'Åse Testesen', 'ase.testesen@eksempel.no')`;
  await sql`insert into employees (id, organization_id, name, user_id)
    values (${ids.employee}, ${ids.org}, 'Åse Testesen', ${ids.user})`;
  await sql`insert into assignments (id, organization_id, number, office_id, assignment_type,
      status, address_text, row_version, updated_at)
    values (${ids.assignment}, ${ids.org}, 'MIG-037', ${ids.office}, 'condition_report',
      'in_progress', 'Testveien 1, 8000 Bodø', 3, ${CREATED_AT})`;
  await sql`insert into template_families (id, organization_id, name, kind)
    values (${ids.family}, ${ids.org}, 'Tilstandsrapport', 'system')`;
  await sql`insert into template_versions (id, organization_id, family_id, version_number)
    values (${ids.version}, ${ids.org}, ${ids.family}, 1)`;
  await sql`insert into reports (id, organization_id, assignment_id, template_version_id, report_type)
    values (${ids.report}, ${ids.org}, ${ids.assignment}, ${ids.version}, 'condition_report')`;
  const log = async (
    id: string,
    target: { type: string; id: string; fieldKey: string },
    extra: { outcome?: string; errorCode?: string | null; deleted?: boolean } = {},
  ) => {
    const ok = (extra.outcome ?? "ok") === "ok";
    await sql`insert into ai_usage_log (id, organization_id, employee_id, feature, provider, model,
        prompt_version, assignment_id, report_id, target_ref, source_fields, input_summary, outcome,
        error_code, output_text, status, retain_until, created_at, deleted_at)
      values (${id}, ${ids.org}, ${ids.employee}, 'language_polish', 'fake', 'fake-v1',
        'language_polish.v2', ${target.type === "ai_trial" ? null : ids.assignment}, null,
        ${sql.json(target)}, ${sql.json(["text"])}, ${sql.json({ text: 37 })},
        ${extra.outcome ?? "ok"}, ${extra.errorCode ?? null}, ${ok ? "Oppdiktet tekst." : null},
        ${ok ? "suggested" : null}, '2036-11-12T12:00:00Z', ${CREATED_AT},
        ${extra.deleted ? CREATED_AT : null})`;
  };
  await log(ids.logTrial, { type: "ai_trial", id: randomUUID(), fieldKey: "text" });
  await log(ids.logAnswer, { type: "field_answer", id: randomUUID(), fieldKey: "text" });
  await log(
    ids.logError,
    { type: "field_answer", id: randomUUID(), fieldKey: "text" },
    { outcome: "error", errorCode: "timeout" },
  );
  await log(
    ids.logDeleted,
    { type: "ai_trial", id: randomUUID(), fieldKey: "text" },
    { deleted: true },
  );
}

const SNAPSHOT_TABLES = [
  "organizations",
  "employees",
  "assignments",
  "template_versions",
  "reports",
  "ai_usage_log",
] as const;
const ADDED: Record<string, string[]> = {
  reports: ["summary_text", "summary_basis"],
  ai_usage_log: ["candidate_refs", "chosen_candidate"],
};

type Snapshot = Record<string, Record<string, unknown>[]>;

async function snapshot(sql: Sql): Promise<Snapshot> {
  const out: Snapshot = {};
  for (const table of SNAPSHOT_TABLES) {
    out[table] = await sql<Record<string, unknown>[]>`select * from ${sql(table)} order by id`;
  }
  return out;
}

function withoutColumns(rows: Record<string, unknown>[] | undefined, columns: string[]) {
  return (rows ?? []).map((row) => {
    const copy = { ...row };
    for (const column of columns) delete copy[column];
    return copy;
  });
}

let migrated: Sql | undefined;
let before: Snapshot;
let after: Snapshot;
let migrationError: unknown;

describe("K3.4 migreringen på en database med data", () => {
  beforeAll(async () => {
    admin = postgres(testDatabaseUrl(), { max: 1, onnotice: () => {} });
    const created = await databaseBeforeKi();
    migrated = created.sql;
    await seed(migrated);
    before = await snapshot(migrated);
    migrationError = await runMigrations(urlFor(created.name)).then(
      () => null,
      (error: unknown) => error,
    );
    after = await snapshot(migrated);
  }, 240_000);

  afterAll(async () => {
    await migrated?.end();
    if (admin) {
      for (const name of databases) {
        await admin.unsafe(`drop database if exists "${name}" with (force)`);
      }
      await admin.end();
    }
    for (const folder of folders) rmSync(folder, { recursive: true, force: true });
  }, 60_000);

  it("K3.4 kjører uten feil", () => {
    expect(migrationError).toBeNull();
  });

  it("K3.4 dataene er med (testen prøver noe)", () => {
    expect(before.reports).toHaveLength(1);
    expect(before.ai_usage_log).toHaveLength(4);
  });

  it.each(SNAPSHOT_TABLES)("K3.4 %s: ingen rad er slettet eller endret", (table) => {
    expect(withoutColumns(after[table], ADDED[table] ?? [])).toEqual(before[table]);
  });

  it("K3.4 de nye kolonnene er tomme på gamle rader", () => {
    for (const row of after.reports ?? []) {
      expect(row.summary_text).toBeNull();
      expect(row.summary_basis).toBeNull();
    }
    for (const row of after.ai_usage_log ?? []) {
      expect(row.candidate_refs).toBeNull();
      expect(row.chosen_candidate).toBeNull();
    }
  });
});

describe("K3.4 kilden til migreringen", () => {
  it("K3.4 ingen DELETE, ingen UPDATE på ai_usage_log og ingen ON DELETE CASCADE", () => {
    const source = readFileSync(join(MIGRATIONS_FOLDER, `${tags().ki}.sql`), "utf8");
    expect(source).not.toMatch(/\bdelete\s+from\b/i);
    expect(source).not.toMatch(/\bupdate\s+"?ai_usage_log"?/i);
    expect(source).not.toMatch(/on\s+delete\s+cascade/i);
    expect(source).not.toMatch(/\bdrop\s+(table|column)\b/i);
  });

  it("K3.4 nummeret er 0037 eller senere, og ingen kollisjon i journalen (også mot reklamasjonskobling)", () => {
    const entries = journal().entries;
    const ki = entries.find((entry) => KI_TAG_PATTERN.test(entry.tag));
    expect(ki).toBeDefined();
    expect(ki!.idx).toBeGreaterThanOrEqual(37);
    expect(entries.filter((entry) => KI_TAG_PATTERN.test(entry.tag))).toHaveLength(1);
    const numbers = entries.map((entry) => entry.tag.slice(0, 4));
    expect(new Set(numbers).size).toBe(numbers.length);
    for (const entry of entries) {
      expect(Number(entry.tag.slice(0, 4)), entry.tag).toBe(entry.idx);
    }
    const claimLink = entries.find((entry) => /reklamasjonskobling/.test(entry.tag));
    if (claimLink) expect(claimLink.idx).not.toBe(ki!.idx);
  });
});
