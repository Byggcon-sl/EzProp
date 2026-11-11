/*
 * Mønstrene for personopplysninger, ett sted (ADR 0006 del 6). Brukes av vasken før KI
 * (`src/core/ai`) og av loggeren (`logger.ts`), så de aldri kopieres og loggeren er like streng
 * som vasken.
 *
 * Hovedmål: KI i bunnen og trygt for de ansatte. Navn, e-post, telefon, adresse og matrikkel
 * sendes aldri til KI (regel 14), og havner heller ikke i loggen.
 *
 * Valg (A169, A170, A177): heller for mye enn for lite. Ingen kontrollsiffersjekk på
 * fødselsnummer; to årstall etter hverandre («1985 2010») blir telefon, og det er villet.
 * Mønstrene er en sikring, ikke full gjenkjenning; oppdragets egne verdier vaskes som kjente
 * verdier i `src/core/ai`.
 *
 * Regler for mønstrene: flagget `u`, aldri ordgrense med `\b` (den regner ikke æ, ø og å som
 * bokstaver). Grensene skrives med `\p{L}` og `\p{N}`. Tall treffer aldri inne i et lengre tall,
 * en dato eller en UUID. Ingen nøstede gjentakelser, så vasken er lineær også på lange tekster.
 *
 * Endring i denne filen krever gjennomgang av sikkerhet-personvern i PR-en.
 *
 * Ren fil: ingen avhengigheter og ingen import fra `src/core`.
 */

export const PII_PLACEHOLDERS = {
  name: "[navn]",
  email: "[e-post]",
  phone: "[telefon]",
  address: "[adresse]",
  cadastral: "[matrikkel]",
  nationalId: "[fødselsnummer]",
  orgNumber: "[organisasjonsnummer]",
  accountNumber: "[kontonummer]",
} as const;

export type PiiPlaceholder = (typeof PII_PLACEHOLDERS)[keyof typeof PII_PLACEHOLDERS];

/** De åtte plassholderne som liste. */
export const PII_PLACEHOLDER_LIST: readonly PiiPlaceholder[] = Object.values(PII_PLACEHOLDERS);

// Grenser for tall: ikke inntil bokstav eller siffer, ikke etter «siffer/heks + bindestrek»
// (UUID, dato) eller «siffer + . / :» (dato, desimal, klokkeslett), og tilsvarende etter.
const NUM_START = String.raw`(?<![\p{L}\p{N}])(?<![\p{N}a-fA-F]-)(?<![\p{N}][.\/:])`;
const NUM_END = String.raw`(?![\p{L}\p{N}])(?!-[\p{N}a-fA-F])(?![.\/:]\p{N})`;
const WORD_START = String.raw`(?<![\p{L}\p{N}])`;

const EMAIL = new RegExp(
  String.raw`(?<![\p{L}\p{N}._%+\-])[\p{L}\p{N}._%+\-]+@[\p{L}\p{N}.\-]+\.\p{L}{2,}(?![\p{L}\p{N}])`,
  "gu",
);

// Elleve sifre, også med mellomrom etter de seks første (ingen kontrollsiffersjekk).
const NATIONAL_ID = new RegExp(String.raw`${NUM_START}\d{6} ?\d{5}${NUM_END}`, "gu");

// Kontonummer 4-2-5 med punktum eller mellomrom.
const ACCOUNT_NUMBER = new RegExp(String.raw`${NUM_START}\d{4}[. ]\d{2}[. ]\d{5}${NUM_END}`, "gu");

// Organisasjonsnummer: 123456789, 123 456 789 og NO 123456789 MVA.
const ORG_NUMBER = new RegExp(
  String.raw`(?:${WORD_START}NO ?|${NUM_START})(?:\d{9}|\d{3} \d{3} \d{3})(?: ?MVA)?${NUM_END}`,
  "gu",
);

// Telefon: åtte sifre sammen, 3-2-3, 2-2-2-2 eller 4-4, med mellomrom, bindestrek eller punktum,
// og eventuelt +47 eller 0047 foran. 2-2-4 (datoen 11.11.2026) er ikke et telefonformat.
const PHONE_SEP = "[ .\\-]";
const PHONE = new RegExp(
  String.raw`(?:${WORD_START}(?:\+|00)47${PHONE_SEP}?|${NUM_START})` +
    String.raw`(?:\d{8}|\d{3}${PHONE_SEP}\d{2}${PHONE_SEP}\d{3}|\d{2}${PHONE_SEP}\d{2}${PHONE_SEP}\d{2}${PHONE_SEP}\d{2}|\d{4}${PHONE_SEP}\d{4})` +
    NUM_END,
  "gu",
);

// Matrikkel: et matrikkelord med tall etter, og flere i rekke («gnr. 12 bnr. 34»).
// Tall som 12/34 eller 12/34/0/5 vaskes bare når et matrikkelord står foran.
const CADASTRAL_WORD = String.raw`(?:(?:g|b|f|s|gb)\.? ?nr|gårdsnr|gårdsnummer|bruksnr|bruksnummer|festenr|festenummer|seksjonsnr|seksjonsnummer)`;
const CADASTRAL_PART = String.raw`${CADASTRAL_WORD}\.?:? {0,2}\d{1,6}(?:\/\d{1,6}){0,3}`;
const CADASTRAL = new RegExp(
  String.raw`${WORD_START}${CADASTRAL_PART}(?:[ ,]{0,3}(?:og {1,3})?${CADASTRAL_PART})*(?!\p{N})`,
  "giu",
);

// Adresse: gatenavn med fast endelse, husnummer og eventuell bokstav; og postnummer med poststed.
// Endelsen alene («Bakken 3») må ha stor forbokstav, så «ved bakken 3 m» ikke treffes.
const STREET_SUFFIX = "(?:veien|vegen|vei|veg|gata|gaten|gate|plassen|bakken|stien|allé)";
const STREET_ALONE = "(?:Veien|Vegen|Vei|Veg|Gata|Gaten|Gate|Plassen|Bakken|Stien|Allé)";
const STREET = new RegExp(
  String.raw`${WORD_START}(?:\p{L}+${STREET_SUFFIX}|${STREET_ALONE}) {1,3}\d{1,4}(?: ?[A-Ha-h])?(?![\p{L}\p{N}])`,
  "gu",
);
const POSTAL = new RegExp(
  String.raw`${NUM_START}\d{4} {1,2}\p{Lu}\p{Ll}+(?:[ \-]\p{Lu}\p{Ll}+)?(?![\p{L}\p{N}])`,
  "gu",
);

type Pattern = { regex: RegExp; placeholder: PiiPlaceholder };

// Rekkefølgen betyr noe: lange tall før korte, så elleve sifre ikke blir telefon pluss rest.
const PATTERNS: readonly Pattern[] = [
  { regex: EMAIL, placeholder: PII_PLACEHOLDERS.email },
  { regex: NATIONAL_ID, placeholder: PII_PLACEHOLDERS.nationalId },
  { regex: ACCOUNT_NUMBER, placeholder: PII_PLACEHOLDERS.accountNumber },
  { regex: ORG_NUMBER, placeholder: PII_PLACEHOLDERS.orgNumber },
  { regex: PHONE, placeholder: PII_PLACEHOLDERS.phone },
  { regex: CADASTRAL, placeholder: PII_PLACEHOLDERS.cadastral },
];

const ADDRESS_PATTERNS: readonly Pattern[] = [
  { regex: STREET, placeholder: PII_PLACEHOLDERS.address },
  { regex: POSTAL, placeholder: PII_PLACEHOLDERS.address },
];

export type RedactPiiOptions = {
  /** Vask adresser (gatenavn med nummer, postnummer med poststed). Standard på; av i loggeren. */
  addresses?: boolean;
};

/**
 * Bytter personopplysninger i teksten med nøytrale plassholdere. `count` er antall treff.
 * Teksten normaliseres til NFC først.
 */
export function redactPii(
  text: string,
  options: RedactPiiOptions = {},
): { text: string; count: number } {
  const addresses = options.addresses ?? true;
  const patterns = addresses ? [...PATTERNS, ...ADDRESS_PATTERNS] : PATTERNS;
  let count = 0;
  let result = text.normalize("NFC");
  for (const { regex, placeholder } of patterns) {
    result = result.replace(regex, () => {
      count += 1;
      return placeholder;
    });
  }
  return { text: result, count };
}
