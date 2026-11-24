import type { EmployeeGrant } from "@/core/access";
import type { DbExecutor } from "@/db/client";
import type { PiiPlaceholder } from "@/shared/lib/pii-patterns";
import type {
  AiCandidateRef,
  AiCandidateSource,
  AiErrorCode,
  AiGuardCode,
  AiOutcome,
  AiSuggestionStatus,
  AiTargetRef,
  ChosenTg,
  OverrideReasonCode,
  RuleSuggestionDecision,
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
 * Faste funksjonskoder (regel 6), én per KI-funksjon. Definisjonene (tillatt-liste, mål og
 * ledetekst) står i `features.ts`. `phrase_suggest` og `summary_draft` kom med «KI i veien»
 * (docs/funksjoner/fase2a-ki-i-veien.md). `tg_explanation` kom med sporet
 * (docs/funksjoner/fase2a-tg-spor.md, ADR 0006 tillegg 24.11.2026).
 */
export type AiFeatureCode =
  "language_polish" | "phrase_suggest" | "summary_draft" | "tg_explanation";

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
 * Ett funn KI skriver om i sammendraget (gruppene `tg3`, `tg2` og `hms`). Bare feltene på
 * tillatt-listen for `summary_draft`. TG sendes ikke: gruppen sier alvoret, og KI skriver aldri
 * TG (A434). Hvert funn får et merke F1…Fn, og svaret har tekst per merke (A461).
 */
export type AiSummaryFinding = {
  /** Kontrollpunktets navn fra malen (`checkpoints.name`). Kjernen setter det først i avsnittet. */
  checkpointName: string;
  deviationText: string | null;
  causeText: string | null;
  consequenceText: string | null;
  /** Tiltakene i rekkefølge (`deviation_measures.text`). */
  measures: string[];
};

/**
 * Én linje koden skriver selv (gruppen `tgiu`, A462): punktets navn og `tgiu_details.reason`.
 * Sendes aldri til leverandøren, får ikke F-merke og går ikke gjennom vaktene. `text` er
 * takstmannens fritekst: den vaskes før den settes inn i `output_text`, men går uvasket til
 * klienten, som resten av teksten han selv har skrevet.
 */
export type AiSummaryFixedLine = { checkpointName: string; text: string };

/**
 * Én gruppe i sammendraget, i fast rekkefølge (`SUMMARY_GROUPS`). `heading` er kodens overskrift
 * og sendes aldri til leverandøren: KI ser bare merket G1…Gn, og kjernen setter overskriften på
 * teksten etterpå. Tomme grupper sendes ikke inn.
 *
 * `tg3`, `tg2` og `hms` har `findings` (KI skriver avsnittet) og tom `fixedLines`. `tgiu` har
 * `fixedLines` (koden skriver linjen) og tom `findings`. Alt annet gir `AiRequestRejectedError`.
 * Et utkast uten ett eneste funn i `findings` trenger ikke KI: da kalles ikke leverandøren, og
 * rapportkjernen setter selv sammen TGIU-linjene (ingen rad, ikke KI-tekst).
 */
export type AiSummaryGroup = {
  group: SummaryGroup;
  heading: string;
  findings: AiSummaryFinding[];
  fixedLines: AiSummaryFixedLine[];
};

/**
 * En tilstandsgrad slik den sendes til KI i `tg_explanation`. Samme koder som `CheckpointTg` i
 * `@/core/reports/logic` (som `@/core/ai` ikke kan importere).
 */
export type AiTgTrailTg = "0" | "1" | "2" | "3" | "IU";

/**
 * Én måling regelen leste da beslutningen ble tatt (`rule_suggestion_decisions.reasons`, tolket
 * strengt av `ParseDecisionReasons` i `@/core/reports`). `label`, `unit` og `material` er
 * etikettene i rapportens låste malversjon («Fukt i konstruksjonen», «vekt-%», «treverk») og
 * vaskes som annen tekst. **Grenseverdien er aldri med** (A597): typen har ikke noe felt for den.
 */
export type AiTgTrailMeasurement = {
  /** Feltets faste kode (`elements.key`). */
  fieldKey: string;
  label: string;
  value: number;
  unit: string | null;
  material: string | null;
};

/**
 * Årstallet en aldersregel leste. `source` sier om det er sjiktets eget årstall (`own`) eller
 * byggeåret brukt som reserve (`build_year`). `sourceLabel` er etiketten for kilden til byggeåret
 * i malen («anslått», «oppgitt av eier»), bare når `source = "build_year"` og kilden er valgt.
 * Årene i alderstabellen sendes aldri (A597).
 */
export type AiTgTrailYear = {
  year: number;
  age: number | null;
  source: "own" | "build_year";
  sourceLabel: string | null;
};

/**
 * Ett regelforslag på punktet med beslutningen og det som skjedde etterpå. Bare koder, TG, tall og
 * etiketter fra malen. Aldri `override_reason` (fritekst), avvikstekst, tidspunkt eller hvem.
 */
export type AiTgTrailSuggestion = {
  ruleKey: string;
  /**
   * TG-en reglene foreslo. «Velg TG2 eller TG3» gir begge (`["2", "3"]`). Tom liste når forslaget
   * er et HMS-utfall (da tilbys ikke forklaring for avviket, men forslaget kan stå på punktet).
   */
  suggestedTg: readonly AiTgTrailTg[];
  /** `null` = forslaget er åpent (ingen gjeldende beslutning). */
  decision: RuleSuggestionDecision | null;
  chosenTg: ChosenTg | null;
  overrideReasonCode: OverrideReasonCode | null;
  /** Knappeteksten for koden (`OVERRIDE_REASON_LABELS`). Aldri fritekstbegrunnelsen. */
  overrideReasonLabel: string | null;
  measurements: readonly AiTgTrailMeasurement[];
  /** Satt når regelen er en aldersregel. `null` ellers. */
  year: AiTgTrailYear | null;
  /** Om avviket beslutningen laget, står. `null` når beslutningen ikke laget avvik. */
  deviationStands: boolean | null;
  /** TG-byttene på avviket etter beslutningen, eldst først. */
  tgChanges: readonly { from: AiTgTrailTg | null; to: AiTgTrailTg | null }[];
};

/**
 * Inndata til `tg_explanation` (docs/funksjoner/fase2a-tg-spor.md «KI i bunnen»). Bygges bare av
 * `@/core/reports` (`BuildTgExplanationInput`) fra kildene i `AI_FEATURES.tg_explanation
 * .serverSources`, med `grant.organizationId`. Kommer aldri fra nettleseren.
 *
 * Typen har med vilje ingen felt for navn, adresse, romnavn, etasje, bygning, ansatt, rolle,
 * tid, dato, oppdragsnummer, fritekst eller noe fra `claims`. Et nytt felt her er en endring i
 * tillatt-listen og krever gjennomgang av sikkerhet-personvern (A175).
 */
export type AiTgTrailInput = {
  /** `checkpoints.key` og `checkpoints.name` i den låste malversjonen. */
  checkpointKey: string;
  checkpointName: string;
  /** `room_types.key`. Aldri romnavnet. */
  roomTypeKey: string;
  /** Punktets TG nå (`computeCheckpointTg`). `null` = ingen TG ennå. */
  currentCheckpointTg: AiTgTrailTg | null;
  /**
   * Avvikets TG når forklaringen gjelder ett avvik. Utelatt når den gjelder punktet. Et HMS-avvik
   * gir aldri et kall (`ExplainTgResult.kind = "not_offered"`).
   */
  deviationTg?: AiTgTrailTg | null;
  /** Punktets TG i siste utgivelse (`report_releases.snapshot`). `null` = ikke utgitt. */
  publishedTg: AiTgTrailTg | null;
  /** `true` når rapporten er utgitt og `publishedTg` er ulik `currentCheckpointTg`. */
  changedAfterRelease: boolean;
  /** TG satt direkte på punktet (`checkpoint_results.tg_direct`), eldst først. */
  directTgChanges: readonly { from: AiTgTrailTg | null; to: AiTgTrailTg | null }[];
  suggestions: readonly AiTgTrailSuggestion[];
};

/**
 * Det bare serveren kan gi inn (tredje argument til `requestSuggestion`). Kommer aldri fra
 * nettleseren: skjemaet for forespørselen har ikke disse nøklene, og serverinngangene i
 * `@/core/reports` bygger dem fra databasen med `grant.organizationId`.
 *
 * `phrase_suggest` krever `candidates` (minst én, høyst `AI_CANDIDATES_MAX`) og ikke
 * `summaryGroups`. `summary_draft` krever `summaryGroups` (minst ett funn i `findings`, høyst
 * `AI_SUMMARY_FINDINGS_MAX` funn og faste linjer til sammen) og ikke `candidates`.
 * `language_polish` tar ingen av dem. `tg_explanation` krever `tgTrail` og ingen av de andre, og
 * ingen annen funksjon tar `tgTrail`. Alt annet gir `AiRequestRejectedError`. Over grensen gir
 * `AiInputTooLargeError`; kjernen kutter aldri selv.
 */
export type AiServerInput = {
  candidates?: readonly AiCandidate[];
  /**
   * Hvor mange kandidater kandidatkilden kuttet for å komme under `AI_CANDIDATES_MAX` (A467).
   * Bare sammen med `candidates`. Heltall fra 0; føres som `candidates_cut` i `input_summary`.
   */
  candidatesCut?: number;
  summaryGroups?: readonly AiSummaryGroup[];
  /**
   * Sporet `tg_explanation` skal forklare. Høyst `AI_TG_TRAIL_SUGGESTIONS_MAX` forslag,
   * `AI_TG_TRAIL_MEASUREMENTS_MAX` målinger per forslag og `AI_TG_TRAIL_CHANGES_MAX` TG-bytter
   * til sammen (`limits.ts`); over grensen gir `AiInputTooLargeError`. Etikettene vaskes hver for seg, og lekkasjesjekken dekker hele
   * ledeteksten. `input_summary` får bare antall (forslag, målinger, TG-bytter), aldri verdier.
   */
  tgTrail?: AiTgTrailInput;
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
   * En vakt stoppet svaret (utfallet `stopped`, A431). Teksten går aldri til kalleren. `guard` er
   * den faste vaktkoden, slik at skjermen kan vise riktig melding (TG eller tall, manglende funn,
   * skjulte opplysninger). Kan ikke avgjøres med `recordDecision`.
   */
  | { kind: "stopped"; usageId: string; guard: AiGuardCode }
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
 *   og lekkasjesjekken dekker hele ledeteksten. Leverandørporten (`providers/types.ts`) er
 *   uendret: adapteren gir rå tekst, og bare kjernen tolker merkene. Svaret tolkes strengt: bare
 *   merker som ble sendt, doble tas bort, høyst `AI_SUGGESTED_CANDIDATES_MAX`. Ingen gyldige gir
 *   `no_match`. `input_summary` har bare antall (tegn per felt, `candidates`, `candidates_cut`,
 *   `unknown_labels`, `duplicate_labels`). `output_text` er tom, `candidate_refs` har listen.
 * - **Vaktene** (`CheckAnswerGuards`) kjøres på svaret til `language_polish` og `summary_draft`
 *   før noe returneres. Treff gir raden `stopped` med vaktkoden, mengde og kostnad beholdt, og
 *   svaret `{ kind: "stopped" }`. Et stoppet svar avviser ikke forrige åpne forslag på målet.
 * - **Plassholderne** (A466): koblingen plassholder → opprinnelig verdi holdes bare i minnet
 *   under kallet. `text` i svaret har de opprinnelige verdiene satt tilbake; `output_text` på
 *   raden beholder plassholderne. Kan de ikke byttes entydig tilbake, stoppes svaret
 *   (`placeholder_guard`).
 * - **Sammendraget**: svaret fra leverandøren har tekst per F-merke. Kjernen setter teksten
 *   sammen i rekkefølgen gruppene kom inn: kodens overskrift, så ett avsnitt per funn som starter
 *   med punktets navn (A462), og for `tgiu` de faste linjene (`AiSummaryFixedLine`). `text` i
 *   svaret er dette med opprinnelige verdier; `output_text` er det samme bygget av de vaskede
 *   delene.
 * - **Ekte leverandør**: en funksjon som ikke står i `settings.features`, gir `disabled` som før.
 * - **Forklaring av graden** (`tg_explanation`, tillegg 24.11.2026): `fields` er tom, og inndata er
 *   `serverInput.tgTrail`. Svaret er `{ kind: "suggestion" }` med ren tekst, eller `stopped`. Et
 *   nytt utkast avviser bare **samme ansattes** åpne utkast på målet (`employee_id =
 *   grant.employeeId`, A598), ikke andres; de andre funksjonene avviser som før alle åpne forslag
 *   på målet. Raden får `report_id` og `assignment_id` fra målet som ellers, og aldri en sak-id.
 */
export type RequestSuggestion = (
  grant: EmployeeGrant,
  request: AiSuggestionRequest,
  serverInput?: AiServerInput,
) => Promise<AiSuggestionResult>;

/**
 * Flere forslag fra ett trykk («Språkvask avviket», A460): ett kall til serveren, og for hvert
 * felt ett leverandørkall og én rad i loggen, slik at hvert felt får sin egen `target_ref`, sin
 * egen vakt og sin egen beslutning (ADR 0006, tillegg 17.11.2026). Svarene kommer i samme
 * rekkefølge som forespørslene.
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

/**
 * Registrerer beslutningen i egen transaksjon. Uendret, bortsett fra `options` (se
 * `AiDecisionOptions`). Pakker inn `RecordDecisionIn`.
 */
export type RecordDecision = (
  grant: EmployeeGrant,
  usageId: string,
  decision: AiDecision,
  options?: AiDecisionOptions,
) => Promise<void>;

/**
 * Samme som `RecordDecision`, men i kallerens transaksjon (A469), slik at teksten og beslutningen
 * lagres sammen eller ikke i det hele tatt. Brukes av `ApplyPhrase` og `SaveSummary` i
 * `@/core/reports`. Samme kontroller og samme feil (`AiDecisionError`, `AiRequestRejectedError`);
 * kaster den, ruller kalleren tilbake.
 *
 * **Fast låserekkefølge:** kalleren har alltid låst rapportraden først (`withRoomWrite` eller
 * `withReportWrite`), og `recordDecisionIn` tar deretter KI-låsen på målet (`lockTarget`). Ingen
 * kode tar KI-låsen først og rapportraden etterpå. `requestSuggestion` og `ResolveAiTarget` låser
 * aldri rapportraden eller målraden, så de to veiene kan ikke vente på hverandre.
 *
 * `tx` må være en transaksjon, ikke `db`: funksjonen tar radlås og forutsetter at kalleren
 * fullfører eller ruller tilbake.
 */
export type RecordDecisionIn = (
  tx: DbExecutor,
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
 * Leser aldri tekstkolonner og låser aldri rader (se låserekkefølgen i `RecordDecisionIn`).
 *
 * **Ett unntak fra `draft`** (A599, tillegg 24.11.2026): målet `checkpoint_result` med feltkoden
 * `TG_EXPLANATION_FIELD_KEY` godtar rapporten i `draft`, `published` og `superseded`. Grenen
 * velges av målet, ikke av et argument, så ingen annen funksjon kan be om den: `tg_explanation`
 * er eneste funksjon med dette målet i `allowedTargets`, og ingen annen funksjon har det. Alt
 * annet i kjeden er likt (organisasjon og `deleted_at is null` i alle ledd).
 */
export type ResolveAiTarget = (
  grant: EmployeeGrant,
  target: AiTargetRef,
) => Promise<ResolvedAiTarget | null>;

/**
 * Én del av det som ble sendt, og svaret på den. `language_polish` har én del med `label = null`.
 * `summary_draft` har én del per funn, med F-merket som `label`.
 */
export type AiGuardSentPart = {
  label: string | null;
  /** De vaskede tekstene som gikk til leverandøren for denne delen. */
  texts: readonly string[];
};

/** Svaret slik kjernen tolket det: tekst per merke, også merker som ikke ble sendt. */
export type AiGuardAnswerPart = { label: string | null; text: string };

/**
 * Vaktene på svaret (ren funksjon i `src/core/ai/guards.ts`, T-0046, A431, A440, A461, A466 og
 * A471). Brukes av kjernen og av evalueringen. Vaktene kjøres i rekkefølgen under, og den første
 * som slår til, er svaret. `null` betyr at svaret kan vises.
 *
 * 1. `tg_guard`: for `language_polish` når TG-omtalene i svaret (`extractTgMentions`: «TG» med
 *    grad, «tilstandsgrad», «ikke undersøkt» regnet som TGIU) ikke er de samme som i det som ble
 *    sendt. For `summary_draft` ved enhver TG-omtale i en del av svaret.
 * 2. `coverage_guard` (bare `summary_draft`): et merke som ble sendt, mangler i svaret eller har
 *    tom tekst, et merke står to ganger, eller svaret har et merke som ikke ble sendt.
 * 3. `number_guard`: et tall i en del av svaret som ikke finnes i den samme delens `texts`. Tall
 *    sammenlignes som sifferrekker med desimaltegn etter at mellomrom som tusenskille er tatt
 *    bort: «40 000» er lik «40000», «15,0» er ikke lik «15» (vakten feiler lukket). Tall i
 *    merkene (F1, G2) regnes ikke.
 * 4. `placeholder_guard`: en del av svaret har ikke nøyaktig de samme plassholderne
 *    (`PII_PLACEHOLDERS`), like mange av hver type, som den samme delens `texts`. Da kan de ikke
 *    byttes entydig tilbake.
 *
 * `phrase_suggest` har ingen tekst i svaret og kjører ikke vaktene.
 *
 * `tg_explanation` (A596, tillegg 24.11.2026) har én del med `label = null` og kjører vakt 1, 3 og
 * 4. Vakt 1 har egen gren under samme kode `tg_guard`: hver TG-omtale i svaret må stå i
 * `allowedTg`, og svaret må ha minst én TG-omtale. `allowedTg` er alle TG-ene i inndata
 * (foreslått, begge ved «velg», valgt, alle fra og til i TG-byttene, gjeldende, avvikets og
 * utgitt), regnet av kjernen fra `AiTgTrailInput`, aldri fra ledeteksten. Mangler `allowedTg` for
 * `tg_explanation`, stopper vakten (feiler lukket). For tallvakten skrives TG-ene i ledeteksten
 * som «TG2», slik at sifferet i en lovlig TG-omtale står i `texts`.
 */
export type CheckAnswerGuards = (input: {
  feature: AiFeatureCode;
  sent: readonly AiGuardSentPart[];
  answer: readonly AiGuardAnswerPart[];
  /** Bare for `tg_explanation`: TG-ene svaret kan nevne. */
  allowedTg?: readonly AiTgTrailTg[];
}) => AiGuardCode | null;

/**
 * Bytter plassholderne i én del av svaret tilbake til de opprinnelige verdiene (ren funksjon,
 * A466). `originals` er verdiene vasken tok ut av den samme delen, i den rekkefølgen de sto.
 * Plassholder nummer k av en type i svaret får opprinnelig verdi nummer k av samme type. Kalles
 * bare etter at `CheckAnswerGuards` har sluppet svaret gjennom; stemmer ikke antallet likevel,
 * kaster den. `originals` holdes bare i minnet under kallet og lagres eller logges aldri.
 */
export type RestorePlaceholders = (
  answer: string,
  originals: readonly { placeholder: PiiPlaceholder; value: string }[],
) => string;
