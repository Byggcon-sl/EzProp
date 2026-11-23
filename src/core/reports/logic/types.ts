import type { RuleResult } from "@/core/rules";
import type { StandardMeasureDoc } from "@/core/templates";
import type {
  ChosenTg,
  ConstructionVulnerable,
  CostType,
  DeviationKind,
  DeviationTg,
  MeasureAppliesToTg,
  OverrideReasonCode,
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
  OVERRIDE_REASON_CHECKS,
  WARNING_FIX_KINDS,
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
export type OverrideReasonCheck = (typeof OVERRIDE_REASON_CHECKS)[number];
export type WarningFixKind = (typeof WARNING_FIX_KINDS)[number];

/**
 * TG utfallet i malen er skrevet for: 2, 3 eller `choose` («velg TG2 eller TG3»). `null` for HMS
 * og fritt avvik.
 */
export type OutcomeTg = DeviationTg | "choose";

/**
 * TG-en et regelforslag gjelder, slik skjermen viser den («Forslag TG3, endret til TG2»): malens TG
 * for utfallet (`outcome`), `"IU"` for `tgiu` og `"0"` for `tg0`. Regnes fra det lagrede forslaget
 * og den låste malversjonen, aldri fra klienten.
 */
export type SuggestionTg = OutcomeTg | "0" | "IU";

/** Beslutningen en beslutningsrad kan få når TG byttes på et avvik fra et forslag (A490). */
export type SuggestedTgChangeOutcome = Extract<RuleSuggestionDecision, "accepted" | "changed">;

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
  /**
   * Malens TG for utfallet. Brukes av `tg3_on_age_only` (`outcomeTg !== 3`, A396) og
   * `texts_written_for_other_tg`, slik at ingen våtromskode står i de generelle funksjonene.
   */
  outcomeTg: OutcomeTg | null;
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

/**
 * Siste beslutningsrad for en regel på et punkt (siste rad vinner), slik de rene funksjonene
 * trenger den. Om raden er gjeldende, avgjøres bare av `IsEffectiveDecision` (ADR 0013 punkt 9b).
 */
export type DecisionState = {
  ruleKey: string;
  decision: RuleSuggestionDecision;
  suggestion: StoredRuleSuggestion;
  /** TG takstmannen endte på (`chosen_tg`). `null` ved `rejected` og ved «velg» uten valgt TG. */
  chosenTg: ChosenTg | null;
  /**
   * Raden har `deviation_id`: beslutningen laget et avvik, enten det står eller er fjernet.
   * Skiller «avviket er fjernet» fra «beslutningen ga aldri avvik» (TG0, TG1, TGIU).
   */
  madeDeviation: boolean;
  /** Avviket beslutningen laget, når det ikke er slettet. Gir «Fjern avviket» / «Behold» (A388). */
  deviationId: string | null;
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
  /**
   * Siste beslutning per regel på punktet, **bare de gjeldende** (`IsEffectiveDecision`). Den som
   * kaller, siler før advarslene regnes. En regel uten rad her har et åpent forslag.
   */
  decisions: readonly DecisionState[];
  /**
   * T-0059: valget er «utført uten funn», og regelen for forhøyet fukt slår til i serverens
   * regelsvar. Den som kaller, setter verdien fra regelsvaret (A386), aldri fra en egen
   * sammenligning mot grensen: grensen og enheten (vekt-%) står bare i regelen.
   */
  noFindingsWithReadingOverLimit: boolean;
};

// --- Svar ----------------------------------------------------------------------------------

/** En advarsel på et kontrollpunkt. Bare koder og id-er, aldri fritekst. */
export type CheckpointWarning = {
  code: CheckpointWarningCode;
  /** Avviket advarselen gjelder. `null` = hele punktet. */
  deviationId: string | null;
  /**
   * Regelen advarselen gjelder (`suggestion_no_longer_applies`, `tgiu_suggested_not_set`,
   * `open_suggestion_on_done_checkpoint`).
   */
  ruleKey: string | null;
  missing: WarningMissingPart[];
};

/**
 * Handlingen bak «Rett nå» (A381). `null` fra `WarningFix` betyr at advarselen ikke har én
 * opplagt retting. Ingenting skjer uten trykk, og advarselen sperrer aldri.
 */
export type WarningFixAction =
  | { kind: "change_answer" }
  | { kind: "focus_field"; deviationId: string | null; field: WarningMissingPart | "cost" }
  | { kind: "focus_tg_choice" }
  | {
      kind: "scroll_to_suggestion";
      ruleKey: string;
      /**
       * Satt når et godtatt avvik henger på forslaget (A388): skjermen viser «Fjern avviket»
       * (samme tjeneste som i avvikskortet) og «Behold avviket» (lagrer ingenting).
       */
      deviationId: string | null;
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

/**
 * Samme som `CheckDirectTgConflict` motsatt vei: om `tg_direct` kan settes når punktet har avvik.
 * `IU` og `0` sammen med avvik med TG2 eller TG3 gir `true` (takstmannen må velge aktivt,
 * serverstatus `tgiu_conflicts_with_deviation`). HMS-avvik gir aldri konflikt.
 */
export type DirectTgConflictsWithDeviations = (
  tgDirect: TgDirect,
  deviations: readonly Pick<DeviationState, "kind" | "tg">[],
) => boolean;

/**
 * Kontrollen av begrunnelsen (A380, A398), én regel for skjermen, Zod-skjemaet på serveren og
 * CHECK-regelen: `accepted` har verken kode eller tekst; `changed` og `rejected` krever kode
 * eller tekst; koden `other` krever tekst. Tekst med bare mellomrom regnes som tom.
 */
export type CheckOverrideReason = (input: {
  decision: RuleSuggestionDecision;
  code: OverrideReasonCode | null;
  text: string | null;
}) => OverrideReasonCheck;

/** «Rett nå» for en advarsel, eller `null` (A381, A388). */
export type WarningFix = (
  warning: CheckpointWarning,
  context: { decisions: readonly DecisionState[] },
) => WarningFixAction | null;

/**
 * Neste punkt med advarsel etter det åpne, i malens rekkefølge. Går rundt til starten, og gir
 * `null` når ingen punkt har advarsel. `count` teller punkter, ikke advarsler.
 */
export type NextCheckpointToReview = (
  checkpoints: readonly { checkpointKey: string; warningCount: number }[],
  openCheckpointKey: string | null,
) => { next: string | null; count: number };

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

/**
 * Gjeldende beslutning (A491, A495, ADR 0013 punkt 9b): om siste beslutningsrad for en regel på et
 * punkt fortsatt står ved lag. Én regel for serveren og skjermen; ingen andre steder vurderer det.
 * - `rejected` er alltid gjeldende.
 * - Rad som laget avvik (`madeDeviation`): gjeldende bare når avviket står (`deviationId !== null`).
 * - Rad uten avvik med valgt TG `0`, `1` eller `IU`: gjeldende bare når punktets `tgDirect` er lik
 *   den valgte.
 * - Alt annet er ikke gjeldende.
 *
 * Ikke gjeldende betyr at forslaget er åpent igjen (Godta, Endre, Avvis). Ingenting lagres når en
 * beslutning slutter å gjelde; raden står urørt og kan bli gjeldende igjen (Angre).
 */
export type IsEffectiveDecision = (
  decision: DecisionState,
  checkpoint: Pick<CheckpointState, "tgDirect">,
) => boolean;

/**
 * Hva beslutningsraden blir når TG byttes på et avvik som kom fra et regelforslag (A490):
 * - `accepted` (ingen grunn): forslaget er av typen `outcome`, avviket har forslagets spørsmål og
 *   utfall, og ny TG er utfallets faste TG, eller utfallet er «velg TG2 eller TG3» (da er TG-valget
 *   en del av å godta, også tom TG).
 * - `changed` (krever grunn etter `CheckOverrideReason`): alt annet.
 *
 * Funksjonen setter aldri TG. Skjermen bruker den til å vise grunnvalget før noe sendes, og
 * serveren bruker den i `ChangeSuggestedDeviationTg`.
 */
export type SuggestedTgChangeDecision = (input: {
  /** Forslaget slik det står i den gjeldende beslutningsraden. */
  suggestion: StoredRuleSuggestion;
  /** Avvikets spørsmål og utfall. */
  questionKey: string | null;
  outcomeKey: string | null;
  /** Malens TG for avvikets utfall. */
  outcomeTg: OutcomeTg | null;
  /** TG-en takstmannen velger nå. */
  tg: DeviationTg | null;
}) => SuggestedTgChangeOutcome;
