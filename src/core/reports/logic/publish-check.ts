import type { PublishCheckCode, PublishOverrideReasonCode } from "@/db/schema";
import { containsNationalId } from "@/shared/validation/free-text";
import {
  PUBLISH_CHECK_CODES,
  PUBLISH_CHECK_MISSING_PARTS,
  PUBLISH_OVERRIDE_REASON_CODES,
  PUBLISH_OVERRIDE_REASON_MAX_CHARS,
  PUBLISH_OVERRIDE_REASON_MIN_CHARS_OTHER,
} from "./codes";
import type {
  CanonicalJson,
  CanonicalPublishCheck,
  CarryOverrideDrafts,
  CheckPublishOverrideReason,
  ComputePublishCheck,
  HoleDrillingState,
  PublishCheckCheckpoint,
  PublishCheckFinding,
  PublishCheckInput,
  PublishCheckMissingPart,
  PublishCheckRoom,
  PublishCheckTarget,
  PublishFindingKey,
  RemainingBlockers,
  SummarizePublishCheck,
} from "./publish-check-types";
import { computeCheckpointTg } from "./tg";
import type { CheckpointWarning, CheckpointWarningCode } from "./types";
import { computeCheckpointWarnings } from "./warnings";

/**
 * Sjekken før publisering (ADR 0015, docs/funksjoner/fase2a-publisering-badet.md Omfang 1–4).
 * Ren kode: ingen database, ingen pakker, ingen `node:crypto`, ingen dagens dato og ingen feltkoder
 * for våtrom. Samme svar i nettleseren, på iPaden og på serveren. SHA-256 av den kanoniske formen
 * regnes av tjenesten, ikke her.
 *
 * Sjekken setter aldri TG, krysser aldri bort en sperre og publiserer aldri. KI er ikke med: alle
 * funn har `source = "rule"`.
 */

// --- Hjelpere ------------------------------------------------------------------------------

function isBlank(text: string | null | undefined): boolean {
  return text === null || text === undefined || text.trim() === "";
}

/** Punktadvarslene som sperren `mandatory_without_tg` erstatter. Tas aldri med i sjekken. */
const REPLACED_BY_MANDATORY: ReadonlySet<CheckpointWarningCode> = new Set([
  "deviation_tg_not_chosen",
  "checkpoint_done_without_tg",
]);

/** Punktadvarslene som er sperrer i sjekken. */
const CHECKPOINT_BLOCKERS: ReadonlySet<CheckpointWarningCode> = new Set([
  "tg2_tg3_missing_cause_or_consequence",
  "tg3_missing_cost",
]);

const HOLE_DRILLING_MISSING: Record<Exclude<HoleDrillingState, "ok">, PublishCheckMissingPart> = {
  unanswered: "hole_drilling",
  not_done_no_reason: "hole_drilling_reason",
  other_without_note: "hole_drilling_reason_note",
};

const MISSING_ORDER = new Map<string, number>(
  PUBLISH_CHECK_MISSING_PARTS.map((part, index) => [part, index]),
);
const CODE_ORDER = new Map<string, number>(PUBLISH_CHECK_CODES.map((code, index) => [code, index]));

/** `missing` i fast rekkefølge (`PUBLISH_CHECK_MISSING_PARTS`), uten dubletter. */
function sortMissing(parts: readonly PublishCheckMissingPart[]): PublishCheckMissingPart[] {
  return [...new Set(parts)].sort(
    (a, b) => (MISSING_ORDER.get(a) ?? Infinity) - (MISSING_ORDER.get(b) ?? Infinity),
  );
}

function target(fields: Partial<PublishCheckTarget>): PublishCheckTarget {
  return {
    roomId: fields.roomId ?? null,
    checkpointId: fields.checkpointId ?? null,
    checkpointKey: fields.checkpointKey ?? null,
    deviationId: fields.deviationId ?? null,
    ruleKey: fields.ruleKey ?? null,
    aiUsageId: fields.aiUsageId ?? null,
    missing: sortMissing(fields.missing ?? []),
  };
}

function finding(
  checkCode: PublishCheckCode,
  severity: PublishCheckFinding["severity"],
  fields: Partial<PublishCheckTarget>,
): PublishCheckFinding {
  return { checkCode, severity, source: "rule", target: target(fields) };
}

/** Sammenligning av tekst etter kodeenhet, uavhengig av språkinnstillingene på enheten. */
function compareText(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
}

function compareNumber(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

// --- Funn per rom og per punkt -------------------------------------------------------------

function roomFindings(room: PublishCheckRoom): PublishCheckFinding[] {
  if (!room.isWetRoom) return [];
  const findings: PublishCheckFinding[] = [];
  const place = {
    roomId: room.roomId,
    checkpointId: room.holeCheckpoint?.checkpointId ?? null,
    checkpointKey: room.holeCheckpoint?.checkpointKey ?? null,
  };
  if (room.holeDrilling !== "ok" && !room.adjacentTgiuWithReason) {
    findings.push(
      finding("wet_or_below_ground_missing_hole", "blocker", {
        ...place,
        missing: [HOLE_DRILLING_MISSING[room.holeDrilling]],
      }),
    );
  }
  if (room.holeReadingMissing) {
    findings.push(finding("hole_reading_missing", "warning", place));
  }
  return findings;
}

function warningToFinding(
  room: PublishCheckRoom,
  checkpoint: PublishCheckCheckpoint,
  warning: CheckpointWarning,
): PublishCheckFinding[] {
  const place = {
    roomId: room.roomId,
    checkpointId: checkpoint.checkpointId,
    checkpointKey: checkpoint.checkpointKey,
    deviationId: warning.deviationId,
    ruleKey: warning.ruleKey,
  };
  if (REPLACED_BY_MANDATORY.has(warning.code)) return [];
  if (!CHECKPOINT_BLOCKERS.has(warning.code)) {
    // Resten av punktadvarslene er advarsler med samme kode (PUBLISH_WARNING_CODES).
    return [
      finding(warning.code as PublishCheckCode, "warning", { ...place, missing: warning.missing }),
    ];
  }
  if (warning.code === "tg2_tg3_missing_cause_or_consequence") {
    // Kriterium, årsak og konsekvens hver for seg: hvert funn er én mangel som rettes alene.
    return warning.missing.map((part) =>
      finding(warning.code as PublishCheckCode, "blocker", { ...place, missing: [part] }),
    );
  }
  return [
    finding(warning.code as PublishCheckCode, "blocker", { ...place, missing: warning.missing }),
  ];
}

/**
 * `mandatory_without_tg` med tre mål (A423, A443, A444): avvik med `kind = tg` uten valgt TG
 * (uansett `requiresTg`), TGIU med tom eller blank grunn, og punkt som krever TG uten TG. Det
 * siste gis ikke når punktet alt har funn for et avvik uten TG.
 */
function mandatoryFindings(
  room: PublishCheckRoom,
  checkpoint: PublishCheckCheckpoint,
): PublishCheckFinding[] {
  const { state } = checkpoint;
  const place = {
    roomId: room.roomId,
    checkpointId: checkpoint.checkpointId,
    checkpointKey: checkpoint.checkpointKey,
  };
  const findings: PublishCheckFinding[] = [];
  for (const deviation of state.deviations) {
    if (deviation.kind === "tg" && deviation.tg === null) {
      findings.push(
        finding("mandatory_without_tg", "blocker", {
          ...place,
          deviationId: deviation.id,
          missing: ["tg"],
        }),
      );
    }
  }
  const hasDeviationWithoutTg = findings.length > 0;
  if (state.tgDirect === "IU" && isBlank(state.tgiu?.reason)) {
    findings.push(finding("mandatory_without_tg", "blocker", { ...place, missing: ["reason"] }));
  }
  if (checkpoint.requiresTg && computeCheckpointTg(state) === null && !hasDeviationWithoutTg) {
    findings.push(finding("mandatory_without_tg", "blocker", { ...place, missing: ["tg"] }));
  }
  return findings;
}

function checkpointFindings(
  room: PublishCheckRoom,
  checkpoint: PublishCheckCheckpoint,
): PublishCheckFinding[] {
  return [
    ...mandatoryFindings(room, checkpoint),
    ...computeCheckpointWarnings(checkpoint.state).flatMap((warning) =>
      warningToFinding(room, checkpoint, warning),
    ),
  ];
}

// --- Sortering -----------------------------------------------------------------------------

type Positions = {
  rooms: Map<string, number>;
  checkpoints: Map<string, Map<string, number>>;
};

function positionsOf(rooms: readonly PublishCheckRoom[]): Positions {
  const positions: Positions = { rooms: new Map(), checkpoints: new Map() };
  for (const room of rooms) {
    positions.rooms.set(room.roomId, room.position);
    positions.checkpoints.set(
      room.roomId,
      new Map(room.checkpoints.map((cp) => [cp.checkpointId, cp.position])),
    );
  }
  return positions;
}

/**
 * Rapporten først, så rom (`position`, så `roomId`; ukjente rom sist), funn på rommet før
 * punktene, punktene (`position`, så `checkpointId`; ukjente punkter sist), koden, og til slutt
 * `deviationId`, `ruleKey`, `aiUsageId` og `missing`.
 */
function compareFindings(positions: Positions) {
  const roomRank = (roomId: string | null): number =>
    roomId === null ? -Infinity : (positions.rooms.get(roomId) ?? Infinity);
  const checkpointRank = (roomId: string | null, checkpointId: string | null): number => {
    if (checkpointId === null) return -Infinity;
    if (roomId === null) return Infinity;
    return positions.checkpoints.get(roomId)?.get(checkpointId) ?? Infinity;
  };
  return (a: PublishCheckFinding, b: PublishCheckFinding): number => {
    const ta = a.target;
    const tb = b.target;
    return (
      compareNumber(roomRank(ta.roomId), roomRank(tb.roomId)) ||
      compareText(ta.roomId, tb.roomId) ||
      compareNumber(
        checkpointRank(ta.roomId, ta.checkpointId),
        checkpointRank(tb.roomId, tb.checkpointId),
      ) ||
      compareText(ta.checkpointId, tb.checkpointId) ||
      compareNumber(
        CODE_ORDER.get(a.checkCode) ?? Infinity,
        CODE_ORDER.get(b.checkCode) ?? Infinity,
      ) ||
      compareText(ta.deviationId, tb.deviationId) ||
      compareText(ta.ruleKey, tb.ruleKey) ||
      compareText(ta.aiUsageId, tb.aiUsageId) ||
      compareText(ta.missing.join(","), tb.missing.join(","))
    );
  };
}

// --- Sjekken -------------------------------------------------------------------------------

/**
 * Alle funn for rapporten, i fast rekkefølge uavhengig av rekkefølgen i inndata. Se
 * `ComputePublishCheck` i `publish-check-types.ts` for reglene. Et tomt svar betyr ingen mangler,
 * ikke at rapporten kan publiseres: at rapporten har et våtrom, sjekker tjenesten.
 */
export const computePublishCheck: ComputePublishCheck = (input: PublishCheckInput) => {
  const findings: PublishCheckFinding[] = [];
  if (!input.hasInspectionDate) {
    findings.push(finding("inspection_date_missing", "blocker", {}));
  }
  for (const room of input.rooms) {
    findings.push(...roomFindings(room));
    for (const checkpoint of room.checkpoints) {
      findings.push(...checkpointFindings(room, checkpoint));
    }
  }
  for (const suggestion of input.pendingAiSuggestions) {
    findings.push(
      finding("ai_suggestion_pending", "warning", {
        roomId: suggestion.roomId,
        checkpointId: suggestion.checkpointId,
        checkpointKey: suggestion.checkpointKey,
        deviationId: suggestion.deviationId,
        aiUsageId: suggestion.aiUsageId,
      }),
    );
  }
  return findings.sort(compareFindings(positionsOf(input.rooms)));
};

/** Antall sperrer og advarsler («2 må rettes, 3 bør sees over»). */
export const summarizePublishCheck: SummarizePublishCheck = (findings) => {
  let blockers = 0;
  let warnings = 0;
  for (const item of findings) {
    if (item.severity === "blocker") blockers += 1;
    else warnings += 1;
  }
  return { blockers, warnings };
};

// --- Kanonisk form -------------------------------------------------------------------------

/**
 * Kanonisk JSON: nøklene sortert på alle nivåer (etter kodeenhet), lister i gitt rekkefølge, uten
 * mellomrom. `undefined` i objekter tas ikke med; i lister blir det `null`, som i `JSON.stringify`.
 */
export const canonicalJson: CanonicalJson = (value) => serialize(value) ?? "null";

function serialize(value: unknown): string | undefined {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }
  if (value === null || typeof value !== "object") {
    if (typeof value === "bigint") return JSON.stringify(value.toString());
    return JSON.stringify(value);
  }
  const withJson = value as { toJSON?: () => unknown };
  if (typeof withJson.toJSON === "function") return serialize(withJson.toJSON());
  if (Array.isArray(value)) {
    return `[${value.map((item) => serialize(item) ?? "null").join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const item = serialize(record[key]);
    if (item !== undefined) parts.push(`${JSON.stringify(key)}:${item}`);
  }
  return `{${parts.join(",")}}`;
}

/** Målet med alle nøkler og `missing` i fast rekkefølge, også for data lest fra databasen. */
function normalizedTarget(value: PublishCheckTarget): PublishCheckTarget {
  return target(value);
}

/** Stabil nøkkel for et funn: koden og hele målet i kanonisk form. */
export const publishFindingKey: PublishFindingKey = (item) =>
  canonicalJson({ checkCode: item.checkCode, target: normalizedTarget(item.target) });

/**
 * Kanonisk tekst av funnlisten til fingeravtrykket: `checkCode`, `severity` og `target`, sortert,
 * uten `source` og uten overstyringer. Serveren regner SHA-256 av teksten.
 */
export const canonicalPublishCheck: CanonicalPublishCheck = (findings) => {
  const entries = findings
    .map((item) =>
      canonicalJson({
        checkCode: item.checkCode,
        severity: item.severity,
        target: normalizedTarget(item.target),
      }),
    )
    .sort((a, b) => compareText(a, b));
  return `[${entries.join(",")}]`;
};

// --- Overstyring ---------------------------------------------------------------------------

const REASON_CODES: ReadonlySet<string> = new Set<PublishOverrideReasonCode>(
  PUBLISH_OVERRIDE_REASON_CODES,
);

/** Antall tegn slik databasen teller dem (`length()`), ikke UTF-16-enheter. */
function characterCount(text: string): number {
  return [...text].length;
}

/**
 * Kontrollen av begrunnelsen når en sperre krysses bort (A424, A449). Rekkefølgen på svarene:
 * grunn mangler, «Annet» uten tekst, for lang tekst, fødselsnummer, «Annet» med for kort tekst.
 * Teksten trimmes før den telles; bare mellomrom regnes som tom.
 */
export const checkPublishOverrideReason: CheckPublishOverrideReason = ({ reasonCode, text }) => {
  if (reasonCode === null || !REASON_CODES.has(reasonCode)) return "reason_required";
  const trimmed = (text ?? "").trim();
  if (reasonCode === "other" && trimmed === "") return "text_required";
  if (characterCount(trimmed) > PUBLISH_OVERRIDE_REASON_MAX_CHARS) return "text_too_long";
  if (containsNationalId(trimmed)) return "national_id";
  if (reasonCode === "other" && characterCount(trimmed) < PUBLISH_OVERRIDE_REASON_MIN_CHARS_OTHER) {
    return "text_too_short";
  }
  return "ok";
};

/** Sperrene som verken er rettet eller har en gyldig kladd. */
export const remainingBlockers: RemainingBlockers = (findings, drafts) => {
  const valid = new Set(
    drafts
      .filter(
        (draft) =>
          checkPublishOverrideReason({ reasonCode: draft.reasonCode, text: draft.text }) === "ok",
      )
      .map((draft) => draft.findingKey),
  );
  return findings.filter(
    (item) => item.severity === "blocker" && !valid.has(publishFindingKey(item)),
  );
};

/**
 * Fører kladdene over til en ny funnliste (F3): kladder for en sperre med samme nøkkel beholdes,
 * resten faller bort. `added` er sperrene som ikke fantes i den gamle listen.
 */
export const carryOverrideDrafts: CarryOverrideDrafts = (previous, next, drafts) => {
  const nextBlockerKeys = new Set(
    next.filter((item) => item.severity === "blocker").map((item) => publishFindingKey(item)),
  );
  const previousKeys = new Set(previous.map((item) => publishFindingKey(item)));
  return {
    drafts: drafts.filter((draft) => nextBlockerKeys.has(draft.findingKey)),
    added: next.filter(
      (item) => item.severity === "blocker" && !previousKeys.has(publishFindingKey(item)),
    ),
  };
};
