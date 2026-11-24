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
 * (docs/funksjoner/fase2a-ki-i-veien.md).
 *
 * «Skriv det du ser» la til `outcome_match` (se «Kontrakten for `outcome_match`» nederst), i samme
 * endring som definisjonen i `AI_FEATURES`, ledeteksten `outcome_match.v1` og grenen i
 * `checkServerInput`. Uten grenen ville notatet gått samme vei som språkvask og blitt lagret i
 * `output_text`.
 */
export type AiFeatureCode =
  "language_polish" | "phrase_suggest" | "summary_draft" | "outcome_match";

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
 * Det bare serveren kan gi inn (tredje argument til `requestSuggestion`). Kommer aldri fra
 * nettleseren: skjemaet for forespørselen har ikke disse nøklene, og serverinngangene i
 * `@/core/reports` bygger dem fra databasen med `grant.organizationId`.
 *
 * `phrase_suggest` krever `candidates` (minst én, høyst `AI_CANDIDATES_MAX`) og ikke
 * `summaryGroups`. `summary_draft` krever `summaryGroups` (minst ett funn i `findings`, høyst
 * `AI_SUMMARY_FINDINGS_MAX` funn og faste linjer til sammen) og ikke `candidates`.
 * `language_polish` tar ingen av dem. Alt annet gir `AiRequestRejectedError`. Over grensen gir
 * `AiInputTooLargeError`; kjernen kutter aldri selv.
 *
 * `outcome_match` krever `candidates` (minst én, høyst `OUTCOME_MATCH_CANDIDATES_MAX`, alle med
 * kilden `template_outcome`), og verken `candidatesCut` eller `summaryGroups`: kandidatlisten til
 * `outcome_match` kuttes aldri, heller ikke av kalleren (A554).
 */
export type AiServerInput = {
  candidates?: readonly AiCandidate[];
  /**
   * Hvor mange kandidater kandidatkilden kuttet for å komme under `AI_CANDIDATES_MAX` (A467).
   * Bare sammen med `candidates`. Heltall fra 0; føres som `candidates_cut` i `input_summary`.
   */
  candidatesCut?: number;
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
   * For `outcome_match`: 1 til `OUTCOME_MATCH_MAX` (3).
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
 */
export type CheckAnswerGuards = (input: {
  feature: AiFeatureCode;
  sent: readonly AiGuardSentPart[];
  answer: readonly AiGuardAnswerPart[];
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

// --- Kontrakten for `outcome_match` («Skriv det du ser») -----------------------------------------

/**
 * Det `requestSuggestion` gjør for `outcome_match` (docs/funksjoner/fase2a-skriv-det-du-ser.md,
 * ADR 0006 tillegg 24.11.2026). Typen under er bare til for å beskrive kontrakten; inngangen er
 * fortsatt `RequestSuggestion`.
 *
 * **Definisjonen i `AI_FEATURES` (tillatt-listen krever gjennomgang av sikkerhet-personvern, A175):**
 * - `permission`: `report.edit`.
 * - `allowedFields`: bare `text` (notatet), med kilden `free_text`.
 * - `serverSources.candidates`: nøyaktig `checkpoints.name`, `deviation_questions.text` og
 *   `outcomes.deviation_text`. Ingen andre kolonner: ikke `outcomes.key`, `outcomes.kind`,
 *   `outcomes.source_ref`, hjelpetekst, romnavn, etasje eller bygning (A552).
 * - `allowedTargets`: nøyaktig `{ type: "report", fieldKey: REPORT_NEW_DEVIATION_FIELD_KEY }`.
 *   Ingen annen funksjon har dette målet.
 * - `promptVersion`: `outcome_match.v1`.
 *
 * **Forespørselen:** `target` er rapporten med feltkoden over, `assignmentId` og `reportId` er
 * `null` (målet slås opp av `ResolveAiTarget` som for `summary_draft`), og `fields` er
 * `{ text: <notatet> }`. Rommet er ikke en del av målet (A555).
 *
 * **Kontrollene, i tillegg til de felles:**
 * - `text` som er tom etter `trim()`, eller lengre enn `OUTCOME_MATCH_NOTE_MAX`, gir
 *   `AiRequestRejectedError` uten rad og uten kall. Rapportkjernen har stoppet begge før kallet;
 *   dette er sikringen.
 * - Flere kandidater enn `OUTCOME_MATCH_CANDIDATES_MAX`, eller en kandidattekst over
 *   `AI_CANDIDATE_TEXT_MAX_LENGTH`, gir `AiInputTooLargeError("too_many_candidates")`.
 *
 * **Ledeteksten** bygges som for `phrase_suggest` (`prepareCandidatePrompt`): `text: <notat>`,
 * `Kandidater:` og én linje per kandidat (`K1: tekst`). Notatet og hver kandidat vaskes for seg.
 * Ingenting annet står etter skillet.
 *
 * **Svaret** tolkes med `parseCandidateAnswer` og kuttes til `OUTCOME_MATCH_MAX`. Funksjonen får
 * grensen som parameter (`max`, standard `AI_CANDIDATE_REFS_MAX`), så `phrase_suggest` er uendret.
 * Merker ut over grensen telles ikke som ukjente. Vaktene kjøres ikke: svaret har ingen tekst.
 *
 * **Raden:** `candidate_refs` har de viste utfallene (`template_outcome`, `outcomes.id`),
 * `output_text` er tom, og `input_summary` har bare tall: tegn i notatet (`text`), `candidates`,
 * `unknown_labels` og `duplicate_labels`. Ingen gyldige merker gir utfallet `no_match`.
 *
 * **Leverandørporten er uendret.** Den falske leverandøren leser notatet og K-linjene fra
 * ledeteksten og rangerer med `rankBySimilarity` fra `@/shared/lib/text-similarity`, samme
 * funksjon og samme grense som «Nærmeste treff (uten KI)» (A561). `src/core/ai` importerer aldri
 * fra `src/core/reports`.
 *
 * **Ekte leverandør (A565):** `outcome_match` står i `FAKE_ONLY_FEATURES` (`features.ts`). Mot en
 * ekte leverandør er svaret `disabled` uten vask, rad eller kall, også når koden står i
 * `settings.features`, og tilkoblingsskjemaet avviser koden.
 *
 * **Beslutningen:** `accepted` med valgt kandidat lagres bare med `RecordDecisionIn`, i samme
 * transaksjon som avviket (`ChooseOutcomeMatch` i `@/core/reports`). `edited` og `undo` brukes
 * aldri. Et nytt søk på samme rapport avviser forrige åpne rad; `accepted` på en avvist rad gir
 * `AiDecisionError`, som rapportkjernen gjør om til svaret `suggestion_outdated`.
 *
 * `RecordDecisionIn` er uendret og tåler fortsatt `accepted` to ganger med samme kandidat. At et
 * brukt søk aldri gir to avvik, er derfor rapportkjernens ansvar (A564, `ChooseOutcomeMatch`).
 */
export type OutcomeMatchRequest = Pick<AiSuggestionRequest, "requestId"> & {
  feature: "outcome_match";
  assignmentId: null;
  reportId: null;
  target: { type: "report"; id: string; fieldKey: "new_deviation" };
  fields: { text: string };
};
