import type { AiProvider, AiProviderRequest, AiProviderResult } from "../types";

/*
 * Falsk leverandør (ADR 0006 del 3): forutsigbare svar, null kostnad, ingen nettverkskall.
 * Brukes i utvikling, test, CI og testmiljøet. Samme inndata gir alltid samme svar, og ulik
 * inndata gir ulikt svar. De faste prøveverdiene gir «ingen treff» og feil, så alle utfall kan
 * prøves.
 */

export const FAKE_PROVIDER_CODE = "fake";
export const FAKE_MODEL = "fake-v1";

/** Tekst som inneholder denne verdien, gir `no_match`. */
export const FAKE_NO_MATCH_INPUT = "__fake_no_match__";
/** Tekst som inneholder denne verdien, gir `error` med koden `unavailable`. */
export const FAKE_ERROR_INPUT = "__fake_error__";

/** Ledeteksten er funksjonens faste tekst, en tom linje, og så feltverdien. */
function inputFromPrompt(prompt: string): string {
  const split = prompt.indexOf("\n\n");
  return split === -1 ? prompt : prompt.slice(split + 2);
}

/** Enkel, forutsigbar «språkvask»: rydder mellomrom, stor forbokstav og punktum til slutt. */
function polish(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed === "") return "";
  const capitalized = collapsed.charAt(0).toLocaleUpperCase("nb-NO") + collapsed.slice(1);
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export const fakeAiProvider: AiProvider = {
  code: FAKE_PROVIDER_CODE,
  async complete(request: AiProviderRequest): Promise<AiProviderResult> {
    const tokensIn = estimateTokens(request.prompt);
    if (request.prompt.includes(FAKE_ERROR_INPUT)) {
      return { outcome: "error", errorCode: "unavailable" };
    }
    const text = polish(inputFromPrompt(request.prompt));
    if (request.prompt.includes(FAKE_NO_MATCH_INPUT) || text === "") {
      return { outcome: "no_match", tokensIn, tokensOut: 0, cost: 0, currency: "NOK" };
    }
    return {
      outcome: "ok",
      text,
      tokensIn,
      tokensOut: estimateTokens(text),
      cost: 0,
      currency: "NOK",
    };
  },
};
