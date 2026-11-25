import type { PublishCheckCode, PublishOverrideReasonCode } from "@/db/schema";
import { PUBLISH_OVERRIDE_REASON_LABELS as REASON_LABELS } from "@/shared/config/publish-check-labels";
import { WARNING_MISSING_PARTS } from "./codes";
import { formatWholeNumber, WARNING_MISSING_PART_LABELS, warningText } from "./labels";
import type {
  PublishCheckFinding,
  PublishCheckMissingPart,
  PublishOverrideReasonCheck,
} from "./publish-check-types";
import type { CheckpointWarningCode, WarningMissingPart } from "./types";
import {
  PUBLISH_OVERRIDE_REASON_MAX_CHARS,
  PUBLISH_OVERRIDE_REASON_MIN_CHARS_OTHER,
} from "./codes";

/**
 * Tekstene i sjekken før publisering (docs/funksjoner/fase2a-publisering-badet-design.md avsnitt
 * 8 og 11). Teksten lages fra koden og `missing` hver gang den vises, og lagres aldri: romnavn,
 * punktnavn og fritekst står aldri i funnet. Samme fil i nettleseren og på serveren.
 *
 * Egne formuleringer uten gjetteord og uten tekst fra NS 3600, IVIT eller SmartTakst. Kodene
 * endres aldri (regel 6); bare tekstene kan endres.
 */

/** Det skjermen vet om avviket, slik at teksten kan si «Avvik 1 (TG2)». Aldri lagret. */
export type PublishFindingTextContext = {
  /** Avviksnummeret på punktet (1, 2, …). `null` gir «Avviket». */
  deviationNumber?: number | null;
  /** Avvikets TG. `null` gir ingen TG i teksten. */
  deviationTg?: 2 | 3 | null;
};

/** Hva som mangler, slik det står i sjekken. */
export const PUBLISH_CHECK_MISSING_PART_LABELS: Record<PublishCheckMissingPart, string> = {
  ...WARNING_MISSING_PART_LABELS,
  cause_criterion: "årsakskriterium",
  tg: "TG",
  hole_drilling: "svar på hulltaking",
  hole_drilling_reason: "grunn til at hulltaking ikke er utført",
  hole_drilling_reason_note: "forklaring til «Annet»",
};

/** Avvik med TG2 eller TG3: hva som mangler av årsak og konsekvens. */
const CAUSE_OR_CONSEQUENCE_TEXTS: Partial<Record<PublishCheckMissingPart, string>> = {
  cause_criterion: "årsakskriterium",
  cause_text: "årsak",
  consequence_text: "konsekvens",
};

/** Hulltaking i våtrom: én tekst per mangel. */
const HOLE_DRILLING_TEXTS: Partial<Record<PublishCheckMissingPart, string>> = {
  hole_drilling: "Hulltaking er ikke besvart.",
  hole_drilling_reason: "Hulltaking er ikke utført, og grunnen mangler.",
  hole_drilling_reason_note: "Hulltaking: «Annet» mangler forklaring.",
};

/** Tekstene som ikke trenger `missing` eller avviket. */
const FIXED_TEXTS = {
  inspection_date_missing:
    "Oppdraget mangler befaringsdato. Uten den får rapporten ingen «gyldig til»-dato.",
  hole_reading_missing: "Hulltaking er utført, men måleverdi eller enhet mangler.",
  ai_suggestion_pending: "Forslag fra KI som ikke er behandlet. Det kommer ikke med i rapporten.",
  bra_missing: "Rapporten mangler bruksareal (BRA).",
  electrical_missing: "Rapporten mangler vurdering av det elektriske anlegget.",
  wet_or_below_ground_missing_hole: "Hulltaking mangler svar eller grunn.",
} as const satisfies Partial<Record<PublishCheckCode, string>>;

/** «a», «a og b», «a, b og c». */
function joinWords(words: readonly string[]): string {
  const unique = [...new Set(words)];
  if (unique.length <= 1) return unique[0] ?? "";
  return `${unique.slice(0, -1).join(", ")} og ${unique[unique.length - 1]}`;
}

/** «Avvik 1 (TG2)», «Avvik 1», «Avviket (TG3)» eller «Avviket». */
function deviationLabel(context: PublishFindingTextContext, tg: 2 | 3 | null): string {
  const name =
    context.deviationNumber !== null && context.deviationNumber !== undefined
      ? `Avvik ${context.deviationNumber}`
      : "Avviket";
  return tg === null ? name : `${name} (TG${tg})`;
}

const WARNING_PARTS: ReadonlySet<string> = new Set(WARNING_MISSING_PARTS);

/**
 * Teksten for et funn, laget fra koden og `missing`. Advarslene fra «Badet på PC» får samme tekst
 * som på rommet (`warningText`).
 */
export function publishFindingText(
  finding: Pick<PublishCheckFinding, "checkCode" | "target">,
  context: PublishFindingTextContext = {},
): string {
  const { checkCode, target } = finding;
  const missing = target.missing;
  switch (checkCode) {
    case "tg2_tg3_missing_cause_or_consequence": {
      const words = missing.flatMap((part) => CAUSE_OR_CONSEQUENCE_TEXTS[part] ?? []);
      const what = words.length > 0 ? joinWords(words) : "årsak eller konsekvens";
      return `${deviationLabel(context, context.deviationTg ?? null)} mangler ${what}.`;
    }
    case "tg3_missing_cost":
      return `${deviationLabel(context, 3)} mangler kostnad.`;
    case "wet_or_below_ground_missing_hole": {
      const texts = missing.flatMap((part) => HOLE_DRILLING_TEXTS[part] ?? []);
      return texts.length > 0 ? texts.join(" ") : FIXED_TEXTS.wet_or_below_ground_missing_hole;
    }
    case "mandatory_without_tg":
      if (target.deviationId !== null) {
        return `${deviationLabel(context, null)} mangler TG. Velg TG2 eller TG3.`;
      }
      if (missing.includes("reason")) {
        return "TGIU mangler grunn: hva er ikke undersøkt, og hvorfor.";
      }
      return "Punktet mangler TG.";
    case "inspection_date_missing":
    case "hole_reading_missing":
    case "ai_suggestion_pending":
    case "bra_missing":
    case "electrical_missing":
      return FIXED_TEXTS[checkCode];
    default:
      return warningText({
        code: checkCode satisfies CheckpointWarningCode,
        deviationId: target.deviationId,
        ruleKey: target.ruleKey,
        missing: missing.filter((part): part is WarningMissingPart => WARNING_PARTS.has(part)),
      });
  }
}

/** Grunnene når en sperre krysses bort, i rekkefølgen i `PUBLISH_OVERRIDE_REASON_CODES` (F1). */
export const PUBLISH_OVERRIDE_REASON_LABELS: Record<PublishOverrideReasonCode, string> =
  REASON_LABELS;

/** Meldingene fra `checkPublishOverrideReason`. `ok` har ingen melding. */
export const PUBLISH_OVERRIDE_REASON_CHECK_MESSAGES: Record<
  Exclude<PublishOverrideReasonCheck, "ok">,
  string
> = {
  reason_required: "Velg en grunn.",
  text_required: `Skriv minst ${PUBLISH_OVERRIDE_REASON_MIN_CHARS_OTHER} tegn.`,
  text_too_short: `Skriv minst ${PUBLISH_OVERRIDE_REASON_MIN_CHARS_OTHER} tegn.`,
  text_too_long: `Teksten er for lang. Grensen er ${formatWholeNumber(PUBLISH_OVERRIDE_REASON_MAX_CHARS)} tegn.`,
  national_id: "Teksten ser ut til å inneholde et fødselsnummer. Fjern det.",
};
