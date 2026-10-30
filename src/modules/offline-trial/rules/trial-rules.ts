/** Svaret fra en prøveregel: slår til, slår ikke til eller ikke vurdert. */
export type TrialRuleState = "triggered" | "not_triggered" | "not_evaluated";

/**
 * En regel i prøve E. Formen likner `rules` og `rule_conditions`, men har bare det prøven bruker.
 * «Over» betyr strengt større enn grensen.
 */
export type TrialRule = {
  key: string;
  field: "water_heater_age" | "moisture_floor";
  kind: "age_vs_lifespan" | "number_vs_limit";
  limit: number;
  source_ref: "oppdiktet prøveverdi";
  messages: { triggered: string; not_triggered: string; not_evaluated: string };
};

// Oppdiktet prøveverdi, ikke fag
export const TRIAL_ONLY_LIMITS = { water_heater_age_years: 7, moisture_floor_percent: 42 } as const;

const NOT_EVALUATED = "Prøveregel: ikke vurdert";

export const trialRules: readonly TrialRule[] = [
  {
    key: "trial_water_heater_age",
    field: "water_heater_age",
    kind: "age_vs_lifespan",
    limit: TRIAL_ONLY_LIMITS.water_heater_age_years,
    source_ref: "oppdiktet prøveverdi",
    messages: {
      triggered: `Prøveregel: over prøvegrensen (${TRIAL_ONLY_LIMITS.water_heater_age_years} år)`,
      not_triggered: `Prøveregel: ikke over prøvegrensen (${TRIAL_ONLY_LIMITS.water_heater_age_years} år)`,
      not_evaluated: NOT_EVALUATED,
    },
  },
  {
    key: "trial_moisture_floor_limit",
    field: "moisture_floor",
    kind: "number_vs_limit",
    limit: TRIAL_ONLY_LIMITS.moisture_floor_percent,
    source_ref: "oppdiktet prøveverdi",
    messages: {
      triggered: `Prøveregel: over prøvegrensen (${TRIAL_ONLY_LIMITS.moisture_floor_percent} %)`,
      not_triggered: `Prøveregel: ikke over prøvegrensen (${TRIAL_ONLY_LIMITS.moisture_floor_percent} %)`,
      not_evaluated: NOT_EVALUATED,
    },
  },
];
