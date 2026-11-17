import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  AccessDeniedError,
  requireOrganizationAccess,
  type Actor,
  type EmployeeGrant,
} from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { recordEvent } from "@/core/events";
import { db, type DbExecutor } from "@/db/client";
import {
  assignmentParties,
  assignments,
  employees,
  floorAreas,
  floors,
  reportBuildings,
  rooms,
} from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { roomTypeLabel, sumFloorArea, type AreaSum } from "./codes";
import { assertReportNotPublished } from "./errors";

/*
 * Papirkurv og gjenoppretting for bygninger, etasjer og rom på oppdraget
 * (docs/funksjoner/fase2a-papirkurv.md, A410, A411, A414, A416, A417).
 *
 * - `listTrash` krever `organization.read`, `restore*` krever `assignment.edit`. Tilgangen sjekkes
 *   bare med `requireOrganizationAccess`; all filtrering bruker `grant.organizationId`.
 * - `restore*` tar bare id-en til raden. Oppdraget slås opp fra raden. Ukjent id, annen
 *   organisasjon, ugyldig UUID og kansellert oppdrag gir samme `AccessDeniedError`.
 * - Rekkefølge: tilgang → organisasjon → «allerede aktiv» (`changed: false`, ingenting skrives).
 * - En slettegruppe er radene med samme `deleted_at` som den øverste delen (A414). Rom fjernet før
 *   blir liggende. Et rom i en fjernet etasje henter etasjen (og bygningen), aldri søsken (A410).
 * - Arealraden følger etasjen: samme `deleted_by` og samme `deleted_at`, eller (eldre rader)
 *   innen ±1 s. Har etasjen fått en ny aktiv arealrad, står den nye (A411).
 * - Radene låses ovenfra og ned (bygning → etasje → rom → areal), som ved «Fjern», så samtidige
 *   kall går etter hverandre uten vranglås.
 * - Én linje i revisjonsloggen (`restore`) per rad, én hendelse for den øverste delen og én per
 *   overordnet ledd. Hendelsene har bare id-er, faste koder og tall, aldri navn eller kommentar.
 */

export const RESTORE_HOWS = ["undo", "trash"] as const;
/** Hvordan noe ble hentet tilbake: «Angre» i meldingen eller «Gjenopprett» i papirkurven. */
export type RestoreHow = (typeof RESTORE_HOWS)[number];
const restoreHowSchema = z.enum(RESTORE_HOWS);

export type RestoredItem = {
  type: "building" | "floor" | "room";
  id: string;
  organizationId: string;
};

export type RestoreResult = {
  /**
   * Det som kom tilbake, også overordnet ledd (A410). Ved `changed: false` står bare raden selv,
   * slik at skjermen kan flytte fokus dit.
   */
  restored: RestoredItem[];
  changed: boolean;
  /** Beskjeder til den ansatte (faste norske tekster, design 3.4). */
  notices: string[];
};

export type TrashPathPart = {
  type: "building" | "floor";
  id: string;
  label: string;
  /** Leddet er også fjernet («(fjernet)» på skjermen). */
  removed: boolean;
};

/** Et rom eller en etasje i en slettegruppe, som kan hentes tilbake for seg (A410). */
export type TrashChild = {
  type: "floor" | "room";
  id: string;
  label: string;
  path: TrashPathPart[];
};

export type StructureTrashLine = {
  type: "building" | "floor" | "room";
  id: string;
  /** Rommets navn eller romtype, etasjens eller bygningens navn. */
  label: string;
  /** Hvor det lå: bygning › etasje. */
  path: TrashPathPart[];
  /** Antall bygninger, etasjer og rom i slettegruppen, medregnet den øverste. */
  groupCount: number;
  /** Etasjene og rommene i gruppen, til «2. etasje (4 rom)». */
  contents: { floors: number; rooms: number };
  /** Arealet fra arealraden som følger etasjen. `null` for bygninger og rom, eller uten areal. */
  area: AreaSum | null;
  removedAt: Date;
  /** Navnet på den som fjernet, også når personen har sluttet. Aldri e-post. */
  removedByName: string | null;
  /** Etasjene og rommene i gruppen, nyeste struktur først (etasje, så rommene i den). */
  children: TrashChild[];
};

/** En fjernet part. Bare id, rolle, navn og firmanavn (personopplysninger, spørsmål 85). */
export type PartyTrashLine = {
  type: "party";
  id: string;
  role: string;
  name: string;
  firmName: string | null;
  removedAt: Date;
  removedByName: string | null;
};

export type TrashLine = StructureTrashLine | PartyTrashLine;

/** Høyst så mange linjer i papirkurven (A413). */
const TRASH_LIMIT = 200;
/** Eldre arealrader regnes som samme gruppe innen så mange millisekunder (A411). */
const AREA_TOLERANCE_MS = 1000;

const NOTICE_AREA_KEPT =
  "Etasjen kom tilbake med arealet som er ført nå. Det gamle arealet er tatt vare på, men ikke hentet tilbake.";

function requireUuid(id: string) {
  if (!isUuid(id)) throw new AccessDeniedError();
}

function sameTime(a: Date | null, b: Date | null): boolean {
  return a !== null && b !== null && a.getTime() === b.getTime();
}

function secondsSince(now: Date, removedAt: Date): number {
  return Math.max(0, Math.round((now.getTime() - removedAt.getTime()) / 1000));
}

/** Er feilen et brudd på den unike indeksen `constraint` (PostgreSQL `23505`)? */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const candidate = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (candidate.code === "23505" && candidate.constraint_name === constraint) return true;
    current = candidate.cause;
  }
  return false;
}

type AreaCandidate = { id: string; deletedAt: Date | null; deletedBy: string | null };

/**
 * Arealraden som hører til etasjens slettegruppe (A411): samme `deleted_by`, og samme `deleted_at`
 * eller innen ±1 s (eldre rader). Er det flere, velges den nærmeste i tid.
 */
function matchingArea<T extends AreaCandidate>(
  areas: T[],
  floor: { deletedAt: Date; deletedBy: string | null },
): T | undefined {
  let best: { area: T; diff: number } | undefined;
  for (const area of areas) {
    if (area.deletedAt === null) continue;
    const diff = Math.abs(area.deletedAt.getTime() - floor.deletedAt.getTime());
    const matches = diff <= AREA_TOLERANCE_MS && area.deletedBy === floor.deletedBy;
    if (matches && (best === undefined || diff < best.diff)) best = { area, diff };
  }
  return best?.area;
}

// ---------------------------------------------------------------------------------------------
// Papirkurven
// ---------------------------------------------------------------------------------------------

/**
 * Det som er fjernet fra oppdraget: bygninger, etasjer, rom og parter, nyeste først, høyst 200
 * linjer. En slettegruppe er én linje, med etasjene og rommene i `children`. Ukjent, fremmed,
 * kansellert eller ugyldig oppdrags-id gir `AccessDeniedError`.
 */
export async function listTrash(
  actor: Actor,
  organizationId: string,
  assignmentId: string,
): Promise<TrashLine[]> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  requireUuid(assignmentId);
  const orgId = grant.organizationId;

  const [assignment] = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(
      and(
        eq(assignments.id, assignmentId),
        eq(assignments.organizationId, orgId),
        isNull(assignments.deletedAt),
      ),
    );
  if (!assignment) throw new AccessDeniedError();

  const [buildingRows, partyRows] = await Promise.all([
    db
      .select({
        id: reportBuildings.id,
        name: reportBuildings.name,
        deletedAt: reportBuildings.deletedAt,
        deletedBy: reportBuildings.deletedBy,
      })
      .from(reportBuildings)
      .where(
        and(
          eq(reportBuildings.organizationId, orgId),
          eq(reportBuildings.assignmentId, assignment.id),
        ),
      ),
    db
      .select({
        id: assignmentParties.id,
        role: assignmentParties.role,
        name: assignmentParties.name,
        firmName: assignmentParties.firmName,
        deletedAt: assignmentParties.deletedAt,
        deletedBy: assignmentParties.deletedBy,
      })
      .from(assignmentParties)
      .where(
        and(
          eq(assignmentParties.organizationId, orgId),
          eq(assignmentParties.assignmentId, assignment.id),
          isNotNull(assignmentParties.deletedAt),
        ),
      ),
  ]);

  const buildingIds = buildingRows.map((row) => row.id);
  const floorRows =
    buildingIds.length === 0
      ? []
      : await db
          .select({
            id: floors.id,
            reportBuildingId: floors.reportBuildingId,
            name: floors.name,
            level: floors.level,
            deletedAt: floors.deletedAt,
            deletedBy: floors.deletedBy,
          })
          .from(floors)
          .where(
            and(eq(floors.organizationId, orgId), inArray(floors.reportBuildingId, buildingIds)),
          )
          .orderBy(asc(floors.level), asc(floors.createdAt), asc(floors.id));

  const floorIds = floorRows.map((row) => row.id);
  const removedFloorIds = floorRows.filter((row) => row.deletedAt !== null).map((row) => row.id);
  const [roomRows, areaRows] = await Promise.all([
    floorIds.length === 0
      ? []
      : db
          .select({
            id: rooms.id,
            floorId: rooms.floorId,
            roomType: rooms.roomType,
            name: rooms.name,
            deletedAt: rooms.deletedAt,
            deletedBy: rooms.deletedBy,
          })
          .from(rooms)
          .where(
            and(
              eq(rooms.organizationId, orgId),
              inArray(rooms.floorId, floorIds),
              isNotNull(rooms.deletedAt),
            ),
          )
          .orderBy(asc(rooms.createdAt), asc(rooms.id)),
    removedFloorIds.length === 0
      ? []
      : db
          .select({
            id: floorAreas.id,
            floorId: floorAreas.floorId,
            braI: floorAreas.braI,
            braE: floorAreas.braE,
            braB: floorAreas.braB,
            alh: floorAreas.alh,
            deletedAt: floorAreas.deletedAt,
            deletedBy: floorAreas.deletedBy,
          })
          .from(floorAreas)
          .where(
            and(
              eq(floorAreas.organizationId, orgId),
              inArray(floorAreas.floorId, removedFloorIds),
              isNotNull(floorAreas.deletedAt),
            ),
          ),
  ]);

  const buildingById = new Map(buildingRows.map((row) => [row.id, row]));
  const floorById = new Map(floorRows.map((row) => [row.id, row]));

  const buildingPart = (id: string): TrashPathPart[] => {
    const building = buildingById.get(id);
    return building
      ? [{ type: "building", id, label: building.name, removed: building.deletedAt !== null }]
      : [];
  };
  const floorPath = (floor: (typeof floorRows)[number]) => buildingPart(floor.reportBuildingId);
  const roomPath = (room: (typeof roomRows)[number]): TrashPathPart[] => {
    const floor = floorById.get(room.floorId);
    if (!floor) return [];
    return [
      ...floorPath(floor),
      { type: "floor", id: floor.id, label: floor.name, removed: floor.deletedAt !== null },
    ];
  };
  const roomLabel = (room: (typeof roomRows)[number]) => room.name ?? roomTypeLabel(room.roomType);

  /** Etasjen er fjernet i samme slettegruppe som bygningen sin. */
  const floorInBuildingGroup = (floor: (typeof floorRows)[number]) =>
    sameTime(floor.deletedAt, buildingById.get(floor.reportBuildingId)?.deletedAt ?? null);
  /** Rommet er fjernet i samme slettegruppe som etasjen sin. */
  const roomInFloorGroup = (room: (typeof roomRows)[number]) =>
    sameTime(room.deletedAt, floorById.get(room.floorId)?.deletedAt ?? null);

  const groupChildren = new Map<string, TrashChild[]>();
  const addChild = (topId: string, child: TrashChild) => {
    const list = groupChildren.get(topId) ?? [];
    list.push(child);
    groupChildren.set(topId, list);
  };
  for (const floor of floorRows) {
    if (floor.deletedAt !== null && floorInBuildingGroup(floor)) {
      addChild(floor.reportBuildingId, {
        type: "floor",
        id: floor.id,
        label: floor.name,
        path: floorPath(floor),
      });
    }
  }
  for (const room of roomRows) {
    if (!roomInFloorGroup(room)) continue;
    const floor = floorById.get(room.floorId)!;
    const topId = floorInBuildingGroup(floor) ? floor.reportBuildingId : floor.id;
    addChild(topId, { type: "room", id: room.id, label: roomLabel(room), path: roomPath(room) });
  }

  const employeeIds = new Set<string>();
  const collect = (deletedBy: string | null) => {
    if (deletedBy !== null && isUuid(deletedBy)) employeeIds.add(deletedBy);
  };

  type Pending = Omit<StructureTrashLine, "removedByName"> & { deletedBy: string | null };
  const pending: Pending[] = [];
  const structureLine = (
    base: Pick<StructureTrashLine, "type" | "id" | "label" | "path" | "area">,
    removedAt: Date,
    deletedBy: string | null,
  ) => {
    const children = groupChildren.get(base.id) ?? [];
    const contents = {
      floors: children.filter((child) => child.type === "floor").length,
      rooms: children.filter((child) => child.type === "room").length,
    };
    collect(deletedBy);
    pending.push({
      ...base,
      groupCount: 1 + children.length,
      contents,
      removedAt,
      deletedBy,
      children,
    });
  };

  for (const building of buildingRows) {
    if (building.deletedAt === null) continue;
    structureLine(
      { type: "building", id: building.id, label: building.name, path: [], area: null },
      building.deletedAt,
      building.deletedBy,
    );
  }
  for (const floor of floorRows) {
    if (floor.deletedAt === null || floorInBuildingGroup(floor)) continue;
    const area = matchingArea(
      areaRows.filter((row) => row.floorId === floor.id),
      { deletedAt: floor.deletedAt, deletedBy: floor.deletedBy },
    );
    structureLine(
      {
        type: "floor",
        id: floor.id,
        label: floor.name,
        path: floorPath(floor),
        area: area ? sumFloorArea(area) : null,
      },
      floor.deletedAt,
      floor.deletedBy,
    );
  }
  for (const room of roomRows) {
    if (room.deletedAt === null || roomInFloorGroup(room)) continue;
    structureLine(
      { type: "room", id: room.id, label: roomLabel(room), path: roomPath(room), area: null },
      room.deletedAt,
      room.deletedBy,
    );
  }
  for (const party of partyRows) collect(party.deletedBy);

  const names = new Map<string, string>();
  if (employeeIds.size > 0) {
    // Også ansatte som har sluttet eller er mykt slettet: papirkurven skal vise hvem som fjernet.
    const employeeRows = await db
      .select({ id: employees.id, name: employees.name })
      .from(employees)
      .where(and(eq(employees.organizationId, orgId), inArray(employees.id, [...employeeIds])));
    for (const row of employeeRows) names.set(row.id, row.name);
  }
  const nameOf = (deletedBy: string | null) =>
    deletedBy === null ? null : (names.get(deletedBy) ?? null);

  const lines: TrashLine[] = [
    ...pending.map(({ deletedBy, ...line }) => ({ ...line, removedByName: nameOf(deletedBy) })),
    ...partyRows.map((party): PartyTrashLine => ({
      type: "party",
      id: party.id,
      role: party.role,
      name: party.name,
      firmName: party.firmName,
      removedAt: party.deletedAt!,
      removedByName: nameOf(party.deletedBy),
    })),
  ];
  lines.sort(
    (a, b) =>
      b.removedAt.getTime() - a.removedAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return lines.slice(0, TRASH_LIMIT);
}

// ---------------------------------------------------------------------------------------------
// Gjenoppretting
// ---------------------------------------------------------------------------------------------

type Context = {
  tx: DbExecutor;
  grant: EmployeeGrant;
  orgId: string;
  assignmentId: string;
  how: RestoreHow;
  now: Date;
};

type BuildingRow = { id: string; name: string; deletedAt: Date | null; deletedBy: string | null };
type FloorRow = {
  id: string;
  reportBuildingId: string;
  name: string;
  level: number;
  deletedAt: Date | null;
  deletedBy: string | null;
};
type RoomRow = {
  id: string;
  floorId: string;
  roomType: string;
  deletedAt: Date | null;
  deletedBy: string | null;
};

const restoredValues = (grant: EmployeeGrant) => ({
  deletedAt: null,
  deletedBy: null,
  updatedBy: grant.employeeId,
});

/** Bygningen, med oppdraget. Oppdraget er ikke kansellert. Ingen lås. */
async function resolveBuilding(tx: DbExecutor, orgId: string, buildingId: string) {
  const [row] = await tx
    .select({ id: reportBuildings.id, assignmentId: reportBuildings.assignmentId })
    .from(reportBuildings)
    .innerJoin(
      assignments,
      and(
        eq(assignments.organizationId, reportBuildings.organizationId),
        eq(assignments.id, reportBuildings.assignmentId),
        isNull(assignments.deletedAt),
      ),
    )
    .where(and(eq(reportBuildings.id, buildingId), eq(reportBuildings.organizationId, orgId)));
  if (!row) throw new AccessDeniedError();
  return row;
}

/** Etasjen med bygning og oppdrag. Oppdraget er ikke kansellert. Ingen lås. */
async function resolveFloor(tx: DbExecutor, orgId: string, floorId: string) {
  const [row] = await tx
    .select({
      id: floors.id,
      reportBuildingId: floors.reportBuildingId,
      assignmentId: reportBuildings.assignmentId,
    })
    .from(floors)
    .innerJoin(
      reportBuildings,
      and(
        eq(reportBuildings.organizationId, floors.organizationId),
        eq(reportBuildings.id, floors.reportBuildingId),
      ),
    )
    .innerJoin(
      assignments,
      and(
        eq(assignments.organizationId, reportBuildings.organizationId),
        eq(assignments.id, reportBuildings.assignmentId),
        isNull(assignments.deletedAt),
      ),
    )
    .where(and(eq(floors.id, floorId), eq(floors.organizationId, orgId)));
  if (!row) throw new AccessDeniedError();
  return row;
}

/** Rommet med etasje, bygning og oppdrag. Oppdraget er ikke kansellert. Ingen lås. */
async function resolveRoom(tx: DbExecutor, orgId: string, roomId: string) {
  const [row] = await tx
    .select({
      id: rooms.id,
      floorId: rooms.floorId,
      reportBuildingId: floors.reportBuildingId,
      assignmentId: reportBuildings.assignmentId,
    })
    .from(rooms)
    .innerJoin(
      floors,
      and(eq(floors.organizationId, rooms.organizationId), eq(floors.id, rooms.floorId)),
    )
    .innerJoin(
      reportBuildings,
      and(
        eq(reportBuildings.organizationId, floors.organizationId),
        eq(reportBuildings.id, floors.reportBuildingId),
      ),
    )
    .innerJoin(
      assignments,
      and(
        eq(assignments.organizationId, reportBuildings.organizationId),
        eq(assignments.id, reportBuildings.assignmentId),
        isNull(assignments.deletedAt),
      ),
    )
    .where(and(eq(rooms.id, roomId), eq(rooms.organizationId, orgId)));
  if (!row) throw new AccessDeniedError();
  return row;
}

async function lockBuildingRow(tx: DbExecutor, orgId: string, id: string): Promise<BuildingRow> {
  const [row] = await tx
    .select({
      id: reportBuildings.id,
      name: reportBuildings.name,
      deletedAt: reportBuildings.deletedAt,
      deletedBy: reportBuildings.deletedBy,
    })
    .from(reportBuildings)
    .where(and(eq(reportBuildings.id, id), eq(reportBuildings.organizationId, orgId)))
    .for("update");
  if (!row) throw new AccessDeniedError();
  return row;
}

const FLOOR_COLUMNS = {
  id: floors.id,
  reportBuildingId: floors.reportBuildingId,
  name: floors.name,
  level: floors.level,
  deletedAt: floors.deletedAt,
  deletedBy: floors.deletedBy,
};

const ROOM_COLUMNS = {
  id: rooms.id,
  floorId: rooms.floorId,
  roomType: rooms.roomType,
  deletedAt: rooms.deletedAt,
  deletedBy: rooms.deletedBy,
};

async function lockFloorRow(tx: DbExecutor, orgId: string, id: string): Promise<FloorRow> {
  const [row] = await tx
    .select(FLOOR_COLUMNS)
    .from(floors)
    .where(and(eq(floors.id, id), eq(floors.organizationId, orgId)))
    .for("update");
  if (!row) throw new AccessDeniedError();
  return row;
}

async function lockRoomRow(tx: DbExecutor, orgId: string, id: string): Promise<RoomRow> {
  const [row] = await tx
    .select(ROOM_COLUMNS)
    .from(rooms)
    .where(and(eq(rooms.id, id), eq(rooms.organizationId, orgId)))
    .for("update");
  if (!row) throw new AccessDeniedError();
  return row;
}

/** De fjernede rommene i etasjene med nøyaktig dette tidspunktet (slettegruppen), låst. */
async function lockRoomsInGroup(
  tx: DbExecutor,
  orgId: string,
  floorIds: string[],
  deletedAt: Date,
): Promise<RoomRow[]> {
  if (floorIds.length === 0) return [];
  const rows = await tx
    .select(ROOM_COLUMNS)
    .from(rooms)
    .where(
      and(
        eq(rooms.organizationId, orgId),
        inArray(rooms.floorId, floorIds),
        isNotNull(rooms.deletedAt),
      ),
    )
    .orderBy(asc(rooms.id))
    .for("update");
  return rows.filter((row) => sameTime(row.deletedAt, deletedAt));
}

/** Alle arealradene i etasjene, låst (etter etasjene og rommene). */
async function lockAreas(tx: DbExecutor, orgId: string, floorIds: string[]) {
  if (floorIds.length === 0) return [];
  return tx
    .select({
      id: floorAreas.id,
      floorId: floorAreas.floorId,
      deletedAt: floorAreas.deletedAt,
      deletedBy: floorAreas.deletedBy,
    })
    .from(floorAreas)
    .where(and(eq(floorAreas.organizationId, orgId), inArray(floorAreas.floorId, floorIds)))
    .orderBy(asc(floorAreas.id))
    .for("update");
}

async function restoreBuildingRow(ctx: Context, building: BuildingRow) {
  await ctx.tx
    .update(reportBuildings)
    .set(restoredValues(ctx.grant))
    .where(and(eq(reportBuildings.id, building.id), eq(reportBuildings.organizationId, ctx.orgId)));
  await recordAuditEvent(ctx.tx, ctx.grant, {
    entityType: "report_building",
    entityId: building.id,
    action: "restore",
    changes: { assignmentId: ctx.assignmentId, how: ctx.how },
  });
}

async function restoreRoomRows(ctx: Context, roomRows: RoomRow[]) {
  if (roomRows.length === 0) return;
  await ctx.tx
    .update(rooms)
    .set(restoredValues(ctx.grant))
    .where(
      and(
        eq(rooms.organizationId, ctx.orgId),
        inArray(
          rooms.id,
          roomRows.map((row) => row.id),
        ),
      ),
    );
  for (const room of roomRows) {
    await recordAuditEvent(ctx.tx, ctx.grant, {
      entityType: "room",
      entityId: room.id,
      action: "restore",
      changes: { assignmentId: ctx.assignmentId, floorId: room.floorId, how: ctx.how },
    });
  }
}

/**
 * Henter etasjen tilbake, med arealraden etter A411. Gir `true` når etasjen har en ny aktiv
 * arealrad, slik at den gamle ble liggende (beskjed til den ansatte). Arealradene må være låst.
 */
async function restoreFloorRow(
  ctx: Context,
  floor: FloorRow & { deletedAt: Date },
  areas: Awaited<ReturnType<typeof lockAreas>>,
): Promise<boolean> {
  const own = areas.filter((area) => area.floorId === floor.id);
  const match = matchingArea(own, floor);
  let areaKept = false;
  if (match) {
    if (own.some((area) => area.deletedAt === null)) {
      areaKept = true;
    } else {
      try {
        // Eget lagringspunkt: bryter raden den unike indeksen likevel, rulles bare den tilbake.
        await ctx.tx.transaction(async (savepoint) => {
          await savepoint
            .update(floorAreas)
            .set(restoredValues(ctx.grant))
            .where(and(eq(floorAreas.id, match.id), eq(floorAreas.organizationId, ctx.orgId)));
          await recordAuditEvent(savepoint, ctx.grant, {
            entityType: "floor_area",
            entityId: match.id,
            action: "restore",
            changes: { assignmentId: ctx.assignmentId, floorId: floor.id, how: ctx.how },
          });
        });
      } catch (error) {
        if (!isUniqueViolation(error, "floor_areas_active_floor_idx")) throw error;
        areaKept = true;
      }
    }
  }
  await ctx.tx
    .update(floors)
    .set(restoredValues(ctx.grant))
    .where(and(eq(floors.id, floor.id), eq(floors.organizationId, ctx.orgId)));
  await recordAuditEvent(ctx.tx, ctx.grant, {
    entityType: "floor",
    entityId: floor.id,
    action: "restore",
    changes: {
      assignmentId: ctx.assignmentId,
      reportBuildingId: floor.reportBuildingId,
      how: ctx.how,
    },
  });
  return areaKept;
}

function isRemoved<T extends { deletedAt: Date | null }>(row: T): row is T & { deletedAt: Date } {
  return row.deletedAt !== null;
}

async function buildingEvent(
  ctx: Context,
  building: BuildingRow & { deletedAt: Date },
  groupCount: number,
) {
  await recordEvent(ctx.tx, ctx.grant, {
    type: "assignment.building_restored",
    assignmentId: ctx.assignmentId,
    data: {
      buildingId: building.id,
      groupCount,
      how: ctx.how,
      secondsSinceRemoval: secondsSince(ctx.now, building.deletedAt),
    },
  });
}

async function floorEvent(ctx: Context, floor: FloorRow & { deletedAt: Date }, groupCount: number) {
  await recordEvent(ctx.tx, ctx.grant, {
    type: "assignment.floor_restored",
    assignmentId: ctx.assignmentId,
    data: {
      floorId: floor.id,
      floorKey: floor.level,
      groupCount,
      how: ctx.how,
      secondsSinceRemoval: secondsSince(ctx.now, floor.deletedAt),
    },
  });
}

/** Beskjeden når overordnet ledd kom med (A410). */
function parentNotice(
  subject: "Rommet" | "Etasjen",
  floor: FloorRow | null,
  building: BuildingRow | null,
): string {
  const parts = [
    ...(floor ? [`etasjen «${floor.name}»`] : []),
    ...(building ? [`bygningen «${building.name}»`] : []),
  ];
  return `${subject} kom tilbake, sammen med ${parts.join(" og ")}.`;
}

function item(
  orgId: string,
  type: RestoredItem["type"],
  rows: readonly { id: string }[],
): RestoredItem[] {
  return rows.map((row) => ({ type, id: row.id, organizationId: orgId }));
}

/**
 * Henter tilbake en fjernet bygning med slettegruppen: etasjene, rommene og arealradene med samme
 * `deleted_at` (A411, A414). Er bygningen alt aktiv, skjer ingenting (`changed: false`).
 */
export async function restoreBuilding(
  actor: Actor,
  organizationId: string,
  buildingId: string,
  how: RestoreHow,
): Promise<RestoreResult> {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  const method = restoreHowSchema.parse(how);
  requireUuid(buildingId);
  const orgId = grant.organizationId;

  return db.transaction(async (tx) => {
    const resolved = await resolveBuilding(tx, orgId, buildingId);
    const building = await lockBuildingRow(tx, orgId, resolved.id);
    if (!isRemoved(building)) {
      return { restored: item(orgId, "building", [building]), changed: false, notices: [] };
    }
    await assertReportNotPublished(tx, orgId, resolved.assignmentId);
    const ctx: Context = {
      tx,
      grant,
      orgId,
      assignmentId: resolved.assignmentId,
      how: method,
      now: new Date(),
    };

    const floorRows = (
      await tx
        .select(FLOOR_COLUMNS)
        .from(floors)
        .where(
          and(
            eq(floors.organizationId, orgId),
            eq(floors.reportBuildingId, building.id),
            isNotNull(floors.deletedAt),
          ),
        )
        .orderBy(asc(floors.id))
        .for("update")
    )
      .filter((row) => sameTime(row.deletedAt, building.deletedAt))
      .filter(isRemoved);
    const floorIds = floorRows.map((row) => row.id);
    const roomRows = await lockRoomsInGroup(tx, orgId, floorIds, building.deletedAt);
    const areas = await lockAreas(tx, orgId, floorIds);

    await restoreBuildingRow(ctx, building);
    let areaKept = false;
    for (const floor of floorRows) {
      if (await restoreFloorRow(ctx, floor, areas)) areaKept = true;
    }
    await restoreRoomRows(ctx, roomRows);

    const groupCount = 1 + floorRows.length + roomRows.length;
    await buildingEvent(ctx, building, groupCount);
    return {
      restored: [
        ...item(orgId, "building", [building]),
        ...item(orgId, "floor", floorRows),
        ...item(orgId, "room", roomRows),
      ],
      changed: true,
      notices: areaKept ? [NOTICE_AREA_KEPT] : [],
    };
  });
}

/**
 * Henter tilbake en fjernet etasje med rommene og arealraden i slettegruppen (A411, A414). Er
 * bygningen også fjernet, kommer den med, men ikke de andre etasjene (A410).
 */
export async function restoreFloor(
  actor: Actor,
  organizationId: string,
  floorId: string,
  how: RestoreHow,
): Promise<RestoreResult> {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  const method = restoreHowSchema.parse(how);
  requireUuid(floorId);
  const orgId = grant.organizationId;

  return db.transaction(async (tx) => {
    const resolved = await resolveFloor(tx, orgId, floorId);
    const building = await lockBuildingRow(tx, orgId, resolved.reportBuildingId);
    const floor = await lockFloorRow(tx, orgId, resolved.id);
    if (!isRemoved(floor)) {
      return { restored: item(orgId, "floor", [floor]), changed: false, notices: [] };
    }
    await assertReportNotPublished(tx, orgId, resolved.assignmentId);
    const ctx: Context = {
      tx,
      grant,
      orgId,
      assignmentId: resolved.assignmentId,
      how: method,
      now: new Date(),
    };

    const roomRows = await lockRoomsInGroup(tx, orgId, [floor.id], floor.deletedAt);
    const areas = await lockAreas(tx, orgId, [floor.id]);

    const notices: string[] = [];
    const restored: RestoredItem[] = [];
    if (isRemoved(building)) {
      await restoreBuildingRow(ctx, building);
      await buildingEvent(ctx, building, 1);
      restored.push(...item(orgId, "building", [building]));
      notices.push(parentNotice("Etasjen", null, building));
    }
    const areaKept = await restoreFloorRow(ctx, floor, areas);
    await restoreRoomRows(ctx, roomRows);
    await floorEvent(ctx, floor, 1 + roomRows.length);
    if (areaKept) notices.push(NOTICE_AREA_KEPT);

    restored.push(...item(orgId, "floor", [floor]), ...item(orgId, "room", roomRows));
    return { restored, changed: true, notices };
  });
}

/**
 * Henter tilbake et fjernet rom. Er etasjen eller bygningen også fjernet, kommer de med (etasjen
 * med arealraden), men aldri andre rom eller etasjer (A410).
 */
export async function restoreRoom(
  actor: Actor,
  organizationId: string,
  roomId: string,
  how: RestoreHow,
): Promise<RestoreResult> {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  const method = restoreHowSchema.parse(how);
  requireUuid(roomId);
  const orgId = grant.organizationId;

  return db.transaction(async (tx) => {
    const resolved = await resolveRoom(tx, orgId, roomId);
    const building = await lockBuildingRow(tx, orgId, resolved.reportBuildingId);
    const floor = await lockFloorRow(tx, orgId, resolved.floorId);
    const room = await lockRoomRow(tx, orgId, resolved.id);
    if (!isRemoved(room)) {
      return { restored: item(orgId, "room", [room]), changed: false, notices: [] };
    }
    await assertReportNotPublished(tx, orgId, resolved.assignmentId);
    const ctx: Context = {
      tx,
      grant,
      orgId,
      assignmentId: resolved.assignmentId,
      how: method,
      now: new Date(),
    };
    const areas = isRemoved(floor) ? await lockAreas(tx, orgId, [floor.id]) : [];

    const restored: RestoredItem[] = [];
    const notices: string[] = [];
    const buildingRemoved = isRemoved(building);
    const floorRemoved = isRemoved(floor);
    if (isRemoved(building)) {
      await restoreBuildingRow(ctx, building);
      await buildingEvent(ctx, building, 1);
      restored.push(...item(orgId, "building", [building]));
    }
    let areaKept = false;
    if (isRemoved(floor)) {
      areaKept = await restoreFloorRow(ctx, floor, areas);
      await floorEvent(ctx, floor, 1);
      restored.push(...item(orgId, "floor", [floor]));
    }
    await restoreRoomRows(ctx, [room]);
    await recordEvent(tx, grant, {
      type: "assignment.room_restored",
      assignmentId: resolved.assignmentId,
      data: {
        roomId: room.id,
        roomTypeKey: room.roomType,
        groupCount: 1,
        how: method,
        secondsSinceRemoval: secondsSince(ctx.now, room.deletedAt),
      },
    });
    restored.push(...item(orgId, "room", [room]));

    if (buildingRemoved || floorRemoved) {
      notices.push(
        parentNotice("Rommet", floorRemoved ? floor : null, buildingRemoved ? building : null),
      );
    }
    if (areaKept) notices.push(NOTICE_AREA_KEPT);
    return { restored, changed: true, notices };
  });
}
