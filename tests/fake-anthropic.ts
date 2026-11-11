/**
 * Falsk HTTP for Anthropic-adapteren (docs/funksjoner/fase2a-ki-leverandor-testplan.md,
 * «Avtale om signaturer»). Registrerer hvert kall og svarer etter en plan. Ingen test gjør
 * nettkall til Anthropic. Alle verdier er oppdiktet; modellen er merket, aldri en ekte modell-id.
 *
 * Planen er ett svar (brukes ved hvert kall) eller en liste (ett per kall; det siste gjentas).
 */

/** Oppdiktet merke i feilkroppen, så testene kan se at leverandørens melding aldri lekker. */
export const FAKE_PROVIDER_MESSAGE = "MERKE-LEVERANDORMELDING-K7Q";

/** Oppdiktet modell som brukes i stedet for en ekte modell-id. */
export const FAKE_ANTHROPIC_MODEL = "MERKE-MODELL-K7Q";

export type FakeAnthropicUsage = { input_tokens?: unknown; output_tokens?: unknown };

export type FakeAnthropicBlock = { type: string; [key: string]: unknown };

export type FakeAnthropicReply =
  /** 200 med tekstblokker, `usage` og stoppårsak (standard: én tekstblokk, 120 inn, 40 ut, `end_turn`). */
  | {
      kind: "ok";
      blocks?: FakeAnthropicBlock[];
      usage?: FakeAnthropicUsage | null;
      stopReason?: string;
    }
  /** Statuskode med kropp (objekt blir JSON). Standard kropp har `FAKE_PROVIDER_MESSAGE`. */
  | { kind: "status"; status: number; body?: unknown }
  /** `fetch` kaster denne feilen. */
  | { kind: "throw"; error: unknown }
  /** Løftet løses aldri, bare avvises når signalet avbrytes (som ekte `fetch`). */
  | { kind: "hang" }
  /** 200 med rå kropp (tekst, bytes eller strøm) og valgfrie hoder, f.eks. `content-length`. */
  | {
      kind: "raw";
      body: string | Uint8Array | ReadableStream<Uint8Array> | null;
      headers?: Record<string, string>;
      status?: number;
    };

export type FakeAnthropicCall = {
  url: string;
  method: string | undefined;
  /** Hodene med små bokstaver i navnet. */
  headers: Record<string, string>;
  body: string;
  redirect: RequestRedirect | undefined;
  cache: RequestCache | undefined;
  signal: AbortSignal | null | undefined;
};

const DEFAULT_USAGE = { input_tokens: 120, output_tokens: 40 };

/** Et vellykket svar fra meldings-API-et med én tekstblokk. Oppdiktede verdier. */
export function anthropicOkBody(
  text: string,
  usage: FakeAnthropicUsage | null = DEFAULT_USAGE,
): Record<string, unknown> {
  return {
    id: "msg_oppdiktet",
    type: "message",
    role: "assistant",
    model: FAKE_ANTHROPIC_MODEL,
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    ...(usage !== null && { usage }),
  };
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function bodyOf(init: RequestInit | undefined): string {
  const body = init?.body;
  if (body === undefined || body === null) return "";
  if (typeof body === "string") return body;
  throw new Error("kroppen i testen er ikke tekst");
}

function toJson(body: unknown): string {
  return typeof body === "string" ? body : JSON.stringify(body);
}

function hang(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise<Response>((_, reject) => {
    signal?.addEventListener("abort", () => {
      reject(new DOMException("Avbrutt", "AbortError"));
    });
  });
}

function respond(reply: FakeAnthropicReply, signal: AbortSignal | null | undefined) {
  switch (reply.kind) {
    case "ok": {
      const content = reply.blocks ?? [{ type: "text", text: "Rettet tekst." }];
      const usage = reply.usage === undefined ? DEFAULT_USAGE : reply.usage;
      const body = {
        ...anthropicOkBody("", usage),
        content,
        stop_reason: reply.stopReason ?? "end_turn",
      };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }
    case "status": {
      const body =
        reply.body === undefined
          ? { type: "error", error: { type: "oppdiktet_feil", message: FAKE_PROVIDER_MESSAGE } }
          : reply.body;
      return Promise.resolve(new Response(toJson(body), { status: reply.status }));
    }
    case "throw":
      return Promise.reject(reply.error);
    case "hang":
      return hang(signal);
    case "raw":
      return Promise.resolve(
        new Response(reply.body as BodyInit | null, {
          status: reply.status ?? 200,
          headers: reply.headers,
        }),
      );
  }
}

/**
 * Lager en falsk `fetch`. `calls` fylles i rekkefølge; tom liste betyr at den aldri ble kalt.
 * Standard plan er ett vellykket svar.
 */
export function createFakeAnthropicFetch(
  plan: FakeAnthropicReply | readonly FakeAnthropicReply[] = { kind: "ok" },
) {
  const replies: readonly FakeAnthropicReply[] = Array.isArray(plan)
    ? plan
    : [plan as FakeAnthropicReply];
  if (replies.length === 0) throw new Error("planen for falsk fetch er tom");
  const calls: FakeAnthropicCall[] = [];
  const fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({
      url,
      method: init?.method,
      headers: headersOf(init),
      body: bodyOf(init),
      redirect: init?.redirect,
      cache: init?.cache,
      signal: init?.signal,
    });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)]!;
    return respond(reply, init?.signal);
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}
