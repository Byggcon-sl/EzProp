import type { Email, EmailSender, StoredEmail } from "./types";

/*
 * Utviklings-postkassen på /dev/epost (`DEV_MAILBOX=1`, bare lokalt; `env.ts` stopper den
 * ellers). Holder de 50 siste e-postene i minnet, nyeste først, og skriver dem til konsollen.
 */

const globalForMailbox = globalThis as unknown as { ezpropDevMailbox?: StoredEmail[] };
const MAX_STORED = 50;

/** Selve listen i minnet. */
export function devMailboxStore(): StoredEmail[] {
  globalForMailbox.ezpropDevMailbox ??= [];
  return globalForMailbox.ezpropDevMailbox;
}

export function createDevMailboxSender(): EmailSender {
  return {
    provider: "dev_mailbox",
    async send(email: Email) {
      const mailbox = devMailboxStore();
      mailbox.unshift({ ...email, id: Date.now() + mailbox.length, sentAt: new Date() });
      mailbox.length = Math.min(mailbox.length, MAX_STORED);
      console.info(`[e-post] Til: ${email.to} | ${email.subject}\n${email.text}`);
    },
  };
}
