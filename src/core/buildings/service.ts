import { and, asc, eq, inArray, isNull } from "drizzle-orm";
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
  assignments,
  employees,
  floorAreas,
  floors,
  properties,
  reportBuildings,
  rooms,
} from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import {
  suggestAreaType,
  suggestBelowGround,
  sumAssignmentArea,
  sumBuildingArea,
  sumFloorArea,
  type AreaSum,
} from "./codes";
import { BuildingNotEmptyError, FloorNotEmptyError, PropertyMissingError } from "./errors";
import {
  buildingInputSchema,
  floorAreaInputSchema,
  floorInputSchema,
  roomInputSchema,
  type BuildingInput,
  type FloorAreaInput,
  type FloorInput,
  type RoomInput,
} from "./schemas";

/*
 * Bygninger, etasjer, areal per etasje og rom på oppdraget (docs/05-domenemodell.md 4.4), per
 * oppdrag til rapportene finnes (A94). Lesing med `organization.read`, endring med
 * `assignment.edit`. All filtrering bruker `grant.organizationId`, aldri en id fra skjemaet.
 * Fremmed, ukjent, slettet eller ugyldig id gir `AccessDeniedError`; en rad under en slettet
 * forelder (oppdrag, bygning eller etasje) regnes som slettet. Skrivingene låser foreldreraden med
 * `FOR UPDATE`, så samtidige endringer går etter hverandre.
 *
 * Hendelser og revisjonslogg skrives i samme transaksjon og har bare id-er, faste koder og navnene
 * på feltene som er endret, aldri navn på bygning, etasje eller rom, kommentar eller arealtall
 * (raden er kilden). Lagring uten endring skriver ingenting.
 */

export type EmployeeOption = { id: string; name: string };

export type FloorAreaDetail = {
  id: string;
  braI: number | null;
  braE: number | null;
  braB: number | null;
  alh: number | null;
  measuredBy: string | null;
  /** Navnet på den som målte, også når personen har sluttet. */
  measuredByName: string | null;
  method: string | null;
  comment: string | null;
};

export type RoomDetail = {
  id: string;
  roomType: string;
  name: string | null;
  areaType: string;
  belowGround: boolean;
};

export type FloorDetail = {
  id: string;
  name: string;
  level: number;
  belowGround: boolean;
  /** `null` når arealet ikke er ført. */
  area: FloorAreaDetail | null;
  rooms: RoomDetail[];
  sum: AreaSum;
};

export type BuildingDetail = {
  id: string;
  name: string;
  floors: FloorDetail[];
  sum: AreaSum;
};

export type AssignmentBuildings = {
  /** Om oppdraget har en aktiv eiendom. Uten den kan det ikke legges til bygninger. */
  hasProperty: boolean;
  /** Aktive ansatte i organisasjonen, til «Målt av». */
  employees: EmployeeOption[];
  /** Den innloggede ansatte, forhåndsvalgt i «Målt av». */
  currentEmployeeId: string;
  buildings: BuildingDetail[];
  sum: AreaSum;
};

export type SaveResult = { id: string; created: boolean; changed: boolean };

const FLOOR_FIELDS = ["name", "level", "belowGround"] as const;
const AREA_FIELDS = ["braI", "braE", "braB", "alh", "measuredBy", "method", "comment"] as const;
const ROOM_FIELDS = ["roomType", "name", "areaType", "belowGround"] as const;

/** Felt der verdien kan stå i revisjonsloggen (bare faste koder og id-er). */
const LOGGABLE_FIELDS = new Set<string>(["measuredBy", "method", "roomType", "areaType"]);

/** Navnene på feltene som er endret, og fra/til bare for faste koder og id-er. */
function describeChanges<T extends string>(
  fields: readonly T[],
  before: Record<T, unknown>,
  after: Record<T, unknown>,
): { fields: T[]; codes: Record<string, { from: unknown; to: unknown }> } {
  const changed = fields.filter((field) => before[field] !== after[field]);
  const codes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of changed) {
    if (LOGGABLE_FIELDS.has(field)) codes[field] = { from: before[field], to: after[field] };
  }
  return { fields: changed, codes };
}

function requireUuid(...ids: string[]) {
  if (!ids.every(isUuid)) throw new AccessDeniedError();
}

/** Oppdraget, låst og ikke slettet, i organisasjonen fra tilgangssjekken. */
async function lockAssignment(tx: DbExecutor, orgId: string, assignmentId: string) {
  const [row] = await tx
    .select({ id: assignments.id, propertyId: assignments.propertyId })
    .from(assignments)
    .where(
      and(
        eq(assignments.id, assignmentId),
        eq(assignments.organizationId, orgId),
        isNull(assignments.deletedAt),
      ),
    )
    .for("update");
  if (!row) throw new AccessDeniedError();
  return row;
}

/** Om eiendommen finnes og ikke er slettet. */
async function propertyIsActive(tx: DbExecutor, orgId: string, propertyId: string | null) {
  if (propertyId === null) return false;
  const [row] = await tx
    .select({ id: properties.id })
    .from(properties)
    .where(
      and(
        eq(properties.id, propertyId),
        eq(properties.organizationId, orgId),
        isNull(properties.deletedAt),
      ),
    );
  return row !== undefined;
}

/** Bygningen, låst, med oppdraget. Bygning og oppdrag er ikke slettet. */
async function lockBuilding(tx: DbExecutor, orgId: string, buildingId: string) {
  const [row] = await tx
    .select({
      id: reportBuildings.id,
      assignmentId: reportBuildings.assignmentId,
      name: reportBuildings.name,
    })
    .from(reportBuildings)
    .innerJoin(
      assignments,
      and(
        eq(assignments.organizationId, reportBuildings.organizationId),
        eq(assignments.id, reportBuildings.assignmentId),
        isNull(assignments.deletedAt),
      ),
    )
    .where(
      and(
        eq(reportBuildings.id, buildingId),
        eq(reportBuildings.organizationId, orgId),
        isNull(reportBuildings.deletedAt),
      ),
    )
    .for("update", { of: reportBuildings });
  if (!row) throw new AccessDeniedError();
  return row;
}

/** Etasjen, låst, med bygning og oppdrag. Ingen av dem er slettet. */
async function lockFloor(tx: DbExecutor, orgId: string, floorId: string) {
  const [row] = await tx
    .select({
      id: floors.id,
      reportBuildingId: floors.reportBuildingId,
      assignmentId: reportBuildings.assignmentId,
      name: floors.name,
      level: floors.level,
      belowGround: floors.belowGround,
    })
    .from(floors)
    .innerJoin(
      reportBuildings,
      and(
        eq(reportBuildings.organizationId, floors.organizationId),
        eq(reportBuildings.id, floors.reportBuildingId),
        isNull(reportBuildings.deletedAt),
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
    .where(and(eq(floors.id, floorId), eq(floors.organizationId, orgId), isNull(floors.deletedAt)))
    .for("update", { of: floors });
  if (!row) throw new AccessDeniedError();
  return row;
}

/** Rommet, låst, med etasje, bygning og oppdrag. Ingen av dem er slettet. */
async function lockRoom(tx: DbExecutor, orgId: string, roomId: string) {
  const [row] = await tx
    .select({
      id: rooms.id,
      floorId: rooms.floorId,
      assignmentId: reportBuildings.assignmentId,
      roomType: rooms.roomType,
      name: rooms.name,
      areaType: rooms.areaType,
      belowGround: rooms.belowGround,
    })
    .from(rooms)
    .innerJoin(
      floors,
      and(
        eq(floors.organizationId, rooms.organizationId),
        eq(floors.id, rooms.floorId),
        isNull(floors.deletedAt),
      ),
    )
    .innerJoin(
      reportBuildings,
      and(
        eq(reportBuildings.organizationId, floors.organizationId),
        eq(reportBuildings.id, floors.reportBuildingId),
        isNull(reportBuildings.deletedAt),
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
    .where(and(eq(rooms.id, roomId), eq(rooms.organizationId, orgId), isNull(rooms.deletedAt)))
    .for("update", { of: rooms });
  if (!row) throw new AccessDeniedError();
  return row;
}

/** Den aktive arealraden i etasjen, eller `undefined`. */
async function findFloorArea(tx: DbExecutor, orgId: string, floorId: string) {
  const [row] = await tx
    .select({
      id: floorAreas.id,
      braI: floorAreas.braI,
      braE: floorAreas.braE,
      braB: floorAreas.braB,
      alh: floorAreas.alh,
      measuredBy: floorAreas.measuredBy,
      method: floorAreas.method,
      comment: floorAreas.comment,
    })
    .from(floorAreas)
    .where(
      and(
        eq(floorAreas.organizationId, orgId),
        eq(floorAreas.floorId, floorId),
        isNull(floorAreas.deletedAt),
      ),
    )
    .for("update");
  return row;
}

/** Om den ansatte finnes, er aktiv og hører til organisasjonen. */
async function employeeIsActive(tx: DbExecutor, orgId: string, employeeId: string) {
  const [row] = await tx
    .select({ id: employees.id })
    .from(employees)
    .where(
      and(
        eq(employees.id, employeeId),
        eq(employees.organizationId, orgId),
        isNull(employees.deletedAt),
        isNull(employees.deactivatedAt),
      ),
    );
  return row !== undefined;
}

function softDelete(grant: EmployeeGrant) {
  return { deletedAt: new Date(), deletedBy: grant.employeeId, updatedBy: grant.employeeId };
}

/**
 * Bygningene på oppdraget med etasjer, areal per etasje (eller `null`), rom og summene, sortert:
 * bygninger og rom på `created_at` og så `id`, etasjer på `level`, `created_at` og så `id`.
 * Gir også `hasProperty` og de aktive ansatte til «Målt av». Ukjent, fremmed, slettet eller
 * ugyldig oppdrags-id gir `AccessDeniedError`.
 */
export async function getAssignmentBuildings(
  actor: Actor,
  organizationId: string,
  assignmentId: string,
): Promise<AssignmentBuildings> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  requireUuid(assignmentId);
  const orgId = grant.organizationId;

  const [assignment] = await db
    .select({ id: assignments.id, propertyId: assignments.propertyId })
    .from(assignments)
    .where(
      and(
        eq(assignments.id, assignmentId),
        eq(assignments.organizationId, orgId),
        isNull(assignments.deletedAt),
      ),
    );
  if (!assignment) throw new AccessDeniedError();

  const [hasProperty, employeeRows, buildingRows] = await Promise.all([
    propertyIsActive(db, orgId, assignment.propertyId),
    db
      .select({ id: employees.id, name: employees.name })
      .from(employees)
      .where(
        and(
          eq(employees.organizationId, orgId),
          isNull(employees.deletedAt),
          isNull(employees.deactivatedAt),
        ),
      )
      .orderBy(asc(employees.name), asc(employees.id)),
    db
      .select({ id: reportBuildings.id, name: reportBuildings.name })
      .from(reportBuildings)
      .where(
        and(
          eq(reportBuildings.organizationId, orgId),
          eq(reportBuildings.assignmentId, assignment.id),
          isNull(reportBuildings.deletedAt),
        ),
      )
      .orderBy(asc(reportBuildings.createdAt), asc(reportBuildings.id)),
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
            belowGround: floors.belowGround,
          })
          .from(floors)
          .where(
            and(
              eq(floors.organizationId, orgId),
              inArray(floors.reportBuildingId, buildingIds),
              isNull(floors.deletedAt),
            ),
          )
          .orderBy(asc(floors.level), asc(floors.createdAt), asc(floors.id));

  const floorIds = floorRows.map((row) => row.id);
  const [areaRows, roomRows] =
    floorIds.length === 0
      ? [[], []]
      : await Promise.all([
          db
            .select({
              id: floorAreas.id,
              floorId: floorAreas.floorId,
              braI: floorAreas.braI,
              braE: floorAreas.braE,
              braB: floorAreas.braB,
              alh: floorAreas.alh,
              measuredBy: floorAreas.measuredBy,
              measuredByName: employees.name,
              method: floorAreas.method,
              comment: floorAreas.comment,
            })
            .from(floorAreas)
            .leftJoin(
              employees,
              and(
                eq(employees.organizationId, floorAreas.organizationId),
                eq(employees.id, floorAreas.measuredBy),
              ),
            )
            .where(
              and(
                eq(floorAreas.organizationId, orgId),
                inArray(floorAreas.floorId, floorIds),
                isNull(floorAreas.deletedAt),
              ),
            ),
          db
            .select({
              id: rooms.id,
              floorId: rooms.floorId,
              roomType: rooms.roomType,
              name: rooms.name,
              areaType: rooms.areaType,
              belowGround: rooms.belowGround,
            })
            .from(rooms)
            .where(
              and(
                eq(rooms.organizationId, orgId),
                inArray(rooms.floorId, floorIds),
                isNull(rooms.deletedAt),
              ),
            )
            .orderBy(asc(rooms.createdAt), asc(rooms.id)),
        ]);

  const buildings: BuildingDetail[] = buildingRows.map((building) => {
    const buildingFloors: FloorDetail[] = floorRows
      .filter((floor) => floor.reportBuildingId === building.id)
      .map((floor) => {
        const areaRow = areaRows.find((row) => row.floorId === floor.id);
        const area: FloorAreaDetail | null = areaRow
          ? {
              id: areaRow.id,
              braI: areaRow.braI,
              braE: areaRow.braE,
              braB: areaRow.braB,
              alh: areaRow.alh,
              measuredBy: areaRow.measuredBy,
              measuredByName: areaRow.measuredByName ?? null,
              method: areaRow.method,
              comment: areaRow.comment,
            }
          : null;
        return {
          id: floor.id,
          name: floor.name,
          level: floor.level,
          belowGround: floor.belowGround,
          area,
          rooms: roomRows
            .filter((room) => room.floorId === floor.id)
            .map(({ floorId: _floorId, ...room }) => room),
          sum: sumFloorArea(area),
        };
      });
    return {
      id: building.id,
      name: building.name,
      floors: buildingFloors,
      sum: sumBuildingArea(buildingFloors),
    };
  });

  return {
    hasProperty,
    employees: employeeRows,
    currentEmployeeId: grant.employeeId,
    buildings,
    sum: sumAssignmentArea(buildings),
  };
}

/**
 * Lager (`buildingId = null`) eller oppdaterer en bygning på oppdraget. En ny bygning krever aktiv
 * eiendom, ellers `PropertyMissingError`. En bygning som ikke hører til oppdraget gir
 * `AccessDeniedError`.
 */
export async function saveBuilding(
  actor: Actor,
  organizationId: string,
  assignmentId: string,
  buildingId: string | null,
  input: BuildingInput,
): Promise<SaveResult> {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  const values = buildingInputSchema.parse(input);
  requireUuid(assignmentId, ...(buildingId === null ? [] : [buildingId]));
  const orgId = grant.organizationId;

  return db.transaction(async (tx) => {
    const assignment = await lockAssignment(tx, orgId, assignmentId);

    if (buildingId === null) {
      if (!(await propertyIsActive(tx, orgId, assignment.propertyId))) {
        throw new PropertyMissingError();
      }
      const [row] = await tx
        .insert(reportBuildings)
        .values({
          organizationId: orgId,
          assignmentId: assignment.id,
          name: values.name,
          createdBy: grant.employeeId,
        })
        .returning({ id: reportBuildings.id });
      if (!row) throw new Error("Fant ikke bygningen etter at den ble lagret. Prøv igjen.");
      await recordAuditEvent(tx, grant, {
        entityType: "report_building",
        entityId: row.id,
        action: "create",
        changes: { assignmentId: assignment.id },
      });
      await recordEvent(tx, grant, {
        type: "assignment.building_saved",
        assignmentId: assignment.id,
        data: { buildingId: row.id, created: true },
      });
      return { id: row.id, created: true, changed: true };
    }

    const existing = await lockBuilding(tx, orgId, buildingId);
    if (existing.assignmentId !== assignment.id) throw new AccessDeniedError();
    if (existing.name === values.name) return { id: existing.id, created: false, changed: false };

    await tx
      .update(reportBuildings)
      .set({ name: values.name, updatedBy: grant.employeeId })
      .where(and(eq(reportBuildings.id, existing.id), eq(reportBuildings.organizationId, orgId)));
    await recordAuditEvent(tx, grant, {
      entityType: "report_building",
      entityId: existing.id,
      action: "update",
      changes: { assignmentId: assignment.id, fields: ["name"] },
    });
    await recordEvent(tx, grant, {
      type: "assignment.building_saved",
      assignmentId: assignment.id,
      data: { buildingId: existing.id, created: false },
    });
    return { id: existing.id, created: false, changed: true };
  });
}

/** Fjerner (myk sletting) en bygning uten aktive etasjer, ellers `BuildingNotEmptyError` (A98). */
export async function removeBuilding(
  actor: Actor,
  organizationId: string,
  buildingId: string,
): Promise<{ id: string }> {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  requireUuid(buildingId);
  const orgId = grant.organizationId;

  return db.transaction(async (tx) => {
    const building = await lockBuilding(tx, orgId, buildingId);
    const [floor] = await tx
      .select({ id: floors.id })
      .from(floors)
      .where(
        and(
          eq(floors.organizationId, orgId),
          eq(floors.reportBuildingId, building.id),
          isNull(floors.deletedAt),
        ),
      )
      .limit(1);
    if (floor) throw new BuildingNotEmptyError();

    await tx
      .update(reportBuildings)
      .set(softDelete(grant))
      .where(and(eq(reportBuildings.id, building.id), eq(reportBuildings.organizationId, orgId)));
    await recordAuditEvent(tx, grant, {
      entityType: "report_building",
      entityId: building.id,
      action: "delete",
      changes: { assignmentId: building.assignmentId },
    });
    await recordEvent(tx, grant, {
      type: "assignment.building_removed",
      assignmentId: building.assignmentId,
      data: { buildingId: building.id, created: false },
    });
    return { id: building.id };
  });
}

/** Lager (`floorId = null`) eller oppdaterer en etasje i bygningen. */
export async function saveFloor(
  actor: Actor,
  organizationId: string,
  buildingId: string,
  floorId: string | null,
  input: FloorInput,
): Promise<SaveResult> {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  const values = floorInputSchema.parse(input);
  requireUuid(buildingId, ...(floorId === null ? [] : [floorId]));
  const orgId = grant.organizationId;

  return db.transaction(async (tx) => {
    const building = await lockBuilding(tx, orgId, buildingId);

    if (floorId === null) {
      const [row] = await tx
        .insert(floors)
        .values({
          organizationId: orgId,
          reportBuildingId: building.id,
          name: values.name,
          level: values.level,
          belowGround: values.belowGround,
          createdBy: grant.employeeId,
        })
        .returning({ id: floors.id });
      if (!row) throw new Error("Fant ikke etasjen etter at den ble lagret. Prøv igjen.");
      await recordAuditEvent(tx, grant, {
        entityType: "floor",
        entityId: row.id,
        action: "create",
        changes: { assignmentId: building.assignmentId, reportBuildingId: building.id },
      });
      await recordEvent(tx, grant, {
        type: "assignment.floor_saved",
        assignmentId: building.assignmentId,
        data: { floorId: row.id, created: true },
      });
      return { id: row.id, created: true, changed: true };
    }

    const existing = await lockFloor(tx, orgId, floorId);
    if (existing.reportBuildingId !== building.id) throw new AccessDeniedError();
    const changes = describeChanges(FLOOR_FIELDS, existing, values);
    if (changes.fields.length === 0) return { id: existing.id, created: false, changed: false };

    await tx
      .update(floors)
      .set({
        name: values.name,
        level: values.level,
        belowGround: values.belowGround,
        updatedBy: grant.employeeId,
      })
      .where(and(eq(floors.id, existing.id), eq(floors.organizationId, orgId)));
    await recordAuditEvent(tx, grant, {
      entityType: "floor",
      entityId: existing.id,
      action: "update",
      changes: {
        assignmentId: building.assignmentId,
        reportBuildingId: building.id,
        fields: changes.fields,
      },
    });
    await recordEvent(tx, grant, {
      type: "assignment.floor_saved",
      assignmentId: building.assignmentId,
      data: { floorId: existing.id, created: false },
    });
    return { id: existing.id, created: false, changed: true };
  });
}

/**
 * Fjerner (myk sletting) en etasje uten aktive rom, ellers `FloorNotEmptyError` (A98).
 * Arealraden myk-slettes sammen med etasjen.
 */
export async function removeFloor(
  actor: Actor,
  organizationId: string,
  floorId: string,
): Promise<{ id: string }> {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  requireUuid(floorId);
  const orgId = grant.organizationId;

  return db.transaction(async (tx) => {
    const floor = await lockFloor(tx, orgId, floorId);
    const [room] = await tx
      .select({ id: rooms.id })
      .from(rooms)
      .where(
        and(eq(rooms.organizationId, orgId), eq(rooms.floorId, floor.id), isNull(rooms.deletedAt)),
      )
      .limit(1);
    if (room) throw new FloorNotEmptyError();

    const area = await findFloorArea(tx, orgId, floor.id);
    if (area) {
      await tx
        .update(floorAreas)
        .set(softDelete(grant))
        .where(and(eq(floorAreas.id, area.id), eq(floorAreas.organizationId, orgId)));
      await recordAuditEvent(tx, grant, {
        entityType: "floor_area",
        entityId: area.id,
        action: "delete",
        changes: { assignmentId: floor.assignmentId, floorId: floor.id },
      });
    }
    await tx
      .update(floors)
      .set(softDelete(grant))
      .where(and(eq(floors.id, floor.id), eq(floors.organizationId, orgId)));
    await recordAuditEvent(tx, grant, {
      entityType: "floor",
      entityId: floor.id,
      action: "delete",
      changes: { assignmentId: floor.assignmentId, reportBuildingId: floor.reportBuildingId },
    });
    await recordEvent(tx, grant, {
      type: "assignment.floor_removed",
      assignmentId: floor.assignmentId,
      data: { floorId: floor.id, created: false },
    });
    return { id: floor.id };
  });
}

/**
 * Lager eller oppdaterer den ene arealraden i etasjen (A96). «Målt av»:
 * - tom og minst ett arealfelt fylt ut: den innloggede ansatte;
 * - tom og alle arealfeltene tomme: `null`;
 * - samme id som lagret før: godtas, også om personen har sluttet siden;
 * - ny id: må være en aktiv ansatt i organisasjonen, ellers `AccessDeniedError`.
 */
export async function saveFloorArea(
  actor: Actor,
  organizationId: string,
  floorId: string,
  input: FloorAreaInput,
): Promise<SaveResult> {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  const parsed = floorAreaInputSchema.parse(input);
  requireUuid(floorId);
  const orgId = grant.organizationId;

  return db.transaction(async (tx) => {
    const floor = await lockFloor(tx, orgId, floorId);
    const existing = await findFloorArea(tx, orgId, floor.id);

    const hasArea = [parsed.braI, parsed.braE, parsed.braB, parsed.alh].some(
      (value) => value !== null,
    );
    let measuredBy = parsed.measuredBy;
    if (measuredBy === null) {
      measuredBy = hasArea ? grant.employeeId : null;
    } else if (measuredBy !== existing?.measuredBy) {
      if (!(await employeeIsActive(tx, orgId, measuredBy))) throw new AccessDeniedError();
    }
    const values = { ...parsed, measuredBy };

    if (!existing) {
      const [row] = await tx
        .insert(floorAreas)
        .values({
          ...values,
          organizationId: orgId,
          floorId: floor.id,
          createdBy: grant.employeeId,
        })
        .returning({ id: floorAreas.id });
      if (!row) throw new Error("Fant ikke arealet etter at det ble lagret. Prøv igjen.");
      await recordAuditEvent(tx, grant, {
        entityType: "floor_area",
        entityId: row.id,
        action: "create",
        changes: {
          assignmentId: floor.assignmentId,
          floorId: floor.id,
          measuredBy: values.measuredBy,
          method: values.method,
        },
      });
      await recordEvent(tx, grant, {
        type: "assignment.floor_area_saved",
        assignmentId: floor.assignmentId,
        data: { floorAreaId: row.id, created: true },
      });
      return { id: row.id, created: true, changed: true };
    }

    const changes = describeChanges(AREA_FIELDS, existing, values);
    if (changes.fields.length === 0) return { id: existing.id, created: false, changed: false };

    await tx
      .update(floorAreas)
      .set({ ...values, updatedBy: grant.employeeId })
      .where(and(eq(floorAreas.id, existing.id), eq(floorAreas.organizationId, orgId)));
    await recordAuditEvent(tx, grant, {
      entityType: "floor_area",
      entityId: existing.id,
      action: "update",
      changes: {
        assignmentId: floor.assignmentId,
        floorId: floor.id,
        fields: changes.fields,
        ...changes.codes,
      },
    });
    await recordEvent(tx, grant, {
      type: "assignment.floor_area_saved",
      assignmentId: floor.assignmentId,
      data: { floorAreaId: existing.id, created: false },
    });
    return { id: existing.id, created: false, changed: true };
  });
}

/**
 * Lager (`roomId = null`) eller oppdaterer et rom i etasjen. Mangler arealtype eller «under
 * terreng» i input, brukes forslagene fra romtypen og etasjen (A97).
 */
export async function saveRoom(
  actor: Actor,
  organizationId: string,
  floorId: string,
  roomId: string | null,
  input: RoomInput,
): Promise<SaveResult> {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  const parsed = roomInputSchema.parse(input);
  requireUuid(floorId, ...(roomId === null ? [] : [roomId]));
  const orgId = grant.organizationId;

  return db.transaction(async (tx) => {
    const floor = await lockFloor(tx, orgId, floorId);
    const values = {
      roomType: parsed.roomType,
      name: parsed.name,
      areaType: parsed.areaType ?? suggestAreaType(parsed.roomType),
      belowGround:
        parsed.belowGround ??
        suggestBelowGround({ roomType: parsed.roomType, floorBelowGround: floor.belowGround }),
    };

    if (roomId === null) {
      const [row] = await tx
        .insert(rooms)
        .values({
          ...values,
          organizationId: orgId,
          floorId: floor.id,
          createdBy: grant.employeeId,
        })
        .returning({ id: rooms.id });
      if (!row) throw new Error("Fant ikke rommet etter at det ble lagret. Prøv igjen.");
      await recordAuditEvent(tx, grant, {
        entityType: "room",
        entityId: row.id,
        action: "create",
        changes: {
          assignmentId: floor.assignmentId,
          floorId: floor.id,
          roomType: values.roomType,
          areaType: values.areaType,
        },
      });
      await recordEvent(tx, grant, {
        type: "assignment.room_saved",
        assignmentId: floor.assignmentId,
        data: { roomId: row.id, created: true },
      });
      return { id: row.id, created: true, changed: true };
    }

    const room = await lockRoom(tx, orgId, roomId);
    if (room.floorId !== floor.id) throw new AccessDeniedError();
    const changes = describeChanges(ROOM_FIELDS, room, values);
    if (changes.fields.length === 0) return { id: room.id, created: false, changed: false };

    await tx
      .update(rooms)
      .set({ ...values, updatedBy: grant.employeeId })
      .where(and(eq(rooms.id, room.id), eq(rooms.organizationId, orgId)));
    await recordAuditEvent(tx, grant, {
      entityType: "room",
      entityId: room.id,
      action: "update",
      changes: {
        assignmentId: floor.assignmentId,
        floorId: floor.id,
        fields: changes.fields,
        ...changes.codes,
      },
    });
    await recordEvent(tx, grant, {
      type: "assignment.room_saved",
      assignmentId: floor.assignmentId,
      data: { roomId: room.id, created: false },
    });
    return { id: room.id, created: false, changed: true };
  });
}

/** Fjerner (myk sletting) et rom. */
export async function removeRoom(
  actor: Actor,
  organizationId: string,
  roomId: string,
): Promise<{ id: string }> {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  requireUuid(roomId);
  const orgId = grant.organizationId;

  return db.transaction(async (tx) => {
    const room = await lockRoom(tx, orgId, roomId);
    await tx
      .update(rooms)
      .set(softDelete(grant))
      .where(and(eq(rooms.id, room.id), eq(rooms.organizationId, orgId)));
    await recordAuditEvent(tx, grant, {
      entityType: "room",
      entityId: room.id,
      action: "delete",
      changes: { assignmentId: room.assignmentId, floorId: room.floorId },
    });
    await recordEvent(tx, grant, {
      type: "assignment.room_removed",
      assignmentId: room.assignmentId,
      data: { roomId: room.id, created: false },
    });
    return { id: room.id };
  });
}
