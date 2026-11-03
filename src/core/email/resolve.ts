import { findActiveConnection, settingsSchemaFor } from "@/core/integrations/connections";
import { ConnectionValidationError } from "@/core/integrations/errors";
import { readSecret } from "@/core/integrations/secrets";
import { getEnv, type Env } from "@/shared/config/env";
import { createDevMailboxSender } from "./dev-mailbox";
import { createGraphEmailSender } from "./graph";
import type { EmailProvider, EmailSender } from "./index";
import { createServerLogSender } from "./server-log";

/*
 * Velger leverandør for e-postporten. Ny sender per kall, raden leses hver gang:
 * 1. `DEV_MAILBOX` på: utviklings-postkassen, uansett organisasjon og tabell.
 * 2. Med organisasjon: den aktive tilkoblingen for porten `email` i tabellen (`connectionId` satt).
 *    Ugyldige `settings` eller en hemmelighet som ikke kan leses, gir en sender som avviser med
 *    feilen, slik at `sendEmail` kan markere tilkoblingen med `error`.
 * 3. Systemvalget fra miljøet: Microsoft 365 når tenant, klient-id og avsender er satt
 *    (klienthemmeligheten leses bare med `readSecret`), ellers serverloggen for første admin.
 *
 * Eksporteres ikke fra `index.ts`. `organizationId` er alltid `grant.organizationId` eller en
 * organisasjon laget selv kjenner, aldri en id fra adressen eller skjemaet.
 */

const SYSTEM_SECRET_REF = "MS_GRAPH_CLIENT_SECRET";

export type ResolvedEmailSender = { sender: EmailSender; connectionId: string | null };

function rejectingSender(provider: string, error: unknown): EmailSender {
  return {
    provider: provider as EmailProvider,
    send: () => Promise.reject(error),
  };
}

export async function resolveEmailSender(
  options: { organizationId?: string; fetchFn?: typeof fetch },
  env: Env = getEnv(),
): Promise<ResolvedEmailSender> {
  const fetchFn = options.fetchFn ?? fetch;

  if (env.DEV_MAILBOX) return { sender: createDevMailboxSender(), connectionId: null };

  if (options.organizationId) {
    const row = await findActiveConnection(options.organizationId, "email");
    if (row) {
      return { sender: senderForConnection(row, fetchFn, env), connectionId: row.id };
    }
  }

  if (env.MS_GRAPH_TENANT_ID && env.MS_GRAPH_CLIENT_ID && env.MAIL_FROM) {
    const tenantId = env.MS_GRAPH_TENANT_ID;
    const clientId = env.MS_GRAPH_CLIENT_ID;
    const from = env.MAIL_FROM;
    return {
      sender: {
        provider: "microsoft365",
        // Hemmeligheten leses først ved sending, så en manglende verdi gir avvist sending.
        async send(email) {
          const clientSecret = readSecret(SYSTEM_SECRET_REF);
          await createGraphEmailSender({ tenantId, clientId, clientSecret, from }, fetchFn).send(
            email,
          );
        },
      },
      connectionId: null,
    };
  }

  return { sender: createServerLogSender(env.SEED_ADMIN_EMAIL), connectionId: null };
}

function senderForConnection(
  row: { provider: string; secretRef: string | null; settings: Record<string, unknown> },
  fetchFn: typeof fetch,
  env: Env,
): EmailSender {
  try {
    const parsed = settingsSchemaFor(row.provider)?.safeParse(row.settings);
    if (!parsed?.success) throw new ConnectionValidationError();

    switch (row.provider) {
      case "microsoft365": {
        // Skjemaet for `microsoft365` har gitt disse tre feltene.
        const settings = parsed.data as { from: string; tenantId: string; clientId: string };
        if (!row.secretRef) throw new ConnectionValidationError();
        const clientSecret = readSecret(row.secretRef);
        return createGraphEmailSender(
          {
            tenantId: settings.tenantId,
            clientId: settings.clientId,
            clientSecret,
            from: settings.from,
          },
          fetchFn,
        );
      }
      case "server_log":
        return createServerLogSender(env.SEED_ADMIN_EMAIL);
      case "dev_mailbox":
        return createDevMailboxSender();
      default:
        throw new ConnectionValidationError();
    }
  } catch (error) {
    return rejectingSender(row.provider, error);
  }
}
