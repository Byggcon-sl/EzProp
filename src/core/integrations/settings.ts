import { z } from "zod";

/*
 * Innstillingene (`settings`) per leverandør. Sjekkes når admin lager eller endrer en
 * tilkobling, og på nytt når laget bruker raden. Ukjente nøkler avvises. Aldri hemmeligheter her:
 * de ligger bak `secretRef`.
 */

/** Tenant i Microsoft 365: GUID eller domene. */
export const MS_TENANT_ID_PATTERN = /^[A-Za-z0-9.-]{1,64}$/;

/** E-post via Microsoft 365: postboksen det sendes fra, tenant og klient-id. */
export const microsoft365SettingsSchema = z
  .object({
    from: z.email(),
    tenantId: z.string().regex(MS_TENANT_ID_PATTERN),
    clientId: z.string().trim().min(1).max(128),
  })
  .strict();
export type Microsoft365Settings = z.infer<typeof microsoft365SettingsSchema>;

const emptySettingsSchema = z.object({}).strict();

/** Skjemaet for `settings` til leverandøren, eller `null` når leverandøren er ukjent. */
export function settingsSchemaFor(provider: string): z.ZodType<Record<string, unknown>> | null {
  switch (provider) {
    case "microsoft365":
      return microsoft365SettingsSchema;
    case "dev_mailbox":
    case "server_log":
      return emptySettingsSchema;
    default:
      return null;
  }
}

/** Leverandører som ikke virker uten hemmelighet. */
export function providerRequiresSecret(provider: string): boolean {
  return provider === "microsoft365";
}
