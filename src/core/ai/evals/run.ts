import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { getFeatureDefinition, type AiFeatureDefinition } from "../features";
import {
  findPromptLeaks,
  normalizeSpaces,
  wholeWordPattern,
  WORD_END,
  WORD_START,
  type LeakType,
} from "../leak-check";
import { preparePrompt } from "../prompt";
import type { AiProvider, AiProviderRequest, AiProviderResult } from "../providers/types";
import {
  EVAL_CASES_FILE_SUFFIX,
  parseCasesFile,
  toKnownValues,
  type EvalCase,
  type EvalExpectation,
} from "./schema";

/*
 * Kjøreren for evalueringssettet (docs/funksjoner/fase2a-evalueringssett.md, Omfang 4, ADR 0006
 * del 9). Hovedmål: KI i bunnen. Hver KI-funksjon prøves på faste eksempler med fasit.
 *
 * Settet går samme vei som ekte bruk: `preparePrompt` (rensing, vask, ledetekst) og så
 * leverandøren. Teksten leverandøren fikk, fanges og sjekkes på egne bein for persondata, uten å
 * bruke vasken selv. Kjøreren bruker ikke databasen og logger ikke (A182), og eksporteres ikke fra
 * `src/core/ai/index.ts`. Svaret fra leverandøren og verdiene fra eksemplene skrives aldri ut.
 *
 * Mot den falske leverandøren gir bare oppsett, krasj og persondata avslutningskode 1, ikke
 * treffprosent eller mustPass (A183).
 */

// Lekkasjesjekken bor i `../leak-check.ts` (A195); eksportert her også for testene av settet
export {
  findLeakedKnownValues,
  findPatternLeaks,
  findPromptLeaks,
  type LeakType,
} from "../leak-check";

export type EvalMiss = { id: string; reason: string };
export type EvalLeak = { id: string; types: LeakType[] };

export type EvalFeatureResult = {
  feature: string;
  fileName: string;
  total: number;
  passed: number;
  /** Andel treff, 0–1. Null eksempler gir 0. */
  passRate: number;
  /** Treffgrensen fra funksjonsdefinisjonen. Vises bare. */
  threshold: number;
  mustPassTotal: number;
  mustPassPassed: number;
  misses: EvalMiss[];
  leaks: EvalLeak[];
  /** Id-ene der kjøringen kastet (leverandøren eller vasken). */
  crashes: string[];
};

export type EvalResult = {
  features: EvalFeatureResult[];
  /** Oppsettsfeil: ukjent funksjon, manglende eller ugyldig fil, skjemafeil. */
  errors: string[];
};

export type EvalCaseEvaluation = { passed: boolean; reasons: string[] };

// ---------------------------------------------------------------------------------------------
// Vurdering av ett svar mot fasiten

/**
 * Om `word` står som hele ord i `text`, uten skille mellom store og små bokstaver. Ordgrensen er
 * Unicode-bokstaver og -sifre, så «må» ikke treffer «måling» og «12,5» ikke treffer «112,5».
 */
export function containsWholeWord(text: string, word: string): boolean {
  if (normalizeSpaces(word) === "") return false;
  return wholeWordPattern(word).test(normalizeSpaces(text));
}

const TG_MENTION = new RegExp(
  `${WORD_START}(?:tg[\\s-]?(?:[0-3]|iu)|tilstandsgrad\\p{L}*(?:\\s?[0-3])?)${WORD_END}`,
  "giu",
);

/** TG-omtalene i teksten i rekkefølge, uten mellomrom og med små bokstaver («TG 2» blir «tg2»). */
export function extractTgMentions(text: string): string[] {
  const normalized = normalizeSpaces(text);
  return Array.from(normalized.matchAll(TG_MENTION), (match) =>
    match[0].replace(/\s/gu, "").toLowerCase(),
  );
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Andelen treff. Null eksempler gir 0, aldri NaN. */
export function passRate(passed: number, total: number): number {
  return total > 0 ? passed / total : 0;
}

/**
 * Vurderer svaret fra leverandøren mot fasiten. `inputText` er de rå feltene fra eksempelet (for
 * `sameTg`). Grunnene nevner kravet fra fasiten, aldri svaret.
 */
export function evaluateCase(
  expectation: EvalExpectation,
  inputText: string,
  result: AiProviderResult,
): EvalCaseEvaluation {
  if (result.outcome === "error") {
    return { passed: false, reasons: ["leverandøren svarte med feil"] };
  }
  if (result.outcome !== expectation.outcome) {
    return {
      passed: false,
      reasons: [`fasiten venter utfallet ${expectation.outcome}, fikk ${result.outcome}`],
    };
  }
  if (result.outcome !== "ok") return { passed: true, reasons: [] };

  const reasons: string[] = [];
  for (const word of expectation.mustContain ?? []) {
    if (!containsWholeWord(result.text, word)) reasons.push(`mangler «${word}» (mustContain)`);
  }
  for (const word of expectation.mustNotContain ?? []) {
    if (containsWholeWord(result.text, word)) reasons.push(`har «${word}» (mustNotContain)`);
  }
  if (expectation.sameTg === true) {
    const expected = extractTgMentions(inputText);
    if (!sameList(expected, extractTgMentions(result.text))) {
      reasons.push(
        expected.length === 0
          ? "TG er lagt til, inndata har ingen TG (sameTg)"
          : `TG er ikke som i inndata: ${expected.join(", ")} (sameTg)`,
      );
    }
  }
  return { passed: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------------------------
// Kjøring av settet

type RunOptions = { provider: AiProvider; casesDir: string; feature?: string };

type LoadedFile = { fileName: string; json: unknown } | { fileName: string; error: string };

async function listCaseFiles(casesDir: string): Promise<string[]> {
  const names = await readdir(casesDir);
  return names.filter((name) => name.endsWith(EVAL_CASES_FILE_SUFFIX)).sort();
}

async function loadFile(casesDir: string, fileName: string): Promise<LoadedFile> {
  let raw: string;
  try {
    raw = await readFile(join(casesDir, fileName), "utf8");
  } catch {
    return { fileName, error: `Fant ikke eksempelfilen ${fileName}.` };
  }
  try {
    return { fileName, json: JSON.parse(raw) as unknown };
  } catch {
    // Meldingen fra JSON.parse kan ha et utdrag av filen, derfor tas den ikke med.
    return { fileName, error: `Ugyldig JSON i ${fileName}.` };
  }
}

function inputTextOf(definition: AiFeatureDefinition, fields: Record<string, string>): string {
  return definition.allowedFields
    .filter((key) => Object.prototype.hasOwnProperty.call(fields, key))
    .map((key) => fields[key])
    .join("\n");
}

async function runFeature(
  provider: AiProvider,
  definition: AiFeatureDefinition,
  fileName: string,
  cases: readonly EvalCase[],
): Promise<EvalFeatureResult> {
  const result: EvalFeatureResult = {
    feature: definition.code,
    fileName,
    total: cases.length,
    passed: 0,
    passRate: 0,
    threshold: definition.evalPassRate,
    mustPassTotal: cases.filter((evalCase) => evalCase.mustPass).length,
    mustPassPassed: 0,
    misses: [],
    leaks: [],
    crashes: [],
  };

  for (const evalCase of cases) {
    const known = evalCase.known === undefined ? null : toKnownValues(evalCase.known);
    const captured: string[] = [];
    let answer: AiProviderResult;
    let evaluation: ReturnType<typeof evaluateCase>;
    try {
      const { prompt } = preparePrompt(definition, evalCase.fields, known);
      // Lekkasjesjekken før kallet: en ledetekst med persondata sendes aldri til leverandøren
      const leaked = findPromptLeaks(prompt, known);
      if (leaked.length > 0) {
        result.leaks.push({ id: evalCase.id, types: leaked });
        continue;
      }
      answer = await completeCaptured(provider, captured, {
        feature: definition.code,
        promptVersion: definition.promptVersion,
        prompt,
        model: provider.model,
      });
      const leakedAfter = new Set<LeakType>();
      for (const text of captured)
        for (const type of findPromptLeaks(text, known)) leakedAfter.add(type);
      if (leakedAfter.size > 0) {
        result.leaks.push({ id: evalCase.id, types: Array.from(leakedAfter) });
        continue;
      }
      evaluation = evaluateCase(evalCase.expect, inputTextOf(definition, evalCase.fields), answer);
    } catch {
      // Også feil fra mønstrene i sjekkene: eksempelet føres som krasj, uten feilteksten
      result.crashes.push(evalCase.id);
      continue;
    }

    if (evaluation.passed) {
      result.passed += 1;
      if (evalCase.mustPass) result.mustPassPassed += 1;
    } else {
      result.misses.push({ id: evalCase.id, reason: evaluation.reasons.join("; ") });
    }
  }

  result.passRate = passRate(result.passed, result.total);
  return result;
}

/** Kaller leverandøren og tar vare på teksten den faktisk fikk. */
async function completeCaptured(
  provider: AiProvider,
  captured: string[],
  request: AiProviderRequest,
): Promise<AiProviderResult> {
  captured.push(request.prompt);
  return provider.complete(request);
}

/** Leverandøren settet kan kjøres mot. En ekte leverandør koster penger og venter på Ståle. */
const EVAL_PROVIDER_CODE = "fake";

/** `runEvals` er kalt med en annen leverandør enn den falske. */
export class EvalProviderNotAllowedError extends Error {
  constructor() {
    super("Evalueringssettet kjøres bare mot den falske leverandøren.");
    this.name = "EvalProviderNotAllowedError";
  }
}

/**
 * Kjører eksempelfilene i `casesDir` mot leverandøren. Med `feature` bare `<feature>.cases.json`,
 * ellers alle `*.cases.json` i mappen. Oppsettsfeil samles i `errors`; resten av filene kjøres.
 * Kaster før noe kall hvis leverandøren ikke er `fake` (kortet fase2a-ki-leverandor Omfang 7).
 */
export async function runEvals(options: RunOptions): Promise<EvalResult> {
  const { provider, casesDir, feature } = options;
  if (provider.code !== EVAL_PROVIDER_CODE) throw new EvalProviderNotAllowedError();
  const result: EvalResult = { features: [], errors: [] };

  let fileNames: string[];
  if (feature !== undefined) {
    if (getFeatureDefinition(feature) === null) {
      result.errors.push(`Ukjent KI-funksjon: ${feature}.`);
      return result;
    }
    fileNames = [`${feature}${EVAL_CASES_FILE_SUFFIX}`];
  } else {
    try {
      fileNames = await listCaseFiles(casesDir);
    } catch {
      result.errors.push("Fant ikke mappen med eksempelfiler.");
      return result;
    }
    if (fileNames.length === 0) {
      result.errors.push("Fant ingen eksempelfiler (*.cases.json).");
      return result;
    }
  }

  for (const fileName of fileNames) {
    const loaded = await loadFile(casesDir, fileName);
    if ("error" in loaded) {
      result.errors.push(loaded.error);
      continue;
    }
    const parsed = parseCasesFile(loaded.json, fileName);
    if (!parsed.ok) {
      result.errors.push(...parsed.errors);
      continue;
    }
    if (feature !== undefined && parsed.file.feature !== feature) {
      result.errors.push(`${fileName}: feature: gjelder en annen KI-funksjon enn filnavnet.`);
      continue;
    }
    const definition = getFeatureDefinition(parsed.file.feature);
    if (definition === null) {
      result.errors.push(`${fileName}: feature: ukjent KI-funksjon.`);
      continue;
    }
    result.features.push(await runFeature(provider, definition, fileName, parsed.file.cases));
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Kommandoen `pnpm ai:eval [funksjon]`

function formatPercent(rate: number): string {
  const rounded = Math.round(rate * 1000) / 10;
  return `${String(rounded).replace(".", ",")} %`;
}

function featureLines(feature: EvalFeatureResult): string[] {
  const lines = [
    `${feature.feature}: ${feature.total} eksempler, ${feature.passed} treff, ` +
      `treffprosent ${formatPercent(feature.passRate)}, grense ${formatPercent(feature.threshold)}, ` +
      `mustPass ${feature.mustPassPassed} av ${feature.mustPassTotal}`,
  ];
  for (const miss of feature.misses) lines.push(`  Bom ${miss.id}: ${miss.reason}`);
  for (const crash of feature.crashes) {
    lines.push(`  Krasj ${crash}: kjøringen stoppet med en feil.`);
  }
  for (const leak of feature.leaks) {
    lines.push(
      `  Persondata ${leak.id}: ${leak.types.join(", ")} i teksten til leverandøren (verdien vises ikke).`,
    );
  }
  return lines;
}

/**
 * Kjører kommandoen og gir avslutningskode og linjene som skal skrives. Kode 1 for ukjent
 * funksjon, ugyldig fil, skjemafeil, duplisert id, krasj og persondata. Lav treffprosent og bom på
 * mustPass gir kode 0 (A183).
 */
export async function runEvalCommand(
  argv: string[],
  casesDir: string,
  provider: AiProvider,
): Promise<{ exitCode: 0 | 1; lines: string[] }> {
  const args = argv.filter((arg) => arg !== "--");
  if (args.length > 1) {
    return { exitCode: 1, lines: ["Bruk: pnpm ai:eval [funksjon]"] };
  }

  const result = await runEvals({ provider, casesDir, feature: args[0] });
  const lines: string[] = [];
  for (const feature of result.features) lines.push(...featureLines(feature));
  for (const error of result.errors) lines.push(`Feil: ${error}`);

  const crashed = result.features.some((f) => f.crashes.length > 0);
  const leaked = result.features.some((f) => f.leaks.length > 0);
  if (crashed) lines.push("Kjøringen krasjet i minst ett eksempel.");
  if (leaked) lines.push("Persondata nådde leverandøren i minst ett eksempel.");

  const failed = result.errors.length > 0 || crashed || leaked;
  return { exitCode: failed ? 1 : 0, lines };
}
