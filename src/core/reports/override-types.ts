import type { Actor, EmployeeGrant } from "@/core/access";
import type { AiGuardCode, AiOverrideStats } from "@/core/ai";
import type {
  OverrideSummarySource,
  OverrideSummaryStatus,
  PublishCheckCode,
  PublishOverrideReasonCode,
} from "@/db/schema";

/**
 * Grensesnittet til «Overstyringer for leder» (docs/funksjoner/fase2a-overstyringer-leder.md,
 * ADR 0015 punkt 18 og ADR 0006 tillegg 24.11.2026). Utvikleren bygger tjenesten i
 * `src/core/reports/overrides.ts` mot funksjonstypene nederst.
 *
 * Støtter hovedmål: de ansatte (leder ser mønstre på én side), KI i bunnen (KI formulerer
 * månedsoppsummeringen fra koder og tall, leder godtar, endrer eller avviser) og færre
 * reklamasjoner (overstyringer som ga reklamasjon på samme punkt, blir røde).
 *
 * Gjelder alt i filen:
 * - Eneste inngang er `requireOrganizationAccess(actor, organizationId, "claims.read")`, og
 *   `claims.manage` for beslutning og lagring. Ikke bak `report.read` eller `report.publish`:
 *   siden viser reklamasjonsdata (regel 12, A565). Alle spørringer filtrerer på
 *   `grant.organizationId`.
 * - Ren lesing av `publish_check_results`, `report_releases` og `claims`. Ingen tjeneste her
 *   oppdaterer eller sletter dem (ADR 0015 punkt 7 og 10). Det eneste som skrives, er
 *   `override_summaries`.
 * - Spørringene velger aldri `override_reason`, `overridden_by`, `claims.created_by` eller
 *   tekstkolonnene i `claims`. Ingen type i filen har plass til dem, til navn eller til ansatt-id.
 * - `deleted_at is null` i alle ledd: resultatrad, utgivelse, rapport, oppdrag og reklamasjon.
 * - Ingen filter, sortering eller gruppering på person (spørsmål 100).
 * - Lederens tekst logges aldri: revisjonslogg, hendelser og applikasjonslogg får bare id, måned
 *   og status.
 */

// --- Listen (siste 90 dager) ---------------------------------------------------------------------

/**
 * Markeringen på én linje (A571, A566):
 * - `same_checkpoint` (rød): oppdraget har en reklamasjon med samme `checkpoint_key`, og
 *   utgivelsen er den siste utgivelsen av rapporten med norsk dato til og med `received_at`.
 * - `checkpoint_not_selected` (nøytral): samme tidsregel, men reklamasjonen har ikke kontrollpunkt.
 * - `none`: ellers, og alltid når overstyringen gjelder hele rapporten (`checkpointKey` er `null`).
 * Rød går foran nøytral når begge gjelder.
 */
export type OverrideClaimMarker = "none" | "same_checkpoint" | "checkpoint_not_selected";

/** Én utgivelse under en grunn. Sortert på dato, nyeste først, aldri på person. */
export type OverrideReleaseLine = {
  releaseId: string;
  reportId: string;
  /** Til lenken til utgivelsen. Tilgangen der sjekkes av utgivelsens egen side. */
  assignmentId: string;
  assignmentNumber: string;
  /** Utgivelsesdatoen i norsk tid, `YYYY-MM-DD`. */
  releasedDate: string;
  /** Vises som «v2» når den er over 1. */
  versionNumber: number;
  marker: OverrideClaimMarker;
  /**
   * Reklamasjonen lenken «Velg kontrollpunkt» går til. Bare satt når `marker` er
   * `checkpoint_not_selected`; er det flere slike saker, den som kom først.
   */
  claimId: string | null;
};

/** Én grunn under en overskrift. */
export type OverrideReasonGroup = {
  reasonCode: PublishOverrideReasonCode;
  /** Fast etikett fra kodelisten, med trygg tekst for ukjent kode. Aldri begrunnelsesteksten. */
  reasonLabel: string;
  /** Unike rapporter (v1 og v2 av samme rapport telles én gang, A570). */
  reportCount: number;
  /** Unike rapporter med minst én rød linje. */
  claimCount: number;
  releases: OverrideReleaseLine[];
};

/**
 * Én overskrift: sperre og kontrollpunkt. Gruppene med `claimCount > 0` kommer først, deretter
 * etter `reportCount`, flest først; lik rekkefølge avgjøres av `checkCode` og `checkpointKey`,
 * slik at rekkefølgen er stabil.
 */
export type OverrideGroup = {
  checkCode: PublishCheckCode;
  checkLabel: string;
  /** `null` = «Hele rapporten». */
  checkpointKey: string | null;
  /** Navnet på punktet fra malversjonen til den nyeste rapporten i gruppen. */
  checkpointName: string | null;
  reportCount: number;
  claimCount: number;
  reasons: OverrideReasonGroup[];
};

export type OverrideOverview = {
  /** Første og siste dag i perioden, norsk dato. `toDate` er i dag, `fromDate` er 90 dager før. */
  fromDate: string;
  toDate: string;
  groups: OverrideGroup[];
};

/**
 * Listen over overstyrte sperrer (`claims.read`): `overridden = true`, `severity = 'blocker'` og
 * `created_at` fra og med `fromDate` (norsk dato; dag 90 er med, dag 91 ikke, A572). Gruppering og
 * telling gjøres i SQL, med fast antall spørringer uansett antall rader. Filteret på `created_at`
 * skal bruke `publish_check_results_overridden_idx`, og koblingen mot `claims` går på
 * (organisasjon, oppdrag).
 */
export type ListPublishOverrides = (
  actor: Actor,
  organizationId: string,
) => Promise<OverrideOverview>;

// --- Tallgrunnlaget til KI ------------------------------------------------------------------------

/** Det `BuildOverrideStats` gir: grunnlaget slik det går til `requestSuggestion`, og hva som ble kuttet. */
export type OverrideStats = {
  stats: AiOverrideStats;
  /** Linjer kuttet for å komme under `AI_OVERRIDE_STATS_MAX_ROWS` (lavest antall først). */
  rowsCut: number;
};

/**
 * Tallene for én måned (A570, A572). Tar `grant`, ikke `actor`: kalles bare av tjenestene her,
 * etter tilgangssjekken. Måneden er `released_at` i norsk tid. Nevneren er unike rapporter
 * publisert i måneden; telleren er unike rapporter med overstyringen (kode, punkt, grunn).
 * Prosent og prosentpoeng regnes med `ComputeOverrideShare`. Slår opp punktnavn i malversjonen og
 * etiketter i kodelistene; leser aldri fritekst.
 */
export type BuildOverrideStats = (grant: EmployeeGrant, month: string) => Promise<OverrideStats>;

/**
 * Andel i hele prosent, avrundet til nærmeste heltall. `null` når `reportCount` er under
 * `AI_OVERRIDE_SHARE_MIN_REPORTS` (også 0: aldri deling på null). Ren funksjon.
 */
export type ComputeOverrideShare = (count: number, reportCount: number) => number | null;

/**
 * Markeringen for én utgivelse (ren funksjon, alle testsakene under «Regler» i oppgavekortet).
 * `isLatestReleaseBeforeClaim` regnes i SQL per reklamasjon. Datoene er norske datoer.
 */
export type ClassifyClaimMarker = (input: {
  checkpointKey: string | null;
  claims: readonly {
    checkpointKey: string | null;
    /** Utgivelsen er den siste av rapporten med dato til og med reklamasjonens `received_at`. */
    isLatestReleaseBeforeClaim: boolean;
  }[];
}) => OverrideClaimMarker;

// --- Månedsoppsummeringen ---------------------------------------------------------------------------

/** Feilene i lederens tekst (A574). Én norsk melding per kode; teksten står aldri i feilen. */
export type OverrideSummaryTextIssue =
  "empty" | "too_long" | "id_number" | "email" | "phone" | "employee_name" | "placeholder";

/**
 * Kontrollen av lederens tekst før lagring (ren funksjon). `employeeNames` hentes av tjenesten med
 * `grant.organizationId` (også fjernede ansatte) og sammenlignes uten hensyn til store og små
 * bokstaver, på hele ord. Gir første feil, eller `null` når teksten kan lagres.
 */
export type ValidateSummaryText = (
  text: string,
  employeeNames: readonly string[],
) => OverrideSummaryTextIssue | null;

/**
 * De fire månedene som kan velges (A577): inneværende og de tre siste hele, norsk tid, nyeste
 * først. Alt annet avvises av serveren. Ren funksjon.
 */
export type OverrideSummaryMonths = (now: Date) => readonly [string, string, string, string];

/** Oppsummeringen for én måned, slik siden viser den. */
export type OverrideSummaryView = {
  month: string;
  /** `null` til raden er laget (første «Lag oppsummering» eller første lagring). */
  id: string | null;
  status: OverrideSummaryStatus;
  source: OverrideSummarySource | null;
  /** Teksten som gjelder. `null` når ingen tekst er godtatt, endret eller skrevet. */
  text: string | null;
  /** 0 når raden ikke finnes. Sendes tilbake som `baseRowVersion`. */
  rowVersion: number;
  /** Forslaget som venter på beslutning, uansett hvilken leder som ba om det. */
  openSuggestion: { usageId: string; text: string } | null;
  /** Unike rapporter publisert i måneden. 0 gir «Ingen rapporter ble publisert i denne måneden.». */
  reportCount: number;
  /** Om den som spør, har `claims.manage` (godta, endre, avvise og skrive selv). */
  canDecide: boolean;
};

/**
 * Leser oppsummeringen for måneden (`claims.read`). Måneden må være en av `OverrideSummaryMonths`;
 * ellers valideringsfeil. Lager aldri raden.
 */
export type GetOverrideSummary = (
  actor: Actor,
  organizationId: string,
  month: string,
) => Promise<OverrideSummaryView>;

export type RequestOverrideSummaryResult =
  | { status: "suggested"; summary: OverrideSummaryView }
  /** Ingen rapporter publisert i måneden. KI er ikke kalt, og ingen rad er laget i loggen. */
  | { status: "no_reports"; summary: OverrideSummaryView }
  /** KI er av for organisasjonen eller funksjonen, eller forespørselen ble sperret. */
  | { status: "disabled" }
  /** Grensene i `limits.ts` (A575). KI er ikke kalt. */
  | { status: "rate_limited" }
  /** En vakt stoppet svaret. Teksten vises aldri. */
  | { status: "stopped"; guard: AiGuardCode }
  /** Feil fra leverandøren: «Oppsummeringen kunne ikke lages nå. Prøv igjen senere.» */
  | { status: "error" };

/**
 * «Lag oppsummering» (`claims.read`). Rekkefølgen:
 * 1. Tilgang, og måneden mot `OverrideSummaryMonths`.
 * 2. `BuildOverrideStats`. `reportCount = 0` gir `no_reports` uten rad og uten kall.
 * 3. Finnes et åpent forslag for måneden, gis det tilbake (ett åpent forslag per måned, for hele
 *    organisasjonen). Ellers grensene per ansatt og per organisasjon.
 * 4. Raden i `override_summaries` hentes eller lages (`status = 'empty'`; den unike indeksen
 *    avgjør ved samtidige trykk).
 * 5. `requestSuggestion` med funksjonen `override_summary`, målet
 *    `{ type: "override_summary", id: <radens id>, fieldKey: "text" }`, tomme `fields` og
 *    `{ overrideStats, overrideStatsCut }`.
 * Skriver aldri `text`. Samme `requestId` to ganger gir samme svar (kjernen i `@/core/ai`).
 */
export type RequestOverrideSummary = (
  actor: Actor,
  organizationId: string,
  input: { requestId: string; month: string },
) => Promise<RequestOverrideSummaryResult>;

export type OverrideSummaryWriteResult =
  | { status: "saved"; summary: OverrideSummaryView }
  /** «Endret av andre» (`baseRowVersion` stemte ikke). Ingenting er lagret. */
  | { status: "conflict"; summary: OverrideSummaryView };

/**
 * Godta, avvis eller angre forslaget (`claims.manage`, ADR 0006 del 10). Én transaksjon: raden i
 * `override_summaries` låses først (`for update`), deretter `recordDecisionIn` (som tar KI-låsen
 * på målet). Ingen kode tar låsene i motsatt rekkefølge.
 *
 * Loggraden kontrolleres før beslutningen: samme organisasjon, funksjonen `override_summary`, og
 * `target_ref` peker på akkurat denne raden; ellers `AccessDeniedError`, samme svar som for ukjent
 * id. En annen leder enn den som ba om forslaget, kan avgjøre det.
 *
 * - `accepted`: `text` = forslaget (`ai_usage_log.output_text`), `status = 'accepted'`,
 *   kilden er KI, og `ai_usage_log_id` = forslaget.
 * - `rejected`: peker raden på dette forslaget, eller har den ingen tekst, blir den
 *   `status = 'rejected'` uten tekst. Har raden en tekst fra et annet forslag eller skrevet for
 *   hånd, står raden urørt: teksten som gjelder, forsvinner ikke fordi et nytt forslag avvises.
 * - `undo`: peker raden på dette forslaget, blir den `empty` uten tekst. Ellers urørt.
 */
export type DecideOverrideSummary = (
  actor: Actor,
  organizationId: string,
  input: {
    month: string;
    usageId: string;
    decision: "accepted" | "rejected" | "undo";
    baseRowVersion: number;
  },
) => Promise<OverrideSummaryWriteResult>;

/**
 * Lagrer tekst leder har endret eller skrevet selv (`claims.manage`). Teksten kontrolleres med
 * `ValidateSummaryText` før noe lagres; feil gir valideringsfeil med koden, aldri teksten. Samme
 * låserekkefølge som `DecideOverrideSummary`.
 *
 * - Med `usageId` («Endre» på et forslag): loggraden kontrolleres som i `DecideOverrideSummary`,
 *   beslutningen `edited` registreres med `recordDecisionIn` i samme transaksjon, og raden blir
 *   `status = 'edited'` med KI som kilde.
 * - Uten `usageId`, når raden har tekst fra KI (`accepted` eller `edited`): `status = 'edited'`,
 *   `ai_usage_log_id` står. Loggraden røres ikke.
 * - Uten `usageId` ellers: raden hentes eller lages, og blir `status = 'manual'`,
 *   `source = 'manual'`, `ai_usage_log_id` tom. Et åpent forslag står åpent til leder avgjør det.
 */
export type SaveOverrideSummary = (
  actor: Actor,
  organizationId: string,
  input: { month: string; text: string; baseRowVersion: number; usageId?: string },
) => Promise<OverrideSummaryWriteResult>;
