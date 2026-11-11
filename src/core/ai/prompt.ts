import { normalizeForRedaction } from "@/shared/lib/pii-patterns";
import { buildPrompt, type AiFeatureDefinition } from "./features";
import { redactFieldValues, type KnownValues } from "./redact-text";

/*
 * Felles ledetekst (docs/funksjoner/fase2a-evalueringssett.md Omfang 2). Både `requestSuggestion`
 * og kjøreren for evalueringssettet bygger ledeteksten her, så settet prøver nøyaktig det ekte bruk
 * sender. Ren: ingen database, ingen leverandør.
 *
 * Fast rekkefølge: rensing av tegn, så vask (kjente verdier og mønstrene), så ledeteksten av de
 * vaskede feltene. Dette er det eneste stedet `buildPrompt` kalles utenom testene. Kaster vasken,
 * lages ingen ledetekst.
 */

export type PreparedPrompt = {
  prompt: string;
  /** De vaskede feltene, det som faktisk sendes. Brukes til `input_summary`. */
  redactedFields: Record<string, string>;
  redactedCount: number;
};

/** Bygger ledeteksten av vaskede felt. Med `known = null` vaskes bare med mønstrene. */
export function preparePrompt(
  definition: AiFeatureDefinition,
  fields: Readonly<Record<string, string>>,
  known: KnownValues | null,
): PreparedPrompt {
  const cleaned = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, normalizeForRedaction(value)]),
  );
  const redacted = redactFieldValues(cleaned, known);
  const prompt = buildPrompt(definition, redacted.fields);
  return { prompt, redactedFields: redacted.fields, redactedCount: redacted.count };
}
