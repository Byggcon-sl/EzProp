import type { NumberComparator, RuleReason } from "@/core/rules";
import type {
  ChosenTg,
  DeviationKind,
  DeviationTg,
  EmployeeRole,
  OverrideReasonCode,
  ReportStatus,
  RuleSuggestionDecision,
  StoredRuleSuggestion,
  TgDirect,
} from "@/db/schema";
import type {
  TG_EXPLANATION_UNAVAILABLE_REASONS,
  TG_TRAIL_ACTORS,
  TG_TRAIL_AUDIT_EVENT_KINDS,
  TG_TRAIL_LINE_KINDS,
  TG_TRAIL_SUMMARY_KINDS,
} from "./codes";
import type { CheckpointTg, SuggestionTg } from "./types";

/**
 * Grensesnittet til sporet: «Hvorfor har dette punktet denne TG-en?»
 * (docs/funksjoner/fase2a-tg-spor.md, ADR 0013 punkt 9c). Rent blad: ingen database, ingen pakker,
 * ingen dagens dato. Skjermene importerer typene herfra, og de rene funksjonene bygges i
 * `logic/tg-trail.ts` med tekstene i `logic/labels.ts`.
 *
 * Støtter hovedmålene: færre reklamasjoner (leder svarer med fakta om graden kjøperen fikk), de
 * ansatte (takstmannen ser før publisering hvilke punkter som avviker fra reglene) og KI i bunnen
 * (samme kjede er inndata til forklaringsutkastet).
 *
 * Sporet er en **avledet lesemodell**: det settes sammen ved lesing av `rule_suggestion_decisions`,
 * revisjonsloggen og `report_releases`, og lagres aldri. Funksjonene her setter aldri TG, kjører
 * aldri reglene og leser aldri fritekst fra rapporten. Ingenting her har navn, ansatt-id eller
 * enhets-id: de finnes ikke i typene, så de kan ikke nå nettleseren.
 */

export type TgTrailLineKind = (typeof TG_TRAIL_LINE_KINDS)[number];
export type TgTrailActor = (typeof TG_TRAIL_ACTORS)[number];
export type TgTrailAuditEventKind = (typeof TG_TRAIL_AUDIT_EVENT_KINDS)[number];
export type TgTrailSummaryKind = (typeof TG_TRAIL_SUMMARY_KINDS)[number];
export type TgExplanationUnavailableReason = (typeof TG_EXPLANATION_UNAVAILABLE_REASONS)[number];

// --- Tolket regelsvar (rule_suggestion_decisions.reasons) -------------------------------------

/**
 * Én måling regelen leste, tolket fra `reasons` på beslutningsraden (serverens regelsvar da
 * beslutningen ble tatt, aldri dagens `field_answers`). `limit` og `comparator` vises i panelet
 * («på eller over grensen») og sendes aldri til KI (A597).
 */
export type TgTrailMeasurement = {
  /** `element_key` i regelsvaret. */
  fieldKey: string;
  /** Feltets ledetekst i rapportens låste malversjon. */
  label: string;
  value: number;
  /** Enhetens valgkode i regelsvaret og etiketten i malen («vekt-%»). */
  unitKey: string | null;
  unitLabel: string | null;
  /** Materialet målingen gjelder, når regelen leser det («treverk»). */
  materialKey: string | null;
  materialLabel: string | null;
  limit: number | null;
  comparator: NumberComparator | null;
  /** Terskelens faste kode. Vises ikke; brukes til å finne grensen i «Hvorfor»-linjen. */
  thresholdKey: string | null;
};

/**
 * Årstallet en aldersregel leste. `source = "build_year"` når regelsvarets `year_element_key` er
 * regelens reservefelt (`age_fallback_year_element_key` i den låste malen); da er `sourceKey` og
 * `sourceLabel` kilden til byggeåret («anslått», «oppgitt av eier»).
 */
export type TgTrailYear = {
  year: number;
  age: number | null;
  source: "own" | "build_year";
  sourceKey: string | null;
  sourceLabel: string | null;
  materialKey: string | null;
  materialLabel: string | null;
};

/** Det sporet bruker av ett lagret regelsvar. Tom liste og `null` når ingenting kunne tolkes. */
export type TgTrailReasons = {
  measurements: TgTrailMeasurement[];
  year: TgTrailYear | null;
};

/**
 * Oppslaget den rene tolkingen trenger fra rapportens låste malversjon. Bygges av tjenesten;
 * `logic/` leser aldri databasen. Ukjent kode gir `null` (linjen vises uten etikett, aldri feil).
 */
export type TgTrailTemplateLookup = {
  elementLabel: (elementKey: string) => string | null;
  optionLabel: (elementKey: string, optionKey: string) => string | null;
  /** Feltet enheten og materialet til en måling velges i, for regelen og målefeltet. */
  unitElementKey: (ruleKey: string, elementKey: string) => string | null;
  materialElementKey: (ruleKey: string, elementKey: string) => string | null;
  /** Regelens reservefelt for årstall (byggeåret) og feltet for kilden til det. */
  fallbackYearElementKey: (ruleKey: string) => string | null;
  yearSourceElementKey: (ruleKey: string) => string | null;
  /** Malens TG for et utfall (`SuggestionTg` regnes herfra, som i `room-view.ts`). */
  outcomeTg: (
    checkpointKey: string,
    questionKey: string,
    outcomeKey: string,
  ) => DeviationTg | "choose" | null;
  outcomeLabel: (checkpointKey: string, questionKey: string, outcomeKey: string) => string | null;
};

/**
 * Det sporet leser av én lagret begrunnelse. `reasons` er `unknown[]` i databasen, så formen
 * sjekkes først av et strengt Zod-skjema (`tgTrailStoredReasonSchema` i
 * `src/core/reports/schemas.ts`, utenfor `logic/`, som ikke har pakker). Skjemaet beholder bare
 * nøklene under, kaster ukjente nøkler og gir `null` for et element med ukjent form eller ukjent
 * `type`. Alle nøklene er koder og tall i `RuleReason`; ingen er fritekst.
 *
 * `truth`, `code`, `year_element_key` og `year_source` er med i tillegg til listen i oppgavekortet:
 * uten `code` kan ikke en måling i enhet regelen ikke støtter (`unit_not_supported`) skilles ut,
 * og uten de to årsfeltene kan ikke sporet si om årstallet er sjiktets eget eller byggeåret.
 */
export type TgTrailStoredReason =
  | Pick<
      Extract<RuleReason, { type: "number_vs_limit" }>,
      | "type"
      | "truth"
      | "code"
      | "element_key"
      | "value"
      | "unit"
      | "limit"
      | "comparator"
      | "threshold_key"
    >
  | Pick<
      Extract<RuleReason, { type: "age_vs_lifespan" }>,
      | "type"
      | "truth"
      | "code"
      | "year"
      | "year_element_key"
      | "year_source"
      | "age"
      | "material_code"
    >
  | Pick<
      Extract<RuleReason, { type: "option_selected" }>,
      "type" | "truth" | "code" | "element_key" | "selected_option_keys"
    >;

/**
 * Gjør de tolkede begrunnelsene om til målinger og årstall (ren funksjon). Kaster aldri.
 * - En måling tas bare med når betingelsen ble vurdert (`truth` er ikke `unknown`) og `value` er
 *   et tall. En måling i enhet eller materiale regelen ikke støtter (`unit_not_supported`), tas
 *   aldri med, så sporet aldri viser den som om reglene vurderte den.
 * - Materialet til en måling kommer fra valget i regelens materialfelt (`option_selected` i samme
 *   regelsvar), ikke fra målefeltet.
 * - Etiketter hentes fra `lookup`, aldri fra `reasons`. Ukjent kode gir `null` som etikett.
 */
export type ParseDecisionReasons = (
  ruleKey: string,
  reasons: readonly TgTrailStoredReason[],
  lookup: TgTrailTemplateLookup,
) => TgTrailReasons;

// --- Inndata til sammensettingen -------------------------------------------------------------

/**
 * En beslutningsrad slik sammensettingen trenger den. `actor` er alt regnet av tjenesten fra
 * `decided_by`; id-en sendes aldri inn hit. `overrideReason` er alt fjernet av tjenesten for dem
 * som ikke får se den (`canSeeOverrideReasons`); `hasOverrideReasonText` står igjen.
 */
export type TgTrailDecisionRow = {
  id: string;
  ruleKey: string;
  /** `decided_at` som ISO-tid. */
  decidedAt: string;
  actor: Exclude<TgTrailActor, "rules">;
  decision: RuleSuggestionDecision;
  suggestion: StoredRuleSuggestion;
  suggestionTg: SuggestionTg | null;
  reasons: TgTrailReasons;
  chosenTg: ChosenTg | null;
  chosenOutcomeKey: string | null;
  overrideReasonCode: OverrideReasonCode | null;
  overrideReason: string | null;
  hasOverrideReasonText: boolean;
  /** `deviation_id` på raden, også når avviket er mykt slettet. */
  deviationId: string | null;
};

/**
 * Én hendelse fra revisjonsloggen etter streng tolking. Bare TG fra og til, utfallskode og art.
 * `changes` sendes aldri videre som den er.
 */
export type TgTrailAuditEvent = {
  /** `audit_log.id` (UUID v7). Avgjør rekkefølgen ved lik tid. */
  id: string;
  kind: TgTrailAuditEventKind;
  /** `occurred_at` som ISO-tid. Aldri `received_at`. */
  occurredAt: string;
  actor: Exclude<TgTrailActor, "rules">;
  /** Avviket hendelsen gjelder. `null` for `direct_tg_set`. */
  deviationId: string | null;
  fromTg: CheckpointTg | null;
  toTg: CheckpointTg | null;
};

/**
 * Tolker én rad fra revisjonsloggen (ren funksjon). Gir `null` for alt annet enn:
 * - `deviation` med `create`, `delete` eller `restore`
 * - `deviation` med `update` og `changes.field === "tg"`
 * - `checkpoint_result` med `update` og `changes.field === "tg_direct"`
 *
 * Tekstendringer (`deviation_text`, `cause_text`, `consequence_text`, fraseforslag med `usageId`)
 * gir alltid `null`. Av `changes` leses bare `field`, `from`, `to` og `tg`, og verdiene tas bare
 * med når de er en kjent TG-kode; alt annet blir `null`.
 */
export type ParseTgTrailAuditEvent = (
  row: {
    id: string;
    entityType: string;
    entityId: string;
    action: string;
    changes: Readonly<Record<string, unknown>>;
    occurredAt: string;
  },
  actor: Exclude<TgTrailActor, "rules">,
) => TgTrailAuditEvent | null;

/** Et avvik på punktet slik sporet trenger det, også mykt slettede. Ingen tekst. */
export type TgTrailDeviation = {
  id: string;
  kind: DeviationKind;
  tg: DeviationTg | null;
  questionKey: string | null;
  outcomeKey: string | null;
  /** Utfallets navn i den låste malen. `null` for fritt avvik: da vises «Eget avvik». */
  outcomeLabel: string | null;
  removed: boolean;
};

/** Én utgivelse med punktets TG fra snapshot (A595). */
export type TgTrailRelease = {
  id: string;
  versionNumber: number;
  /** `released_at` som ISO-tid. */
  releasedAt: string;
  actor: Exclude<TgTrailActor, "rules">;
  /** `false` når punktet ikke sto i den utgitte rapporten. */
  checkpointInRelease: boolean;
  tg: CheckpointTg | null;
};

/**
 * Et åpent forslag uten beslutningsrad, fra samme regelkjøring som `room-view.ts` gjør (aldri ny
 * logikk og aldri en egen kjøring for sporet).
 */
export type TgTrailOpenSuggestion = {
  ruleKey: string;
  suggestion: StoredRuleSuggestion;
  suggestionTg: SuggestionTg | null;
  reasons: TgTrailReasons;
};

export type ComposeTgTrailInput = {
  /** Alle beslutningsradene for punktet, i vilkårlig rekkefølge. */
  decisions: readonly TgTrailDecisionRow[];
  events: readonly TgTrailAuditEvent[];
  releases: readonly TgTrailRelease[];
  /** Alle avvik på punktet, også mykt slettede. */
  deviations: readonly TgTrailDeviation[];
  openSuggestions: readonly TgTrailOpenSuggestion[];
  tgDirect: TgDirect | null;
  /** Punktets TG nå (`computeCheckpointTg`). */
  currentTg: CheckpointTg | null;
  /** Satt når sporet gjelder ett avvik. Da tas bare linjene for avviket og forslaget bak det med. */
  deviationId: string | null;
};

// --- Linjene -----------------------------------------------------------------------------------

type TgTrailLineBase = {
  /** Stabil nøkkel for listen: kildens rad-id og linjetype. */
  id: string;
  /** ISO-tid. `null` for linjer uten eget tidspunkt (A594). Tid diktes aldri opp. */
  at: string | null;
  actor: TgTrailActor;
  /** Linjen skjedde etter siste utgivelse (forbedreren 1). */
  afterRelease: boolean;
};

/** Avviket en linje gjelder: bare utfallskode, navn fra malen og art. Aldri avviksteksten. */
export type TgTrailDeviationRef = {
  deviationId: string;
  kind: DeviationKind;
  outcomeKey: string | null;
  outcomeLabel: string | null;
};

export type TgTrailLine =
  | (TgTrailLineBase & {
      kind: "suggestion";
      at: null;
      actor: "rules";
      ruleKey: string;
      suggestionKind: StoredRuleSuggestion["kind"];
      /** `null` for HMS-utfall. `"choose"` vises som «TG2 eller TG3». */
      suggestionTg: SuggestionTg | null;
      outcomeLabel: string | null;
      reasons: TgTrailReasons;
      /** `true` når forslaget ikke har noen beslutningsrad ennå. */
      open: boolean;
    })
  | (TgTrailLineBase & {
      kind: "decision";
      at: string;
      ruleKey: string;
      decision: RuleSuggestionDecision;
      chosenTg: ChosenTg | null;
      chosenOutcomeLabel: string | null;
      /**
       * TG-en avviket hadde før, når raden kom fra et TG-bytte på et avvik fra et forslag
       * (`ChangeSuggestedDeviationTg`). `null` for første beslutning.
       */
      fromTg: DeviationTg | null;
      overrideReasonCode: OverrideReasonCode | null;
      /** Bare for dem som får se den. Ellers `null`. */
      overrideReason: string | null;
      /** Kode tom og tekst finnes: skjermen viser «Grunn oppgitt». */
      hasOverrideReasonText: boolean;
      deviation: TgTrailDeviationRef | null;
    })
  | (TgTrailLineBase & {
      kind: "deviation_added" | "deviation_removed" | "deviation_restored";
      at: string;
      deviation: TgTrailDeviationRef;
      /** Avvikets TG da det skjedde, når den er kjent. `null` for HMS («uten TG») og ukjent. */
      tg: DeviationTg | null;
    })
  | (TgTrailLineBase & {
      kind: "deviation_tg_changed";
      at: string;
      deviation: TgTrailDeviationRef;
      fromTg: DeviationTg | null;
      toTg: DeviationTg | null;
    })
  | (TgTrailLineBase & {
      kind: "direct_tg_set";
      at: string;
      fromTg: TgDirect | null;
      toTg: TgDirect | null;
    })
  | (TgTrailLineBase & {
      kind: "released";
      at: string;
      versionNumber: number;
      checkpointInRelease: boolean;
      tg: CheckpointTg | null;
    })
  | (TgTrailLineBase & {
      kind: "suggestion_reopened";
      at: null;
      actor: "rules";
      ruleKey: string;
      suggestionTg: SuggestionTg | null;
    });

/**
 * Setter sammen linjene (ren funksjon, `logic/tg-trail.ts`).
 *
 * - **Rekkefølge:** eldst øverst. Sortert på tid, og på id (UUID v7) ved lik tid.
 * - **Forslagslinjen** har ingen tid og står rett før første beslutning for regelen. Et åpent
 *   forslag uten beslutning står sist.
 * - **Én handling gir én linje.** Beslutningsraden og revisjonshendelsen fra samme handling slås
 *   sammen til beslutningslinjen: `create` for avviket raden peker på (Godta og Endre), og
 *   `update` av `tg` på samme avvik når raden kom fra `ChangeSuggestedDeviationTg`. Paringen er
 *   avviks-id og nærmeste hendelse med tid lik eller rett før `decidedAt`; hver hendelse brukes
 *   høyst én gang. `fromTg` på beslutningslinjen kommer fra den parede hendelsen.
 * - **«Forslaget er åpent igjen»** legges rett etter hendelsen som gjorde at siste beslutning for
 *   regelen ikke lenger gjelder (`isEffectiveDecision` er usann): avviket ble fjernet, eller
 *   `tg_direct` ble endret bort fra den valgte. Finnes ikke hendelsen, står linjen sist. Eldre
 *   rader for samme regel gir aldri en slik linje.
 * - **`afterRelease`** er sann for linjer med tid etter siste utgivelse, og for linjer uten tid som
 *   står etter den.
 * - Med `deviationId` tas bare linjene for avviket, forslaget og beslutningene bak det og
 *   utgivelsene med. Uten tas alt på punktet med.
 * - Funksjonen teller eller summerer aldri per person, og setter aldri TG.
 */
export type ComposeTgTrail = (input: ComposeTgTrailInput) => TgTrailLine[];

/** Høyeste rolle etter `TG_TRAIL_ROLE_ORDER`, eller `employee` når listen er tom (A593). */
export type TgTrailActorForRoles = (
  roles: readonly EmployeeRole[],
) => Exclude<TgTrailActor, "rules">;

// --- Sporet slik skjermen får det --------------------------------------------------------------

/** Det åpne eller siste utkastet til forklaring. Bare den ansattes egne utkast (A598). */
export type TgExplanationDraft = {
  usageId: string;
  /** Laget-tid som ISO-tid («Laget [tid], ikke avgjort»). */
  createdAt: string;
  /** `suggested` = ikke avgjort. `used` = godtatt eller endret («Brukt»). */
  state: "suggested" | "used";
  /**
   * Utkastet (`output_text`) når `state = "suggested"`, så panelet kan vise det uten nytt kall til
   * KI. `null` når utkastet er brukt: den rettede teksten finnes ikke på serveren (A590).
   */
  text: string | null;
};

export type TgExplanationState =
  | { available: false; reason: TgExplanationUnavailableReason }
  | { available: true; draft: TgExplanationDraft | null };

export type TgTrail = {
  reportId: string;
  reportStatus: ReportStatus;
  checkpointResultId: string;
  checkpointKey: string;
  /** Punktets navn i den låste malen («Våtrom, sluk»). */
  checkpointName: string;
  /** Punktets TG nå: høyeste blant avvikene, ellers `tg_direct` (`computeCheckpointTg`). */
  currentTg: CheckpointTg | null;
  /** Satt når sporet gjelder ett avvik. `tg` er `null` for HMS («uten TG») og ikke valgt. */
  deviation: (TgTrailDeviationRef & { tg: DeviationTg | null; removed: boolean }) | null;
  /** Siste utgivelse. `null` når rapporten ikke er utgitt. */
  published: { versionNumber: number; releasedAt: string; tg: CheckpointTg | null } | null;
  /** Rapporten er utgitt, og punktets TG nå er ulik TG i siste utgivelse. */
  changedAfterRelease: boolean;
  lines: TgTrailLine[];
  explanation: TgExplanationState;
};

// --- Kortversjonen og «Kopier spor» ------------------------------------------------------------

/**
 * Kortversjonen: «Spor», «Spor: TG3 → TG2 (dokumentasjon)» eller «Spor: forslag avvist». Samme
 * form brukes for merket «Endret fra forslag» i reklamasjonssaken.
 */
export type TgTrailSummary =
  | { kind: "plain" }
  | {
      kind: "changed";
      suggestionTg: SuggestionTg | null;
      chosenTg: ChosenTg | null;
      overrideReasonCode: OverrideReasonCode | null;
    }
  | { kind: "rejected"; suggestionTg: SuggestionTg | null };

/**
 * Kortversjonen fra den gjeldende beslutningen rommet alt har lastet (`DecisionView`). Ingen
 * spørring og ingen serverhandling. `null` og `accepted` gir `plain`.
 */
export type SummarizeTgTrail = (
  decision: {
    decision: RuleSuggestionDecision;
    suggestionTg: SuggestionTg | null;
    chosenTg: ChosenTg | null;
    overrideReasonCode: OverrideReasonCode | null;
  } | null,
) => TgTrailSummary;

/**
 * Sporet som ren tekst til utklippstavlen («Kopier spor»): én linje per hendelse med tid i norsk
 * tid (Europe/Oslo) og rolle, uten navn. Begrunnelsesteksten er med bare når den står i sporet
 * (den er alt fjernet i tjenesten for dem som ikke får se den). Tidssonen gis inn, så funksjonen
 * er ren. Kjører i nettleseren; ingenting sendes til serveren og ingenting logges.
 */
export type FormatTgTrailText = (trail: TgTrail, options: { timeZone: string }) => string;
