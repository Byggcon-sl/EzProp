import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PII_PLACEHOLDER, PII_PLACEHOLDERS, redactPii } from "@/shared/lib/pii-patterns";
import { getFeatureDefinition, type AiFeatureDefinition } from "../features";
import { preparePrompt } from "../prompt";
import type { AiProvider, AiProviderRequest, AiProviderResult } from "../providers/types";
import type { KnownValues } from "../redact-text";
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

const START = "(?<![\\p{L}\\p{N}])";
const END = "(?![\\p{L}\\p{N}])";
const WHITESPACE = /[\s   ]+/gu;

/** NFC, og alle typer mellomrom slått sammen til ett vanlig. */
function normalizeSpaces(text: string): string {
  return text.normalize("NFC").replace(WHITESPACE, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

function wholeWordPattern(word: string): RegExp {
  return new RegExp(`${START}${escapeRegExp(normalizeSpaces(word))}${END}`, "iu");
}

/**
 * Om `word` står som hele ord i `text`, uten skille mellom store og små bokstaver. Ordgrensen er
 * Unicode-bokstaver og -sifre, så «må» ikke treffer «måling» og «12,5» ikke treffer «112,5».
 */
export function containsWholeWord(text: string, word: string): boolean {
  if (normalizeSpaces(word) === "") return false;
  return wholeWordPattern(word).test(normalizeSpaces(text));
}

const TG_MENTION = new RegExp(
  `${START}(?:tg[\\s-]?(?:[0-3]|iu)|tilstandsgrad\\p{L}*(?:\\s?[0-3])?)${END}`,
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
// Persondata i teksten til leverandøren, sjekket på egne bein (ikke med vasken)

export type LeakType =
  | "navn"
  | "e-post"
  | "telefon"
  | "adresse"
  | "matrikkel"
  | "org.nr"
  | "fødselsnummer"
  | "kontonummer";

const PLACEHOLDER_TYPES: ReadonlyArray<readonly [string, LeakType]> = [
  [PII_PLACEHOLDER.name, "navn"],
  [PII_PLACEHOLDER.email, "e-post"],
  [PII_PLACEHOLDER.phone, "telefon"],
  [PII_PLACEHOLDER.address, "adresse"],
  [PII_PLACEHOLDER.cadastral, "matrikkel"],
  [PII_PLACEHOLDER.orgNumber, "org.nr"],
  [PII_PLACEHOLDER.nationalId, "fødselsnummer"],
  [PII_PLACEHOLDER.accountNumber, "kontonummer"],
];

const MIN_VALUE_LENGTH = 2;

function digitsOf(value: string): string {
  return value.replace(/\D/gu, "");
}

/** Telefon uten landskode foran (+47 / 0047). */
function phoneDigits(value: string): string {
  const digits = digitsOf(value);
  if (digits.length === 10 && digits.startsWith("47")) return digits.slice(2);
  if (digits.length === 12 && digits.startsWith("0047")) return digits.slice(4);
  return digits;
}

/** Sifrene i rekkefølge, med opptil tre skilletegn (ikke bokstav eller siffer) mellom hvert. */
function containsDigits(text: string, digits: string): boolean {
  if (digits.length < 4) return false;
  const source = digits.split("").join("[^\\p{L}\\p{N}]{0,3}");
  return new RegExp(`(?<!\\p{N})${source}(?!\\p{N})`, "u").test(text);
}

function containsValue(text: string, value: string): boolean {
  const normalized = normalizeSpaces(value).toLowerCase();
  if (normalized.length < MIN_VALUE_LENGTH) return false;
  return wholeWordPattern(normalized).test(text);
}

/** Navnet som helhet og hvert ord på minst to tegn. */
function nameParts(name: string): string[] {
  return [name, ...normalizeSpaces(name).split(" ")];
}

/** Hele adressen og hver del mellom komma. */
function addressParts(address: string): string[] {
  return [address, ...address.split(",")];
}

function containsCadastral(text: string, known: KnownValues): boolean {
  for (const unit of known.cadastral.units) {
    const numbers = [unit.gnr, unit.bnr, unit.fnr, unit.snr]
      .filter((value): value is string => value !== null && digitsOf(value) !== "")
      .map(digitsOf);
    if (numbers.length < 2) continue;
    const source = numbers.join("\\s?[/\\-]\\s?");
    if (new RegExp(`(?<![\\p{N}/])${source}(?![\\p{N}/])`, "u").test(text)) return true;
  }
  return false;
}

/**
 * Typene persondata som står i teksten: rå kjente verdier fra eksempelet (store og små bokstaver
 * og mellomrom normalisert, telefon og org.nr sammenlignet bare på sifre), og treff fra de faste
 * mønstrene når plassholderne er tatt bort. Gir aldri verdien, bare typen.
 */
export function findLeakedKnownValues(text: string, known: KnownValues): LeakType[] {
  const found = new Set<LeakType>();
  const normalized = normalizeSpaces(text).toLowerCase();

  if (known.personNames.flatMap(nameParts).some((value) => containsValue(normalized, value))) {
    found.add("navn");
  }
  if (known.phrases.some((value) => containsValue(normalized, value))) found.add("navn");
  if (known.emails.some((value) => normalized.includes(normalizeSpaces(value).toLowerCase()))) {
    found.add("e-post");
  }
  if (known.phones.some((value) => containsDigits(normalized, phoneDigits(value)))) {
    found.add("telefon");
  }
  if (known.orgNumbers.some((value) => containsDigits(normalized, digitsOf(value)))) {
    found.add("org.nr");
  }
  if (
    known.addresses.full.flatMap(addressParts).some((value) => containsValue(normalized, value)) ||
    known.addresses.places.some((value) => containsValue(normalized, value))
  ) {
    found.add("adresse");
  }
  if (containsCadastral(normalized, known)) found.add("matrikkel");

  for (const type of findPatternLeaks(text)) found.add(type);
  return Array.from(found);
}

/** Treff fra `redactPii` i teksten, med plassholderne som alt står der tatt bort først. */
export function findPatternLeaks(text: string): LeakType[] {
  let stripped = text;
  for (const placeholder of PII_PLACEHOLDERS) stripped = stripped.split(placeholder).join(" ");
  const result = redactPii(stripped);
  if (result.count === 0) return [];
  return PLACEHOLDER_TYPES.filter(([placeholder]) => result.text.includes(placeholder)).map(
    ([, type]) => type,
  );
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
      const leaked = leaksIn(prompt, known);
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
      for (const text of captured) for (const type of leaksIn(text, known)) leakedAfter.add(type);
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
/** Persondatatypene som finnes i teksten: kjente verdier når de finnes, ellers mønstrene. */
function leaksIn(text: string, known: KnownValues | null): LeakType[] {
  return known === null ? findPatternLeaks(text) : findLeakedKnownValues(text, known);
}

async function completeCaptured(
  provider: AiProvider,
  captured: string[],
  request: AiProviderRequest,
): Promise<AiProviderResult> {
  captured.push(request.prompt);
  return provider.complete(request);
}

/**
 * Kjører eksempelfilene i `casesDir` mot leverandøren. Med `feature` bare `<feature>.cases.json`,
 * ellers alle `*.cases.json` i mappen. Oppsettsfeil samles i `errors`; resten av filene kjøres.
 */
export async function runEvals(options: RunOptions): Promise<EvalResult> {
  const { provider, casesDir, feature } = options;
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
