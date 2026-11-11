import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_ERROR_CODES } from "@/db/schema";
import { PROMPT_INPUT_SEPARATOR } from "../features";
import {
  ANTHROPIC_API_VERSION,
  ANTHROPIC_MAX_OUTPUT_TOKENS,
  ANTHROPIC_MAX_RESPONSE_BYTES,
  ANTHROPIC_MESSAGES_URL,
  ANTHROPIC_PROVIDER_CODE,
  anthropicCost,
  createAnthropicProvider,
  type AiPricing,
} from "./anthropic";
import type { AiProviderRequest, AiProviderResult } from "./types";

/*
 * Adapteren mot falsk HTTP (testplanen avsnitt 1, A1-A3). Ingen nettkall. Nøkkel, modell og
 * leverandørmelding er oppdiktede merker, så lekkasjer kan letes etter.
 */

const KEY = "sk-ant-api03-OPPDIKTET-TESTNOKKEL-K7Q";
const MODEL = "MERKE-MODELL-K7Q";
const PROVIDER_MESSAGE = "MERKE-LEVERANDORMELDING-K7Q";
const PRICING: AiPricing = { inputPerMillion: 30, outputPerMillion: 150, currency: "NOK" };
const INPUT = "fukt i kjeller ved yttervegg";
const PROMPT = `Instruks.${PROMPT_INPUT_SEPARATOR}${INPUT}`;
const REQUEST: AiProviderRequest = {
  feature: "language_polish",
  promptVersion: "language_polish.v2",
  prompt: PROMPT,
  model: MODEL,
};

type Call = { url: string; init: RequestInit };

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function success(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "msg_oppdiktet",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "Fukt i kjelleren ved yttervegg." }],
    stop_reason: "end_turn",
    usage: { input_tokens: 120, output_tokens: 40 },
    ...overrides,
  };
}

function fakeFetch(reply: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return reply();
  });
  return { fn: fn as unknown as typeof fetch, calls, spy: fn };
}

function provider(fetchFn?: typeof fetch, timeoutMs?: number) {
  return createAnthropicProvider({
    model: MODEL,
    apiKey: KEY,
    pricing: PRICING,
    ...(fetchFn && { fetch: fetchFn }),
    ...(timeoutMs !== undefined && { timeoutMs }),
  });
}

function headersOf(init: RequestInit): Record<string, string> {
  return Object.fromEntries(
    Object.entries(init.headers as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("A1 forespørselen", () => {
  it("1-5 ett POST-kall til fast adresse, riktige hoder, kropp med bare tre nøkler", async () => {
    const http = fakeFetch(() => json(200, success()));
    await provider(http.fn).complete(REQUEST);
    expect(http.calls).toHaveLength(1);
    const { url, init } = http.calls[0]!;
    expect(url).toBe(ANTHROPIC_MESSAGES_URL);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);

    const headers = headersOf(init);
    expect(Object.keys(headers).sort()).toEqual(
      ["anthropic-version", "content-type", "x-api-key"].sort(),
    );
    expect(headers["x-api-key"]).toBe(KEY);
    expect(headers["anthropic-version"]).toBe(ANTHROPIC_API_VERSION);
    expect(headers["content-type"]).toBe("application/json");

    const body = JSON.parse(String(init.body));
    expect(Object.keys(body).sort()).toEqual(["max_tokens", "messages", "model"]);
    expect(body.model).toBe(MODEL);
    expect(body.max_tokens).toBe(ANTHROPIC_MAX_OUTPUT_TOKENS);
    expect(body.messages).toEqual([{ role: "user", content: PROMPT }]);
    expect(String(init.body)).not.toContain(KEY);
    expect(String(init.body)).not.toContain("metadata");
  });

  it("6 nøkkelen ligger ikke på objektet", () => {
    const p = provider(fakeFetch(() => json(200, success())).fn);
    expect(p.code).toBe(ANTHROPIC_PROVIDER_CODE);
    expect(p.model).toBe(MODEL);
    expect(JSON.stringify(p)).not.toContain(KEY);
    expect(Object.keys(p).join(",")).not.toContain(KEY);
    expect(inspect(p, { depth: 5 })).not.toContain(KEY);
  });

  it("7 fetch slås opp ved kallet", async () => {
    const p = provider();
    const http = fakeFetch(() => json(200, success()));
    vi.stubGlobal("fetch", http.fn);
    const result = await p.complete(REQUEST);
    expect(http.calls).toHaveLength(1);
    expect(result.outcome).toBe("ok");
  });
});

describe("A2 svaret", () => {
  it("1 vellykket svar gir tekst, tokens og NOK", async () => {
    const result = await provider(fakeFetch(() => json(200, success())).fn).complete(REQUEST);
    expect(result).toEqual({
      outcome: "ok",
      text: "Fukt i kjelleren ved yttervegg.",
      tokensIn: 120,
      tokensOut: 40,
      cost: (120 * 30 + 40 * 150) / 1_000_000,
      currency: "NOK",
    });
  });

  it.each([
    { name: "vanlig", tin: 120, tout: 40, pricing: PRICING, cost: 0.0096 },
    { name: "null tokens", tin: 0, tout: 0, pricing: PRICING, cost: 0 },
    {
      name: "pris 0",
      tin: 500,
      tout: 500,
      pricing: { ...PRICING, inputPerMillion: 0, outputPerMillion: 0 },
      cost: 0,
    },
    { name: "store tall", tin: 3_000_000, tout: 1_000_000, pricing: PRICING, cost: 240 },
    {
      name: "rundes til fire desimaler",
      tin: 7,
      tout: 3,
      pricing: { ...PRICING, inputPerMillion: 33.3, outputPerMillion: 0 },
      cost: 0.0002,
    },
  ])("2/5 kostnad: $name", ({ tin, tout, pricing, cost }) => {
    const value = anthropicCost({ tokensIn: tin, tokensOut: tout }, pricing);
    expect(value).not.toBeNull();
    expect(value!).toBeCloseTo(cost, 4);
    expect(value!).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(value)).toBe(false);
    expect(Math.round(value! * 10_000) / 10_000).toBe(value);
  });

  it("3 flere tekstblokker settes sammen, andre blokker ignoreres", async () => {
    const body = success({
      content: [
        { type: "thinking", thinking: "skjult" },
        { type: "text", text: "Første del, " },
        { type: "tool_use", id: "x", name: "y", input: {} },
        { type: "text", text: "andre del." },
      ],
    });
    const result = await provider(fakeFetch(() => json(200, body)).fn).complete(REQUEST);
    expect(result).toMatchObject({ outcome: "ok", text: "Første del, andre del." });
  });

  it.each([
    { name: "tomt", content: [{ type: "text", text: "" }] },
    { name: "bare mellomrom", content: [{ type: "text", text: "  \n " }] },
    { name: "ingen tekstblokker", content: [] },
    { name: "ingen endring", content: [{ type: "text", text: ` ${INPUT}\n` }] },
  ])("4 no_match: $name", async ({ content }) => {
    const result = await provider(fakeFetch(() => json(200, success({ content }))).fn).complete(
      REQUEST,
    );
    expect(result).toEqual({
      outcome: "no_match",
      tokensIn: 120,
      tokensOut: 40,
      cost: 0.0096,
      currency: "NOK",
    });
  });
});

type ErrorCase = {
  name: string;
  code: (typeof AI_ERROR_CODES)[number];
  reply: () => Response | Promise<Response>;
};

const errorMessage = { type: "error", error: { type: "x", message: PROVIDER_MESSAGE } };

function streamOf(chunks: number, chunkSize: number): Response {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= chunks) return controller.close();
      sent += 1;
      controller.enqueue(new Uint8Array(chunkSize).fill(0x61));
    },
  });
  return new Response(stream, { status: 200 });
}

const ERROR_CASES: ErrorCase[] = [
  { name: "429", code: "rate_limited", reply: () => json(429, errorMessage) },
  { name: "500", code: "unavailable", reply: () => json(500, errorMessage) },
  { name: "503", code: "unavailable", reply: () => json(503, errorMessage) },
  {
    name: "nettverk (TypeError)",
    code: "unavailable",
    reply: () => {
      throw new TypeError(`fetch failed ${PROVIDER_MESSAGE} ${KEY}`);
    },
  },
  {
    name: "videresending (redirect: error)",
    code: "unavailable",
    reply: () => {
      throw new TypeError(`redirect mode is set to error ${PROVIDER_MESSAGE}`);
    },
  },
  { name: "400", code: "rejected", reply: () => json(400, errorMessage) },
  { name: "401", code: "rejected", reply: () => json(401, errorMessage) },
  { name: "403", code: "rejected", reply: () => json(403, errorMessage) },
  { name: "404", code: "unknown", reply: () => json(404, errorMessage) },
  { name: "418", code: "unknown", reply: () => json(418, errorMessage) },
  { name: "ugyldig JSON", code: "unknown", reply: () => json(200, `{${PROVIDER_MESSAGE}`) },
  {
    name: "uten content",
    code: "unknown",
    reply: () => json(200, { usage: { input_tokens: 1, output_tokens: 1 } }),
  },
  {
    name: "content er ikke liste",
    code: "unknown",
    reply: () => json(200, success({ content: PROVIDER_MESSAGE })),
  },
  {
    name: "avkortet (max_tokens)",
    code: "unknown",
    reply: () =>
      json(
        200,
        success({ stop_reason: "max_tokens", content: [{ type: "text", text: "Halv setn" }] }),
      ),
  },
  { name: "uten usage", code: "unknown", reply: () => json(200, success({ usage: undefined })) },
  {
    name: "usage uten tall",
    code: "unknown",
    reply: () => json(200, success({ usage: { input_tokens: "12", output_tokens: null } })),
  },
  {
    name: "negative tokens",
    code: "unknown",
    reply: () => json(200, success({ usage: { input_tokens: -1, output_tokens: 4 } })),
  },
  {
    name: "for stort (oppgitt lengde)",
    code: "unknown",
    reply: () =>
      json(200, success(), { "content-length": String(ANTHROPIC_MAX_RESPONSE_BYTES + 1) }),
  },
  {
    name: "for stort (strøm uten lengde)",
    code: "unknown",
    reply: () => streamOf(20, Math.ceil(ANTHROPIC_MAX_RESPONSE_BYTES / 10)),
  },
];

describe("A3 feil", () => {
  it.each(ERROR_CASES)("$name → $code", async ({ code, reply }) => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const http = fakeFetch(reply);
    const result: AiProviderResult = await provider(http.fn).complete(REQUEST);

    expect(result).toEqual({ outcome: "error", errorCode: code });
    expect(AI_ERROR_CODES).toContain(code);
    expect(Object.keys(result).sort()).toEqual(["errorCode", "outcome"]);
    expect(http.spy).toHaveBeenCalledTimes(1);
    const seen = JSON.stringify([result, ...spies.map((s) => s.mock.calls)]);
    expect(seen).not.toContain(PROVIDER_MESSAGE);
    expect(seen).not.toContain(KEY);
  });

  it("tidsavbrudd → timeout, og kallet avbrytes", async () => {
    vi.useFakeTimers();
    const http = fakeFetch(() => new Promise<Response>(() => {}));
    const pending = provider(http.fn, 1000).complete(REQUEST);
    await vi.advanceTimersByTimeAsync(1001);
    const result = await pending;
    expect(result).toEqual({ outcome: "error", errorCode: "timeout" });
    expect(http.spy).toHaveBeenCalledTimes(1);
    expect((http.calls[0]!.init.signal as AbortSignal).aborted).toBe(true);
  });

  it("avkortet svar gir aldri tekst", async () => {
    const body = success({
      stop_reason: "max_tokens",
      content: [{ type: "text", text: "En hel setning." }],
    });
    const result = await provider(fakeFetch(() => json(200, body)).fn).complete(REQUEST);
    expect(result).not.toHaveProperty("text");
  });
});
