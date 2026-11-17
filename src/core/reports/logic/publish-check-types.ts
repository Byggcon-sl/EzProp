import type {
  PublishCheckCode,
  PublishCheckSeverity,
  PublishCheckSource,
  PublishOverrideReasonCode,
  StoredPublishCheckTarget,
} from "@/db/schema";
import type {
  HOLE_DRILLING_STATES,
  PUBLISH_CHECK_MISSING_PARTS,
  PUBLISH_OVERRIDE_REASON_CHECKS,
} from "./codes";
import type { CheckpointState } from "./types";

/**
 * Grensesnittet til sjekken før publisering (ADR 0015,
 * docs/funksjoner/fase2a-publisering-badet.md Omfang 1–4). Rent blad som resten av `logic/`:
 * ingen database, ingen pakker, ingen `node:crypto`, ingen dagens dato og ingen feltkoder for
 * våtrom (ADR 0013 punkt 14, A396). Samme kode i nettleseren, på iPaden og på serveren.
 *
 * Sjekken setter aldri TG, krysser aldri bort en sperre og publiserer aldri. KI er ikke med:
 * alle funn herfra har `source = "rule"`.
 */

export type HoleDrillingState = (typeof HOLE_DRILLING_STATES)[number];
export type PublishCheckMissingPart = (typeof PUBLISH_CHECK_MISSING_PARTS)[number];
export type PublishOverrideReasonCheck = (typeof PUBLISH_OVERRIDE_REASON_CHECKS)[number];

// --- Inndata -------------------------------------------------------------------------------

/**
 * Et kontrollpunkt i et rom. `state` er samme `CheckpointState` som rommet bruker, slik at
 * advarslene regnes av `computeCheckpointWarnings` ett sted og aldri kan sendes inn i utakt med
 * avvikene. Mykt slettede avvik sendes aldri inn.
 */
export type PublishCheckCheckpoint = {
  /** Kontrollpunktet i rapportens låste malversjon. */
  checkpointId: string;
  checkpointKey: string;
  /** Plassen i malen. Bare til sortering. */
  position: number;
  /** Om punktet må ha TG før publisering (A423). Data fra den som kaller. */
  requiresTg: boolean;
  state: CheckpointState;
};

/** Et rom i rapporten. Slettede rom sendes aldri inn. */
export type PublishCheckRoom = {
  roomId: string;
  /** Plassen i rapporten (bygning, etasje, rom). Bare til sortering. */
  position: number;
  isWetRoom: boolean;
  /** Bare lest når `isWetRoom` er sann. */
  holeDrilling: HoleDrillingState;
  /** Hull er tatt, men måleverdi eller enhet mangler (A446). */
  holeReadingMissing: boolean;
  /** Tilliggende konstruksjoner har TGIU med utfylt grunn. Teller som begrunnelse (A445). */
  adjacentTgiuWithReason: boolean;
  /** Punktet hulltakingen hører til. Mål for «Gå til». `null` gir funn på rommet. */
  holeCheckpoint: { checkpointId: string; checkpointKey: string } | null;
  checkpoints: readonly PublishCheckCheckpoint[];
};

/** Et KI-forslag som venter (A454). Bare id-er og koder, aldri forslagsteksten. */
export type PublishCheckPendingAiSuggestion = {
  aiUsageId: string;
  /** `null` når forslaget ikke hører til et rom. */
  roomId: string | null;
  checkpointId: string | null;
  checkpointKey: string | null;
  deviationId: string | null;
};

export type PublishCheckInput = {
  /** Om oppdraget har befaringsdato. */
  hasInspectionDate: boolean;
  rooms: readonly PublishCheckRoom[];
  pendingAiSuggestions: readonly PublishCheckPendingAiSuggestion[];
};

// --- Svar ----------------------------------------------------------------------------------

/**
 * Hvor mangelen er. Samme form som `publish_check_results.target_ref`, med `missing` som faste
 * koder i rekkefølgen i `PUBLISH_CHECK_MISSING_PARTS`.
 */
export type PublishCheckTarget = Omit<StoredPublishCheckTarget, "missing"> & {
  missing: PublishCheckMissingPart[];
};

/** Ett funn. Bare koder og id-er, aldri fritekst. Teksten lages fra koden ved visning. */
export type PublishCheckFinding = {
  checkCode: PublishCheckCode;
  severity: PublishCheckSeverity;
  source: PublishCheckSource;
  target: PublishCheckTarget;
};

/** Tellemerket: «2 må rettes, 3 bør sees over». */
export type PublishCheckSummary = { blockers: number; warnings: number };

/** En sperre den ansatte vil krysse bort. Skjermens kladd og det som sendes til serveren. */
export type PublishOverrideDraft = {
  /** `PublishFindingKey` for sperren. */
  findingKey: string;
  reasonCode: PublishOverrideReasonCode | null;
  text: string | null;
};

// --- Funksjonene (bygges av utvikleren i `logic/publish-check.ts`) -----------------------------

/**
 * Alle funn for rapporten, i fast rekkefølge uavhengig av rekkefølgen i inndata: rapporten selv
 * først, så rom (`position`, så `roomId`), funn på rommet før punktene, punktene (`position`, så
 * `checkpointId`), koden (`PUBLISH_CHECK_CODES`), og til slutt `deviationId`, `ruleKey` og
 * `aiUsageId` som tekst.
 *
 * - `inspection_date_missing` når `hasInspectionDate` er usann.
 * - Per våtrom: `wet_or_below_ground_missing_hole` når `holeDrilling` ikke er `ok` og
 *   `adjacentTgiuWithReason` er usann (`missing`: `hole_drilling`, `hole_drilling_reason` eller
 *   `hole_drilling_reason_note`), og advarselen `hole_reading_missing`. Rom som ikke er våtrom,
 *   gir ingen av dem.
 * - Per punkt: advarslene fra `computeCheckpointWarnings(state)`. `tg2_tg3_missing_cause_or_consequence`
 *   og `tg3_missing_cost` blir sperrer. `deviation_tg_not_chosen` og `checkpoint_done_without_tg`
 *   tas aldri med; i stedet gir `mandatory_without_tg` ett funn for hvert av disse målene:
 *   avvik med `kind = tg` uten TG (`missing: ["tg"]`, avviket som mål, uansett `requiresTg`),
 *   `tgDirect = IU` med tom eller blank grunn (`missing: ["reason"]`), og `requiresTg` uten
 *   `tgDirect` og uten avvik med valgt TG (`missing: ["tg"]`). Det siste gis ikke når punktet alt
 *   har funn for et avvik uten TG.
 * - Ett funn `ai_suggestion_pending` per ventende KI-forslag.
 *
 * Gir aldri `bra_missing` eller `electrical_missing` (2a-3). Et tomt svar betyr ingen mangler,
 * ikke at rapporten kan publiseres: at rapporten har et våtrom, sjekkes av tjenesten.
 */
export type ComputePublishCheck = (input: PublishCheckInput) => PublishCheckFinding[];

/** Antall sperrer og advarsler. */
export type SummarizePublishCheck = (
  findings: readonly PublishCheckFinding[],
) => PublishCheckSummary;

/**
 * Stabil nøkkel for et funn: koden og hele målet i kanonisk form. To funn med samme nøkkel er
 * samme mangel. Brukes til å koble overstyringer til sperrer på serveren, og til å beholde valgte
 * grunner når listen endres (F3).
 */
export type PublishFindingKey = (
  finding: Pick<PublishCheckFinding, "checkCode" | "target">,
) => string;

/**
 * Kanonisk tekst av funnlisten til fingeravtrykket: `checkCode`, `severity` og `target` for hvert
 * funn, sortert, med faste nøkler, uten overstyringer. Lik liste gir lik tekst uansett
 * rekkefølge. Serveren regner SHA-256 av teksten (utenfor `logic/`).
 */
export type CanonicalPublishCheck = (findings: readonly PublishCheckFinding[]) => string;

/**
 * Kanonisk JSON: nøklene sortert på alle nivåer, lister i gitt rekkefølge, uten mellomrom.
 * `undefined` tas ikke med. Brukes av `CanonicalPublishCheck` og av `content_hash` for snapshot.
 */
export type CanonicalJson = (value: unknown) => string;

/**
 * Kontrollen av begrunnelsen når en sperre krysses bort (A424, A449), én regel for skjermen og
 * Zod-skjemaet på serveren: en grunn er påkrevd; `other` krever tekst på minst 10 tegn etter
 * trimming; teksten er høyst 1000 tegn og uten fødselsnummer (`containsNationalId` fra
 * `@/shared/validation/free-text`). Tekst med bare mellomrom regnes som tom.
 */
export type CheckPublishOverrideReason = (input: {
  reasonCode: PublishOverrideReasonCode | null;
  text: string | null;
}) => PublishOverrideReasonCheck;

/**
 * Hva som står igjen før «Publiser» kan trykkes: sperrene som verken er rettet eller har en
 * gyldig kladd. Kladder for funn som ikke lenger finnes, eller som er advarsler, telles ikke.
 */
export type RemainingBlockers = (
  findings: readonly PublishCheckFinding[],
  drafts: readonly PublishOverrideDraft[],
) => PublishCheckFinding[];

/**
 * Fører kladdene over til en ny funnliste (F3): kladder med samme `findingKey` beholdes, resten
 * faller bort. `added` er sperrene som ikke fantes i den gamle listen («Ny siden du åpnet siden»).
 */
export type CarryOverrideDrafts = (
  previous: readonly PublishCheckFinding[],
  next: readonly PublishCheckFinding[],
  drafts: readonly PublishOverrideDraft[],
) => { drafts: PublishOverrideDraft[]; added: PublishCheckFinding[] };
