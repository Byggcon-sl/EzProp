/*
 * Mønstrene for persondata, samlet ett sted (ADR 0006 del 6, beslutning A169).
 *
 * Hovedmål: KI i bunnen og trygt for de ansatte. Navn, e-post, telefon, adresse og matrikkel
 * sendes aldri til KI (regel 14), og loggen skal ikke ha persondata. Mønstrene brukes både av
 * vasken før KI (`src/core/ai`) og av loggeren (`src/shared/lib/logger.ts`, uten adresser).
 *
 * Vasker heller for mye enn for lite (A170): ingen kontrollsiffersjekk, åtte sifre skrevet sammen
 * regnes som telefon, og to årstall etter hverandre («1985 2010») blir også `[telefon]`.
 * Kontonummer har egen plassholder (A177).
 *
 * Regler for mønstrene: flagget `u`, ingen ordgrense-forkortelse fra regex (æ, ø og å skal
 * regnes som bokstaver), grenser med Unicode-klasser, og ingen nøstede gjentakelser (mønstrene
 * kjøres på lange tekster og på hver logglinje). Tall treffes ikke inne i lengre tall, UUID-er, datoer eller desimaltall.
 *
 * Endring i denne filen krever gjennomgang av sikkerhet-personvern i PR-en.
 */

export const PII_PLACEHOLDER = {
  name: "[navn]",
  email: "[e-post]",
  phone: "[telefon]",
  address: "[adresse]",
  cadastral: "[matrikkel]",
  nationalId: "[fødselsnummer]",
  orgNumber: "[organisasjonsnummer]",
  accountNumber: "[kontonummer]",
} as const;

export type PiiPlaceholder = (typeof PII_PLACEHOLDER)[keyof typeof PII_PLACEHOLDER];

/** Nøyaktig de åtte plassholderne. */
export const PII_PLACEHOLDERS: readonly PiiPlaceholder[] = Object.freeze(
  Object.values(PII_PLACEHOLDER),
);

export type RedactPiiOptions = {
  /** Vask gateadresser og postnummer med poststed. Standard `true`. Loggeren slår det av. */
  addresses?: boolean;
};

export type RedactPiiResult = { text: string; count: number };

// Mellomrom mellom tallgrupper: vanlig og hardt mellomrom.
const SP = "[ \\u00A0]";
// Skilletegn i telefonnumre.
const SEP = "[ \\u00A0.\\-]";

// Tallgrenser. Ikke inntil bokstav, siffer, understrek eller bindestrek (UUID-er og koder), og
// ikke rett etter/før siffer + skilletegn (desimaltall, datoer, klokkeslett, brøker). Brukes av
// organisasjonsnummer og postnummer.
const NUM_START = "(?<![\\p{L}\\p{N}_\\-])(?<!\\p{N}[.,:/])";
const NUM_END = "(?![\\p{L}\\p{N}_\\-])(?![.,:/]\\p{N})";
// Grenser for telefon, fødselsnummer og kontonummer: stopper bare på bokstav eller siffer, så
// «12345678/87654321», «mob-12345678» og «12345678-ring» vaskes. Smale unntak:
// - UUID: ikke etter «8 hex-tegn-» (pluss eventuelle 4-grupper), og ikke foran «-4 hex-tegn-».
// - Desimaltall: ikke etter et kort heltall med komma/punktum («0,12345678»), og ikke foran
//   komma/punktum med ett til tre sifre («12345678,5»).
// - Klokkeslett: ikke inntil kolon og siffer.
const HEX = "[0-9a-fA-F]";
const PII_NUM_START =
  "(?<![\\p{L}\\p{N}])" +
  `(?<!${HEX}{8}(?:-${HEX}{4}){0,3}-)` +
  "(?<!(?<!\\p{N})\\p{N}{1,3}[.,])" +
  "(?<!\\p{N}:)";
const PII_NUM_END =
  "(?![\\p{L}\\p{N}])" + `(?!-${HEX}{4}-)` + "(?![.,]\\p{N}{1,3}(?!\\p{N}))" + "(?!:\\p{N})";
// Ordgrenser for mønstre som starter eller slutter med bokstaver. Eksportert som strenger, så
// vasken av kjente verdier (`src/core/ai`) bruker de samme grensene.
export const WORD_START = "(?<![\\p{L}\\p{N}_])";
export const WORD_END = "(?![\\p{L}\\p{N}_])";

const EMAIL = new RegExp(
  "(?<![\\p{L}\\p{N}._%+\\-])[\\p{L}\\p{N}._%+\\-]+@[\\p{L}\\p{N}.\\-]+\\.\\p{L}{2,}" + WORD_END,
  "gu",
);

// Fødselsnummer: elleve sifre, også med mellomrom eller bindestrek etter de seks første.
const NATIONAL_ID = new RegExp(`${PII_NUM_START}\\d{6}[ \\u00A0\\-]?\\d{5}${PII_NUM_END}`, "gu");

// Kontonummer: 4-2-5 med punktum, mellomrom eller bindestrek.
const ACCOUNT_NUMBER = new RegExp(
  `${PII_NUM_START}\\d{4}[. \\u00A0\\-]\\d{2}[. \\u00A0\\-]\\d{5}${PII_NUM_END}`,
  "gu",
);

// Organisasjonsnummer: ni sifre, også 3-3-3 og «NO 123456789 MVA». Ikke beløp etter «kr».
const ORG_NUMBER = new RegExp(
  `${NUM_START}(?<!kr\\.?${SP})(?:[Nn][Oo]${SP}?)?(?:\\d{9}|\\d{3}${SP}\\d{3}${SP}\\d{3})(?:${SP}?[Mm][Vv][Aa](?![\\p{L}\\p{N}_]))?${NUM_END}`,
  "gu",
);

// Telefon: åtte sifre sammen eller gruppert 3-2-3, 2-2-2-2, 4-4, med +47 eller 0047 foran.
const PHONE = new RegExp(
  `${PII_NUM_START}(?:(?:\\+|00)47${SEP}?)?(?:\\d{8}|\\d{3}${SEP}\\d{2}${SEP}\\d{3}|\\d{2}${SEP}\\d{2}${SEP}\\d{2}${SEP}\\d{2}|\\d{4}${SEP}\\d{4})${PII_NUM_END}`,
  "gu",
);

// Matrikkel: et matrikkelord fulgt av tall (gnr/bnr/fnr/snr, g.nr, gbnr, gårdsnummer …),
// gjerne flere etter hverandre («gnr. 12 bnr. 34»). Tall uten matrikkelord vaskes ikke her.
const CADASTRAL_WORD =
  "(?:(?:g\\.?[ ]?b\\.?|g/b|g\\.?|b\\.?|f\\.?|s\\.?)[ ]?nr\\.?|gårdsnr\\.?|gårdsnummer|bruksnr\\.?|bruksnummer|festenr\\.?|festenummer|seksjonsnr\\.?|seksjonsnummer|matr\\.?(?:ikkel)?(?:nummer|nr\\.?)?)";
const CADASTRAL_PAIR = `${CADASTRAL_WORD}[ \\u00A0:]{0,2}\\d{1,5}(?:/\\d{1,5}){0,3}`;
const CADASTRAL = new RegExp(
  `${WORD_START}${CADASTRAL_PAIR}(?:[ \\u00A0,]{1,3}(?:og[ \\u00A0]{1,2})?${CADASTRAL_PAIR}){0,4}(?![\\p{L}\\p{N}_])`,
  "giu",
);

// Gateadresse: ord som slutter på en kjent endelse, husnummer og eventuell bokstav (A–H).
// Bare disse endelsene (kortet). Ikke «alle» uten aksent, så «alle 3 rom» står urørt.
const STREET_ENDINGS =
  "(?:veien|vegen|veg|vei|vn\\.?|gaten|gata|gate|gt\\.?|plassen|bakken|stien|all\\u00E9)";
const STREET = new RegExp(
  `${WORD_START}\\p{L}*${STREET_ENDINGS}${SP}\\d{1,4}(?:${SP}?[A-Ha-h])?${WORD_END}`,
  "giu",
);
// Postnummer med poststed («8006 Bodø»). Postnummer alene står.
const POSTAL_PLACE = new RegExp(
  `${NUM_START}\\d{4}${SP}\\p{Lu}\\p{L}+(?:-\\p{Lu}\\p{L}+)?${WORD_END}`,
  "gu",
);

// Myk bindestrek, nullbredde mellomrom/skjøt/ikke-skjøt og BOM.
const INVISIBLE = /[\u00AD\u200B-\u200D\uFEFF]/gu;

/** NFKC og uten usynlige tegn. Brukes før all vask (også av `src/core/ai`). */
export function normalizeForRedaction(text: string): string {
  return text.normalize("NFKC").replace(INVISIBLE, "");
}

type Rule = { pattern: RegExp; placeholder: string; address?: boolean };

// Rekkefølgen er viktig: lange tall før korte, så elleve sifre ikke blir telefon pluss rest.
const RULES: readonly Rule[] = [
  { pattern: EMAIL, placeholder: PII_PLACEHOLDER.email },
  { pattern: NATIONAL_ID, placeholder: PII_PLACEHOLDER.nationalId },
  { pattern: ACCOUNT_NUMBER, placeholder: PII_PLACEHOLDER.accountNumber },
  { pattern: ORG_NUMBER, placeholder: PII_PLACEHOLDER.orgNumber },
  { pattern: PHONE, placeholder: PII_PLACEHOLDER.phone },
  { pattern: CADASTRAL, placeholder: PII_PLACEHOLDER.cadastral },
  { pattern: STREET, placeholder: PII_PLACEHOLDER.address, address: true },
  { pattern: POSTAL_PLACE, placeholder: PII_PLACEHOLDER.address, address: true },
];

/**
 * Bytter bare e-postadresser med plassholderen. Brukes av vasken før KI før de kjente verdiene,
 * så et kjent navn inne i en e-postadresse ikke gir delvis vask. Teksten må være normalisert.
 */
export function redactEmails(text: string): RedactPiiResult {
  let count = 0;
  const result = text.replace(EMAIL, () => {
    count += 1;
    return PII_PLACEHOLDER.email;
  });
  return { text: result, count };
}

/**
 * Bytter persondata i teksten med nøytrale plassholdere. `count` er antall treff.
 * Teksten normaliseres til NFKC først, og usynlige tegn (myk bindestrek, nullbredde-tegn, BOM)
 * fjernes, så de ikke kan skjule persondata.
 */
export function redactPii(text: string, options: RedactPiiOptions = {}): RedactPiiResult {
  const addresses = options.addresses ?? true;
  let result = normalizeForRedaction(text);
  let count = 0;
  for (const rule of RULES) {
    if (rule.address && !addresses) continue;
    result = result.replace(rule.pattern, () => {
      count += 1;
      return rule.placeholder;
    });
  }
  return { text: result, count };
}
