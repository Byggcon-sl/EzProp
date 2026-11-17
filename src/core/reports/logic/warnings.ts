import { CHECKPOINT_WARNING_CODES } from "./codes";
import { checkCostAmount } from "./cost";
import { textsWrittenForOtherTg } from "./measures";
import { computeCheckpointTg } from "./tg";
import type {
  CheckpointState,
  CheckpointWarning,
  CheckpointWarningCode,
  ComputeCheckpointWarnings,
  DeviationState,
  SuggestionStillApplies,
  TgiuRequirements,
  TgiuState,
  WarningMissingPart,
} from "./types";

/**
 * Advarslene på et kontrollpunkt (docs/funksjoner/fase2a-badet-pc.md Omfang 6 og 7). Ingen av dem
 * sperrer nå; sperrene kommer med publisering. Advarslene om TGIU-forslag og T-0059 bygger på
 * serverens regelsvar som sendes inn (A386), aldri på en egen sammenligning mot grensen. Ingen
 * feltkode for våtrom står her: det som er spesielt for et punkt, kommer som data.
 */

/** Årsakskriteriet for alder (`CAUSE_CRITERIA` i skjemaet). */
const AGE_CRITERION = "age_uncertain_function";

/** Lik verdi for JSON-data (forslaget er bare koder). Rekkefølgen på nøklene spiller ingen rolle. */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key) =>
      Object.hasOwn(b, key) &&
      jsonEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

function isBlank(text: string | null): boolean {
  return text === null || text.trim() === "";
}

function warning(
  code: CheckpointWarningCode,
  deviationId: string | null = null,
  missing: WarningMissingPart[] = [],
  ruleKey: string | null = null,
): CheckpointWarning {
  return { code, deviationId, ruleKey, missing };
}

/** Avvik med TG2 eller TG3 (valgt). */
function hasTg(deviation: DeviationState): deviation is DeviationState & { tg: 2 | 3 } {
  return deviation.kind === "tg" && deviation.tg !== null;
}

/** Hva som mangler av årsak og konsekvens på et avvik med TG. */
function missingCauseOrConsequence(deviation: DeviationState): WarningMissingPart[] {
  const missing: WarningMissingPart[] = [];
  if (deviation.causeCriterion === null) missing.push("cause_criterion");
  if (isBlank(deviation.causeText)) missing.push("cause_text");
  if (isBlank(deviation.consequenceText)) missing.push("consequence_text");
  return missing;
}

/** Opplysningene som mangler ved TGIU, etter hva grunnen krever (fagansvarlig 14.11.2026, A349). */
export function missingTgiuDetails(
  tgiu: TgiuState | null,
  requirements: TgiuRequirements,
): WarningMissingPart[] {
  const missing: WarningMissingPart[] = [];
  if (isBlank(tgiu?.reason ?? null)) missing.push("reason");
  if (isBlank(tgiu?.riskAssessment ?? null)) missing.push("risk_assessment");
  if (isBlank(tgiu?.howToExamine ?? null)) missing.push("how_to_examine");
  if (requirements.alternativeCheck) {
    if (isBlank(tgiu?.alternativeCheckMethod ?? null)) missing.push("alternative_check_method");
    if (isBlank(tgiu?.alternativeCheckResult ?? null)) missing.push("alternative_check_result");
    if ((tgiu?.constructionVulnerable ?? null) === null) missing.push("construction_vulnerable");
  }
  if (requirements.ownerInformed && tgiu?.ownerInformed !== true) missing.push("owner_informed");
  return missing;
}

/**
 * Hva TGIU krever på punktet. Punktene med annen fuktkontroll (tilliggende konstruksjoner i
 * badmalen) og om eier har nektet hulltaking, kommer som data fra den som kaller.
 */
export function tgiuRequirementsFor(input: {
  checkpointKey: string;
  alternativeCheckCheckpointKeys: readonly string[];
  ownerRefusedInspection: boolean;
}): TgiuRequirements {
  return {
    alternativeCheck: input.alternativeCheckCheckpointKeys.includes(input.checkpointKey),
    ownerInformed: input.ownerRefusedInspection,
  };
}

/**
 * Om et godtatt eller endret forslag fortsatt gjelder: regelen slår til nå, med samme forslag.
 * Avviste forslag blir aldri «gjelder ikke lenger».
 */
export const suggestionStillApplies: SuggestionStillApplies = (decision, ruleResults) => {
  if (decision.decision === "rejected") return true;
  const result = ruleResults.find((r) => r.rule_key === decision.ruleKey);
  if (!result || result.state !== "triggered" || result.suggestion === null) return false;
  return jsonEqual(result.suggestion, decision.suggestion);
};

type DeviationCheck = (deviation: DeviationState) => WarningMissingPart[] | null;

/** Advarslene per avvik. `null` = ingen advarsel; tom liste = advarsel uten `missing`. */
const DEVIATION_CHECKS: Partial<Record<CheckpointWarningCode, DeviationCheck>> = {
  deviation_tg_not_chosen: (d) => (d.kind === "tg" && d.tg === null ? [] : null),
  tg2_tg3_missing_cause_or_consequence: (d) => {
    if (!hasTg(d)) return null;
    const missing = missingCauseOrConsequence(d);
    return missing.length > 0 ? missing : null;
  },
  tg2_tg3_missing_measure: (d) => (hasTg(d) && d.measureCount === 0 ? ["measure"] : null),
  tg3_missing_cost: (d) => (d.kind === "tg" && d.tg === 3 && d.costType === "none" ? [] : null),
  cost_amount_not_rounded: (d) =>
    d.costType === "approx" &&
    d.costAmount !== null &&
    checkCostAmount(d.costAmount) === "not_rounded"
      ? []
      : null,
  hms_missing_consequence_or_measure: (d) => {
    if (d.kind !== "hms") return null;
    const missing: WarningMissingPart[] = [];
    if (isBlank(d.consequenceText)) missing.push("consequence_text");
    if (d.measureCount === 0) missing.push("measure");
    return missing.length > 0 ? missing : null;
  },
  texts_written_for_other_tg: (d) =>
    d.kind === "tg" && textsWrittenForOtherTg(d.outcomeTg, d.tg, d.hasMeasuresForTg) ? [] : null,
  tg3_on_age_only: (d) =>
    d.kind === "tg" && d.tg === 3 && d.causeCriterion === AGE_CRITERION && d.outcomeTg !== 3
      ? []
      : null,
};

type CheckpointCheck = (input: CheckpointState) => CheckpointWarning[];

/** Advarslene for hele punktet. */
const CHECKPOINT_CHECKS: Partial<Record<CheckpointWarningCode, CheckpointCheck>> = {
  tgiu_details_missing: (input) => {
    if (input.tgDirect !== "IU") return [];
    const missing = missingTgiuDetails(input.tgiu, input.tgiuRequirements);
    return missing.length > 0 ? [warning("tgiu_details_missing", null, missing)] : [];
  },
  tgiu_suggested_not_set: (input) =>
    input.tgDirect === "IU"
      ? []
      : input.ruleResults
          .filter((r) => r.state === "triggered" && r.suggestion?.kind === "tgiu")
          .map((r) => warning("tgiu_suggested_not_set", null, [], r.rule_key)),
  no_findings_with_reading_over_limit: (input) =>
    input.noFindingsWithReadingOverLimit ? [warning("no_findings_with_reading_over_limit")] : [],
  suggestion_no_longer_applies: (input) =>
    input.decisions
      .filter((decision) => !suggestionStillApplies(decision, input.ruleResults))
      .map((decision) =>
        warning("suggestion_no_longer_applies", decision.deviationId, [], decision.ruleKey),
      ),
  checkpoint_done_without_tg: (input) =>
    input.done && computeCheckpointTg(input) === null
      ? [warning("checkpoint_done_without_tg")]
      : [],
};

/**
 * Alle advarslene på punktet, i fast rekkefølge: først etter `CHECKPOINT_WARNING_CODES`, så etter
 * avvikets plass. Mykt slettede avvik sendes aldri inn, så de gir ingen advarsel.
 */
export const computeCheckpointWarnings: ComputeCheckpointWarnings = (input) => {
  const warnings: CheckpointWarning[] = [];
  for (const code of CHECKPOINT_WARNING_CODES) {
    const perDeviation = DEVIATION_CHECKS[code];
    if (perDeviation) {
      for (const deviation of input.deviations) {
        const missing = perDeviation(deviation);
        if (missing !== null) warnings.push(warning(code, deviation.id, missing));
      }
    }
    const perCheckpoint = CHECKPOINT_CHECKS[code];
    if (perCheckpoint) warnings.push(...perCheckpoint(input));
  }
  return warnings;
};

/** Kodene som har en kontroll. Brukes av testen som viser at hver kode i listen er dekket. */
export const WARNING_CODES_WITH_CHECK: readonly CheckpointWarningCode[] = [
  ...Object.keys(DEVIATION_CHECKS),
  ...Object.keys(CHECKPOINT_CHECKS),
] as CheckpointWarningCode[];
