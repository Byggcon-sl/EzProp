/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Feil fra serverfunksjonene i prøven. Rutene under `/api/prove/` oversetter dem til statuskoder;
 * `AccessDeniedError` fra `@/core/access` gir 403 som ellers. Meldingene vises ikke til brukeren
 * og inneholder aldri innholdet i nyttelasten.
 */

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

/** Hvilken endring i bunten serveren ikke kunne lagre. Bare nøkler, aldri innholdet. */
export type RejectedTrialChange = {
  id: string;
  table: string;
  /** Feltet for svar og bilder når det er kjent, ellers `null`. */
  field_key: string | null;
};

/**
 * Én operasjon i bunten kunne ikke lagres: ugyldig innhold, eller en verdi databasen ikke tar
 * (SQLSTATE-klasse 22 eller 23514). Hele bunten er rullet tilbake. Gir 400 med `endring`, så
 * enheten kan legge akkurat denne endringen til side og sende resten. Arver
 * `InvalidTrialChangeError`, så alt som behandler ugyldig endring, virker som før.
 */
export class TrialChangeRejectedError extends InvalidTrialChangeError {
  constructor(readonly change: RejectedTrialChange) {
    super("Endringen kunne ikke lagres.");
    this.name = "TrialChangeRejectedError";
  }
}

function sqlState(error: unknown): string | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Feil i selve verdien fra PostgreSQL: SQLSTATE-klasse 22 (for stort tall, ugyldig tegn, ugyldig
 * JSON osv.) eller 23514 (sjekkregel). Leser `code` og `cause.code`, fordi Drizzle pakker inn
 * feilen fra databasedriveren. Alt annet (23505, brutt forbindelse, feil uten kode) gir `false`.
 */
export function isUnstorableValueError(error: unknown): boolean {
  const codes = [sqlState(error)];
  if (error !== null && typeof error === "object") {
    codes.push(sqlState((error as { cause?: unknown }).cause));
  }
  return codes.some(
    (code) =>
      code !== undefined &&
      /^[0-9A-Z]{5}$/.test(code) &&
      (code.startsWith("22") || code === "23514"),
  );
}

/** Markøren i `GET /api/prove/synk/hent` kan ikke leses (form, base64, JSON, tid, uuid, lengde). Gir 400. */
export class InvalidTrialCursorError extends Error {
  constructor(message = "Ugyldig markør.") {
    super(message);
    this.name = "InvalidTrialCursorError";
  }
}
