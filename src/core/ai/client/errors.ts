import type { AiQueueUnavailableErrorShape } from "./types";

/** Fast melding. Feilen bærer aldri meldingen eller verdiene fra den opprinnelige feilen. */
const UNAVAILABLE_MESSAGE = "Lageret for KI-køen er ikke tilgjengelig.";

/** Navn som ser ut som et feilnavn. Alt annet blir `UnknownError`, så ingen tekst slipper ut. */
const SAFE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** Lageret mangler eller feilet. Bare navnet på den opprinnelige feilen tas vare på. */
export class AiQueueUnavailableError extends Error implements AiQueueUnavailableErrorShape {
  override readonly name = "AiQueueUnavailableError" as const;
  readonly causeName: string;

  constructor(causeName: string) {
    super(UNAVAILABLE_MESSAGE);
    this.causeName = SAFE_NAME.test(causeName) ? causeName : "UnknownError";
  }
}

/** Leser bare `name` fra feilen, aldri meldingen. */
export function errorNameOf(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    try {
      const name = (error as { name?: unknown }).name;
      if (typeof name === "string") return name;
    } catch {
      // En getter som kaster gir ukjent navn.
    }
  }
  return "UnknownError";
}

/** Gjør en vilkårlig feil om til `AiQueueUnavailableError` uten å ta med meldingen. */
export function toAiQueueUnavailableError(error: unknown): AiQueueUnavailableError {
  if (error instanceof AiQueueUnavailableError) return error;
  return new AiQueueUnavailableError(errorNameOf(error));
}
