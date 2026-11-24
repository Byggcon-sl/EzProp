import type { ConditionReasonCode, RuleReason, RuleReasonCode, RuleResult } from "@/core/rules";
import type {
  CAUSE_CRITERIA,
  ChosenTg,
  ConstructionVulnerable,
  CostType,
  OverrideReasonCode,
  RuleSuggestionDecision,
  TextStatus,
} from "@/db/schema";
import type { INSPECTION_YEAR_SOURCES } from "./codes";
import { COST_AMOUNT_ROUNDING } from "./codes";
import type { CostBandKey } from "./cost-bands";
import type {
  CheckpointStatus,
  CheckpointTg,
  CheckpointWarning,
  CheckpointWarningCode,
  MergeFieldKey,
  OverrideReasonCheck,
  SuggestionTg,
  WarningFixKind,
  WarningMissingPart,
} from "./types";

/**
 * Oversettelsen av koder til norsk for rapporten (docs/funksjoner/fase2a-badet-pc.md Omfang 3 og
 * 12). En enkel oppslagstabell, ingen oversettelsesmotor. Skjermen og senere PDF-en henter
 * tekstene herfra, så de er like overalt.
 *
 * Tekstene er egne formuleringer, uten gjetteord og uten tekst fra NS 3600, IVIT eller SmartTakst.
 * De er utkast, ikke godkjent av fagrådet (`LABELS_TEXT_STATUS`), til Ståle har godkjent dem.
 * Kodene endres aldri (regel 6); bare tekstene kan endres.
 */

/** Status for tekstene i denne filen: utkast, ikke godkjent av fagrådet. */
export const LABELS_TEXT_STATUS: TextStatus = "draft";

// --- Tall ----------------------------------------------------------------------------------

/** Hardt mellomrom, så «40 000» aldri brytes over to linjer. */
const NBSP = " ";

/** Heltall med mellomrom som tusenskille: 40000 → «40 000». Rundes aldri. */
export function formatWholeNumber(value: number): string {
  const sign = value < 0 ? "-" : "";
  const digits = String(Math.trunc(Math.abs(value)));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/gu, NBSP);
}

/** Tall med komma som desimaltegn: 14.9 → «14,9». */
export function formatDecimal(value: number): string {
  const whole = Math.trunc(value);
  const rest = String(Math.abs(value)).split(".")[1];
  const prefix = value < 0 && whole === 0 ? "-" : "";
  return rest ? `${prefix}${formatWholeNumber(whole)},${rest}` : formatWholeNumber(whole);
}

// --- TG ------------------------------------------------------------------------------------

/**
 * Kilden for den lange formen på TG: forskriften til avhendingslova (tryggere bolighandel) § 2-23.
 * Står i bakgrunnen, ikke i rapportteksten.
 */
export const TG_LABEL_SOURCE = "Forskrift til avhendingslova (tryggere bolighandel) § 2-23";

export const TG_SHORT_LABELS: Record<CheckpointTg, string> = {
  "0": "TG0",
  "1": "TG1",
  "2": "TG2",
  "3": "TG3",
  IU: "TGIU",
};

export const TG_LONG_LABELS: Record<CheckpointTg, string> = {
  "0": "Ingen avvik",
  "1": "Mindre avvik",
  "2": "Vesentlige avvik",
  "3": "Store eller alvorlige avvik",
  IU: "Ikke undersøkt",
};

/** «TG3 Store eller alvorlige avvik». */
export function tgFullLabel(tg: CheckpointTg): string {
  return `${TG_SHORT_LABELS[tg]} ${TG_LONG_LABELS[tg]}`;
}

/** Når punktet ikke har TG ennå. */
export const TG_NOT_SET_LABEL = "Ikke satt";

// --- Status og fremdrift ---------------------------------------------------------------------

export const CHECKPOINT_STATUS_LABELS: Record<CheckpointStatus, string> = {
  not_started: "Ikke startet",
  in_progress: "I arbeid",
  done: "Ferdig",
  tgiu: "TGIU – ikke undersøkt",
};

/** «3 av 8 ferdig». */
export function progressText(done: number, total: number): string {
  return `${done} av ${total} ferdig`;
}

/** «3 å se over – gå til neste» i listehodet. Teller punkter, ikke advarsler. */
export function reviewCountText(count: number): string {
  return `${count} å se over – gå til neste`;
}

// --- Advarsler -----------------------------------------------------------------------------

/** Hva som mangler, slik det står i advarslene. */
export const WARNING_MISSING_PART_LABELS: Record<WarningMissingPart, string> = {
  cause_criterion: "årsak",
  cause_text: "årsak",
  consequence_text: "konsekvens",
  measure: "tiltak",
  reason: "hva som ikke er undersøkt, og hvorfor",
  risk_assessment: "risiko",
  how_to_examine: "hva som må til for å undersøke",
  alternative_check_method: "annen fuktkontroll",
  alternative_check_result: "resultat av annen fuktkontroll",
  construction_vulnerable: "skadeutsatt konstruksjon",
  owner_informed: "at eier er informert om utvidet ansvar",
};

/** Grunnteksten for hver advarsel. Advarslene med `missing` får delene lagt til i `warningText`. */
export const WARNING_TEXTS: Record<CheckpointWarningCode, string> = {
  deviation_tg_not_chosen: "Velg TG2 eller TG3.",
  tg2_tg3_missing_cause_or_consequence: "Avviket mangler årsak eller konsekvens.",
  tg2_tg3_missing_measure: "Avviket mangler tiltak.",
  tg3_missing_cost: "TG3 skal ha kostnad.",
  cost_amount_not_rounded: "Beløpet er ikke rundet til nærmeste 10 000.",
  hms_missing_consequence_or_measure: "HMS-avviket mangler konsekvens eller tiltak.",
  tgiu_details_missing: "Fyll ut dette for TGIU.",
  tgiu_suggested_not_set: "Hulltaking er ikke utført. Punktet bør ha TGIU.",
  no_findings_with_reading_over_limit:
    "Målingen er på eller over grensen. Endre til «Utført med funn»?",
  suggestion_no_longer_applies: "Et forslag fra reglene gjelder ikke lenger.",
  texts_written_for_other_tg: "Se over konsekvens og tiltak. Teksten hører til en annen TG.",
  checkpoint_done_without_tg: "Punktet er ferdig uten TG. Velg TG eller legg til avvik.",
  tg3_on_age_only:
    "TG3 er satt bare på grunn av alder. Se over om skade eller annen svikt er beskrevet, eller bruk TG2.",
  open_suggestion_on_done_checkpoint:
    "Punktet er ferdig, men et forslag fra reglene er ikke avgjort.",
};

/** «TG3», «TG0», «TGIU», «TG2 eller TG3» for et regelforslag. */
export function suggestionTgLabel(tg: SuggestionTg): string {
  if (tg === "choose") return `${TG_SHORT_LABELS["2"]} eller ${TG_SHORT_LABELS["3"]}`;
  return TG_SHORT_LABELS[String(tg) as CheckpointTg];
}

/** «Punktet er ferdig, men forslaget om TG3 er ikke avgjort.» (A492) */
export function openSuggestionOnDoneText(tg: SuggestionTg): string {
  return `Punktet er ferdig, men forslaget om ${suggestionTgLabel(tg)} er ikke avgjort.`;
}

/**
 * Foreldet forslag som ikke ga avvik (godtatt TG0, TG1 eller TGIU, T-0115): «Forslaget gjelder ikke
 * lenger. Punktet har fortsatt TG0 fra forslaget. Sjekk at graden stemmer.»
 */
export function suggestionNoLongerAppliesWithoutDeviationText(chosenTg: ChosenTg): string {
  return `Forslaget gjelder ikke lenger. Punktet har fortsatt ${TG_SHORT_LABELS[chosenTg]} fra forslaget. Sjekk at graden stemmer.`;
}

/**
 * Det advarselsteksten trenger utover koden. Fylles av den som kaller fra rommets visning:
 * forslagets TG (`open_suggestion_on_done_checkpoint`) og valgt TG i beslutningen
 * (`suggestion_no_longer_applies` uten avvik). Uten verdi brukes grunnteksten.
 */
export type WarningTextContext = {
  suggestionTg?: SuggestionTg | null;
  chosenTg?: ChosenTg | null;
};

/** «årsak og konsekvens», «årsak, konsekvens og tiltak». Samme del nevnes én gang. */
function joinParts(parts: readonly WarningMissingPart[]): string {
  const words = [...new Set(parts.map((part) => WARNING_MISSING_PART_LABELS[part]))];
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} og ${words[words.length - 1]}`;
}

/** Teksten for en advarsel, med det som mangler når advarselen sier hva. */
export function warningText(warning: CheckpointWarning, context: WarningTextContext = {}): string {
  if (warning.code === "open_suggestion_on_done_checkpoint" && context.suggestionTg) {
    return openSuggestionOnDoneText(context.suggestionTg);
  }
  // Uten avvik gjelder advarselen TG på punktet; med avvik er teksten som før.
  if (
    warning.code === "suggestion_no_longer_applies" &&
    warning.deviationId === null &&
    context.chosenTg
  ) {
    return suggestionNoLongerAppliesWithoutDeviationText(context.chosenTg);
  }
  if (warning.missing.length === 0) return WARNING_TEXTS[warning.code];
  switch (warning.code) {
    case "tg2_tg3_missing_cause_or_consequence":
    case "tg2_tg3_missing_measure":
      return `Avviket mangler ${joinParts(warning.missing)}.`;
    case "hms_missing_consequence_or_measure":
      return `HMS-avviket mangler ${joinParts(warning.missing)}.`;
    case "tgiu_details_missing":
      return `Fyll ut dette for TGIU: ${joinParts(warning.missing)}.`;
    default:
      return WARNING_TEXTS[warning.code];
  }
}

/** Advarselen i avvikskortet når TG er byttet bort fra utfallets TG: «… Teksten hører til TG3.» */
export function textsWrittenForTgText(outcomeTg: 2 | 3): string {
  return `Se over konsekvens og tiltak. Teksten hører til TG${outcomeTg}.`;
}

/** Advarselen ved et TGIU-felt som mangler (design avsnitt 12). */
export const TGIU_FIELD_MISSING_TEXT = "Fyll ut dette for TGIU.";

/** Knappeteksten bak «Rett nå». */
export const WARNING_FIX_LABELS: Record<WarningFixKind, string> = {
  change_answer: "Endre til utført med funn",
  focus_field: "Rett nå",
  focus_tg_choice: "Rett nå",
  scroll_to_suggestion: "Gå til forslaget",
};

/** Knappene når et godtatt avvik henger på et forslag som ikke gjelder lenger (A388). */
export const STALE_DEVIATION_ACTION_LABELS = {
  remove_deviation: "Fjern avviket",
  keep_deviation: "Behold avviket",
} as const;

// --- Regelforslag --------------------------------------------------------------------------

/** Overskriften på forslagskortet. Regelforslag er ikke KI. */
export const RULE_SUGGESTION_HEADING = "Forslag fra reglene";

export const SUGGESTION_KIND_TEXTS = {
  tgiu: "Sett TGIU på punktet",
  tg0: "Sett TG0 på punktet",
} as const;

export const DECISION_LABELS: Record<RuleSuggestionDecision, string> = {
  accepted: "Godtatt",
  changed: "Endret",
  rejected: "Avvist",
};

/** Begrunnelsesknappene ved Endre og Avvis (A380), i rekkefølgen i `OVERRIDE_REASON_CODES`. */
export const OVERRIDE_REASON_LABELS: Record<OverrideReasonCode, string> = {
  documentation_present: "Dokumentasjon er lagt fram",
  visible_damage: "Synlig skade",
  measured_again: "Målt på nytt",
  age_known_otherwise: "Alderen er kjent på annen måte",
  other: "Annet",
};

/** Meldingene fra `checkOverrideReason`. `ok` har ingen melding. */
export const OVERRIDE_REASON_CHECK_MESSAGES: Record<Exclude<OverrideReasonCheck, "ok">, string> = {
  reason_required: "Velg en grunn for å lagre.",
  text_required: "Skriv grunnen når du velger «Annet».",
  not_allowed_when_accepted: "Godta skal ikke ha grunn.",
};

/** Når regelens forslag ikke slår til på serveren lenger. */
export const SUGGESTION_STALE_TEXT =
  "Forslaget gjelder ikke lenger. Feltet det bygde på er endret. Avviket du godtok, står fortsatt.";

/** «Behold avvikene» ved Godta TGIU eller TG0 på punkt med avvik med TG (A395). */
export const SUGGESTION_OPEN_WITH_TG_DEVIATIONS_TEXT =
  "Punktet har avvik med TG. Forslaget står åpent til du godtar, endrer eller avviser det.";

export const INSPECTION_YEAR_SOURCE_LABELS: Record<
  (typeof INSPECTION_YEAR_SOURCES)[number],
  string
> = {
  assignment: "Befaringsåret er hentet fra oppdraget.",
  today: "Oppdraget har ingen befaringsdato, så årets år er brukt.",
};

/**
 * Begrunnelseskodene fra regelmotoren: på en betingelse (`ConditionReasonCode`) og på hele
 * regelen (`RuleReasonCode`). Sier hva som mangler eller hva takstmannen bør vite.
 */
export const RULE_REASON_TEXTS: Record<ConditionReasonCode | RuleReasonCode, string> = {
  condition_type_not_supported: "Regelen har en betingelse som ikke kan vurderes ennå.",
  condition_incomplete: "Regelen er ikke ferdig satt opp i malen. Si fra til den som har malen.",
  field_empty: "Feltet er ikke fylt ut.",
  value_not_number: "Verdien er ikke et tall.",
  value_negative: "Verdien kan ikke være under 0.",
  unit_missing: "Velg enhet for målingen.",
  unit_not_supported:
    "Målingen er gjort i en annen enhet enn grensen gjelder for. Vurder den selv.",
  threshold_unknown: "Grensen for målingen mangler i malen. Si fra til den som har malen.",
  year_missing: "Fyll ut årstallet.",
  year_invalid: "Årstallet må være et helt år.",
  year_after_inspection: "Årstallet er etter befaringsåret.",
  inspection_year_missing: "Befaringsåret mangler.",
  material_unknown: "Velg materialet.",
  documentation_not_stated:
    "Det er ikke oppgitt om dokumentasjon finnes. Alderen for sjikt uten dokumentasjon er brukt.",
  stricter_step_applies: "Et strengere forslag gjelder i stedet.",
  purpose_not_supported: "Denne typen regel vurderes ikke ennå.",
  tg_logic_not_allowed: "TG-forslag gis bare i systemmalen for tilstandsrapport.",
  no_conditions: "Regelen har ingen betingelser.",
  target_missing: "Regelen mangler hva den skal foreslå. Si fra til den som har malen.",
};

/** Kodene der «ikke vurdert» betyr at et felt må fylles ut. */
const FILL_IN_CODES: readonly ConditionReasonCode[] = ["field_empty", "year_missing"];

/** Navn fra maldokumentet. Råkoder vises aldri: uten navn faller teksten tilbake til koden. */
export type ReasonLabelLookup = {
  elementLabel: (elementKey: string) => string | null;
  optionLabel: (elementKey: string, optionKey: string) => string | null;
};

/** En linje i begrunnelsen. `elementKey` gir «Gå til feltet» (A389). */
export type ReasonLine = { text: string; elementKey: string | null };

function lowerFirst(text: string): string {
  return text.charAt(0).toLocaleLowerCase("nb") + text.slice(1);
}

function elementKeyOf(reason: RuleReason): string | null {
  if (reason.type === "age_vs_lifespan") return reason.year_element_key;
  if (reason.type === "unsupported") return null;
  return reason.element_key;
}

/** Hva som må til for at regelen kan vurderes, med feltet det gjelder. */
export function notEvaluatedLines(result: RuleResult, labels: ReasonLabelLookup): ReasonLine[] {
  if (result.code !== null) return [{ text: RULE_REASON_TEXTS[result.code], elementKey: null }];
  const lines: ReasonLine[] = [];
  for (const reason of result.reasons) {
    if (reason.truth !== "unknown" || reason.code === null) continue;
    const elementKey = elementKeyOf(reason);
    const label = elementKey ? labels.elementLabel(elementKey) : null;
    const text =
      label && FILL_IN_CODES.includes(reason.code)
        ? `Fyll ut ${lowerFirst(label)}.`
        : RULE_REASON_TEXTS[reason.code];
    lines.push({ text, elementKey });
  }
  if (lines.length === 0) lines.push({ text: RULE_REASON_TEXTS.field_empty, elementKey: null });
  return lines;
}

/** «Hvorfor»-linjene for et forslag: én per betingelse, med tall og navn, aldri råkoder. */
export function reasonLines(result: RuleResult, labels: ReasonLabelLookup): ReasonLine[] {
  const lines: ReasonLine[] = [];
  for (const reason of result.reasons) {
    const elementKey = elementKeyOf(reason);
    const label = elementKey ? labels.elementLabel(elementKey) : null;
    let text: string | null = null;
    if (reason.type === "option_selected" && label && reason.element_key) {
      const elementKeyForOptions = reason.element_key;
      const chosen = reason.selected_option_keys
        .map((key) => labels.optionLabel(elementKeyForOptions, key))
        .filter((name): name is string => name !== null);
      if (chosen.length > 0) text = `${label}: ${chosen.join(", ")}.`;
    } else if (reason.type === "number_vs_limit" && label && reason.value !== null) {
      const limit = reason.limit !== null ? ` Grensen er ${formatDecimal(reason.limit)}.` : "";
      text = `${label}: ${formatDecimal(reason.value)}.${limit}`;
    } else if (reason.type === "age_vs_lifespan" && reason.year !== null) {
      // Uten befaringsår er alderen ukjent, men «før 2000» avgjøres av årstallet alene.
      const from = label ? `${label}: ${reason.year}` : `Årstallet er ${reason.year}`;
      text = reason.age !== null ? `${from}, ${reason.age} år ved befaringen.` : `${from}.`;
    }
    if (text) lines.push({ text, elementKey });
    if (reason.code !== null && reason.truth !== "unknown") {
      lines.push({ text: RULE_REASON_TEXTS[reason.code], elementKey: null });
    }
  }
  return lines;
}

// --- Avvikskortet --------------------------------------------------------------------------

type CauseCriterion = (typeof CAUSE_CRITERIA)[number];

/** Årsakskriteriene som knapper i avvikskortet. */
export const CAUSE_CRITERION_LABELS: Record<CauseCriterion, string> = {
  symptom_of_damage: "Tegn på skade",
  age_uncertain_function: "Alder gir usikker funksjon",
  significant_deviation: "Vesentlig avvik fra krav",
  functional_failure: "Svikt i funksjon",
  danger_to_life_health: "Fare for liv og helse",
  missing_documentation: "Dokumentasjon mangler",
  other: "Annet",
};

export const CONSTRUCTION_VULNERABLE_LABELS: Record<ConstructionVulnerable, string> = {
  yes: "Ja",
  no: "Nei",
  unknown: "Vet ikke",
};

/** Etikettene på TGIU-feltene (design avsnitt 12). */
export const TGIU_FIELD_LABELS = {
  reason: "Hva er ikke undersøkt, og hvorfor?",
  risk_assessment: "Risiko",
  how_to_examine: "Hva må til for å undersøke?",
  alternative_check_method: "Annen fuktkontroll",
  alternative_check_result: "Resultat av annen fuktkontroll",
  construction_vulnerable: "Skadeutsatt konstruksjon",
  owner_informed: "Eier er informert om utvidet ansvar",
} as const;

// --- Flettefelt ----------------------------------------------------------------------------

export const MERGE_FIELD_LABELS: Record<MergeFieldKey, string> = {
  årstall: "årstall",
  måleverdi: "måleverdi",
  enhet: "enhet",
  sted: "sted",
};

/** Markøren for et flettefelt uten verdi: «[årstall mangler]». Aldri `{…}`. */
export function mergeFieldMissingText(field: MergeFieldKey): string {
  return `[${MERGE_FIELD_LABELS[field]} mangler]`;
}

/** Advarselen under et tekstfelt med flettefelt uten verdi. */
export function mergeFieldWarningText(field: MergeFieldKey): string {
  return `Fyll inn ${MERGE_FIELD_LABELS[field]} i teksten.`;
}

// --- Kostnad -------------------------------------------------------------------------------

export const COST_TYPE_LABELS: Record<CostType, string> = {
  band: "Intervall",
  approx: "Eget beløp",
  none: "Ingen",
};

/** Etikettene på de fem intervallene (`COST_BANDS`). Egne ord, utkast. */
export const COST_BAND_LABELS: Record<CostBandKey, string> = {
  under_20000: `Under ${formatWholeNumber(20000)}`,
  from_20000_to_100000: `${formatWholeNumber(20000)}–${formatWholeNumber(100000)}`,
  from_100000_to_200000: `${formatWholeNumber(100000)}–${formatWholeNumber(200000)}`,
  from_200000_to_500000: `${formatWholeNumber(200000)}–${formatWholeNumber(500000)}`,
  over_500000: `Over ${formatWholeNumber(500000)}`,
};

/** Feilmeldingene fra `parseCostAmount`. */
export const COST_AMOUNT_MESSAGES = {
  empty: "Skriv et beløp.",
  not_number: "Skriv beløpet med tall, for eksempel 40 000.",
  not_whole_above_zero: "Skriv et helt beløp over 0.",
  too_large: "Beløpet er for stort.",
} as const;

/** «Beløpet er ikke rundet til nærmeste 10 000. Nærmeste er 40 000.» */
export function costNotRoundedText(nearest: number): string {
  return `Beløpet er ikke rundet til nærmeste ${formatWholeNumber(COST_AMOUNT_ROUNDING)}. Nærmeste er ${formatWholeNumber(nearest)}.`;
}

/** «Bruk 40 000». */
export function useRoundedAmountText(nearest: number): string {
  return `Bruk ${formatWholeNumber(nearest)}`;
}
