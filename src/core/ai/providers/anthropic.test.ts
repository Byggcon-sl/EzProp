import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "@/shared/lib/logger";
import { AI_ERROR_CODES } from "../../../../tests/ai";
import {
  ANTHROPIC_HOST,
  errorReply,
  fakeAnthropic,
  messageBody,
  okReply,
  parsedBody,
  PROVIDER_MESSAGE_MARK,
  sentPromptText,
  TEST_ANTHROPIC_KEY,
  TEST_MODEL,
  type FakeAnthropicReply,
} from "../../../../tests/fake-anthropic";
import { PROMPT_INPUT_SEPARATOR } from "../features";
import {
  ANTHROPIC_API_URL,
  ANTHROPIC_API_VERSION,
  ANTHROPIC_DEFAULT_TIMEOUT_MS,
  ANTHROPIC_MAX_OUTPUT_TOKENS,
  ANTHROPIC_MAX_RESPONSE_BYTES,
  ANTHROPIC_PROVIDER_CODE,
  ANTHROPIC_SECRET_REF,
  createAnthropicProvider,
  type AiPricing,
} from "./anthropic";
import { FAKE_NO_MATCH_INPUT } from "./fake";
import type { AiProviderResult } from "./types";

/*
 * Anthropic-adapteren med falsk HTTP (docs/funksjoner/fase2a-ki-leverandor-testplan.md avsnitt
 * 1.1–1.3, kortet Omfang 4). Ingen database, ingen nettkall. Nøkkel, modell og merker er
 * oppdiktet (tests/fake-anthropic.ts).
 *
 * Støtter hovedmål: KI i bunnen (bare vasket ledetekst og nøkkelen i ett hode forlater oss) og
 * færre reklamasjoner (avkortede svar og feil blir faste koder, aldri halve setninger).
 */

const PRICING: AiPricing = { inputPerMillion: 30, outputPerMillion: 150, currency: "NOK" };
const PROMPT = `Rett språket i teksten.${PROMPT_INPUT_SEPARATOR}taket er gammelt og har noen sprekker`;

/** Identitet fra «forespørselen» som aldri skal finnes i kallet (oppdiktet). */
const IDENTITY = [
  "0193a7b2-0000-7000-8000-00000000a001", // organizationId
  "0193a7b2-0000-7000-8000-00000000e001", // ansatt-id
  "0193a7b2-0000-7000-8000-00000000f001", // oppdrags-id
  "0193a7b2-0000-7000-8000-00000000r001", // requestId
  "Oppdiktet Takst A",
];

function provider(fetchFn?: typeof fetch, extra: { timeoutMs?: number } = {}) {
  return createAnthropicProvider({
    model: TEST_MODEL,
    apiKey: TEST_ANTHROPIC_KEY,
    pricing: PRICING,
    ...(fetchFn ? { fetch: fetchFn } : {}),
    ...extra,
  });
}

function request(prompt = PROMPT) {
  return {
    feature: "language_polish" as const,
    promptVersion: "language_polish.v2",
    prompt,
    model: TEST_MODEL,
  };
}

type ConsoleSpies = ReturnType<typeof spyOnConsole>;

function spyOnConsole() {
  return [
    vi.spyOn(console, "log").mockImplementation(() => {}),
    vi.spyOn(console, "info").mockImplementation(() => {}),
    vi.spyOn(console, "warn").mockImplementation(() => {}),
    vi.spyOn(console, "error").mockImplementation(() => {}),
    vi.spyOn(console, "debug").mockImplementation(() => {}),
    vi.spyOn(logger, "debug"),
    vi.spyOn(logger, "info"),
    vi.spyOn(logger, "warn"),
    vi.spyOn(logger, "error"),
  ];
}

function consoleText(spies: ConsoleSpies): string {
  return spies
    .flatMap((spy) => spy.mock.calls)
    .map((args) => inspect(args, { depth: 6 }))
    .join("\n");
}

let consoleSpies: ConsoleSpies;

beforeEach(() => {
  consoleSpies = spyOnConsole();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Anthropic-adapteren: faste koder", () => {
  it("A1 koden er anthropic og hemmeligheten heter ANTHROPIC_API_KEY", () => {
    expect(ANTHROPIC_PROVIDER_CODE).toBe("anthropic");
    expect(ANTHROPIC_SECRET_REF).toBe("ANTHROPIC_API_KEY");
  });
});

describe("Anthropic-adapteren: forespørselen (1.1, A1)", () => {
  it("A1 1.1.1 ett POST-kall til den faste adressen", async () => {
    const http = fakeAnthropic(okReply());
    await provider(http.fetchFn).complete(request());
    expect(http.calls).toHaveLength(1);
    expect(http.calls[0]!.method).toBe("POST");
    expect(http.calls[0]!.url).toBe(ANTHROPIC_API_URL);
    expect(ANTHROPIC_API_URL).toBe(`https://${ANTHROPIC_HOST}/v1/messages`);
  });

  it("A1 1.1.1 adressen endres ikke av modell eller tidsgrense i options", async () => {
    const http = fakeAnthropic(okReply());
    const adapter = createAnthropicProvider({
      model: "https://example.com/annen-adresse",
      apiKey: TEST_ANTHROPIC_KEY,
      pricing: PRICING,
      fetch: http.fetchFn,
      timeoutMs: 5_000,
    });
    await adapter.complete(request());
    expect(http.calls[0]!.url).toBe(ANTHROPIC_API_URL);
  });

  it("A1 1.1.2 hodene: x-api-key er nøkkelen, versjonshodet er satt, JSON; nøkkelen bare i x-api-key", async () => {
    const http = fakeAnthropic(okReply());
    await provider(http.fetchFn).complete(request());
    const headers = http.calls[0]!.headers;
    expect(headers["x-api-key"]).toBe(TEST_ANTHROPIC_KEY);
    expect(headers["anthropic-version"]).toBe(ANTHROPIC_API_VERSION);
    expect(headers["content-type"]).toMatch(/^application\/json\b/);
    for (const [name, value] of Object.entries(headers)) {
      if (name === "x-api-key") continue;
      expect(value, name).not.toContain(TEST_ANTHROPIC_KEY);
      for (const id of IDENTITY) expect(value, name).not.toContain(id);
    }
    expect(headers.authorization).toBeUndefined();
  });

  it("A1 1.1.3 kroppen har nøyaktig modell, grense for tokens ut og meldingene", async () => {
    const http = fakeAnthropic(okReply());
    await provider(http.fetchFn).complete(request());
    const body = parsedBody(http.calls[0]!);
    expect(Object.keys(body).sort()).toEqual(["max_tokens", "messages", "model"]);
    expect(body.model).toBe(TEST_MODEL);
    expect(body.max_tokens).toBe(ANTHROPIC_MAX_OUTPUT_TOKENS);
    expect(Number.isInteger(body.max_tokens)).toBe(true);
    expect(body.max_tokens as number).toBeGreaterThan(0);
    const messages = body.messages as { role: string }[];
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe("user");
    expect(Object.keys(messages[0]!).sort()).toEqual(["content", "role"]);
    expect(sentPromptText(http.calls[0]!)).toBe(PROMPT);
  });

  it("A1 1.1.4 ingen identitet, ingen nøkkel og ingen metadata i kroppen", async () => {
    const http = fakeAnthropic(okReply());
    await provider(http.fetchFn).complete(request());
    const call = http.calls[0]!;
    expect(call.body).not.toContain(TEST_ANTHROPIC_KEY);
    for (const id of IDENTITY) expect(call.body).not.toContain(id);
    expect(call.body).not.toContain("metadata");
    expect(parsedBody(call)).not.toHaveProperty("metadata");
    expect(parsedBody(call)).not.toHaveProperty("system");
  });

  it('A1 1.1.5 redirect: "error", cache: "no-store" og et AbortSignal', async () => {
    const http = fakeAnthropic(okReply());
    await provider(http.fetchFn).complete(request());
    const call = http.calls[0]!;
    expect(call.redirect).toBe("error");
    expect(call.cache).toBe("no-store");
    expect(call.signal).toBeInstanceOf(AbortSignal);
  });

  it("A1 1.1.6 nøkkelen ligger ikke på objektet; code og model stemmer", () => {
    const adapter = provider(fakeAnthropic().fetchFn);
    expect(adapter.code).toBe("anthropic");
    expect(adapter.model).toBe(TEST_MODEL);
    expect(JSON.stringify(adapter) ?? "").not.toContain(TEST_ANTHROPIC_KEY);
    expect(Object.keys(adapter).join(" ")).not.toMatch(/key|secret|token/i);
    expect(inspect(adapter, { depth: 5, showHidden: true })).not.toContain(TEST_ANTHROPIC_KEY);
    for (const key of Object.getOwnPropertyNames(adapter)) {
      const value = (adapter as unknown as Record<string, unknown>)[key];
      if (typeof value === "string") expect(value, key).not.toContain(TEST_ANTHROPIC_KEY);
    }
  });

  it("A1 1.1.7 fetch slås opp ved kallet: adapter uten fetch bruker den globale stubben", async () => {
    const adapter = createAnthropicProvider({
      model: TEST_MODEL,
      apiKey: TEST_ANTHROPIC_KEY,
      pricing: PRICING,
    });
    const http = fakeAnthropic(okReply());
    vi.stubGlobal("fetch", http.fetchFn);
    const result = await adapter.complete(request());
    expect(http.calls).toHaveLength(1);
    expect(result.outcome).toBe("ok");
  });
});

describe("Anthropic-adapteren: svaret (1.2, A2)", () => {
  it("A2 1.2.1 vellykket svar gir tekst, tokens og NOK", async () => {
    const http = fakeAnthropic(
      okReply({ text: "Taket er gammelt.", inputTokens: 120, outputTokens: 40 }),
    );
    const result = await provider(http.fetchFn).complete(request());
    expect(result.outcome).toBe("ok");
    if (result.outcome !== "ok") return;
    expect(result.text).toBe("Taket er gammelt.");
    expect(result.tokensIn).toBe(120);
    expect(result.tokensOut).toBe(40);
    expect(result.currency).toBe("NOK");
  });

  it.each([
    {
      name: "(120 × 30 + 40 × 150) / 1 000 000",
      pricing: PRICING,
      tokensIn: 120,
      tokensOut: 40,
      expected: (120 * 30 + 40 * 150) / 1_000_000,
    },
    { name: "null tokens gir 0", pricing: PRICING, tokensIn: 0, tokensOut: 0, expected: 0 },
    {
      name: "pris 0 gir 0",
      pricing: { inputPerMillion: 0, outputPerMillion: 0, currency: "NOK" as const },
      tokensIn: 5_000,
      tokensOut: 2_000,
      expected: 0,
    },
    {
      name: "store tall gir riktig desimal uten avrunding til heltall",
      pricing: { inputPerMillion: 33.3, outputPerMillion: 166.7, currency: "NOK" as const },
      tokensIn: 1_234_567,
      tokensOut: 76_543,
      expected: (1_234_567 * 33.3 + 76_543 * 166.7) / 1_000_000,
    },
  ])("A2 1.2.2 kostnad: $name", async ({ pricing, tokensIn, tokensOut, expected }) => {
    const http = fakeAnthropic(okReply({ inputTokens: tokensIn, outputTokens: tokensOut }));
    const adapter = createAnthropicProvider({
      model: TEST_MODEL,
      apiKey: TEST_ANTHROPIC_KEY,
      pricing,
      fetch: http.fetchFn,
    });
    const result = await adapter.complete(request());
    expect(result.outcome).toBe("ok");
    if (result.outcome !== "ok") return;
    expect(result.cost).toBeCloseTo(expected, 9);
    expect(result.currency).toBe("NOK");
    if (expected !== 0) expect(Number.isInteger(result.cost)).toBe(Number.isInteger(expected));
  });

  it("A2 1.2.3 flere tekstblokker settes sammen i rekkefølge; andre blokker ignoreres", async () => {
    const http = fakeAnthropic(
      okReply({
        blocks: [
          { type: "thinking", thinking: "Skal ikke med.", signature: "x" },
          { type: "text", text: "Taket er " },
          { type: "tool_use", id: "toolu_k7q", name: "verktoy", input: { a: "Skal ikke med." } },
          { type: "text", text: "gammelt." },
        ],
      }),
    );
    const result = await provider(http.fetchFn).complete(request());
    expect(result.outcome).toBe("ok");
    if (result.outcome !== "ok") return;
    expect(result.text).toBe("Taket er gammelt.");
    expect(result.text).not.toContain("Skal ikke med.");
  });

  it.each([
    { name: "tomt tekstsvar", blocks: [{ type: "text", text: "" }] },
    { name: "bare mellomrom", blocks: [{ type: "text", text: "  \n\t " }] },
    { name: "ingen tekstblokker", blocks: [] },
    {
      name: "svaret som betyr «ingen endring» (samme regel som fake)",
      blocks: [{ type: "text", text: FAKE_NO_MATCH_INPUT }],
    },
  ])("A2 1.2.4 $name gir no_match", async ({ blocks }) => {
    const http = fakeAnthropic(okReply({ blocks }));
    const result = await provider(http.fetchFn).complete(request());
    expect(result.outcome).toBe("no_match");
    if (result.outcome !== "no_match") return;
    expect(result.tokensIn).toBe(120);
    expect(result.tokensOut).toBe(40);
    expect(result.currency).toBe("NOK");
    expect(result).not.toHaveProperty("text");
  });

  it("A2 1.2.4 svaret er lik teksten som ble sendt inn (ingen endring) gir no_match", async () => {
    const input = "Taket er gammelt og har noen sprekker.";
    const http = fakeAnthropic(okReply({ text: input }));
    const result = await provider(http.fetchFn).complete(
      request(`Rett språket i teksten.${PROMPT_INPUT_SEPARATOR}${input}`),
    );
    expect(result.outcome).toBe("no_match");
  });
});

/** Et svar med `Content-Length` større enn grensen (kroppen er liten, så bare lengden avslører det). */
function declaredTooLarge(): FakeAnthropicReply {
  return {
    kind: "response",
    response: () =>
      new Response(JSON.stringify(okReplyBody()), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": String(ANTHROPIC_MAX_RESPONSE_BYTES + 1),
        },
      }),
  };
}

function okReplyBody(): Record<string, unknown> {
  return messageBody();
}

/**
 * En strøm uten lengde som blir for lang. Innholdet er gyldig JSON med et vanlig svar, så bare
 * størrelsesgrensen kan stoppe det (ellers ville det blitt `ok`).
 */
function streamedTooLarge(): FakeAnthropicReply {
  return {
    kind: "response",
    response: () => {
      const limit = ANTHROPIC_MAX_RESPONSE_BYTES;
      const longText = `Taket er gammelt. ${PROVIDER_MESSAGE_MARK} `.repeat(
        Math.ceil(limit / 20) + 10,
      );
      const bytes = new TextEncoder().encode(JSON.stringify(okBodyWithText(longText)));
      const chunkSize = 16 * 1024;
      let offset = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset >= bytes.byteLength) {
            controller.close();
            return;
          }
          controller.enqueue(bytes.slice(offset, offset + chunkSize));
          offset += chunkSize;
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
    },
  };
}

function okBodyWithText(text: string): Record<string, unknown> {
  return messageBody({ text });
}

type ErrorCase = { name: string; reply: () => FakeAnthropicReply; code: string; timeout?: boolean };

const ERROR_CASES: ErrorCase[] = [
  {
    name: "tidsavbrudd (løftet løses aldri)",
    reply: () => ({ kind: "hang" }),
    code: "timeout",
    timeout: true,
  },
  {
    name: "tidsavbrudd (fetch avvises ved avbrudd, som ekte fetch)",
    reply: () => ({ kind: "hang_until_abort" }),
    code: "timeout",
    timeout: true,
  },
  { name: "429", reply: () => errorReply(429), code: "rate_limited" },
  { name: "500", reply: () => errorReply(500), code: "unavailable" },
  { name: "502", reply: () => errorReply(502), code: "unavailable" },
  { name: "503", reply: () => errorReply(503), code: "unavailable" },
  { name: "529", reply: () => errorReply(529), code: "unavailable" },
  {
    name: "fetch kaster TypeError (nettverk)",
    reply: () => ({
      kind: "throw",
      error: () =>
        new TypeError(`fetch failed ${PROVIDER_MESSAGE_MARK}`, {
          cause: new Error(`${PROVIDER_MESSAGE_MARK} ${TEST_ANTHROPIC_KEY}`),
        }),
    }),
    code: "unavailable",
  },
  {
    name: 'adressen sender videre (redirect: "error")',
    reply: () => ({ kind: "redirect" }),
    code: "unavailable",
  },
  { name: "400", reply: () => errorReply(400), code: "rejected" },
  { name: "401", reply: () => errorReply(401), code: "rejected" },
  { name: "403", reply: () => errorReply(403), code: "rejected" },
  { name: "404", reply: () => errorReply(404), code: "unknown" },
  { name: "418", reply: () => errorReply(418), code: "unknown" },
  {
    name: "200 med ugyldig JSON",
    reply: () => ({ kind: "status", status: 200, body: `{"content": [${PROVIDER_MESSAGE_MARK}` }),
    code: "unknown",
  },
  {
    name: "200 uten content",
    reply: () => ({
      kind: "status",
      status: 200,
      body: { type: "message", usage: { input_tokens: 1, output_tokens: 1 } },
    }),
    code: "unknown",
  },
  {
    name: "200 der content ikke er en liste",
    reply: () => ({
      kind: "status",
      status: 200,
      body: { ...okReplyBody(), content: PROVIDER_MESSAGE_MARK },
    }),
    code: "unknown",
  },
  {
    name: "200 som stoppet på grensen for tokens ut (avkortet)",
    reply: () => okReply({ text: "Taket er gammelt og har noen", stopReason: "max_tokens" }),
    code: "unknown",
  },
  {
    name: "200 uten usage",
    reply: () => ({
      kind: "status",
      status: 200,
      body: Object.fromEntries(Object.entries(okReplyBody()).filter(([key]) => key !== "usage")),
    }),
    code: "unknown",
  },
  {
    name: "200 med usage uten tall",
    reply: () => okReply({ usage: { input_tokens: "120", output_tokens: null } }),
    code: "unknown",
  },
  {
    name: "200 med negative tokens inn",
    reply: () => okReply({ inputTokens: -1, outputTokens: 40 }),
    code: "unknown",
  },
  {
    name: "200 med negative tokens ut",
    reply: () => okReply({ inputTokens: 120, outputTokens: -40 }),
    code: "unknown",
  },
  { name: "200 med oppgitt lengde over grensen", reply: declaredTooLarge, code: "unknown" },
  { name: "200 med strøm uten lengde som blir for lang", reply: streamedTooLarge, code: "unknown" },
];

/** Kjører kallet. Kaster adapteren, regnes feilen med i lekkasjesjekken. */
async function runCase(c: ErrorCase) {
  const http = fakeAnthropic(c.reply());
  const adapter = provider(http.fetchFn, { timeoutMs: 1_000 });
  let result: AiProviderResult | undefined;
  let thrown: unknown;
  if (c.timeout) {
    vi.useFakeTimers();
    const pending = adapter.complete(request()).then(
      (value) => {
        result = value;
      },
      (error: unknown) => {
        thrown = error;
      },
    );
    await vi.advanceTimersByTimeAsync(1_001);
    await vi.advanceTimersByTimeAsync(10);
    vi.useRealTimers();
    await Promise.race([pending, new Promise((resolve) => setTimeout(resolve, 50))]);
  } else {
    try {
      result = await adapter.complete(request());
    } catch (error) {
      thrown = error;
    }
  }
  return { http, result, thrown };
}

function errorText(error: unknown): string {
  if (error === undefined) return "";
  if (!(error instanceof Error)) return inspect(error, { depth: 6 });
  return [
    error.message,
    String(error),
    inspect(error, { depth: 6, showHidden: true }),
    error.cause === undefined ? "" : inspect(error.cause, { depth: 6 }),
  ].join("\n");
}

describe("Anthropic-adapteren: feil (1.3, A3, regeltabell)", () => {
  it.each(ERROR_CASES)("A3 1.3 $name → $code", async (c) => {
    const { http, result, thrown } = await runCase(c);

    // Adapteren gir et resultat med fast kode; den kaster ikke (en feil ville blitt `unknown`
    // i tjenesten og skjult den riktige koden).
    expect(thrown, errorText(thrown)).toBeUndefined();
    expect(result, "adapteren ga ikke svar (henger)").toBeDefined();
    expect(result!.outcome).toBe("error");
    if (result!.outcome !== "error") return;
    expect(result!.errorCode).toBe(c.code);

    // 1.3.1 ingen underkoder: koden er en av de faste, ingen ekstra felt
    expect(AI_ERROR_CODES).toContain(result!.errorCode);
    expect(Object.keys(result!).sort()).toEqual(["errorCode", "outcome"]);

    // 1.3.2 avkortet svar gir aldri tekst
    expect(result).not.toHaveProperty("text");

    // Ingen nye forsøk
    expect(http.calls).toHaveLength(1);

    // Leverandørens melding og nøkkelen står ikke i resultatet, feilen eller loggen
    const everything = [
      inspect(result, { depth: 6 }),
      errorText(thrown),
      consoleText(consoleSpies),
    ].join("\n");
    expect(everything).not.toContain(PROVIDER_MESSAGE_MARK);
    expect(everything).not.toContain(TEST_ANTHROPIC_KEY);
  });

  it("A3 1.3.3 tidsavbrudd avbryter kallet: signal.aborted er true", async () => {
    const { http, result } = await runCase(ERROR_CASES[0]!);
    expect(result?.outcome).toBe("error");
    expect(http.calls[0]!.signal?.aborted).toBe(true);
  });

  it("A3 1.3.3 standard tidsgrense brukes når timeoutMs mangler", async () => {
    vi.useFakeTimers();
    const http = fakeAnthropic({ kind: "hang" });
    const adapter = provider(http.fetchFn);
    let result: AiProviderResult | undefined;
    void adapter.complete(request()).then((value) => {
      result = value;
    });
    const timeoutMs = ANTHROPIC_DEFAULT_TIMEOUT_MS;
    expect(timeoutMs).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(timeoutMs - 5);
    expect(result, "ga opp før standard tidsgrense").toBeUndefined();
    await vi.advanceTimersByTimeAsync(20);
    expect(result).toEqual({ outcome: "error", errorCode: "timeout" });
    expect(http.calls[0]!.signal?.aborted).toBe(true);
  });

  it("A3 vellykket svar logger ingenting med ledetekst, svar eller nøkkel", async () => {
    const http = fakeAnthropic(okReply({ text: `Svar ${PROVIDER_MESSAGE_MARK}` }));
    await provider(http.fetchFn).complete(request());
    const logged = consoleText(consoleSpies);
    expect(logged).not.toContain(TEST_ANTHROPIC_KEY);
    expect(logged).not.toContain(PROVIDER_MESSAGE_MARK);
    expect(logged).not.toContain("taket er gammelt");
  });
});
