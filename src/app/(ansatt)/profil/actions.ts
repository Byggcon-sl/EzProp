"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { revokeOtherOwnSessions, revokeOwnSession } from "@/core/auth/sessions-list";
import { getActorForAction } from "@/core/auth/session";
import { SIGNED_OUT_MESSAGE } from "@/shared/forms/messages";
import { logger } from "@/shared/lib/logger";

/*
 * Serverhandlinger for «Mine innlogginger» på /profil (docs/funksjoner/fase2a-mine-innlogginger.md
 * Omfang 5). Bare POST (serverhandlinger), aldri via lenke. Kjernen avgjør hvilke økter som er
 * egne; den nåværende økten kommer fra innloggingen på serveren, aldri fra skjemaet.
 * Støtter hovedmål: de ansatte (en ukjent enhet stenges med ett trykk).
 */

/** Svaret til listen. `status` styrer om meldingen er kvittering (`done`) eller feil (`failed`). */
export type SessionActionState = {
  status: "idle" | "done" | "failed";
  message: string | null;
  /** Økes ved hvert svar, slik at fokus flyttes til meldingen hver gang. */
  attempt: number;
  /** Satt når innloggingen er utløpt («logget ut»-svaret). */
  signedOut?: true;
};

const ROUTE = "/profil";
const UNKNOWN = "Noe gikk galt. Ingen enhet er logget ut. Prøv igjen.";
const ALREADY_SIGNED_OUT = "Enheten er allerede logget ut.";
const USE_LOG_OUT_HERE = "Bruk «Logg ut her» for å logge ut denne enheten.";

function answer(
  previous: SessionActionState | undefined,
  status: SessionActionState["status"],
  message: string,
): SessionActionState {
  return { status, message, attempt: (previous?.attempt ?? 0) + 1 };
}

function signedOut(previous: SessionActionState | undefined): SessionActionState {
  return { ...answer(previous, "failed", SIGNED_OUT_MESSAGE), signedOut: true };
}

/** «1 enhet er logget ut.», «2 enheter er logget ut.», og ved 0 «Ingen enheter var logget inn.» */
function countMessage(count: number): string {
  if (count === 0) return "Ingen enheter var logget inn.";
  return count === 1 ? "1 enhet er logget ut." : `${count} enheter er logget ut.`;
}

/** Ukjent feil logges bare med feilnavn og rute, aldri bruker-id, økt-id eller user-agent. */
function unknownError(previous: SessionActionState | undefined, error: unknown) {
  logger.error("Utlogging av enhet feilet", {
    route: ROUTE,
    errorName: error instanceof Error ? error.name : "ukjent feil",
  });
  return answer(previous, "failed", UNKNOWN);
}

/** «Logg ut» på en annen enhet. Økt-id-en fra skjemaet går uendret til kjernen, som validerer. */
export async function revokeOwnSessionAction(
  previous: SessionActionState | undefined,
  formData: FormData,
): Promise<SessionActionState> {
  const actor = await getActorForAction();
  if (!actor) return signedOut(previous);
  const sessionId = formData.get("sessionId");

  try {
    const result = await revokeOwnSession(actor, typeof sessionId === "string" ? sessionId : "");
    if (!result.ok) {
      return answer(
        previous,
        "failed",
        result.reason === "current_session" ? USE_LOG_OUT_HERE : ALREADY_SIGNED_OUT,
      );
    }
  } catch (error) {
    // En id som ikke er gyldig tekst, kan ikke være en egen økt: samme svar som «finnes ikke».
    if (error instanceof ZodError) return answer(previous, "failed", ALREADY_SIGNED_OUT);
    return unknownError(previous, error);
  } finally {
    revalidatePath(ROUTE);
  }
  return answer(previous, "done", "Enheten er logget ut.");
}

/** «Logg ut av alle andre enheter». Denne enheten står. */
export async function revokeOtherOwnSessionsAction(
  previous?: SessionActionState,
): Promise<SessionActionState> {
  const actor = await getActorForAction();
  if (!actor) return signedOut(previous);

  let count: number;
  try {
    ({ count } = await revokeOtherOwnSessions(actor));
  } catch (error) {
    return unknownError(previous, error);
  } finally {
    revalidatePath(ROUTE);
  }
  return answer(previous, "done", countMessage(count));
}
