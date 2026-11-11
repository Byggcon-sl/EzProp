/*
 * Fjerner tegn som PostgreSQL ikke tar imot i `text` og `jsonb`: nulltegn (U+0000) og ensomme
 * surrogattegn (høy uten lav etter, lav uten høy foran). Brukes på innkommende tekst i synken og
 * i KI-modulen (funn T-0001). Gyldige surrogatpar (emoji), linjeskift, tabulator, æøå og m²
 * beholdes.
 *
 * Bare tegn databasen ikke tar. Ikke personvernvask, erstatter ikke «Vask før KI».
 *
 * Støtter hovedmål: de ansatte (én innlimt tekst stopper ikke resten av synken) og KI i bunnen
 * (tekst med nulltegn gir forslag og rad i `ai_usage_log`).
 */

// Nulltegn, høy surrogat uten lav etter, eller lav surrogat uten høy foran.
const UNSTORABLE = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Tekst uten tegn databasen ikke tar. Tekst uten slike tegn returneres som den er. */
export function stripUnstorableText(text: string): string {
  return text.replace(UNSTORABLE, "");
}

/**
 * Vasker tekst i strenger, vanlige objekter (både nøkler og verdier) og lister, i alle nivåer.
 * Tall, `true`/`false`, `null` og `undefined` returneres urørt. Inndata endres aldri; det som
 * vaskes, kommer tilbake som ny verdi. To vask gir samme resultat.
 */
export function stripUnstorableChars<T>(value: T): T {
  return strip(value) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function strip(value: unknown): unknown {
  if (typeof value === "string") return stripUnstorableText(value);
  if (Array.isArray(value)) return value.map(strip);
  if (isPlainObject(value)) {
    // `fromEntries` lager vanlige egenskaper, også for nøkkelen «__proto__».
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [stripUnstorableText(key), strip(entry)]),
    );
  }
  return value;
}
