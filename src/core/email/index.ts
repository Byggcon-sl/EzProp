import { getEnv, type Env } from "@/shared/config/env";
import { createServerLogSender } from "./server-log";

/** logLine: én linje som er trygg i serverloggen, uten personopplysninger, satt av avsenderen. */
export type Email = { to: string; subject: string; text: string; logLine?: string };
export type EmailSender = (email: Email) => Promise<void>;
export type StoredEmail = Email & { id: number; sentAt: Date };

const globalForMailbox = globalThis as unknown as { ezpropDevMailbox?: StoredEmail[] };
const MAX_STORED = 50;

function devMailbox(): StoredEmail[] {
  globalForMailbox.ezpropDevMailbox ??= [];
  return globalForMailbox.ezpropDevMailbox;
}

/**
 * Hvordan e-post sendes:
 * - `devMailbox`: utviklings-postkassen på /dev/epost (`DEV_MAILBOX=1`, bare lokalt)
 * - `graph`: Microsoft Graph fra Byggcons postboks, som i Optiplan. Kobles til i fase 0b.
 * - `serverLog`: e-post er ikke satt opp ennå. Engangskoden til første admin (SEED_ADMIN_EMAIL)
 *   skrives i serverloggen til e-post er satt opp. Alle andre mottakere gir feil.
 */
export type EmailTransport = "devMailbox" | "graph" | "serverLog";

export function emailTransport(env: Env = getEnv()): EmailTransport {
  if (env.DEV_MAILBOX) return "devMailbox";
  if (
    env.MS_GRAPH_TENANT_ID &&
    env.MS_GRAPH_CLIENT_ID &&
    env.MS_GRAPH_CLIENT_SECRET &&
    env.MAIL_FROM
  ) {
    return "graph";
  }
  return "serverLog";
}

/** Sender e-post med tjenesten som er satt opp (se `emailTransport`). */
export async function sendEmail(email: Email, env: Env = getEnv()): Promise<void> {
  switch (emailTransport(env)) {
    case "devMailbox": {
      const mailbox = devMailbox();
      mailbox.unshift({ ...email, id: Date.now() + mailbox.length, sentAt: new Date() });
      mailbox.length = Math.min(mailbox.length, MAX_STORED);
      console.info(`[e-post] Til: ${email.to} | ${email.subject}\n${email.text}`);
      return;
    }
    case "graph":
      // Fase 0b: samme Graph-sender som Optiplan (src/core/email/graph.ts der)
      throw new Error("E-post via Microsoft 365 er ikke koblet til ennå (fase 0b).");
    case "serverLog":
      return createServerLogSender(env.SEED_ADMIN_EMAIL)(email);
  }
}

/** Siste e-poster i utviklings-postkassen. Tom liste når den er slått av. */
export function readDevMailbox(): StoredEmail[] {
  if (!getEnv().DEV_MAILBOX) return [];
  return [...devMailbox()];
}
