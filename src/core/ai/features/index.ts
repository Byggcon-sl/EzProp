import { AI_FEATURE_CODES, type AiFeatureCode, type AiFeatureDefinition } from "../types";
import { languagePolish } from "./language-polish";

/** Alle KI-funksjonene, én definisjon per fast kode. */
export const AI_FEATURES: Readonly<Record<AiFeatureCode, AiFeatureDefinition>> = {
  language_polish: languagePolish,
};

export function isAiFeatureCode(value: unknown): value is AiFeatureCode {
  return typeof value === "string" && (AI_FEATURE_CODES as readonly string[]).includes(value);
}

/** Definisjonen for en kode, eller `null` for en ukjent kode. */
export function getFeatureDefinition(code: string): AiFeatureDefinition | null {
  return isAiFeatureCode(code) ? AI_FEATURES[code] : null;
}
