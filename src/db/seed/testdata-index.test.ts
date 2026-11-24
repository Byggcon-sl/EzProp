import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { resetEnvCache } from "@/shared/config/env";
import { TEST_NOW, createTemplate, resetDatabase } from "../../../tests/factories";
import { runSeed } from "./run";
import { buildTestdataPlan } from "./testdata";
import { TESTDATA_HOST_MESSAGE } from "./testdata-guard";
import { TESTDATA_TABLES } from "./testdata";
import { findTestdataOrganization } from "./testdata-anchor";
import { planTestdataBaths } from "./testdata-bath";
import { MANDATORY_BATH_SCENARIO_KEYS, bathScenarioByKey } from "./testdata-bath.data";
import { runTestdataCli, summaryLines, type TestdataCliDeps } from "./testdata-index";
import { wetRoomTemplate } from "./templates/wet-room";
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

// --- Testdata del 2: badene i oppsummeringen (docs/funksjoner/fase2a-testdata-del-2-testplan.md seksjon 4)

describe("oppsummeringen med badene", { timeout: 300_000 }, () => {
  it("4.1 TESTDATA_TABLES har de sju nye tabellene", () => {
    for (const table of [
      "reports",
      "fieldAnswers",
      "checkpointResults",
      "deviations",
      "deviationMeasures",
      "tgiuDetails",
      "ruleSuggestionDecisions",
    ]) {
      expect(TESTDATA_TABLES).toContain(table);
    }
  });

  it("4.1 uten publisert systemmal sier oppsummeringen at badene ikke er fylt ut", async () => {
    const { deps, output } = capture();
    expect(await runTestdataCli(deps)).toBe(0);
    expect(output()).toMatch(
      /Badene er ikke fylt ut: organisasjonen har ingen publisert systemmal/,
    );
    expectClean(output());
  });

  it("4.2–4.3 antall per ny tabell, bad fylt ut og hoppet over, og scenariokartet uten persondata", async () => {
    const organization = await findTestdataOrganization(db);
    await createTemplate(organization!.id, {
      status: "published",
      document: wetRoomTemplate,
      name: "Tilstandsrapport",
    });
    const first = capture();
    expect(await runTestdataCli(first.deps)).toBe(0);
    const out = first.output();
    for (const label of [
      "Rapporter",
      "Svar i rapportene",
      "Kontrollpunkt i rapportene",
      "Avvik",
      "Tiltak",
      "TGIU-opplysninger",
      "Beslutninger på regelforslag",
    ]) {
      expect(out).toMatch(new RegExp(`log: ${label}: [1-9]\\d* nye, 0 fantes fra før`));
    }
    expect(out).toMatch(/log: Bad fylt ut: [1-9]\d*/);
    expect(out).toMatch(/log: Bad hoppet over \(hadde svar fra før\): 0/);

    // Én linje per pliktig scenario, lik fordelingen
    const placements = await planTestdataBaths({
      db,
      organizationId: organization!.id,
      seed: TESTDATA_SEED,
      now: TEST_NOW,
    });
    for (const key of MANDATORY_BATH_SCENARIO_KEYS) {
      const placed = placements.find((p) => p.scenarioKey === key)!;
      expect(out).toContain(
        `log: ${bathScenarioByKey(key).name}: oppdrag ${placed.bath.assignmentLabel}, ${placed.bath.roomName}`,
      );
    }
    expect(out).toMatch(/log: Visningsbad: oppdrag \d{4}-\d+, /);
    expectClean(out);

    const second = capture();
    expect(await runTestdataCli(second.deps)).toBe(0);
    expect(second.output()).toMatch(/log: Bad fylt ut: 0/);
    expect(second.output()).toMatch(/log: Bad hoppet over \(hadde svar fra før\): [1-9]\d*/);
    expectClean(second.output());
  });

  it("4.3 linjene fra summaryLines har ingen @, navn eller adresse", () => {
    const lines = summaryLines({
      created: Object.fromEntries(TESTDATA_TABLES.map((t) => [t, 1])) as never,
      existing: Object.fromEntries(TESTDATA_TABLES.map((t) => [t, 0])) as never,
      skippedOrders: [],
      bathsFilled: 2,
      bathsSkipped: 1,
      bathsWithoutAccess: 0,
      bathTemplatePublished: true,
      bathScenarioMap: [
        {
          scenarioKey: "showcase",
          scenarioName: "Visningsbad",
          assignmentNumber: "2026-0012",
          roomName: "Bad 1",
        },
      ],
    });
    expect(lines).toContain("Visningsbad: oppdrag 2026-0012, Bad 1");
    expectClean(lines.join("\n"));
  });
});
