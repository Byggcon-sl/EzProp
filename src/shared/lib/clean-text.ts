/*
 * Tegn databasen ikke tar (docs/agenter/oppgaver/rett-t0001-synkko.md Omfang 1, A180).
 * Bare tegn databasen ikke tar. Ikke personvernvask, erstatter ikke «Vask før KI».
 *
 * PostgreSQL avviser nulltegnet (U+0000) i `text` og `jsonb`, og `jsonb` avviser ensomme
 * surrogattegn. Begge fjernes stille: de er usynlige og har ingen betydning for takstmannen.
 * Gyldige surrogatpar (emoji), linjeskift, tabulator, æøå og m² beholdes.
 */

// Nulltegn, høyt surrogat uten lavt etter, lavt surrogat uten høyt foran. Uten `u`-flagget
// ser uttrykket på enkelttegn i UTF-16, slik at ensomme surrogater kan treffes.
const UNSTORABLE_CHARS =
  /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function isPlainObject(value: object): value is Record<string, unknown> {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function stripValue(value: unknown): unknown {
  if (typeof value === "string") return value.replace(UNSTORABLE_CHARS, "");
  if (Array.isArray(value)) return value.map(stripValue);
  if (value !== null && typeof value === "object" && isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      result[key.replace(UNSTORABLE_CHARS, "")] = stripValue(inner);
    }
    return result;
  }
  return value;
}

/**
 * Fjerner nulltegn og ensomme surrogattegn i tekst, også nestet i vanlige objekter og lister og
 * i objektnøkler. Tall, `true`/`false`, `null` og `undefined` returneres som de er. Inndata
 * endres aldri (ny verdi tilbake), og to vask gir samme resultat.
 */
export function stripUnstorableChars<T>(value: T): T {
  return stripValue(value) as T;
}
