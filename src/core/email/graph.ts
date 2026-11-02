import { z } from "zod";
import { MS_TENANT_ID_PATTERN } from "@/core/integrations/settings";
import type { Email, EmailSender } from "./types";

/*
 * E-post via Microsoft 365 (Microsoft Graph), som i Optiplan: sender fra én postboks med
 * klientlegitimasjon (tenant, klient-id, klienthemmelighet). Ett token-kall per sending, ingen
 * mellomlager (volumet er noen innloggingskoder per dag). Ingen ny avhengighet: innebygd `fetch`.
 *
 * Feilene har aldri svaret fra Microsoft, mottaker, emne, tekst eller hemmeligheten, og den
 * opprinnelige feilen legges ikke ved (heller ikke som `cause`).
 */

const TIMEOUT_MS = 15_000;

export type GraphEmailConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** Postboksen det sendes fra. */
  from: string;
};

/** Sendingen feilet. `step` sier hvor, `statusCode` er `null` når det ikke kom noe svar. */
export class EmailSendError extends Error {
  readonly step: "token" | "send";
  readonly statusCode: number | null;

  constructor(step: "token" | "send", statusCode: number | null) {
    const code = statusCode === null ? "uten svar" : `statuskode ${statusCode}`;
    super(
      step === "token"
        ? `Fikk ikke tilgang til Microsoft 365 (${code}).`
        : `Microsoft 365 tok ikke imot e-posten (${code}).`,
    );
    this.name = "EmailSendError";
    this.step = step;
    this.statusCode = statusCode;
  }
}

/** Oppsettet for Microsoft 365 er ugyldig. Meldingen har aldri verdiene. */
export class GraphConfigError extends Error {
  constructor() {
    super("Oppsettet for e-post via Microsoft 365 er ugyldig.");
    this.name = "GraphConfigError";
  }
}

const configSchema = z.object({
  tenantId: z.string().regex(MS_TENANT_ID_PATTERN),
  clientId: z.string().trim().min(1),
  clientSecret: z.string().min(1),
  from: z.email(),
});

export function createGraphEmailSender(
  config: GraphEmailConfig,
  fetchFn: typeof fetch = fetch,
): EmailSender {
  if (!configSchema.safeParse(config).success) throw new GraphConfigError();
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`;
  const sendUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.from)}/sendMail`;

  async function call(step: "token" | "send", url: string, init: RequestInit) {
    try {
      return await fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      // Nettfeil eller tidsavbrudd: den opprinnelige feilen kan ha adresser og legges ikke ved
      throw new EmailSendError(step, null);
    }
  }

  async function fetchToken(): Promise<string> {
    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    });
    const response = await call("token", tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!response.ok) throw new EmailSendError("token", response.status);
    let token: unknown;
    try {
      token = ((await response.json()) as { access_token?: unknown } | null)?.access_token;
    } catch {
      token = undefined;
    }
    if (typeof token !== "string" || token === "") throw new EmailSendError("token", null);
    return token;
  }

  return {
    provider: "microsoft365",
    async send(email: Email) {
      const accessToken = await fetchToken();
      const response = await call("send", sendUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            subject: email.subject,
            body: { contentType: "Text", content: email.text },
            toRecipients: [{ emailAddress: { address: email.to } }],
          },
          saveToSentItems: false,
        }),
      });
      if (!response.ok) throw new EmailSendError("send", response.status);
    },
  };
}
