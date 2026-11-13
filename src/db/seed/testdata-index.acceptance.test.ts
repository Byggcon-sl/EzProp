import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { resetDatabase } from "../../../tests/factories";
import { runSeed } from "./run";
import {
  TESTDATA_FIRST_NAMES,
  TESTDATA_LAST_NAMES,
  TESTDATA_SEED,
  TESTDATA_STREET_NAMES,
} from "./testdata.data";

/*
 * Inngangen `pnpm db:seed:testdata` (`src/db/seed/testdata-index.ts`) og loggen. Testplan:
 * docs/funksjoner/fase2a-testdata-arbeidshverdag-testplan.md avsnitt 5.
 *
 * Inngangen kjøres som egen prosess, slik utrullingen kjører den, mot testdatabasen
 * (`DATABASE_URL` fra `tests/setup-env.ts`). Utskriften (stdout og stderr) fanges. En databasefeil
 * midt i en TD-ordre lages med en midlertidig trigger. Alle data er oppdiktet.
 *
 * Støtter hovedmål: de ansatte og færre reklamasjoner (loggen i utrullingen viser aldri navn,
 * e-post, telefon, gatenavn eller databasevert, og en feil gir kode 1 slik at utrullingen stopper).
 */

vi.setConfig({ testTimeout: 300_000, hookTimeout: 120_000 });

const env = { SEED_ADMIN_EMAIL: "admin@example.com", SEED_ADMIN_NAME: "Test Admin" };

type Run = { code: number | null; output: string };

/** Kjører inngangen som egen prosess og gir utskriften (stdout og stderr) og koden. */
function runCli(extraEnv: Record<string, string> = {}): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      join(process.cwd(), "node_modules/.bin/tsx"),
      [join(process.cwd(), "src/db/seed/testdata-index.ts")],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: "test",
          APP_ENVIRONMENT: "test",
          ...extraEnv,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
}

async function count(query: ReturnType<typeof sql>): Promise<number> {
  const [row] = (await db.execute(query)) as unknown as { n: number }[];
  return row?.n ?? -1;
}

async function totalRows(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of ["users", "employees", "orders", "assignments", "audit_log", "events"]) {
    out[table] = await count(sql`select count(*)::int as n from ${sql.identifier(table)}`);
  }
  out.sequence = await count(
    sql`select coalesce(sum(next_value), 0)::int as n from number_sequences`,
  );
  return out;
}

/** Utskriften har ingen personopplysninger eller vertsnavn. */
function expectNoPersonalData(output: string) {
  expect(output).not.toContain("@");
  for (const name of [...TESTDATA_FIRST_NAMES, ...TESTDATA_LAST_NAMES, ...TESTDATA_STREET_NAMES]) {
    expect(output, `«${name}» i utskriften`).not.toMatch(
      new RegExp(`(^|[^\\p{L}])${name}($|[^\\p{L}])`, "u"),
    );
  }
  expect(output).not.toMatch(/\+47|\b000 \d{2} \d{3}\b/);
  const url = new URL(process.env.DATABASE_URL!);
  expect(output).not.toContain(url.hostname);
  if (url.password) expect(output).not.toContain(url.password);
  expect(output).not.toContain("postgres://");
}

beforeEach(async () => {
  await resetDatabase();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("testdata: inngangen og loggen (5)", () => {
  it("5.1 vellykket kjøring logger bare antall og TD-nøkler, og gir kode 0", async () => {
    await runSeed(env);
    const first = await runCli();
    expect(first.code, first.output).toBe(0);
    expectNoPersonalData(first.output);
    expect(first.output).toMatch(/\d/);
    expect(
      await count(sql`select count(*)::int as n from orders where external_ref like 'TD-%'`),
    ).toBeGreaterThan(40);
    // Andre kjøring er også ren
    const second = await runCli();
    expect(second.code, second.output).toBe(0);
    expectNoPersonalData(second.output);
  });

  it("5.2 påtvunget databasefeil i en TD-ordre: feiltype, SQLSTATE og TD-nøkkel, ingen verdier, kode 1", async () => {
    await runSeed(env);
    await db.execute(
      sql.raw(`create or replace function testdata_index_fail() returns trigger language plpgsql as $$
        begin
          if new.external_ref = 'TD-0021' then
            raise exception 'påtvunget feil i testen' using errcode = '23514';
          end if;
          return new;
        end $$`),
    );
    await db.execute(
      sql.raw(`create trigger testdata_index_fail before insert on orders
        for each row execute function testdata_index_fail()`),
    );
    let run: Run;
    try {
      run = await runCli();
    } finally {
      await db.execute(sql.raw(`drop trigger if exists testdata_index_fail on orders`));
      await db.execute(sql.raw(`drop function if exists testdata_index_fail()`));
    }
    expect(run.code, run.output).toBe(1);
    expect(run.output).toContain("23514");
    expect(run.output).toMatch(/TD-\d{4}/);
    expectNoPersonalData(run.output);
    // Ingen stakk og ingen spørringsparametre
    expect(run.output).not.toMatch(/\n\s+at\s+\S+/);
    expect(run.output).not.toMatch(/params|parameters|\$\d/i);
    expect(run.output).not.toMatch(/insert into/i);
  });

  it.each([
    ["APP_ENVIRONMENT=production", { APP_ENVIRONMENT: "production" }],
    [
      "produksjonsverten",
      {
        DATABASE_URL:
          "postgres://oppdiktet:hemmelig-pw-9@psql-ezprop-prod.postgres.database.azure.com:5432/ezprop",
      },
    ],
  ])(
    "5.3 vaktfeil (%s): norsk melding uten adresse eller vert, kode 1, ingen skriving",
    async (_, extra) => {
      await runSeed(env);
      const before = await totalRows();
      const run = await runCli(extra);
      expect(run.code, run.output).toBe(1);
      expect(run.output).toMatch(/Testdata kan /);
      expect(run.output).not.toContain("psql-ezprop-prod");
      expect(run.output).not.toContain("hemmelig-pw-9");
      expect(run.output).not.toContain("oppdiktet:");
      expectNoPersonalData(run.output);
      expect(run.output).not.toMatch(/\n\s+at\s+\S+/);
      expect(await totalRows()).toEqual(before);
    },
  );

  it("5.3 Byggcon mangler: norsk melding og kode 1", async () => {
    const run = await runCli();
    expect(run.code, run.output).toBe(1);
    expect(run.output).toContain("Kjør pnpm db:seed først.");
    expectNoPersonalData(run.output);
  });

  it("5.4 inngangen sender new Date() og det faste frøet", () => {
    const source = readFileSync(join(process.cwd(), "src/db/seed/testdata-index.ts"), "utf8");
    expect(source).toMatch(/new Date\(\)/);
    expect(source).toMatch(/\bTESTDATA_SEED\b/);
    expect(source).not.toMatch(/Math\.random|Date\.now/);
    // Kode 1 ved feil: `runTestdataCli` returnerer 1 (kjøres i 5.3 og i enhetstesten).
    expect(source).toMatch(
      /process\.exit(Code)?\s*(\(\s*1\s*\)|=\s*1|\(\s*await\s+runTestdataCli\(\)\s*\))/,
    );
    expect(TESTDATA_SEED).toBeTypeOf("number");
  });
});
