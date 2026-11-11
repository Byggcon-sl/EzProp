/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Feil fra serverfunksjonene i prøven. Rutene under `/api/prove/` oversetter dem til statuskoder;
 * `AccessDeniedError` fra `@/core/access` gir 403 som ellers. Meldingene vises ikke til brukeren
 * og inneholder aldri innholdet i nyttelasten.
 */

/**
 * Pekeren til endringen i bunten som feilet: tabell, id og feltkode (`null` for `trial_forms`, og
 * når feltkoden ikke er kjent). Aldri verdien. Klienten bruker den til å legge endringen til side.
 */
export type TrialChangeRef = { id: string; table: string; field_key: string | null };

/**
 * Ugyldig endring: ukjent tabell, felt eller operasjon, fremmed skjema, eller utenfor grensene. Gir
 * 400. `change` peker på operasjonen når feilen kan knyttes til én.
 */
export class InvalidTrialChangeError extends Error {
  constructor(
    message = "Ugyldig endring i testskjemaet.",
    readonly change?: TrialChangeRef,
  ) {
    super(message);
    this.name = "InvalidTrialChangeError";
  }
}

/**
 * Databasen tok ikke imot en verdi i én operasjon (SQLSTATE-klasse 22 eller 23514). Gir 400 med
 * pekeren. Meldingen har bare SQLSTATE, aldri verdien eller teksten fra databasen.
 */
export class TrialChangeValueError extends Error {
  constructor(
    readonly sqlState: string,
    readonly change: TrialChangeRef,
  ) {
    super(`Databasen tok ikke imot en verdi (SQLSTATE ${sqlState}).`);
    this.name = "TrialChangeValueError";
  }
}

/** SQLSTATE fra en databasefeil: `code` på feilen eller på `cause` (Drizzle pakker feilen inn). */
export function sqlStateOf(error: unknown): string | undefined {
  for (let current = error, depth = 0; current && depth < 3; depth++) {
    if (typeof current !== "object") return undefined;
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Feil i selve verdien (klasse 22 «data exception» og 23514 «check_violation»): 400, ikke 500. */
export function isValueSqlState(code: string | undefined): boolean {
  return code !== undefined && (code.startsWith("22") || code === "23514");
}

/** Innkommende `id` finnes allerede i en annen organisasjon. Ingenting skrives. Gir 409. */
export class TrialIdConflictError extends Error {
  constructor(message = "Id-en finnes allerede et annet sted.") {
    super(message);
    this.name = "TrialIdConflictError";
  }
}

/** Bilde-id med feil format, eller bilde i en annen organisasjon. Gir 404 uten at noe skrives. */
export class TrialPhotoNotFoundError extends Error {
  constructor(message = "Fant ikke bildet.") {
    super(message);
    this.name = "TrialPhotoNotFoundError";
  }
}

/** Bildefilen er større enn `TRIAL_PHOTO_MAX_BYTES`. Gir 413. */
export class TrialPhotoTooLargeError extends Error {
  constructor(message = "Bildet er for stort.") {
    super(message);
    this.name = "TrialPhotoTooLargeError";
  }
}

/** Markøren i `GET /api/prove/synk/hent` kan ikke leses (form, base64, JSON, tid, uuid, lengde). Gir 400. */
export class InvalidTrialCursorError extends Error {
  constructor(message = "Ugyldig markør.") {
    super(message);
    this.name = "InvalidTrialCursorError";
  }
}
