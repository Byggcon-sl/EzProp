import type { AiErrorCode } from "@/db/schema";
import { OUTCOME_MATCH_MAX } from "@/shared/config/ai-targets";
import { PII_PLACEHOLDERS } from "@/shared/lib/pii-patterns";
import { rankBySimilarity, SIMILARITY_MIN_SCORE } from "@/shared/lib/text-similarity";
import { PROMPT_INPUT_SEPARATOR } from "../features";
import type { AiProvider, AiProviderRequest, AiProviderResult } from "./types";

/*
 * Den falske leverandøren (docs/adr/0006-ki-i-bunnen.md del 3). Forutsigbare svar, null kostnad
 * og ingen nettverkskall. Brukes i utvikling, test, CI og testmiljøet, slik at alt kan bygges og
 * prøves uten kostnad og uten at data sendes ut. Samme inndata gir alltid samme svar.
 *
 * Per funksjon (docs/funksjoner/fase2a-ki-i-veien.md «Falsk leverandør»):
 * - `language_polish`: rydder mellomrom, stor forbokstav og punktum til slutt.
 * - `phrase_suggest`: leser merkene K1…Kn fra ledeteksten og rangerer etter ordlikhet med det
 *   den ansatte har skrevet, med en fast grense for «ingen passer» (svarer «INGEN»). Tomt felt gir
 *   kandidatene i rekkefølgen de kom (kandidatkilden har allerede sortert dem).
 * - `summary_draft`: én linje per F-merke, satt sammen av funnets egne tekster.
 * - `outcome_match`: leser notatet og merkene K1…Kn fra ledeteksten og rangerer med den samme
 *   rene likhetsfunksjonen og grensen som «Nærmeste treff (uten KI)» (`rankBySimilarity` og
 *   `SIMILARITY_MIN_SCORE` fra `@/shared/lib/text-similarity`, A561). Høyst `OUTCOME_MATCH_MAX`
 *   merker, ellers «ingen». TG i notatet endrer aldri rekkefølgen.
 *
 * Faste prøveverdier gir «ingen treff», feil, og svar som vaktene i kjernen skal stoppe, slik at
 * testene kan provosere hvert utfall. Prøveverdiene har ingen sifre og ingen TG, så de ikke selv
 * slår ut i vaktene.
 */

/** Teksten (eller en del av den) som gir utfallet `no_match`. */
export const FAKE_NO_MATCH_INPUT = "[fake: ingen treff]";
/** Teksten (eller en del av den) som gir utfallet `error` med `FAKE_ERROR_CODE`. */
export const FAKE_ERROR_INPUT = "[fake: feil]";
/** Feilkoden `fake` gir for `FAKE_ERROR_INPUT`. */
export const FAKE_ERROR_CODE: AiErrorCode = "unavailable";
/** Svaret får en TG som ikke ble sendt (språkvask, og funnet i sammendraget). */
export const FAKE_ADD_TG_INPUT = "[fake: legg til TG]";
/** Svaret får et tall som ikke ble sendt (språkvask, og funnet i sammendraget). */
export const FAKE_ADD_NUMBER_INPUT = "[fake: legg til tall]";
/** Funnet med denne teksten mangler i svaret til sammendraget. */
export const FAKE_DROP_FINDING_INPUT = "[fake: hopp over funn]";
/** Den første plassholderen fra vasken tas bort fra svaret. */
export const FAKE_DROP_PLACEHOLDER_INPUT = "[fake: fjern plassholder]";
/** Svaret til `phrase_suggest` får ukjente og doble merker i tillegg til de gyldige. */
export const FAKE_BAD_LABELS_INPUT = "[fake: rare merker]";

/** TG-en og tallet prøveverdiene legger til. */
export const FAKE_ADDED_TG = "TG3";
export const FAKE_ADDED_NUMBER = "4711";

/**
 * Laveste andel av ordene i feltet som må stå i kandidaten for at den skal passe. Under grensen
 * for alle kandidater svarer leverandøren «INGEN».
 */
export const FAKE_PHRASE_MIN_SCORE = 0.25;

export const FAKE_MODEL = "fake-v1";

const CURRENCY = "NOK";
const MAX_RANKED = 5;

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

/** Legger til det prøveverdiene i teksten ber om. */
function withTriggers(text: string, source: string): string {
  let out = text;
  if (source.includes(FAKE_ADD_TG_INPUT)) out = `${out} Satt til ${FAKE_ADDED_TG}.`;
  if (source.includes(FAKE_ADD_NUMBER_INPUT)) out = `${out} Målt ${FAKE_ADDED_NUMBER}.`;
  if (source.includes(FAKE_DROP_PLACEHOLDER_INPUT)) {
    for (const placeholder of PII_PLACEHOLDERS) {
      const at = out.indexOf(placeholder);
      if (at !== -1) {
        out = out.slice(0, at) + out.slice(at + placeholder.length);
        break;
      }
    }
  }
  return out;
}

/** Ordene i teksten, små bokstaver, minst tre tegn. */
function words(text: string): Set<string> {
  return new Set(
    (text.toLocaleLowerCase("nb-NO").match(/\p{L}{3,}/gu) ?? []).filter((word) => word !== ""),
  );
}

/** Rangering for `phrase_suggest`: merkene, de mest like først, skilt med komma. */
function rankCandidates(input: string): string {
  const lines = input.split("\n");
  const fieldLine = lines.find((line) => line.startsWith("text: "));
  const query = words(fieldLine ? fieldLine.slice("text: ".length) : "");
  const candidates: { label: string; score: number; order: number }[] = [];
  lines.forEach((line, order) => {
    const match = /^(K[1-9]\d*): (.*)$/u.exec(line);
    if (!match) return;
    const candidateWords = words(match[2] ?? "");
    let shared = 0;
    for (const word of query) if (candidateWords.has(word)) shared += 1;
    const score = query.size === 0 ? 1 : shared / query.size;
    candidates.push({ label: match[1] as string, score, order });
  });
  const ranked = candidates
    .filter((candidate) => candidate.score >= FAKE_PHRASE_MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, MAX_RANKED)
    .map((candidate) => candidate.label);
  if (ranked.length === 0) return "INGEN";
  if (input.includes(FAKE_BAD_LABELS_INPUT)) {
    return [...ranked, "K99", ranked[0], "tekst"].join(", ");
  }
  return ranked.join(", ");
}

/** Rangering for `outcome_match`: høyst tre merker etter likhet med notatet, eller «ingen». */
function matchOutcomes(input: string): string {
  const lines = input.split("\n");
  const noteLine = lines.find((line) => line.startsWith("text: "));
  const note = noteLine ? noteLine.slice("text: ".length) : "";
  const candidates: { label: string; text: string }[] = [];
  for (const line of lines) {
    const match = /^(K[1-9]\d*): (.*)$/u.exec(line);
    if (match) candidates.push({ label: match[1] as string, text: match[2] ?? "" });
  }
  const ranked = rankBySimilarity(note, candidates, (candidate) => candidate.text, {
    limit: OUTCOME_MATCH_MAX,
    minScore: SIMILARITY_MIN_SCORE,
  }).map((match) => match.item.label);
  if (ranked.length === 0) return "ingen";
  if (input.includes(FAKE_BAD_LABELS_INPUT)) {
    return [...ranked, "K99", ranked[0], "tekst"].join(", ");
  }
  return ranked.join(", ");
}

/** Utkast for `summary_draft`: én linje per F-merke med funnets egne tekster. */
function draftSummary(input: string): string {
  const out: string[] = [];
  for (const line of input.split("\n")) {
    const match = /^(F[1-9]\d*): (.*)$/u.exec(line);
    if (!match) continue;
    const [name = "", ...texts] = (match[2] ?? "").split(" | ");
    if (line.includes(FAKE_DROP_FINDING_INPUT)) continue;
    const body = polish(texts.length > 0 ? texts.join(" ") : name);
    out.push(`${match[1]}: ${withTriggers(body, line)}`);
  }
  return out.join("\n");
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
    let text: string;
    if (request.feature === "phrase_suggest") text = rankCandidates(input);
    else if (request.feature === "summary_draft") text = draftSummary(input);
    else if (request.feature === "outcome_match") text = matchOutcomes(input);
    else text = withTriggers(polish(input), input);
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
