import type { OverrideReasonCode } from "@/db/schema";

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
  /**
   * Punktet er merket ferdig uten TG: verken `tg_direct` eller avvik med TG (tomt punkt, eller
   * bare HMS). Forskriften § 2-22 krever TG; sperre ved publisering (A385).
   */
  "checkpoint_done_without_tg",
  /**
   * TG3 der årsaken bare er alder (`cause_criterion = age_uncertain_function`), og utfallet i
   * malen ikke er skrevet for TG3 (`outcomeTg !== 3`, A358 og A396).
   */
  "tg3_on_age_only",
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

/**
 * Grunnene ved Endre og Avvis, i rekkefølgen knappene vises (A380). Samme liste som
 * `OVERRIDE_REASON_CODES` i `@/db/schema/reports` (CHECK-regelen); typesjekken under stopper hvis
 * de to kommer i utakt. Står her også som verdi, fordi nettleseren bare kan hente typer fra
 * skjemaet.
 */
export const OVERRIDE_REASON_CODES = [
  "documentation_present",
  "visible_damage",
  "measured_again",
  "age_known_otherwise",
  "other",
] as const satisfies readonly OverrideReasonCode[];

type SameCodes<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
export type OverrideReasonCodesMatchSchema = Assert<
  SameCodes<(typeof OVERRIDE_REASON_CODES)[number], OverrideReasonCode>
>;

/** Resultatet av kontrollen av begrunnelsen for en beslutning (`CheckOverrideReason`, A398). */
export const OVERRIDE_REASON_CHECKS = [
  "ok",
  /** Endre og Avvis uten kode og uten tekst. */
  "reason_required",
  /** Koden `other` uten tekst. */
  "text_required",
  /** Godta med kode eller tekst. */
  "not_allowed_when_accepted",
] as const;

/** Handlingene bak «Rett nå» på en advarsel (`WarningFix`, A381 og A388). */
export const WARNING_FIX_KINDS = [
  /** T-0059: endre valget til «utført med funn». */
  "change_answer",
  /** Flytt fokus til feltet som mangler. */
  "focus_field",
  /** Flytt fokus til TG-valget på punktet. */
  "focus_tg_choice",
  /** Rull til forslaget som ikke gjelder lenger. */
  "scroll_to_suggestion",
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
 * KI-målene i rapporten. Listen står i `@/shared/config/ai-targets`, slik at `@/core/ai` leser den
 * samme uten å importere rapportkjernen. Eksporteres videre herfra for dem som alt bruker den.
 */
export { REPORT_AI_TARGET_FIELDS } from "@/shared/config/ai-targets";

/**
 * Feltene i avvikskortet som kan få forslag fra frasebanken (A433, A437). De tre første er
 * kolonner på avviket, og valgt tekst erstatter feltet. `new_measure` legger til et nytt tiltak
 * (`DEVIATION_NEW_MEASURE_FIELD_KEY` i `@/shared/config/ai-targets`). Faste koder: brukes som
 * `fieldKey` i `target_ref` med måltypen `deviation`.
 */
export const PHRASE_FIELDS = [
  "deviation_text",
  "cause_text",
  "consequence_text",
  "new_measure",
] as const;

/** Så mange ganger må en kandidat være valgt i organisasjonen for å få merket «Mest brukt» (A468). */
export const PHRASE_MOST_USED_MIN_COUNT = 2;
