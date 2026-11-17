import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Actor, EmployeeGrant } from "@/core/access";
import { ROOM_TYPES } from "@/core/buildings";
import type { DbExecutor } from "@/db/client";
import {
  aiUsageLog,
  floors,
  reportBuildings,
  reportReleases,
  rooms,
  type AiSuggestionStatus,
  type AiTargetRef,
  type FieldAnswer,
  type ReportStatus,
} from "@/db/schema";
import { todayInOslo } from "@/shared/lib/dates";
import {
  inspectionYearOf,
  loadLockedTemplate,
  roomDocumentOf,
  SUPPORTED_ROOM_GROUP,
  type LockedTemplate,
} from "./context";
import type {
  HoleDrillingState,
  PublishCheckInput,
  PublishCheckPendingAiSuggestion,
  PublishCheckRoom,
} from "./logic";
import { buildRoomState, loadRoomData, type RoomData, type RoomState } from "./room-view";
import type { RoomTemplateDocument } from "./types";

/*
 * Kodene i badmalen som rapportkjernen leser for advarslene (docs/funksjoner/fase2a-badet-pc.md
 * Omfang 6 og 7, T-0059, A386). De står her i tjenesten og aldri i `logic/` (A396): de rene
 * funksjonene får bare sann/usann. Kodene er faste (regel 6), så de endres ikke; arkiveres en av
 * dem i malen, slutter advarselen å komme, og testene for badet blir røde.
 */

/** «Eier ga ikke samtykke» til hulltaking: TGIU krever da at eier er informert (A349). */
export const OWNER_REFUSED_SIGNAL = {
  elementKey: "wet_room.hole_drilling_reason",
  optionKey: "owner_refused",
} as const;

/**
 * T-0059: valget «utført uten funn» og regelen for forhøyet fukt slår til i serverens regelsvar.
 * Grensen og enheten står bare i regelen (A386), aldri her.
 */
export const NO_FINDINGS_OVER_LIMIT_SIGNAL = {
  ruleKey: "wet_room.hole_moisture_over_limit",
  elementKey: "wet_room.hole_drilling",
  optionKey: "done_no_findings",
} as const;

/**
 * Hulltakingen i våtrommet til sjekken før publisering (docs/funksjoner/fase2a-publisering-badet.md
 * Omfang 2 og 3, A445, A446). Punktet hulltakingen hører til, finnes fra feltet i malen, ikke fra
 * en punktkode her.
 */
export const HOLE_DRILLING_SIGNAL = {
  elementKey: "wet_room.hole_drilling",
  /** Hull er tatt: måleverdi og enhet skal stå (advarsel `hole_reading_missing`). */
  doneOptionKeys: ["done_no_findings", "done_with_findings"],
  notDoneOptionKey: "not_done",
  reasonElementKey: "wet_room.hole_drilling_reason",
  reasonOtherOptionKey: "other",
  reasonNoteElementKey: "wet_room.hole_drilling_reason_note",
  readingElementKey: "wet_room.hole_moisture_reading",
  unitElementKey: "wet_room.hole_moisture_unit",
} as const;

// --- Lagrede data for hele rapporten -----------------------------------------------------------

/** Et våtrom i rapporten med radene og tilstanden regnet av de samme funksjonene som rommet. */
export type PublishRoomSource = {
  roomId: string;
  name: string | null;
  roomType: string;
  /** Plassen i rapporten (bygning, etasje, rom). */
  position: number;
  building: { id: string; name: string | null };
  floor: { id: string; name: string | null };
  roomDoc: RoomTemplateDocument;
  data: RoomData;
  state: RoomState;
};

/** Et KI-forslag på rapporten (`outcome = 'ok'`, ikke slettet). */
export type ReportAiRow = {
  id: string;
  status: AiSuggestionStatus;
  targetRef: AiTargetRef;
  outputText: string | null;
  createdAt: Date;
  decidedAt: Date | null;
};

/** Alt sjekken, snapshot og «Dette publiseres» bygger på. Lest med `grant.organizationId`. */
export type PublishSource = {
  orgId: string;
  assignmentId: string;
  report: { id: string; status: ReportStatus; templateVersionId: string; reportType: string };
  /** Befaringsdatoen i norsk tid (ÅÅÅÅ-MM-DD), eller `null`. */
  inspectionDate: string | null;
  template: LockedTemplate;
  rooms: PublishRoomSource[];
  latestRelease: { id: string; versionNumber: number; releasedAt: Date } | null;
  aiRows: ReportAiRow[];
};

export type PublishSourceRef = {
  assignmentId: string;
  inspectionAt: Date | null;
  report: PublishSource["report"];
};

/** Romgruppen til romtypen, eller `null` for ukjent type. */
function roomGroupOf(roomType: string): string | null {
  return ROOM_TYPES.find((type) => type.key === roomType)?.group ?? null;
}

/**
 * Våtrommene på oppdraget i rapportens rekkefølge: bygning, etasje og rom som i bygningslisten.
 * Slettede bygninger, etasjer og rom er aldri med.
 */
async function loadWetRooms(ex: DbExecutor, orgId: string, assignmentId: string) {
  const rows = await ex
    .select({
      roomId: rooms.id,
      roomName: rooms.name,
      roomType: rooms.roomType,
      floorId: floors.id,
      floorName: floors.name,
      buildingId: reportBuildings.id,
      buildingName: reportBuildings.name,
    })
    .from(rooms)
    .innerJoin(
      floors,
      and(eq(floors.id, rooms.floorId), eq(floors.organizationId, orgId), isNull(floors.deletedAt)),
    )
    .innerJoin(
      reportBuildings,
      and(
        eq(reportBuildings.id, floors.reportBuildingId),
        eq(reportBuildings.organizationId, orgId),
        isNull(reportBuildings.deletedAt),
      ),
    )
    .where(
      and(
        eq(rooms.organizationId, orgId),
        isNull(rooms.deletedAt),
        eq(reportBuildings.assignmentId, assignmentId),
      ),
    )
    .orderBy(
      asc(reportBuildings.createdAt),
      asc(reportBuildings.id),
      asc(floors.level),
      asc(floors.createdAt),
      asc(floors.id),
      asc(rooms.createdAt),
      asc(rooms.id),
    );
  return rows.filter((row) => roomGroupOf(row.roomType) === SUPPORTED_ROOM_GROUP);
}

/** Siste utgivelse (høyeste versjon) av rapporten, eller `null`. */
export async function findLatestRelease(ex: DbExecutor, orgId: string, reportId: string) {
  const [row] = await ex
    .select({
      id: reportReleases.id,
      versionNumber: reportReleases.versionNumber,
      releasedAt: reportReleases.releasedAt,
    })
    .from(reportReleases)
    .where(and(eq(reportReleases.organizationId, orgId), eq(reportReleases.reportId, reportId)))
    .orderBy(desc(reportReleases.versionNumber))
    .limit(1);
  return row ?? null;
}

/**
 * KI-forslagene på rapporten som gikk gjennom (`outcome = 'ok'`) og ikke er slettet. Bruker den
 * delvise indeksen `(organization_id, report_id)`. Forslagsteksten følger med bare til visningen
 * av ventende forslag; den kommer aldri i snapshot eller funnene.
 */
async function loadReportAiRows(
  ex: DbExecutor,
  orgId: string,
  reportId: string,
): Promise<ReportAiRow[]> {
  const rows = await ex
    .select({
      id: aiUsageLog.id,
      status: aiUsageLog.status,
      targetRef: aiUsageLog.targetRef,
      outputText: aiUsageLog.outputText,
      createdAt: aiUsageLog.createdAt,
      decidedAt: aiUsageLog.decidedAt,
    })
    .from(aiUsageLog)
    .where(
      and(
        eq(aiUsageLog.organizationId, orgId),
        eq(aiUsageLog.reportId, reportId),
        eq(aiUsageLog.outcome, "ok"),
        isNull(aiUsageLog.deletedAt),
        inArray(aiUsageLog.status, ["suggested", "accepted", "edited", "rejected"]),
      ),
    )
    .orderBy(asc(aiUsageLog.createdAt), asc(aiUsageLog.id));
  return rows.flatMap((row) => (row.status === null ? [] : [{ ...row, status: row.status }]));
}

/**
 * Leser alt i rapporten som publiseringen trenger, med `grant.organizationId`: malversjonen,
 * våtrommene med svar, punkter, avvik, tiltak, TGIU og regelbeslutninger (ett sett spørringer per
 * rom, samme som rommet), siste utgivelse og KI-forslagene. Mykt slettede rader er aldri med.
 * Skriver aldri.
 */
export async function loadPublishSource(
  ex: DbExecutor,
  actor: Actor,
  grant: EmployeeGrant,
  ref: PublishSourceRef,
  now: Date,
): Promise<PublishSource> {
  const orgId = grant.organizationId;
  const [template, roomRows, latestRelease, aiRows] = await Promise.all([
    loadLockedTemplate(ex, actor, grant, ref.report.templateVersionId),
    loadWetRooms(ex, orgId, ref.assignmentId),
    findLatestRelease(ex, orgId, ref.report.id),
    loadReportAiRows(ex, orgId, ref.report.id),
  ]);
  const inspectionYear = inspectionYearOf(ref.inspectionAt, now).year;
  const roomDoc = roomDocumentOf(template.document, SUPPORTED_ROOM_GROUP);

  const roomSources: PublishRoomSource[] = [];
  for (const [position, row] of roomRows.entries()) {
    const data = await loadRoomData(ex, orgId, ref.report.id, row.roomId);
    roomSources.push({
      roomId: row.roomId,
      name: row.roomName,
      roomType: row.roomType,
      position,
      building: { id: row.buildingId, name: row.buildingName },
      floor: { id: row.floorId, name: row.floorName },
      roomDoc,
      data,
      state: buildRoomState({ template, roomDoc, data, inspectionYear }),
    });
  }

  return {
    orgId,
    assignmentId: ref.assignmentId,
    report: ref.report,
    inspectionDate: ref.inspectionAt ? todayInOslo(ref.inspectionAt) : null,
    template,
    rooms: roomSources,
    latestRelease,
    aiRows,
  };
}

// --- Tolkningen til sjekken ----------------------------------------------------------------------

function isBlank(text: string | null | undefined): boolean {
  return text === null || text === undefined || text.trim() === "";
}

/** Svaret på feltet i rommet, eller `null`. */
function answerOf(
  template: LockedTemplate,
  answers: readonly FieldAnswer[],
  elementKey: string,
): FieldAnswer | null {
  const elementId = template.elementIdByKey.get(elementKey);
  if (!elementId) return null;
  return answers.find((a) => a.elementId === elementId) ?? null;
}

function optionKeysOf(answer: FieldAnswer | null): string[] {
  return answer?.valueOptionKeys ?? [];
}

/** Punktet hulltakingen hører til, fra feltet i malen. `null` når malen ikke har feltet. */
export function holeCheckpointOf(
  template: LockedTemplate,
): { checkpointId: string; checkpointKey: string } | null {
  const element = template.document.elements.find((e) => e.key === HOLE_DRILLING_SIGNAL.elementKey);
  const checkpointKey = element?.checkpoint_key ?? null;
  const checkpointId = checkpointKey ? template.checkpointIdByKey.get(checkpointKey) : undefined;
  return checkpointKey && checkpointId ? { checkpointId, checkpointKey } : null;
}

/**
 * Hulltakingen i rommet tolket til tilstanden sjekken leser (A445, A446): ubesvart, «ikke utført»
 * uten grunn, grunnen «annet» uten tekst, eller i orden. Har malen ikke feltet, er det ingenting å
 * spørre om, og svaret er `ok`.
 */
export function holeDrillingOf(
  template: LockedTemplate,
  answers: readonly FieldAnswer[],
): { holeDrilling: HoleDrillingState; holeReadingMissing: boolean } {
  if (!template.elementIdByKey.has(HOLE_DRILLING_SIGNAL.elementKey)) {
    return { holeDrilling: "ok", holeReadingMissing: false };
  }
  const drilling = optionKeysOf(answerOf(template, answers, HOLE_DRILLING_SIGNAL.elementKey));
  const done = drilling.some((key) =>
    (HOLE_DRILLING_SIGNAL.doneOptionKeys as readonly string[]).includes(key),
  );
  if (done) {
    const reading = answerOf(template, answers, HOLE_DRILLING_SIGNAL.readingElementKey);
    const unit = optionKeysOf(answerOf(template, answers, HOLE_DRILLING_SIGNAL.unitElementKey));
    return {
      holeDrilling: "ok",
      holeReadingMissing: (reading?.valueNumber ?? null) === null || unit.length === 0,
    };
  }
  if (!drilling.includes(HOLE_DRILLING_SIGNAL.notDoneOptionKey)) {
    return { holeDrilling: "unanswered", holeReadingMissing: false };
  }
  const reason = optionKeysOf(answerOf(template, answers, HOLE_DRILLING_SIGNAL.reasonElementKey));
  if (reason.length === 0) return { holeDrilling: "not_done_no_reason", holeReadingMissing: false };
  if (reason.includes(HOLE_DRILLING_SIGNAL.reasonOtherOptionKey)) {
    const note = answerOf(template, answers, HOLE_DRILLING_SIGNAL.reasonNoteElementKey);
    if (isBlank(note?.valueText)) {
      return { holeDrilling: "other_without_note", holeReadingMissing: false };
    }
  }
  return { holeDrilling: "ok", holeReadingMissing: false };
}

/** Ett våtrom til sjekken. `requiresTg` er `gives_tg` på punktet i malen (A423). */
function toCheckRoom(source: PublishSource, room: PublishRoomSource): PublishCheckRoom {
  const { template } = source;
  const holeCheckpoint = holeCheckpointOf(template);
  const stateByKey = new Map(room.state.checkpointStates.map((c) => [c.checkpointKey, c.state]));
  const holeState = holeCheckpoint ? stateByKey.get(holeCheckpoint.checkpointKey) : undefined;
  return {
    roomId: room.roomId,
    position: room.position,
    isWetRoom: true,
    ...holeDrillingOf(template, room.data.answers),
    adjacentTgiuWithReason: holeState?.tgDirect === "IU" && !isBlank(holeState.tgiu?.reason),
    holeCheckpoint,
    checkpoints: room.roomDoc.checkpoints.flatMap((checkpoint, position) => {
      const checkpointId = template.checkpointIdByKey.get(checkpoint.key);
      const state = stateByKey.get(checkpoint.key);
      if (!checkpointId || !state) return [];
      return [
        {
          checkpointId,
          checkpointKey: checkpoint.key,
          position,
          requiresTg: checkpoint.gives_tg,
          state,
        },
      ];
    }),
  };
}

/** Hvor et KI-mål står i rapporten: rom, punkt og avvik. */
type AiPlace = Omit<PublishCheckPendingAiSuggestion, "aiUsageId">;

/**
 * Plassen til hvert mål KI kan skrive i (`REPORT_AI_TARGET_FIELDS`), fra radene som er lest.
 * Mål som er slettet eller ligger utenfor våtrommene, har ingen plass.
 */
function aiPlaces(source: PublishSource): Map<string, AiPlace> {
  const places = new Map<string, AiPlace>();
  const { template } = source;
  for (const room of source.rooms) {
    const resultPlace = new Map<string, AiPlace>();
    for (const result of room.data.results) {
      const checkpointKey = template.checkpointKeyById.get(result.checkpointId) ?? null;
      const place: AiPlace = {
        roomId: room.roomId,
        checkpointId: result.checkpointId,
        checkpointKey,
        deviationId: null,
      };
      resultPlace.set(result.id, place);
      places.set(`checkpoint_result|${result.id}`, place);
    }
    for (const tgiu of room.data.tgiu) {
      const place = resultPlace.get(tgiu.checkpointResultId);
      if (place) places.set(`tgiu_detail|${tgiu.id}`, place);
    }
    const deviationPlace = new Map<string, AiPlace>();
    for (const deviation of room.data.deviations) {
      const place = resultPlace.get(deviation.checkpointResultId);
      if (!place) continue;
      const withDeviation = { ...place, deviationId: deviation.id };
      deviationPlace.set(deviation.id, withDeviation);
      places.set(`deviation|${deviation.id}`, withDeviation);
    }
    for (const measure of room.data.measures) {
      const place = deviationPlace.get(measure.deviationId);
      if (place) places.set(`deviation_measure|${measure.id}`, place);
    }
    for (const answer of room.data.answers) {
      const elementKey = template.elementKeyById.get(answer.elementId);
      const element = template.document.elements.find((e) => e.key === elementKey);
      const checkpointKey = element?.checkpoint_key ?? null;
      const checkpointId = checkpointKey
        ? (template.checkpointIdByKey.get(checkpointKey) ?? null)
        : null;
      places.set(`field_answer|${answer.id}`, {
        roomId: room.roomId,
        checkpointId,
        checkpointKey: checkpointId ? checkpointKey : null,
        deviationId: null,
      });
    }
  }
  return places;
}

/** Nøkkelen for et KI-mål: type og rad. Feltet skiller ikke plassen. */
export function aiTargetKey(target: AiTargetRef): string {
  return `${target.type}|${target.id}`;
}

/**
 * KI-forslagene som venter (A454): `status = 'suggested'`, laget etter forrige utgivelse (alle når
 * ingen utgivelse finnes), på et mål som står i rapporten. Et forslag på en rad som er slettet,
 * kan ikke komme med i rapporten, og telles ikke. Sortert etter når de kom.
 */
export function pendingAiSuggestionsOf(
  source: PublishSource,
): (PublishCheckPendingAiSuggestion & { outputText: string })[] {
  const places = aiPlaces(source);
  const after = source.latestRelease?.releasedAt ?? null;
  return source.aiRows.flatMap((row) => {
    if (row.status !== "suggested") return [];
    if (after && row.createdAt <= after) return [];
    const place = places.get(aiTargetKey(row.targetRef));
    if (!place) return [];
    const { id: aiUsageId, outputText } = row;
    return [{ aiUsageId, ...place, outputText: outputText ?? "" }];
  });
}

/**
 * Inndata til `computePublishCheck` fra lagrede data (ADR 0015 punkt 2 og 3): befaringsdatoen,
 * våtrommene med hulltaking og punkter, og KI-forslagene som venter. Bare id-er og koder; ingen
 * tekst fra rapporten går videre utover det sjekken leser for å se om et felt er tomt.
 */
export function buildPublishCheckInput(source: PublishSource): PublishCheckInput {
  return {
    hasInspectionDate: source.inspectionDate !== null,
    rooms: source.rooms.map((room) => toCheckRoom(source, room)),
    pendingAiSuggestions: pendingAiSuggestionsOf(source).map(
      ({ aiUsageId, roomId, checkpointId, checkpointKey, deviationId }) => ({
        aiUsageId,
        roomId,
        checkpointId,
        checkpointKey,
        deviationId,
      }),
    ),
  };
}
