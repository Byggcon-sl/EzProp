/**
 * Faste koder for regelmotoren (docs/adr/0008-regelmotoren.md). Kodene endres aldri etter at de
 * er tatt i bruk (regel 6). Nye koder legges til i listene.
 */

/** Betingelsestypene motoren kjører nå. Alle andre typer gir `not_evaluated`. */
export const SUPPORTED_CONDITION_TYPES = [
  "option_selected",
  "number_vs_limit",
  "age_vs_lifespan",
] as const;

/** Sannhetsverdien til én betingelse eller gruppe (treverdilogikk). */
export const CONDITION_TRUTHS = ["true", "false", "unknown"] as const;

/** Om et levetidstrinn gjelder med dokumentasjon, uten dokumentasjon eller uansett. */
export const LIFESPAN_DOCUMENTATION = ["with", "without", "any"] as const;

/** Hva et levetidstrinn foreslår. Rekkefølgen er strenghet: siste er strengest. */
export const LIFESPAN_OUTCOME_KINDS = ["tg2", "tg3"] as const;

/** Retningen på en terskel. `gte` = lik eller over grensen slår til. */
export const THRESHOLD_COMPARATORS = ["gt", "gte", "lt", "lte"] as const;

/**
 * Begrunnelseskoder på en betingelse. Sier hvorfor betingelsen ikke kunne vurderes, eller noe
 * takstmannen bør vite om forslaget. Aldri fritekst.
 */
export const CONDITION_REASON_CODES = [
  /** Betingelsestypen kjøres ikke av motoren ennå. */
  "condition_type_not_supported",
  /** Betingelsen mangler noe den må ha (felt, verdi, operator). Feil i malen. */
  "condition_incomplete",
  /** Feltet betingelsen leser, er tomt. */
  "field_empty",
  /** Verdien er ikke et tall. */
  "value_not_number",
  /** Verdien er negativ. */
  "value_negative",
  /** Måling uten enhet. */
  "unit_missing",
  /** Målingen er i en annen enhet enn terskelen. */
  "unit_not_supported",
  /** Terskelkoden finnes ikke i terskelsettet. */
  "threshold_unknown",
  /** Verken årstallet eller reserveårstallet er fylt ut. */
  "year_missing",
  /** Årstallet er ikke et heltall. */
  "year_invalid",
  /** Årstallet er etter befaringsåret. */
  "year_after_inspection",
  /** Befaringsåret mangler. */
  "inspection_year_missing",
  /** Materialet er ukjent eller ikke valgt, og ingen rad uten materialkode passer. */
  "material_unknown",
  /** Dokumentasjon er ikke oppgitt. Trinnene for «uten» er brukt. Stopper ikke forslaget. */
  "documentation_not_stated",
  /** Et strengere trinn passer. Denne regelen slår derfor ikke til. */
  "stricter_step_applies",
] as const;

/** Begrunnelseskoder på hele regelen når den ikke kjøres. */
export const RULE_REASON_CODES = [
  /** Regelen har et formål motoren ikke kjører ennå (`show`, `validate`). */
  "purpose_not_supported",
  /** TG-logikk i en mal som ikke er systemmalen for tilstandsrapport. */
  "tg_logic_not_allowed",
  /** Regelen har ingen aktive betingelser. */
  "no_conditions",
  /** `suggest_outcome` uten utfall, eller `suggest_tgiu` uten kontrollpunkt. Feil i malen. */
  "target_missing",
] as const;

/** Hvorfor en testsak ikke besto. */
export const RULE_TEST_FAILURES = [
  /** Testsaken peker på en regel som ikke finnes eller ikke er aktiv. */
  "rule_missing",
  /** Tilstanden ble en annen enn forventet. */
  "state_mismatch",
  /** Regelen slo til, men foreslo et annet utfall enn forventet. */
  "outcome_mismatch",
] as const;
