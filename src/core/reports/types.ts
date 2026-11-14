import type { Actor } from "@/core/access";
import type { RuleReason, RuleReasonCode, RuleSuggestion } from "@/core/rules";
import type { TemplateDocument } from "@/core/templates";
import type {
  CAUSE_CRITERIA,
  ChosenTg,
  ConstructionVulnerable,
  CostType,
  DeviationKind,
  DeviationTg,
  ReportStatus,
  RuleResultState,
  RuleSuggestionDecision,
  StoredRuleSuggestion,
  TextSource,
  TgDirect,
} from "@/db/schema";
import type { INSPECTION_YEAR_SOURCES } from "./logic/codes";
import type { CheckpointStatus, CheckpointTg, CheckpointWarning } from "./logic/types";

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
 * - Revisjonsloggen får bare id-er, faste koder, feltkoder, TG og tall. Aldri tekstverdier.
 */

type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
/**
 * Lagret forslag og forslaget fra regelmotoren skal ha samme form (ADR 0009 og 0011). Endres den
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
  /** Regelen som foreslo avviket (fast kode). */
  suggestedByRuleKey: string | null;
  aiUsageId: string | null;
  sortOrder: number;
  rowVersion: number;
  measures: MeasureView[];
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

/** Siste beslutning om et regelforslag. Begrunnelsen (`override_reason`) vises bare på skjermen. */
export type DecisionView = {
  id: string;
  decision: RuleSuggestionDecision;
  chosenTg: ChosenTg | null;
  chosenOutcomeKey: string | null;
  overrideReason: string | null;
  deviationId: string | null;
  decidedAt: string;
};

/**
 * Et regelsvar for rommet, regnet av serveren på lagrede svar. `not_evaluated` vises med hva som
 * mangler. `stale`: forslaget er godtatt eller endret, men regelen slår ikke lenger til
 * («gjelder ikke lenger»); regnes ved visning, lagres ikke, og fjerner aldri et avvik.
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
 * Feltene som ikke står her, endres bare av egne handlinger: `tg_direct`, `done`, `kind`,
 * `text_source` (settes av serveren: `template` → `edited` når en tekst endres), `ai_usage_id`
 * (bare serveren), `deleted_at`.
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
};

export type DecideSuggestionInput = {
  /** UUID v7 fra nettleseren for beslutningsraden. Samme id to ganger gir samme beslutning. */
  id: string;
  ruleKey: string;
  tgiuChoice?: TgiuChoice;
} & (
  | {
      decision: "accepted";
      /** Id-en til avviket som lages (forslag av typen `outcome`). */
      deviationId?: string;
      /** Valgt TG når utfallet er «velg TG2 eller TG3». */
      chosenTg?: DeviationTg;
    }
  | {
      decision: "changed";
      /** TG takstmannen velger i stedet. 2 og 3 gir et avvik; 0, 1 og IU settes på punktet. */
      chosenTg: ChosenTg;
      /** Annet utfall enn det foreslåtte, i samme kontrollpunkt. Tomt = forslagets utfall. */
      chosenOutcome?: { questionKey: string; outcomeKey: string };
      deviationId?: string;
      /** Påkrevd. Lagres bare i beslutningsraden, aldri i logger. */
      overrideReason: string;
    }
  | { decision: "rejected"; overrideReason: string }
);

export type ActionResult =
  | { status: "saved"; refresh: RoomRefresh }
  /** Punktet har TGIU, og handlingen gir TG2 eller TG3. Takstmannen må velge (`tgiuChoice`). */
  | { status: "tgiu_conflict" }
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
  /** Regelen slår ikke til på serveren med lagrede svar: «Forslaget gjelder ikke lenger». */
  | { status: "no_longer_applies"; refresh: RoomRefresh };

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
) => Promise<SaveFieldResult>;

/**
 * Legger til et avvik fra et utfall i malen (`report.edit`), med standardtekstene og
 * standardtiltakene for valgt TG (`text_source = template`). Har punktet TG0 eller TG1, tømmes
 * `tg_direct`. Tak: `MAX_DEVIATIONS_PER_CHECKPOINT`.
 */
export type AddDeviation = (
  actor: Actor,
  organizationId: string,
  room: RoomRef,
  input: AddDeviationInput,
) => Promise<ActionResult>;

/** Fjerner avviket og tiltakene mykt (`report.edit`). Beslutningsraden står urørt. */
export type RemoveDeviation = (
  actor: Actor,
  organizationId: string,
  room: RoomRef,
  deviationId: string,
) => Promise<ActionResult>;

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
 * Setter eller fjerner TG direkte (`report.edit`). TG0 og TG1 avvises når punktet har avvik med
 * TG; TGIU sammen med TG2 eller TG3 avvises (`ReportValidationError`). TGIU lager `tgiu_details`
 * når settet mangler. TG0 settes uten kontroll av vilkårene nå (A348).
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
 * `ReportValidationError`. Slår regelen ikke til, er svaret `no_longer_applies`.
 *
 * Godta: `outcome` lager avviket med standardtekstene, `tgiu` gir `tg_direct = IU`, `tg0` gir
 * `tg_direct = 0`. Endre og avvis krever begrunnelse.
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
