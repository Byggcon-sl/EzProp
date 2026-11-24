import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EVAL_NOTE,
  EVAL_STATUS,
  makeCasesDir,
  okResult,
  removeDir,
  testProvider,
} from "../../../../tests/evals";
import { fakeAiProvider } from "../providers/fake";
import {
  evaluateOutcomeMatch,
  FAKE_PROVIDER_NOTICE,
  runEvalCommand,
  runEvals,
  EvalProviderNotAllowedError,
} from "./run";
import { parseCasesFile, type OutcomeMatchEvalCase } from "./schema";

/*
 * Kjøreren for `outcome_match` («Skriv det du ser», docs/funksjoner/fase2a-skriv-det-du-ser-
 * testplan.md S2.3 og S2.7). Ren test, ingen database. Vurderingen (any, all, first, none) prøves
 * med en tabell, kjøringen med et oppdiktet sett i en midlertidig mappe. Saker med fasit «ingen
 * passer» (hulltaking ikke utført, normal slitasje) må bestå hver for seg: én bom gir
 * avslutningskode 1, også mot den falske leverandøren. Resultatet mot den falske leverandøren
 * viser ikke kvaliteten på KI (T-0047).
 *
 * Når selve settet (`outcome_match.cases.json`) ligger i mappen, kjøres hver «ingen passer»-sak i
 * det som egen test mot den falske leverandøren (nederst).
 *
 * Støtter hovedmål: KI i bunnen (funksjonen måles før ekte KI slås på) og færre reklamasjoner (et
 * utfall foreslås aldri der det ikke finnes avvik, og en samlet prosent kan ikke skjule det).
 */

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) removeDir(dir);
  dirs = [];
});

function dirWith(files: Record<string, unknown>): string {
  const dir = makeCasesDir(files);
  dirs.push(dir);
  return dir;
}

// --- Oppdiktede kandidater og saker ---------------------------------------------------------

const CANDIDATES = [
  {
    id: "floor-crack",
    source: "template_outcome",
    checkpointKey: "bad.gulv",
    outcomeKey: "bad.gulv.sprekk",
    text: "Gulv | Er flisene på gulvet sprukket? | Flisene på gulvet har sprekker.",
  },
  {
    id: "wall-crack",
    source: "template_outcome",
    checkpointKey: "bad.vegg",
    outcomeKey: "bad.vegg.sprekk",
    text: "Vegger og himling | Er flisene på veggen sprukket? | Flisene på veggen har sprekker.",
  },
  {
    id: "drain-ring",
    source: "template_outcome",
    checkpointKey: "bad.sluk",
    outcomeKey: "bad.sluk.klemring",
    text: "Sluk | Mangler klemringen i sluket? | Klemringen i sluket mangler.",
  },
  {
    id: "weak-fan",
    source: "template_outcome",
    checkpointKey: "bad.ventilasjon",
    outcomeKey: "bad.ventilasjon.svak",
    text: "Ventilasjon | Er avtrekket svakt? | Avtrekket fra rommet er svakt.",
  },
];

type FixtureCase = {
  id: string;
  fields: { text: string };
  candidates: typeof CANDIDATES;
  expect: { require: "any" | "all" | "first" | "none"; ids: string[] };
};

const NOTES: { note: string; require: FixtureCase["expect"]["require"]; ids: string[] }[] = [
  { note: "sprukne fliser på gulvet ved sluket", require: "first", ids: ["floor-crack"] },
  { note: "sprekker i flisene på veggen", require: "first", ids: ["wall-crack"] },
  { note: "sprekk i flisene", require: "all", ids: ["floor-crack", "wall-crack"] },
  { note: "klemring mangler i sluk", require: "any", ids: ["drain-ring"] },
  { note: "svakt avtrekk, dette er TG2", require: "any", ids: ["weak-fan"] },
  { note: "hulltaking ikke utført, eier nektet", require: "none", ids: [] },
  { note: "fikk ikke tatt hull, vegg mot betong", require: "none", ids: [] },
  { note: "små bruksmerker på innredningen", require: "none", ids: [] },
];

function fixtureCases(count = 30): FixtureCase[] {
  return Array.from({ length: count }, (_, index) => {
    const spec = NOTES[index % NOTES.length]!;
    return {
      id: `om-${String(index + 1).padStart(2, "0")}`,
      fields: { text: spec.note },
      candidates: CANDIDATES,
      expect: { require: spec.require, ids: spec.ids },
    };
  });
}

function fixtureFile(cases: FixtureCase[] = fixtureCases()) {
  return { feature: "outcome_match", status: EVAL_STATUS, note: EVAL_NOTE, cases };
}

// --- Vurderingen -----------------------------------------------------------------------------

describe("evaluateOutcomeMatch: fasiten any, all, first og none", () => {
  it.each([
    { require: "any", ids: ["a"], ranked: ["b", "a"], passed: true },
    { require: "any", ids: ["a"], ranked: ["b", "c", "d", "a"], passed: false },
    { require: "any", ids: ["a"], ranked: [], passed: false },
    { require: "all", ids: ["a", "b"], ranked: ["b", "c", "a"], passed: true },
    { require: "all", ids: ["a", "b"], ranked: ["a", "c"], passed: false },
    { require: "first", ids: ["a"], ranked: ["a", "b"], passed: true },
    { require: "first", ids: ["a"], ranked: ["b", "a"], passed: false },
    { require: "first", ids: ["a"], ranked: [], passed: false },
    { require: "none", ids: [], ranked: [], passed: true },
    { require: "none", ids: [], ranked: ["a"], passed: false },
  ] as const)("$require $ids mot $ranked gir $passed", ({ require, ids, ranked, passed }) => {
    expect(evaluateOutcomeMatch({ require, ids: [...ids] }, ranked).passed).toBe(passed);
  });
});

// --- Kjøringen -------------------------------------------------------------------------------

describe("S2.7 pnpm ai:eval outcome_match mot et oppdiktet sett", () => {
  it("skjemaet godtar formatet, og none-saker kan ikke ha fasit", () => {
    expect(parseCasesFile(fixtureFile(), "outcome_match.cases.json").ok).toBe(true);
    const wrong = fixtureCases();
    wrong[5] = { ...wrong[5]!, expect: { require: "none", ids: ["floor-crack"] } };
    expect(parseCasesFile(fixtureFile(wrong), "outcome_match.cases.json").ok).toBe(false);
    const unknown = fixtureCases();
    unknown[0] = { ...unknown[0]!, expect: { require: "any", ids: ["finnes-ikke"] } };
    expect(parseCasesFile(fixtureFile(unknown), "outcome_match.cases.json").ok).toBe(false);
  });

  it("mot den falske leverandøren: alle saker består, ingen krasj, ingen persondata", async () => {
    const dir = dirWith({ "outcome_match.cases.json": fixtureFile() });
    const result = await runEvals({
      provider: fakeAiProvider,
      casesDir: dir,
      feature: "outcome_match",
    });
    expect(result.errors).toEqual([]);
    const feature = result.features[0]!;
    expect(feature.feature).toBe("outcome_match");
    expect(feature.misses).toEqual([]);
    expect(feature.crashes).toEqual([]);
    expect(feature.leaks).toEqual([]);
    expect(feature.requiredMisses).toEqual([]);
    expect(feature.passed).toBe(feature.total);
  });

  it("utskriften sier først at resultatet mot den falske leverandøren ikke viser kvalitet (T-0047)", async () => {
    const dir = dirWith({ "outcome_match.cases.json": fixtureFile() });
    const { exitCode, lines } = await runEvalCommand(["outcome_match"], dir, fakeAiProvider);
    expect(exitCode).toBe(0);
    expect(lines[0]).toBe(FAKE_PROVIDER_NOTICE);
    expect(lines.join("\n")).toMatch(/outcome_match: 30 eksempler/u);
    // Notatene og kandidattekstene skrives aldri ut
    expect(lines.join("\n")).not.toMatch(/hulltaking|bruksmerker|Klemringen/u);
  });

  it("hver «ingen passer»-sak må bestå for seg: én bom gir avslutningskode 1 selv med høy treffprosent", async () => {
    // Svarer K1 bare på notatet om bruksmerker; alt annet som den falske leverandøren
    const provider = testProvider(async (input, request) =>
      input.includes("bruksmerker") ? okResult("K1") : fakeAiProvider.complete(request),
    );
    const dir = dirWith({ "outcome_match.cases.json": fixtureFile() });
    const result = await runEvals({ provider, casesDir: dir, feature: "outcome_match" });
    const feature = result.features[0]!;
    const wearIds = fixtureCases()
      .filter((item) => item.fields.text.includes("bruksmerker"))
      .map((item) => item.id);
    expect(feature.requiredMisses).toEqual(wearIds);
    expect(feature.passRate).toBeGreaterThan(0.8);

    const { exitCode, lines } = await runEvalCommand(["outcome_match"], dir, provider);
    expect(exitCode).toBe(1);
    for (const id of wearIds) {
      expect(lines).toContain(
        `  Må bestå for seg ${id}: fasiten er «ingen passer», men det kom treff.`,
      );
    }
  });

  it("bom på en sak med treff som fasit gir ikke avslutningskode 1 (A183)", async () => {
    const provider = testProvider(async (input, request) =>
      input.includes("klemring") ? okResult("ingen") : fakeAiProvider.complete(request),
    );
    const dir = dirWith({ "outcome_match.cases.json": fixtureFile() });
    const { exitCode } = await runEvalCommand(["outcome_match"], dir, provider);
    expect(exitCode).toBe(0);
  });

  it("bare de tre første teller: et riktig utfall på fjerdeplass er bom", async () => {
    const provider = testProvider(async () => okResult("K2, K3, K4, K1"));
    const cases = fixtureCases().map((item) =>
      item.expect.require === "none"
        ? item
        : { ...item, expect: { require: "any" as const, ids: ["floor-crack"] } },
    );
    const dir = dirWith({ "outcome_match.cases.json": fixtureFile(cases) });
    const result = await runEvals({ provider, casesDir: dir, feature: "outcome_match" });
    const positives = cases.filter((item) => item.expect.require !== "none").length;
    expect(result.features[0]!.misses.length).toBeGreaterThanOrEqual(positives);
  });

  it("en ekte leverandør kalles aldri", async () => {
    const dir = dirWith({ "outcome_match.cases.json": fixtureFile() });
    await expect(
      runEvals({
        provider: { ...fakeAiProvider, code: "anthropic" },
        casesDir: dir,
        feature: "outcome_match",
      }),
    ).rejects.toBeInstanceOf(EvalProviderNotAllowedError);
  });
});

// --- Selve settet --------------------------------------------------------------------------

const SET_FILE = join(__dirname, "outcome_match.cases.json");
const setCases: OutcomeMatchEvalCase[] = (() => {
  if (!existsSync(SET_FILE)) return [];
  const parsed = parseCasesFile(
    JSON.parse(readFileSync(SET_FILE, "utf8")) as unknown,
    "outcome_match.cases.json",
  );
  return parsed.ok && parsed.file.feature === "outcome_match" ? parsed.file.cases : [];
})();

// Vises som hoppet over (ikke stille) til settet ligger i mappen; `schema.test.ts` krever filen
describe.skipIf(setCases.length === 0)(
  "S2.3 settet: hver «ingen passer»-sak består for seg mot den falske leverandøren",
  () => {
    const noneCases = setCases.filter((item) => item.expect.require === "none");

    it.each(noneCases.map((item) => [item.id, item] as const))("%s", async (_id, item) => {
      const dir = dirWith({
        "outcome_match.cases.json": {
          feature: "outcome_match",
          status: EVAL_STATUS,
          note: EVAL_NOTE,
          // Skjemaet krever minst 30 saker; samme sak gjentatt med egne id-er
          cases: Array.from({ length: 30 }, (_, index) => ({ ...item, id: `${item.id}-${index}` })),
        },
      });
      const result = await runEvals({
        provider: fakeAiProvider,
        casesDir: dir,
        feature: "outcome_match",
      });
      expect(result.errors).toEqual([]);
      expect(result.features[0]!.requiredMisses).toEqual([]);
    });
  },
);
