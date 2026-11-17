/** Hvor innloggingssiden sender brukeren når `neste` mangler eller ikke er godkjent. */
export const DEFAULT_NEXT_PATH = "/arbeidskoe";

const MAX_LENGTH = 200;
const PATH_PATTERN = /^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;
const BLOCKED_FIRST_SEGMENTS = new Set(["logg-inn", "api", "_next", "dev"]);

/**
 * Tillatt-liste for `neste`: små bokstaver, tall og bindestrek i hvert ledd, høyst 200 tegn, og
 * aldri innloggingen selv, API-ruter eller interne ruter. Ingen dekoding, så `%`, `\`, `//`,
 * `?`, `#`, punktum og kontrolltegn faller bort av seg selv (ingen åpen videresending).
 */
export function isSafeNextPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_LENGTH) return false;
  if (!PATH_PATTERN.test(value)) return false;
  const first = value.split("/")[1] ?? "";
  return !BLOCKED_FIRST_SEGMENTS.has(first);
}

export function safeNextPath(value: unknown): string {
  return isSafeNextPath(value) ? value : DEFAULT_NEXT_PATH;
}
