/**
 * Falsk `fetch` for e-posttestene (testplan for tilkoblingslaget, avsnitt 6–8). Registrerer hvert
 * kall og svarer etter en plan per adresse. Ingen test skal gjøre nettkall: Microsoft Graph prøves
 * bare mot denne. Alle verdier er oppdiktet.
 */

export const TOKEN_URL_PREFIX = "https://login.microsoftonline.com/";
export const SEND_URL_PREFIX = "https://graph.microsoft.com/v1.0/users/";

/** Et svar: statuskode og kropp (objekt blir JSON), en feil som kastes, eller en egen funksjon. */
export type FakeReply =
  { status: number; body?: unknown } | Error | (() => Response | Promise<Response>);

export type FakeFetchPlan = {
  /** Svar på token-kallet. Liste: ett svar per kall, det siste gjentas. */
  token?: FakeReply | FakeReply[];
  /** Svar på sendekallet. Liste: ett svar per kall, det siste gjentas. */
  send?: FakeReply | FakeReply[];
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

export const DEFAULT_TOKEN_REPLY: FakeReply = {
  status: 200,
  body: { access_token: "tok-1", expires_in: 3600 },
};
export const DEFAULT_SEND_REPLY: FakeReply = { status: 202 };

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

function pick(replies: FakeReply | FakeReply[] | undefined, index: number, fallback: FakeReply) {
  if (replies === undefined) return fallback;
  if (!Array.isArray(replies)) return replies;
  return replies[Math.min(index, replies.length - 1)] ?? fallback;
}

/** Lager en falsk `fetch`. `calls` fylles i rekkefølge; tom liste betyr at den aldri ble kalt. */
export function fakeFetch(plan: FakeFetchPlan = {}) {
  const calls: FakeFetchCall[] = [];
  let tokenCalls = 0;
  let sendCalls = 0;
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
    if (kind === "token") {
      tokenCalls += 1;
      return toResponse(pick(plan.token, tokenCalls - 1, DEFAULT_TOKEN_REPLY));
    }
    sendCalls += 1;
    return toResponse(pick(plan.send, sendCalls - 1, DEFAULT_SEND_REPLY));
  };
  return { fetchFn: fetchFn as typeof fetch, calls };
}
