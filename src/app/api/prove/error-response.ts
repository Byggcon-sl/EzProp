import { ZodError } from "zod";
import { AccessDeniedError } from "@/core/access";
import {
  InvalidTrialChangeError,
  isUnstorableValueError,
  sqlStateOf,
  TrialChangeRejectedError,
  TrialIdConflictError,
  TrialPhotoNotFoundError,
  TrialPhotoTooLargeError,
} from "@/modules/offline-trial/server/errors";
import { logger } from "@/shared/lib/logger";

const INVALID_CHANGE = "Endringen kunne ikke lagres. Noe i den er ugyldig.";

/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Oversetter feil fra serverfunksjonene i prøven til svar med norsk feilmelding (`{ feil }`).
 * Ingen tilgangslogikk her; den ligger i `src/core/access`. Kroppen logges aldri.
 * En endring som ikke kan lagres, gir 400 med `endring: { id, table, field_key }`, så enheten kan
 * legge den til side og sende resten (funn T-0001). Verdier databasen ikke tar (SQLSTATE-klasse 22
 * og 23514) gir 400, andre databasefeil 500.
 */
export function trialErrorResponse(error: unknown, route: string, userId: string): Response {
  if (error instanceof AccessDeniedError) {
    return errorJson(403, "Du har ikke tilgang til dette.");
  }
  if (error instanceof TrialChangeRejectedError) {
    // Bare id, tabell og felt, aldri innholdet (funn T-0001)
    const { id, table, field_key } = error.change;
    logger.warn("Endring avvist, svarte 400", { route, userId, table, fieldKey: field_key });
    return errorJson(400, INVALID_CHANGE, {
      endring: field_key === undefined ? { id, table } : { id, table, field_key },
    });
  }
  if (isUnstorableValueError(error)) {
    // Bare SQLSTATE, aldri feilobjektet (det kan bære verdiene). Gir spor i driften om en feil i
    // vår egen kode skulle gi klasse 22.
    logger.warn("Verdi databasen ikke tar, svarte 400", {
      route,
      userId,
      sqlState: sqlStateOf(error),
    });
    return errorJson(400, INVALID_CHANGE);
  }
  if (error instanceof InvalidTrialChangeError || error instanceof ZodError) {
    return errorJson(400, INVALID_CHANGE);
  }
  if (error instanceof TrialIdConflictError) {
    return errorJson(
      409,
      "Endringen kunne ikke lagres, fordi id-en allerede finnes et annet sted.",
    );
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

function errorJson(status: number, message: string, extra: Record<string, unknown> = {}): Response {
  // `private, no-store` på alle feilsvar, også fra shape-proxyen (aldri mellomlagret).
  return Response.json(
    { feil: message, ...extra },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}
