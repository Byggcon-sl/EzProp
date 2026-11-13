import type { DuplicateReason } from "./codes";

/*
 * Regelen for mulig dublett (T3, Ståle 12.11.2026: «fast regel uten KI, og varselet stopper ikke
 * lagringen»), docs/05-domenemodell.md 4.3. Rene funksjoner uten database, slik at regelen kan
 * prøves med tabelltester. Den samme normaliseringen står som SQL i `./duplicate-sql.ts`; en
 * paritetstest krever like svar.
 *
 * Normaliseringen er bevisst uavhengig av språkinnstillingen i databasen og i Node: bare A–Z og
 * ÆØÅ gjøres små, og bare a–z, 0–9 og æøå beholdes. Andre tegn (også é og ü) tas bort på begge
 * sider. Da gir TS og SQL samme svar uansett `LC_CTYPE` på serveren.
 */

/** Ordren og den andre ordren kan være dubletter når `received_at` er høyst så mange døgn fra hverandre. */
export const MAX_DUPLICATE_WINDOW_DAYS = 90;

/** 90 døgn som fast varighet (90 × 24 timer), ikke kalenderdøgn. Samme som `interval '2160 hours'`. */
export const MAX_DUPLICATE_WINDOW_MS = MAX_DUPLICATE_WINDOW_DAYS * 24 * 3600 * 1000;

const UPPER_LETTERS = /[A-ZÆØÅ]/g;
const NOT_KEY_CHAR = /[^a-z0-9æøå]/g;
const WHITESPACE = /[ \t\n\r ]/g;

/**
 * Adressenøkkelen: delen før første komma, små bokstaver, bare bokstaver og tall. «Storgata 1A,
 * 8006 Bodø», «storgata 1 a» og «Storgata 1a» gir alle `storgata1a`. Æ, ø og å beholdes. Tom nøkkel
 * (tom adresse, bare komma, bare tegn) gir `null`, som aldri gir treff.
 */
export function normalizeAddressKey(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  const firstPart = text.split(",", 1)[0] ?? "";
  const key = firstPart
    .replace(UPPER_LETTERS, (letter) => letter.toLowerCase())
    .replace(NOT_KEY_CHAR, "");
  return key === "" ? null : key;
}

/**
 * Gnr, bnr eller snr: mellomrom og innledende nuller tas bort («012» = «12»). Tom eller bare nuller
 * gir `null` (ikke utfylt).
 */
export function normalizeCadastreNumber(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  const value = text.replace(WHITESPACE, "").replace(/^0+/, "");
  return value === "" ? null : value;
}

/** Er de to tidspunktene høyst 90 × 24 timer fra hverandre? Grensen teller med. */
export function isWithinDuplicateWindow(a: Date, b: Date): boolean {
  return Math.abs(a.getTime() - b.getTime()) <= MAX_DUPLICATE_WINDOW_MS;
}

/** Feltene regelen sammenligner. */
export type DuplicateCandidateFields = {
  addressText: string | null;
  gnr: string | null;
  bnr: string | null;
  snr: string | null;
};

/** Normalisert matrikkel, eller `null` når gnr eller bnr ikke er utfylt. Tom `snr` = «0» = `""`. */
export function cadastreKey(
  fields: Pick<DuplicateCandidateFields, "gnr" | "bnr" | "snr">,
): { gnr: string; bnr: string; snr: string } | null {
  const gnr = normalizeCadastreNumber(fields.gnr);
  const bnr = normalizeCadastreNumber(fields.bnr);
  if (gnr === null || bnr === null) return null;
  return { gnr, bnr, snr: normalizeCadastreNumber(fields.snr) ?? "" };
}

/**
 * Hvorfor to ordre kan være dubletter, i fast rekkefølge (`address`, så `cadastre`). Tom liste når
 * verken adresse eller matrikkel er lik. Tidsvinduet og statusen sjekkes ikke her.
 */
export function duplicateReasons(
  a: DuplicateCandidateFields,
  b: DuplicateCandidateFields,
): DuplicateReason[] {
  const reasons: DuplicateReason[] = [];
  const addressA = normalizeAddressKey(a.addressText);
  if (addressA !== null && addressA === normalizeAddressKey(b.addressText)) {
    reasons.push("address");
  }
  const cadastreA = cadastreKey(a);
  const cadastreB = cadastreKey(b);
  if (
    cadastreA !== null &&
    cadastreB !== null &&
    cadastreA.gnr === cadastreB.gnr &&
    cadastreA.bnr === cadastreB.bnr &&
    cadastreA.snr === cadastreB.snr
  ) {
    reasons.push("cadastre");
  }
  return reasons;
}
