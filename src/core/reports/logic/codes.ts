/**
 * Faste koder for rapporten som både nettleseren og serveren bruker (ADR 0013,
 * docs/funksjoner/fase2a-badet-pc.md). Rent blad: ingen database, ingen pakker.
 *
 * Kodene endres aldri (regel 6). Nye koder legges til sist. Kodene som også står i CHECK-regler,
 * ligger i `@/db/schema/reports` og hentes derfra med `import type`.
 */

/** TG slik den vises på et kontrollpunkt. `null` = ingen TG ennå. */
export const CHECKPOINT_TG_VALUES = ["0", "1", "2", "3", "IU"] as const;

/** Status på et kontrollpunkt i listen. `tgiu` vises i stedet for `done` når punktet har TGIU. */
export const CHECKPOINT_STATUSES = ["not_started", "in_progress", "done", "tgiu"] as const;

/**
 * Advarslene på et kontrollpunkt. Ingen av dem sperrer nå; sperrene kommer med publisering.
 * `tg2_tg3_missing_cause_or_consequence`, `tg3_missing_cost` og `cost_amount_not_rounded` er de
 * samme kodene som kontrollen før publisering bruker (`check_code`, domenemodellen 4.7).
 */
export const CHECKPOINT_WARNING_CODES = [
  /** Avvik fra «velg TG2 eller TG3» uten valgt TG. */
  "deviation_tg_not_chosen",
  /** TG2 eller TG3 uten årsak (kriterium og tekst) eller uten konsekvens. `missing` sier hva. */
  "tg2_tg3_missing_cause_or_consequence",
  /** TG2 eller TG3 uten tiltak. */
  "tg2_tg3_missing_measure",
  /** TG3 uten kostnad (`cost_type = none`). */
  "tg3_missing_cost",
  /** Eget beløp som ikke er rundet til nærmeste 10 000. */
  "cost_amount_not_rounded",
  /** HMS-avvik uten konsekvens eller uten tiltak. `missing` sier hva. */
  "hms_missing_consequence_or_measure",
  /** TGIU der en påkrevd opplysning mangler. `missing` har kolonnenavnene i `tgiu_details`. */
  "tgiu_details_missing",
  /** Reglene foreslår TGIU (hulltaking ikke utført), men punktet har noe annet enn TGIU. */
  "tgiu_suggested_not_set",
  /** «Utført uten funn» med måling lik eller over grensen (T-0059). */
  "no_findings_with_reading_over_limit",
  /** Et godtatt eller endret forslag der regelen ikke lenger slår til. */
  "suggestion_no_longer_applies",
  /** TG er endret, og malen har ikke egen tiltakstekst for den nye TG-en. */
  "texts_written_for_other_tg",
] as const;

/** Det som kan mangle på et avvik eller i TGIU-opplysningene (`CheckpointWarning.missing`). */
export const WARNING_MISSING_PARTS = [
  "cause_criterion",
  "cause_text",
  "consequence_text",
  "measure",
  "reason",
  "risk_assessment",
  "how_to_examine",
  "alternative_check_method",
  "alternative_check_result",
  "construction_vulnerable",
  "owner_informed",
] as const;

/** Resultatet av kontrollen av et eget kostnadsbeløp. `invalid` = 0, negativt eller ikke heltall. */
export const COST_AMOUNT_CHECKS = ["ok", "not_rounded", "invalid"] as const;

/** Eget beløp skal være rundet til nærmeste hele dette (Ståle 27.10.2026). */
export const COST_AMOUNT_ROUNDING = 10000;

/** Flettefeltene i standardtekstene. Uten verdi vises de som manglende, aldri som `{…}`. */
export const MERGE_FIELD_KEYS = ["årstall", "måleverdi", "enhet", "sted"] as const;

/** Tak per kontrollpunkt og per avvik. */
export const MAX_DEVIATIONS_PER_CHECKPOINT = 50;
export const MAX_MEASURES_PER_DEVIATION = 20;

/** Hvor befaringsåret til reglene kom fra: oppdragets befaringstid, eller dagens år i norsk tid. */
export const INSPECTION_YEAR_SOURCES = ["assignment", "today"] as const;

/**
 * KI-målene i rapporten (`AiTargetRef.type` og `fieldKey`, ADR 0006 og A350). Tomme kroker nå:
 * ingen KI-kall bygges i «Badet på PC». For `field_answer` er `fieldKey` feltets faste kode.
 */
export const REPORT_AI_TARGET_FIELDS = {
  deviation: ["description", "cause_text", "consequence_text"],
  deviation_measure: ["text"],
  checkpoint_result: ["description_text"],
  field_answer: null,
} as const;
