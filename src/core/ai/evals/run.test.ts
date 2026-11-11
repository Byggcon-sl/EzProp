import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PII_PLACEHOLDERS } from "@/shared/lib/pii-patterns";
import {
  evalCases,
  evalFile,
  makeCasesDir,
  okResult,
  removeDir,
  testProvider,
  type EvalCaseJson,
} from "../../../../tests/evals";
import { findLeakedKnownValues, findPatternLeaks, findPromptLeaks } from "../prompt-leaks";
import { createAnthropicProvider } from "../providers/anthropic";
import { fakeAiProvider } from "../providers/fake";
import type { AiProvider, AiProviderResult } from "../providers/types";
import { emptyKnownValues } from "../redact-text";
import * as run from "./run";
import { runEvalCommand, runEvals } from "./run";

/*
 * Vurderingen i kjøreren (docs/funksjoner/fase2a-evalueringssett-testplan.md avsnitt 2, kortet
 * Omfang 1 og 4). Ren test, ingen database. Leverandøren er en liten testleverandør bygd her
 * (fast svar, `error` eller kast) eller den falske. Alle tekster og verdier er oppdiktet.
 *
 * Støtter hovedmål: KI i bunnen (settet måler riktig: hele ord, TG og persondata) og færre
 * reklamasjoner (et svar som endrer «bør» til «må», legger til TG eller finner opp tall gir bom).
 */

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) removeDir(dirs.pop()!);
});

function dirWith(cases: EvalCaseJson[]): string {
  const dir = makeCasesDir({ "language_polish.cases.json": evalFile(cases) });
  dirs.push(dir);
  return dir;
}

async function runOnly(cases: EvalCaseJson[], provider: AiProvider) {
  const result = await runEvals({ provider, casesDir: dirWith(cases), feature: "language_polish" });
  expect(result.errors).toEqual([]);
  expect(result.features).toHaveLength(1);
  return result.features[0]!;
}

/**
 * Kjører 30 like eksempler (samme inndata og fasit) mot en leverandør som alltid svarer `answer`.
 * Gir om de traff, og grunnene ved bom.
 */
async function judge(
  expectation: EvalCaseJson["expect"],
  input: string,
  answer: AiProviderResult | string,
) {
  const result = typeof answer === "string" ? okResult(answer) : answer;
  const feature = await runOnly(
    evalCases(30, "j", (item) => ({ ...item, fields: { text: input }, expect: expectation })),
    testProvider(() => result),
  );
  expect(feature.leaks).toEqual([]);
  expect(feature.crashes).toEqual([]);
  expect([0, 30], "alle 30 like eksempler gir samme utfall").toContain(feature.passed);
  return {
    hit: feature.passed === 30,
    reasons: feature.misses.map((miss) => miss.reason),
  };
}

const NEUTRAL_INPUT = "Oppdiktet inndata om taket.";

describe("evalueringssett: vurderingen (E2)", () => {
  it("E2.1 treff når utfall, mustContain, mustNotContain og sameTg stemmer", async () => {
    const { hit, reasons } = await judge(
      { outcome: "ok", mustContain: ["bør", "TG2"], mustNotContain: ["må"], sameTg: true },
      "taket bør skiftes. TG2.",
      "Taket bør skiftes. TG2.",
    );
    expect(reasons).toEqual([]);
    expect(hit).toBe(true);
  });

  it("E2.1 utfallet no_match treffer når leverandøren svarer no_match", async () => {
    const { hit } = await judge({ outcome: "no_match" }, NEUTRAL_INPUT, {
      outcome: "no_match",
      tokensIn: 1,
      tokensOut: 0,
      cost: 0,
      currency: "NOK",
    });
    expect(hit).toBe(true);
  });

  it("E2.2 bom når fasiten venter ok og svaret er no_match, med grunn på norsk", async () => {
    const { hit, reasons } = await judge({ outcome: "ok" }, NEUTRAL_INPUT, {
      outcome: "no_match",
      tokensIn: 1,
      tokensOut: 0,
      cost: 0,
      currency: "NOK",
    });
    expect(hit).toBe(false);
    expect(reasons[0]).toMatch(/utfall/i);
  });

  it("E2.2 bom når fasiten venter no_match og svaret er ok, med grunn på norsk", async () => {
    const { hit, reasons } = await judge({ outcome: "no_match" }, NEUTRAL_INPUT, "Taket er fint.");
    expect(hit).toBe(false);
    expect(reasons[0]).toMatch(/utfall/i);
  });

  it("E2.3 bom når et ord i mustContain mangler; grunnen nevner ordet fra fasiten, ikke svaret", async () => {
    const answer = "Svarmarkør-qzx uten ordet.";
    const { hit, reasons } = await judge(
      { outcome: "ok", mustContain: ["vindskier"] },
      NEUTRAL_INPUT,
      answer,
    );
    expect(hit).toBe(false);
    expect(reasons[0]).toContain("vindskier");
    expect(reasons[0]).not.toContain("Svarmarkør-qzx");
  });

  it("E2.4 bom når et ord i mustNotContain står i svaret", async () => {
    const { hit, reasons } = await judge(
      { outcome: "ok", mustNotContain: ["må"] },
      "taket bør skiftes",
      "Taket må skiftes.",
    );
    expect(hit).toBe(false);
    expect(reasons[0]).toContain("må");
  });

  it.each([
    { word: "må", answer: "Det Må gjøres.", hit: true },
    { word: "Må", answer: "det må gjøres.", hit: true },
    { word: "må", answer: "Måling er gjort.", hit: false },
    { word: "bør", answer: "Bruk en børste.", hit: false },
    { word: "bør", answer: "Det bør, sier vi, gjøres.", hit: true },
    { word: "må", answer: "Det (må) gjøres.", hit: true },
    { word: "ødegård", answer: "Ødegård er nevnt.", hit: true },
    { word: "NS 3600", answer: "Etter NS  3600 er det gjort.", hit: true },
    { word: "NS 3600", answer: "Etter ns 3600 er det gjort.", hit: true },
    { word: "3600", answer: "Nummer 36001 står.", hit: false },
    { word: "12,5", answer: "Målt 112,5 mm.", hit: false },
    { word: "12,5", answer: "Målt 12,5 mm.", hit: true },
  ])("E2.5 mustContain «$word» mot «$answer» gir treff: $hit", async ({ word, answer, hit }) => {
    expect((await judge({ outcome: "ok", mustContain: [word] }, NEUTRAL_INPUT, answer)).hit).toBe(
      hit,
    );
  });

  it.each([
    { word: "må", answer: "Måling er gjort.", hit: true },
    { word: "bør", answer: "Bruk en børste.", hit: true },
    { word: "må", answer: "Det MÅ gjøres.", hit: false },
    { word: "NS 3600", answer: "Etter NS 3600.", hit: false },
  ])("E2.5 mustNotContain «$word» mot «$answer» gir treff: $hit", async ({ word, answer, hit }) => {
    expect(
      (await judge({ outcome: "ok", mustNotContain: [word] }, NEUTRAL_INPUT, answer)).hit,
    ).toBe(hit);
  });

  it.each([
    {
      name: "TG står uendret",
      input: "Taket er gammelt. TG2.",
      answer: "Taket er gammelt. TG2.",
      hit: true,
    },
    {
      name: "TG lagt til (inn uten TG, ut med TG3)",
      input: "Taket er gammelt.",
      answer: "Taket er gammelt. TG3.",
      hit: false,
    },
    {
      name: "TG2 blir TG 3",
      input: "Taket er gammelt. TG2.",
      answer: "Taket er gammelt. TG 3.",
      hit: false,
    },
    {
      name: "TG2 blir TG 2 (bare mellomrom)",
      input: "Taket er gammelt. TG2.",
      answer: "Taket er gammelt. TG 2.",
      hit: true,
    },
    {
      name: "TG 2 blir TG2 (bare mellomrom)",
      input: "Taket er gammelt. TG 2.",
      answer: "Taket er gammelt. TG2.",
      hit: true,
    },
    {
      name: "tg2 blir TG2 (små bokstaver)",
      input: "taket er gammelt, tg2",
      answer: "Taket er gammelt, TG2.",
      hit: true,
    },
    {
      name: "TG fjernet",
      input: "Taket er gammelt. TG2.",
      answer: "Taket er gammelt.",
      hit: false,
    },
    {
      name: "rekkefølgen byttet",
      input: "Tak TG2, vegg TG3.",
      answer: "Tak TG3, vegg TG2.",
      hit: false,
    },
    { name: "en TG til", input: "Tak TG2.", answer: "Tak TG2, og TG2.", hit: false },
    { name: "TGIU står", input: "TGIU, ikke utført.", answer: "TGIU, ikke utført.", hit: true },
    {
      name: "TGIU blir TG IU (bare mellomrom)",
      input: "TGIU, ikke utført.",
      answer: "TG IU, ikke utført.",
      hit: true,
    },
    { name: "TGIU blir TG2", input: "TGIU, ikke utført.", answer: "TG2, ikke utført.", hit: false },
  ])("E2.6 sameTg: $name gir treff: $hit", async ({ input, answer, hit }) => {
    expect((await judge({ outcome: "ok", sameTg: true }, input, answer)).hit).toBe(hit);
  });

  it.each([
    "TG0",
    "TG1",
    "TG2",
    "TG3",
    "TG 2",
    "tg2",
    "TGIU",
    "TG IU",
    "tilstandsgrad 2",
    "Tilstandsgrad",
  ])("E2.6 sameTg: «%s» telles som TG (lagt til gir bom, uendret gir treff)", async (variant) => {
    const added = await judge(
      { outcome: "ok", sameTg: true },
      "Taket er gammelt.",
      `Taket er gammelt. ${variant}.`,
    );
    expect(added.hit, "lagt til").toBe(false);
    const kept = await judge(
      { outcome: "ok", sameTg: true },
      `Taket er gammelt. ${variant}.`,
      `Taket er gammelt. ${variant}.`,
    );
    expect(kept.hit, "uendret").toBe(true);
  });

  it("E2.6 sameTg uten TG i inndata og svar gir treff", async () => {
    expect(
      (await judge({ outcome: "ok", sameTg: true }, "Taket er gammelt.", "Taket er gammelt.")).hit,
    ).toBe(true);
  });

  it("E2.7 treffprosent: 27 av 30 gir 90 %", async () => {
    const cases = evalCases(30, "p", (item, index) =>
      index < 3 ? { ...item, expect: { outcome: "ok", mustContain: ["vindskier"] } } : item,
    );
    const feature = await runOnly(cases, fakeAiProvider);
    expect(feature.total).toBe(30);
    expect(feature.passed).toBe(27);
    expect(feature.passRate).toBeCloseTo(0.9, 10);
    expect(feature.misses.map((miss) => miss.id)).toEqual(["p-01", "p-02", "p-03"]);
    const { lines } = await runEvalCommand(["language_polish"], dirWith(cases), fakeAiProvider);
    expect(lines.join("\n")).toMatch(/90\s?%/u);
  });

  it("E2.7 null eksempler gir 0 og ikke NaN", () => {
    const passRate = (run as Record<string, unknown>).passRate;
    expect(typeof passRate, "run.ts eksporterer passRate(passed, total)").toBe("function");
    const value = (passRate as (passed: number, total: number) => number)(0, 0);
    expect(Number.isNaN(value)).toBe(false);
    expect(value).toBe(0);
  });

  it("E2.8 mustPass telles for seg: bom på vanlige eksempler endrer ikke tallet", async () => {
    const cases = evalCases(30, "m", (item, index) => {
      if (index < 10) return { ...item, mustPass: true };
      if (index < 15) return { ...item, expect: { outcome: "ok", mustContain: ["vindskier"] } };
      return item;
    });
    const feature = await runOnly(cases, fakeAiProvider);
    expect(feature.mustPassTotal).toBe(10);
    expect(feature.mustPassPassed).toBe(10);
    expect(feature.passed).toBe(25);
    const { lines } = await runEvalCommand([], dirWith(cases), fakeAiProvider);
    expect(lines.join("\n")).toMatch(/mustPass\D*10 av 10/u);
  });

  it("E2.8 bom på et mustPass-eksempel teller i mustPass", async () => {
    const cases = evalCases(30, "m", (item, index) =>
      index < 2
        ? { ...item, mustPass: true, expect: { outcome: "ok", mustContain: ["vindskier"] } }
        : index < 5
          ? { ...item, mustPass: true }
          : item,
    );
    const feature = await runOnly(cases, fakeAiProvider);
    expect(feature.mustPassTotal).toBe(5);
    expect(feature.mustPassPassed).toBe(3);
  });

  it("E2.9 leverandøren svarer error: bom med grunn, og neste eksempel kjøres", async () => {
    const provider = testProvider((input) =>
      input.includes("t-05") ? { outcome: "error", errorCode: "unavailable" } : okResult(input),
    );
    const feature = await runOnly(evalCases(30), provider);
    expect(provider.prompts).toHaveLength(30);
    expect(feature.passed).toBe(29);
    expect(feature.crashes).toEqual([]);
    expect(feature.misses).toEqual([
      { id: "t-05", reason: expect.stringMatching(/leverandøren svarte med feil/iu) },
    ]);
  });

  it("E2.10 leverandøren kaster: krasj, og meldingen fra unntaket står ikke i utskriften", async () => {
    const secret = "Qzx Kastesen";
    const cases = evalCases(30, "t", (item, index) =>
      index === 2 ? { ...item, known: { personNames: [secret] } } : item,
    );
    const provider = testProvider((input) => {
      if (input.includes("t-03")) throw new Error(`feil for ${secret} 12345678`);
      return okResult(input);
    });
    const feature = await runOnly(cases, provider);
    expect(feature.crashes).toEqual(["t-03"]);
    const { exitCode, lines } = await runEvalCommand([], dirWith(cases), provider);
    expect(exitCode).toBe(1);
    for (const line of lines) {
      expect(line).not.toContain("Kastesen");
      expect(line).not.toContain("12345678");
    }
  });
});

describe("evalueringssett: vasket tekst sjekkes på egne bein (E2.11–E2.13)", () => {
  type Known = ReturnType<typeof emptyKnownValues>;
  type LeakCheck = (text: string, known: Known) => string[];

  function leakCheck(): LeakCheck {
    const check = (run as Record<string, unknown>).findLeakedKnownValues;
    expect(typeof check, "run.ts eksporterer sjekkfunksjonen for testene").toBe("function");
    return check as LeakCheck;
  }

  function known(values: Partial<Known>): Known {
    return { ...emptyKnownValues(), ...values };
  }

  it.each([
    {
      name: "navn",
      text: "Åse Testesen ringte.",
      values: { personNames: ["Åse Testesen"] },
      type: "navn",
    },
    {
      name: "navn i store bokstaver",
      text: "ÅSE TESTESEN ringte.",
      values: { personNames: ["Åse Testesen"] },
      type: "navn",
    },
    {
      name: "navn med doble mellomrom",
      text: "Åse  Testesen ringte.",
      values: { personNames: ["Åse Testesen"] },
      type: "navn",
    },
    {
      name: "etternavn alene",
      text: "Testesen ringte.",
      values: { personNames: ["Åse Testesen"] },
      type: "navn",
    },
    {
      name: "navn på to tegn (A174)",
      text: "Li ringte.",
      values: { personNames: ["Bo Li"] },
      type: "navn",
    },
    {
      name: "telefon uten skilletegn",
      text: "Ring 12345678.",
      values: { phones: ["12345678"] },
      type: "telefon",
    },
    {
      name: "telefon med bindestreker",
      text: "Ring 1-2-3-4-5-6-7-8.",
      values: { phones: ["12345678"] },
      type: "telefon",
    },
    {
      name: "telefon med smalt mellomrom",
      text: "Ring 123 45678.",
      values: { phones: ["12345678"] },
      type: "telefon",
    },
    {
      name: "telefon med +47",
      text: "Ring +47 12 34 56 78.",
      values: { phones: ["12345678"] },
      type: "telefon",
    },
    {
      name: "e-post i store bokstaver",
      text: "Skriv til ASE.TESTESEN@EXAMPLE.COM.",
      values: { emails: ["ase.testesen@example.com"] },
      type: "e-post",
    },
    {
      name: "poststed",
      text: "Befaring i Testvik.",
      values: { addresses: { full: [], places: ["Testvik"], postalCodes: [] } },
      type: "adresse",
    },
  ])("E2.11 kjent verdi i teksten meldes: $name", ({ text, values, type }) => {
    const found = leakCheck()(text, known(values as Partial<Known>));
    expect(found).toContain(type);
    // Bare typen, aldri verdien
    for (const item of found) {
      expect(item).not.toMatch(/\d|@|testesen|testvik|\bli\b/iu);
    }
  });

  it("E2.11 treff fra redactPii meldes også uten kjente verdier", () => {
    expect(leakCheck()("Ring 98765432 i morgen.", emptyKnownValues()).length).toBeGreaterThan(0);
    expect(leakCheck()("Skriv til qzx@example.com.", emptyKnownValues()).length).toBeGreaterThan(0);
  });

  it("E2.11 plassholderne gir ikke falsk alarm", () => {
    const text = `Tekst med ${PII_PLACEHOLDERS.join(", ")} og [telefon][navn] inntil hverandre.`;
    expect(
      leakCheck()(text, known({ personNames: ["Åse Testesen"], phones: ["12345678"] })),
    ).toEqual([]);
  });

  it("E2.11 vasket tekst uten kjente verdier gir ingen melding", () => {
    const text = "[navn] opplyste at taket ble lagt om i 2004. Fall mot sluket er 12 mm.";
    expect(
      leakCheck()(text, known({ personNames: ["Åse Testesen"], phones: ["12345678"] })),
    ).toEqual([]);
  });

  it("E2.11 kjøreren melder persondata når vasken ikke tar verdien (navn på to tegn)", async () => {
    const cases = evalCases(30, "t", (item, index) =>
      index === 4
        ? { ...item, fields: { text: "Li ringte om taket." }, known: { personNames: ["Bo Li"] } }
        : item,
    );
    const feature = await runOnly(cases, fakeAiProvider);
    expect(feature.leaks).toHaveLength(1);
    expect(feature.leaks[0]!.id).toBe("t-05");
    expect(feature.leaks[0]!.types).toContain("navn");
  });

  it("E2.11 kjøreren melder ingenting når vasken tar alt", async () => {
    const cases = evalCases(30, "t", (item, index) =>
      index === 4
        ? {
            ...item,
            fields: { text: "Åse Testesen ringte fra 123 45 678 om taket." },
            known: { personNames: ["Åse Testesen"], phones: ["12345678"] },
          }
        : item,
    );
    const feature = await runOnly(cases, fakeAiProvider);
    expect(feature.leaks).toEqual([]);
    expect(feature.passed).toBe(30);
  });

  const runSource = () => readFileSync(join(__dirname, "run.ts"), "utf8");

  it("E2.12 sjekken bruker ikke vasken: run.ts kaller ikke redactText eller compileKnownValues", () => {
    const source = runSource();
    expect(source).not.toMatch(/\bredactText\s*\(/u);
    expect(source).not.toMatch(/\bcompileKnownValues\s*\(/u);
    expect(source).not.toMatch(/import\s*\{[^}]*\b(redactText|compileKnownValues)\b[^}]*\}/u);
  });

  it("E2.13 kjøreren skriver ikke i ai_usage_log og importerer ikke usage-log", () => {
    const source = runSource();
    expect(source).not.toMatch(/from\s+["'][^"']*usage-log["']/u);
    expect(source).not.toMatch(/\baiUsageLog\b/u);
    expect(source).not.toMatch(/insert\s+into\s+ai_usage_log/iu);
    expect(source).not.toMatch(/\.insert\s*\(/u);
  });
});

describe("evalueringssett: TG-omtale i bøyde former (gjennomgang 11.11.2026)", () => {
  it("bøyde former av tilstandsgrad og TG med bindestrek telles", () => {
    expect(run.extractTgMentions("Tilstandsgraden er 2.")).toHaveLength(1);
    expect(run.extractTgMentions("Begge tilstandsgrader ble vurdert.")).toHaveLength(1);
    expect(run.extractTgMentions("Satt til TG-2.")).toEqual(["tg-2"]);
    expect(run.extractTgMentions("Fuktmåling i kjeller.")).toEqual([]);
  });
});

/*
 * Vakten i `runEvals` (docs/funksjoner/fase2a-ki-leverandor-testplan.md 4.4, S4): kjøreren kaller
 * aldri en ekte leverandør, fordi det koster penger. Falsk HTTP, ingen nettkall.
 */
describe("evalueringssett: bare den falske leverandøren (KI-leverandør 4.4)", () => {
  it.each(["anthropic", "unknown_vendor", "test_provider"])(
    "leverandør med code %s → kaster før noe kall",
    async (code) => {
      const complete = vi.fn(fakeAiProvider.complete);
      const provider: AiProvider = { code, model: "test-v1", complete };
      await expect(
        runEvals({ provider, casesDir: dirWith(evalCases()), feature: "language_polish" }),
      ).rejects.toThrow();
      await expect(runEvalCommand([], dirWith(evalCases()), provider)).rejects.toThrow();
      expect(complete).not.toHaveBeenCalled();
    },
  );

  it("Anthropic-adapteren laget med falsk fetch → kaster, fetch er ikke kalt", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    const provider = createAnthropicProvider({
      model: "MERKE-MODELL-K7Q",
      apiKey: "sk-ant-api03-OPPDIKTET-TESTNOKKEL-K7Q",
      pricing: { inputPerMillion: 30, outputPerMillion: 150, currency: "NOK" },
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(
      runEvals({ provider, casesDir: dirWith(evalCases()), feature: "language_polish" }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fake går som før", async () => {
    const result = await runEvals({
      provider: fakeAiProvider,
      casesDir: dirWith(evalCases()),
      feature: "language_polish",
    });
    expect(result.errors).toEqual([]);
  });

  it("lekkasjesjekken er felles: run.ts importerer den fra ../prompt-leaks og har den ikke selv", () => {
    const source = readFileSync(join(__dirname, "run.ts"), "utf8");
    expect(source).toMatch(/from\s+["']\.\.\/prompt-leaks["']/u);
    expect(source).not.toMatch(/function\s+findLeakedKnownValues\b/u);
    expect(source).not.toMatch(/function\s+findPatternLeaks\b/u);
    expect(run.findLeakedKnownValues).toBe(findLeakedKnownValues);
    expect(run.findPatternLeaks).toBe(findPatternLeaks);
  });

  it("evals/run.ts importerer verken database, valg av leverandør eller adapteren", () => {
    const source = readFileSync(join(__dirname, "run.ts"), "utf8");
    expect(source).not.toMatch(/from\s+["']@\/db/u);
    expect(source).not.toMatch(/provider-resolution/u);
    expect(source).not.toMatch(/providers\/anthropic/u);
  });

  it("findPromptLeaks: uten kjente verdier bare mønstrene, med kjente verdier også dem", () => {
    const known = { ...emptyKnownValues(), personNames: ["Qxzolav Partsen"] };
    expect(findPromptLeaks("Ring 912 34 567.", null)).toEqual(["telefon"]);
    expect(findPromptLeaks("Qxzolav kom.", null)).toEqual([]);
    expect(findPromptLeaks("Qxzolav kom.", known)).toEqual(["navn"]);
    expect(findPromptLeaks("Taket er gammelt. [navn] ringte.", known)).toEqual([]);
  });
});
