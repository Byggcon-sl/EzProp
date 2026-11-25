import { PII_PLACEHOLDERS } from "@/shared/lib/pii-patterns";
import { GUESS_WORDS } from "./guess-words";
import { normalizeSpaces, wholeWordPattern, WORD_END, WORD_START } from "./prompt-leaks";
import type { AiGuardAnswerPart, AiGuardCode, AiGuardSentPart, CheckAnswerGuards } from "./types";

/*
 * Vaktene på svaret fra leverandøren (docs/funksjoner/fase2a-ki-i-veien.md «Vaktene på svaret»,
 * ADR 0006 del 7, T-0046, T-0111, A431, A440, A461, A466 og A471). Ren: ingen database, ingen
 * leverandør, ingen logging. Brukes av `requestSuggestion` og av kjøreren for evalueringssettet,
 * med testsakene i `guard-cases.ts`.
 *
 * Støtter hovedmålene KI i bunnen (samme vakter for alle funksjoner) og færre reklamasjoner (et
 * svar som endrer TG, legger til tall, mister et funn eller endrer skjulte opplysninger, vises
 * aldri). Vaktene feiler lukket: er de i tvil, stoppes svaret.
 */

// «TG 2», «TG-2», «TGIU», «tilstandsgrad 2», «tilstandsgraden» og «ikke undersøkt» (regnes som TGIU)
const TG_MENTION = new RegExp(
  `${WORD_START}(?:tg[\\s-]?(?:[0-3]|iu)|tilstandsgrad\\p{L}*(?:\\s?[0-3])?|ikke\\s+undersøkt\\p{L}*)${WORD_END}`,
  "giu",
);
const NOT_EXAMINED = /^ikke\s*undersøkt/iu;

/**
 * TG-omtalene i teksten i rekkefølge, uten mellomrom og med små bokstaver («TG 2» blir «tg2»).
 * «ikke undersøkt» blir «tgiu». «STG2» og «TG23» er ikke treff.
 */
export function extractTgMentions(text: string): string[] {
  const normalized = normalizeSpaces(text);
  return Array.from(normalized.matchAll(TG_MENTION), (match) => {
    if (NOT_EXAMINED.test(match[0])) return "tgiu";
    return match[0].replace(/\s/gu, "").toLowerCase();
  });
}

/**
 * Felles form til sammenligningen: «tg-2», «tg2» og «tilstandsgrad2» er like. En omtale uten grad
 * («tilstandsgraden») blir «tilstandsgrad».
 */
function canonicalTg(mention: string): string {
  const withoutDash = mention.replace(/-/gu, "");
  const grade = /^tilstandsgrad\p{L}*([0-3])$/u.exec(withoutDash);
  if (grade) return `tg${grade[1]}`;
  if (withoutDash.startsWith("tilstandsgrad")) return "tilstandsgrad";
  return withoutDash;
}

function tgSignature(texts: readonly string[]): string {
  return texts
    .flatMap((text) => extractTgMentions(text).map(canonicalTg))
    .sort()
    .join(",");
}

/** Tom etter at alle typer mellomrom er tatt bort, også ikke-brytende (U+00A0) (T-0111). */
export function isBlankText(text: string): boolean {
  return text.replace(/[\s    ​﻿]/gu, "") === "";
}

// Merkene i formatet (K1, F2, G3) er ikke tall i teksten
const LABEL = /(?<![\p{L}\p{N}])[KFG]\d+(?![\p{L}\p{N}])/gu;
// Tall med mellomrom som tusenskille («40 000»), eller sifre, med eventuelle desimaler
const THOUSANDS = "\\d{1,3}(?:[ \\u00A0\\u2009\\u202F]\\d{3})+";
const NUMBER = new RegExp(`(?<!\\p{N})(?:${THOUSANDS}|\\d+)(?:[.,]\\d+)?(?!\\p{N})`, "gu");

/**
 * Tallene i teksten som sifferrekker, med desimaltegnet slik det står og uten mellomrom som
 * tusenskille: «40 000» og «40000» er like, «15,0» og «15» er ikke det (A471).
 */
export function extractNumbers(text: string): string[] {
  const withoutLabels = text.normalize("NFC").replace(LABEL, " ");
  return Array.from(withoutLabels.matchAll(NUMBER), (match) => match[0].replace(/[    ]/gu, ""));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

const PLACEHOLDER = new RegExp(PII_PLACEHOLDERS.map(escapeRegExp).join("|"), "gu");

/** Plassholderne fra vasken i den rekkefølgen de står. */
export function extractPlaceholders(text: string): string[] {
  return Array.from(text.matchAll(PLACEHOLDER), (match) => match[0]);
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sentFor(sent: readonly AiGuardSentPart[], label: string | null): AiGuardSentPart | null {
  return sent.find((part) => part.label === label) ?? null;
}

/** Svar med tekst per merke: et merke som mangler, er tomt, står to ganger eller er ukjent. */
function coverageFails(sent: readonly AiGuardSentPart[], answer: readonly AiGuardAnswerPart[]) {
  const sentLabels = new Set(sent.map((part) => part.label));
  const seen = new Set<string | null>();
  for (const part of answer) {
    if (!sentLabels.has(part.label) || seen.has(part.label) || isBlankText(part.text)) return true;
    seen.add(part.label);
  }
  return seen.size !== sentLabels.size;
}

/**
 * Delene som skal sammenlignes: for sammendraget hver del mot delen med samme merke, ellers hele
 * svaret mot alt som ble sendt.
 */
function pairs(
  feature: string,
  sent: readonly AiGuardSentPart[],
  answer: readonly AiGuardAnswerPart[],
): { sentTexts: readonly string[]; answerText: string }[] | null {
  if (feature === "summary_draft") {
    const out: { sentTexts: readonly string[]; answerText: string }[] = [];
    for (const part of answer) {
      const match = sentFor(sent, part.label);
      if (!match) return null;
      out.push({ sentTexts: match.texts, answerText: part.text });
    }
    return out;
  }
  return [
    {
      sentTexts: sent.flatMap((part) => part.texts),
      answerText: answer.map((part) => part.text).join("\n"),
    },
  ];
}

/** Et tall i svaret som ikke finnes i det som ble sendt for samme del. */
function hasNewNumber(sentTexts: readonly string[], answerText: string): boolean {
  const known = new Set(sentTexts.flatMap(extractNumbers));
  return extractNumbers(answerText).some((value) => !known.has(value));
}

/** Plassholderne i svaret er ikke nøyaktig de samme, i samme rekkefølge, som i det som ble sendt. */
function placeholdersDiffer(sentTexts: readonly string[], answerText: string): boolean {
  return !sameList(sentTexts.flatMap(extractPlaceholders), extractPlaceholders(answerText));
}

// --- override_summary (ADR 0006, tillegg 24.11.2026) -------------------------------------------

function containsWord(text: string, word: string): boolean {
  return normalizeSpaces(word) !== "" && wholeWordPattern(word).test(normalizeSpaces(text));
}

/** Korteste navneord som telles alene. Kortere ord («Li», «Bo») gir for mange falske treff. */
const NAME_PART_MIN_LENGTH = 3;

/** Hele navnet og hvert navneord på minst tre bokstaver. */
function namePartsOf(name: string): string[] {
  const whole = normalizeSpaces(name);
  if (whole === "") return [];
  const parts = whole.split(" ").filter((part) => part.length >= NAME_PART_MIN_LENGTH);
  return [whole, ...parts];
}

/** En TG-omtale i svaret som ikke står i det som ble sendt (for eksempel i en etikett). */
function hasNewTgMention(sentTexts: readonly string[], answerText: string): boolean {
  const known = new Set(sentTexts.flatMap((text) => extractTgMentions(text).map(canonicalTg)));
  return extractTgMentions(answerText)
    .map(canonicalTg)
    .some((mention) => !known.has(mention));
}

/** Et gjetteord i svaret som ikke står i det som ble sendt. */
function hasNewGuessWord(sentTexts: readonly string[], answerText: string): boolean {
  const sent = sentTexts.join("\n");
  return GUESS_WORDS.some((word) => containsWord(answerText, word) && !containsWord(sent, word));
}

/**
 * Navnet på en ansatt i svaret: hele navnet eller et navneord, som hele ord. Et ord som står i
 * det som ble sendt (for eksempel i navnet på et kontrollpunkt), regnes ikke: det er grunnlaget,
 * ikke noe KI har lagt til.
 */
function hasPersonName(
  sentTexts: readonly string[],
  answerText: string,
  personNames: readonly string[],
): boolean {
  const sent = sentTexts.join("\n");
  return personNames
    .flatMap(namePartsOf)
    .some((part) => containsWord(answerText, part) && !containsWord(sent, part));
}

function overrideSummaryGuard(
  sent: readonly AiGuardSentPart[],
  answer: readonly AiGuardAnswerPart[],
  personNames: readonly string[],
): AiGuardCode | null {
  const sentTexts = sent.flatMap((part) => part.texts);
  const answerText = answer.map((part) => part.text).join("\n");
  if (hasNewTgMention(sentTexts, answerText)) return "tg_guard";
  if (hasNewNumber(sentTexts, answerText)) return "number_guard";
  if (hasNewGuessWord(sentTexts, answerText)) return "guess_guard";
  if (hasPersonName(sentTexts, answerText, personNames)) return "name_guard";
  if (extractPlaceholders(answerText).length > 0) return "placeholder_guard";
  return null;
}

/**
 * Vaktene i fast rekkefølge (A471): `tg_guard`, `coverage_guard`, `number_guard`,
 * `placeholder_guard`. Den første som slår til, er svaret; `null` betyr at svaret kan vises.
 * `phrase_suggest` har ingen tekst i svaret og kjører ikke vaktene. `override_summary` har egen
 * rekkefølge med `guess_guard` og `name_guard` (se `CheckAnswerGuards` i types.ts).
 */
export const checkAnswerGuards: CheckAnswerGuards = ({ feature, sent, answer, personNames }) => {
  if (feature === "phrase_suggest") return null;
  if (feature === "override_summary") return overrideSummaryGuard(sent, answer, personNames ?? []);
  const summary = feature === "summary_draft";

  // 1. TG: sammendraget nevner aldri TG; språkvasken har samme TG-omtaler som det som ble sendt
  if (summary) {
    if (answer.some((part) => extractTgMentions(part.text).length > 0)) return "tg_guard";
  } else {
    const sentTexts = sent.flatMap((part) => part.texts);
    if (tgSignature(sentTexts) !== tgSignature(answer.map((part) => part.text))) {
      return "tg_guard";
    }
  }

  // 2. Dekning: hvert funn nøyaktig én gang, med tekst (bare sammendraget)
  if (summary && coverageFails(sent, answer)) return "coverage_guard";

  const compared = pairs(feature, sent, answer);
  // Kan ikke delene pares, er noe galt i svaret: feil lukket
  if (compared === null) return summary ? "coverage_guard" : "number_guard";

  // 3. Tall, per del
  if (compared.some(({ sentTexts, answerText }) => hasNewNumber(sentTexts, answerText))) {
    return "number_guard";
  }

  // 4. Plassholdere, per del
  if (compared.some(({ sentTexts, answerText }) => placeholdersDiffer(sentTexts, answerText))) {
    return "placeholder_guard";
  }
  return null;
};

/** Om koden er en vaktkode (til typene i kalleren). */
export function isGuardCode(value: unknown): value is AiGuardCode {
  return (
    value === "tg_guard" ||
    value === "coverage_guard" ||
    value === "number_guard" ||
    value === "placeholder_guard" ||
    value === "guess_guard" ||
    value === "name_guard"
  );
}
