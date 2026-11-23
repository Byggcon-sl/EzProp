import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { AI_CANDIDATE_REFS_MAX } from "@/shared/config/ai-targets";
import { getFeatureDefinition, type AiFeatureDefinition } from "../features";
import { GUARD_CASES } from "../guard-cases";
import { checkAnswerGuards, extractTgMentions } from "../guards";
import { prepareCandidatePrompt, preparePrompt, prepareSummaryPrompt } from "../prompt";
import { findPromptLeaks, normalizeSpaces, wholeWordPattern, type LeakType } from "../prompt-leaks";
import type { AiProvider, AiProviderRequest, AiProviderResult } from "../providers/types";
import type {
  AiGuardCode,
  AiGuardAnswerPart,
  AiGuardSentPart,
  AiServerInput,
  AiSummaryFinding,
  AiSummaryGroup,
} from "../types";
import {
  EVAL_CASES_FILE_SUFFIX,
  PHRASE_TOP_N,
  SUMMARY_LABEL,
  parseCasesFile,
  toKnownValues,
  type EvalCase,
  type EvalCasesFile,
  type EvalExpectation,
  type EvalVerdict,
  type PhraseEvalCase,
  type SummaryEvalCase,
} from "./schema";

/*
 * Kjøreren for evalueringssettet (docs/funksjoner/fase2a-evalueringssett.md, Omfang 4, ADR 0006
 * del 9; utvidet med `phrase_suggest` og `summary_draft` i docs/funksjoner/fase2a-ki-i-veien.md).
 * Hovedmål: KI i bunnen. Hver KI-funksjon prøves på faste eksempler med fasit. Færre
 * reklamasjoner: sammendraget måles på at ingen funn mangler, og at KI ikke legger til TG, tall,
 * gjetteord eller samlekonklusjoner.
 *
 * Settet går samme vei som ekte bruk: `preparePrompt` (rensing, vask, ledetekst, kandidater og
 * funn) og så leverandøren. Teksten leverandøren fikk, fanges og sjekkes på egne bein for
 * persondata, uten å bruke vasken selv. Svaret til `summary_draft` går gjennom de samme vaktene
 * som i kjernen (`checkAnswerGuards` i `../guards`), og vaktsakene fra kjernen (`../guard-cases`)
 * kjøres også her. Kjøreren bruker ikke databasen og logger ikke (A182), og eksporteres ikke fra
 * `src/core/ai/index.ts`. Svaret fra leverandøren og verdiene fra eksemplene skrives aldri ut.
 *
 * Mot den falske leverandøren gir bare oppsett, krasj, persondata og vaktsaker som ikke gir
 * forventet vakt avslutningskode 1, ikke treffprosent eller mustPass (A183). Resultatet mot den
 * falske leverandøren viser ikke kvaliteten på KI (T-0047).
 */

/** Lekkasjesjekken bor i `../prompt-leaks.ts`; eksportert herfra også for testene. */
export {
  findLeakedKnownValues,
  findPatternLeaks,
  findPromptLeaks,
  type LeakType,
} from "../prompt-leaks";

/** TG-omtalene bor i kjernen (`../guards.ts`) og brukes både der og her. Ingen egen kopi. */
export { extractTgMentions } from "../guards";

/** Den eneste leverandørkoden kjøreren godtar. Ekte leverandører koster penger (Omfang 7). */
const EVAL_PROVIDER_CODE = "fake";

/** Linjen som alltid står først i utskriften (T-0047). */
export const FAKE_PROVIDER_NOTICE =
  "Merk: kjørt mot den falske leverandøren. Resultatet prøver oppsettet, vaktene og fasiten, " +
  "ikke kvaliteten på KI. Kvaliteten måles først mot en ekte leverandør.";

/** Kjøreren ble gitt en annen leverandør enn den falske. Ingenting er kalt. */
export class EvalProviderNotAllowedError extends Error {
  constructor() {
    super("Evalueringssettet kjøres bare mot den falske leverandøren.");
    this.name = "EvalProviderNotAllowedError";
  }
}

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
  /** Id-ene der kjøringen kastet (leverandøren, vasken eller vaktene). */
  crashes: string[];
};

/** Vaktsakene fra kjernen kjørt her. `mismatches` er id-ene som ikke ga forventet vakt. */
export type EvalGuardCasesResult = { total: number; mismatches: string[] };

export type EvalResult = {
  features: EvalFeatureResult[];
  guardCases: EvalGuardCasesResult;
  /** Oppsettsfeil: ukjent funksjon, manglende eller ugyldig fil, skjemafeil. */
  errors: string[];
};

export type EvalCaseEvaluation = { passed: boolean; reasons: string[] };

// ---------------------------------------------------------------------------------------------
// Ordlistene vurderingen bruker

/**
 * Gjetteordene (regel 7). Samme liste som maltesten (`src/db/seed/templates/wet-room.test.ts`);
 * `tests/no-copy-from-research.test.ts` holder dem like.
 */
export const EVAL_GUESS_WORDS: readonly string[] = [
  "antas",
  "trolig",
  "sannsynligvis",
  "antagelig",
  "muligens",
  "formentlig",
  "ser ut til",
  "antar",
  "antakelig",
  "sannsynlig",
  "kanskje",
  "tyder på",
  "virker som",
  "tilsynelatende",
];

/**
 * Graderingsord som i praksis er TG-ord (A464). KI kan bruke dem i sammendraget bare når de står
 * i det samme funnet fra før.
 */
export const EVAL_GRADING_WORDS: readonly string[] = [
  "mindre",
  "alvorlig",
  "alvorlige",
  "vesentlig",
  "vesentlige",
  "betydelig",
  "betydelige",
  "kritisk",
  "kritiske",
];

/** Samlekonklusjoner som funnene ikke dekker. Står aldri i et utkast til sammendrag. */
export const EVAL_CONCLUSION_PHRASES: readonly string[] = [
  "i god stand",
  "i god forfatning",
  "ingen andre avvik",
  "ingen øvrige avvik",
  "ingen flere avvik",
  "uten funn",
  "uten avvik",
  "alt er i orden",
  "for øvrig i orden",
  "ellers i orden",
];

/** Nektelser som ikke kan falle bort i en språkvask (spørsmål 103; ingen vakt i kjernen ennå). */
export const EVAL_NEGATION_WORDS: readonly string[] = ["ikke", "ingen", "uten", "aldri"];

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

function countWholeWord(text: string, word: string): number {
  if (normalizeSpaces(word) === "") return 0;
  const pattern = new RegExp(wholeWordPattern(word).source, "giu");
  return Array.from(normalizeSpaces(text).matchAll(pattern)).length;
}

/** Ordene fra `words` som står i `answer`, men ikke i `input`. */
export function wordsAdded(input: string, answer: string, words: readonly string[]): string[] {
  return words.filter((word) => containsWholeWord(answer, word) && !containsWholeWord(input, word));
}

/** Nektelsene som står færre ganger i svaret enn i inndata. */
export function negationsDropped(input: string, answer: string): string[] {
  return EVAL_NEGATION_WORDS.filter(
    (word) => countWholeWord(answer, word) < countWholeWord(input, word),
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
 * Vurderer svaret fra leverandøren mot fasiten (`language_polish`). `inputText` er de rå feltene
 * fra eksempelet. Utenom fasiten gir det bom når et gjetteord er lagt til, eller når en nektelse
 * («ikke», «ingen», «uten», «aldri») har falt bort. Grunnene nevner kravet, aldri svaret.
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
  for (const word of wordsAdded(inputText, result.text, EVAL_GUESS_WORDS)) {
    reasons.push(`gjetteordet «${word}» er lagt til`);
  }
  for (const word of negationsDropped(inputText, result.text)) {
    reasons.push(`nektelsen «${word}» har falt bort`);
  }
  return { passed: reasons.length === 0, reasons };
}

/** Bruker `verdict`: med `fail` er saken et treff når vurderingen fanget svaret. */
function applyVerdict(
  verdict: EvalVerdict | undefined,
  evaluation: EvalCaseEvaluation,
): EvalCaseEvaluation {
  if (verdict !== "fail") return evaluation;
  return evaluation.passed
    ? { passed: false, reasons: ["det oppdiktede svaret skulle vært fanget, men slapp gjennom"] }
    : { passed: true, reasons: [] };
}

// --- phrase_suggest ------------------------------------------------------------------------------

const CANDIDATE_LABEL = /(?<![\p{L}\p{N}])K([1-9]\d*)(?![\p{L}\p{N}])/gu;

/**
 * Merkene K1…Kn i svaret, som posisjoner (0-basert) i kandidatlisten, i rekkefølge. Ukjente og
 * doble merker tas bort, og høyst `AI_CANDIDATE_REFS_MAX` beholdes, som i kjernen.
 */
export function rankedCandidatePositions(text: string, candidateCount: number): number[] {
  const out: number[] = [];
  for (const match of text.matchAll(CANDIDATE_LABEL)) {
    const position = Number(match[1]) - 1;
    if (position >= candidateCount || out.includes(position)) continue;
    out.push(position);
    if (out.length === AI_CANDIDATE_REFS_MAX) break;
  }
  return out;
}

/** Vurderer en rangert liste med kandidat-id-er mot fasiten for `phrase_suggest`. */
export function evaluatePhrase(
  expectation: PhraseEvalCase["expect"],
  ranked: readonly string[],
): EvalCaseEvaluation {
  if (expectation.outcome === "no_match") {
    return ranked.length === 0
      ? { passed: true, reasons: [] }
      : { passed: false, reasons: [`fasiten venter no_match, fikk ${ranked.length} kandidater`] };
  }
  if (ranked.length === 0) {
    return { passed: false, reasons: ["fasiten venter treff, fikk no_match"] };
  }
  const top = ranked.slice(0, PHRASE_TOP_N);
  return top.some((id) => expectation.correct.includes(id))
    ? { passed: true, reasons: [] }
    : {
        passed: false,
        reasons: [
          `ingen riktig kandidat blant de ${PHRASE_TOP_N} beste (${expectation.correct.join(", ")})`,
        ],
      };
}

// --- summary_draft -------------------------------------------------------------------------------

/**
 * Overskriftene kjøreren gir gruppene. De er bare merker: kjernen og rapporten har sine egne, og
 * overskriften sendes aldri til leverandøren. Kjøreren sjekker at de ikke står i ledeteksten.
 */
const EVAL_HEADING_PREFIX = "Evalueringsoverskrift-";

/** Teksten i ett funn, i rekkefølgen kjernen sender den. */
function findingTexts(finding: AiSummaryFinding): string[] {
  return [
    finding.checkpointName,
    finding.deviationText,
    finding.causeText,
    finding.consequenceText,
    ...finding.measures,
  ].filter((text): text is string => text !== null && text !== "");
}

/** Gruppene som `AiServerInput.summaryGroups`, med funnene merket F1…Fn i rekkefølge. */
export function summaryInputOf(evalCase: SummaryEvalCase): {
  groups: AiSummaryGroup[];
  sent: AiGuardSentPart[];
  fixedTexts: string[];
} {
  const sent: AiGuardSentPart[] = [];
  const fixedTexts: string[] = [];
  const groups = evalCase.groups.map((group): AiSummaryGroup => {
    const heading = `${EVAL_HEADING_PREFIX}${group.group}`;
    if (group.group === "tgiu") {
      fixedTexts.push(...group.fixedLines.map((line) => line.text));
      return { group: group.group, heading, findings: [], fixedLines: group.fixedLines };
    }
    for (const finding of group.findings) {
      sent.push({ label: `F${sent.length + 1}`, texts: findingTexts(finding) });
    }
    return { group: group.group, heading, findings: group.findings, fixedLines: [] };
  });
  return { groups, sent, fixedTexts };
}

const SUMMARY_LINE_LABEL = /(?:^|\n)[ \t]*(F[1-9]\d*)[ \t]*[:.)][ \t]*/gu;

/**
 * Leser svaret fra leverandøren som tekst per F-merke. Godtar et JSON-objekt (`{"F1": "…"}`), en
 * JSON-liste med `{ label, text }`, eller linjer som starter med «F1:». Tekst før første merke
 * får merket `null`, som dekningsvakten stopper.
 */
export function summaryAnswerParts(text: string): AiGuardAnswerPart[] {
  const fromJson = summaryPartsFromJson(text);
  if (fromJson !== null) return fromJson;
  const matches = Array.from(text.matchAll(SUMMARY_LINE_LABEL));
  const parts: AiGuardAnswerPart[] = [];
  const before = text.slice(0, matches[0]?.index ?? text.length).trim();
  if (before !== "") parts.push({ label: null, text: before });
  matches.forEach((match, index) => {
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? text.length;
    parts.push({ label: match[1]!, text: text.slice(start, end).trim() });
  });
  return parts;
}

function summaryPartsFromJson(text: string): AiGuardAnswerPart[] | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (Array.isArray(json)) {
    const parts: AiGuardAnswerPart[] = [];
    for (const item of json) {
      if (typeof item !== "object" || item === null) return null;
      const { label, text: partText } = item as { label?: unknown; text?: unknown };
      if (typeof partText !== "string") return null;
      parts.push({ label: typeof label === "string" ? label : null, text: partText });
    }
    return parts;
  }
  if (typeof json === "object" && json !== null) {
    return Object.entries(json).map(([label, value]) => ({
      label: SUMMARY_LABEL.test(label) ? label : null,
      text: typeof value === "string" ? value : "",
    }));
  }
  return null;
}

/**
 * Vurderer et svar for `summary_draft` som vaktene har sluppet gjennom: rekkefølgen er som sendt
 * (TG3, TG2, HMS), og hver del er uten gjetteord og graderingsord som funnet ikke har. Hele
 * svaret er uten samlekonklusjon og har ordene fasiten krever.
 */
export function evaluateSummaryAnswer(
  expectation: Extract<SummaryEvalCase["expect"], { outcome: "ok" }>,
  sent: readonly AiGuardSentPart[],
  answer: readonly AiGuardAnswerPart[],
): EvalCaseEvaluation {
  const reasons: string[] = [];
  if (
    !sameList(
      answer.map((part) => part.label ?? ""),
      sent.map((part) => part.label ?? ""),
    )
  ) {
    reasons.push("funnene står ikke i rekkefølgen TG3, TG2, TGIU, HMS");
  }
  for (const part of answer) {
    const input = sent.find((s) => s.label === part.label)?.texts.join("\n") ?? "";
    for (const word of wordsAdded(input, part.text, EVAL_GUESS_WORDS)) {
      reasons.push(`${part.label ?? "?"}: gjetteordet «${word}» er lagt til`);
    }
    for (const word of wordsAdded(input, part.text, EVAL_GRADING_WORDS)) {
      reasons.push(`${part.label ?? "?"}: graderingsordet «${word}» står ikke i funnet`);
    }
  }
  const whole = answer.map((part) => part.text).join("\n");
  for (const phrase of EVAL_CONCLUSION_PHRASES) {
    if (containsWholeWord(whole, phrase)) reasons.push(`samlekonklusjon «${phrase}»`);
  }
  for (const word of expectation.mustContain ?? []) {
    if (!containsWholeWord(whole, word)) reasons.push(`mangler «${word}» (mustContain)`);
  }
  for (const word of expectation.mustNotContain ?? []) {
    if (containsWholeWord(whole, word)) reasons.push(`har «${word}» (mustNotContain)`);
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

/** Det én sak gir: treff/bom, persondata i ledeteksten, eller krasj. */
type CaseOutcome =
  | { kind: "evaluated"; evaluation: EvalCaseEvaluation }
  | { kind: "leak"; types: LeakType[] }
  | { kind: "crash" };

type Runner = {
  provider: AiProvider;
  definition: AiFeatureDefinition;
};

/** Bygger ledeteksten som kjernen, sjekker den for persondata og kaller leverandøren hvis `call`. */
async function promptAndCall(
  runner: Runner,
  fields: Readonly<Record<string, string>>,
  known: ReturnType<typeof toKnownValues> | null,
  serverInput: AiServerInput | undefined,
  call: boolean,
): Promise<{ leak: LeakType[] } | { prompt: string; answer: AiProviderResult | null }> {
  const { provider, definition } = runner;
  // Samme ledetekst som kjernen bygger for hver slags inndata (request-suggestion.ts)
  const { prompt } = serverInput?.candidates
    ? prepareCandidatePrompt(definition, fields, serverInput.candidates, known)
    : serverInput?.summaryGroups
      ? prepareSummaryPrompt(definition, serverInput.summaryGroups, known)
      : preparePrompt(definition, fields, known);
  // Lekkasjesjekken før kallet: en ledetekst med persondata sendes aldri til leverandøren
  const leaked = findPromptLeaks(prompt, known);
  if (leaked.length > 0) return { leak: leaked };
  if (!call) return { prompt, answer: null };
  const captured: string[] = [];
  const answer = await completeCaptured(provider, captured, {
    feature: definition.code,
    promptVersion: definition.promptVersion,
    prompt,
    model: provider.model,
  });
  const leakedAfter = new Set<LeakType>();
  for (const text of captured)
    for (const type of findPromptLeaks(text, known)) leakedAfter.add(type);
  if (leakedAfter.size > 0) return { leak: Array.from(leakedAfter) };
  return { prompt, answer };
}

async function runPolishCase(runner: Runner, evalCase: EvalCase): Promise<CaseOutcome> {
  const known = evalCase.known === undefined ? null : toKnownValues(evalCase.known);
  const simulated = evalCase.simulatedAnswer;
  const sent = await promptAndCall(
    runner,
    evalCase.fields,
    known,
    undefined,
    simulated === undefined,
  );
  if ("leak" in sent) return { kind: "leak", types: sent.leak };
  const answer: AiProviderResult = sent.answer ??
    // Oppdiktet svar: står i stedet for leverandørens, uten kall
    { outcome: "ok", text: simulated ?? "", tokensIn: 0, tokensOut: 0, cost: 0, currency: "NOK" };
  const evaluation = evaluateCase(
    evalCase.expect,
    inputTextOf(runner.definition, evalCase.fields),
    answer,
  );
  return { kind: "evaluated", evaluation: applyVerdict(evalCase.expect.verdict, evaluation) };
}

async function runPhraseCase(runner: Runner, evalCase: PhraseEvalCase): Promise<CaseOutcome> {
  const serverInput: AiServerInput = {
    candidates: evalCase.candidates.map(({ source, id, text }) => ({ source, id, text })),
  };
  const sent = await promptAndCall(runner, evalCase.fields, null, serverInput, true);
  if ("leak" in sent) return { kind: "leak", types: sent.leak };
  const answer = sent.answer!;
  if (answer.outcome === "error") {
    return {
      kind: "evaluated",
      evaluation: { passed: false, reasons: ["leverandøren svarte med feil"] },
    };
  }
  const ranked =
    answer.outcome === "ok"
      ? rankedCandidatePositions(answer.text, evalCase.candidates.length).map(
          (position) => evalCase.candidates[position]!.id,
        )
      : [];
  return { kind: "evaluated", evaluation: evaluatePhrase(evalCase.expect, ranked) };
}

async function runSummaryCase(runner: Runner, evalCase: SummaryEvalCase): Promise<CaseOutcome> {
  const { groups, sent, fixedTexts } = summaryInputOf(evalCase);
  const simulated = evalCase.simulatedAnswer;
  const call = await promptAndCall(
    runner,
    {},
    null,
    { summaryGroups: groups },
    simulated === undefined,
  );
  if ("leak" in call) return { kind: "leak", types: call.leak };

  const reasons: string[] = [];
  // Overskriftene og TGIU-linjene er kodens og sendes aldri til KI (A462)
  if (groups.some((group) => call.prompt.includes(group.heading))) {
    reasons.push("overskriften ble sendt til leverandøren");
  }
  if (fixedTexts.some((text) => call.prompt.includes(text))) {
    reasons.push("TGIU-linjen ble sendt til leverandøren");
  }
  if (reasons.length > 0) return { kind: "evaluated", evaluation: { passed: false, reasons } };

  let answer: AiGuardAnswerPart[];
  if (simulated !== undefined) {
    answer = simulated.map((part) => ({ label: part.label, text: part.text }));
  } else {
    const result = call.answer!;
    if (result.outcome !== "ok") {
      return {
        kind: "evaluated",
        evaluation: {
          passed: false,
          reasons: [
            result.outcome === "error"
              ? "leverandøren svarte med feil"
              : `fasiten venter et utkast, fikk ${result.outcome}`,
          ],
        },
      };
    }
    answer = summaryAnswerParts(result.text);
  }

  const guard = checkAnswerGuards({ feature: "summary_draft", sent, answer });
  const expect = evalCase.expect;
  if (expect.outcome === "stopped") {
    return {
      kind: "evaluated",
      evaluation:
        guard === expect.guard
          ? { passed: true, reasons: [] }
          : {
              passed: false,
              reasons: [
                `fasiten venter stoppet av ${expect.guard}, fikk ${guard ?? "ikke stoppet"}`,
              ],
            },
    };
  }
  if (guard !== null) {
    const evaluation = { passed: false, reasons: [`stoppet av ${guard}`] };
    return { kind: "evaluated", evaluation: applyVerdict(expect.verdict, evaluation) };
  }
  const evaluation = evaluateSummaryAnswer(expect, sent, answer);
  return { kind: "evaluated", evaluation: applyVerdict(expect.verdict, evaluation) };
}

type AnyCase = EvalCase | PhraseEvalCase | SummaryEvalCase;

function runCaseFor(
  file: EvalCasesFile,
): (runner: Runner, evalCase: AnyCase) => Promise<CaseOutcome> {
  switch (file.feature) {
    case "phrase_suggest":
      return (runner, evalCase) => runPhraseCase(runner, evalCase as PhraseEvalCase);
    case "summary_draft":
      return (runner, evalCase) => runSummaryCase(runner, evalCase as SummaryEvalCase);
    default:
      return (runner, evalCase) => runPolishCase(runner, evalCase as EvalCase);
  }
}

async function runFeature(
  provider: AiProvider,
  definition: AiFeatureDefinition,
  fileName: string,
  file: EvalCasesFile,
): Promise<EvalFeatureResult> {
  const cases: readonly AnyCase[] = file.cases;
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
  const runCase = runCaseFor(file);
  const runner: Runner = { provider, definition };

  for (const evalCase of cases) {
    let outcome: CaseOutcome;
    try {
      outcome = await runCase(runner, evalCase);
    } catch {
      // Også feil fra mønstrene i sjekkene: eksempelet føres som krasj, uten feilteksten
      outcome = { kind: "crash" };
    }
    if (outcome.kind === "crash") {
      result.crashes.push(evalCase.id);
    } else if (outcome.kind === "leak") {
      result.leaks.push({ id: evalCase.id, types: outcome.types });
    } else if (outcome.evaluation.passed) {
      result.passed += 1;
      if (evalCase.mustPass) result.mustPassPassed += 1;
    } else {
      result.misses.push({ id: evalCase.id, reason: outcome.evaluation.reasons.join("; ") });
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

/**
 * Kjører vaktsakene fra kjernen (`../guard-cases`) gjennom `checkAnswerGuards`. Med `feature`
 * bare sakene for den funksjonen. En sak som ikke gir forventet vakt, er en feil i kjernen.
 */
export function runGuardCases(feature?: string): EvalGuardCasesResult {
  const cases = GUARD_CASES.filter((item) => feature === undefined || item.feature === feature);
  const mismatches: string[] = [];
  for (const item of cases) {
    let got: AiGuardCode | null | "krasj";
    try {
      got = checkAnswerGuards({ feature: item.feature, sent: item.sent, answer: item.answer });
    } catch {
      got = "krasj";
    }
    if (got !== item.expected) mismatches.push(item.name);
  }
  return { total: cases.length, mismatches };
}

/**
 * Kjører eksempelfilene i `casesDir` mot leverandøren. Med `feature` bare `<feature>.cases.json`,
 * ellers alle `*.cases.json` i mappen. Oppsettsfeil samles i `errors`; resten av filene kjøres.
 */
export async function runEvals(options: RunOptions): Promise<EvalResult> {
  const { provider, casesDir, feature } = options;
  // Før alt annet: en ekte leverandør kalles aldri herfra
  if (provider.code !== EVAL_PROVIDER_CODE) throw new EvalProviderNotAllowedError();
  const result: EvalResult = { features: [], guardCases: { total: 0, mismatches: [] }, errors: [] };

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

  result.guardCases = runGuardCases(feature);

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
    result.features.push(await runFeature(provider, definition, fileName, parsed.file));
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

function guardCaseLines(guardCases: EvalGuardCasesResult): string[] {
  if (guardCases.total === 0) return [];
  const ok = guardCases.total - guardCases.mismatches.length;
  const lines = [`Vaktsakene fra kjernen: ${ok} av ${guardCases.total} ga forventet vakt.`];
  for (const id of guardCases.mismatches) lines.push(`  Vaktsak ${id}: ga ikke forventet vakt.`);
  return lines;
}

/**
 * Kjører kommandoen og gir avslutningskode og linjene som skal skrives. Kode 1 for ukjent
 * funksjon, ugyldig fil, skjemafeil, duplisert id, krasj, persondata og vaktsaker som ikke gir
 * forventet vakt. Lav treffprosent og bom på mustPass gir kode 0 (A183). Første linje sier at
 * resultatet mot den falske leverandøren ikke viser kvaliteten (T-0047).
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
  const lines: string[] = [FAKE_PROVIDER_NOTICE];
  for (const feature of result.features) lines.push(...featureLines(feature));
  lines.push(...guardCaseLines(result.guardCases));
  for (const error of result.errors) lines.push(`Feil: ${error}`);

  const crashed = result.features.some((f) => f.crashes.length > 0);
  const leaked = result.features.some((f) => f.leaks.length > 0);
  const guardsWrong = result.guardCases.mismatches.length > 0;
  if (crashed) lines.push("Kjøringen krasjet i minst ett eksempel.");
  if (leaked) lines.push("Persondata nådde leverandøren i minst ett eksempel.");
  if (guardsWrong) lines.push("Minst én vaktsak ga ikke forventet vakt.");

  const failed = result.errors.length > 0 || crashed || leaked || guardsWrong;
  return { exitCode: failed ? 1 : 0, lines };
}
