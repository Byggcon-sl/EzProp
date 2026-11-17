/** Hvor innloggingssiden sender brukeren når `neste` mangler eller ikke er godkjent. */
export const DEFAULT_NEXT_PATH = "/arbeidskoe";

/** Lengste sti som godtas som `neste`. */
const MAX_LENGTH = 200;

/**
 * Tillatt-liste: én eller flere ledd med små bokstaver, tall og bindestrek, skilt med én
 * skråstrek. Ingen dekoding, så `%`, `\`, `:`, `@`, `.`, `?`, `#`, mellomrom, kontrolltegn og store
 * bokstaver faller bort av seg selv. Da kan `neste` aldri sende brukeren til et annet nettsted
 * (ingen åpen videresending) eller bære søketekst eller navn.
 */
const ALLOWED_PATH = /^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;

/** Første ledd som aldri godtas: ingen løkke tilbake til innloggingen, aldri til interne ruter. */
const BLOCKED_FIRST_SEGMENTS: ReadonlySet<string> = new Set(["logg-inn", "api", "_next", "dev"]);

/** Sann når verdien er en trygg intern side å sende brukeren til etter innlogging. */
export function isSafeNextPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_LENGTH) return false;
  if (!ALLOWED_PATH.test(value)) return false;
  const firstSegment = value.slice(1).split("/", 1)[0] ?? "";
  return !BLOCKED_FIRST_SEGMENTS.has(firstSegment);
}

/** Verdien når den er trygg, ellers `DEFAULT_NEXT_PATH`. Kaster aldri. */
export function safeNextPath(value: unknown): string {
  return isSafeNextPath(value) ? value : DEFAULT_NEXT_PATH;
}
