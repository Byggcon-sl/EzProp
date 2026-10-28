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
