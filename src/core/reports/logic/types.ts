import type { RuleResult } from "@/core/rules";
import type { StandardMeasureDoc } from "@/core/templates";
import type {
  ConstructionVulnerable,
  CostType,
  DeviationKind,
  DeviationTg,
  MeasureAppliesToTg,
  RuleSuggestionDecision,
  StoredRuleSuggestion,
  TgDirect,
} from "@/db/schema";
import type {
  CHECKPOINT_STATUSES,
  CHECKPOINT_TG_VALUES,
  CHECKPOINT_WARNING_CODES,
  COST_AMOUNT_CHECKS,
  MERGE_FIELD_KEYS,
  WARNING_MISSING_PARTS,
} from "./codes";

/**
 * Grensesnittet til de rene funksjonene for rapporten (ADR 0013,
 * docs/funksjoner/fase2a-badet-pc.md Omfang 3). Rent blad: ingen database, ingen pakker, ingen
 * dagens dato. Samme kode i nettleseren og på serveren, og klar for iPaden uten nett i 2b.
 * Klientkomponenter importerer bare fra `@/core/reports/logic`, aldri fra `@/core/reports`.
 *
 * TG-logikken gjelder bare systemmalen for tilstandsrapport (regel 5). Funksjonene setter aldri
 * TG: de regner ut hva som vises, og hvilke advarsler takstmannen får.
 */

export type CheckpointTg = (typeof CHECKPOINT_TG_VALUES)[number];
export type CheckpointStatus = (typeof CHECKPOINT_STATUSES)[number];
export type CheckpointWarningCode = (typeof CHECKPOINT_WARNING_CODES)[number];
export type WarningMissingPart = (typeof WARNING_MISSING_PARTS)[number];
export type CostAmountCheck = (typeof COST_AMOUNT_CHECKS)[number];
export type MergeFieldKey = (typeof MERGE_FIELD_KEYS)[number];

// --- Inndata (det funksjonene trenger av radene, uten id-er de ikke bruker) --------------------

/** Et avvik slik de rene funksjonene ser det. Mykt slettede avvik sendes aldri inn. */
export type DeviationState = {
  id: string;
  kind: DeviationKind;
  tg: DeviationTg | null;
  causeCriterion: string | null;
  causeText: string | null;
  consequenceText: string | null;
  costType: CostType;
  costAmount: number | null;
  /** Antall tiltak som ikke er slettet og har tekst. */
  measureCount: number;
  /** TG utfallet i malen er skrevet for. `null` for «velg TG2 eller TG3», HMS og fritt avvik. */
  outcomeTg: DeviationTg | null;
  /** Om malen har egne tiltak for avvikets TG (`applies_to_tg`). */
  hasMeasuresForTg: boolean;
};

/** Opplysningene ved TGIU slik de rene funksjonene ser dem. */
export type TgiuState = {
  reason: string | null;
  riskAssessment: string | null;
  howToExamine: string | null;
  alternativeCheckMethod: string | null;
  alternativeCheckResult: string | null;
  constructionVulnerable: ConstructionVulnerable | null;
  ownerInformed: boolean | null;
};

/**
 * Hvilke opplysninger TGIU krever på dette punktet (fagansvarlig 14.11.2026, A349). Kommer som
 * data fra den som kaller, slik at feltkoder for våtrom aldri står i de generelle funksjonene.
 */
export type TgiuRequirements = {
  /** Annen fuktkontroll, resultat og skadeutsatt konstruksjon (tilliggende konstruksjoner). */
  alternativeCheck: boolean;
  /** Eier er informert om utvidet ansvar (eier har nektet hulltaking). */
  ownerInformed: boolean;
};

/** Siste beslutning om et regelforslag, slik advarslene trenger den. */
export type DecisionState = {
  ruleKey: string;
  decision: RuleSuggestionDecision;
  suggestion: StoredRuleSuggestion;
};

export type CheckpointState = {
  tgDirect: TgDirect | null;
  done: boolean;
  /** Om punktet har svar eller beskrivelse. Brukes bare til statusen «i arbeid». */
  hasContent: boolean;
  deviations: readonly DeviationState[];
  tgiu: TgiuState | null;
  tgiuRequirements: TgiuRequirements;
  /** Regelsvarene for dette kontrollpunktet, regnet på lagrede svar. */
  ruleResults: readonly RuleResult[];
  /** Siste beslutning per regel på punktet. */
  decisions: readonly DecisionState[];
  /** T-0059: «utført uten funn» med måling lik eller over grensen. Regnes av den som kaller. */
  noFindingsWithReadingOverLimit: boolean;
};

// --- Svar ----------------------------------------------------------------------------------

/** En advarsel på et kontrollpunkt. Bare koder og id-er, aldri fritekst. */
export type CheckpointWarning = {
  code: CheckpointWarningCode;
  /** Avviket advarselen gjelder. `null` = hele punktet. */
  deviationId: string | null;
  /** Regelen advarselen gjelder (`suggestion_no_longer_applies`, `tgiu_suggested_not_set`). */
  ruleKey: string | null;
  missing: WarningMissingPart[];
};

/** En bit av en tekst med flettefelt. `missing` vises tydelig som manglende, aldri som `{…}`. */
export type MergeSegment =
  | { type: "text"; text: string }
  | { type: "value"; field: MergeFieldKey; text: string }
  | { type: "missing"; field: MergeFieldKey };

export type MergeValues = Partial<Record<MergeFieldKey, string | null>>;

/** Hva som må skje med TG direkte når et avvik med TG legges til eller godtas. */
export type DirectTgConflict =
  /** Ingen TG direkte: ingenting å gjøre. */
  | "none"
  /** TG0 eller TG1: avviket gjelder, og `tg_direct` tømmes. */
  | "clear_direct"
  /** TGIU: takstmannen må velge aktivt. TGIU overskrives aldri stille. */
  | "choose_tgiu_or_deviation";

// --- Funksjonene (bygges av utvikleren i `logic/`) -------------------------------------------

/**
 * TG for kontrollpunktet: høyeste TG blant avvikene, ellers `tg_direct`. HMS-avvik og avvik uten
 * valgt TG teller ikke. Lagres aldri (A342): regnes hver gang den leses.
 */
export type ComputeCheckpointTg = (
  input: Pick<CheckpointState, "tgDirect" | "deviations">,
) => CheckpointTg | null;

/** `tgiu` når TG er IU, `done` når punktet er merket ferdig, ellers etter innholdet. */
export type ComputeCheckpointStatus = (input: CheckpointState) => CheckpointStatus;

/** Alle advarslene på punktet, i fast rekkefølge (`CHECKPOINT_WARNING_CODES`, så avvikets plass). */
export type ComputeCheckpointWarnings = (input: CheckpointState) => CheckpointWarning[];

/**
 * Hva som skjer med `tg_direct` når punktet får et avvik av denne arten. HMS gir alltid `none`:
 * HMS kan stå sammen med TGIU.
 */
export type CheckDirectTgConflict = (
  tgDirect: TgDirect | null,
  kind: DeviationKind,
) => DirectTgConflict;

/** `invalid` for 0, negative tall og ikke-heltall; `not_rounded` når beløpet ikke går opp i 10 000. */
export type CheckCostAmount = (amount: number) => CostAmountCheck;

/** Deler teksten i biter. Ukjente `{…}` står som vanlig tekst. */
export type FillMergeFields = (text: string, values: MergeValues) => MergeSegment[];

/**
 * Standardtiltakene som legges inn for en TG: de uten `applies_to_tg`, og de som gjelder denne
 * TG-en (bør ved TG2, må ved TG3, T-0060). `tg = null` (HMS) gir bare dem uten `applies_to_tg`.
 */
export type PickStandardMeasures = (
  measures: readonly StandardMeasureDoc[],
  tg: MeasureAppliesToTg | null,
) => StandardMeasureDoc[];

/**
 * Om et godtatt eller endret forslag fortsatt gjelder: regelen slår til nå, med samme forslag.
 * Avviste forslag blir aldri «gjelder ikke lenger».
 */
export type SuggestionStillApplies = (
  decision: DecisionState,
  ruleResults: readonly RuleResult[],
) => boolean;
