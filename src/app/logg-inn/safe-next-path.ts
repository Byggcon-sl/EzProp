/** Hvor innloggingssiden sender brukeren når `neste` mangler eller ikke er godkjent. */
export const DEFAULT_NEXT_PATH = "/arbeidskoe";

/**
 * Fast liste over hele stier som godtas som `neste`. Ingen dekoding, ingen
 * spørrestreng og ingen `#`, slik at ingen skjev sti kan sende brukeren til
 * et annet nettsted (ingen åpen videresending).
 */
const ALLOWED_NEXT_PATH =
  /^(?:\/arbeidskoe|\/prove\/testskjema(?:\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?)$/;

export function safeNextPath(value: string | string[] | undefined): string {
  if (typeof value !== "string") return DEFAULT_NEXT_PATH;
  return ALLOWED_NEXT_PATH.test(value) ? value : DEFAULT_NEXT_PATH;
}
