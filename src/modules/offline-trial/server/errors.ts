/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Feil fra serverfunksjonene i prøven. Rutene under `/api/prove/` oversetter dem til statuskoder;
 * `AccessDeniedError` fra `@/core/access` gir 403 som ellers. Meldingene vises ikke til brukeren
 * og inneholder aldri innholdet i nyttelasten.
 */
import type { TrialTableName } from "../sync/local-columns";

/** Ugyldig endring: ukjent tabell, felt eller operasjon, fremmed skjema, eller utenfor grensene. Gir 400. */
export class InvalidTrialChangeError extends Error {
  constructor(message = "Ugyldig endring i testskjemaet.") {
    super(message);
    this.name = "InvalidTrialChangeError";
  }
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

/** Hvilken endring i bunten som ikke kunne lagres. Aldri innholdet, bare id, tabell og felt. */
export interface RejectedTrialChange {
  id: string;
  table: TrialTableName;
  /** Bare for `trial_answers` og `trial_photos`, og bare når feltet er kjent i testskjemaet. */
  field_key?: string;
}

/**
 * Én endring i bunten kunne ikke lagres (ugyldig endring eller verdi databasen ikke tar). Hele
 * bunten er rullet tilbake. Gir 400 med `endring`, så enheten kan legge akkurat den til side
 * (funn T-0001). Feilen fra databasen tas ikke med, fordi den kan inneholde verdiene. Arver
 * `InvalidTrialChangeError`, så alt som fanger den, virker som før.
 */
export class TrialChangeRejectedError extends InvalidTrialChangeError {
  constructor(
    readonly change: RejectedTrialChange,
    message = "Endringen kunne ikke lagres. Noe i den er ugyldig.",
  ) {
    super(message);
    this.name = "TrialChangeRejectedError";
  }
}

/** SQLSTATE fra feilen eller fra `cause` (Drizzle pakker inn feilen fra driveren). */
export function sqlStateOf(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current !== null && typeof current === "object"; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * Verdien kan ikke lagres: SQLSTATE-klasse 22 (dataunntak, for eksempel tall utenfor grensen
 * eller ugyldig tegn) eller 23514 (sjekkregel). Gir 400. Andre databasefeil (23505, brutt
 * forbindelse, uten SQLSTATE) er ikke endringens feil og gir 500 som før.
 */
export function isUnstorableValueError(error: unknown): boolean {
  const code = sqlStateOf(error);
  return code !== undefined && (code.startsWith("22") || code === "23514");
}
