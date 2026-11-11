// Bare tegn databasen ikke tar. Ikke personvernvask, erstatter ikke «Vask før KI».

/*
 * Fjerner tegn PostgreSQL ikke tar imot (funn T-0001, A180): nulltegnet U+0000, som `text` og
 * `jsonb` avviser, og ensomme surrogattegn (høy uten lav etter, lav uten høy før), som `jsonb`
 * avviser. Gyldige surrogatpar (emoji), linjeskift, tabulator, æøå og m² beholdes.
 */

const UNSTORABLE_CHARS =
  /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function cleanString(value: string): string {
  return value.replace(UNSTORABLE_CHARS, "");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * Gir en ny verdi uten tegn databasen ikke tar. Går gjennom vanlige objekter og lister, og vasker
 * også nøklene i objekter. Tall, `true`/`false`, `null` og `undefined` returneres urørt. Inndata
 * endres aldri. To vask gir samme resultat.
 */
export function stripUnstorableChars<T>(value: T): T {
  if (typeof value === "string") return cleanString(value) as T;
  if (Array.isArray(value)) return value.map((item: unknown) => stripUnstorableChars(item)) as T;
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      // defineProperty, så nøkkelen «__proto__» blir en vanlig nøkkel og ikke bytter prototype
      Object.defineProperty(result, cleanString(key), {
        value: stripUnstorableChars(item),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return result as T;
  }
  return value;
}
