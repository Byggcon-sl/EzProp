/*
 * Feilene fra KI-modulen (docs/funksjoner/fase2a-ki-modul-logg.md). Meldingene er faste og på
 * norsk. De inneholder aldri feltverdier, forslagstekst eller om en id finnes hos en annen.
 * Manglende rettighet gir `AccessDeniedError` fra `@/core/access`.
 */

/**
 * Nøytralt avslag: samme klasse og samme melding uansett grunn (ukjent funksjon, felt eller mål,
 * for lang verdi, ugyldig id, ukjent oppdrag, id som finnes hos en annen, slettet rad). Svaret
 * røper derfor ikke om en id finnes. Ingenting er skrevet, og leverandøren er ikke kalt.
 */
export class AiRequestRejectedError extends Error {
  constructor() {
    super("Forespørselen kan ikke behandles.");
    this.name = "AiRequestRejectedError";
  }
}

/** Statusendringen er ikke lov fra forslagets nåværende status. Ingenting er endret. */
export class AiDecisionError extends Error {
  constructor() {
    super("Endringen er ikke lov for dette forslaget.");
    this.name = "AiDecisionError";
  }
}
