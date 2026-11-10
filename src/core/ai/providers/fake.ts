import type { AiErrorCode } from "@/db/schema";
import { PROMPT_INPUT_SEPARATOR } from "../features";
import type { AiProvider, AiProviderRequest, AiProviderResult } from "./types";

/*
 * Den falske leverandøren (docs/adr/0006-ki-i-bunnen.md del 3). Forutsigbare svar, null kostnad
 * og ingen nettverkskall. Brukes i utvikling, test, CI og testmiljøet, slik at alt kan bygges og
 * prøves uten kostnad og uten at data sendes ut. Faste prøveverdier gir «ingen treff» og feil.
 */

/** Teksten (eller en del av den) som gir utfallet `no_match`. */
export const FAKE_NO_MATCH_INPUT = "[fake: ingen treff]";
/** Teksten (eller en del av den) som gir utfallet `error` med `FAKE_ERROR_CODE`. */
export const FAKE_ERROR_INPUT = "[fake: feil]";
/** Feilkoden `fake` gir for `FAKE_ERROR_INPUT`. */
export const FAKE_ERROR_CODE: AiErrorCode = "unavailable";

export const FAKE_MODEL = "fake-v1";

const CURRENCY = "NOK";

/** Grovt anslag på mengde, bare så tallene ikke er tomme. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Teksten fra den ansatte: det som står etter skillet, eller hele ledeteksten. */
function inputOf(prompt: string): string {
  const index = prompt.lastIndexOf(PROMPT_INPUT_SEPARATOR);
  return index === -1 ? prompt : prompt.slice(index + PROMPT_INPUT_SEPARATOR.length);
}

/** Forutsigbar «språkvask»: rydder mellomrom, stor forbokstav og punktum til slutt. */
function polish(input: string): string {
  const trimmed = input.replace(/[ \t]+/g, " ").trim();
  const capitalized = trimmed.charAt(0).toLocaleUpperCase("nb-NO") + trimmed.slice(1);
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

export const fakeAiProvider: AiProvider = {
  code: "fake",
  model: FAKE_MODEL,
  async complete(request: AiProviderRequest): Promise<AiProviderResult> {
    const input = inputOf(request.prompt);
    if (input.includes(FAKE_ERROR_INPUT)) {
      return { outcome: "error", errorCode: FAKE_ERROR_CODE };
    }
    const tokensIn = estimateTokens(request.prompt);
    if (input.includes(FAKE_NO_MATCH_INPUT) || input.trim() === "") {
      return { outcome: "no_match", tokensIn, tokensOut: 0, cost: 0, currency: CURRENCY };
    }
    const text = polish(input);
    return {
      outcome: "ok",
      text,
      tokensIn,
      tokensOut: estimateTokens(text),
      cost: 0,
      currency: CURRENCY,
    };
  },
};
