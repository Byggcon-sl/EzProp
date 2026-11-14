import { spawn } from "node:child_process";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { resetDatabase } from "../../../tests/factories";
import { runSeed } from "./run";
import { runSampleCli } from "./sample-index";
import {
  TESTDATA_ENVIRONMENT_MESSAGE,
  TESTDATA_HOST_MESSAGE,
  TestdataNotAllowedError,
} from "./testdata-guard";

/*
 * Inngangen `pnpm db:seed:testoppdrag` (`src/db/seed/sample-index.ts`) kjører produksjonsvakten
 * (`testdata-guard.ts`, A302) før første skriving. Selve vakten er testet i
 * `testdata-guard.test.ts`; her prøves at inngangen bruker den, stopper uten å skrive, og at
 * utskriften aldri viser vert, brukernavn eller passord. Alle data er oppdiktet.
 *
 * Støtter hovedmål: færre reklamasjoner og trygghet for de ansatte (oppdiktede oppdrag kan aldri
 * havne i produksjonsdatabasen, og utrullingen stopper med kode 1).
 */

vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });

const env = { SEED_ADMIN_EMAIL: "admin@example.com", SEED_ADMIN_NAME: "Test Admin" };

describe("runSampleCli", () => {
  it("kjører vakten før testoppdragene", async () => {
    const calls: string[] = [];
    const code = await runSampleCli({
      guard: () => calls.push("vakt"),
      run: async () => calls.push("testoppdrag"),
      error: (message) => calls.push(`feil: ${message}`),
    });
    expect(code).toBe(0);
    expect(calls).toEqual(["vakt", "testoppdrag"]);
  });

  it("stopper med kode 1 og norsk melding når vakten sier nei, uten å skrive", async () => {
    const run = vi.fn(async () => undefined);
    const errors: string[] = [];
    const code = await runSampleCli({
      guard: () => {
        throw new TestdataNotAllowedError(TESTDATA_HOST_MESSAGE);
      },
      run,
      error: (message) => errors.push(message),
    });
    expect(code).toBe(1);
    expect(run).not.toHaveBeenCalled();
    expect(errors).toEqual([`Testoppdrag ble ikke lagt inn: ${TESTDATA_HOST_MESSAGE}`]);
  });

  it("slipper andre feil i vakten videre", async () => {
    const run = vi.fn(async () => undefined);
    await expect(
      runSampleCli({
        guard: () => {
          throw new Error("uventet");
        },
        run,
        error: () => undefined,
      }),
    ).rejects.toThrow("uventet");
    expect(run).not.toHaveBeenCalled();
  });
});

type Run = { code: number | null; output: string };

/** Kjører inngangen som egen prosess, slik utrullingen gjør, og gir utskriften og koden. */
function runCli(extraEnv: Record<string, string>): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      join(process.cwd(), "node_modules/.bin/tsx"),
      [join(process.cwd(), "src/db/seed/sample-index.ts")],
      {
        cwd: process.cwd(),
        env: { ...process.env, ...env, NODE_ENV: "test", APP_ENVIRONMENT: "test", ...extraEnv },
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

async function totalRows(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of [
    "organizations",
    "employees",
    "orders",
    "assignments",
    "template_versions",
  ]) {
    const [row] = (await db.execute(
      sql`select count(*)::int as n from ${sql.identifier(table)}`,
    )) as unknown as { n: number }[];
    out[table] = row?.n ?? -1;
  }
  return out;
}

describe("pnpm db:seed:testoppdrag som egen prosess", () => {
  beforeEach(async () => {
    await resetDatabase();
    await runSeed(env);
  });

  it.each([
    ["APP_ENVIRONMENT=production", { APP_ENVIRONMENT: "production" }, TESTDATA_ENVIRONMENT_MESSAGE],
    ["tom APP_ENVIRONMENT", { APP_ENVIRONMENT: "" }, TESTDATA_ENVIRONMENT_MESSAGE],
    [
      "produksjonsverten",
      {
        DATABASE_URL:
          "postgres://oppdiktet:hemmelig-pw-9@psql-ezprop-prod.postgres.database.azure.com:5432/ezprop",
      },
      TESTDATA_HOST_MESSAGE,
    ],
  ])(
    "vakten stopper (%s): kode 1, norsk melding uten vert, ingen skriving",
    async (_, extra, message) => {
      const before = await totalRows();
      const run = await runCli(extra);
      expect(run.code, run.output).toBe(1);
      expect(run.output).toContain(`Testoppdrag ble ikke lagt inn: ${message}`);
      expect(run.output).not.toContain("psql-ezprop-prod");
      expect(run.output).not.toContain("hemmelig-pw-9");
      expect(run.output).not.toContain("oppdiktet:");
      expect(run.output).not.toMatch(/\n\s+at\s+\S+/);
      expect(await totalRows()).toEqual(before);
    },
  );

  it("legger inn testoppdragene i testmiljøet", async () => {
    const before = await totalRows();
    const run = await runCli({});
    expect(run.code, run.output).toBe(0);
    expect(run.output).toContain("Testoppdrag sample:");
    const after = await totalRows();
    expect(after.assignments ?? 0).toBeGreaterThan(before.assignments ?? 0);
  });
});
