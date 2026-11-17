import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Actor } from "@/core/access";
import { isSafeNextPath } from "@/shared/navigation/safe-next-path";
import { auth } from "./auth";
import { REQUEST_PATH_HEADER } from "./request-path";

export { REQUEST_PATH_HEADER };

/** Innloggingssiden. */
export const LOGIN_PATH = "/logg-inn";

/** Innlogget bruker for denne forespørselen, eller `null`. */
export const getCurrentActor = cache(async (): Promise<Actor | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const { user } = session;
  return { id: user.id, email: user.email, name: user.name };
});

/**
 * Innloggingssiden med `neste` = siden som ble bedt om, når stien er trygg (`isSafeNextPath`).
 * Mangler hodet eller avvises stien, gis innloggingssiden uten `neste`.
 */
async function loginRedirectPath(): Promise<string> {
  const path = (await headers()).get(REQUEST_PATH_HEADER);
  return isSafeNextPath(path) ? `${LOGIN_PATH}?neste=${encodeURIComponent(path)}` : LOGIN_PATH;
}

/**
 * Som `getCurrentActor`, men sender til innlogging hvis ingen er logget inn. Etter innlogging
 * kommer brukeren tilbake til samme side.
 */
export async function requireActor(): Promise<Actor> {
  const actor = await getCurrentActor();
  if (!actor) redirect(await loginRedirectPath());
  return actor;
}

/**
 * For serverhandlinger: innlogget bruker eller `null`, og aldri videresending. Handlingen svarer
 * da med «logget ut»-svaret, slik at skjemaet beholder det som er skrevet.
 */
export async function getActorForAction(): Promise<Actor | null> {
  return getCurrentActor();
}
