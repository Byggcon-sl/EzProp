import type { Permission } from "@/core/access";
import { NEVER_FIELDS } from "./never-fields";
import type { AiFeatureCode } from "./types";

/*
 * Funksjonsdefinisjonene (docs/adr/0006-ki-i-bunnen.md del 1 og 6, A159). Hver funksjon har fast
 * kode, rettigheten som kreves, tillatt-listen over feltkoder, de lovlige målene og
 * ledetekstversjonen. Et felt som ikke står på tillatt-listen, sendes aldri til KI. Et TG-felt
 * kan aldri være mål (ADR 0006 del 7).
 *
 * GJENNOMGANG KREVES: endring i tillatt-listene (`allowedFields`, `fieldSources`) eller i
 * «aldri»-listen (never-fields.ts) krever gjennomgang av sikkerhet-personvern i PR-en (A175).
 */

export type AiTargetSpec = { type: string; fieldKey: string };

/**
 * Måltypen for prøvesiden `/prove/ki` (A166). Godtas bare når organisasjonens leverandør er den
 * falske (vakten ligger i `requestSuggestion`), fordi siden sender fritekst uten vask. Arkiveres
 * når språkvask kommer på avviksteksten i 2a-2; koden gjenbrukes aldri (regel 6).
 */
export const AI_TRIAL_TARGET_TYPE = "ai_trial";

/**
 * Hvor en feltkode henter verdien fra: en kolonne som `tabell.kolonne`, eller `free_text` for
 * tekst den ansatte har skrevet. Ingen kilde kan stå i `NEVER_FIELDS` (ad-7).
 */
export const FREE_TEXT_SOURCE = "free_text";
export type AiFieldSource = `${string}.${string}` | typeof FREE_TEXT_SOURCE;

export type AiFeatureDefinition = {
  code: AiFeatureCode;
  permission: Permission;
  allowedFields: readonly string[];
  /** Kilden for hver feltkode på tillatt-listen. */
  fieldSources: Readonly<Record<string, AiFieldSource>>;
  allowedTargets: readonly AiTargetSpec[];
  promptVersion: string;
};

/**
 * Ledetekstene, versjonert. Ny formulering gir ny versjon; en versjon endres aldri. Egen
 * formulering (regel 7): ingen tekst fra NS 3600, IVIT eller SmartTakst, og ingen gjetteord.
 */
export const AI_PROMPTS: Readonly<Record<string, string>> = {
  "language_polish.v1": [
    "Du retter språket i en kort tekst fra en tilstandsrapport.",
    "Rett skrivefeil, tegnsetting og setninger som er tunge å lese. Skriv på norsk bokmål.",
    "Behold alle fakta, tall og mål slik de står. Ikke legg til noe nytt, og ikke ta bort noe.",
    "Skriv sikkert og konkret, uten ord som uttrykker gjetting.",
    "Svar bare med den rettede teksten.",
  ].join("\n"),
};

export const AI_FEATURES: Readonly<Record<AiFeatureCode, AiFeatureDefinition>> = {
  language_polish: {
    code: "language_polish",
    permission: "report.edit",
    allowedFields: ["text"],
    fieldSources: { text: FREE_TEXT_SOURCE },
    allowedTargets: [
      { type: "answer", fieldKey: "text" },
      { type: AI_TRIAL_TARGET_TYPE, fieldKey: "text" },
    ],
    promptVersion: "language_polish.v1",
  },
};

/** Det kontrollen trenger av en definisjon. Ren form, så testen kan prøve oppdiktede definisjoner. */
export type AiFieldSourceCheckInput = {
  code: string;
  allowedFields: readonly string[];
  fieldSources?: Readonly<Record<string, string>>;
};

const TABLE_COLUMN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/**
 * Kontrollen av feltkildene (ad-7): hver feltkode på tillatt-listen må ha en kilde, kilden må
 * være `free_text` eller `tabell.kolonne`, og den kan ikke stå i «aldri»-listen. Gir én linje per
 * brudd; tom liste betyr at definisjonene er i orden.
 */
export function findFieldSourceViolations(
  definitions: readonly AiFieldSourceCheckInput[],
  neverFields: readonly string[] = NEVER_FIELDS,
): string[] {
  const never = new Set(neverFields);
  const out: string[] = [];
  for (const definition of definitions) {
    const sources = definition.fieldSources ?? {};
    for (const field of definition.allowedFields) {
      const source = Object.prototype.hasOwnProperty.call(sources, field)
        ? sources[field]
        : undefined;
      if (source === undefined || source === "") {
        out.push(`${definition.code}.${field}: mangler kilde`);
      } else if (never.has(source)) {
        out.push(`${definition.code}.${field}: ${source} står i «aldri»-listen`);
      } else if (source !== FREE_TEXT_SOURCE && !TABLE_COLUMN.test(source)) {
        out.push(`${definition.code}.${field}: ugyldig kilde ${source}`);
      }
    }
  }
  return out;
}

function isFeatureCode(code: string): code is AiFeatureCode {
  return Object.prototype.hasOwnProperty.call(AI_FEATURES, code);
}

/** Definisjonen for en funksjonskode, eller `null` for en ukjent kode. */
export function getFeatureDefinition(code: string): AiFeatureDefinition | null {
  return isFeatureCode(code) ? AI_FEATURES[code] : null;
}

/** Ledeteksten for en versjon, eller `null`. */
export function getPrompt(promptVersion: string): string | null {
  return Object.prototype.hasOwnProperty.call(AI_PROMPTS, promptVersion)
    ? (AI_PROMPTS[promptVersion] ?? null)
    : null;
}

/** Skillet mellom instruksen og teksten fra den ansatte. Den falske leverandøren bruker det. */
export const PROMPT_INPUT_SEPARATOR = "\n\n--- Tekst ---\n";

/**
 * Bygger ledeteksten av den faste instruksen og bare feltene på tillatt-listen, i fast
 * rekkefølge. Kalles etter at tillatt-listen er sjekket.
 */
export function buildPrompt(
  definition: AiFeatureDefinition,
  fields: Readonly<Record<string, string>>,
): string {
  const instructions = getPrompt(definition.promptVersion);
  if (instructions === null) throw new Error("Ledeteksten mangler for funksjonen.");
  const single = definition.allowedFields.length === 1;
  const input = definition.allowedFields
    .filter((key) => Object.prototype.hasOwnProperty.call(fields, key))
    .map((key) => (single ? fields[key] : `${key}: ${fields[key]}`))
    .join("\n");
  return `${instructions}${PROMPT_INPUT_SEPARATOR}${input}`;
}
