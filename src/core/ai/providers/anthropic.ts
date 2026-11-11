import type { AiErrorCode } from "@/db/schema";
import { PROMPT_INPUT_SEPARATOR } from "../features";
import { FAKE_NO_MATCH_INPUT } from "./fake";
import type { AiProvider, AiProviderRequest, AiProviderResult } from "./types";

/*
 * Anthropic-adapteren bak KI-porten (docs/adr/0006-ki-i-bunnen.md del 2,
 * docs/funksjoner/fase2a-ki-leverandor.md Omfang 4). Innebygd `fetch`, ingen SDK.
 *
 * Kontrakten:
 * - Adressen er en fast konstant her, aldri fra `settings`, miljø eller forespørsel.
 * - Nøkkelen ligger bare i lukningen og sendes bare i hodet `x-api-key`.
 * - Kroppen har bare modell, grense for tokens ut og den vaskede ledeteksten. Ingen id-er.
 * - Ingen nye forsøk, ingen logging av forespørsel, svar eller leverandørens melding.
 * - Modell-id står bare i tilkoblingens `settings.model`, aldri i koden.
 */

/** Fast kode i `PROVIDERS_BY_PORT.ai`. Endres aldri, arkiveres (regel 6). */
export const ANTHROPIC_PROVIDER_CODE = "anthropic";

/** Det eneste navnet på hemmeligheten som tilkoblingen `anthropic` kan peke på. */
export const ANTHROPIC_SECRET_REF = "ANTHROPIC_API_KEY";

/** Fast adresse til meldings-API-et. Kommer aldri fra `settings`, miljø eller forespørsel. */
export const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

/** Verdien i hodet `anthropic-version`. */
export const ANTHROPIC_API_VERSION = "2023-06-01";

/** Fast øvre grense for tokens ut per kall. Et svar som stopper her, gir `unknown`. */
export const ANTHROPIC_MAX_OUTPUT_TOKENS = 2048;

/** Standard tidsgrense for hele kallet (svar og lesing av kroppen). */
export const ANTHROPIC_DEFAULT_TIMEOUT_MS = 30_000;

/** Største svar som leses (bytes). Større svar gir `unknown`. */
export const ANTHROPIC_MAX_RESPONSE_BYTES = 256 * 1024;

/** Pris fra tilkoblingens `settings.pricing`, lagt inn av admin. Kostnad = tokens × pris / 1 000 000. */
export type AiPricing = {
  inputPerMillion: number;
  outputPerMillion: number;
  currency: "NOK";
};

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

const CURRENCY = "NOK";

/** Stoppårsakene som betyr at svaret er helt. Alt annet (også avkortet svar) gir `unknown`. */
const COMPLETE_STOP_REASONS: ReadonlySet<string> = new Set(["end_turn", "stop_sequence"]);

const TIMED_OUT = Symbol("timeout");

/** Intern feil med fast kode. Brukes bare inne i adapteren og blir alltid til et feilresultat. */
class AdapterFailure {
  constructor(readonly code: AiErrorCode) {}
}

function fail(code: AiErrorCode): never {
  throw new AdapterFailure(code);
}

function errorResult(code: AiErrorCode): AiProviderResult {
  return { outcome: "error", errorCode: code };
}

/** Fast kode for en statuskode som ikke er vellykket. */
function codeForStatus(status: number): AiErrorCode {
  if (status === 429) return "rate_limited";
  if (status >= 500 && status <= 599) return "unavailable";
  if (status === 400 || status === 401 || status === 403) return "rejected";
  return "unknown";
}

/** Kaster kroppen uten å lese den (leverandørens melding skal aldri brukes). */
function discardBody(response: Response): void {
  response.body?.cancel().catch(() => undefined);
}

/** Leser kroppen med teller. For stort svar, med eller uten oppgitt lengde, gir `unknown`. */
async function readLimitedText(response: Response): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isFinite(length) || length < 0 || length > ANTHROPIC_MAX_RESPONSE_BYTES) {
      discardBody(response);
      fail("unknown");
    }
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > ANTHROPIC_MAX_RESPONSE_BYTES) {
      reader.cancel().catch(() => undefined);
      fail("unknown");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Tolker svaret. Ugyldig JSON, uventet form, avkortet svar eller ugyldige tall gir `unknown`. */
function parseMessage(raw: string): { text: string; tokensIn: number; tokensOut: number } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    fail("unknown");
  }
  if (!isRecord(data) || !Array.isArray(data.content)) fail("unknown");
  if (typeof data.stop_reason !== "string" || !COMPLETE_STOP_REASONS.has(data.stop_reason)) {
    fail("unknown");
  }
  const usage = data.usage;
  if (!isRecord(usage) || !isTokenCount(usage.input_tokens) || !isTokenCount(usage.output_tokens)) {
    fail("unknown");
  }
  const parts: string[] = [];
  for (const block of data.content as unknown[]) {
    if (!isRecord(block) || typeof block.type !== "string") fail("unknown");
    if (block.type !== "text") continue;
    if (typeof block.text !== "string") fail("unknown");
    parts.push(block.text);
  }
  return { text: parts.join(""), tokensIn: usage.input_tokens, tokensOut: usage.output_tokens };
}

/** Teksten fra den ansatte: det som står etter skillet, eller hele ledeteksten. */
function inputOf(prompt: string): string {
  const index = prompt.lastIndexOf(PROMPT_INPUT_SEPARATOR);
  return index === -1 ? prompt : prompt.slice(index + PROMPT_INPUT_SEPARATOR.length);
}

/**
 * «Ingen treff» med samme regel som den falske leverandøren: tomt svar (eller bare mellomrom),
 * eller prøveverdien for ingen treff. I tillegg: svaret er lik teksten som ble sendt (ingen endring).
 */
function isNoMatch(text: string, prompt: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed === "" || trimmed.includes(FAKE_NO_MATCH_INPUT) || trimmed === inputOf(prompt).trim()
  );
}

/**
 * Lager adapteren for én tilkobling. Returnerer en `AiProvider` med `code = "anthropic"` og
 * `model` fra `options`. Feil gir bare faste koder: tidsavbrudd → `timeout`, 429 →
 * `rate_limited`, 5xx og nettverksfeil → `unavailable`, 400/401/403 → `rejected`, alt annet
 * (også avkortet svar, ugyldig form og for stort svar) → `unknown`. Kaster aldri.
 */
export function createAnthropicProvider(options: AnthropicProviderOptions): AiProvider {
  // Nøkkelen og prisen ligger bare i lukningen, aldri som felt på objektet som returneres.
  const { model, apiKey, pricing } = options;
  const timeoutMs = options.timeoutMs ?? ANTHROPIC_DEFAULT_TIMEOUT_MS;

  async function call(prompt: string, signal: AbortSignal): Promise<AiProviderResult> {
    // Slås opp ved kallet, så `vi.stubGlobal("fetch", …)` virker i testene.
    const doFetch = options.fetch ?? globalThis.fetch;
    let response: Response;
    try {
      response = await doFetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_API_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: ANTHROPIC_MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: prompt }],
        }),
        redirect: "error",
        cache: "no-store",
        signal,
      });
    } catch {
      // Nettverksfeil og videresending. Feilobjektet brukes ikke (det kan ha detaljer).
      return errorResult(signal.aborted ? "timeout" : "unavailable");
    }
    if (response.status !== 200) {
      discardBody(response);
      return errorResult(codeForStatus(response.status));
    }
    const { text, tokensIn, tokensOut } = parseMessage(await readLimitedText(response));
    const cost =
      (tokensIn * pricing.inputPerMillion + tokensOut * pricing.outputPerMillion) / 1_000_000;
    if (isNoMatch(text, prompt)) {
      return { outcome: "no_match", tokensIn, tokensOut, cost, currency: CURRENCY };
    }
    return { outcome: "ok", text, tokensIn, tokensOut, cost, currency: CURRENCY };
  }

  async function complete(request: AiProviderRequest): Promise<AiProviderResult> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(TIMED_OUT);
      }, timeoutMs);
    });
    try {
      const result = await Promise.race([call(request.prompt, controller.signal), timedOut]);
      return result === TIMED_OUT ? errorResult("timeout") : result;
    } catch (error) {
      if (controller.signal.aborted) return errorResult("timeout");
      return errorResult(error instanceof AdapterFailure ? error.code : "unknown");
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({ code: ANTHROPIC_PROVIDER_CODE, model, complete });
}
