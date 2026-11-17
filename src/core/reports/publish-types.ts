import type { Actor, EmployeeGrant } from "@/core/access";
import type { DbExecutor } from "@/db/client";
import type {
  ChosenTg,
  ConstructionVulnerable,
  CostType,
  DeviationKind,
  DeviationTg,
  OverrideReasonCode,
  PublishCheckCode,
  PublishOverrideReasonCode,
  REPORT_SNAPSHOT_SCHEMA_VERSION,
  RuleSuggestionDecision,
  TextSource,
  TgDirect,
} from "@/db/schema";
import type {
  PublishCheckFinding,
  PublishCheckSummary,
  PublishCheckTarget,
} from "./logic/publish-check-types";
import type { CheckpointTg } from "./logic/types";

/**
 * Grensesnittet til publiseringen i rapportkjernen (ADR 0015,
 * docs/funksjoner/fase2a-publisering-badet.md). Utvikleren bygger tjenesten mot funksjonstypene
 * nederst. Det som står øverst i `./types`, gjelder også her. I tillegg:
 *
 * - KI er ikke med. Ingen fil i publiseringen importerer `src/core/ai`, og publisering lager
 *   ingen rad i `ai_usage_log`. KI setter aldri TG, krysser aldri bort en sperre og publiserer
 *   aldri.
 * - Rapporten slås alltid opp fra oppdraget med `grant.organizationId`. Rapport-id, ansatt, tid,
 *   versjonsnummer og funn tas aldri fra klienten: serveren regner sjekken selv på lagrede data.
 * - Rader i `report_releases` og `publish_check_results` skrives bare av `PublishReport`. Ingen
 *   tjeneste oppdaterer dem eller setter `deleted_at`. Visning er ren lesing.
 * - Begrunnelsesteksten (`override_reason`) står bare i raden: aldri i revisjonsloggen,
 *   hendelser, applikasjonsloggen eller feilmeldinger. Snapshot logges aldri.
 * - Skriving til en publisert rapport gir `ReportValidationError` med koden `report_published`
 *   («Rapporten er publisert. Lag ny versjon for å rette.»). Synkruten svarer med avvisning som
 *   ikke stopper køen.
 */

// --- Snapshot (report_releases.snapshot) -------------------------------------------------------

/**
 * Merket på en tekst som kom fra et KI-forslag takstmannen godtok eller endret. Aldri
 * forslagsteksten, og aldri forslag som venter eller er avvist.
 */
export type SnapshotAiMark = { ai_usage_id: string; status: "accepted" | "edited" };

export type SnapshotAnswer = {
  element_key: string;
  /** Ledeteksten i malen da rapporten ble utgitt. */
  label: string;
  value_text: string | null;
  value_number: number | null;
  value_option_keys: string[] | null;
  /** Valgenes tekst i malen, i samme rekkefølge som kodene. */
  value_option_labels: string[] | null;
  ai: SnapshotAiMark | null;
};

export type SnapshotMeasure = {
  id: string;
  text: string;
  text_source: TextSource;
  ai: SnapshotAiMark | null;
};

export type SnapshotDeviation = {
  id: string;
  kind: DeviationKind;
  tg: DeviationTg | null;
  question_key: string | null;
  outcome_key: string | null;
  deviation_text: string | null;
  cause_criterion: string | null;
  cause_text: string | null;
  consequence_text: string | null;
  cost: { type: CostType; band_key: string | null; amount: number | null; text: string | null };
  measurement_value: number | null;
  measurement_unit: string | null;
  text_source: TextSource;
  suggested_by_rule_key: string | null;
  measures: SnapshotMeasure[];
  /** KI-merking per tekstfelt (`REPORT_AI_TARGET_FIELDS.deviation`). Bare felt med merke står her. */
  ai: Partial<Record<"deviation_text" | "cause_text" | "consequence_text", SnapshotAiMark>>;
};

export type SnapshotTgiu = {
  reason: string | null;
  owner_informed: boolean | null;
  owner_informed_at: string | null;
  alternative_check_method: string | null;
  alternative_check_result: string | null;
  risk_assessment: string | null;
  construction_vulnerable: ConstructionVulnerable | null;
  how_to_examine: string | null;
  ai: Partial<Record<"reason" | "risk_assessment" | "how_to_examine", SnapshotAiMark>>;
};

/**
 * Siste beslutning per regel på punktet. Fritekstbegrunnelsen tas ikke med: den står i
 * `rule_suggestion_decisions`, som bare får nye rader.
 */
export type SnapshotRuleDecision = {
  rule_key: string;
  decision: RuleSuggestionDecision;
  chosen_tg: ChosenTg | null;
  chosen_outcome_key: string | null;
  override_reason_code: OverrideReasonCode | null;
  decided_at: string;
};

export type SnapshotCheckpoint = {
  checkpoint_id: string;
  checkpoint_key: string;
  label: string;
  /** TG slik den ble regnet ved utgivelsen (`computeCheckpointTg`). */
  tg: CheckpointTg | null;
  tg_direct: TgDirect | null;
  done: boolean;
  description_text: string | null;
  description_ai: SnapshotAiMark | null;
  answers: SnapshotAnswer[];
  deviations: SnapshotDeviation[];
  tgiu: SnapshotTgiu | null;
  rule_decisions: SnapshotRuleDecision[];
};

export type SnapshotRoom = {
  room_id: string;
  name: string | null;
  room_type: string;
  /** Svar på rommet som ikke hører til et kontrollpunkt. */
  answers: SnapshotAnswer[];
  checkpoints: SnapshotCheckpoint[];
};

export type SnapshotFloor = { floor_id: string; name: string | null; rooms: SnapshotRoom[] };

export type SnapshotBuilding = {
  report_building_id: string;
  name: string | null;
  floors: SnapshotFloor[];
};

/**
 * Hele rapportinnholdet i en utgivelse (A452): en selvstendig kopi, ikke pekere. Nøklene er
 * `snake_case` som andre lagrede dokumenter. Nå bare våtrommene; nye deler kommer som nye felt,
 * og formen brytes bare med ny `schema_version`.
 *
 * Aldri med: parter, navn på personer, e-post, telefon, adresse, matrikkel, reklamasjonsdata,
 * KI-forslag som venter eller er avvist, slettede rader, og begrunnelser i fritekst.
 * `content_hash` er SHA-256 av `canonicalJson(snapshot)`.
 */
export type ReportSnapshot = {
  schema_version: typeof REPORT_SNAPSHOT_SCHEMA_VERSION;
  report: {
    report_id: string;
    report_type: string;
    template_version_id: string;
    template_family_id: string;
    template_version_number: number;
    /** Befaringsdatoen i norsk tid (ÅÅÅÅ-MM-DD). `null` når sperren ble krysset bort. */
    inspection_date: string | null;
  };
  buildings: SnapshotBuilding[];
};

// --- Sjekken ---------------------------------------------------------------------------------

/** Overstyringen av samme mangel i forrige utgivelse («I versjon 1 krysset du bort dette»). */
export type PreviousOverride = {
  versionNumber: number;
  reasonCode: PublishOverrideReasonCode;
  /** `null` uten tekst, og alltid `null` for den som ikke har `canSeeOverrideReasons`. */
  reason: string | null;
};

/** Et funn slik publiser-siden viser det. Teksten lages fra koden i skjermen. */
export type PublishFindingView = PublishCheckFinding & {
  /** `PublishFindingKey`. Sendes tilbake med overstyringen. */
  key: string;
  /** Intern sti til punktet, bygget på serveren fra id-er. `null` for funn på rapporten. */
  href: string | null;
  /** Til visning, lagres aldri sammen med funnet. */
  roomName: string | null;
  checkpointLabel: string | null;
  /** Bare for sperrer, og bare når rapporten har en tidligere utgivelse. Følger aldri med av seg selv. */
  previousOverride: PreviousOverride | null;
};

/** Et KI-forslag som venter, med teksten, til «Bruk», «Endre» og «Avvis» på publiser-siden (F4). */
export type PendingAiSuggestionView = {
  aiUsageId: string;
  target: PublishCheckTarget;
  outputText: string;
};

/** Én linje i «Dette publiseres», bygget fra samme data som snapshot. */
export type PublishPreviewRoom = {
  roomId: string;
  roomName: string | null;
  roomType: string;
  /** Antall punkter per TG. Punkter uten TG telles i `none`. */
  tgCounts: Record<CheckpointTg | "none", number>;
  /** Kostnaden på hvert TG3-avvik. */
  tg3Costs: { type: CostType; bandKey: string | null; amount: number | null }[];
};

/** Om den ansatte kan publisere. Vises øverst på siden før noe trykkes (F5). */
export type PublishAbility =
  | { allowed: true; certificationId: string }
  | { allowed: false; reason: "missing_permission" }
  | {
      allowed: false;
      reason: "no_valid_certification";
      /** Siste gyldige dag for den nyeste sertifiseringen. `null` når den ansatte ikke har noen. */
      expiredOn: string | null;
    };

export type PublishCheckView =
  | { state: "not_started" }
  | {
      state: "draft";
      reportId: string;
      /** Versjonen neste publisering gir. */
      nextVersionNumber: number;
      findings: PublishFindingView[];
      summary: PublishCheckSummary;
      /** SHA-256 (hex) av `canonicalPublishCheck(findings)`. Sendes tilbake ved publisering. */
      fingerprint: string;
      /** Usann gir «Rapporten har ikke noe våtrom å publisere.», og publisering avvises. */
      hasWetRoom: boolean;
      preview: PublishPreviewRoom[];
      pendingAiSuggestions: PendingAiSuggestionView[];
      ability: PublishAbility;
      /** Den ansatte har `report.edit` og kan bruke «Rett nå». */
      canEdit: boolean;
    }
  | {
      state: "published";
      reportId: string;
      versionNumber: number;
      releasedAt: string;
      /** Den ansatte har `report.edit`. */
      canStartNewVersion: boolean;
    };

// --- Publisering -----------------------------------------------------------------------------

/** En sperre den ansatte krysser bort. Koden og målet finner serveren selv fra `findingKey`. */
export type PublishOverrideInput = {
  findingKey: string;
  reasonCode: PublishOverrideReasonCode;
  /** Påkrevd for `other` (minst 10 tegn), ellers valgfri. Trimmes; tom lagres som `null`. */
  text?: string | null;
};

export type PublishReportInput = {
  assignmentId: string;
  /** Fingeravtrykket fra listen den ansatte så. Mangler det, er svaret `check_changed`. */
  fingerprint: string | null;
  overrides: PublishOverrideInput[];
};

export type PublishReportResult =
  | {
      status: "published";
      releaseId: string;
      versionNumber: number;
      /** `null` når befaringsdatoen manglet og sperren ble krysset bort. */
      validUntil: string | null;
    }
  /** Funnlisten er en annen enn den ansatte så. Ingenting er lagret; den nye listen følger med. */
  | { status: "check_changed"; check: Extract<PublishCheckView, { state: "draft" }> }
  /** Sperrer er verken rettet eller krysset bort. Ingenting er lagret. */
  | { status: "blockers_remaining"; remaining: string[] };

/** En overstyring i listen «Utgivelser». */
export type ReleaseOverrideView = {
  checkCode: PublishCheckCode;
  target: PublishCheckTarget;
  roomName: string | null;
  checkpointLabel: string | null;
  reasonCode: PublishOverrideReasonCode;
  /** `null` uten tekst, og alltid `null` for den som ikke har `canSeeOverrideReasons` (kontor). */
  reason: string | null;
  overriddenByName: string;
  overriddenAt: string;
};

export type ReleaseView = {
  id: string;
  versionNumber: number;
  releasedAt: string;
  /** Navn slås opp i samme organisasjon, også for ansatte som har sluttet. */
  releasedByName: string;
  signedByName: string;
  originalReleaseDate: string;
  validUntil: string | null;
  overrides: ReleaseOverrideView[];
  warningCount: number;
};

// --- Funksjonene (bygges av utvikleren i `src/core/reports`) -----------------------------------

/**
 * Sjekken for oppdragets rapport (`organization.read`). Ren lesing: lager aldri rader, heller
 * ikke i `publish_check_results`. Bygger `PublishCheckInput` fra lagrede data (tolkningen av
 * våtromsfeltene står i `signals.ts`), kjører `computePublishCheck` og regner fingeravtrykket.
 */
export type GetPublishCheck = (
  actor: Actor,
  organizationId: string,
  assignmentId: string,
) => Promise<PublishCheckView>;

/**
 * Publiserer rapporten (`report.publish`). Én transaksjon som låser rapportraden med
 * `FOR UPDATE` (samme lås som `withRoomWrite`), i denne rekkefølgen:
 *
 * 1. Rapporten fra oppdraget med `grant.organizationId`. Status må være `draft`, ellers
 *    `ReportValidationError` (`report_published`).
 * 2. Gyldig sertifisering for `grant.employeeId` i dag i norsk tid (`FindValidCertification`).
 *    Ingen: `ReportValidationError` (`certification_missing`). Gjelder også admin (A29).
 * 3. Oppdraget må ha selskap (`company_id` er påkrevd i utgivelsen), ellers
 *    `ReportValidationError` (`company_missing`). Uten våtrom: `no_wet_room`. Ingen av dem kan
 *    krysses bort.
 * 4. Sjekken kjøres på nytt på lagrede data. Mangler fingeravtrykket eller er det et annet:
 *    `check_changed`.
 * 5. Hver overstyring må treffe en sperre serveren selv har regnet ut (`findingKey`), høyst én
 *    gang. Ukjent nøkkel, advarsel eller ugyldig begrunnelse (`CheckPublishOverrideReason`):
 *    `ReportValidationError` (`publish_override`). Sperrer uten overstyring: `blockers_remaining`.
 * 6. `report_releases`: versjon = høyeste + 1; `released_by` og `signed_by_employee_id` =
 *    `grant.employeeId`; `released_at`, `retain_until` (+ 10 år) og `content_hash` fra serveren;
 *    versjon 1 får `original_release_date` = i dag i norsk tid og `valid_until` = befaringsdato
 *    + ett år (tom uten befaringsdato); senere versjoner kopierer begge fra versjon 1.
 * 7. `publish_check_results` for alle funn, `reports.status = published`, revisjonslogg, og
 *    hendelsene `report.published` (bare versjon 1) eller `report.revised`, og
 *    `report.publish_override` per sperre (bare id-er, versjonsnummer og faste koder).
 *
 * To samtidige kall gir én utgivelse: det andre venter på låsen og får `report_published`. Den
 * unike indeksen på versjonsnummeret er siste vakt. Feil underveis lagrer ingenting.
 */
export type PublishReport = (
  actor: Actor,
  organizationId: string,
  input: PublishReportInput,
) => Promise<PublishReportResult>;

/**
 * «Lag ny versjon» (`report.edit`, A425): låser rapportraden, setter `status = draft` og skriver
 * revisjonslogg. Eldre utgivelser og sjekkrader røres ikke, og ingen overstyring følger med.
 * Rapporten må være `published`; er den alt `draft`, er svaret det samme uten endring.
 */
export type StartNewVersion = (
  actor: Actor,
  organizationId: string,
  assignmentId: string,
) => Promise<{ reportId: string; nextVersionNumber: number }>;

/**
 * Utgivelsene for oppdragets rapport, nyeste først (`organization.read`). Sender aldri snapshot.
 * `reason` er `null` for den som ikke har `canSeeOverrideReasons(grant)`: teksten fjernes i
 * tjenesten, ikke i skjermen. Slår aldri opp i `claims`.
 */
export type ListReleases = (
  actor: Actor,
  organizationId: string,
  assignmentId: string,
) => Promise<ReleaseView[]>;

/**
 * KI-forslagene som venter på oppdragets rapport (`organization.read`, A454): `outcome = 'ok'`,
 * `status = 'suggested'`, `deleted_at is null`, laget etter forrige utgivelse (alle når ingen
 * utgivelse finnes). Bruker den delvise indeksen `(organization_id, report_id)`.
 */
export type ListPendingAiSuggestions = (
  actor: Actor,
  organizationId: string,
  assignmentId: string,
) => Promise<PendingAiSuggestionView[]>;

/**
 * Om oppdragets gjeldende rapport er publisert. Kjernefunksjon uten egen tilgangssjekk: kalles
 * av `src/core/buildings` og skrivetjenestene her, bak en handling som alt er tilgangssjekket,
 * med `grant.organizationId` og i samme transaksjon som skrivingen. Oppdrag uten rapport gir
 * `false`.
 */
export type IsReportPublishedForAssignment = (
  executor: DbExecutor,
  organizationId: string,
  assignmentId: string,
) => Promise<boolean>;

// --- Funksjoner i andre kjernemoduler ----------------------------------------------------------

/**
 * `src/core/organization`: sertifiseringen som er gyldig for den ansatte på dagen `today`
 * (ÅÅÅÅ-MM-DD i norsk tid): ikke slettet, `valid_from` tom eller ≤ `today`, `valid_to` ≥ `today`
 * (utløpsdagen er siste gyldige dag). Flere gyldige: lengst `valid_to`, så `id`. Samme regel som
 * `report.publish` i tilgangssjekken (A29). Uten gyldig: `null`.
 */
export type FindValidCertification = (
  executor: DbExecutor,
  organizationId: string,
  employeeId: string,
  today: string,
) => Promise<{ id: string; validTo: string } | null>;

/**
 * `src/core/access`: om den ansatte får se begrunnelsesteksten ved overstyring (A450). Sann for
 * takstmann, leder og admin; usann for kontor. Admin ser alltid (regel 11).
 */
export type CanSeeOverrideReasons = (grant: EmployeeGrant) => boolean;
