import type { AiQueueRejectReason } from "./types";

/*
 * Faste norske meldinger for KI-køen. Ingen av dem tar inn tekst fra posten eller fra en feil,
 * så teksten den ansatte skrev aldri havner i en melding.
 */

/** Meldingen siden viser når `enqueue` gir avslag. */
export const AI_QUEUE_REJECT_MESSAGES: Readonly<Record<AiQueueRejectReason, string>> = {
  full: "Køen er full. Vent til du har nett, og prøv igjen.",
  too_long: "Teksten er for lang til KI-hjelp.",
  invalid: "Kan ikke legge dette i kø.",
  unavailable: "Kan ikke lagre på denne enheten. Prøv igjen når du har nett.",
};

/** Meldingen når en post er fjernet etter `AI_QUEUE_MAX_ATTEMPTS` forsøk (`gave_up`). */
export const AI_QUEUE_GAVE_UP_MESSAGE = "Noe gikk galt. Teksten din er uendret. Prøv igjen.";
