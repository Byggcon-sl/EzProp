import type { EmployeeGrant } from "@/core/access";
import type { DbExecutor } from "@/db/client";
import { PII_PLACEHOLDERS } from "@/shared/lib/pii-patterns";
import { stripUnstorableChars } from "@/shared/lib/clean-text";
import { getFeatureDefinition } from "./features";
import { PlaceholderRestoreError, restorePlaceholders } from "./placeholders";
import { preparePrompt } from "./prompt";
import { loadKnownValues } from "./redaction";

/*
 * «Bruk» i «Gå gjennom tekstene» (docs/funksjoner/fase2a-ga-gjennom-tekstene.md, A466 og A607):
 * serveren skriver selv språkvaskforslaget i feltet. Raden i `ai_usage_log` har forslaget med
 * plassholderne fra vasken, og de opprinnelige verdiene ble bare holdt i minnet under kallet. Her
 * kjøres den samme vasken på nytt på den uendrede feltteksten, og plassholderne byttes tilbake med
 * verdiene derfra. De kjente verdiene leses i kallerens transaksjon og lever bare i minnet her.
 *
 * Passer ikke plassholderne (feltet eller oppdragets opplysninger er endret siden forslaget), gis
 * `null`, og kalleren lagrer ingenting. Teksten skrives aldri til logger eller feil.
 *
 * Hovedmål: KI i bunnen (forslaget brukes uten at persondata noen gang gikk til KI) og færre
 * reklamasjoner (feil verdi kan ikke skrives inn i stedet for en plassholder).
 */

export type RestorePolishSuggestionInput = {
  /** Oppdraget på loggraden. Lest med `grant.organizationId`. */
  assignmentId: string | null;
  /** `output_text` på raden: forslaget med plassholderne. */
  outputText: string;
  /** `redacted_count` på raden. */
  redactedCount: number;
  /** Teksten i feltet nå, den samme som ble sendt til språkvask. */
  fieldText: string;
};

function hasPlaceholder(text: string): boolean {
  return PII_PLACEHOLDERS.some((placeholder) => text.includes(placeholder));
}

/** Forslaget med de opprinnelige verdiene tilbake, eller `null` når det ikke lar seg gjøre trygt. */
export async function restorePolishSuggestion(
  tx: DbExecutor,
  grant: EmployeeGrant,
  input: RestorePolishSuggestionInput,
): Promise<string | null> {
  // Ingenting ble vasket bort: forslaget er teksten som den er
  if (input.redactedCount === 0 && !hasPlaceholder(input.outputText)) return input.outputText;
  if (input.assignmentId === null) return null;
  const definition = getFeatureDefinition("language_polish");
  if (!definition) return null;
  const known = await loadKnownValues(grant, input.assignmentId, tx);
  const prepared = preparePrompt(
    definition,
    { text: stripUnstorableChars(input.fieldText) },
    known,
  );
  // Vasken gir et annet antall plassholdere enn da forslaget ble laget: feltet er endret
  if (prepared.redactedCount !== input.redactedCount) return null;
  try {
    return restorePlaceholders(input.outputText, Object.values(prepared.originals).flat());
  } catch (error) {
    if (error instanceof PlaceholderRestoreError) return null;
    throw error;
  }
}
