import type { AiProvider } from "./types";

/*
 * Anthropic-adapteren bak KI-porten (docs/adr/0006-ki-i-bunnen.md del 2,
 * docs/funksjoner/fase2a-ki-leverandor.md Omfang 4). Denne filen er grensesnittet utviklerne
 * bygger mot: faste koder, typer og signatur. Kroppen bygges av utvikler.
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

/**
 * Lager adapteren for én tilkobling. Returnerer en `AiProvider` med `code = "anthropic"` og
 * `model` fra `options`. Feil gir bare faste koder: tidsavbrudd → `timeout`, 429 →
 * `rate_limited`, 5xx og nettverksfeil → `unavailable`, 400/401/403 → `rejected`, alt annet
 * (også avkortet svar, ugyldig form og for stort svar) → `unknown`.
 */
export function createAnthropicProvider(options: AnthropicProviderOptions): AiProvider {
  void options;
  throw new Error("Anthropic-adapteren er ikke bygget ennå.");
}
