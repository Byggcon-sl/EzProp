import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { resetEnvCache } from "@/shared/config/env";
import { TEST_NOW, resetDatabase } from "../../../tests/factories";
import { runSeed } from "./run";
import { buildTestdataPlan } from "./testdata";
import { TESTDATA_HOST_MESSAGE } from "./testdata-guard";
import { runTestdataCli, type TestdataCliDeps } from "./testdata-index";
import {
  TESTDATA_FIRST_NAMES,
  TESTDATA_LAST_NAMES,
  TESTDATA_SEED,
  TESTDATA_STREET_NAMES,
} from "./testdata.data";

/*
 * Inngangen for `pnpm db:seed:testdata` og loggen (testplan seksjon 5). Loggen skal bare ha antall
 * og `TD-`-nøkler: ingen e-post, navn, gatenavn, telefon, vert, parametre eller stakk.
 * Støtter hovedmål: trygghet for de ansatte (ingen personopplysninger i driftsloggen).
 */

const failure = vi.hoisted(() => ({ ref: null as string | null }));

vi.mock("@/core/orders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/orders")>();
  return {
    ...actual,
    createOrder: async (...args: Parameters<typeof actual.createOrder>) => {
      if (failure.ref !== null && args[2].externalRef === failure.ref) {
        // Ligner en databasefeil med verdier i meldingen, som aldri skal skrives ut
        const error = new Error(
          "new row violates check constraint, Failing row contains (ola.testvik@testdata.invalid, Prøvegata 12) on host psql-ezprop-test.postgres.database.azure.com",
        ) as Error & { code: string; parameters: unknown[] };
        error.code = "23514";
        error.parameters = ["ola.testvik@testdata.invalid", "+47 000 12 345"];
        throw error;
      }
      return actual.createOrder(...args);
    },
  };
});

const SEED_ENV = { SEED_ADMIN_EMAIL: "admin@example.com", SEED_ADMIN_NAME: "Test Admin" };
const FULL_RUN = 120_000;

function capture(): { deps: TestdataCliDeps; output: () => string } {
  const lines: string[] = [];
  return {
    deps: {
      db,
      now: () => TEST_NOW,
      seed: TESTDATA_SEED,
      log: (message) => lines.push(`log: ${message}`),
      error: (message) => lines.push(`error: ${message}`),
    },
    output: () => lines.join("\n"),
  };
}

/** Ingen personopplysninger, adresser eller tekniske detaljer fra databasen i utskriften. */
function expectClean(output: string) {
  expect(output).not.toContain("@");
  expect(output).not.toMatch(/\+47|000 \d\d \d{3}/);
  expect(output).not.toMatch(/psql|localhost|postgres:|azure\.com/i);
  expect(output).not.toMatch(/\n\s+at |\.ts:\d+/);
  const plan = buildTestdataPlan({ seed: TESTDATA_SEED, anchor: TEST_NOW });
  const words = new Set<string>([
    ...TESTDATA_FIRST_NAMES,
    ...TESTDATA_LAST_NAMES,
    ...TESTDATA_STREET_NAMES,
    ...plan.employees.map((e) => e.name),
    ...plan.contacts.map((c) => c.name),
  ]);
  for (const word of words) expect(output).not.toContain(word);
}

beforeEach(async () => {
  failure.ref = null;
  vi.spyOn(console, "log").mockImplementation(() => {});
  await resetDatabase();
  await runSeed(SEED_ENV);
});
afterEach(() => vi.restoreAllMocks());

describe("runTestdataCli", { timeout: FULL_RUN }, () => {
  it("5.1 vellykket kjøring logger bare antall og TD-nøkler, og gir 0", async () => {
    const { deps, output } = capture();
    expect(await runTestdataCli(deps)).toBe(0);
    expect(output()).toMatch(/Ordre: \d+ nye/);
    expect(output()).not.toContain("error:");
    expectClean(output());
  });

  it("5.2 påtvunget databasefeil: bare feiltype, SQLSTATE og TD-nøkkel, og kode 1", async () => {
    failure.ref = "TD-0003";
    const { deps, output } = capture();
    expect(await runTestdataCli(deps)).toBe(1);
    expect(output()).toContain("TD-0003");
    expect(output()).toContain("SQLSTATE 23514");
    expect(output()).toContain("Error");
    expect(output()).not.toMatch(/violates|Failing row|Prøvegata/);
    expectClean(output());
  });

  it("5.3 vaktfeil: den norske meldingen uten adresse eller vert, og kode 1", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://bruker:hemmelig@psql-ezprop-prod.example.com:5432/x");
    resetEnvCache();
    try {
      const { deps, output } = capture();
      expect(await runTestdataCli(deps)).toBe(1);
      expect(output()).toContain(TESTDATA_HOST_MESSAGE);
      expect(output()).not.toMatch(/hemmelig|bruker:|example\.com/);
      expectClean(output());
    } finally {
      vi.unstubAllEnvs();
      resetEnvCache();
    }
  });

  it("5.4 inngangen sender dagens tid og det faste frøet", () => {
    const source = readFileSync(new URL("./testdata-index.ts", import.meta.url), "utf8");
    expect(source).toMatch(/now: \(\) => new Date\(\)/);
    expect(source).toMatch(/seed: TESTDATA_SEED/);
    expect(source).toMatch(/process\.exit\(await runTestdataCli\(\)\)/);
  });
});
