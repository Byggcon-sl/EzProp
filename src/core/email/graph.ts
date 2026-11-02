import { z } from "zod";
import type { Email, EmailSender } from "./index";

/*
 * E-post via Microsoft 365 (Microsoft Graph), som i Optiplan: sender fra én postboks med
 * klientlegitimasjon (tenant, klient-id, klienthemmelighet). Bare innebygd `fetch`.
 * Ett token-kall per sending, ingen mellomlager. Tidsavbrudd 15 sekunder per kall.
 *
 * Feilmeldingene er faste norske tekster: aldri svaret fra Microsoft, mottaker, emne, tekst eller
 * hemmelighet, og den opprinnelige feilen legges ikke ved som `cause`.
 */

const TENANT_ID_PATTERN = /^[A-Za-z0-9.-]{1,64}$/;
const TIMEOUT_MS = 15_000;
const emailSchema = z.email();

export type GraphEmailConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  from: string;
};

const MESSAGES = {
  token: "Kunne ikke hente innlogging hos Microsoft 365.",
  send: "Kunne ikke sende e-post via Microsoft 365.",
} as const;

/** Sendingen via Microsoft 365 feilet. `statusCode` er `null` ved nettfeil eller tidsavbrudd. */
export class EmailSendError extends Error {
  readonly step: "token" | "send";
  readonly statusCode: number | null;

  constructor(step: "token" | "send", statusCode: number | null) {
    super(MESSAGES[step]);
    this.name = "EmailSendError";
    this.step = step;
    this.statusCode = statusCode;
  }
}

async function call(
  step: "token" | "send",
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new EmailSendError(step, null);
  }
  if (!response.ok) throw new EmailSendError(step, response.status);
  return response;
}

/** Lager senderen. Ugyldig tenant eller avsender gir feil før noe kall. */
export function createGraphEmailSender(
  config: GraphEmailConfig,
  fetchFn: typeof fetch = fetch,
): EmailSender {
  if (!TENANT_ID_PATTERN.test(config.tenantId)) {
    throw new Error("E-post via Microsoft 365 er satt opp med ugyldig tenant.");
  }
  if (!emailSchema.safeParse(config.from).success) {
    throw new Error("E-post via Microsoft 365 er satt opp med ugyldig avsender.");
  }
  const { tenantId, clientId, clientSecret, from } = config;

  return {
    provider: "microsoft365",
    async send(email: Email) {
      const tokenResponse = await call(
        "token",
        fetchFn,
        `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "client_credentials",
            scope: "https://graph.microsoft.com/.default",
            client_id: clientId,
            client_secret: clientSecret,
          }),
        },
      );
      let accessToken: unknown;
      try {
        accessToken = ((await tokenResponse.json()) as { access_token?: unknown } | null)
          ?.access_token;
      } catch {
        accessToken = undefined;
      }
      if (typeof accessToken !== "string" || accessToken === "") {
        throw new EmailSendError("token", null);
      }

      await call(
        "send",
        fetchFn,
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: {
              subject: email.subject,
              body: { contentType: "Text", content: email.text },
              toRecipients: [{ emailAddress: { address: email.to } }],
            },
            saveToSentItems: false,
          }),
        },
      );
    },
  };
}
