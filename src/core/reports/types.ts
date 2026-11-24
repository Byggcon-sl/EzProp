import type { Actor, EmployeeGrant } from "@/core/access";
import type { RuleReason, RuleReasonCode, RuleSuggestion } from "@/core/rules";
import type { DbExecutor } from "@/db/client";
import type { TemplateDocument } from "@/core/templates";
import type {
  AiCandidateRef,
  AiGuardCode,
  CAUSE_CRITERIA,
  ChosenTg,
  ConstructionVulnerable,
  CostType,
  DeviationKind,
  DeviationTg,
  OverrideReasonCode,
  ReportStatus,
  RuleResultState,
  RuleSuggestionDecision,
  StoredRuleSuggestion,
  SummaryBasisEntry,
  SummaryFindingSource,
  SummaryGroup,
  TextSource,
  TextStatus,
  TgDirect,
} from "@/db/schema";
import type { INSPECTION_YEAR_SOURCES } from "./logic/codes";
import type { OutcomeSearchHit } from "./logic/deviation-search";
import type { PublishCheckRoom } from "./logic/publish-check-types";
import type {
  CheckpointStatus,
  CheckpointTg,
  CheckpointWarning,
  SuggestionTg,
  PhraseCandidate,
  PhraseField,
  PhraseUsageCount,
} from "./logic/types";

/**
 * Grensesnittet til rapportkjernen (`@/core/reports`, ADR 0013,
 * docs/funksjoner/fase2a-badet-pc.md). Utvikleren bygger tjenesten mot funksjonstypene nederst.
 *
 * Felles for alle funksjonene:
 * - Tilgang sjekkes først med `requireOrganizationAccess` (`@/core/access`): lesing krever
 *   `organization.read`, alt som skriver krever `report.edit`. Spørringene filtrerer på
 *   `grant.organizationId`, aldri på id-en som kom inn.
 * - Stedet (`RoomRef`) følges rom → etasje → bygning → oppdrag → rapport med `deleted_at is null`
 *   i alle ledd. Rommet må være et våtrom og høre til oppdraget. Ellers `AccessDeniedError` (404).
 * - Id-er kontrolleres med `requireUuid` før Zod. Id-er på nye rader lages i nettleseren (UUID
 *   v7). Rader serveren lager som følge av en handling (kontrollpunktresultat, standardtiltak ved
 *   Godta), får UUID v7 på serveren.
 * - Ingenting slettes: fjerning er `deleted_at`. Ingen tjeneste kjører `delete`.
 * - Regler og KI setter aldri TG. `evaluateRules` kjøres bare på serveren, på lagrede svar.
 * - Låst malversjon: fremmednøklene sikrer bare organisasjonen. Hver skriving sjekker derfor at
 *   felt, kontrollpunkt, spørsmål, utfall og regel hører til rapportens `template_version_id`;
 *   ellers `ReportValidationError`.
 * - Fra «KI i veien»: `src/core/reports` kan kalle `src/core/ai` (fraseforslag og sammendrag),
 *   aldri motsatt. Rapportkjernen skriver aldri TG fra et KI-svar; TG-forslag kommer bare fra
 *   regelmotoren.
 * - Revisjonsloggen får bare id-er, faste koder, feltkoder, TG og tall. Aldri tekstverdier.
 */

type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
/**
 * Lagret forslag og forslaget fra regelmotoren skal ha samme form (ADR 0009 og 0013). Endres den
 * ene uten den andre, stopper typesjekken her.
 */
export type StoredSuggestionMatchesRuleEngine = Assert<
  MutuallyAssignable<StoredRuleSuggestion, RuleSuggestion>
>;

export type CauseCriterion = (typeof CAUSE_CRITERIA)[number];
export type InspectionYearSource = (typeof INSPECTION_YEAR_SOURCES)[number];

/** Rommet som fylles ut. `organizationId` sendes ved siden av og brukes bare til tilgangssjekken. */
export type RoomRef = { assignmentId: string; roomId: string };

// --- Visningen -----------------------------------------------------------------------------

/**
 * Den delen av rapportens låste maldokument som gjelder rommet: kontrollpunktene for rommets
 * romgruppe med felt, valg, avviksspørsmål, utfall og standardtiltak. Reglene sendes ikke til
 * nettleseren.
 */
export type RoomTemplateDocument = Pick<
  TemplateDocument,
  | "sections"
  | "checkpoints"
  | "elements"
  | "element_options"
  | "deviation_questions"
  | "outcomes"
  | "standard_measures"
>;

/** Verdien i et svar. Hvilken som brukes, følger feltets type i malen. */
export type AnswerValue = {
  text: string | null;
  number: number | null;
  optionKeys: string[] | null;
};

export type AnswerView = {
  id: string;
  elementKey: string;
  value: AnswerValue;
  /** Satt når teksten kom fra et godtatt KI-forslag. Tom i «Badet på PC». */
  aiUsageId: string | null;
  rowVersion: number;
};

export type MeasureView = {
  id: string;
  text: string;
  textSource: TextSource;
  /**
   * Malens `text_status` når teksten er et av malens standardtiltak i rommet (med flettefeltene
   * fylt inn), ellers `null`. Skjermen viser «Utkast» ved `draft` (designvalg D4).
   */
  textStatus: TextStatus | null;
  sortOrder: number;
  rowVersion: number;
};

export type DeviationCost = {
  type: CostType;
  /** Satt når `type = band`. */
  bandKey: string | null;
  /** Hele kroner, over 0. Satt når `type = approx`. */
  amount: number | null;
};

export type DeviationView = {
  id: string;
  questionKey: string | null;
  outcomeKey: string | null;
  kind: DeviationKind;
  tg: DeviationTg | null;
  deviationText: string | null;
  causeCriterion: CauseCriterion | null;
  causeText: string | null;
  consequenceText: string | null;
  cost: DeviationCost;
  costText: string | null;
  measurementValue: number | null;
  measurementUnit: string | null;
  textSource: TextSource;
  /**
   * Status per tekstfelt (designvalg D4): malens `text_status` når feltet har en av malens tekster
   * for samme felttype i rommet (med flettefeltene fylt inn), ellers `null` (egen eller endret
   * tekst). Skjermen viser «Utkast» ved `draft`.
   */
  textStatus: {
    deviationText: TextStatus | null;
    causeText: TextStatus | null;
    consequenceText: TextStatus | null;
  };
  /** Regelen som foreslo avviket (fast kode). */
  suggestedByRuleKey: string | null;
  /**
   * Satt når avviket henger på en gjeldende beslutning om et regelforslag. Da byttes TG bare med
   * `ChangeSuggestedDeviationTg`, aldri med lagring per felt (A490). `null` for avvik som ikke kom
   * fra et forslag.
   */
  suggestion: DeviationSuggestionLink | null;
  sortOrder: number;
  rowVersion: number;
  measures: MeasureView[];
};

/**
 * Koblingen fra et avvik til den gjeldende beslutningen som laget det (A490, ADR 0013 punkt 9b).
 * Regnes av serveren ved visning, lagres ikke.
 */
export type DeviationSuggestionLink = {
  ruleKey: string;
  /** Den gjeldende beslutningsraden. */
  decisionId: string;
  /** TG-en regelen foreslo. Vises sammen med valgt TG. `null` når forslaget er et HMS-utfall. */
  suggestionTg: SuggestionTg | null;
  /**
   * TG-valgene som ikke krever grunn (raden blir `accepted`), regnet med
   * `SuggestedTgChangeDecision`. Alle andre valg krever grunn før noe sendes.
   */
  tgWithoutReason: (DeviationTg | null)[];
};

export type TgiuDetailsView = {
  id: string;
  reason: string | null;
  ownerInformed: boolean | null;
  ownerInformedAt: string | null;
  alternativeCheckMethod: string | null;
  alternativeCheckResult: string | null;
  riskAssessment: string | null;
  constructionVulnerable: ConstructionVulnerable | null;
  howToExamine: string | null;
  rowVersion: number;
};

/**
 * Siste beslutning om et regelforslag. Grunnen vises som knappeteksten for koden; teksten
 * (`override_reason`) vises bare på skjermen og står aldri i logger.
 */
export type DecisionView = {
  id: string;
  decision: RuleSuggestionDecision;
  chosenTg: ChosenTg | null;
  chosenOutcomeKey: string | null;
  overrideReasonCode: OverrideReasonCode | null;
  overrideReason: string | null;
  deviationId: string | null;
  decidedAt: string;
  /**
   * TG-en regelen foreslo da beslutningen ble tatt («Forslag TG3, endret til TG2: …»). `null` når
   * forslaget er et HMS-utfall.
   */
  suggestionTg: SuggestionTg | null;
};

/**
 * Et regelsvar for rommet, regnet av serveren på lagrede svar. `not_evaluated` vises med hva som
 * mangler. `stale`: forslaget er godtatt eller endret, men regelen slår ikke lenger til
 * («gjelder ikke lenger»); regnes ved visning, lagres ikke, og fjerner aldri et avvik.
 *
 * `latestDecision` er den **gjeldende** beslutningen (`IsEffectiveDecision`), ellers `null`. Er
 * den `null`, er forslaget åpent og vises med Godta, Endre og Avvis, også når det finnes eldre
 * rader (avviket er fjernet, eller TG på punktet er endret bort fra godtatt TG0 eller TGIU).
 * `stale` er bare `true` for en gjeldende beslutning.
 */
export type SuggestionView = {
  ruleKey: string;
  checkpointKey: string;
  state: RuleResultState;
  suggestion: RuleSuggestion | null;
  code: RuleReasonCode | null;
  reasons: RuleReason[];
  /** Kilde i bakgrunnen. Kan vises for takstmannen, flettes aldri inn i rapporttekst. */
  sourceRef: string | null;
  latestDecision: DecisionView | null;
  stale: boolean;
};

export type CheckpointView = {
  checkpointKey: string;
  /** `null` til punktet har fått en rad (første lagring på punktet). */
  resultId: string | null;
  tgDirect: TgDirect | null;
  /** Regnet med `computeCheckpointTg`. Lagres ikke. */
  tg: CheckpointTg | null;
  status: CheckpointStatus;
  descriptionText: string | null;
  done: boolean;
  rowVersion: number | null;
  deviations: DeviationView[];
  tgiuDetails: TgiuDetailsView | null;
  warnings: CheckpointWarning[];
};

export type InspectionYear = { year: number; source: InspectionYearSource };

/** Alt skjermen for rommet trenger. Ingen parter, adresse eller andre persondata. */
export type RoomReportView =
  | {
      state: "not_started";
      /** Den ansatte har `report.edit` og kan starte rapporten. */
      canStart: boolean;
    }
  | {
      state: "started";
      reportId: string;
      reportStatus: ReportStatus;
      /** Den ansatte har `report.edit`. Uten den er skjermen skrivebeskyttet. */
      canEdit: boolean;
      room: { id: string; name: string | null; roomType: string };
      inspectionYear: InspectionYear;
      document: RoomTemplateDocument;
      answers: AnswerView[];
      checkpoints: CheckpointView[];
      suggestions: SuggestionView[];
      progress: { done: number; total: number };
      /** Som `RoomRefresh.publishRoom`. */
      publishRoom: PublishCheckRoom;
      /**
       * «Mest brukt» (A468): antall valg per kandidat i organisasjonen, for kandidatene i `document`.
       * Lastes med rommet (`LoadPhraseUsage`), så tekstsøket uten nett har tallene. Aldri per ansatt.
       */
      phraseUsage: PhraseUsageCount[];
    };

// --- Lagring per felt ----------------------------------------------------------------------

/**
 * Én endring av ett felt: tabell, rad, felt, ny verdi og verdien klienten så (`base`). Samme form
 * som endringene i ADR 0004, slik at køen uten nett i 2b kan sende de samme endringene.
 *
 * Serveren sammenligner `base` med feltets nåverdi (`is not distinct from`). Er de ulike, lagres
 * ingenting, og svaret er `conflict` med nyeste verdi. To faner som endrer ulike felt på samme
 * rad, gir ingen konflikt. `row_version` øker fortsatt ved hver lagring.
 *
 * `deviations.tg` på et avvik med gjeldende beslutning om et regelforslag
 * (`DeviationView.suggestion`) lagres ikke her: det avvises med `ReportValidationError`
 * (`override_reason`), og ingenting lagres. Bruk `ChangeSuggestedDeviationTg` (A490).
 *
 * `text_source` på avviket er én verdi for avvik, årsak og konsekvens. Serveren setter den etter
 * hver lagring av en av de tre tekstene: `template` → `edited` når en tekst endres, og `edited` →
 * `template` når alle tre igjen er lik malens tekster for utfallet, laget på nytt for avviket med
 * gjeldende TG og flettefelt (A557, A562; «Angre» på notatet i «Skriv det du ser»). `free` endres
 * aldri. Klienten sender aldri `text_source`.
 *
 * Feltene som ikke står her, endres bare av egne handlinger: `tg_direct`, `done`, `kind`,
 * `text_source` (settes av serveren, se over),
 * `field_answers.ai_usage_id` (settes og tømmes bare av serveren, ett sted i lagringen per felt;
 * kommer aldri fra klienten), `deleted_at`.
 */
export type ReportFieldChange =
  | {
      table: "field_answers";
      /** Brukes når svaret er nytt. Finnes det alt et svar på stedet, gjelder den raden. */
      id: string;
      /** Feltet i rapportens låste malversjon. Ukjente og arkiverte koder avvises. */
      elementKey: string;
      field: "value";
      value: AnswerValue;
      base: AnswerValue;
    }
  | {
      table: "checkpoint_results";
      checkpointKey: string;
      field: "description_text";
      value: string | null;
      base: string | null;
    }
  | DeviationFieldChange
  | {
      table: "deviation_measures";
      id: string;
      field: "text";
      value: string;
      base: string;
    }
  | {
      table: "deviation_measures";
      id: string;
      field: "sort_order";
      value: number;
      base: number;
    }
  | TgiuFieldChange;

export type DeviationFieldChange = { table: "deviations"; id: string } & (
  | { field: "tg"; value: DeviationTg | null; base: DeviationTg | null }
  | {
      field: "deviation_text" | "cause_text" | "consequence_text" | "cost_text";
      value: string | null;
      base: string | null;
    }
  | { field: "cause_criterion"; value: CauseCriterion | null; base: CauseCriterion | null }
  /** Kostnaden er ett felt: type, intervall og beløp endres samlet. */
  | { field: "cost"; value: DeviationCost; base: DeviationCost }
  | { field: "sort_order"; value: number; base: number }
);

export type TgiuFieldChange = { table: "tgiu_details"; checkpointKey: string } & (
  | {
      field:
        | "reason"
        | "alternative_check_method"
        | "alternative_check_result"
        | "risk_assessment"
        | "how_to_examine";
      value: string | null;
      base: string | null;
    }
  | { field: "owner_informed"; value: boolean | null; base: boolean | null }
  | {
      field: "construction_vulnerable";
      value: ConstructionVulnerable | null;
      base: ConstructionVulnerable | null;
    }
);

/** Det som kan ha endret seg på rommet etter en lagring. Serveren regner alt på nytt. */
export type RoomRefresh = {
  checkpoints: CheckpointView[];
  suggestions: SuggestionView[];
  progress: { done: number; total: number };
  /**
   * Rommet slik sjekken før publisering leser det (ADR 0015). Skjermen regner tellemerket
   * «2 må rettes, 3 bør sees over» lokalt med `computePublishCheck`, uten nytt kall. Bare koder,
   * id-er og tilstand; ingen tekst utover det rommet alt har.
   */
  publishRoom: PublishCheckRoom;
};

export type SaveFieldResult =
  | {
      status: "saved";
      /** Raden som ble endret eller laget. */
      id: string;
      rowVersion: number;
      refresh: RoomRefresh;
    }
  | {
      /** «Endret av andre». Ingenting er lagret. `current` er feltets nyeste verdi. */
      status: "conflict";
      id: string;
      rowVersion: number;
      current: ReportFieldChange["value"];
    };

// --- Handlinger ----------------------------------------------------------------------------

/**
 * Valget takstmannen må ta når punktet har TGIU og får et avvik med TG (TGIU overskrives aldri
 * stille). Uten valg er svaret `tgiu_conflict`, og ingenting er lagret.
 */
export type TgiuChoice = "remove_tgiu";

/**
 * Motsatt vei (A395): punktet har avvik med TG2 eller TG3 og skal få TGIU eller TG0. Uten valg er
 * svaret `tgiu_conflicts_with_deviation`, og ingenting er lagret. Med `remove_tg_deviations`
 * slettes avvikene med TG (og tiltakene deres) mykt, `tg_direct` settes og en eventuell
 * beslutningsrad lagres, alt i samme transaksjon. HMS-avvik står.
 *
 * «Behold avvikene» finnes ikke som valg: den sendes aldri til serveren og lagrer ingenting, slik
 * at loggen aldri sier `accepted` om en TG som ikke ble satt.
 */
export type TgDeviationChoice = "remove_tg_deviations";

export type AddDeviationInput = {
  /** UUID v7 fra nettleseren. Samme id to ganger gir samme avvik (tåler dobbelt trykk). */
  id: string;
  checkpointKey: string;
  /** Badets avvik kommer alltid fra et avviksspørsmål og et utfall i malen. */
  questionKey: string;
  outcomeKey: string;
  /** Påkrevd for utfall av typen «velg TG2 eller TG3» før punktet er ferdig; kan vente. */
  tg: DeviationTg | null;
  tgiuChoice?: TgiuChoice;
};

export type SetTgDirectInput = {
  checkpointKey: string;
  /** `null` fjerner TG direkte. Fjernet TGIU sletter `tgiu_details` mykt. */
  tgDirect: TgDirect | null;
  base: TgDirect | null;
  /** Bare for `IU` og `0` når punktet har avvik med TG. */
  tgDeviationChoice?: TgDeviationChoice;
};

export type RestoreDeviationInput = {
  deviationId: string;
  /** Som for `AddDeviationInput`: punktet har fått TGIU etter at avviket ble fjernet. */
  tgiuChoice?: TgiuChoice;
};

/**
 * Svaret fra `RestoreDeviation`. `newer_decision` (A494): avviket kom fra et regelforslag, og det
 * finnes en nyere beslutningsrad for samme regel og punkt enn den som laget avviket. Ingenting er
 * endret. `ruleKey` og `checkpointKey` gir lenken til forslaget.
 */
export type RestoreDeviationResult =
  | ActionResult
  | { status: "newer_decision"; ruleKey: string; checkpointKey: string; refresh: RoomRefresh };

/**
 * TG-bytte på et avvik fra et regelforslag (A490). TG og grunn sendes som ett kall, etter at
 * grunnen er valgt på skjermen.
 */
export type ChangeSuggestedDeviationTgInput = {
  /** UUID v7 fra nettleseren for den nye beslutningsraden. Samme id to ganger gir samme svar. */
  id: string;
  deviationId: string;
  tg: DeviationTg | null;
  /** TG-en klienten så. Stemmer den ikke med nåverdien, er svaret `conflict`. */
  base: DeviationTg | null;
} & OverrideReasonInput;

export type ChangeSuggestedDeviationTgResult =
  | { status: "saved"; decisionId: string; refresh: RoomRefresh }
  /** «Endret av andre». Ingenting er lagret, heller ingen beslutningsrad. */
  | { status: "conflict"; current: DeviationTg | null; refresh: RoomRefresh };

export type DecideSuggestionInput = {
  /** UUID v7 fra nettleseren for beslutningsraden. Samme id to ganger gir samme beslutning. */
  id: string;
  ruleKey: string;
  tgiuChoice?: TgiuChoice;
  /** Bare ved Godta eller Endre til TGIU eller TG0 når punktet har avvik med TG. */
  tgDeviationChoice?: TgDeviationChoice;
} & (
  | {
      decision: "accepted";
      /** Id-en til avviket som lages (forslag av typen `outcome`). */
      deviationId?: string;
      /** Valgt TG når utfallet er «velg TG2 eller TG3». */
      chosenTg?: DeviationTg;
    }
  | ({
      decision: "changed";
      /** TG takstmannen velger i stedet. 2 og 3 gir et avvik; 0, 1 og IU settes på punktet. */
      chosenTg: ChosenTg;
      /** Annet utfall enn det foreslåtte, i samme kontrollpunkt. Tomt = forslagets utfall. */
      chosenOutcome?: { questionKey: string; outcomeKey: string };
      deviationId?: string;
    } & OverrideReasonInput)
  | ({ decision: "rejected" } & OverrideReasonInput)
);

/**
 * Begrunnelsen ved Endre og Avvis (A380, A398): fast kode, tekst eller begge. Minst én av dem
 * kreves, og koden `other` krever tekst (`CheckOverrideReason` i `logic/`). Godta har ingen av
 * delene; sendes de likevel, avvises beslutningen. Teksten lagres bare i beslutningsraden.
 */
export type OverrideReasonInput = {
  overrideReasonCode?: OverrideReasonCode;
  overrideReason?: string;
};

export type ActionResult =
  | { status: "saved"; refresh: RoomRefresh }
  /** Punktet har TGIU, og handlingen gir TG2 eller TG3. Takstmannen må velge (`tgiuChoice`). */
  | { status: "tgiu_conflict" }
  /** Punktet har avvik med TG, og handlingen gir TGIU eller TG0 (`tgDeviationChoice`). */
  | { status: "tgiu_conflicts_with_deviation" }
  /** «Endret av andre» (`SetTgDirectInput.base` stemte ikke). */
  | { status: "conflict"; refresh: RoomRefresh };

export type DecideSuggestionResult =
  | {
      status: "saved";
      decisionId: string;
      /** Avviket som ble laget, så skjermen kan flytte fokus dit. */
      deviationId: string | null;
      refresh: RoomRefresh;
    }
  | { status: "tgiu_conflict" }
  /** Ingenting er lagret: ingen beslutningsrad, ingen `tg_direct`, avvikene står (A395). */
  | { status: "tgiu_conflicts_with_deviation" }
  /** Regelen slår ikke til på serveren med lagrede svar: «Forslaget gjelder ikke lenger». */
  | { status: "no_longer_applies"; refresh: RoomRefresh }
  /**
   * Forslaget har alt en gjeldende beslutning (annen fane, annen enhet eller en kollega, A493).
   * Ingenting er lagret: ingen ny rad, intet avvik, ingen TG. Feltene sier hva som ble bestemt og
   * når (ISO-tid), aldri hvem. Skjermen viser tidspunktet i norsk tid.
   */
  | {
      status: "already_decided";
      decision: RuleSuggestionDecision;
      chosenTg: ChosenTg | null;
      decidedAt: string;
      refresh: RoomRefresh;
    };

// --- Funksjonene (bygges av utvikleren i `src/core/reports`) -----------------------------------

/**
 * Starter rapporten for oppdraget (`report.edit`): tilstandsrapport, låst til den publiserte
 * versjonen av systemmalen, `status = draft`. Tåler to samtidige kall (`on conflict do nothing`
 * mot `reports_one_current_per_assignment_idx`) og gir samme rapport begge ganger. Uten publisert
 * systemmal: `ReportTemplateMissingError` med norsk melding. Kalles aldri av en lesing.
 */
export type StartReport = (
  actor: Actor,
  organizationId: string,
  assignmentId: string,
) => Promise<{ reportId: string; created: boolean }>;

/** Leser rommet (`organization.read`). Skriver aldri, heller ikke når rapporten ikke er startet. */
export type GetRoomReport = (
  actor: Actor,
  organizationId: string,
  room: RoomRef,
) => Promise<RoomReportView>;

/**
 * Lagrer ett felt (`report.edit`). Lagres et svar som en regel leser, kjøres reglene på nytt, og
 * forslagene følger med i `refresh`. Lagring av et svar lager aldri avvik og setter aldri TG.
 * Fritekst har lengdegrense og sperre mot fødselsnummer (`ReportValidationError`).
 */
export type SaveReportField = (
  actor: Actor,
  organizationId: string,
  room: RoomRef,
  change: ReportFieldChange,
  options?: SaveFieldOptions,
) => Promise<SaveFieldResult>;

/**
 * «Bruk» på et språkvasket felt (A460): teksten lagres som vanlig, og beslutningen registreres med
 * `recordDecisionIn` i samme transaksjon (A469). Loggraden må være `language_polish` i denne
 * rapporten, og `target_ref` må være akkurat feltet som lagres (avvikets tekstfelt, tiltakets
 * tekst eller beskrivelsen på punktet); ellers `AccessDeniedError` (404) og ingenting lagres. Ved
 * «Endret av andre» lagres ingenting, og forslaget står åpent. Andre felt gir
 * `ReportValidationError`.
 */
export type SaveFieldOptions = {
  aiDecision?: { usageId: string; decision: "accepted" | "edited" };
};

/**
 * Legger til et avvik fra et utfall i malen (`report.edit`), med standardtekstene og
 * standardtiltakene for valgt TG (`text_source = template`). Har punktet TG0 eller TG1, tømmes
 * `tg_direct`. Tak: `MAX_DEVIATIONS_PER_CHECKPOINT`.
 *
 * Tåler dobbelt trykk og id-kollisjon: `insert … on conflict (id) do nothing`, og raden leses
 * deretter med `grant.organizationId` og rapporten. Finnes ingen rad der (id-en er brukt i en
 * annen organisasjon eller rapport), er svaret `AccessDeniedError` (404), og den andre raden er
 * urørt. Aldri oppslag på id uten organisasjon.
 */
export type AddDeviation = (
  actor: Actor,
  organizationId: string,
  room: RoomRef,
  input: AddDeviationInput,
) => Promise<ActionResult>;

/**
 * Fjerner avviket og tiltakene mykt (`report.edit`). Beslutningsraden står urørt, og ingen ny rad
 * lages: beslutningen slutter å gjelde fordi avviket er borte (A491), og `refresh` viser forslaget
 * åpent igjen med en gang (`latestDecision = null`). Avviket og
 * tiltakene som fjernes sammen med det, får samme `deleted_at`, slik at `RestoreDeviation` vet
 * hvilke tiltak som hører til. Brukes også av «Fjern avviket» på et forslag som ikke lenger
 * gjelder (A388).
 */
export type RemoveDeviation = (
  actor: Actor,
  organizationId: string,
  room: RoomRef,
  deviationId: string,
) => Promise<ActionResult>;

/**
 * Angre etter «Fjern avviket» (`report.edit`): samme rad tilbake. Tømmer `deleted_at` på avviket
 * og på tiltakene som har samme `deleted_at` som avviket; tiltak som var fjernet før, står
 * fjernet. Reglene for `tg_direct` er de samme som i `AddDeviation`. Et avvik som ikke er
 * slettet, gir `saved` uten endring. Skjermen tilbyr Angre til punktet forlates.
 *
 * Avvik fra et regelforslag (A494): finnes det en nyere beslutningsrad for samme regel og punkt
 * enn den som peker på avviket, er svaret `newer_decision`, og ingenting endres. Ellers blir
 * beslutningen gjeldende igjen av seg selv. Gjelder også gjenoppretting fra papirkurven.
 */
export type RestoreDeviation = (
  actor: Actor,
  organizationId: string,
  room: RoomRef,
  input: RestoreDeviationInput,
) => Promise<RestoreDeviationResult>;

/** Legger til et tomt tiltak sist på avviket (`report.edit`). Tak: `MAX_MEASURES_PER_DEVIATION`. */
export type AddMeasure = (
  actor: Actor,
  organizationId: string,
  room: RoomRef,
  input: { id: string; deviationId: string },
) => Promise<ActionResult>;

/** Fjerner tiltaket mykt (`report.edit`). */
export type RemoveMeasure = (
  actor: Actor,
  organizationId: string,
  room: RoomRef,
  measureId: string,
) => Promise<ActionResult>;

/**
 * Setter eller fjerner TG direkte (`report.edit`). TG0 settes uten kontroll av vilkårene nå
 * (A348).
 *
 * Har punktet avvik med TG2 eller TG3: `IU` og `0` gir `tgiu_conflicts_with_deviation` til
 * `tgDeviationChoice` er sendt (A395); `1` avvises (`ReportValidationError`), fordi skjermen
 * aldri tilbyr det.
 *
 * `IU`: finnes et mykt slettet `tgiu_details`-sett på punktet, gjenopprettes det siste i stedet
 * for at det lages et tomt, slik at teksten ikke går tapt. Det er også slik «Fjern TGIU» angres.
 * Ellers lages et tomt sett.
 */
export type SetTgDirect = (
  actor: Actor,
  organizationId: string,
  room: RoomRef,
  input: SetTgDirectInput,
) => Promise<ActionResult>;

/**
 * Godtar, endrer eller avviser et regelforslag (`report.edit`). Serveren kjører reglene på lagrede
 * svar og lagrer sitt eget regelsvar i `rule_suggestion_decisions` (ny rad hver gang); klienten
 * sender bare regelkode, beslutning, valg og begrunnelse. Ukjent `ruleKey` gir
 * `ReportValidationError`.
 *
 * Rekkefølgen er fast (A493), og gir høyst ett avvik per regel og punkt:
 * 1. Samme beslutnings-id som en lagret rad: `saved` med samme svar, ingen ny rad.
 * 2. Regelen slår ikke til: `no_longer_applies`.
 * 3. Siste rad for regelen og punktet er gjeldende (`IsEffectiveDecision`): `already_decided`,
 *    uansett om kallet er Godta, Endre eller Avvis, og for alle forslagstyper.
 * 4. Ellers lagres beslutningen som beskrevet under.
 *
 * Ingen egen lås: `withRoomWrite` låser rapportraden, så to kall i samme rapport går etter
 * hverandre, og det andre ser det førstes rad.
 *
 * Godta: `outcome` lager avviket med standardtekstene, `tgiu` gir `tg_direct = IU`, `tg0` gir
 * `tg_direct = 0`. Endre lager avviket med valgt TG og utfall og setter `deviation_id` på
 * beslutningsraden. Avvis lager aldri avvik. Endre og Avvis krever begrunnelse
 * (`OverrideReasonInput`); Godta med begrunnelse avvises (A398).
 *
 * Gir beslutningen TGIU eller TG0 på et punkt med avvik med TG, er svaret
 * `tgiu_conflicts_with_deviation` til `tgDeviationChoice` er sendt (A395). Avviket lages som i
 * `AddDeviation` (`on conflict (id) do nothing`, lest tilbake med organisasjonen).
 */
export type DecideSuggestion = (
  actor: Actor,
  organizationId: string,
  room: RoomRef,
  input: DecideSuggestionInput,
) => Promise<DecideSuggestionResult>;

/**
 * Merker punktet ferdig eller ikke ferdig (`report.edit`). Kan alltid gjøres; mangler er
 * advarsler i `refresh`, aldri sperre. `done_by` er den ansatte fra grant.
 */
export type SetCheckpointDone = (
  actor: Actor,
  organizationId: string,
  room: RoomRef,
  input: { checkpointKey: string; done: boolean },
) => Promise<ActionResult>;

/**
 * Bytter TG på et avvik som har en gjeldende beslutning om et regelforslag (`report.edit`, A490).
 * Egen handling, ikke lagring per felt: TG-en og en ny beslutningsrad lagres i samme transaksjon
 * (ADR 0013 punkt 12).
 *
 * - Samme `id` som en lagret rad: `saved` med samme svar, ingen ny rad.
 * - Avviket har ingen gjeldende beslutning (kom ikke fra et forslag, eller er fjernet):
 *   `ReportValidationError` (`not_applicable`). Slike avvik bytter TG med `SaveReportField`.
 * - `base` stemmer ikke med nåverdien: `conflict`, ingenting lagret.
 * - `tg` er lik nåverdien: `saved` med den gjeldende radens id, ingen ny rad.
 * - Ellers avgjør `SuggestedTgChangeDecision` om raden blir `accepted` eller `changed`. `changed`
 *   krever grunn etter `CheckOverrideReason`; mangler den, eller sendes grunn ved `accepted`, er
 *   svaret `ReportValidationError` (`override_reason`), og verken TG eller rad lagres.
 *
 * Den nye raden: `suggestion`, `reasons`, `lifespan_set_key`, `threshold_set_key` og
 * `inspection_year` kopieres fra den gjeldende raden som erstattes; reglene kjøres ikke på nytt
 * (ADR 0013 punkt 10). `chosen_tg` er ny TG, `chosen_outcome_key` avvikets utfall, `deviation_id`
 * det samme avviket. Tiltakene endres ikke; advarslene (`texts_written_for_other_tg`,
 * `tg3_missing_cost`) følger TG-en i `refresh`.
 *
 * Revisjonsloggen får regelkode, avvik, gammel og ny TG og grunnkoden, aldri begrunnelsesteksten.
 * Regler og KI setter aldri TG; det gjør bare takstmannen her.
 */
export type ChangeSuggestedDeviationTg = (
  actor: Actor,
  organizationId: string,
  room: RoomRef,
  input: ChangeSuggestedDeviationTgInput,
) => Promise<ChangeSuggestedDeviationTgResult>;
// --- KI i veien: fraseforslag og sammendrag (docs/funksjoner/fase2a-ki-i-veien.md) ------------

/**
 * Felles for funksjonene under:
 * - Klienten sender bare `requestId`, målet og egen tekst. Kandidater og funn hentes av serveren
 *   fra databasen i `grant.organizationId`, aldri fra klienten.
 * - KI kalles bare gjennom `requestSuggestion` i `@/core/ai`. Rapportkjernen bygger aldri
 *   ledetekst og kaller aldri en leverandør.
 * - Ingen av funksjonene setter TG, velger utfall eller endrer `status` på rapporten.
 * - Språkvask går ikke gjennom rapportkjernen: server-handlingen kaller `requestSuggestion`
 *   eller `requestSuggestionBatch` direkte, og teksten lagres med `SaveReportField` når
 *   takstmannen trykker «Bruk».
 * - Plassholdere (A466): all lagring av fritekst i rapporten (`SaveReportField`, `AddMeasure`,
 *   `SaveSummary`) avviser tekst som inneholder en av de åtte plassholderne fra vasken
 *   (`PII_PLACEHOLDERS` i `@/shared/lib/pii-patterns`) med `ReportValidationError`
 *   (`text_has_placeholder`). Kandidattekst fra malen berøres ikke.
 */

/** En kandidat fra serveren har alltid `ref`. */
export type RankedPhraseCandidate = PhraseCandidate & { ref: AiCandidateRef };

/**
 * Kandidatkilden (A433): den ene funksjonen som vet hvor kandidatene kommer fra. I dag tekstene
 * i rapportens låste malversjon (`template_outcome`, `template_measure`); frasebanken (`phrase`)
 * kobles til her i 2a-3 uten at KI-delen endres. Intern i `src/core/reports`.
 *
 * Samme utvalg og rekkefølge som `ListPhraseCandidates` (med `LoadPhraseUsage` som telling), med
 * id-ene fra databasen. Bare rader i `grant.organizationId`, i rapportens `template_version_id`,
 * uten `deleted_at`. For `template_outcome` sier feltet hvilken av utfallets tre tekster
 * kandidaten er.
 *
 * Kilden kutter selv (A467): er det flere enn `AI_CANDIDATES_MAX`, beholdes de første i
 * rekkefølgen (de nærmeste leddene), og `cut` sier hvor mange som falt bort. `cut` sendes videre
 * i `AiServerInput.candidatesCut`. Fast antall spørringer uansett antall utfall.
 */
export type LoadPhraseCandidates = (
  grant: EmployeeGrant,
  input: { reportId: string; roomId: string; deviationId: string; field: PhraseField },
) => Promise<{ candidates: RankedPhraseCandidate[]; cut: number }>;

/**
 * Tellingen for «Mest brukt» (A468). Intern i `src/core/reports`; resultatet går ut i
 * `RoomReportView.phraseUsage`.
 *
 * Teller rader i `ai_usage_log` i `grant.organizationId` med funksjonen `phrase_suggest`, satt
 * `chosen_candidate` og uten `deleted_at` (indeksen `ai_usage_log_chosen_candidate_idx`), gruppert
 * på `target_ref.fieldKey` og kandidaten. Tar aldri ansatt, og leser aldri `employee_id` eller
 * `decided_by`. `chosen_candidate` er bare satt mens raden er `accepted`, så angrede og avviste
 * valg teller ikke.
 *
 * Tellingen følger de faste kodene, ikke id-en: et valg gjort i en eldre malversjon teller for
 * kandidaten med samme punkt-, spørsmåls- og utfallskode i rapportens låste versjon. Standardtiltak
 * har ingen kode og følger utfallets koder og lik tekst. Slik nullstilles ikke tallet når en ny
 * malversjon publiseres. Bare kandidater som finnes i rommets del av den låste malen, er med.
 * Fast antall spørringer (én for utfall, én for tiltak), uansett antall rader i loggen.
 */
export type LoadPhraseUsage = (
  grant: EmployeeGrant,
  input: { reportId: string; roomId: string },
) => Promise<PhraseUsageCount[]>;

export type SuggestPhrasesInput = {
  /** UUID laget i nettleseren. Blir id-en i `ai_usage_log`. */
  requestId: string;
  deviationId: string;
  field: PhraseField;
  /** Det takstmannen har skrevet i feltet. Kan være tom: da brukes avvikets faste koder. */
  text: string;
};

export type SuggestPhrasesResult =
  /** KI har rangert: 1–5 kandidater, de beste først. Skjermen merker listen «Sortert av KI». */
  | { status: "ranked"; usageId: string; candidates: RankedPhraseCandidate[] }
  /** Ingen passer. `usageId` er `null` når det ikke fantes kandidater (intet kall, ingen rad). */
  | { status: "no_match"; usageId: string | null }
  /** KI er av, sperret eller ikke slått på for funksjonen. Skjermen beholder tekstsøket. */
  | { status: "ai_off" }
  /** Kallet feilet. Skjermen beholder tekstsøket. */
  | { status: "ai_error" }
  /**
   * Sikringen i kjernen slo til (`AiInputTooLargeError`). Skal ikke skje, fordi kandidatkilden
   * kutter (A467). Skjermen beholder tekstsøket og viser meldingen.
   */
  | { status: "too_many_candidates" };

/**
 * Forslag fra frasebanken for ett felt (`report.edit`). Henter kandidatene (`LoadPhraseCandidates`),
 * og kaller `requestSuggestion` med funksjonen `phrase_suggest`, målet `deviation` / feltkoden,
 * feltene på tillatt-listen (teksten, utfallets faste kode og TG-gruppen) og kandidatene.
 * Avviket må høre til rommet og rapporten være `draft`; ellers `AccessDeniedError` (404).
 */
export type SuggestPhrases = (
  actor: Actor,
  organizationId: string,
  room: RoomRef,
  input: SuggestPhrasesInput,
) => Promise<SuggestPhrasesResult>;

export type ApplyPhraseInput = {
  usageId: string;
  candidate: AiCandidateRef;
  /** Feltets tekst slik klienten så den. Brukes ikke for `new_measure`. */
  base: string | null;
  /** Id for det nye tiltaket (UUID v7 fra nettleseren). Påkrevd for `new_measure`, ellers ikke lov. */
  measureId?: string;
};

export type ApplyPhraseResult =
  | {
      status: "saved";
      /** Avviket, eller det nye tiltaket. */
      id: string;
      rowVersion: number;
      /** Teksten som ble satt inn, med flettefeltene fylt ut. */
      text: string;
      refresh: RoomRefresh;
    }
  /** «Endret av andre». Ingenting er lagret, og forslaget står fortsatt åpent. */
  | { status: "conflict"; id: string; rowVersion: number; current: string | null };

/**
 * Setter inn valgt kandidat (`report.edit`, A437). Målet og feltet leses fra loggraden, aldri fra
 * klienten. Før noe lagres, kontrolleres loggraden (A470): samme organisasjon, funksjonen
 * `phrase_suggest`, og `target_ref` peker på et avvik i akkurat dette rommet. Ellers
 * `AccessDeniedError` (404). Kandidaten slås opp på nytt i kandidatkilden (samme organisasjon og
 * malversjon), og teksten er kildens egen med flettefeltene fylt ut som ved Godta i
 * `DecideSuggestion`.
 *
 * Avvik, årsak og konsekvens: teksten erstatter feltet (med `base` som i `SaveReportField`).
 * `new_measure`: et nytt tiltak sist på avviket (tak `MAX_MEASURES_PER_DEVIATION`). Raden regnes
 * ikke som KI-tekst: `text_source` følger malen, og ingen `ai_usage_id` settes.
 *
 * Lagringen og `recordDecisionIn(tx, grant, usageId, "accepted", { candidate })` skjer i samme
 * transaksjon, inne i `withRoomWrite` (A469): avviser `recordDecisionIn` kandidaten, lagres
 * ingenting. Låserekkefølgen står i `RecordDecisionIn` i `@/core/ai`: rapportraden først, så
 * KI-låsen. Angre gjøres av skjermen med `SaveReportField` (eller `RemoveMeasure`) og
 * `recordDecision(..., "undo")`.
 */
export type ApplyPhrase = (
  actor: Actor,
  organizationId: string,
  room: RoomRef,
  input: ApplyPhraseInput,
) => Promise<ApplyPhraseResult>;

/** «Behold min», «Lukk» (lukket liste) og «Angre» på et KI-forslag. */
export type DecideAiTextInput = {
  usageId: string;
  /** `undo_and_reject`: «Angre» etter «Bruk», og forslaget avvises i samme transaksjon. */
  decision: "rejected" | "undo" | "undo_and_reject";
};

/**
 * Lagrer `rejected` eller `undo` på et KI-forslag (`report.edit`). Raden må høre til rapporten
 * under arbeid og til et mål i rommet: fraseforslag og språkvask på et avvik, et tiltak eller et
 * punkt i rommet, eller sammendraget for rapporten. Ellers 404 og raden er uendret. Beslutningen
 * lagres i samme transaksjon (`recordDecisionIn`).
 */
export type DecideAiText = (
  actor: Actor,
  organizationId: string,
  room: RoomRef,
  input: DecideAiTextInput,
) => Promise<{ status: "saved" }>;

// --- «Skriv det du ser»: KI finner utfallet (docs/funksjoner/fase2a-skriv-det-du-ser.md) --------

/**
 * Felles for de tre inngangene under (ADR 0006, tillegg 24.11.2026):
 * - Tilgang først: `requireOrganizationAccess(actor, organizationId, "report.edit")`. Rommet følges
 *   som ellers (`RoomRef`), rapporten må være `draft` (publisert gir `report_published`), og slettet
 *   rom eller rapport gir `AccessDeniedError` (404).
 * - KI-målet er rapporten med feltkoden `new_deviation` (A550) og deles av hele rapporten (A555).
 *   Rommet er aldri en del av målet; det kontrolleres her, mot rapporten i skrivelåsen.
 * - Notatet er takstmannens egen tekst. Det går bare til `requestSuggestion` (vasket der) og står
 *   aldri i `ai_usage_log`, `audit_log`, logger eller feil. Ingen av inngangene lagrer det.
 * - Ingen av inngangene setter eller foreslår TG. Ingen ny tabell, kolonne eller migrering.
 */

/** Et treff fra KI: utfallet slik tekstsøket viser det, og kandidaten som sendes tilbake ved valg. */
export type OutcomeMatchHit = OutcomeSearchHit & {
  /** Alltid `{ source: "template_outcome", id: <outcomes.id> }` (A554). */
  ref: AiCandidateRef;
};

export type FindOutcomesInput = {
  /** UUID laget i nettleseren. Blir id-en i `ai_usage_log`; nytt forsøk bruker samme id. */
  requestId: string;
  /**
   * Det takstmannen skrev. Trimmes; høyst `OUTCOME_MATCH_NOTE_MAX` tegn. Skjemaet avviser et notat
   * med fødselsnummer (`containsNationalId`, A567), før noe kall og uten rad.
   */
  note: string;
  /**
   * Kontrollpunktet som er åpent på skjermen, eller `null`. Brukes bare til rekkefølgen på
   * kandidatene (A554). Må være et punkt i rommets del av malen, ellers `ReportValidationError`
   * (`unknown_key`).
   */
  openCheckpointKey: string | null;
};

export type FindOutcomesResult =
  /** 1 til `OUTCOME_MATCH_MAX` treff, de beste først. Ingen er forhåndsvalgt. */
  | { status: "ranked"; usageId: string; hits: OutcomeMatchHit[] }
  /**
   * «Ingen utfall passer». `usageId` er `null` når rommets romtype ikke har utfall (intet kall,
   * ingen rad). En rad med utfallet `no_match` kan ikke avgjøres og trenger ingen avvisning.
   */
  | { status: "no_match"; usageId: string | null }
  /** KI er av, sperret eller ikke slått på for funksjonen. Skjermen beholder tekstsøket. */
  | { status: "ai_off" }
  /** Kallet feilet. «KI svarte ikke. Bruk søket.» */
  | { status: "ai_error" }
  /** Notatet er over `OUTCOME_MATCH_NOTE_MAX` (A560). Intet kall og ingen rad. */
  | { status: "note_too_long" }
  /**
   * Rommets romtype har flere utfall enn `OUTCOME_MATCH_CANDIDATES_MAX`, eller en kandidattekst er
   * over `AI_CANDIDATE_TEXT_MAX_LENGTH`. Intet kall, ingen rad og aldri stille kutt (A554).
   */
  | { status: "too_many_candidates" };

/**
 * «Finn med KI» (`report.edit`). Leser rommet uten lås (`loadRoomContext` med `lock: false`, som
 * `SuggestPhrases`), bygger kandidatene med `ListOutcomeMatchCandidates` og
 * `OutcomeMatchCandidateText` fra rommets del av den låste malversjonen, henter `outcomes.id` fra
 * `outcomeIdByRef`, og kaller `requestSuggestion` med funksjonen `outcome_match`.
 *
 * Rekkefølgen: tilgang, id-er (`requireUuid`), skjema, rom og rapport, tomt notat
 * (`ReportValidationError` `invalid_input`), `note_too_long`, `too_many_candidates`, så kallet.
 * Grensene sjekkes altså før `requestSuggestion`, slik at ingen rad lages.
 *
 * **Fødselsnummer (A567):** skjemaet for inndataene avviser `note` med `containsNationalId` fra
 * `@/shared/validation/free-text`, samme sjekk og samme melding (`NATIONAL_ID_MESSAGE`) som
 * avviksteksten i `schemas.ts`. Det gir `ReportValidationError` (`invalid_input`) i skjemasteget,
 * altså før rommet leses, uten kall og uten rad. Lengden er med vilje ikke en skjemafeil: den gir
 * svaret `note_too_long`, så skjermen kan vise sin egen melding. Feilen gjengir aldri notatet
 * eller sifrene, heller ikke Zod-feilen bak.
 *
 * `requestSuggestion` avviser forrige åpne søk på rapporten (A555). Svaret `candidates` gjøres om
 * til `hits` i rekkefølgen KI ga; en kandidat som ikke lenger finnes i listen, tas bort.
 */
export type FindOutcomes = (
  actor: Actor,
  organizationId: string,
  room: RoomRef,
  input: FindOutcomesInput,
) => Promise<FindOutcomesResult>;

export type ChooseOutcomeMatchInput = {
  usageId: string;
  /** Treffet takstmannen valgte (`OutcomeMatchHit.ref`). */
  candidate: AiCandidateRef;
  /** UUID v7 fra nettleseren for det nye avviket. Samme id to ganger gir samme avvik. */
  deviationId: string;
  /** Som i `AddDeviationInput`: bare for «velg TG2 eller TG3», og alltid takstmannens eget valg. */
  tg: DeviationTg | null;
  tgiuChoice?: TgiuChoice;
};

export type ChooseOutcomeMatchResult =
  | {
      status: "saved";
      /** Punktet avviket ble laget på, utledet av serveren. Skjermen åpner dette punktet. */
      checkpointKey: string;
      deviationId: string;
      refresh: RoomRefresh;
    }
  /** Som i `ActionResult`: punktet har TGIU. Ingenting er lagret, og søket står åpent. */
  | { status: "tgiu_conflict" }
  /**
   * Et nyere søk på rapporten har avvist dette (A555). Verken avvik eller beslutning er lagret.
   * Skjermen: «Forslagene er utdatert. Trykk «Finn med KI» på nytt.»
   */
  | { status: "suggestion_outdated" };

/**
 * Lager avviket fra valgt treff (`report.edit`), i `withRoomWrite`.
 *
 * **Bindingen av loggraden** gjøres på serveren, inne i `withRoomWrite` og før noe skrives
 * (A564). Raden leses i skrivetransaksjonen, etter at rapportraden er låst, og svaret er radens
 * `status` sammen med kontrollen. Raden må ha `grant.organizationId`, ikke være slettet, ha
 * `feature = outcome_match`, `report_id` lik rapporten i skrivelåsen, `target_ref` lik
 * `{ type: "report", id: <rapporten>, fieldKey: "new_deviation" }`, utfallet `ok`, og `candidate`
 * må stå i `candidate_refs` med kilden `template_outcome`. Ellers `AccessDeniedError` (404), og
 * verken logg eller avvik endres. En `usageId` fra en annen rapport, en annen organisasjon eller
 * en annen funksjon stopper her.
 *
 * **Utfallet utledes av `candidate.id`** med `scope.template.outcomeRefById` og må finnes i
 * `scope.roomDoc.outcomes` (rapportens låste malversjon og rommets romtype). Ellers 404.
 * Klienten sender aldri `checkpointKey`, `questionKey` eller `outcomeKey`.
 *
 * **Rekkefølgen i transaksjonen** (A469-mønsteret, låserekkefølgen i `RecordDecisionIn`):
 * 1. `createDeviationFromOutcome` med de utledede kodene, uten `suggestedByRuleId` og uten
 *    `allowOtherTg`: nøyaktig samme avvik som `AddDeviation` gir for utfallet.
 * 2. `tgiu_conflict`: svar med den. Ingen beslutning lagres.
 * 3. `exists` (samme `deviationId` på nytt): avviket må ha samme `outcome_id` som kandidaten,
 *    ellers 404. Svar `saved` uten ny beslutning. Dette er et gjentatt kall (A563), også når
 *    raden alt er `accepted`.
 * 4. `created` og radens status fra bindingen er `accepted`: søket er brukt (A564). Kast en
 *    intern feil ut av `withRoomWrite`, slik at det nye avviket rulles tilbake, og svar
 *    `suggestion_outdated`. `recordDecisionIn` kalles ikke: den tåler `accepted` to ganger med
 *    samme kandidat og ville sluppet et avvik nummer to gjennom.
 * 5. `created` og status `suggested`: `recordDecisionIn(tx, grant, usageId, "accepted",
 *    { candidate })`.
 *
 * **Ett søk gir høyst ett avvik (A564).** Statusen fra bindingen er til å stole på for
 * `accepted`: `accepted` settes bare av denne inngangen, i en transaksjon som holder samme
 * rapportlås, så to valg på samme rapport går etter hverandre. Den er ikke til å stole på for
 * `suggested` → `rejected`: `requestSuggestion` tar ikke rapportlåsen, så et nytt søk kan avvise
 * raden etter at den er lest. Det avgjør fortsatt `recordDecisionIn` under KI-låsen (punkt 5).
 * En annen status enn `suggested` og `accepted` (`rejected`) går også til `recordDecisionIn`, som
 * kaster.
 *
 * **Utdatert søk:** `AiDecisionError` fra `recordDecisionIn` og feilen i punkt 4 skal ut av
 * `withRoomWrite`, slik at transaksjonen rulles tilbake og avviket ikke blir stående. De fanges
 * utenfor og blir svaret `suggestion_outdated`. De fanges aldri inne i transaksjonen.
 *
 * Revisjonsloggen får det samme som `AddDeviation`, pluss `usageId`. Aldri notatet.
 */
export type ChooseOutcomeMatch = (
  actor: Actor,
  organizationId: string,
  room: RoomRef,
  input: ChooseOutcomeMatchInput,
) => Promise<ChooseOutcomeMatchResult>;

export type RejectOutcomeMatchInput = { usageId: string };

/**
 * Avviser et åpent søk (`report.edit`): lukket liste, «Avbryt», Escape, valg fra tekstsøket i
 * stedet, og trykk på et treff som er «Registrert fra før». Samme binding av loggraden som
 * `ChooseOutcomeMatch` (uten kandidat), ellers 404 uten endring. Lagrer bare `rejected`, med
 * `recordDecisionIn` i `withRoomWrite`; `undo` finnes ikke her, og `DecideAiText` er uendret.
 *
 * Tåler gjentak og kappløp: er raden alt avvist (for eksempel av et nyere søk), er svaret `saved`
 * uten endring. Er den alt godtatt, endres ingenting, og svaret er `already_decided`.
 */
export type RejectOutcomeMatch = (
  actor: Actor,
  organizationId: string,
  room: RoomRef,
  input: RejectOutcomeMatchInput,
) => Promise<{ status: "saved" | "already_decided" }>;

/**
 * Skriverammen på rapportnivå (A469), for det som ikke hører til ett rom (sammendraget). Intern i
 * `src/core/reports`, ved siden av `withRoomWrite`. Samme rekkefølge og samme feil: `report.edit`
 * sjekkes først, `assignmentId` kontrolleres med `requireUuid`, og i én transaksjon slås oppdraget
 * og rapporten opp med `grant.organizationId` og `deleted_at is null`, og rapportraden låses
 * (`for update`), så skrivinger i samme rapport går etter hverandre, også mot `withRoomWrite`.
 * Rapporten må være startet og `draft` (`ReportValidationError`). `scope.tx` er transaksjonen
 * `recordDecisionIn` skal ha.
 */
export type WithReportWrite = <T>(
  actor: Actor,
  organizationId: string,
  assignmentId: string,
  fn: (scope: ReportWriteScope) => Promise<T>,
) => Promise<T>;

export type ReportWriteScope = {
  tx: DbExecutor;
  actor: Actor;
  grant: EmployeeGrant;
  orgId: string;
  reportId: string;
  /** `reports.row_version` slik den sto da raden ble låst. */
  reportRowVersion: number;
  templateVersionId: string;
  now: Date;
};

/** Ett godkjent funn slik skjermen viser det i advarslene. Ingen tekst. */
export type SummaryFindingView = {
  source: SummaryFindingSource;
  id: string;
  group: SummaryGroup;
  checkpointKey: string;
  checkpointName: string;
  /** Rommet funnet står i, så skjermen kan lenke dit. */
  roomId: string | null;
};

/** Sammendraget for hele rapporten, med advarslene (A435). Advarsler, aldri sperre. */
export type ReportSummaryView = {
  reportId: string;
  reportStatus: ReportStatus;
  /** Den ansatte har `report.edit`, og rapporten er `draft`. */
  canEdit: boolean;
  text: string | null;
  /** `reports.row_version`. Sendes tilbake i `SaveSummaryInput.baseRowVersion`. */
  rowVersion: number;
  /** Antall godkjente funn nå. 0 gir «Ingen avvik med TG ennå» ved «Lag utkast». */
  findingCount: number;
  /** Avvik uten valgt TG. De er ikke med i utkastet: «N avvik mangler TG og er ikke med.» (A465). */
  missingTgCount: number;
  /**
   * Forskjellen mellom `summary_basis` og dagens funn: nye, endrede (annen `row_version`, gruppe
   * eller del) og fjernede. `null` når `summary_basis` er tom eller ingenting er endret.
   */
  changedSinceDraft: {
    added: SummaryFindingView[];
    changed: SummaryFindingView[];
    /** Fjernede funn finnes ikke lenger som rad å vise: bare antallet. */
    removedCount: number;
  } | null;
  /**
   * Funn i gruppene `tg3` og `tgiu` der punktets navn ikke står i teksten (A435, A462). Gjelder
   * også tekst skrevet for hånd. Tom liste når sammendraget er tomt.
   */
  uncovered: SummaryFindingView[];
};

/**
 * Leser sammendraget (`organization.read`). `null` når oppdraget ikke har en startet rapport.
 * Godkjente funn (A484, A434): avvik med TG2 eller TG3, kontrollpunkt med TGIU og HMS-avvik, i
 * hele rapporten, uten slettede rader. Rekkefølge: `SUMMARY_GROUPS`, og malens rekkefølge innen
 * gruppen. Avvik uten valgt TG, TG0, TG1, avviste regelforslag og tomme punkter tas ikke med.
 */
export type GetReportSummary = (
  actor: Actor,
  organizationId: string,
  assignmentId: string,
) => Promise<ReportSummaryView | null>;

export type DraftSummaryResult =
  | {
      status: "suggestion";
      /**
       * `null` når rapporten bare har TGIU-funn: da skriver koden hele utkastet, KI kalles ikke,
       * og det finnes ingen rad (A462).
       */
      usageId: string | null;
      /** Utkastet med kodens overskrifter. Vises i forslagskortet, lagres ikke før «Bruk». */
      text: string;
      /** Funnene utkastet bygde på. Sendes urørt tilbake i `SaveSummaryInput.draft`. */
      basis: SummaryBasisEntry[];
      /** Avvik uten valgt TG, som ikke er med i utkastet (A465). */
      missingTgCount: number;
    }
  /** Ingen godkjente funn: intet kall og ingen rad. */
  | { status: "no_findings"; missingTgCount: number }
  | { status: "ai_off" }
  | { status: "ai_error" }
  /**
   * En vakt stoppet hele utkastet (A460). Teksten vises aldri. `guard` velger meldingen: TG eller
   * tall, manglende funn (`coverage_guard`) eller skjulte opplysninger (`placeholder_guard`).
   */
  | { status: "stopped"; guard: AiGuardCode }
  /** For mange eller for lange funn (`limits.ts`). Aldri stille kutt. */
  | { status: "too_many_findings" };

/**
 * Lager et utkast til sammendrag (`report.edit`, rapporten i `draft`). Serveren henter funnene
 * (som i `GetReportSummary`), bygger gruppene med overskrifter og kaller `requestSuggestion` med
 * funksjonen `summary_draft` og målet `report` / `summary_text`. Bare feltene på tillatt-listen
 * sendes: punktets navn, avvik, årsak, konsekvens og tiltak. Aldri romnavn, etasje, bygning,
 * «eier informert», bildetekster, notater eller kostnad. Lagrer ingenting.
 *
 * TGIU-funnene sendes ikke til KI (A462): de gis som `fixedLines` med punktets navn og
 * `tgiu_details.reason`, og kjernen setter dem inn under kodens overskrift. Fast antall
 * spørringer uansett antall funn.
 */
export type DraftSummary = (
  actor: Actor,
  organizationId: string,
  assignmentId: string,
  input: { requestId: string },
) => Promise<DraftSummaryResult>;

export type SaveSummaryInput = {
  /** Ny tekst. `null` eller tom tekst tømmer sammendraget og `summary_basis`. */
  text: string | null;
  baseRowVersion: number;
  /**
   * Satt når teksten er et utkast takstmannen trykket «Bruk» på. `edited` sier om han endret
   * teksten først. `usageId` er `null` for et utkast koden skrev alene (bare TGIU-funn).
   *
   * `basis` kommer fra nettleseren og kontrolleres strengt (A470): Zod-skjema uten ekstra nøkler
   * (bare UUID, faste koder og heltall), høyst `REPORT_SUMMARY_BASIS_MAX` funn og
   * `MAX_MEASURES_PER_DEVIATION` deler per funn, hver id må være et funn (og en del) i denne
   * rapporten, og `rowVersion` kan ikke være høyere enn radens i dag. `group` fra nettleseren
   * brukes ikke: serveren setter gruppen fra dagens funn. Ellers `ReportValidationError`.
   */
  draft?: { usageId: string | null; basis: SummaryBasisEntry[]; edited: boolean };
};

export type SaveSummaryResult =
  | { status: "saved"; summary: ReportSummaryView }
  /** «Endret av andre» (`baseRowVersion` stemte ikke). Ingenting er lagret. */
  | { status: "conflict"; summary: ReportSummaryView };

/**
 * Lagrer sammendraget (`report.edit`) inne i `WithReportWrite`. Bare når rapporten er `draft`;
 * ellers `ReportValidationError`. Samme inndatakontroll som andre lange tekstfelt
 * (`REPORT_SUMMARY_MAX_LENGTH`, sperre mot elleve sifre), og tekst med en plassholder fra vasken
 * avvises (`text_has_placeholder`, A466). `row_version` øker.
 *
 * Med `draft`: `summary_basis` settes fra den kontrollerte `draft.basis`. Har utkastet en
 * `usageId`, kontrolleres loggraden først (A470): samme organisasjon, funksjonen `summary_draft`,
 * og `target_ref` er `report` / `summary_text` med id-en til akkurat denne rapporten; ellers
 * `AccessDeniedError` (404). Beslutningen registreres med `recordDecisionIn` (`accepted`, eller
 * `edited` når `draft.edited`) i samme transaksjon som teksten (A469). Uten `draft` (skrevet
 * eller rettet for hånd) står `summary_basis` urørt.
 *
 * Revisjonsloggen får bare feltkoden `summary_text`, aldri teksten.
 */
export type SaveSummary = (
  actor: Actor,
  organizationId: string,
  assignmentId: string,
  input: SaveSummaryInput,
) => Promise<SaveSummaryResult>;

// --- Språkvask (A436, A460) ---------------------------------------------------------------------

/** Ett felt i «Språkvask avviket». Bare måltypene og feltene i avvikskortet. */
export type PolishDeviationTarget =
  | {
      type: "deviation";
      id: string;
      fieldKey: "deviation_text" | "cause_text" | "consequence_text";
    }
  | { type: "deviation_measure"; id: string; fieldKey: "text" };

/** Målet i svaret: et felt i avvikskortet, eller beskrivelsen ved punktet (resultatradens id). */
export type PolishTarget =
  PolishDeviationTarget | { type: "checkpoint_result"; id: string; fieldKey: "description_text" };

export type PolishDeviationInput = {
  deviationId: string;
  /** Ett felt per forespørsel, med `requestId` fra nettleseren og teksten som står i feltet. */
  items: { requestId: string; target: PolishDeviationTarget; text: string }[];
};

/** Svaret for ett felt. Teksten fra KI har de opprinnelige verdiene satt tilbake (A466). */
export type PolishFieldResult =
  | { status: "suggestion"; usageId: string; text: string }
  /** En vakt stoppet feltet (A460). De andre feltene kan brukes. Teksten vises aldri. */
  | { status: "stopped"; usageId: string; guard: AiGuardCode }
  | { status: "no_match"; usageId: string }
  | { status: "ai_error" }
  | { status: "ai_off" };

export type PolishResult =
  /** Ett svar per felt med tekst, i samme rekkefølge som de ble sendt. */
  | {
      status: "done";
      fields: { requestId: string; target: PolishTarget; result: PolishFieldResult }[];
    }
  /** Ingen felt med tekst: intet kall og ingen rad (T-0111). */
  | { status: "nothing_to_polish" }
  /** Teksten er for lang for KI. Intet kall. */
  | { status: "too_long" };

/**
 * «Språkvask avviket» (`report.edit`, A436, A460): ett kall til serveren, og gjennom
 * `requestSuggestionBatch` ett leverandørkall, én loggrad og vaktene per felt. Felt der teksten er
 * tom etter at mellomrom er tatt bort, tas ikke med; er alle tomme, kalles ikke KI. Målene må være
 * avviket og dets tiltak i dette rommet, og rapporten må være `draft`; ellers `AccessDeniedError`
 * (404). Lagrer ingenting: «Bruk» lagres med `SaveReportField` og `SaveFieldOptions.aiDecision`.
 */
export type PolishDeviation = (
  actor: Actor,
  organizationId: string,
  room: RoomRef,
  input: PolishDeviationInput,
) => Promise<PolishResult>;

/** «Språkvask» på beskrivelsen ved punktet (`checkpoint_result` / `description_text`). Eget kall. */
export type PolishDescription = (
  actor: Actor,
  organizationId: string,
  room: RoomRef,
  input: { requestId: string; checkpointKey: string; text: string },
) => Promise<PolishResult>;
