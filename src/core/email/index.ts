import { recordConnectionResult } from "@/core/integrations/connections";
import { getEnv, type Env } from "@/shared/config/env";
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

/**
 * Sender e-post med leverandøren `resolveEmailSender` velger. Gikk sendingen gjennom en
 * tilkobling i tabellen, skriver `recordConnectionResult` resultatet på raden (systemets egne
 * skrivinger, ingen rad i revisjonsloggen). Den kaster aldri, så en statusskriving som svikter
 * stopper ikke sendingen (e-posten er alt sendt) og skjuler aldri sendefeilen, som kastes videre.
 * `organizationId` er alltid `grant.organizationId`, aldri en id fra adressen eller skjemaet.
 */
export async function sendEmail(
  email: Email,
  options: { organizationId?: string; fetchFn?: typeof fetch } = {},
  env: Env = getEnv(),
): Promise<void> {
  const { sender, connectionId } = await resolveEmailSender(options, env);
  // `resolveEmailSender` gir `connectionId` bare når `organizationId` er satt; sjekken er typevakt.
  const organizationId = options.organizationId;
  if (!connectionId || !organizationId) {
    await sender.send(email);
    return;
  }

  try {
    await sender.send(email);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordConnectionResult(organizationId, connectionId, { ok: false, error: message });
    throw error;
  }
  await recordConnectionResult(organizationId, connectionId, { ok: true });
}

/** Siste e-poster i utviklings-postkassen. Tom liste når den er slått av. */
export function readDevMailbox(): StoredEmail[] {
  if (!getEnv().DEV_MAILBOX) return [];
  return readStoredEmails();
}
