import { ZodError } from "zod";
import { AccessDeniedError } from "@/core/access";
import {
  InvalidTrialChangeError,
  TrialIdConflictError,
  TrialPhotoNotFoundError,
  TrialPhotoTooLargeError,
} from "@/modules/offline-trial/server/errors";
import { logger } from "@/shared/lib/logger";

/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Oversetter feil fra serverfunksjonene i prøven til svar med norsk feilmelding (`{ feil }`).
 * Ingen tilgangslogikk her; den ligger i `src/core/access`. Kroppen logges aldri.
 */
export function trialErrorResponse(error: unknown, route: string, userId: string): Response {
  if (error instanceof AccessDeniedError) {
    return errorJson(403, "Du har ikke tilgang til dette.");
  }
  if (error instanceof InvalidTrialChangeError || error instanceof ZodError) {
    return errorJson(400, "Endringen kunne ikke lagres. Noe i den er ugyldig.");
  }
  if (error instanceof TrialIdConflictError) {
    return errorJson(409, "Endringen kunne ikke lagres, fordi id-en allerede finnes et annet sted.");
  }
  if (error instanceof TrialPhotoNotFoundError) {
    return errorJson(404, "Fant ikke bildet.");
  }
  if (error instanceof TrialPhotoTooLargeError) {
    return errorJson(413, "Bildet er for stort.");
  }
  logger.error("Feil i prøven uten nett", { route, userId, error });
  return errorJson(500, "Noe gikk galt på serveren. Prøv igjen senere.");
}

/** 401 når ingen er logget inn. */
export function notLoggedIn(): Response {
  return errorJson(401, "Du må logge inn.");
}

function errorJson(status: number, message: string): Response {
  return Response.json({ feil: message }, { status, headers: { "Cache-Control": "no-store" } });
}
