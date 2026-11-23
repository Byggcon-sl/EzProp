import type { SummaryGroup } from "@/db/schema";
import { normalizeForRedaction } from "@/shared/lib/pii-patterns";
import { labelCandidates, type LabeledCandidate } from "./candidates";
import {
  buildPrompt,
  getPrompt,
  PROMPT_INPUT_SEPARATOR,
  type AiFeatureDefinition,
} from "./features";
import {
  compileKnownValues,
  redactFieldValues,
  redactTextTracked,
  type KnownValueMatcher,
  type KnownValues,
  type RedactedOriginal,
} from "./redact-text";
import type { AiCandidate, AiGuardAnswerPart, AiSummaryGroup } from "./types";

/*
 * Felles ledetekst (docs/funksjoner/fase2a-evalueringssett.md Omfang 2, og «KI i veien»). Både
 * `requestSuggestion` og kjøreren for evalueringssettet bygger ledeteksten her, så settet prøver
 * nøyaktig det ekte bruk sender. Ren: ingen database, ingen leverandør.
 *
 * Fast rekkefølge: rensing av tegn, så vask (kjente verdier og mønstrene), så ledeteksten av de
 * vaskede verdiene. Kaster vasken, lages ingen ledetekst.
 *
 * Instruksene står i `AI_PROMPTS` (features.ts). Etter skillet (`PROMPT_INPUT_SEPARATOR`) kommer
 * bare innhold, aldri instrukser. For `phrase_suggest` og `summary_draft` gjøres hver verdi om til
 * én linje før vask, så tekst fra den ansatte aldri kan se ut som et nytt merke (K…, F…, G…).
 *
 * De opprinnelige verdiene bak plassholderne (`originals`, A466) gis bare tilbake til kjernen, som
 * holder dem i minnet under kallet. De står aldri i ledeteksten.
 */

export type PreparedPrompt = {
  prompt: string;
  /** De vaskede feltene, det som faktisk sendes. Brukes til `input_summary`. */
  redactedFields: Record<string, string>;
  redactedCount: number;
  /** De opprinnelige verdiene bak plassholderne, per felt. Bare i minnet. */
  originals: Record<string, RedactedOriginal[]>;
};

function cleanFields(fields: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, normalizeForRedaction(value)]),
  );
}

/** Bygger ledeteksten av vaskede felt. Med `known = null` vaskes bare med mønstrene. */
export function preparePrompt(
  definition: AiFeatureDefinition,
  fields: Readonly<Record<string, string>>,
  known: KnownValues | null,
): PreparedPrompt {
  const redacted = redactFieldValues(cleanFields(fields), known);
  const prompt = buildPrompt(definition, redacted.fields);
  return {
    prompt,
    redactedFields: redacted.fields,
    redactedCount: redacted.count,
    originals: redacted.originals,
  };
}

const ANY_SPACE = /[\s    ]+/gu;

/** All slags mellomrom og linjeskift blir ett mellomrom. */
export function toOneLine(text: string): string {
  return normalizeForRedaction(text).replace(ANY_SPACE, " ").trim();
}

function instructionsFor(definition: AiFeatureDefinition): string {
  const instructions = getPrompt(definition.promptVersion);
  if (instructions === null) throw new Error("Ledeteksten mangler for funksjonen.");
  return instructions;
}

function matcherFor(known: KnownValues | null): KnownValueMatcher {
  return known === null ? null : compileKnownValues(known);
}

// --- phrase_suggest -----------------------------------------------------------------------------

/** Overskriften over kandidatene i innholdet. Den falske leverandøren leser merkene under den. */
export const PROMPT_CANDIDATES_HEADING = "Kandidater:";

export type PreparedCandidatePrompt = PreparedPrompt & {
  /** Merkene K1…Kn for dette kallet. Lagres aldri. */
  labeled: LabeledCandidate[];
  /** Antall plassholdere vasken satte inn i kandidattekstene. Inngår i `redactedCount`. */
  candidateRedactedCount: number;
};

/**
 * Ledeteksten for `phrase_suggest`: feltene på tillatt-listen som `kode: verdi`, så kandidatene
 * som `K1: tekst`. Hver kandidat vaskes for seg med de samme kjente verdiene som feltene.
 */
export function prepareCandidatePrompt(
  definition: AiFeatureDefinition,
  fields: Readonly<Record<string, string>>,
  candidates: readonly AiCandidate[],
  known: KnownValues | null,
): PreparedCandidatePrompt {
  const instructions = instructionsFor(definition);
  const matcher = matcherFor(known);
  const redactedFields: Record<string, string> = {};
  const originals: Record<string, RedactedOriginal[]> = {};
  let count = 0;
  for (const key of definition.allowedFields) {
    if (!Object.prototype.hasOwnProperty.call(fields, key)) continue;
    const result = redactTextTracked(toOneLine(fields[key] ?? ""), matcher);
    redactedFields[key] = result.text;
    originals[key] = result.originals;
    count += result.count;
  }
  const labeled = labelCandidates(candidates);
  let candidateCount = 0;
  const candidateLines = labeled.map(({ label, candidate }) => {
    const result = redactTextTracked(toOneLine(candidate.text), matcher);
    candidateCount += result.count;
    return `${label}: ${result.text}`;
  });
  const fieldLines = Object.entries(redactedFields).map(([key, value]) => `${key}: ${value}`);
  const content = [...fieldLines, PROMPT_CANDIDATES_HEADING, ...candidateLines].join("\n");
  return {
    prompt: `${instructions}${PROMPT_INPUT_SEPARATOR}${content}`,
    redactedFields,
    redactedCount: count + candidateCount,
    originals,
    labeled,
    candidateRedactedCount: candidateCount,
  };
}

// --- summary_draft ------------------------------------------------------------------------------

/** Skilletegnet mellom punktet og tekstene i en funnlinje («F1: punkt | tekst | tekst»). */
export const SUMMARY_PART_SEPARATOR = " | ";

/** Ett funn slik det ble sendt: merket, og de vaskede tekstene (punktets navn først). */
export type PreparedSummaryPart = {
  label: string;
  group: SummaryGroup;
  /** Punktets navn slik koden har det. Settes først i avsnittet (A462). */
  checkpointName: string;
  /** Punktets navn vasket, til `output_text`. */
  redactedCheckpointName: string;
  /** De vaskede tekstene som gikk til leverandøren, punktets navn først. */
  texts: string[];
  /** De opprinnelige verdiene bak plassholderne i alle tekstene, i rekkefølge. Bare i minnet. */
  originals: RedactedOriginal[];
};

/** En linje koden skriver selv (TGIU), i to utgaver: til klienten og vasket til `output_text`. */
export type PreparedFixedLine = {
  checkpointName: string;
  text: string;
  redactedCheckpointName: string;
  redactedText: string;
};

export type PreparedSummaryGroup = {
  group: SummaryGroup;
  heading: string;
  /** Merkene til funnene i gruppen, i rekkefølge. */
  labels: string[];
  fixedLines: PreparedFixedLine[];
};

export type PreparedSummaryPrompt = {
  prompt: string;
  redactedCount: number;
  parts: PreparedSummaryPart[];
  groups: PreparedSummaryGroup[];
  /** Antall tegn i alle funnene som sendes, etter vask. Sjekkes mot grensen i `limits.ts`. */
  inputLength: number;
};

/**
 * Ledeteksten for `summary_draft` (A434, A461, A462): funnene under nøytrale gruppemerker G1…Gn
 * (bare grupper med funn), hvert funn som `F1: punkt | tekster`. Overskriftene og TGIU-linjene
 * sendes aldri; de vaskes likevel her, så `output_text` ikke får nye personopplysninger.
 */
export function prepareSummaryPrompt(
  definition: AiFeatureDefinition,
  groups: readonly AiSummaryGroup[],
  known: KnownValues | null,
): PreparedSummaryPrompt {
  const instructions = instructionsFor(definition);
  const matcher = matcherFor(known);
  let count = 0;
  let inputLength = 0;
  let findingNumber = 0;
  let groupNumber = 0;
  const lines: string[] = [];
  const parts: PreparedSummaryPart[] = [];
  const prepared: PreparedSummaryGroup[] = [];

  for (const group of groups) {
    const labels: string[] = [];
    if (group.findings.length > 0) {
      groupNumber += 1;
      lines.push(`G${groupNumber}`);
    }
    for (const finding of group.findings) {
      findingNumber += 1;
      const label = `F${findingNumber}`;
      const raw = [
        finding.checkpointName,
        finding.deviationText,
        finding.causeText,
        finding.consequenceText,
        ...finding.measures,
      ]
        .map((value) => toOneLine(value ?? ""))
        .filter((value, index) => index === 0 || value !== "");
      const texts: string[] = [];
      const originals: RedactedOriginal[] = [];
      for (const value of raw) {
        const result = redactTextTracked(value, matcher);
        texts.push(result.text);
        originals.push(...result.originals);
        count += result.count;
        inputLength += result.text.length;
      }
      lines.push(`${label}: ${texts.join(SUMMARY_PART_SEPARATOR)}`);
      labels.push(label);
      parts.push({
        label,
        group: group.group,
        checkpointName: toOneLine(finding.checkpointName),
        redactedCheckpointName: texts[0] ?? "",
        texts,
        originals,
      });
    }
    const fixedLines = group.fixedLines.map((line) => {
      const name = toOneLine(line.checkpointName);
      const text = toOneLine(line.text);
      return {
        checkpointName: name,
        text,
        redactedCheckpointName: redactTextTracked(name, matcher).text,
        redactedText: redactTextTracked(text, matcher).text,
      };
    });
    prepared.push({ group: group.group, heading: toOneLine(group.heading), labels, fixedLines });
  }

  return {
    prompt: `${instructions}${PROMPT_INPUT_SEPARATOR}${lines.join("\n")}`,
    redactedCount: count,
    parts,
    groups: prepared,
    inputLength,
  };
}

const FINDING_LINE = /^\s*(F[1-9]\d*)\s*[:.)]\s?(.*)$/u;
const GROUP_LINE = /^\s*G[1-9]\d*\s*:?\s*$/u;

/**
 * Deler svaret for `summary_draft` i tekst per F-merke. En linje som starter med et merke, starter
 * en ny del; linjene under hører til samme del. Linjer med bare et gruppemerke hoppes over. Tekst
 * før første merke blir en del uten merke, som dekningsvakten stopper.
 */
export function parseSummaryAnswer(answer: string): AiGuardAnswerPart[] {
  const parts: { label: string | null; lines: string[] }[] = [];
  for (const line of answer.split(/\r?\n/u)) {
    const finding = FINDING_LINE.exec(line);
    if (finding) {
      parts.push({ label: finding[1] ?? null, lines: [finding[2] ?? ""] });
      continue;
    }
    if (GROUP_LINE.test(line) || line.trim() === "") continue;
    const current = parts.at(-1);
    if (current) current.lines.push(line);
    else parts.push({ label: null, lines: [line] });
  }
  return parts.map((part) => ({
    label: part.label,
    text: part.lines
      .map((line) => line.trim())
      .filter((line) => line !== "")
      .join(" "),
  }));
}

/** Ett avsnitt: punktets navn først (A462), så teksten. */
function paragraph(checkpointName: string, text: string): string {
  return text === "" ? checkpointName : `${checkpointName}: ${text}`;
}

/**
 * KI-teksten uten punktets navn og «:» først, når KI har gjentatt navnet. Koden setter navnet selv
 * (A462), så det ellers står to ganger («Sluk: Sluk: …»). Store og små bokstaver telles likt.
 */
export function withoutRepeatedName(checkpointName: string, text: string): string {
  const name = checkpointName.normalize("NFC").trim();
  const value = text.normalize("NFC");
  if (
    name === "" ||
    value.slice(0, name.length).toLocaleLowerCase("nb") !== name.toLocaleLowerCase("nb")
  ) {
    return text;
  }
  const rest = /^\s*:\s*/u.exec(value.slice(name.length));
  return rest ? value.slice(name.length + rest[0].length) : text;
}

/**
 * Setter sammen utkastet: kodens overskrift for hver gruppe, så ett avsnitt per funn (eller én
 * linje per TGIU-funn). `textFor` gir teksten per F-merke. `redacted` velger de vaskede navnene
 * og TGIU-tekstene (til `output_text`) eller de opprinnelige (til klienten).
 */
export function assembleSummary(
  prepared: PreparedSummaryPrompt,
  textFor: (label: string) => string,
  redacted: boolean,
): string {
  const byLabel = new Map(prepared.parts.map((part) => [part.label, part]));
  return prepared.groups
    .map((group) => {
      const lines = [group.heading];
      for (const label of group.labels) {
        const part = byLabel.get(label);
        if (!part) continue;
        const name = redacted ? part.redactedCheckpointName : part.checkpointName;
        lines.push(paragraph(name, withoutRepeatedName(name, textFor(label).trim())));
      }
      for (const line of group.fixedLines) {
        lines.push(
          redacted
            ? paragraph(line.redactedCheckpointName, line.redactedText)
            : paragraph(line.checkpointName, line.text),
        );
      }
      return lines.join("\n");
    })
    .join("\n\n");
}
