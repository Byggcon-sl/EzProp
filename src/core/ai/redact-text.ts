/*
 * Vask før KI, den rene delen (docs/funksjoner/fase2a-vask-for-ki.md, punkt 2 og 3, ADR 0006 del 6;
 * delt ut i egen fil i docs/funksjoner/fase2a-evalueringssett.md, punkt 7).
 *
 * Hovedmål: KI i bunnen og de ansatte. All tekst vaskes her før den sendes til en leverandør, så
 * takstmannen kan skrive fritt, og navn, e-post, telefon, adresse og matrikkel sendes aldri (regel 14).
 *
 * Tre trinn: først e-post (så en adresse med et kjent navn i ikke blir delvis vasket), så de kjente
 * verdiene for oppdraget (lengste først), deretter de faste mønstrene i `@/shared/lib/pii-patterns`.
 * En verdi som er både kjent og treffer et mønster, telles én gang.
 *
 * Filen er ren: ingen database og ingen tilgangssjekk, så den kan brukes av evalueringssettet uten
 * database. Oppslaget av kjente verdier ligger i `./redaction.ts`.
 *
 * Kjente verdier lever bare i minnet under det ene kallet: ingen mellomlagring her (ingen Map, Set
 * eller `let` på toppnivå), og de skrives aldri til logger, feilmeldinger eller svar. Feil kastes
 * videre (A176): ingen usvasket tekst slipper gjennom.
 *
 * Endring i denne filen krever gjennomgang av sikkerhet-personvern i PR-en.
 */

import {
  normalizeForRedaction,
  PII_PLACEHOLDER,
  redactEmails,
  redactPii,
} from "@/shared/lib/pii-patterns";

/**
 * Mønsteret for de kjente verdiene kunne ikke lages. Meldingen er fast og har aldri verdiene, og
 * originalfeilen sendes ikke videre (ingen `cause`): den har mønsteret med verdiene i seg.
 */
export class RedactionPatternError extends Error {
  constructor() {
    super("Teksten kunne ikke vaskes før KI. Forslaget ble ikke laget.");
    this.name = "RedactionPatternError";
  }
}

export type KnownCadastralUnit = {
  gnr: string | null;
  bnr: string | null;
  fnr: string | null;
  snr: string | null;
  shareNumber: string | null;
};

export type KnownValues = {
  /** Personnavn: vaskes som hel frase og hvert ord på minst tre tegn (A174). */
  personNames: string[];
  /** Firmanavn, borettslag, sameie, forretningsfører og bestillerteksten: bare hel frase. */
  phrases: string[];
  emails: string[];
  phones: string[];
  orgNumbers: string[];
  addresses: {
    /** Hele adresser (`orders.address_text`, `properties.address`). Deles opp her. */
    full: string[];
    /** Poststed og kommunenavn, vaskes alene. */
    places: string[];
    /** Postnummer, vaskes bare sammen med et poststed. */
    postalCodes: string[];
  };
  cadastral: {
    units: KnownCadastralUnit[];
    municipalityNumbers: string[];
  };
};

export type RedactionResult = { text: string; count: number };

export function emptyKnownValues(): KnownValues {
  return {
    personNames: [],
    phrases: [],
    emails: [],
    phones: [],
    orgNumbers: [],
    addresses: { full: [], places: [], postalCodes: [] },
    cadastral: { units: [], municipalityNumbers: [] },
  };
}

// Grenser med Unicode (aldri ordgrense-forkortelsen): æ, ø og å regnes som bokstaver.
const START = "(?<![\\p{L}\\p{N}])";
const END = "(?![\\p{L}\\p{N}])";
// Genitiv på navn og fraser: «Hansens», «Hansen's», «Hans'».
const GENITIVE = "(?:['\u2019]s|s|['\u2019])?";
const SPACE = "[\\s\\u00A0\\u2009\\u202F]+";
const HYPHEN = "\\s*[-\u2010\u2013]\\s*";
const DIGIT_SEP = "[ \\u00A0\\u2009\\u202F.\\-]?";

const MIN_PHRASE_LENGTH = 2;
const MIN_WORD_LENGTH = 3;

const LEGAL_SUFFIX = /[\s\u00A0\u2009\u202F]+(?:AS|ASA|A\/S|BA|SA|ANS|DA|ENK|NUF|BL|SE)$/iu;

const CADASTRAL_WORDS = {
  gnr: "(?:gnr|g\\.\\s?nr|gårdsnr|gårdsnummer)",
  bnr: "(?:bnr|b\\.\\s?nr|bruksnr|bruksnummer)",
  fnr: "(?:fnr|f\\.\\s?nr|festenr|festenummer)",
  snr: "(?:snr|s\\.\\s?nr|seksjonsnr|seksjonsnummer|seksjon)",
  share: "(?:andelsnr|andelsnummer|andel\\s?nr)",
} as const;
const CADASTRAL_COMBO_WORD =
  "(?:(?:gbnr|g\\.?\\s?b\\.?\\s?nr|g/bnr|gnr|matr(?:ikkel)?(?:nr|nummer)?)\\.?:?[ \\u00A0\\u2009\\u202F]*)?";

type Alternative = { source: string; placeholder: string; weight: number };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * Normalisert (NFC, vanlige sifre) uten usynlige tegn, trimmet, mellomrom slått sammen. `null` hvis verdien er for kort eller
 * uten bokstav/siffer.
 */
function clean(value: string | null | undefined, minLength = MIN_PHRASE_LENGTH): string | null {
  if (value === null || value === undefined) return null;
  const normalized = normalizeForRedaction(value)
    .replace(/[\s\u00A0\u2009\u202F]+/gu, " ")
    .trim();
  if (normalized.length < minLength) return null;
  if (!/[\p{L}\p{N}]/u.test(normalized)) return null;
  return normalized;
}

/** Mønster for en frase: mellomrom og bindestrek er fleksible, alt annet escapes. */
function phraseSource(value: string): string {
  return value
    .split(" ")
    .map((token) =>
      token
        .split(/[-\u2010\u2013]/u)
        .map(escapeRegExp)
        .join(HYPHEN),
    )
    .join(SPACE);
}

function digitsSource(digits: string): string {
  return digits.split("").join(DIGIT_SEP);
}

function stripEdges(token: string): string {
  return token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function addPhrase(
  alternatives: Alternative[],
  value: string | null,
  placeholder: string,
  minLength = MIN_PHRASE_LENGTH,
): void {
  const cleaned = clean(value, minLength);
  if (!cleaned) return;
  alternatives.push({
    source: `${START}${phraseSource(cleaned)}${GENITIVE}${END}`,
    placeholder,
    weight: cleaned.length,
  });
}

function addPersonName(alternatives: Alternative[], value: string): void {
  const cleaned = clean(value);
  if (!cleaned) return;
  addPhrase(alternatives, cleaned, PII_PLACEHOLDER.name);
  for (const token of cleaned.split(" ")) {
    const whole = stripEdges(token);
    if (whole.length >= MIN_WORD_LENGTH) addPhrase(alternatives, whole, PII_PLACEHOLDER.name);
    for (const part of whole.split(/[-\u2010\u2013]/u)) {
      const word = stripEdges(part);
      if (word.length >= MIN_WORD_LENGTH) addPhrase(alternatives, word, PII_PLACEHOLDER.name);
    }
  }
}

function addCompanyPhrase(alternatives: Alternative[], value: string): void {
  const cleaned = clean(value);
  if (!cleaned) return;
  addPhrase(alternatives, cleaned, PII_PLACEHOLDER.name);
  // Uten selskapsform («Testesen Bygg AS» → «Testesen Bygg»), bare når det står igjen minst to ord,
  // så et enkelt fagord («Tak AS» → «Tak») aldri vaskes alene.
  const withoutSuffix = cleaned.replace(LEGAL_SUFFIX, "").trim();
  if (withoutSuffix !== cleaned && withoutSuffix.includes(" ")) {
    addPhrase(alternatives, withoutSuffix, PII_PLACEHOLDER.name);
  }
  // Bestillerteksten kan ha flere deler med komma («Ola Testesen, Testmegling AS»).
  if (cleaned.includes(",")) {
    for (const part of cleaned.split(",")) {
      const trimmed = part.trim();
      if (trimmed.includes(" ") || trimmed.length >= MIN_WORD_LENGTH) {
        addPhrase(alternatives, trimmed, PII_PLACEHOLDER.name);
      }
    }
  }
}

function addDigits(
  alternatives: Alternative[],
  value: string,
  placeholder: string,
  prefix: string,
  suffix: string,
  normalize: (digits: string) => string = (digits) => digits,
): void {
  const digits = normalize(value.replace(/\D/g, ""));
  if (digits.length < 5) return;
  alternatives.push({
    source: `${START}${prefix}${digitsSource(digits)}${suffix}${END}`,
    placeholder,
    weight: digits.length,
  });
}

function normalizePhoneDigits(digits: string): string {
  if (digits.startsWith("0047") && digits.length > 8) return digits.slice(4);
  if (digits.startsWith("47") && digits.length === 10) return digits.slice(2);
  return digits;
}

/** Deler «Fjellia 3 8010 Bodø» i «Fjellia 3» og «8010 Bodø» (adresse uten komma). */
function splitAtPostalCode(part: string): string[] {
  const match = /^(.*?\S)\s+(\d{4}\s+\p{L}.*)$/u.exec(part);
  return match?.[1] && match[2] ? [match[1], match[2]] : [part];
}

function addAddress(alternatives: Alternative[], value: string): void {
  const cleaned = clean(value);
  if (!cleaned) return;
  addPhrase(alternatives, cleaned, PII_PLACEHOLDER.address);
  for (const rawPart of cleaned.split(",")) {
    addPhrase(alternatives, rawPart.trim(), PII_PLACEHOLDER.address);
    for (const part of splitAtPostalCode(rawPart.trim())) {
      addAddressPart(alternatives, part);
    }
  }
}

function addAddressPart(alternatives: Alternative[], part: string): void {
  addPhrase(alternatives, part, PII_PLACEHOLDER.address);
  // «8006 Bodø» gir også poststedet alene.
  const postal = /^(\d{4})\s+(.+)$/u.exec(part);
  if (postal?.[2]) {
    addPhrase(alternatives, postal[2], PII_PLACEHOLDER.address);
    return;
  }
  // «Storgata 12 B» gir gatenavn + nummer (bokstav valgfri) og gatenavnet alene. Uten krav om
  // strengslutt, så «Elvebredden 12 H0101» (med bolignummer) også gir «Elvebredden 12».
  const street = /^(.*?\p{L})\.?\s*(\d{1,4})(?!\p{N})(?:\s?([A-Za-z])(?![\p{L}\p{N}]))?/u.exec(
    part,
  );
  if (street?.[1] && street[2]) {
    const name = clean(street[1], MIN_WORD_LENGTH);
    if (!name) return;
    const letter = street[3] ? escapeRegExp(street[3]) : "[A-Ha-h]";
    alternatives.push({
      source: `${START}${phraseSource(name)}\\.?[\\s\\u00A0\\u2009\\u202F]*${street[2]}(?:[\\s\\u00A0\\u2009\\u202F]?${letter})?${END}`,
      placeholder: PII_PLACEHOLDER.address,
      weight: street[0].length,
    });
    addPhrase(alternatives, name, PII_PLACEHOLDER.address, MIN_WORD_LENGTH);
  }
}

function cadastralValue(value: string | null): string | null {
  const cleaned = clean(value, 1);
  return cleaned && /^[\p{L}\p{N}]+$/u.test(cleaned) ? escapeRegExp(cleaned) : null;
}

function addCadastral(
  alternatives: Alternative[],
  unit: KnownCadastralUnit,
  municipalityNumbers: string[],
): void {
  const gnr = cadastralValue(unit.gnr);
  const bnr = cadastralValue(unit.bnr);
  const placeholder = PII_PLACEHOLDER.cadastral;
  if (gnr && bnr) {
    // Bare som kombinasjon: «12/34», «12/34/0/5», «1804-12/34», «gnr 12/34».
    const municipality = [...municipalityNumbers.map((n) => escapeRegExp(n)), "\\d{4}"].join("|");
    alternatives.push({
      source: `${START}${CADASTRAL_COMBO_WORD}(?:(?:${municipality})\\s?[-/ ]\\s?)?${gnr}\\s?/\\s?${bnr}(?:\\s?/\\s?\\d{1,5}){0,2}${END}`,
      placeholder,
      weight: 100,
    });
  }
  const words: [string, string | null][] = [
    [CADASTRAL_WORDS.gnr, gnr],
    [CADASTRAL_WORDS.bnr, bnr],
    [CADASTRAL_WORDS.fnr, cadastralValue(unit.fnr)],
    [CADASTRAL_WORDS.snr, cadastralValue(unit.snr)],
    [CADASTRAL_WORDS.share, cadastralValue(unit.shareNumber)],
  ];
  for (const [word, value] of words) {
    if (!value) continue;
    alternatives.push({
      source: `${START}${word}\\.?:?[ \\u00A0\\u2009\\u202F]*${value}${END}`,
      placeholder,
      weight: 50,
    });
  }
}

function buildAlternatives(known: KnownValues): Alternative[] {
  const alternatives: Alternative[] = [];
  for (const name of known.personNames) addPersonName(alternatives, name);
  for (const phrase of known.phrases) addCompanyPhrase(alternatives, phrase);
  for (const email of known.emails) {
    const cleaned = clean(email);
    if (!cleaned?.includes("@")) continue;
    alternatives.push({
      source: `(?<![\\p{L}\\p{N}._%+\\-])${escapeRegExp(cleaned)}${END}`,
      placeholder: PII_PLACEHOLDER.email,
      weight: cleaned.length,
    });
  }
  for (const phone of known.phones) {
    addDigits(
      alternatives,
      phone,
      PII_PLACEHOLDER.phone,
      `(?:(?:\\+|00)[ \\u00A0\\u2009\\u202F]?47${DIGIT_SEP})?`,
      "",
      normalizePhoneDigits,
    );
  }
  for (const orgNumber of known.orgNumbers) {
    addDigits(
      alternatives,
      orgNumber,
      PII_PLACEHOLDER.orgNumber,
      "(?:NO[ \\u00A0\\u2009\\u202F]?)?",
      "(?:[ \\u00A0\\u2009\\u202F]?MVA)?",
    );
  }
  for (const address of known.addresses.full) addAddress(alternatives, address);
  for (const place of known.addresses.places) {
    addPhrase(alternatives, place, PII_PLACEHOLDER.address);
    const cleanedPlace = clean(place);
    if (!cleanedPlace) continue;
    for (const code of known.addresses.postalCodes) {
      const cleanedCode = clean(code);
      if (cleanedCode) {
        addPhrase(alternatives, `${cleanedCode} ${cleanedPlace}`, PII_PLACEHOLDER.address);
      }
    }
  }
  const municipalityNumbers = known.cadastral.municipalityNumbers
    .map((n) => clean(n, 1))
    .filter((n): n is string => n !== null && /^\d+$/.test(n));
  for (const unit of known.cadastral.units) addCadastral(alternatives, unit, municipalityNumbers);

  // Like mønstre én gang, lengste først (A174).
  const seen = new Set<string>();
  const unique: Alternative[] = [];
  for (const alternative of alternatives) {
    const key = alternative.source.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(alternative);
  }
  return unique.sort((a, b) => b.weight - a.weight);
}

export type KnownValueMatcher = { pattern: RegExp; placeholders: string[] } | null;

/**
 * Lager ett mønster av de kjente verdiene (lengste først). `null` når det ikke finnes noen.
 * Kaster `RedactionPatternError` hvis mønsteret ikke kan lages, så teksten aldri sendes usvasket.
 */
export function compileKnownValues(known: KnownValues): KnownValueMatcher {
  const alternatives = buildAlternatives(known);
  if (alternatives.length === 0) return null;
  let pattern: RegExp;
  try {
    pattern = new RegExp(alternatives.map((a) => `(${a.source})`).join("|"), "giu");
  } catch {
    // Originalfeilen har mønsteret med de kjente verdiene i meldingen. Den sendes ikke videre.
    throw new RedactionPatternError();
  }
  return { pattern, placeholders: alternatives.map((a) => a.placeholder) };
}

function applyRedaction(text: string, matcher: KnownValueMatcher): RedactionResult {
  // E-post først, så «åse.testesen@eksempel.no» ikke blir «[navn].[navn]@eksempel.no».
  const emails = redactEmails(normalizeForRedaction(text));
  let result = emails.text;
  let count = emails.count;
  if (matcher) {
    const { pattern, placeholders } = matcher;
    result = result.replace(pattern, (...args: unknown[]) => {
      count += 1;
      for (let index = 0; index < placeholders.length; index += 1) {
        if (args[index + 1] !== undefined) return placeholders[index] as string;
      }
      return PII_PLACEHOLDER.name;
    });
  }
  const patterns = redactPii(result);
  return { text: patterns.text, count: count + patterns.count };
}

/**
 * Vasker én tekst: kjente verdier først (lengste først), deretter mønstrene. Ren funksjon.
 * `count` er antall byttede treff.
 */
export function redactText(text: string, known: KnownValues): RedactionResult {
  return applyRedaction(text, compileKnownValues(known));
}

/**
 * Vasker alle feltene i en forespørsel. Med `known` brukes de kjente verdiene i tillegg til
 * mønstrene; med `null` bare mønstrene. Ren funksjon. Kaster ved feil (A176).
 */
export function redactFieldValues(
  fields: Readonly<Record<string, string>>,
  known: KnownValues | null,
): { fields: Record<string, string>; count: number } {
  const matcher = known === null ? null : compileKnownValues(known);
  const redacted: Record<string, string> = {};
  let count = 0;
  for (const [key, value] of Object.entries(fields)) {
    const result = applyRedaction(value, matcher);
    redacted[key] = result.text;
    count += result.count;
  }
  return { fields: redacted, count };
}
