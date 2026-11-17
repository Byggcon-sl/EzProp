import type { EmployeeGrant } from "@/core/access";
import type {
  AiCandidateRef,
  AiCandidateSource,
  AiErrorCode,
  AiGuardCode,
  AiOutcome,
  AiSuggestionStatus,
  AiTargetRef,
  SummaryGroup,
} from "@/db/schema";

/*
 * Den offentlige flaten til KI-modulen (docs/adr/0006-ki-i-bunnen.md del 1 og 2).
 * Støtter hovedmål: KI i bunnen (én vei inn til all KI, alt logges likt).
 */

export type {
  AiCandidateRef,
  AiCandidateSource,
  AiErrorCode,
  AiGuardCode,
  AiOutcome,
  AiSuggestionStatus,
  AiTargetRef,
};

/**
 * Faste funksjonskoder (regel 6), én per KI-funksjon.
 *
 * «KI i veien» (docs/funksjoner/fase2a-ki-i-veien.md): utvides til
 * `"language_polish" | "phrase_suggest" | "summary_draft"` i samme endring som definisjonene i
 * `features.ts` (tillatt-liste, mål, ledetekst og evalueringssett må følge koden).
 */
export type AiFeatureCode = "language_polish";

export type AiSuggestionRequest = {
  /** UUID laget på enheten. Blir id-en i `ai_usage_log`. */
  requestId: string;
  feature: AiFeatureCode;
  /**
   * Må være `null` for måltypene i `RESOLVED_AI_TARGET_TYPES`: kjernen slår opp målraden og
   * utleder oppdraget selv. Brukes bare for måltyper som ikke kontrolleres ennå (`field_answer`).
   */
  assignmentId: string | null;
  /** Alltid tom fra kalleren. `report_id` i loggen utledes av kjernen fra målet. */
  reportId: string | null;
  target: AiTargetRef;
  /** Feltkode → verdi. Bare koder fra funksjonens tillatt-liste. */
  fields: Record<string, string>;
  /** Avvises alltid her. Kandidater kommer bare fra serveren, i `AiServerInput`. */
  candidates?: never[];
};

/**
 * En kandidat KI kan velge (ADR 0006 del 8): kilde, id og teksten slik den står i kilden.
 * Teksten vaskes og sendes med et kort merke (K1…Kn). Id-en sendes aldri til leverandøren.
 */
export type AiCandidate = AiCandidateRef & { text: string };

/**
 * Ett funn til sammendraget. Bare feltene på tillatt-listen for `summary_draft`. TG sendes ikke:
 * gruppen sier alvoret, og KI skriver aldri TG (A434).
 */
export type AiSummaryFinding = {
  /** Kontrollpunktets navn fra malen (`checkpoints.name`). */
  checkpointName: string;
  deviationText: string | null;
  causeText: string | null;
  consequenceText: string | null;
  /** Tiltakene i rekkefølge (`deviation_measures.text`). */
  measures: string[];
  /** Hva som ikke er undersøkt, og hvorfor (`tgiu_details.reason`). Bare i gruppen `tgiu`. */
  tgiuReason: string | null;
};

/**
 * Én gruppe i sammendraget, i fast rekkefølge (`SUMMARY_GROUPS`). `heading` er kodens overskrift
 * og sendes aldri til leverandøren: KI ser bare merket G1…Gn, og kjernen setter overskriften på
 * teksten etterpå. Tomme grupper sendes ikke inn.
 */
export type AiSummaryGroup = {
  group: SummaryGroup;
  heading: string;
  findings: AiSummaryFinding[];
};

/**
 * Det bare serveren kan gi inn (tredje argument til `requestSuggestion`). Kommer aldri fra
 * nettleseren: skjemaet for forespørselen har ikke disse nøklene, og serverinngangene i
 * `@/core/reports` bygger dem fra databasen med `grant.organizationId`.
 *
 * `phrase_suggest` krever `candidates` (minst én, høyst `AI_CANDIDATES_MAX`) og ikke
 * `summaryGroups`. `summary_draft` krever `summaryGroups` (minst ett funn, høyst
 * `AI_SUMMARY_FINDINGS_MAX`) og ikke `candidates`. `language_polish` tar ingen av dem. Alt annet
 * gir `AiRequestRejectedError`. Over grensen gir `AiInputTooLargeError`, aldri stille kutt.
 */
export type AiServerInput = {
  candidates?: readonly AiCandidate[];
  summaryGroups?: readonly AiSummaryGroup[];
};

export type AiSuggestionResult =
  | {
      kind: "suggestion";
      usageId: string;
      status: "suggested";
      text: string;
      candidateId: string | null;
    }
  /**
   * Rangerte kandidater (`phrase_suggest`): 1–5, alle fra `AiServerInput.candidates`, de beste
   * først. Ingen tekst: kalleren viser sin egen kandidattekst. Samme liste står i `candidate_refs`.
   */
  | { kind: "candidates"; usageId: string; status: "suggested"; candidates: AiCandidateRef[] }
  | { kind: "no_match"; usageId: string }
  | { kind: "error"; usageId: string }
  /**
   * En vakt stoppet svaret (utfallet `stopped`, A431). Teksten og hvilken vakt det var, går aldri
   * til kalleren. Kan ikke avgjøres med `recordDecision`.
   */
  | { kind: "stopped"; usageId: string }
  | { kind: "disabled" }
  /** Sperret av modulen (ad-1): raden står i loggen med utfallet `blocked`, intet kall. */
  | { kind: "blocked" };

export type AiDecision = "accepted" | "edited" | "rejected" | "undo";

export const AI_DECISIONS = ["accepted", "edited", "rejected", "undo"] as const;

/**
 * Tillegg til beslutningen. `candidate` er kandidaten den ansatte valgte fra en rangert liste:
 * påkrevd ved `accepted` på en rad med `candidate_refs`, og må stå i den lagrede listen. Ikke lov
 * ellers. `edited` er ikke lov på en slik rad (teksten er kildens egen); lukket liste er
 * `rejected`. `undo` og `rejected` tømmer `chosen_candidate`.
 */
export type AiDecisionOptions = { candidate?: AiCandidateRef };

// --- Funksjonene (bygges av utvikleren i `src/core/ai`) ------------------------------------

/**
 * Be om ett forslag. Rekkefølgen står i `request-suggestion.ts`; nytt i «KI i veien»:
 *
 * - **Målet slås opp** (`ResolveAiTarget`) rett etter rettighet og tillatt-liste, for måltypene i
 *   `RESOLVED_AI_TARGET_TYPES`. Ikke funnet, annen organisasjon, slettet i et ledd eller rapport
 *   som ikke er `draft`: `AiRequestRejectedError` (samme nøytrale avslag som ellers), ingen rad,
 *   intet kall. `assignment_id` og `report_id` på raden og de kjente verdiene til vasken kommer
 *   derfra, aldri fra forespørselen.
 * - **Tom tekst** (T-0111): `language_polish` med tekst som er tom etter `trim()` gir
 *   `AiRequestRejectedError` uten rad og uten kall. `phrase_suggest` tillater tomt `text`.
 * - **Kandidater**: hver kandidattekst og hvert funn vaskes for seg med de samme kjente verdiene,
 *   og lekkasjesjekken dekker hele ledeteksten. Svaret tolkes strengt: bare merker som ble sendt,
 *   doble tas bort, høyst `AI_SUGGESTED_CANDIDATES_MAX`. Ingen gyldige gir `no_match`.
 *   `input_summary` har bare antall (tegn per felt, `candidates`, `unknown_labels`,
 *   `duplicate_labels`). `output_text` er tom, `candidate_refs` har listen.
 * - **Vaktene** (`CheckAnswerGuards`) kjøres på svaret til `language_polish` og `summary_draft`
 *   før noe returneres. Treff gir raden `stopped` med vaktkoden, mengde og kostnad beholdt, og
 *   svaret `{ kind: "stopped" }`. Et stoppet svar avviser ikke forrige åpne forslag på målet.
 * - **Sammendraget**: `output_text` og `text` i svaret er den sammensatte teksten, med kodens
 *   overskrift over KI-teksten for hver gruppe, i rekkefølgen gruppene kom inn.
 * - **Ekte leverandør**: en funksjon som ikke står i `settings.features`, gir `disabled` som før.
 */
export type RequestSuggestion = (
  grant: EmployeeGrant,
  request: AiSuggestionRequest,
  serverInput?: AiServerInput,
) => Promise<AiSuggestionResult>;

/**
 * Flere forslag fra ett trykk («Språkvask avviket»): ett kall til leverandøren og én rad i
 * loggen per forespørsel, slik at hvert felt får sin egen `target_ref`, sin egen vakt og sin egen
 * beslutning (ADR 0006, tillegg 17.11.2026). Svarene kommer i samme rekkefølge som forespørslene.
 *
 * Hele listen valideres før noe kalles: 1 til `AI_BATCH_MAX_REQUESTS` forespørsler, samme
 * funksjon (bare `language_polish`), ulike `requestId`, ulike mål, og alle målene i samme
 * rapport. Ellers `AiRequestRejectedError` uten rad og uten kall. Deretter behandles hver
 * forespørsel som i `RequestSuggestion`; feil eller stopp på ett felt stopper ikke de andre.
 */
export type RequestSuggestionBatch = (
  grant: EmployeeGrant,
  requests: readonly AiSuggestionRequest[],
) => Promise<AiSuggestionResult[]>;

/** Registrerer beslutningen. Uendret, bortsett fra `options` (se `AiDecisionOptions`). */
export type RecordDecision = (
  grant: EmployeeGrant,
  usageId: string,
  decision: AiDecision,
  options?: AiDecisionOptions,
) => Promise<void>;

/** Det kjernen utleder av målet. Brukes til loggen og til vasken, aldri sendt til leverandøren. */
export type ResolvedAiTarget = { reportId: string; assignmentId: string };

/**
 * Slår opp målraden (intern i `src/core/ai`, eksporteres ikke fra `index.ts`). Følger kjeden
 * målrad → (avvik → kontrollpunktresultat →) rapport → oppdrag via `@/db/schema`, med
 * `grant.organizationId` og `deleted_at is null` i alle ledd, og rapporten i `draft`. For
 * `deviation` / `new_measure` er målraden avviket. `null` når noe i kjeden mangler.
 * Leser aldri tekstkolonner.
 */
export type ResolveAiTarget = (
  grant: EmployeeGrant,
  target: AiTargetRef,
) => Promise<ResolvedAiTarget | null>;

/**
 * Vaktene på svaret (ren funksjon i `src/core/ai/guards.ts`, T-0046, A431 og A440). `sent` er de
 * vaskede tekstene som gikk til leverandøren, `answer` er KI-teksten før kodens overskrifter.
 *
 * - `tg_guard`: for `language_polish` når TG-omtalene i svaret (`extractTgMentions`: «TG» med
 *   grad, «tilstandsgrad», «ikke undersøkt» regnet som TGIU) ikke er de samme som i `sent`. For
 *   `summary_draft` ved enhver TG-omtale i svaret.
 * - `number_guard`: et tall i svaret som ikke finnes i `sent`. Tall sammenlignes som sifferrekker
 *   med desimaltegn, uten hensyn til mellomrom og enhet.
 *
 * `tg_guard` vinner når begge slår til. `null` betyr at svaret kan vises. `phrase_suggest` har
 * ingen tekst i svaret og kjører ikke vaktene.
 */
export type CheckAnswerGuards = (input: {
  feature: AiFeatureCode;
  sent: readonly string[];
  answer: string;
}) => AiGuardCode | null;
