import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { AI_ERROR_CODES, type AiErrorCode } from "@/db/schema";
import {
  anthropicOkBody,
  createFakeAnthropicFetch,
  FAKE_ANTHROPIC_MODEL,
  FAKE_PROVIDER_MESSAGE,
  type FakeAnthropicReply,
} from "../../../../tests/fake-anthropic";
import { PROMPT_INPUT_SEPARATOR } from "../features";
import {
  ANTHROPIC_API_URL,
  ANTHROPIC_API_VERSION,
  ANTHROPIC_DEFAULT_TIMEOUT_MS,
  ANTHROPIC_MAX_OUTPUT_TOKENS,
  ANTHROPIC_MAX_RESPONSE_BYTES,
  createAnthropicProvider,
  type AiPricing,
} from "./anthropic";
import { FAKE_NO_MATCH_INPUT } from "./fake";
import type { AiProviderRequest } from "./types";

/*
 * Testplan docs/funksjoner/fase2a-ki-leverandor-testplan.md del 1.1–1.3 (A1–A3). All HTTP er
 * falsk; ingen nettkall. Nøkkelen er oppdiktet og tydelig merket.
 */

const API_KEY = "sk-ant-api03-OPPDIKTET-TESTNOKKEL-K7Q";
const PRICING: AiPricing = { inputPerMillion: 30, outputPerMillion: 150, currency: "NOK" };
const ORG_ID = "org-oppdiktet-K7Q";
const ORG_NAME = "Oppdiktet Takst AS";
const PROMPT = `Du retter språket.${PROMPT_INPUT_SEPARATOR}taket lekker litt ved pipa`;

function request(prompt = PROMPT): AiProviderRequest {
  return {
    feature: "language_polish",
    promptVersion: "language_polish.v2",
    prompt,
    model: FAKE_ANTHROPIC_MODEL,
  };
}

function setup(
  plan: FakeAnthropicReply | FakeAnthropicReply[] = { kind: "ok" },
  pricing: AiPricing = PRICING,
) {
  const fake = createFakeAnthropicFetch(plan);
  const provider = createAnthropicProvider({
    model: FAKE_ANTHROPIC_MODEL,
    apiKey: API_KEY,
    pricing,
    fetch: fake.fetch,
  });
  return { provider, calls: fake.calls };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("1.1 forespørselen (A1)", () => {
  it("1 ett kall, POST, til den faste adressen", async () => {
    const { provider, calls } = setup();
    await provider.complete(request());
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe(ANTHROPIC_API_URL);
    expect(ANTHROPIC_API_URL).toBe("https://api.anthropic.com/v1/messages");
  });

  it("2 hodene: nøkkel, versjon og JSON, og nøkkelen bare i x-api-key", async () => {
    const { provider, calls } = setup();
    await provider.complete(request());
    const headers = calls[0]!.headers;
    expect(headers).toEqual({
      "x-api-key": API_KEY,
      "anthropic-version": ANTHROPIC_API_VERSION,
      "content-type": "application/json",
    });
    const others = Object.entries(headers).filter(([key]) => key !== "x-api-key");
    expect(JSON.stringify(others)).not.toContain(API_KEY);
  });

  it("3 kroppen har nøyaktig modell, grense og én melding med ledeteksten", async () => {
    const { provider, calls } = setup();
    await provider.complete(request());
    const body = JSON.parse(calls[0]!.body);
    expect(Object.keys(body).sort()).toEqual(["max_tokens", "messages", "model"]);
    expect(body.model).toBe(FAKE_ANTHROPIC_MODEL);
    expect(body.max_tokens).toBe(ANTHROPIC_MAX_OUTPUT_TOKENS);
    expect(body.messages).toEqual([{ role: "user", content: PROMPT }]);
  });

  it("4 ingen identitet, nøkkel eller metadata i kroppen eller hodene utenom x-api-key", async () => {
    const { provider, calls } = setup();
    await provider.complete(request());
    const body = calls[0]!.body;
    const headerText = JSON.stringify(
      Object.entries(calls[0]!.headers).filter(([key]) => key !== "x-api-key"),
    );
    for (const text of [body, headerText]) {
      for (const marker of [API_KEY, ORG_ID, ORG_NAME, "requestId", "metadata", "user_id"]) {
        expect(text).not.toContain(marker);
      }
    }
  });

  it("5 redirect error, cache no-store og et AbortSignal", async () => {
    const { provider, calls } = setup();
    await provider.complete(request());
    expect(calls[0]!.redirect).toBe("error");
    expect(calls[0]!.cache).toBe("no-store");
    expect(calls[0]!.signal).toBeInstanceOf(AbortSignal);
  });

  it("6 nøkkelen ligger ikke på objektet", () => {
    const { provider } = setup();
    expect(provider.code).toBe("anthropic");
    expect(provider.model).toBe(FAKE_ANTHROPIC_MODEL);
    expect(JSON.stringify(provider)).not.toContain(API_KEY);
    expect(Object.keys(provider).join(",")).not.toContain(API_KEY);
    expect(Object.keys(provider).sort()).toEqual(["code", "complete", "model"]);
    expect(inspect(provider, { depth: 5 })).not.toContain(API_KEY);
  });

  it("7 fetch slås opp ved kallet (vi.stubGlobal virker)", async () => {
    const provider = createAnthropicProvider({
      model: FAKE_ANTHROPIC_MODEL,
      apiKey: API_KEY,
      pricing: PRICING,
    });
    const fake = createFakeAnthropicFetch({ kind: "ok" });
    vi.stubGlobal("fetch", fake.fetch);
    const result = await provider.complete(request());
    expect(fake.calls).toHaveLength(1);
    expect(result.outcome).toBe("ok");
  });
});

describe("1.2 svaret (A2)", () => {
  it("1 vellykket svar gir tekst, tokens og valuta", async () => {
    const { provider } = setup({
      kind: "ok",
      blocks: [{ type: "text", text: "Taket lekker litt ved pipa." }],
      usage: { input_tokens: 120, output_tokens: 40 },
    });
    const result = await provider.complete(request());
    expect(result).toMatchObject({
      outcome: "ok",
      text: "Taket lekker litt ved pipa.",
      tokensIn: 120,
      tokensOut: 40,
      currency: "NOK",
    });
  });

  it.each([
    { name: "vanlig", tokensIn: 120, tokensOut: 40, pricing: PRICING, cost: 0.0096 },
    { name: "null tokens", tokensIn: 0, tokensOut: 0, pricing: PRICING, cost: 0 },
    {
      name: "pris 0",
      tokensIn: 120,
      tokensOut: 40,
      pricing: { inputPerMillion: 0, outputPerMillion: 0, currency: "NOK" } as AiPricing,
      cost: 0,
    },
    {
      name: "store tall uten avrunding",
      tokensIn: 1_234_567,
      tokensOut: 7_654_321,
      pricing: { inputPerMillion: 2.5, outputPerMillion: 12.75, currency: "NOK" } as AiPricing,
      cost: (1_234_567 * 2.5 + 7_654_321 * 12.75) / 1_000_000,
    },
  ])("2 kostnad: $name", async ({ tokensIn, tokensOut, pricing, cost }) => {
    const { provider } = setup(
      { kind: "ok", usage: { input_tokens: tokensIn, output_tokens: tokensOut } },
      pricing,
    );
    const result = await provider.complete(request());
    if (result.outcome !== "ok") throw new Error(`ventet ok, fikk ${result.outcome}`);
    expect(result.cost).toBeCloseTo(cost, 10);
    expect(result.currency).toBe("NOK");
  });

  it("2 store tall gir desimal, ikke heltall", async () => {
    const { provider } = setup({
      kind: "ok",
      usage: { input_tokens: 1_234_567, output_tokens: 7_654_321 },
    });
    const result = await provider.complete(request());
    if (result.outcome !== "ok") throw new Error("ventet ok");
    expect(Number.isInteger(result.cost)).toBe(false);
  });

  it("3 flere tekstblokker settes sammen i rekkefølge; andre typer ignoreres", async () => {
    const { provider } = setup({
      kind: "ok",
      blocks: [
        { type: "thinking", thinking: "skal ikke med" },
        { type: "text", text: "Taket lekker " },
        { type: "tool_use", id: "x", name: "y", input: {} },
        { type: "text", text: "ved pipa." },
      ],
    });
    const result = await provider.complete(request());
    expect(result).toMatchObject({ outcome: "ok", text: "Taket lekker ved pipa." });
  });

  it.each([
    { name: "tomt svar", blocks: [{ type: "text", text: "" }] },
    { name: "ingen tekstblokker", blocks: [] },
    { name: "bare mellomrom", blocks: [{ type: "text", text: "  \n\t " }] },
    { name: "prøveverdien for ingen treff", blocks: [{ type: "text", text: FAKE_NO_MATCH_INPUT }] },
    {
      name: "ingen endring (samme tekst som ble sendt)",
      blocks: [{ type: "text", text: " taket lekker litt ved pipa " }],
    },
  ])("4 no_match: $name, med tokens og kostnad", async ({ blocks }) => {
    const { provider } = setup({ kind: "ok", blocks });
    const result = await provider.complete(request());
    expect(result).toEqual({
      outcome: "no_match",
      tokensIn: 120,
      tokensOut: 40,
      cost: expect.closeTo(0.0096, 10),
      currency: "NOK",
    });
  });
});

const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"] as const;

function bigStream(totalBytes: number): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(16 * 1024).fill(0x61);
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      controller.enqueue(chunk);
      sent += chunk.byteLength;
    },
  });
}

const okBodyText = JSON.stringify(anthropicOkBody("Taket lekker ved pipa."));

const ERROR_CASES: { name: string; plan: FakeAnthropicReply; code: AiErrorCode }[] = [
  { name: "429", plan: { kind: "status", status: 429 }, code: "rate_limited" },
  { name: "500", plan: { kind: "status", status: 500 }, code: "unavailable" },
  { name: "502", plan: { kind: "status", status: 502 }, code: "unavailable" },
  { name: "503", plan: { kind: "status", status: 503 }, code: "unavailable" },
  { name: "529", plan: { kind: "status", status: 529 }, code: "unavailable" },
  {
    name: "nettverksfeil (TypeError)",
    plan: { kind: "throw", error: new TypeError(`fetch failed ${FAKE_PROVIDER_MESSAGE}`) },
    code: "unavailable",
  },
  {
    name: "videresending med redirect: error",
    plan: {
      kind: "throw",
      error: new TypeError("fetch failed", {
        cause: new Error(`redirect ${FAKE_PROVIDER_MESSAGE}`),
      }),
    },
    code: "unavailable",
  },
  { name: "400", plan: { kind: "status", status: 400 }, code: "rejected" },
  { name: "401", plan: { kind: "status", status: 401 }, code: "rejected" },
  { name: "403", plan: { kind: "status", status: 403 }, code: "rejected" },
  { name: "404", plan: { kind: "status", status: 404 }, code: "unknown" },
  { name: "418", plan: { kind: "status", status: 418 }, code: "unknown" },
  {
    name: "200 med ugyldig JSON",
    plan: { kind: "raw", body: `{ikke json ${FAKE_PROVIDER_MESSAGE}` },
    code: "unknown",
  },
  {
    name: "200 uten content",
    plan: {
      kind: "raw",
      body: JSON.stringify({
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    },
    code: "unknown",
  },
  {
    name: "200 der content ikke er liste",
    plan: {
      kind: "raw",
      body: JSON.stringify({
        content: FAKE_PROVIDER_MESSAGE,
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    },
    code: "unknown",
  },
  {
    name: "200 avkortet på grensen for tokens ut",
    plan: {
      kind: "ok",
      blocks: [{ type: "text", text: `Taket lekker ved ${FAKE_PROVIDER_MESSAGE}` }],
      stopReason: "max_tokens",
    },
    code: "unknown",
  },
  { name: "200 uten usage", plan: { kind: "ok", usage: null }, code: "unknown" },
  {
    name: "200 med usage uten tall",
    plan: { kind: "ok", usage: { input_tokens: "120", output_tokens: 40 } },
    code: "unknown",
  },
  {
    name: "200 med negative tokens",
    plan: { kind: "ok", usage: { input_tokens: 120, output_tokens: -1 } },
    code: "unknown",
  },
  {
    name: "200 med oppgitt lengde over grensen",
    plan: {
      kind: "raw",
      body: okBodyText,
      headers: { "content-length": String(ANTHROPIC_MAX_RESPONSE_BYTES + 1) },
    },
    code: "unknown",
  },
  {
    name: "200 med strøm uten lengde som blir for lang",
    plan: { kind: "raw", body: bigStream(ANTHROPIC_MAX_RESPONSE_BYTES + 64 * 1024) },
    code: "unknown",
  },
];

describe("1.3 feil (A3)", () => {
  let spies: MockInstance[] = [];

  beforeEach(() => {
    spies = CONSOLE_METHODS.map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
  });

  function expectNoLeak(result: unknown) {
    const seen = [
      JSON.stringify(result),
      String(result),
      inspect(result, { depth: 5 }),
      ...spies.flatMap((spy) => spy.mock.calls.map((args) => inspect(args, { depth: 5 }))),
    ].join("\n");
    expect(seen).not.toContain(FAKE_PROVIDER_MESSAGE);
    expect(seen).not.toContain(API_KEY);
  }

  it.each(ERROR_CASES)("$name → $code", async ({ plan, code }) => {
    const { provider, calls } = setup(plan);
    const result = await provider.complete(request());
    expect(result).toEqual({ outcome: "error", errorCode: code });
    expect(AI_ERROR_CODES).toContain(code);
    expect(calls).toHaveLength(1);
    expectNoLeak(result);
  });

  it("tidsavbrudd → timeout, kallet avbrytes, ingen nye forsøk", async () => {
    vi.useFakeTimers();
    const { provider, calls } = setup({ kind: "hang" });
    const pending = provider.complete(request());
    await vi.advanceTimersByTimeAsync(ANTHROPIC_DEFAULT_TIMEOUT_MS + 1);
    const result = await pending;
    expect(result).toEqual({ outcome: "error", errorCode: "timeout" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.signal?.aborted).toBe(true);
    expectNoLeak(result);
  });

  it("tidsgrensen fra options brukes", async () => {
    vi.useFakeTimers();
    const fake = createFakeAnthropicFetch({ kind: "hang" });
    const provider = createAnthropicProvider({
      model: FAKE_ANTHROPIC_MODEL,
      apiKey: API_KEY,
      pricing: PRICING,
      fetch: fake.fetch,
      timeoutMs: 500,
    });
    const pending = provider.complete(request());
    await vi.advanceTimersByTimeAsync(501);
    expect(await pending).toEqual({ outcome: "error", errorCode: "timeout" });
  });

  it("1 ingen underkoder: feilresultatet har bare outcome og errorCode", async () => {
    const { provider } = setup({ kind: "status", status: 400 });
    const result = await provider.complete(request());
    expect(Object.keys(result).sort()).toEqual(["errorCode", "outcome"]);
  });

  it("2 avkortet svar gir aldri tekst", async () => {
    const { provider } = setup({
      kind: "ok",
      blocks: [{ type: "text", text: "Taket lekker ved" }],
      stopReason: "max_tokens",
    });
    const result = await provider.complete(request());
    expect(result).not.toHaveProperty("text");
    expect(JSON.stringify(result)).not.toContain("Taket lekker ved");
  });
});
