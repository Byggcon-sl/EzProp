/**
 * Falsk `fetch` for e-posttestene (testplan for tilkoblingslaget, avsnitt 6–8). Registrerer hvert
 * kall og svarer etter en plan per adresse. Ingen test skal gjøre nettkall: Microsoft Graph prøves
 * bare mot denne. Alle verdier er oppdiktet.
 */

const TOKEN_URL_PREFIX = "https://login.microsoftonline.com/";
const SEND_URL_PREFIX = "https://graph.microsoft.com/v1.0/users/";

/**
 * Et svar: statuskode og kropp (objekt blir JSON), en feil som kastes, eller en egen funksjon.
 * Funksjonen brukes av email.test.ts 8.2.13b/c til å endre raden mens sendingen pågår.
 */
type FakeReply = { status: number; body?: unknown } | Error | (() => Response | Promise<Response>);

type FakeFetchPlan = {
  /** Svar på token-kallet (samme svar på hvert kall). */
  token?: FakeReply;
  /** Svar på sendekallet (samme svar på hvert kall). */
  send?: FakeReply;
};

export type FakeFetchCall = {
  kind: "token" | "send";
  url: string;
  method: string | undefined;
  /** Headerne med små bokstaver i navnet. */
  headers: Record<string, string>;
  body: string;
  signal: unknown;
};

const DEFAULT_TOKEN_REPLY: FakeReply = {
  status: 200,
  body: { access_token: "tok-1", expires_in: 3600 },
};
const DEFAULT_SEND_REPLY: FakeReply = { status: 202 };

function toResponse(reply: FakeReply): Response | Promise<Response> {
  if (reply instanceof Error) throw reply;
  if (typeof reply === "function") return reply();
  const body =
    reply.body === undefined
      ? null
      : typeof reply.body === "string"
        ? reply.body
        : JSON.stringify(reply.body);
  return new Response(body, { status: reply.status });
}

/** Lager en falsk `fetch`. `calls` fylles i rekkefølge; tom liste betyr at den aldri ble kalt. */
export function fakeFetch(plan: FakeFetchPlan = {}) {
  const calls: FakeFetchCall[] = [];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const kind = url.startsWith(TOKEN_URL_PREFIX)
      ? "token"
      : url.startsWith(SEND_URL_PREFIX)
        ? "send"
        : undefined;
    if (!kind) throw new Error("ukjent adresse i testen");
    calls.push({
      kind,
      url,
      method: init?.method,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body === undefined || init.body === null ? "" : String(init.body),
      signal: init?.signal,
    });
    if (kind === "token") return toResponse(plan.token ?? DEFAULT_TOKEN_REPLY);
    return toResponse(plan.send ?? DEFAULT_SEND_REPLY);
  };
  return { fetchFn: fetchFn as typeof fetch, calls };
}
