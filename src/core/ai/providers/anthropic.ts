import type { AiErrorCode } from "@/db/schema";
import type { AnthropicSettings } from "@/core/integrations/connections";
import { PROMPT_INPUT_SEPARATOR } from "../features";
import type { AiProvider, AiProviderRequest, AiProviderResult } from "./types";

/*
 * Anthropic-adapteren bak KI-porten (docs/adr/0006-ki-i-bunnen.md del 2,
 * docs/funksjoner/fase2a-ki-leverandor.md Omfang 4).
 *
 * Kontrakten:
 * - Adressen er en fast konstant her, aldri fra `settings`, miljø eller forespørsel.
 * - Nøkkelen ligger bare i lukningen og sendes bare i hodet `x-api-key`. Navnet på hemmeligheten
 *   (`REQUIRED_SECRET_REF_BY_PROVIDER` i `@/core/integrations/connections`) trengs ikke her:
 *   adapteren får `apiKey` fra `provider-resolution.ts`, som er eneste sted hemmeligheten leses.
 * - Kroppen har bare modell, grense for tokens ut og den vaskede ledeteksten. Ingen id-er.
 * - Ingen nye forsøk, ingen logging av forespørsel, svar eller leverandørens melding. Feil gir
 *   bare faste koder; feilobjektet fra `fetch` og feilkroppen leses ikke og sendes ikke videre.
 * - Modell-id står bare i tilkoblingens `settings.model`, aldri i koden.
 */

/** Fast kode i `PROVIDERS_BY_PORT.ai`. Endres aldri, arkiveres (regel 6). */
export const ANTHROPIC_PROVIDER_CODE = "anthropic";

/** Meldings-API-et. Fast, aldri fra innstillinger, miljø eller forespørsel. */
export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
/** Versjonen av API-et adapteren er skrevet mot (hodet `anthropic-version`). */
export const ANTHROPIC_API_VERSION = "2023-06-01";
/** Fast øvre grense for tokens ut per kall. Språkvask av korte tekster trenger langt mindre. */
export const ANTHROPIC_MAX_OUTPUT_TOKENS = 2048;
/** Standard tidsgrense for hele kallet (svar og lesing av kroppen). */
export const ANTHROPIC_DEFAULT_TIMEOUT_MS = 30_000;
/** Største svar som leses (byte). Større svar gir `unknown`. */
export const ANTHROPIC_MAX_RESPONSE_BYTES = 256 * 1024;

/**
 * Pris fra tilkoblingens `settings.pricing`, lagt inn av admin. Utledet av skjemaet i
 * `connections.ts` (én kilde). Kostnad = tokens × pris / 1 000 000, i NOK, rundet til fire
 * desimaler (`ai_usage_log.cost` er `numeric(12,4)`), aldri negativ og aldri `NaN`.
 */
export type AiPricing = AnthropicSettings["pricing"];

export type AnthropicProviderOptions = {
  /** Fra `settings.model`. */
  model: string;
  /** Lest av `provider-resolution.ts`. Blir aldri et felt på objektet som returneres. */
  apiKey: string;
  pricing: AiPricing;
  /** Standard er den innebygde. Testene sender inn falsk HTTP. */
  fetch?: typeof fetch;
  timeoutMs?: number;
};

/** Svar som stopper av disse grunnene, blir aldri et forslag (avkortet eller avslått). */
const REJECTED_STOP_REASONS: ReadonlySet<string> = new Set(["max_tokens", "refusal"]);

type Usage = { tokensIn: number; tokensOut: number };

function fail(errorCode: AiErrorCode): AiProviderResult {
  return { outcome: "error", errorCode };
}

/** Fast kode for en HTTP-status som ikke er vellykket. */
export function anthropicErrorCodeForStatus(status: number): AiErrorCode {
  if (status === 429) return "rate_limited";
  if (status >= 500 && status <= 599) return "unavailable";
  if (status === 400 || status === 401 || status === 403) return "rejected";
  return "unknown";
}

/** Kostnad i NOK, rundet til fire desimaler. `null` hvis tallet ikke kan brukes. */
export function anthropicCost(usage: Usage, pricing: AiPricing): number | null {
  const raw =
    (usage.tokensIn * pricing.inputPerMillion) / 1_000_000 +
    (usage.tokensOut * pricing.outputPerMillion) / 1_000_000;
  const rounded = Math.round(raw * 10_000) / 10_000;
  if (!Number.isFinite(rounded) || rounded < 0) return null;
  // Unngår «-0»
  return rounded === 0 ? 0 : rounded;
}

function isTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Teksten fra den ansatte: det som står etter skillet, eller hele ledeteksten. */
function inputOf(prompt: string): string {
  const index = prompt.lastIndexOf(PROMPT_INPUT_SEPARATOR);
  return index === -1 ? prompt : prompt.slice(index + PROMPT_INPUT_SEPARATOR.length);
}

/** Avbryter lesingen av en kropp vi ikke skal bruke. Feil her betyr ingenting. */
async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Kroppen leses aldri; feilen sendes ikke videre
  }
}

/** Leser kroppen med en grense på størrelse. `null` når svaret er for stort. */
async function readLimited(response: Response, maxBytes: number): Promise<string | null> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isFinite(length) || length < 0 || length > maxBytes) {
      await discardBody(response);
      return null;
    }
  }
  const body = response.body;
  if (body === null) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // Ingen detaljer videre
      }
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** Tolker et vellykket svar. Alt som ikke har forventet form, gir `unknown`. */
function parseSuccess(
  raw: string,
  request: AiProviderRequest,
  pricing: AiPricing,
): AiProviderResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return fail("unknown");
  }
  if (!isRecord(data) || !Array.isArray(data.content)) return fail("unknown");

  const stopReason = data.stop_reason;
  if (stopReason !== undefined && stopReason !== null && typeof stopReason !== "string") {
    return fail("unknown");
  }
  if (typeof stopReason === "string" && REJECTED_STOP_REASONS.has(stopReason)) {
    return fail("unknown");
  }

  const usage = data.usage;
  if (!isRecord(usage)) return fail("unknown");
  const tokensIn = usage.input_tokens;
  const tokensOut = usage.output_tokens;
  if (!isTokenCount(tokensIn) || !isTokenCount(tokensOut)) return fail("unknown");

  let text = "";
  for (const block of data.content) {
    if (!isRecord(block)) return fail("unknown");
    if (block.type !== "text") continue;
    if (typeof block.text !== "string") return fail("unknown");
    text += block.text;
  }

  const cost = anthropicCost({ tokensIn, tokensOut }, pricing);
  if (cost === null) return fail("unknown");
  const currency = pricing.currency;

  // «Ingen endring»: tomt svar, eller samme tekst som den ansatte sendte inn
  const trimmed = text.trim();
  if (trimmed === "" || trimmed === inputOf(request.prompt).trim()) {
    return { outcome: "no_match", tokensIn, tokensOut, cost, currency };
  }
  return { outcome: "ok", text: trimmed, tokensIn, tokensOut, cost, currency };
}

const TIMED_OUT = Symbol("timed-out");

/**
 * Lager adapteren for én tilkobling. Returnerer en `AiProvider` med `code = "anthropic"` og
 * `model` fra `options`. Feil gir bare faste koder: tidsavbrudd → `timeout`, 429 →
 * `rate_limited`, 5xx og nettverksfeil → `unavailable`, 400/401/403 → `rejected`, alt annet
 * (også avkortet svar, ugyldig form og for stort svar) → `unknown`.
 */
export function createAnthropicProvider(options: AnthropicProviderOptions): AiProvider {
  const { model, apiKey, pricing } = options;
  const injectedFetch = options.fetch;
  const timeoutMs =
    options.timeoutMs !== undefined && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : ANTHROPIC_DEFAULT_TIMEOUT_MS;

  async function call(request: AiProviderRequest, signal: AbortSignal): Promise<AiProviderResult> {
    // Slås opp ved kallet, så en stubbet global brukes i testene
    const doFetch = injectedFetch ?? globalThis.fetch;
    let response: Response;
    try {
      response = await doFetch(ANTHROPIC_MESSAGES_URL, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_API_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: ANTHROPIC_MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: request.prompt }],
        }),
        redirect: "error",
        cache: "no-store",
        signal,
      });
    } catch {
      // Nettverksfeil og videresending. Feilobjektet brukes ikke.
      return fail(signal.aborted ? "timeout" : "unavailable");
    }

    if (!response.ok) {
      // Leverandørens melding leses aldri
      await discardBody(response);
      return fail(anthropicErrorCodeForStatus(response.status));
    }

    let raw: string | null;
    try {
      raw = await readLimited(response, ANTHROPIC_MAX_RESPONSE_BYTES);
    } catch {
      return fail(signal.aborted ? "timeout" : "unavailable");
    }
    if (raw === null) return fail("unknown");
    return parseSuccess(raw, request, pricing);
  }

  async function complete(request: AiProviderRequest): Promise<AiProviderResult> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(TIMED_OUT);
      }, timeoutMs);
    });
    try {
      const result = await Promise.race([call(request, controller.signal), deadline]);
      return result === TIMED_OUT ? fail("timeout") : result;
    } catch {
      return fail("unknown");
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    code: ANTHROPIC_PROVIDER_CODE,
    model,
    complete,
  };
}
