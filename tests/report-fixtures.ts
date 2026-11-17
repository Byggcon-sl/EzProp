import { eq } from "drizzle-orm";
import type { Actor } from "@/core/access";
import {
  getRoomView,
  saveField,
  startReport,
  type CheckpointView,
  type RoomRef,
} from "@/core/reports";
import { db } from "@/db/client";
import { organizations, type EmployeeRole } from "@/db/schema";
import { wetRoomTemplate } from "@/db/seed/templates/wet-room";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  createAssignment,
  createBuilding,
  createEmployee,
  createFloor,
  createOrganization,
  createRoom,
  createTemplate,
  createUser,
} from "./factories";

/*
 * Oppsett for testene av rapportkjernen (docs/funksjoner/fase2a-badet-pc-testplan.md avsnitt 4 og
 * 5): en organisasjon med publisert badmal, et oppdrag med bygning, etasje og bad, og ansatte med
 * rollene testene trenger. Alle verdier er oppdiktede.
 */

export type BathroomFixture = {
  organizationId: string;
  templateVersionId: string;
  assignmentId: string;
  buildingId: string;
  floorId: string;
  roomId: string;
  room: RoomRef;
  /** Takstmann (standardrollen i testene). */
  actor: Actor;
  employeeId: string;
};

/** Slår `access.inspectors_edit_all` på eller av i organisasjonen. */
export async function setInspectorsEditAll(organizationId: string, value: boolean) {
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": value } })
    .where(eq(organizations.id, organizationId));
}

/** En ansatt med rollene i organisasjonen. */
export async function createStaff(organizationId: string, roles: EmployeeRole[], name?: string) {
  const actor = await createUser({ name: name ?? `Test ${roles.join(" ") || "uten rolle"}` });
  const employee = await createEmployee(actor, organizationId, roles);
  return { actor, employee };
}

/** Et nytt bad (eller annet rom) på et nytt oppdrag i samme organisasjon. */
export async function createRoomOnNewAssignment(
  organizationId: string,
  options: { roomType?: string; inspectionAt?: Date | null } = {},
) {
  const assignment = await createAssignment(organizationId, {
    inspectionAt: options.inspectionAt ?? null,
  });
  const building = await createBuilding(organizationId, { assignmentId: assignment.id });
  const floor = await createFloor(organizationId, { buildingId: building.id });
  const room = await createRoom(organizationId, {
    floorId: floor.id,
    roomType: options.roomType ?? "bathroom",
  });
  return {
    assignmentId: assignment.id,
    buildingId: building.id,
    floorId: floor.id,
    roomId: room.id,
    room: { assignmentId: assignment.id, roomId: room.id },
  };
}

/**
 * Organisasjon med publisert badmal og et bad på et oppdrag. Befaringstid 2026, slik at
 * befaringsåret er fast. `roles` gjelder den innloggede (standard takstmann).
 */
export async function createBathroomFixture(
  options: {
    organizationId?: string;
    roles?: EmployeeRole[];
    inspectionAt?: Date | null;
    withTemplate?: boolean;
  } = {},
): Promise<BathroomFixture> {
  const organizationId =
    options.organizationId ?? (await createOrganization("Testfirma bad")).id;
  let templateVersionId = "";
  if (options.withTemplate !== false) {
    templateVersionId = (
      await createTemplate(organizationId, {
        status: "published",
        document: wetRoomTemplate,
        name: "Tilstandsrapport",
      })
    ).versionId;
  }
  const place = await createRoomOnNewAssignment(organizationId, {
    inspectionAt:
      options.inspectionAt === undefined ? new Date("2026-06-15T10:00:00Z") : options.inspectionAt,
  });
  const { actor, employee } = await createStaff(organizationId, options.roles ?? ["inspector"]);
  return {
    organizationId,
    templateVersionId,
    ...place,
    actor,
    employeeId: employee.id,
  };
}

/** Kontrollpunktene i badmalen (faste koder). */
export const CP = {
  general: "wet_room.general",
  documentation: "wet_room.documentation",
  membrane: "wet_room.membrane_drain",
  adjacent: "wet_room.adjacent",
  floor: "wet_room.floor",
} as const;

/** Reglene i badmalen (faste koder). */
export const RULE = {
  pastLifespan: "wet_room.membrane_past_lifespan",
  before2000: "wet_room.membrane_before_2000",
  moisture: "wet_room.hole_moisture_over_limit",
  notDone: "wet_room.hole_drilling_not_done",
  noMoisture: "wet_room.hole_no_elevated_moisture",
} as const;

/** Tomt svar. */
export const EMPTY = { text: null, number: null, optionKeys: null } as const;

// --- Hjelpere for tjenestene (testfilen må ha `vi.mock("server-only", () => ({}))`) ------------

type Who = Pick<BathroomFixture, "actor" | "organizationId" | "room">;
type AnswerInput = Partial<{ text: string | null; number: number | null; optionKeys: string[] | null }>;

/** Lagrer et svar på et felt i badet med tomt svar som `base` (eller `base` som sendes). */
export async function answer(f: Who, elementKey: string, value: AnswerInput, base: AnswerInput = {}) {
  return saveField(f.actor, f.organizationId, f.room, {
    table: "field_answers",
    id: uuidv7(),
    elementKey,
    field: "value",
    value: { ...EMPTY, ...value },
    base: { ...EMPTY, ...base },
  });
}

/** Visningen av badet når rapporten er startet. Kaster ellers. */
export async function startedView(f: Who) {
  const view = await getRoomView(f.actor, f.organizationId, f.room);
  if (view.state !== "started") throw new Error("rapporten er ikke startet");
  return view;
}

/** Ett kontrollpunkt i visningen. */
export function checkpointOf(view: { checkpoints: CheckpointView[] }, key: string): CheckpointView {
  const found = view.checkpoints.find((c) => c.checkpointKey === key);
  if (!found) throw new Error(`fant ikke punktet ${key}`);
  return found;
}

/** Bad med startet rapport. */
export async function startedBathroom(options: Parameters<typeof createBathroomFixture>[0] = {}) {
  const f = await createBathroomFixture(options);
  const { reportId } = await startReport(f.actor, f.organizationId, f.assignmentId);
  return { ...f, reportId };
}

/** Sjikt fra 1990, folie uten dokumentasjon: TG3-forslaget «før 2000». */
export async function answerMembrane1990(f: Who, year = 1990) {
  await answer(f, "wet_room.membrane_type", { optionKeys: ["foil"] });
  await answer(f, "wet_room.documentation_type", { optionKeys: ["none"] });
  await answer(f, "wet_room.membrane_year", { number: year });
}

/** Hulltaking, eventuelt med måling (standard vekt-%). `drilling` er valgkoden. */
export async function answerHole(
  f: Who,
  drilling: "done_no_findings" | "done_with_findings" | "not_done",
  reading?: number,
  unit = "weight_percent",
) {
  await answer(f, "wet_room.hole_drilling", { optionKeys: [drilling] });
  if (reading !== undefined) {
    await answer(f, "wet_room.hole_moisture_unit", { optionKeys: [unit] });
    await answer(f, "wet_room.hole_moisture_reading", { number: reading });
  }
}
