/*
 * Falsk HTTP for Anthropic-adapteren (docs/funksjoner/fase2a-ki-leverandor-testplan.md, «Avtale om
 * signaturer»). Ingen test gjør nettkall til Anthropic: adapteren får denne `fetch` sendt inn, eller
 * den stubbes globalt med `vi.stubGlobal("fetch", ...)`. Registrerer hvert kall og svarer etter en
 * plan. Alle verdier er oppdiktet. Dette er den eneste hjelperen for falsk Anthropic-HTTP; konstantene
 * under brukes av alle testene (også `anthropicSettings` i tests/ai.ts).
 *
 * Støtter hovedmål: KI i bunnen (den ekte veien kan prøves helt uten kostnad og uten at data går ut).
 */

/** Tydelig oppdiktet nøkkel. Formen likner, så loggmønsteret prøves. */
export const TEST_ANTHROPIC_KEY = "sk-ant-api03-OPPDIKTET-TESTNOKKEL-K7Q";
/** Står i feilkroppen fra falsk HTTP. Skal aldri komme ut av adapteren. */
export const PROVIDER_MESSAGE_MARK = "MERKE-LEVERANDORMELDING-K7Q";
/** Brukes som `settings.model`, så ingen ekte modell-id står i testene. */
export const TEST_MODEL = "MERKE-MODELL-K7Q";
/** Vertsnavnet som aldri skal nås fra testene. */
export const ANTHROPIC_HOST = "api.anthropic.com";

export type FakeAnthropicCall = {
  url: string;
  method: string | undefined;
  /** Hodene med små bokstaver i navnet. */
  headers: Record<string, string>;
  body: string;
  redirect: RequestRedirect | undefined;
  cache: RequestCache | undefined;
  signal: AbortSignal | undefined;
};

/** Et svar: ferdig `Response`, statuskode med kropp, kastet feil eller et løfte som aldri løses. */
export type FakeAnthropicReply =
  | { kind: "response"; response: () => Response }
  | { kind: "status"; status: number; body?: unknown; headers?: Record<string, string> }
  | { kind: "throw"; error: () => unknown }
  /** Løses aldri, uansett signal (strengeste variant). */
  | { kind: "hang" }
  /** Løses aldri, men avvises med `AbortError` når signalet avbrytes (som ekte `fetch`). */
  | { kind: "hang_until_abort" }
  /** Kaster `TypeError` hvis `redirect` er `"error"`, slik ekte `fetch` gjør ved videresending. */
  | { kind: "redirect" };

/** Et vellykket svar fra meldings-API-et med tekstblokker og `usage`. */
export function messageBody(
  options: {
    blocks?: unknown[];
    text?: string;
    inputTokens?: unknown;
    outputTokens?: unknown;
    stopReason?: string;
    usage?: unknown;
  } = {},
): Record<string, unknown> {
  const blocks = options.blocks ?? [{ type: "text", text: options.text ?? "Taket er gammelt." }];
  const body: Record<string, unknown> = {
    id: "msg_oppdiktet_k7q",
    type: "message",
    role: "assistant",
    model: TEST_MODEL,
    content: blocks,
    stop_reason: options.stopReason ?? "end_turn",
    stop_sequence: null,
  };
  if (options.usage !== undefined) body.usage = options.usage;
  else {
    body.usage = {
      input_tokens: options.inputTokens ?? 120,
      output_tokens: options.outputTokens ?? 40,
    };
  }
  return body;
}

export function okReply(options: Parameters<typeof messageBody>[0] = {}): FakeAnthropicReply {
  return { kind: "status", status: 200, body: messageBody(options) };
}

/** Feilkropp i samme form som leverandøren, med merket i meldingen. */
export function errorReply(status: number): FakeAnthropicReply {
  return {
    kind: "status",
    status,
    body: {
      type: "error",
      error: { type: "oppdiktet_feil", message: `${PROVIDER_MESSAGE_MARK} ${TEST_ANTHROPIC_KEY}` },
    },
  };
}

function abortError(): Error {
  const error = new Error("This operation was aborted");
  error.name = "AbortError";
  return error;
}

function toResponse(reply: Extract<FakeAnthropicReply, { kind: "status" }>): Response {
  const body =
    reply.body === undefined
      ? null
      : typeof reply.body === "string"
        ? reply.body
        : JSON.stringify(reply.body);
  return new Response(body, {
    status: reply.status,
    headers: { "content-type": "application/json", ...(reply.headers ?? {}) },
  });
}

/**
 * Lager en falsk `fetch`. Svarene tas i rekkefølge; det siste gjentas. `calls` fylles i rekkefølge,
 * og tom liste betyr at den aldri ble kalt.
 */
export function fakeAnthropic(...replies: FakeAnthropicReply[]) {
  const plan = replies.length > 0 ? replies : [okReply()];
  const calls: FakeAnthropicCall[] = [];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({
      url,
      method: init?.method,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body === undefined || init.body === null ? "" : String(init.body),
      redirect: init?.redirect,
      cache: init?.cache,
      signal: init?.signal ?? undefined,
    });
    const reply = plan[Math.min(calls.length - 1, plan.length - 1)]!;
    switch (reply.kind) {
      case "response":
        return reply.response();
      case "status":
        return toResponse(reply);
      case "throw":
        throw reply.error();
      case "hang":
        return new Promise<Response>(() => {});
      case "hang_until_abort":
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) return reject(abortError());
          signal?.addEventListener("abort", () => reject(abortError()), { once: true });
        });
      case "redirect":
        if (init?.redirect === "error") {
          throw new TypeError("fetch failed", { cause: new Error("unexpected redirect") });
        }
        return new Response(null, { status: 307, headers: { location: "https://example.com/" } });
    }
  };
  return { fetchFn: fetchFn as typeof fetch, calls };
}

/** Kroppen i kallet som JSON. */
export function parsedBody(call: FakeAnthropicCall): Record<string, unknown> {
  return JSON.parse(call.body) as Record<string, unknown>;
}

/** Teksten i meldingene til leverandøren (innholdet som tekst eller som tekstblokker). */
export function sentPromptText(call: FakeAnthropicCall): string {
  const body = parsedBody(call);
  const messages = body.messages as { role: string; content: unknown }[];
  return messages
    .map((message) =>
      typeof message.content === "string"
        ? message.content
        : (message.content as { type: string; text?: string }[])
            .filter((block) => block.type === "text")
            .map((block) => block.text ?? "")
            .join(""),
    )
    .join("\n");
}
