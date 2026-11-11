import { ZodError } from "zod";
import { AccessDeniedError } from "@/core/access";
import {
  InvalidTrialChangeError,
  isValueSqlState,
  sqlStateOf,
  TrialChangeValueError,
  TrialIdConflictError,
  TrialPhotoNotFoundError,
  TrialPhotoTooLargeError,
  type TrialChangeRef,
} from "@/modules/offline-trial/server/errors";
import { logger } from "@/shared/lib/logger";

/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Oversetter feil fra serverfunksjonene i prøven til svar med norsk feilmelding (`{ feil }`).
 * Ingen tilgangslogikk her; den ligger i `src/core/access`. Kroppen logges aldri.
 *
 * 400 betyr «denne endringen kan aldri lagres» (funn T-0001, A181), og kroppen er
 * `{ feil, endring?: { id, table, field_key } }`. Klienten legger da endringen til side. Feil i
 * verdien fra databasen (SQLSTATE-klasse 22 og 23514) gir 400; andre databasefeil gir 500, så
 * klienten prøver igjen.
 */
export function trialErrorResponse(error: unknown, route: string, userId: string): Response {
  if (error instanceof AccessDeniedError) {
    return errorJson(403, "Du har ikke tilgang til dette.");
  }
  if (error instanceof InvalidTrialChangeError || error instanceof ZodError) {
    const change = error instanceof InvalidTrialChangeError ? error.change : undefined;
    return errorJson(400, "Endringen kunne ikke lagres. Noe i den er ugyldig.", change);
  }
  const sqlState = error instanceof TrialChangeValueError ? error.sqlState : sqlStateOf(error);
  if (isValueSqlState(sqlState)) {
    const change = error instanceof TrialChangeValueError ? error.change : undefined;
    // Bare koden, aldri meldingen fra databasen (den kan ha verdier fra bunten)
    logger.warn("Endring avvist av databasen", { route, userId, sqlState });
    return errorJson(400, "Endringen kunne ikke lagres. En verdi i den kan ikke lagres.", change);
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

function errorJson(status: number, message: string, change?: TrialChangeRef): Response {
  // `private, no-store` på alle feilsvar, også fra shape-proxyen (aldri mellomlagret).
  const body = change
    ? {
        feil: message,
        endring: { id: change.id, table: change.table, field_key: change.field_key },
      }
    : { feil: message };
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}
