import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EVAL_GUESS_WORDS } from "@/core/ai/evals/run";

/*
 * Kopisjekken for evalueringssettene (regel 7; docs/funksjoner/fase2a-ki-i-veien-testplan.md
 * K2.6). Leser alle `*.cases.json` i `src/core/ai/evals/`, også de nye settene for
 * `phrase_suggest` og `summary_draft`.
 *
 * - Ingen tekst i settene har 8 ord på rad som står i `docs/kartlegging/` (researchen er
 *   referanse og skal aldri inn i kode eller data).
 * - Tekstene som står i stedet for rapporttekst (kandidatene i `phrase_suggest`, funnene og
 *   TGIU-linjene i `summary_draft`) har ingen gjetteord fra maltesten og ingen henvisning til
 *   NS 3600, IVIT, SmartTakst, TEK eller Byggforsk. Inndata og oppdiktede svar som skal prøve at
 *   slike ord fanges, og ordlistene i fasiten, er unntatt.
 * - En oppdiktet fixture viser at sjekken blir rød.
 *
 * Støtter hovedmål: færre reklamasjoner (egne formuleringer, ingen gjetteord) og KI i bunnen
 * (settene som måler KI, er rene).
 */

const ROOT = process.cwd();
const EVALS_DIR = join(ROOT, "src", "core", "ai", "evals");
const RESEARCH_DIR = join(ROOT, "docs", "kartlegging");
const TEMPLATE_TEST = join(ROOT, "src", "db", "seed", "templates", "wet-room.test.ts");
const RUN_LENGTH = 8;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wordPattern(word: string, caseSensitive: boolean): RegExp {
  return new RegExp(`(?<![\\p{L}])${escapeRegExp(word)}(?![\\p{L}])`, caseSensitive ? "u" : "iu");
}

/** Henvisninger som maltesten. «TEK» og «NS» skiller store og små bokstaver. */
const REFERENCES: { word: string; caseSensitive: boolean }[] = [
  { word: "NS 3600", caseSensitive: false },
  { word: "NS", caseSensitive: true },
  { word: "TEK", caseSensitive: true },
  { word: "Byggforsk", caseSensitive: false },
  { word: "IVIT", caseSensitive: false },
  { word: "SmartTakst", caseSensitive: false },
];

/** Gjetteord og henvisninger i teksten. Tom liste betyr ren tekst. */
function guessWordsAndReferencesIn(text: string): string[] {
  return [
    ...EVAL_GUESS_WORDS.filter((word) => wordPattern(word, false).test(text)),
    ...REFERENCES.filter(({ word, caseSensitive }) =>
      wordPattern(word, caseSensitive).test(text),
    ).map(({ word }) => word),
  ];
}

function words(text: string): string[] {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((w) => w.length > 0);
}

function runsOf(text: string): string[] {
  const list = words(text);
  const out: string[] = [];
  for (let i = 0; i + RUN_LENGTH <= list.length; i++) {
    out.push(list.slice(i, i + RUN_LENGTH).join(" "));
  }
  return out;
}

function researchFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return researchFiles(path);
    return /\.(md|txt|json|csv)$/u.test(name) ? [path] : [];
  });
}

let researchRuns: Set<string> | null = null;
function researchRunSet(): Set<string> {
  if (researchRuns) return researchRuns;
  const set = new Set<string>();
  for (const file of researchFiles(RESEARCH_DIR)) {
    for (const run of runsOf(readFileSync(file, "utf8"))) set.add(run);
  }
  researchRuns = set;
  return set;
}

/** De første 8 ordene på rad i teksten som også står i researchen, eller `null`. */
function copiedRun(text: string): string | null {
  const set = researchRunSet();
  return runsOf(text).find((run) => set.has(run)) ?? null;
}

/** Alle tekstverdier i en JSON-verdi, med sti. */
function allStrings(value: unknown, path = ""): { path: string; text: string }[] {
  if (typeof value === "string") return [{ path, text: value }];
  if (Array.isArray(value)) return value.flatMap((item, i) => allStrings(item, `${path}[${i}]`));
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, item]) =>
      allStrings(item, path === "" ? key : `${path}.${key}`),
    );
  }
  return [];
}

type CaseLike = {
  id: string;
  candidates?: { id: string; text: string }[];
  groups?: {
    findings?: Record<string, string | string[] | null>[];
    fixedLines?: { text: string; checkpointName: string }[];
  }[];
};

/** Tekstene som står i stedet for rapporttekst: kandidater, funn og TGIU-linjer. */
function reportLikeTexts(evalCase: CaseLike): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  for (const candidate of evalCase.candidates ?? []) {
    out.push({ where: `${evalCase.id}/${candidate.id}`, text: candidate.text });
  }
  for (const group of evalCase.groups ?? []) {
    for (const finding of group.findings ?? []) {
      for (const value of Object.values(finding)) {
        for (const text of Array.isArray(value) ? value : value === null ? [] : [value]) {
          out.push({ where: evalCase.id, text });
        }
      }
    }
    for (const line of group.fixedLines ?? []) {
      out.push(
        { where: evalCase.id, text: line.text },
        { where: evalCase.id, text: line.checkpointName },
      );
    }
  }
  return out;
}

const caseFiles = existsSync(EVALS_DIR)
  ? readdirSync(EVALS_DIR)
      .filter((name) => name.endsWith(".cases.json"))
      .sort()
  : [];

function readCases(name: string): { feature: string; cases: CaseLike[] } {
  return JSON.parse(readFileSync(join(EVALS_DIR, name), "utf8")) as {
    feature: string;
    cases: CaseLike[];
  };
}

describe("kopisjekken for evalueringssettene (K2.6, regel 7)", () => {
  it("K2.6 sjekken leser de nye settene", () => {
    expect(caseFiles).toEqual(
      expect.arrayContaining([
        "language_polish.cases.json",
        "phrase_suggest.cases.json",
        "summary_draft.cases.json",
      ]),
    );
    expect(researchFiles(RESEARCH_DIR).length).toBeGreaterThan(0);
    expect(researchRunSet().size).toBeGreaterThan(1000);
  });

  it.each(caseFiles)("K2.6 %s: ingen 8 ord på rad fra docs/kartlegging/", (name) => {
    const json = JSON.parse(readFileSync(join(EVALS_DIR, name), "utf8")) as unknown;
    const copied = allStrings(json).flatMap(({ path, text }) => {
      const run = copiedRun(text);
      return run === null ? [] : [`${path}: «${run}»`];
    });
    expect(copied).toEqual([]);
  });

  it.each(caseFiles)(
    "K2.6 %s: kandidater, funn og TGIU-linjer har ingen gjetteord og ingen henvisning",
    (name) => {
      const problems = readCases(name).cases.flatMap((evalCase) =>
        reportLikeTexts(evalCase).flatMap(({ where, text }) =>
          guessWordsAndReferencesIn(text).map((word) => `${where}: «${word}»`),
        ),
      );
      expect(problems).toEqual([]);
    },
  );

  it("K2.6 de nye settene har tekster som sjekken faktisk leser", () => {
    const counts = Object.fromEntries(
      caseFiles.map((name) => [
        readCases(name).feature,
        readCases(name).cases.flatMap(reportLikeTexts).length,
      ]),
    );
    expect(counts.phrase_suggest).toBeGreaterThan(100);
    expect(counts.summary_draft).toBeGreaterThan(100);
  });

  it("K2.6 gjetteordlisten i evalueringen er den samme som i maltesten", () => {
    const source = readFileSync(TEMPLATE_TEST, "utf8");
    const block = /const GUESS_WORDS = \[([\s\S]*?)\];/u.exec(source)?.[1];
    expect(block, "GUESS_WORDS i maltesten").toBeDefined();
    const fromTemplate = Array.from(block!.matchAll(/"([^"]+)"/gu), (m) => m[1]!);
    expect(fromTemplate.length).toBeGreaterThan(5);
    expect([...EVAL_GUESS_WORDS].sort()).toEqual([...fromTemplate].sort());
  });

  describe("en oppdiktet fixture gjør sjekken rød", () => {
    const fixture: CaseLike = {
      id: "fixture-1",
      candidates: [
        { id: "k-1", text: "Sluket antas å være gammelt." },
        { id: "k-2", text: "Vurdert etter NS 3600 punkt 9." },
        { id: "k-3", text: "Teksten er hentet fra IVIT." },
      ],
      groups: [
        {
          findings: [
            {
              checkpointName: "Oppdiktet punkt",
              deviationText: "Det er trolig fukt i veggen.",
              causeText: null,
              consequenceText: "Ser ut til å gi råte.",
              measures: ["Følg TEK17."],
            },
          ],
        },
      ],
    };

    it("K2.6 gjetteord, «NS 3600», «IVIT» og «TEK» gir funn", () => {
      const found = reportLikeTexts(fixture).flatMap(({ text }) => guessWordsAndReferencesIn(text));
      for (const word of ["antas", "trolig", "ser ut til", "NS 3600", "IVIT", "TEK"]) {
        expect(found).toContain(word);
      }
    });

    it("K2.6 ren tekst gir ingen funn, og «teknisk» og «ns» er ikke henvisninger", () => {
      expect(guessWordsAndReferencesIn("Sluket mangler klemring og må skiftes.")).toEqual([]);
      expect(guessWordsAndReferencesIn("Teknisk rom. Fire ns.")).toEqual([]);
    });

    it("K2.6 8 ord på rad fra researchen gir funn, og en egen setning gir ingen", () => {
      const file = researchFiles(RESEARCH_DIR).find(
        (path) => runsOf(readFileSync(path, "utf8")).length > 0,
      )!;
      const sample = runsOf(readFileSync(file, "utf8"))[0]!;
      expect(copiedRun(`Innledning. ${sample}. Slutt.`)).toBe(sample);
      expect(
        copiedRun("Oppdiktet tekst om en kjøkkenvifte som brummer høyt hver morgen."),
      ).toBeNull();
    });
  });
});
