import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fakeAnthropicFetch,
  hasSecretOrMark,
  longStream,
  okMessage,
  providerErrorBody,
  PROVIDER_MESSAGE_MARK,
  TEST_ANTHROPIC_KEY,
  TEST_MODEL,
  type FakeAnthropicReply,
} from "../../../../tests/fake-anthropic";
import * as anthropicModule from "./anthropic";
import { createAnthropicProvider, type AnthropicProviderOptions } from "./anthropic";
import type { AiProviderRequest, AiProviderResult } from "./types";

/*
 * Anthropic-adapteren med falsk HTTP (docs/funksjoner/fase2a-ki-leverandor-testplan.md avsnitt
 * 1.1–1.3, kortet Omfang 4, A1–A3). Ingen test gjør nettkall: `fetch` sendes inn, eller legges
 * inn med `vi.stubGlobal`. Nøkkel, modell og merker er oppdiktet.
 *
 * Støtter hovedmål: KI i bunnen (bare vasket tekst forlater oss, og nøkkelen lekker aldri) og
 * færre reklamasjoner (avkortede svar og feil blir faste feilkoder, aldri halve setninger).
 *
 * Konstantene (adresse, versjonshode, grense for tokens ut, standard tidsgrense og grense for
 * svarstørrelse) leses fra modulen, så verdiene ikke står to steder. Navnene er ikke låst i
 * kortet; testen finner dem på form og navn (se `constants()`).
 */

const PRICING = { inputPerMillion: 30, outputPerMillion: 150, currency: "NOK" as const };
const PROMPT = "Ledetekst for språkvask.\n---\nTaket er gammelt og har noen sprekker";

/** Oppdiktede id-er og navn som aldri skal stå i forespørselen. */
const IDENTITY = [
  "0190a1b2-0000-7000-8000-00000000a001",
  "0190a1b2-0000-7000-8000-00000000e001",
  "Oppdiktet Takst A",
];

const EXPORTS = anthropicModule as unknown as Record<string, unknown>;

function exportedBy(predicate: (name: string, value: unknown) => boolean): unknown[] {
  return Object.entries(EXPORTS)
    .filter(([name, value]) => predicate(name, value))
    .map(([, value]) => value);
}

function single<T>(values: unknown[], what: string): T {
  if (values.length !== 1) {
    throw new Error(
      `Fant ${values.length} eksporterte konstanter for ${what} i providers/anthropic.ts (ventet én).`,
    );
  }
  return values[0] as T;
}

/** Konstantene fra modulen (testplanen, «Avtale om signaturer»). */
function constants() {
  return {
    url: single<string>(
      exportedBy((_, v) => typeof v === "string" && v.startsWith("https://")),
      "adressen",
    ),
    version: single<string>(
      exportedBy((_, v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)),
      "versjonshodet",
    ),
    maxTokens: single<number>(
      exportedBy((n, v) => typeof v === "number" && /TOKEN/i.test(n)),
      "grensen for tokens ut",
    ),
    timeoutMs: single<number>(
      exportedBy((n, v) => typeof v === "number" && /TIMEOUT/i.test(n)),
      "standard tidsgrense",
    ),
    maxResponse: single<number>(
      exportedBy(
        (n, v) =>
          typeof v === "number" && /(RESPONSE|BYTES|SIZE|LENGTH)/i.test(n) && !/TOKEN/i.test(n),
      ),
      "grensen for svarstørrelse",
    ),
  };
}

function options(overrides: Partial<AnthropicProviderOptions> = {}): AnthropicProviderOptions {
  return { model: TEST_MODEL, apiKey: TEST_ANTHROPIC_KEY, pricing: { ...PRICING }, ...overrides };
}

function request(prompt = PROMPT): AiProviderRequest {
  return {
    feature: "language_polish",
    promptVersion: "language_polish.v2",
    prompt,
    model: TEST_MODEL,
  };
}

/** Adapter med falsk HTTP som svarer etter planen. */
function withReplies(replies: FakeAnthropicReply[], extra: Partial<AnthropicProviderOptions> = {}) {
  const fake = fakeAnthropicFetch(...replies);
  const provider = createAnthropicProvider(options({ fetch: fake.fetchFn, ...extra }));
  return { provider, calls: fake.calls };
}

/** Teksten i meldingen til brukeren, enten innholdet er tekst eller en liste med tekstblokker. */
function userText(body: Record<string, unknown>): string {
  const messages = body.messages as { role: string; content: unknown }[];
  expect(Array.isArray(messages)).toBe(true);
  expect(messages).toHaveLength(1);
  expect(messages[0]!.role).toBe("user");
  const content = messages[0]!.content;
  if (typeof content === "string") return content;
  expect(Array.isArray(content)).toBe(true);
  return (content as { type: string; text: string }[])
    .map((block) => {
      expect(block.type).toBe("text");
      return block.text;
    })
    .join("");
}

function consoleSpies() {
  return (["log", "info", "warn", "error", "debug"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => undefined),
  );
}

function consoleText(spies: ReturnType<typeof consoleSpies>): string {
  return spies.map((spy) => inspect(spy.mock.calls, { depth: 8 })).join("\n");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Anthropic-adapteren: forespørselen (1.1, A1)", () => {
  it("konstantene finnes og er fornuftige", () => {
    const c = constants();
    expect(new URL(c.url).protocol).toBe("https:");
    expect(new URL(c.url).hostname.endsWith("anthropic.com")).toBe(true);
    expect(Number.isInteger(c.maxTokens) && c.maxTokens > 0).toBe(true);
    expect(c.timeoutMs).toBeGreaterThan(0);
    expect(c.timeoutMs).toBeLessThanOrEqual(120_000);
    expect(c.maxResponse).toBeGreaterThan(0);
    expect(anthropicModule.ANTHROPIC_PROVIDER_CODE).toBe("anthropic");
  });

  it("1.1.1 ett kall, POST, til den faste adressen", async () => {
    const { provider, calls } = withReplies([{ kind: "ok" }]);
    await provider.complete(request());
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe(constants().url);
  });

  it("1.1.1 adressen endres ikke av noe i options eller forespørselen", async () => {
    const fake = fakeAnthropicFetch({ kind: "ok" });
    const sneaky = {
      ...options({ fetch: fake.fetchFn }),
      baseUrl: "https://example.invalid/",
      url: "https://example.invalid/",
    } as unknown as AnthropicProviderOptions;
    const provider = createAnthropicProvider(sneaky);
    await provider.complete({
      ...request(),
      baseUrl: "https://example.invalid/",
    } as unknown as AiProviderRequest);
    expect(fake.calls[0]!.url).toBe(constants().url);
  });

  it("1.1.2 hodene: x-api-key, versjonshode og JSON; nøkkelen ikke i andre hoder", async () => {
    const { provider, calls } = withReplies([{ kind: "ok" }]);
    await provider.complete(request());
    const headers = calls[0]!.headers;
    expect(headers["x-api-key"]).toBe(TEST_ANTHROPIC_KEY);
    expect(headers["anthropic-version"]).toBe(constants().version);
    expect(headers["content-type"]).toMatch(/^application\/json/);
    for (const [name, value] of Object.entries(headers)) {
      if (name === "x-api-key") continue;
      expect(value, name).not.toContain(TEST_ANTHROPIC_KEY);
      expect(value, name).not.toContain("OPPDIKTET-TESTNOKKEL");
    }
    expect(headers.authorization).toBeUndefined();
  });

  it("1.1.3 kroppen har bare modell, grense for tokens ut og meldingen, og ledeteksten er uendret", async () => {
    const { provider, calls } = withReplies([{ kind: "ok" }]);
    await provider.complete(request());
    const body = JSON.parse(calls[0]!.body) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["max_tokens", "messages", "model"]);
    expect(body.model).toBe(TEST_MODEL);
    expect(body.max_tokens).toBe(constants().maxTokens);
    expect(userText(body)).toBe(PROMPT);
    const message = (body.messages as Record<string, unknown>[])[0]!;
    expect(Object.keys(message).sort()).toEqual(["content", "role"]);
  });

  it("1.1.4 ingen nøkkel, id-er, organisasjonsnavn eller metadata i kroppen og hodene", async () => {
    const { provider, calls } = withReplies([{ kind: "ok" }]);
    // Felt adapteren ikke skal ha: sendes de likevel med, skal de ikke videre
    await provider.complete({
      ...request(),
      organizationId: IDENTITY[0],
      employeeId: IDENTITY[1],
      requestId: IDENTITY[0],
      organizationName: IDENTITY[2],
    } as unknown as AiProviderRequest);
    const call = calls[0]!;
    expect(call.body).not.toContain(TEST_ANTHROPIC_KEY);
    expect(call.body).not.toContain("metadata");
    const headersText = Object.entries(call.headers)
      .filter(([name]) => name !== "x-api-key")
      .map(([name, value]) => `${name}: ${value}`)
      .join("\n");
    for (const value of IDENTITY) {
      expect(call.body).not.toContain(value);
      expect(headersText).not.toContain(value);
    }
    expect(Object.keys(JSON.parse(call.body) as object)).not.toContain("metadata");
  });

  it('1.1.5 redirect: "error", cache: "no-store" og et AbortSignal', async () => {
    const { provider, calls } = withReplies([{ kind: "ok" }]);
    await provider.complete(request());
    expect(calls[0]!.redirect).toBe("error");
    expect(calls[0]!.cache).toBe("no-store");
    expect(calls[0]!.signal).toBeInstanceOf(AbortSignal);
  });

  it("1.1.6 nøkkelen ligger ikke på objektet; code og model er riktige", () => {
    const provider = createAnthropicProvider(options({ fetch: fakeAnthropicFetch().fetchFn }));
    expect(provider.code).toBe("anthropic");
    expect(provider.model).toBe(TEST_MODEL);
    expect(JSON.stringify(provider) ?? "").not.toContain(TEST_ANTHROPIC_KEY);
    expect(Object.keys(provider).join(",")).not.toMatch(/key|secret/i);
    expect(inspect(provider, { depth: 5, showHidden: true })).not.toContain(TEST_ANTHROPIC_KEY);
    for (const name of Object.getOwnPropertyNames(provider)) {
      const value = (provider as unknown as Record<string, unknown>)[name];
      if (typeof value === "string") expect(value, name).not.toContain(TEST_ANTHROPIC_KEY);
    }
  });

  it("1.1.7 fetch slås opp ved kallet (vi.stubGlobal virker når adapteren er laget uten fetch)", async () => {
    const provider = createAnthropicProvider(options());
    const fake = fakeAnthropicFetch({ kind: "ok" });
    vi.stubGlobal("fetch", fake.fetchFn);
    const result = await provider.complete(request());
    expect(fake.calls).toHaveLength(1);
    expect(result.outcome).toBe("ok");
  });
});

describe("Anthropic-adapteren: svaret (1.2, A2)", () => {
  it("1.2.1 vellykket svar gir tekst, tokens og valuta", async () => {
    const { provider } = withReplies([
      {
        kind: "ok",
        text: "Taket er gammelt og har sprekker.",
        usage: { input_tokens: 120, output_tokens: 40 },
      },
    ]);
    const result = await provider.complete(request());
    expect(result).toMatchObject({
      outcome: "ok",
      text: "Taket er gammelt og har sprekker.",
      tokensIn: 120,
      tokensOut: 40,
      currency: "NOK",
    });
    expect(Object.keys(result).sort()).toEqual(
      ["cost", "currency", "outcome", "text", "tokensIn", "tokensOut"].sort(),
    );
  });

  it.each([
    { name: "eksempelet i testplanen", tin: 120, tout: 40, pin: 30, pout: 150, cost: 0.0096 },
    { name: "null tokens", tin: 0, tout: 0, pin: 30, pout: 150, cost: 0 },
    { name: "pris 0", tin: 120, tout: 40, pin: 0, pout: 0, cost: 0 },
    {
      name: "store tall gir desimaler, ikke heltall",
      tin: 1_234_567,
      tout: 7_654_321,
      pin: 30,
      pout: 150,
      cost: 1185.1852,
    },
    { name: "rundes til fire desimaler", tin: 7, tout: 3, pin: 12.345, pout: 67.891, cost: 0.0003 },
  ])("1.2.2/1.2.5 kostnad: $name", async ({ tin, tout, pin, pout, cost }) => {
    const { provider } = withReplies(
      [{ kind: "ok", usage: { input_tokens: tin, output_tokens: tout } }],
      {
        pricing: { inputPerMillion: pin, outputPerMillion: pout, currency: "NOK" },
      },
    );
    const result = await provider.complete(request());
    if (result.outcome !== "ok") throw new Error(`ventet ok, fikk ${JSON.stringify(result)}`);
    expect(result.cost).toBeCloseTo(cost, 6);
    expect(Number.isNaN(result.cost)).toBe(false);
    expect(result.cost).toBeGreaterThanOrEqual(0);
    expect(Object.is(result.cost, -0)).toBe(false);
    // Høyst fire desimaler (ai_usage_log.cost er numeric(12,4))
    expect(Math.abs(result.cost * 10_000 - Math.round(result.cost * 10_000))).toBeLessThan(1e-6);
  });

  it("1.2.3 flere tekstblokker settes sammen i rekkefølge; andre blokker ignoreres", async () => {
    const { provider } = withReplies([
      {
        kind: "ok",
        content: [
          { type: "thinking", thinking: "skal ikke med", signature: "x" },
          { type: "text", text: "Første del. " },
          { type: "tool_use", id: "t1", name: "verktoy", input: { tekst: "skal ikke med" } },
          { type: "text", text: "Andre del." },
        ],
      },
    ]);
    const result = await provider.complete(request());
    if (result.outcome !== "ok") throw new Error(`ventet ok, fikk ${JSON.stringify(result)}`);
    expect(result.text).toBe("Første del. Andre del.");
    expect(result.text).not.toContain("skal ikke med");
  });

  it.each([
    { name: "tomt tekstsvar", content: [{ type: "text", text: "" }] },
    { name: "bare mellomrom", content: [{ type: "text", text: "  \n\t " }] },
    { name: "ingen tekstblokker", content: [] },
    // «Ingen endring» betyr at svaret er lik inndata (kortet Omfang 4). Det prøves i
    // anthropic.test.ts; merket til den falske leverandøren kommer aldri fra en ekte modell.
  ])("1.2.4 $name gir no_match med tokens og kostnad", async ({ content }) => {
    const { provider } = withReplies([
      { kind: "ok", content, usage: { input_tokens: 120, output_tokens: 1 } },
    ]);
    const result = await provider.complete(request());
    expect(result.outcome).toBe("no_match");
    if (result.outcome !== "no_match") return;
    expect(result.tokensIn).toBe(120);
    expect(result.tokensOut).toBe(1);
    expect(result.currency).toBe("NOK");
    expect(result.cost).toBeGreaterThanOrEqual(0);
    expect(Object.keys(result)).not.toContain("text");
  });
});

/* ---------------------------------------------------------------------------------------------
 * Feil (1.3, A3): regeltabell. Hver rad: fast kode, ingen merke eller nøkkel ut, ett kall.
 */

const TIMEOUT_MS = 30;

type ErrorCase = {
  name: string;
  code: string;
  replies: () => FakeAnthropicReply[];
  extra?: Partial<AnthropicProviderOptions>;
};

function redirectError(): TypeError {
  const error = new TypeError(`fetch failed ${PROVIDER_MESSAGE_MARK}`);
  (error as { cause?: unknown }).cause = new Error(
    `redirect mode is set to error ${TEST_ANTHROPIC_KEY}`,
  );
  return error;
}

const ERROR_CASES: ErrorCase[] = [
  {
    name: "tidsavbrudd",
    code: "timeout",
    replies: () => [{ kind: "hang" }],
    extra: { timeoutMs: TIMEOUT_MS },
  },
  { name: "429", code: "rate_limited", replies: () => [{ kind: "status", status: 429 }] },
  { name: "500", code: "unavailable", replies: () => [{ kind: "status", status: 500 }] },
  { name: "503", code: "unavailable", replies: () => [{ kind: "status", status: 503 }] },
  {
    name: "nettverksfeil (TypeError)",
    code: "unavailable",
    replies: () => [
      { kind: "throw", error: new TypeError(`fetch failed ${PROVIDER_MESSAGE_MARK}`) },
    ],
  },
  {
    name: 'adressen sender videre (redirect: "error")',
    code: "unavailable",
    replies: () => [{ kind: "throw", error: redirectError() }],
  },
  { name: "400", code: "rejected", replies: () => [{ kind: "status", status: 400 }] },
  { name: "401", code: "rejected", replies: () => [{ kind: "status", status: 401 }] },
  { name: "403", code: "rejected", replies: () => [{ kind: "status", status: 403 }] },
  { name: "404", code: "unknown", replies: () => [{ kind: "status", status: 404 }] },
  { name: "418", code: "unknown", replies: () => [{ kind: "status", status: 418 }] },
  {
    name: "200 med ugyldig JSON",
    code: "unknown",
    replies: () => [{ kind: "raw", status: 200, body: `{ikke json ${PROVIDER_MESSAGE_MARK}` }],
  },
  {
    name: "200 uten content",
    code: "unknown",
    replies: () => [{ kind: "ok", omit: ["content"] }],
  },
  {
    name: "200 der content ikke er en liste",
    code: "unknown",
    replies: () => [{ kind: "ok", content: `tekst ${PROVIDER_MESSAGE_MARK}` }],
  },
  {
    name: "200 avkortet på grensen for tokens ut",
    code: "unknown",
    replies: () => [{ kind: "ok", text: "Taket er gammelt og har", stopReason: "max_tokens" }],
  },
  { name: "200 uten usage", code: "unknown", replies: () => [{ kind: "ok", omit: ["usage"] }] },
  {
    name: "200 med usage uten tall",
    code: "unknown",
    replies: () => [{ kind: "ok", usage: { input_tokens: "120", output_tokens: null } }],
  },
  {
    name: "200 med negative tokens",
    code: "unknown",
    replies: () => [{ kind: "ok", usage: { input_tokens: -1, output_tokens: 40 } }],
  },
  {
    name: "200 med oppgitt lengde over grensen",
    code: "unknown",
    replies: () => [
      {
        kind: "raw",
        status: 200,
        body: JSON.stringify(okMessage()),
        headers: {
          "content-type": "application/json",
          "content-length": String(constants().maxResponse + 1),
        },
      },
    ],
  },
  {
    name: "200 med strøm uten lengde som blir for lang",
    code: "unknown",
    replies: () => [
      {
        kind: "raw",
        status: 200,
        body: longStream(constants().maxResponse + 64 * 1024),
        headers: { "content-type": "application/json" },
      },
    ],
  },
];

describe("Anthropic-adapteren: feil gir faste koder (1.3, A3)", () => {
  it.each(ERROR_CASES)(
    "$name gir $code, uten merke eller nøkkel, og ett kall",
    async (testCase) => {
      const spies = consoleSpies();
      const { provider, calls } = withReplies(testCase.replies(), testCase.extra);

      let result: AiProviderResult | undefined;
      let thrown: unknown;
      try {
        result = await provider.complete(request());
      } catch (error) {
        thrown = error;
      }

      // Adapteren gir et resultat med fast kode, ingen unntak (ellers blir alt `unknown` i tjenesten)
      expect(thrown, String(thrown)).toBeUndefined();
      expect(result).toEqual({ outcome: "error", errorCode: testCase.code });
      expect(hasSecretOrMark(JSON.stringify(result))).toBe(false);
      expect(hasSecretOrMark(inspect(result, { depth: 8, showHidden: true }))).toBe(false);
      expect(hasSecretOrMark(consoleText(spies))).toBe(false);
      expect(calls).toHaveLength(1);
    },
  );

  it("1.3.1 koden er alltid en av AI_ERROR_CODES", async () => {
    const { AI_ERROR_CODES } = await import("@/db/schema");
    for (const testCase of ERROR_CASES) {
      expect(AI_ERROR_CODES as readonly string[], testCase.name).toContain(testCase.code);
    }
  });

  it("1.3.2 avkortet svar gir aldri tekst, selv om tekstblokken finnes", async () => {
    const { provider } = withReplies([
      { kind: "ok", text: "Taket er gammelt og har", stopReason: "max_tokens" },
    ]);
    const result = await provider.complete(request());
    expect(result.outcome).toBe("error");
    expect(Object.keys(result)).not.toContain("text");
    expect(JSON.stringify(result)).not.toContain("Taket er gammelt");
  });

  it("1.3.3 tidsavbrudd avbryter kallet (signal.aborted)", async () => {
    const { provider, calls } = withReplies([{ kind: "hang" }], { timeoutMs: TIMEOUT_MS });
    const result = await provider.complete(request());
    expect(result).toEqual({ outcome: "error", errorCode: "timeout" });
    expect(calls[0]!.signal?.aborted).toBe(true);
  });

  it("1.3 feilkroppen fra leverandøren har både merket og nøkkelen (kontroll av testdataene)", () => {
    expect(hasSecretOrMark(JSON.stringify(providerErrorBody()))).toBe(true);
  });
});
