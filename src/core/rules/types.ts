import type { TemplateDocument, TemplateKind } from "@/core/templates";
import type { RuleConditionType, RulePurpose, RuleResultState, TextStatus } from "@/db/schema";
import type {
  CONDITION_REASON_CODES,
  CONDITION_TRUTHS,
  LIFESPAN_DOCUMENTATION,
  LIFESPAN_OUTCOME_KINDS,
  RULE_REASON_CODES,
  RULE_TEST_FAILURES,
  THRESHOLD_COMPARATORS,
} from "./codes";

/**
 * Grensesnittet til regelmotoren (docs/adr/0008-regelmotoren.md,
 * docs/funksjoner/fase2a-regler-bad.md).
 *
 * Motoren er rene funksjoner uten database, server eller nettleser-API, slik at samme kode kjører
 * på iPaden og på serveren. Den kaller aldri KI. Alt den trenger, kommer inn som argument:
 * malens regler, svarene, befaringsåret, levetidene og tersklene. Svaret inneholder bare faste
 * koder og tall, aldri id-er, fritekst eller persondata.
 */

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type ConditionTruth = (typeof CONDITION_TRUTHS)[number];
export type LifespanDocumentation = (typeof LIFESPAN_DOCUMENTATION)[number];
export type LifespanOutcomeKind = (typeof LIFESPAN_OUTCOME_KINDS)[number];
export type ThresholdComparator = (typeof THRESHOLD_COMPARATORS)[number];
/** Sammenligning i `number_vs_limit`. `eq` er bare lov med fast verdi, ikke i terskeldata. */
export type NumberComparator = ThresholdComparator | "eq";
export type ConditionReasonCode = (typeof CONDITION_REASON_CODES)[number];
export type RuleReasonCode = (typeof RULE_REASON_CODES)[number];
export type RuleTestFailure = (typeof RULE_TEST_FAILURES)[number];

// --- Levetider og terskler (kodedata nå, tabeller i 2a-3 med samme form og koder) -------------

/**
 * Ett trinn i levetidstabellen (`lifespan_entries` i domenemodellen 4.5).
 *
 * Et trinn passer når materialet stemmer (`material_code` tom = alle materialer), årstallet ligger
 * i `from_year`–`to_year` (begge med, tom = ingen grense), alderen er lik eller over `min_age`
 * (tom = ingen aldersgrense) og `documentation` stemmer. Passer flere trinn, vinner det strengeste
 * (`tg3` foran `tg2`), og deretter laveste `sort_order`.
 */
export type LifespanEntry = {
  /** Fast kode på trinnet. Endres aldri. */
  key: string;
  /** Materialkoden, samme kode som valget i materialfeltet. `null` = alle materialer. */
  material_code: string | null;
  /** Komponenten, for eksempel «Skjult vanntett sjikt – foliemembran». Vises ikke i rapporten. */
  component: string;
  from_year: number | null;
  to_year: number | null;
  /** Alder i år. Alder lik `min_age` gir trinnet. */
  min_age: number | null;
  documentation: LifespanDocumentation;
  outcome_kind: LifespanOutcomeKind;
  /** Kilde i bakgrunnen. Står ikke i rapporten. */
  source_ref: string;
  sort_order: number;
  /** `draft` = «utkast, ikke godkjent av fagrådet». */
  status: TextStatus;
};

/** Et sett levetider med fast kode. Koden følger med i regelsvaret. */
export type LifespanSet = {
  key: string;
  entries: readonly LifespanEntry[];
};

/** Én terskel for en måling (`threshold_entries` i domenemodellen 4.5). */
export type ThresholdEntry = {
  /** Fast kode på terskelen. Endres aldri. */
  key: string;
  /** Hva som måles. Vises ikke i rapporten. */
  description: string;
  /** Enheten grensen gjelder for, samme kode som valget i enhetsfeltet. */
  unit: string;
  value: number;
  /** Retningen. Står bare her, aldri på betingelsen. */
  comparator: ThresholdComparator;
  /** Kilde i bakgrunnen. Står ikke i rapporten. */
  source_ref: string;
  /** `draft` = «utkast, ikke godkjent av fagrådet». */
  status: TextStatus;
};

/** Et sett terskler med fast kode. Koden følger med i regelsvaret. */
export type ThresholdSet = {
  key: string;
  entries: readonly ThresholdEntry[];
};

// --- Inndata -------------------------------------------------------------------------------

/** Svarene motoren leser: fast kode på feltet → verdi. Valgfelt har valgkoden som verdi. */
export type RuleAnswers = Readonly<Record<string, JsonValue>>;

/** Den delen av maldokumentet motoren leser. */
export type RuleDocument = Pick<
  TemplateDocument,
  "rules" | "rule_conditions" | "outcomes" | "element_options"
>;

/** Malen reglene kommer fra. TG-logikk kjøres bare for `system` + `condition_report`. */
export type RuleTemplateInfo = {
  kind: TemplateKind;
  reportType: string;
};

export type EvaluateRulesInput = {
  template: RuleTemplateInfo;
  document: RuleDocument;
  answers: RuleAnswers;
  /** Året befaringen ble gjort. Alder regnes mot dette, aldri mot dagens dato. */
  inspectionYear: number | null;
  lifespans: LifespanSet;
  thresholds: ThresholdSet;
};

export type RunRuleTestCasesInput = {
  template: RuleTemplateInfo;
  document: RuleDocument & Pick<TemplateDocument, "rule_test_cases">;
  lifespans: LifespanSet;
  thresholds: ThresholdSet;
};

// --- Regelsvar -----------------------------------------------------------------------------

/** Et utfall med de tre faste kodene (samme form som i maldokumentet). */
export type OutcomeRef = {
  checkpoint_key: string;
  question_key: string;
  outcome_key: string;
};

/**
 * Forslaget fra en regel som slo til. Aldri TG0, og aldri en ferdig satt TG: takstmannen godtar,
 * endrer eller avviser. `tgiu` er et forslag om TGIU på kontrollpunktet, ikke et utfall.
 */
export type RuleSuggestion =
  ({ kind: "outcome" } & OutcomeRef) | { kind: "tgiu"; checkpoint_key: string };

type ConditionReasonBase = {
  /** Gruppen betingelsen hører til. `null` = uten gruppe. */
  group_no: number | null;
  truth: ConditionTruth;
  /** Hvorfor betingelsen er `unknown`, eller en opplysning om forslaget. `null` = ingen. */
  code: ConditionReasonCode | null;
};

export type OptionSelectedReason = ConditionReasonBase & {
  type: "option_selected";
  element_key: string | null;
  /**
   * Valgkodene som er krysset av. Bare koder som finnes som valg på feltet i malen tas med, så
   * fritekst aldri kan havne i begrunnelsen.
   */
  selected_option_keys: string[];
};

export type NumberVsLimitReason = ConditionReasonBase & {
  type: "number_vs_limit";
  element_key: string | null;
  /** Måleverdien. `null` når feltet er tomt eller ikke et tall. */
  value: number | null;
  /** Enheten målingen er gjort i (valgkode). `null` når betingelsen ikke leser enhet. */
  unit: string | null;
  /** Terskelens kode. `null` når betingelsen har fast verdi. */
  threshold_key: string | null;
  limit: number | null;
  comparator: NumberComparator | null;
  /** Om terskelen er godkjent av fagrådet. `null` ved fast verdi. */
  threshold_status: TextStatus | null;
};

export type AgeVsLifespanReason = ConditionReasonBase & {
  type: "age_vs_lifespan";
  /** Årstallet som ble brukt. */
  year: number | null;
  /** Feltet årstallet kom fra: årstallfeltet eller reservefeltet (byggeåret). */
  year_element_key: string | null;
  /** Kilden for alderen (valgkode fra kildefeltet). Stopper aldri forslaget. */
  year_source: string | null;
  inspection_year: number | null;
  /** Alder i år: befaringsåret minus årstallet. */
  age: number | null;
  /** Materialkoden (valgkode). `null` når den er tom eller ikke finnes som valg. */
  material_code: string | null;
  /** Hvilke trinn som ble brukt: `with` eller `without`. Tomt felt gir `without`. */
  documentation: Exclude<LifespanDocumentation, "any"> | null;
  /** Det strengeste trinnet som passet. `null` = ingen trinn passet. */
  lifespan_entry_key: string | null;
  lifespan_outcome_kind: LifespanOutcomeKind | null;
  lifespan_min_age: number | null;
  /** Om trinnet er godkjent av fagrådet. */
  lifespan_status: TextStatus | null;
};

/** En betingelse av en type motoren ikke kjører ennå. Alltid `unknown`. */
export type UnsupportedConditionReason = ConditionReasonBase & {
  type: "unsupported";
  condition_type: RuleConditionType;
};

/** Begrunnelsen for én betingelse. Én variant per betingelsestype, bare koder og tall. */
export type RuleReason =
  OptionSelectedReason | NumberVsLimitReason | AgeVsLifespanReason | UnsupportedConditionReason;

/**
 * Svaret fra én regel.
 *
 * - `triggered`: regelen slo til, og `suggestion` er satt.
 * - `not_triggered`: regelen slo ikke til. `suggestion` er `null`.
 * - `not_evaluated`: regelen kunne ikke vurderes. `suggestion` er `null`. Aldri en stille
 *   «slår ikke til».
 */
export type RuleResult = {
  rule_key: string;
  purpose: RulePurpose;
  state: RuleResultState;
  suggestion: RuleSuggestion | null;
  /** Hvorfor hele regelen ikke ble kjørt. `null` når betingelsene er vurdert. */
  code: RuleReasonCode | null;
  /** Én begrunnelse per aktive betingelse, i betingelsenes rekkefølge. */
  reasons: RuleReason[];
  /** Levetidssettet regelen leste. `null` når regelen ikke har `age_vs_lifespan`. */
  lifespan_set_key: string | null;
  /** Terskelsettet regelen leste. `null` når ingen betingelse har `threshold_key`. */
  threshold_set_key: string | null;
};

/** Resultatet av én testsak. */
export type RuleTestCaseResult = {
  rule_key: string;
  name: string;
  sort_order: number;
  passed: boolean;
  /** Hvorfor testsaken ikke besto. `null` når den besto. */
  failure: RuleTestFailure | null;
  expected_state: RuleResultState;
  expected_outcome: OutcomeRef | null;
  /** Regelsvaret. `null` når regelen ikke finnes eller ikke er aktiv. */
  result: RuleResult | null;
};

// --- Funksjonene (bygges av utvikleren i `evaluate.ts` og `test-cases.ts`) --------------------

/**
 * Kjører alle aktive regler i dokumentet mot svarene. Ren funksjon: samme inndata gir samme svar.
 *
 * - Ett svar per aktive regel, sortert på `sort_order` og så `key`. Regler og betingelser med
 *   `active = false` eller `deleted_at` satt gir ingen svar. Motoren sjekker dette selv og stoler
 *   ikke på at dokumentet er rent.
 * - Bare `suggest_outcome` og `suggest_tgiu` kjøres (`show` og `validate` gir `not_evaluated`
 *   med `purpose_not_supported`), og bare når malen er `system` + `condition_report` (ellers
 *   `not_evaluated` med `tg_logic_not_allowed`).
 * - Treverdilogikk. `all`: én usann gir `not_triggered`, ellers gir én ukjent `not_evaluated`,
 *   ellers `triggered`. `any`: én sann gir `triggered`, ellers gir én ukjent `not_evaluated`,
 *   ellers `not_triggered`. Betingelser med samme `group_no` slås sammen med regelens `match`
 *   til én verdi; gruppene og betingelsene uten gruppe slås så sammen med samme `match`.
 * - `age_vs_lifespan` er sann når det strengeste trinnet som passer, har samme `outcome_kind`
 *   som regelens foreslåtte utfall (`document.outcomes`).
 * - Kaster aldri på ugyldige svar. Tomt eller ugyldig felt gir `not_evaluated`.
 */
export type EvaluateRules = (input: EvaluateRulesInput) => RuleResult[];

/**
 * Kjører testsakene i dokumentet. Hver testsak kjører bare sin egen regel, med `input` som svar og
 * testsakens `inspection_year` som befaringsår. En testsak består når tilstanden er som forventet
 * og, når `expected_outcome` er satt, forslaget er dette utfallet. Ett resultat per testsak, sortert
 * på regelkode, `sort_order` og navn.
 */
export type RunRuleTestCases = (input: RunRuleTestCasesInput) => RuleTestCaseResult[];
