import { findActiveConnection } from "@/core/integrations/connections";
import { readSecret } from "@/core/integrations/secrets";
import { microsoft365SettingsSchema } from "@/core/integrations/settings";
import type { IntegrationConnection } from "@/db/schema";
import { getEnv, type Env } from "@/shared/config/env";
import { createDevMailboxSender } from "./dev-mailbox";
import { createGraphEmailSender } from "./graph";
import { createServerLogSender } from "./server-log";
import type { EmailProvider, EmailSender } from "./types";

/*
 * Valg av leverandør for e-post (docs/funksjoner/fase0b-tilkoblingslag.md, Omfang 6). Ny sender
 * per kall, og raden leses hver gang, slik at `disabled` og nytt `secretRef` virker straks.
 *
 * 1. `DEV_MAILBOX` på → utviklings-postkassen, uansett organisasjon og tabell.
 * 2. Med organisasjon: den aktive e-posttilkoblingen (ikke `disabled`, ikke slettet).
 * 3. Ellers systemvalget fra miljøet: Microsoft 365 når tenant, klient-id og `MAIL_FROM` er satt
 *    (hemmeligheten bare via `readSecret("MS_GRAPH_CLIENT_SECRET")`), ellers serverloggen.
 *
 * Svikter hemmeligheten eller oppsettet, gir det en sender som avviser ved sending. Da vet
 * `sendEmail` hvilken tilkobling som sviktet, og kan merke den.
 *
 * Intern: eksporteres ikke fra `index.ts`. `organizationId` er alltid `grant.organizationId`
 * eller en organisasjon laget selv kjenner, aldri en id fra adresse eller skjema.
 */

export type ResolveEmailOptions = { organizationId?: string; fetchFn?: typeof fetch };

/** Navnet på hemmeligheten for systemvalget (verdien leses bare gjennom `readSecret`). */
const SYSTEM_SECRET_REF = "MS_GRAPH_CLIENT_SECRET";

/** En sender som avviser med feilen (oppsett eller hemmelighet som sviktet før sending). */
function failingSender(provider: EmailProvider, error: unknown): EmailSender {
  return {
    provider,
    send: () => Promise.reject(error),
  };
}

async function graphSender(
  settings: { tenantId: string; clientId: string; from: string },
  secretRef: string,
  fetchFn: typeof fetch | undefined,
): Promise<EmailSender> {
  try {
    const clientSecret = await readSecret(secretRef);
    return createGraphEmailSender({ ...settings, clientSecret }, fetchFn);
  } catch (error) {
    return failingSender("microsoft365", error);
  }
}

async function connectionSender(
  row: IntegrationConnection,
  env: Env,
  fetchFn: typeof fetch | undefined,
): Promise<EmailSender> {
  switch (row.provider) {
    case "microsoft365": {
      const settings = microsoft365SettingsSchema.safeParse(row.settings);
      if (!settings.success || !row.secretRef) {
        return failingSender(
          "microsoft365",
          new Error("Innstillingene for e-post via Microsoft 365 er ugyldige."),
        );
      }
      return graphSender(settings.data, row.secretRef, fetchFn);
    }
    case "server_log":
      return createServerLogSender(env.SEED_ADMIN_EMAIL);
    case "dev_mailbox":
      // Postkassen viser koder åpent og virker bare lokalt (`DEV_MAILBOX`, som vinner i punkt 1)
      return failingSender(
        "dev_mailbox",
        new Error("Utviklings-postkassen kan bare brukes lokalt."),
      );
    default:
      // Bare mulig med en rad som er lagt inn utenom tjenesten (tjenesten avviser ukjente koder)
      return failingSender("server_log", new Error("Ukjent leverandør for e-post."));
  }
}

async function systemSender(env: Env, fetchFn: typeof fetch | undefined): Promise<EmailSender> {
  if (env.MS_GRAPH_TENANT_ID && env.MS_GRAPH_CLIENT_ID && env.MAIL_FROM) {
    return graphSender(
      { tenantId: env.MS_GRAPH_TENANT_ID, clientId: env.MS_GRAPH_CLIENT_ID, from: env.MAIL_FROM },
      SYSTEM_SECRET_REF,
      fetchFn,
    );
  }
  return createServerLogSender(env.SEED_ADMIN_EMAIL);
}

export async function resolveEmailSender(
  options: ResolveEmailOptions,
  env: Env = getEnv(),
): Promise<{ sender: EmailSender; connectionId: string | null }> {
  if (env.DEV_MAILBOX) return { sender: createDevMailboxSender(), connectionId: null };
  if (options.organizationId) {
    const row = await findActiveConnection(options.organizationId, "email");
    if (row) {
      return { sender: await connectionSender(row, env, options.fetchFn), connectionId: row.id };
    }
  }
  return { sender: await systemSender(env, options.fetchFn), connectionId: null };
}
