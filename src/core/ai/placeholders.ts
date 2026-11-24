import { PII_PLACEHOLDERS, type PiiPlaceholder } from "@/shared/lib/pii-patterns";
import type { RestorePlaceholders } from "./types";

/*
 * Tilbakebytting av plassholderne fra vasken (A466, avgjør A178, ADR 0006 del 7). Ren funksjon.
 *
 * Koblingen plassholder → opprinnelig verdi lages av vasken (`redactTextTracked`) og holdes bare i
 * minnet under kallet. Den lagres aldri, logges aldri og sendes aldri til leverandøren:
 * `output_text` i `ai_usage_log` beholder plassholderne, og bare teksten til klienten får de
 * opprinnelige verdiene tilbake.
 *
 * Kalles bare etter at `checkAnswerGuards` har sluppet svaret gjennom (samme plassholdere i samme
 * rekkefølge). Stemmer det likevel ikke, kaster funksjonen: da vises ingenting.
 */

export class PlaceholderRestoreError extends Error {
  constructor() {
    super("Plassholderne i KI-svaret kunne ikke byttes tilbake.");
    this.name = "PlaceholderRestoreError";
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

const PLACEHOLDER = new RegExp(PII_PLACEHOLDERS.map(escapeRegExp).join("|"), "gu");

/**
 * Plassholder nummer k av en type i svaret får opprinnelig verdi nummer k av samme type. Antallet
 * av hver type må være det samme som i `originals`.
 */
export const restorePlaceholders: RestorePlaceholders = (answer, originals) => {
  const byType = new Map<PiiPlaceholder, string[]>();
  for (const original of originals) {
    const list = byType.get(original.placeholder) ?? [];
    list.push(original.value);
    byType.set(original.placeholder, list);
  }
  const used = new Map<PiiPlaceholder, number>();
  const restored = answer.replace(PLACEHOLDER, (match) => {
    const placeholder = match as PiiPlaceholder;
    const index = used.get(placeholder) ?? 0;
    const value = byType.get(placeholder)?.[index];
    if (value === undefined) throw new PlaceholderRestoreError();
    used.set(placeholder, index + 1);
    return value;
  });
  for (const [placeholder, values] of byType) {
    if ((used.get(placeholder) ?? 0) !== values.length) throw new PlaceholderRestoreError();
  }
  return restored;
};
