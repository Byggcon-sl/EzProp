import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Actor } from "@/core/access";
import { auth } from "./auth";

/** Innloggingssiden. */
export const LOGIN_PATH = "/logg-inn";

/** Innlogget bruker for denne forespørselen, eller `null`. */
export const getCurrentActor = cache(async (): Promise<Actor | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const { user } = session;
  return { id: user.id, email: user.email, name: user.name };
});

/** Som `getCurrentActor`, men sender til innlogging hvis ingen er logget inn. */
export async function requireActor(): Promise<Actor> {
  const actor = await getCurrentActor();
  if (!actor) redirect(LOGIN_PATH);
  return actor;
}
