import type { AiErrorCode } from "@/db/schema";
import { PII_PLACEHOLDERS } from "@/shared/lib/pii-patterns";
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
 * - `override_summary`: et fast svar laget av tallene i grunnlaget (måneden, antall rapporter og
 *   de to første linjene), bare med tall, etiketter og punktnavn som står der.
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

// --- override_summary ----------------------------------------------------------------------------

/** Verdien etter «Navn: » i en linje fra grunnlaget, eller `null`. */
function headerValue(lines: readonly string[], name: string): string | null {
  const prefix = `${name}: `;
  const line = lines.find((entry) => entry.startsWith(prefix));
  return line === undefined ? null : line.slice(prefix.length).trim();
}

/** Linjen for én sperre, kontrollpunkt og grunn som felt («Rapporter» → «7»). */
function rowFields(line: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const part of line.replace(/^- /u, "").split(" | ")) {
    const at = part.indexOf(": ");
    if (at > 0) fields.set(part.slice(0, at), part.slice(at + 2));
  }
  return fields;
}

function reports(count: string): string {
  return count === "1" ? "1 rapport" : `${count} rapporter`;
}

/** Én setning per linje: antall, andel når den er regnet, endring og reklamasjoner. */
function overrideSentence(fields: Map<string, string>): string {
  const check = fields.get("Sperre") ?? "";
  const point = fields.get("Punkt") ?? "";
  const reason = fields.get("Grunn") ?? "";
  const count = fields.get("Rapporter") ?? "";
  const share = fields.get("Andel") ?? "";
  const previous = fields.get("Rapporter måneden før") ?? "";
  const change = fields.get("Endring i rapporter") ?? "";
  const claims = fields.get("Reklamasjon på samme punkt") ?? "0";
  let sentence = `${check} (${point}) ble krysset bort med «${reason}» i ${reports(count)}`;
  if (/^\d+ %$/u.test(share)) sentence += `, ${share} av rapportene som ble publisert`;
  if (previous === "0") sentence += ", og fantes ikke måneden før";
  else if (change.startsWith("opp")) sentence += `, opp fra ${previous} måneden før`;
  else if (change.startsWith("ned")) sentence += `, ned fra ${previous} måneden før`;
  else sentence += ", som måneden før";
  if (claims !== "0") sentence += `. ${claims} av dem fikk reklamasjon på samme punkt`;
  return `${sentence}.`;
}

/** Fast svar for `override_summary`: høyst fem setninger, bare med det som står i grunnlaget. */
function overrideSummary(input: string): string {
  const lines = input.split("\n");
  const month = headerValue(lines, "Måned") ?? "";
  const count = headerValue(lines, "Rapporter publisert") ?? "";
  const rows = lines.filter((line) => line.startsWith("- Sperre: ")).slice(0, 2);
  const opening = `I ${month} ble ${reports(count)} publisert.`;
  if (rows.length === 0) return `${opening} Ingen sperrer ble krysset bort.`;
  return [opening, ...rows.map((line) => overrideSentence(rowFields(line)))].join(" ");
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
    else if (request.feature === "override_summary") {
      text = withTriggers(overrideSummary(input), input);
    }
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
