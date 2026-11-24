import type { Actor, EmployeeGrant } from "@/core/access";
import type { AiGuardCode, AiTgTrailInput } from "@/core/ai";
import type { DbExecutor } from "@/db/client";
import type { ReportStatus } from "@/db/schema";
import type { TgTrail, TgTrailSummary } from "./logic/tg-trail-types";
import type { CheckpointTg } from "./logic/types";

/**
 * Grensesnittet til sporet i rapportkjernen: «Hvorfor har dette punktet denne TG-en?»
 * (docs/funksjoner/fase2a-tg-spor.md, ADR 0013 punkt 9c og ADR 0006 tillegg 24.11.2026).
 * Utvikleren bygger tjenesten i `src/core/reports/tg-trail.ts` mot funksjonstypene nederst. Det
 * som står øverst i `./types`, gjelder også her. I tillegg:
 *
 * - **Ingen lagring.** Sporet settes sammen ved lesing. Ingen tjeneste her skriver til rapporten,
 *   til `rule_suggestion_decisions` eller til revisjonsloggen. Eneste skriving er raden i
 *   `ai_usage_log` for forklaringsutkastet og beslutningen om det. Rapportens `row_version` og
 *   `updated_at` røres aldri.
 * - **Reglene kjøres ikke på nytt for det som er besluttet.** Sporet leser øyeblikksbildet på
 *   beslutningsraden (`suggestion`, `reasons`, settkodene, `inspection_year`). Bare et åpent
 *   forslag uten rad kommer fra regelkjøringen `room-view.ts` alt gjør.
 * - **To veier inn, samme spor.** `room`: tilgang som badet. `claim`: bare leder og admin
 *   (regel 12). Veien sier hvilken tilgang som kreves, ikke hva som vises.
 * - **Id-er fra klienten stoles aldri på alene.** Rapporten, punktet og avviket slås opp med
 *   `grant.organizationId` og `deleted_at is null` på rapport, oppdrag og rom, og punktet og
 *   avviket må høre til rapporten. Ellers `AccessDeniedError` (404), samme svar uansett grunn.
 * - **Aldri ut av tjenesten:** navn, ansatt-id (`decided_by`, `actor_employee_id`, `released_by`),
 *   enhets-id, `received_at`, rå `changes`, avvikstekst, årsak, konsekvens, og fritekst fra `claims`.
 *   Typene i `./logic/tg-trail-types` har ikke felt for noe av dette.
 * - **Begrunnelsesteksten** (`override_reason`) fjernes her, ikke i skjermen: uten
 *   `canSeeOverrideReasons(grant)` er den `null`. Den logges aldri og står aldri i feilmeldinger.
 * - Ingenting telles eller summeres per person (spørsmål 90 og 128).
 * - KI setter aldri TG. Forklaringen er tekst til den ansatte og lagres aldri i rapporten.
 */

// --- Veien inn ---------------------------------------------------------------------------------

/**
 * Hvor sporet åpnes fra.
 * - `room`: badskjermen. Krever `organization.read`.
 * - `claim`: reklamasjonssaken. Krever `claims.read` (leder og admin; kan ikke gis som
 *   enkeltrettighet, og `access.inspectors_edit_all` gir den ikke). Saken hentes med `getClaim`
 *   fra `@/core/claims` (som selv sjekker `claims.read`, organisasjon og `deleted_at`), og
 *   rapporten må høre til sakens oppdrag. `src/core/reports` leser aldri `claims`-tabellen selv.
 *   Slettet sak, fremmed sak og punkt fra et annet oppdrag gir alle `AccessDeniedError` (404).
 */
export type TgTrailVia = { kind: "room" } | { kind: "claim"; claimId: string };

/** Punktet (og eventuelt avviket) sporet gjelder. */
export type TgTrailRef = {
  reportId: string;
  checkpointResultId: string;
  /** Satt når sporet åpnes fra et avvikskort. Avviket må stå på punktet; mykt slettet er lov. */
  deviationId?: string;
  via: TgTrailVia;
};

// --- Listen i reklamasjonssaken ----------------------------------------------------------------

/** Én rad i «Hvorfor fikk punktene graden?». Ingen tekst fra rapporten, bare navn fra malen og TG. */
export type ClaimTrailCheckpoint = {
  checkpointResultId: string;
  checkpointKey: string;
  checkpointName: string;
  currentTg: CheckpointTg | null;
  /** Punktets TG i siste utgivelse. `null` når rapporten ikke er utgitt eller punktet ikke var med. */
  publishedTg: CheckpointTg | null;
  /** Rapporten er utgitt, og `publishedTg` er ulik `currentTg`. Da vises begge. */
  changedAfterRelease: boolean;
  /**
   * Merket «Endret fra forslag»: den første gjeldende beslutningen på punktet som er endret eller
   * avvist, ellers `plain`. Samme regel som kortversjonen på Spor-knappen (`SummarizeTgTrail`).
   */
  summary: TgTrailSummary;
  /** «Kan gjelde reklamasjonen»: treff fra `matchClaimBuildingPart`. Bare ja eller nei kommer ut. */
  mayConcernClaim: boolean;
};

export type ClaimTrailRoom = {
  roomId: string;
  /**
   * Romnavnet slik takstmannen skrev det. Vises for leder og admin og brukes av søkefeltet i
   * nettleseren. Går aldri til KI (`rooms.name` står i `NEVER_FIELDS`).
   */
  roomName: string | null;
  roomTypeKey: string;
  roomTypeName: string;
  /**
   * Sortert: `mayConcernClaim` først, så `summary.kind` ulik `plain`, så malens rekkefølge.
   * Rom uten punkter i listen tas ikke med.
   */
  checkpoints: ClaimTrailCheckpoint[];
};

export type ClaimTrailReport = {
  reportId: string;
  status: ReportStatus;
  /** Siste utgivelse av rapporten. `null` når den ikke er utgitt. */
  latestVersionNumber: number | null;
  latestReleasedAt: string | null;
  rooms: ClaimTrailRoom[];
};

// --- Forklaringsutkastet -----------------------------------------------------------------------

export type ExplainTgInput = TgTrailRef & {
  /** UUID v7 laget på enheten. Blir id-en i `ai_usage_log`; samme id gir samme svar. */
  requestId: string;
};

export type ExplainTgResult =
  /** Utkastet. Merkes «KI-utkast» i panelet. `createdAt` er radens tid som ISO-tid. */
  | { kind: "draft"; usageId: string; text: string; createdAt: string }
  /** En vakt stoppet svaret. Teksten går aldri ut. */
  | { kind: "stopped"; guard: AiGuardCode }
  /** KI er ikke slått på. Ingen rad i loggen. */
  | { kind: "disabled" }
  /** Sporet gjelder et HMS-avvik, eller det er ingenting å forklare. Ingen rad og intet kall. */
  | { kind: "not_offered" }
  | { kind: "error" };

export type DecideTgExplanationInput = TgTrailRef & {
  usageId: string;
  /**
   * `accepted`: «Kopier» av urørt tekst. `edited`: «Kopier» etter retting. `rejected`: «Forkast».
   * Lukkes panelet uten valg, kalles tjenesten ikke. Det finnes ingen `undo`: ingenting er lagret
   * i rapporten som kan angres. Den rettede teksten er ikke med i typen og sendes aldri (A590).
   */
  decision: "accepted" | "edited" | "rejected";
};

// --- Funksjonene (bygges av utvikleren i `src/core/reports/tg-trail.ts`) ----------------------

/**
 * Sporet for ett punkt, eller ett avvik på punktet. Ren lesing.
 *
 * Rekkefølge: `requireUuid` på alle id-er → tilgang etter `via` → rapporten, punktet og avviket
 * slås opp med `grant.organizationId` → beslutningsradene, avvikene (også mykt slettede),
 * utgivelsene og hendelsene (`listEntityAuditEvents` med punktets og avvikenes id-er) leses →
 * rollene slås opp i `employee_roles` i samme organisasjon, også for ansatte som har sluttet →
 * `composeTgTrail` → begrunnelsesteksten fjernes for dem som ikke får se den.
 *
 * - Rapporten kan være `draft`, `published` eller `superseded`. Mykt slettet rapport, oppdrag eller
 *   rom gir 404.
 * - `explanation`: `no_permission` uten `report.edit`; `ai_disabled` når KI er av for
 *   organisasjonen eller funksjonen; ellers den ansattes eget åpne eller siste utkast på punktet
 *   (`employee_id = grant.employeeId`, funksjonen `tg_explanation`, målet punktet). Andres utkast
 *   vises aldri, heller ikke for leder eller admin (A598).
 * - Første lasting av rommet kaller aldri denne og leser aldri `audit_log` for sporet: kortversjonen
 *   på knappen bygges i nettleseren med `summarizeTgTrail`.
 * - `expectTenantIsolation` i testfilen.
 */
export type GetTgTrail = (
  actor: Actor,
  organizationId: string,
  ref: TgTrailRef,
) => Promise<TgTrail>;

/**
 * Punktene i «Hvorfor fikk punktene graden?» på en reklamasjonssak (`claims.read`).
 *
 * - Saken hentes med `getClaim`. Slettet eller fremmed sak gir `AccessDeniedError` (404).
 * - Rapportene på sakens oppdrag med `grant.organizationId` og `deleted_at is null`, i alle
 *   statuser (også `draft`: en utgitt rapport som rettes, er `draft` til den publiseres igjen).
 *   Gjeldende rapport først, så erstattede, nyeste først.
 * - Punktene som har avvik med TG2 eller TG3, TGIU, TG satt direkte, eller en beslutningsrad om et
 *   regelforslag, gruppert per rom. Mykt slettede rom vises ikke.
 * - Leser ikke `audit_log` (listen trenger bare beslutningsradene, avvikene og siste utgivelse).
 * - `mayConcernClaim` kommer fra `matchClaimBuildingPart` i `@/core/claims`: denne tjenesten sender
 *   inn navnene på romtype, rom og kontrollpunkt per punkt og får id-er tilbake. Sakens tekst
 *   leses aldri her.
 * - `expectTenantIsolation` i testfilen.
 */
export type ListClaimTgTrailCheckpoints = (
  actor: Actor,
  organizationId: string,
  claimId: string,
) => Promise<ClaimTrailReport[]>;

/**
 * Bygger KI-inndata fra sporet (intern i `src/core/reports`, eksporteres ikke fra `index.ts`).
 * Leser bare kildene i `AI_FEATURES.tg_explanation.serverSources`. Tar aldri med
 * `overrideReason`, tid, rolle, romnavn eller grenseverdi (`limit`, `comparator`); typen
 * `AiTgTrailInput` har ikke felt for dem. Gir `null` når det ikke er noe å forklare eller sporet
 * gjelder et HMS-avvik.
 */
export type BuildTgExplanationInput = (
  trail: TgTrail,
  roomTypeKey: string,
) => AiTgTrailInput | null;

/**
 * «Lag forklaring»: et KI-utkast på 2–4 setninger om hvorfor punktet har graden.
 *
 * - Tilgang: `report.edit`. Med `via.kind = "claim"` kreves i tillegg `claims.read` (gjennom
 *   `getClaim`), og rapporten må høre til sakens oppdrag. Kontor får `AccessDeniedError`.
 * - Virker også når rapporten er `published` eller `superseded` (A599): målet er
 *   `{ type: "checkpoint_result", id: checkpointResultId, fieldKey: TG_EXPLANATION_FIELD_KEY }`,
 *   som er eneste mål `resolveAiTarget` godtar etter publisering.
 * - Sporet bygges som i `GetTgTrail`, gjøres om med `BuildTgExplanationInput` og sendes som
 *   `AiServerInput.tgTrail` til `requestSuggestion` med `fields = {}`. Nettleseren sender aldri
 *   tekst.
 * - Et åpent utkast vises fra `GetTgTrail` (`explanation.draft`) uten nytt kall til KI. Denne
 *   tjenesten kalles bare når den ansatte ber om et nytt utkast, og det nye avviser da bare den
 *   ansattes egne åpne utkast på punktet. Samme `requestId` to ganger gir samme rad og samme svar.
 * - `blocked` og `no_match` fra kjernen gis ut som `error`.
 * - Loggraden har ingen sak-id: verken i `target_ref`, `input_summary` eller andre steder.
 * - Endrer ingenting i rapporten, heller ikke `row_version` eller `updated_at`.
 * - `expectTenantIsolation` i testfilen.
 */
export type ExplainTg = (
  actor: Actor,
  organizationId: string,
  input: ExplainTgInput,
) => Promise<ExplainTgResult>;

/**
 * Lagrer avgjørelsen om et forklaringsutkast: godtatt, endret eller avvist.
 *
 * Egen tjeneste, ikke `decideAiText`: den går gjennom `withRoomWrite`, som krever rapporten i
 * `draft` og låser den for skriving. Rekkefølge:
 *
 * 1. `requireUuid` på alle id-er. Tilgang som `ExplainTg` (`report.edit`, og `claims.read` med
 *    `via.kind = "claim"`).
 * 2. Én transaksjon. Rapporten slås opp med `grant.organizationId` og `deleted_at is null` og låses
 *    med `for share`, uten krav om `draft`. Delt lås hindrer ikke lesing og stopper ikke andre
 *    forklaringer, men holder fast på låserekkefølgen: rapportraden først, så KI-låsen
 *    (`RecordDecisionIn`).
 * 3. Loggraden hentes og bindes: `organization_id = grant.organizationId`, `feature =
 *    "tg_explanation"`, `report_id` er denne rapporten, `target_ref` er akkurat dette punktet med
 *    `TG_EXPLANATION_FIELD_KEY`, og `employee_id = grant.employeeId` (bare egne utkast, A598).
 *    Avvik på ett av punktene gir `AccessDeniedError`, samme nøytrale svar uansett grunn, og
 *    ingenting er endret (samme feilklasse som funnet i PR #234).
 * 4. `recordDecisionIn(tx, grant, usageId, decision)` i samme transaksjon.
 *
 * Skriver bare til `ai_usage_log`. Ingen rad i revisjonsloggen (ingenting i rapporten er endret),
 * og rapportens `row_version` og `updated_at` er urørt. `expectTenantIsolation` i testfilen.
 */
export type DecideTgExplanation = (
  actor: Actor,
  organizationId: string,
  input: DecideTgExplanationInput,
) => Promise<{ status: "saved" }>;

/**
 * Det tjenestene over deler etter tilgangssjekken (intern). `claimAssignmentId` er satt for veien
 * `claim`, og rapporten må da ha samme `assignment_id`.
 */
export type TgTrailScope = {
  executor: DbExecutor;
  grant: EmployeeGrant;
  reportId: string;
  reportStatus: ReportStatus;
  templateVersionId: string;
  checkpointResultId: string;
  deviationId: string | null;
  claimAssignmentId: string | null;
};
