/**
 * Falsk HTTP for Anthropic-adapteren (docs/funksjoner/fase2a-ki-leverandor-testplan.md, «Avtale
 * om signaturer»). Ingen test gjør nettkall til KI-leverandøren: alt går mot denne, sendt inn som
 * `fetch` eller lagt inn med `vi.stubGlobal("fetch", ...)`. Nøkkelen, merkene og modellen er
 * oppdiktet. Formen på nøkkelen likner en ekte nøkkel, slik at loggmønsteret blir prøvd.
 */

/** Oppdiktet nøkkel. Formen likner, verdien er ikke ekte. */
export const TEST_ANTHROPIC_KEY = "sk-ant-api03-OPPDIKTET-TESTNOKKEL-K7Q";
/** Står i feilkroppene fra den falske leverandøren. Skal aldri komme ut av adapteren. */
export const PROVIDER_MESSAGE_MARK = "MERKE-LEVERANDORMELDING-K7Q";
/** Brukes som `settings.model`, så ingen ekte modell-id står i testene. */
export const TEST_MODEL = "MERKE-MODELL-K7Q";
/** Navnet på hemmeligheten (fast, A193). */
export const ANTHROPIC_SECRET_NAME = "ANTHROPIC_API_KEY";
/** Vertsnavnet testene aldri skal nå. */
export const ANTHROPIC_HOST_SUFFIX = "anthropic.com";

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

/** Hvordan den falske leverandøren svarer på ett kall. */
export type FakeAnthropicReply =
  /** Vellykket svar i meldingsformatet. `content` og `usage` kan overstyres for rare former. */
  | {
      kind: "ok";
      text?: string;
      content?: unknown;
      usage?: unknown;
      stopReason?: string;
      omit?: ("content" | "usage")[];
    }
  /** Statuskode med kropp (objekt blir JSON). Standardkroppen har merket og nøkkelen. */
  | { kind: "status"; status: number; body?: unknown; headers?: Record<string, string> }
  /** Rå kropp (for eksempel ugyldig JSON eller en strøm). */
  | { kind: "raw"; status: number; body: BodyInit | null; headers?: Record<string, string> }
  /** `fetch` kaster denne feilen. */
  | { kind: "throw"; error: unknown }
  /** Løftet løses aldri av seg selv. Avbrytes signalet, avvises det som ekte `fetch` gjør. */
  | { kind: "hang" };

/** Feilkroppen en leverandør kunne sendt, med merket og nøkkelen inni. */
export function providerErrorBody(): unknown {
  return {
    type: "error",
    error: {
      type: "oppdiktet_feil",
      message: `${PROVIDER_MESSAGE_MARK} nøkkel ${TEST_ANTHROPIC_KEY}`,
    },
  };
}

/** Et vellykket svar i meldingsformatet. */
export function okMessage(
  options: {
    text?: string;
    content?: unknown;
    usage?: unknown;
    stopReason?: string;
    omit?: ("content" | "usage")[];
  } = {},
): Record<string, unknown> {
  const message: Record<string, unknown> = {
    id: "msg_oppdiktet",
    type: "message",
    role: "assistant",
    model: TEST_MODEL,
    content: options.content ?? [{ type: "text", text: options.text ?? "Taket er gammelt." }],
    stop_reason: options.stopReason ?? "end_turn",
    stop_sequence: null,
    usage: options.usage ?? { input_tokens: 120, output_tokens: 40 },
  };
  for (const key of options.omit ?? []) delete message[key];
  return message;
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/**
 * Lager en falsk `fetch`. `replies` brukes i rekkefølge; siste svar gjentas. `calls` fylles i
 * rekkefølge; tom liste betyr at den aldri ble kalt.
 */
export function fakeAnthropicFetch(...replies: FakeAnthropicReply[]): {
  fetchFn: typeof fetch;
  calls: FakeAnthropicCall[];
} {
  const plan = replies.length > 0 ? replies : [{ kind: "ok" } as FakeAnthropicReply];
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
      case "ok":
        return jsonResponse(200, okMessage(reply));
      case "status":
        return jsonResponse(reply.status, reply.body ?? providerErrorBody(), reply.headers);
      case "raw":
        return new Response(reply.body, { status: reply.status, headers: reply.headers });
      case "throw":
        throw reply.error;
      case "hang":
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) return;
          const abort = () => reject(new DOMException("Avbrutt i testen.", "AbortError"));
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        });
    }
  };
  return { fetchFn: fetchFn as typeof fetch, calls };
}

/** En strøm uten oppgitt lengde, `size` byte lang (starten er gyldig JSON-start). */
export function longStream(size: number): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunk = encoder.encode("a".repeat(16 * 1024));
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const head = encoder.encode('{"type":"message","content":[{"type":"text","text":"');
      controller.enqueue(head);
      sent += head.length;
    },
    pull(controller) {
      if (sent >= size) {
        controller.enqueue(encoder.encode('"}]}'));
        controller.close();
        return;
      }
      controller.enqueue(chunk);
      sent += chunk.length;
    },
  });
}

/** Om teksten nevner nøkkelen eller merket fra leverandøren. */
export function hasSecretOrMark(text: string): boolean {
  return text.includes(TEST_ANTHROPIC_KEY) || text.includes(PROVIDER_MESSAGE_MARK);
}
