import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { integrationConnections } from "@/db/schema";
import { getEnv, type Env } from "@/shared/config/env";
import { scrubText } from "@/shared/lib/logger";
import { readStoredEmails } from "./dev-mailbox";
import { resolveEmailSender } from "./resolve";

/*
 * E-postporten i tilkoblingslaget (docs/funksjoner/fase0b-tilkoblingslag.md). Tre leverandører
 * bak samme grensesnitt:
 * - `dev_mailbox`: utviklings-postkassen på /dev/epost (`DEV_MAILBOX=1`, bare lokalt)
 * - `server_log`: engangskoden til første admin skrives i serverloggen; andre mottakere gir feil
 * - `microsoft365`: Microsoft Graph fra én postboks, som i Optiplan
 * Valget gjøres i `resolve.ts`.
 */

/** logLine: én linje som er trygg i serverloggen, uten personopplysninger, satt av avsenderen. */
export type Email = { to: string; subject: string; text: string; logLine?: string };
export type EmailProvider = "dev_mailbox" | "server_log" | "microsoft365";
export type EmailSender = { readonly provider: EmailProvider; send(email: Email): Promise<void> };
export type StoredEmail = Email & { id: number; sentAt: Date };

export { createGraphEmailSender, EmailSendError } from "./graph";

const MAX_LAST_ERROR = 500;

/**
 * Sender e-post med leverandøren `resolveEmailSender` velger. Gikk sendingen gjennom en
 * tilkobling i tabellen, oppdateres `last_ok_at`/`last_error`/`status` på raden (systemets egne
 * skrivinger, ingen rad i revisjonsloggen), og en feil kastes videre etterpå.
 * `organizationId` er alltid `grant.organizationId`, aldri en id fra adressen eller skjemaet.
 */
export async function sendEmail(
  email: Email,
  options: { organizationId?: string; fetchFn?: typeof fetch } = {},
  env: Env = getEnv(),
): Promise<void> {
  const { sender, connectionId } = await resolveEmailSender(options, env);
  if (!connectionId || !options.organizationId) {
    await sender.send(email);
    return;
  }

  const where = and(
    eq(integrationConnections.id, connectionId),
    eq(integrationConnections.organizationId, options.organizationId),
  );
  try {
    await sender.send(email);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(integrationConnections)
      .set({ lastError: scrubText(message).slice(0, MAX_LAST_ERROR), status: "error" })
      .where(where);
    throw error;
  }
  await db
    .update(integrationConnections)
    .set({ lastOkAt: new Date(), lastError: null, status: "active" })
    .where(where);
}

/** Siste e-poster i utviklings-postkassen. Tom liste når den er slått av. */
export function readDevMailbox(): StoredEmail[] {
  if (!getEnv().DEV_MAILBOX) return [];
  return readStoredEmails();
}
