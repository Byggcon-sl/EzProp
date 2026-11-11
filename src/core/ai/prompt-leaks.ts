import { PII_PLACEHOLDER, PII_PLACEHOLDERS, redactPii } from "@/shared/lib/pii-patterns";
import type { KnownValues } from "./redact-text";

/*
 * Lekkasjesjekken (docs/funksjoner/fase2a-ki-leverandor.md Omfang 6, A195). Persondata i teksten
 * som skal til leverandøren, sjekket på egne bein, uten å bruke vasken selv. Brukes både av
 * `requestSuggestion` (på den ferdige, vaskede ledeteksten rett før kallet til en ekte
 * leverandør) og av kjøreren for evalueringssettet. Ren: ingen database, ingen leverandør.
 * Gir aldri verdien, bare typen.
 */

export const WORD_START = "(?<![\\p{L}\\p{N}])";
export const WORD_END = "(?![\\p{L}\\p{N}])";
const WHITESPACE = /[\s   ]+/gu;

/** NFC, og alle typer mellomrom slått sammen til ett vanlig. */
export function normalizeSpaces(text: string): string {
  return text.normalize("NFC").replace(WHITESPACE, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

export function wholeWordPattern(word: string): RegExp {
  return new RegExp(`${WORD_START}${escapeRegExp(normalizeSpaces(word))}${WORD_END}`, "iu");
}

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

/**
 * Persondatatypene i ledeteksten: kjente verdier og mønstrene når `known` finnes, ellers bare
 * mønstrene. Tom liste betyr at teksten kan sendes.
 */
export function findPromptLeaks(text: string, known: KnownValues | null): LeakType[] {
  return known === null ? findPatternLeaks(text) : findLeakedKnownValues(text, known);
}
