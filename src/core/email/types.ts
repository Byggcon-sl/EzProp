/** logLine: én linje som er trygg i serverloggen, uten personopplysninger, satt av avsenderen. */
export type Email = { to: string; subject: string; text: string; logLine?: string };

/** Leverandørene for porten `email` (faste koder, se `PROVIDERS_BY_PORT`). */
export type EmailProvider = "dev_mailbox" | "server_log" | "microsoft365";

export type EmailSender = { readonly provider: EmailProvider; send(email: Email): Promise<void> };

export type StoredEmail = Email & { id: number; sentAt: Date };
