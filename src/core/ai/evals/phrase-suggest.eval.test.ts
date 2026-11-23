import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { redactPii } from "@/shared/lib/pii-patterns";
import {
  capturing,
  hasWholeWord,
  inputOfPrompt,
  okResult,
  testProvider,
} from "../../../../tests/evals";
import { extractTgMentions } from "../guards";
import { fakeAiProvider } from "../providers/fake";
import { EVAL_GUESS_WORDS, evaluatePhrase, runEvals } from "./run";
import { parseCasesFile, PHRASE_TOP_N, type PhraseEvalCase } from "./schema";

/*
 * Settet for `phrase_suggest` (docs/funksjoner/fase2a-ki-i-veien-testplan.md K2.2). Ren test,
 * ingen database. Testen leser selve filen og prøver at fasiten er riktig bygd, at HMS og TG aldri
 * blandes, at kandidattekstene er egne og rene, og at resultatet mot den falske leverandøren er
 * låst.
 *
 * Støtter hovedmål: KI i bunnen (fraseforslagene kan måles før ekte KI slås på) og færre
 * reklamasjoner (riktig standardtekst blant de 3 beste, og «ingen passer» når ingen gjør det).
 */

const FILE_NAME = "phrase_suggest.cases.json";
const raw = readFileSync(join(__dirname, FILE_NAME), "utf8");
const json = JSON.parse(raw) as { feature: string; status: string; note: string };
const parsed = parseCasesFile(JSON.parse(raw) as unknown, FILE_NAME);
const cases: PhraseEvalCase[] =
  parsed.ok && parsed.file.feature === "phrase_suggest" ? parsed.file.cases : [];

const REFERENCES = [/(?<![\p{L}])NS(?![\p{L}])/u, /ivit/iu, /smarttakst/iu, /byggforsk/iu];

describe("evalueringssett: settet for phrase_suggest (K2.2)", () => {
  it("K2.2 filen er gyldig, har 30–50 saker med unike id-er og er merket utkast", () => {
    expect(parsed.ok ? [] : parsed.errors).toEqual([]);
    expect(json.feature).toBe("phrase_suggest");
    expect(json.status).toBe("utkast, ikke godkjent av fagrådet");
    expect(cases.length).toBeGreaterThanOrEqual(30);
    expect(cases.length).toBeLessThanOrEqual(50);
    expect(new Set(cases.map((item) => item.id)).size).toBe(cases.length);
  });

  it("K2.2 minst 5 saker har fasit no_match, og resten har minst én riktig kandidat-id", () => {
    expect(
      cases.filter((item) => item.expect.outcome === "no_match").length,
    ).toBeGreaterThanOrEqual(5);
    for (const item of cases) {
      if (item.expect.outcome !== "ok") continue;
      const ids = new Set(item.candidates.map((candidate) => candidate.id));
      expect(item.expect.correct.length, item.id).toBeGreaterThan(0);
      for (const id of item.expect.correct) expect(ids.has(id), `${item.id}: ${id}`).toBe(true);
    }
  });

  it("K2.2 HMS-kandidater aldri for TG-avvik og omvendt, og begge slags avvik finnes (A463)", () => {
    for (const item of cases) {
      for (const candidate of item.candidates) {
        expect(candidate.kind, `${item.id}: ${candidate.id}`).toBe(item.deviationKind);
      }
    }
    expect(cases.some((item) => item.deviationKind === "tg")).toBe(true);
    expect(cases.some((item) => item.deviationKind === "hms")).toBe(true);
  });

  it("K2.2 alle felttyper er med: avvik, årsak, konsekvens og tiltak", () => {
    const fieldKeys = new Set(cases.map((item) => item.field));
    for (const key of ["deviation_text", "cause_text", "consequence_text", "measure_text"]) {
      expect([...fieldKeys]).toContain(key);
    }
  });

  it("K2.2 saker med flere riktige kandidater finnes (fasiten er et sett)", () => {
    expect(
      cases.some((item) => item.expect.outcome === "ok" && item.expect.correct.length > 1),
    ).toBe(true);
  });

  it("K2.2 kandidattekstene har ingen gjetteord, ingen TG og ingen henvisning (regel 7)", () => {
    const problems: string[] = [];
    for (const item of cases) {
      for (const candidate of item.candidates) {
        const where = `${item.id}/${candidate.id}`;
        for (const word of EVAL_GUESS_WORDS) {
          if (hasWholeWord(candidate.text, word)) problems.push(`${where}: ${word}`);
        }
        if (extractTgMentions(candidate.text).length > 0) problems.push(`${where}: TG`);
        if (REFERENCES.some((pattern) => pattern.test(candidate.text))) {
          problems.push(`${where}: henvisning`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("K2.2 ingen persondata i felttekst eller kandidater (redactPii gir 0 treff)", () => {
    for (const item of cases) {
      const texts = [...Object.values(item.fields), ...item.candidates.map((c) => c.text)];
      for (const text of texts) expect(redactPii(text).count, item.id).toBe(0);
    }
  });

  it("K2.2 kandidat-id-ene sendes aldri til leverandøren, bare tekstene", async () => {
    const provider = capturing(fakeAiProvider);
    const result = await runEvals({ provider, casesDir: __dirname, feature: "phrase_suggest" });
    expect(result.errors).toEqual([]);
    expect(provider.prompts).toHaveLength(cases.length);
    cases.forEach((item, index) => {
      const input = inputOfPrompt(provider.prompts[index]!);
      for (const candidate of item.candidates) {
        expect(input, item.id).not.toContain(candidate.id);
        expect(input, item.id).toContain(candidate.text);
      }
    });
  });

  it("K2.2 låst resultat mot den falske leverandøren", async () => {
    const result = await runEvals({
      provider: fakeAiProvider,
      casesDir: __dirname,
      feature: "phrase_suggest",
    });
    expect(result.errors).toEqual([]);
    const feature = result.features[0]!;
    // Endres bare med vilje, i samme PR som settet.
    expect({
      total: feature.total,
      passed: feature.passed,
      mustPassTotal: feature.mustPassTotal,
      mustPassPassed: feature.mustPassPassed,
      misses: feature.misses.map((miss) => miss.id),
      leaks: feature.leaks,
      crashes: feature.crashes,
    }).toEqual({
      total: cases.length,
      passed: cases.length,
      mustPassTotal: cases.filter((item) => item.mustPass).length,
      mustPassPassed: cases.filter((item) => item.mustPass).length,
      misses: [],
      leaks: [],
      crashes: [],
    });
  });

  it("K2.2 note har regelen om oppdiktet tekst", () => {
    expect(json.note).toMatch(/oppdiktet/iu);
    expect(json.note).toMatch(/aldri/iu);
    expect(json.note).toMatch(/avvikstekst/iu);
    expect(json.note).toMatch(/seed/iu);
  });
});

describe("evalueringssett: vurderingen av fraseforslag (K2.2)", () => {
  const ok = { outcome: "ok" as const, correct: ["k-riktig"] };

  it.each([
    [["k-riktig"], true],
    [["k-a", "k-b", "k-riktig"], true],
    [["k-a", "k-b", "k-c", "k-riktig"], false],
    [[], false],
  ])("K2.2 rangering %j: bestått = %s (minst én riktig blant de 3 beste)", (ranked, passed) => {
    expect(PHRASE_TOP_N).toBe(3);
    expect(evaluatePhrase(ok, ranked).passed).toBe(passed);
  });

  it("K2.2 fasit no_match: bestått bare når leverandøren ikke rangerer noen", () => {
    expect(evaluatePhrase({ outcome: "no_match" }, []).passed).toBe(true);
    const miss = evaluatePhrase({ outcome: "no_match" }, ["k-a"]);
    expect(miss.passed).toBe(false);
    expect(miss.reasons.join(" ")).toMatch(/no_match/u);
  });

  it("K2.2 bom-grunnen nevner fasiten, ikke svaret", () => {
    const miss = evaluatePhrase(ok, ["k-svar-a", "k-svar-b", "k-svar-c"]);
    expect(miss.reasons.join(" ")).toContain("k-riktig");
    expect(miss.reasons.join(" ")).not.toContain("k-svar");
  });

  it("K2.2 svaret tolkes med kjernens parseCandidateAnswer (små bokstaver, «ingen», ukjente merker)", async () => {
    const run = async (answer: string) => {
      const result = await runEvals({
        provider: testProvider(() => okResult(answer)),
        casesDir: __dirname,
        feature: "phrase_suggest",
      });
      expect(result.errors).toEqual([]);
      return result.features[0]!;
    };
    const firstIsCorrect = cases.filter(
      (item) =>
        item.expect.outcome === "ok" && item.expect.correct.includes(item.candidates[0]!.id),
    ).length;
    const noMatch = cases.filter((item) => item.expect.outcome === "no_match").length;
    expect(firstIsCorrect).toBeGreaterThan(0);
    // Kjernen godtar «k1.» som K1; et eget mønster gjorde det ikke
    expect((await run("k1.")).passed).toBe(firstIsCorrect);
    // «ingen», ukjente merker og doble gir no_match, som i kjernen
    expect((await run("ingen")).passed).toBe(noMatch);
    expect((await run("K99, SK1, K0")).passed).toBe(noMatch);
  });
});
