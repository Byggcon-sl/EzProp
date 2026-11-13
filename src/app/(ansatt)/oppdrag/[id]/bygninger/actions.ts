"use server";

import { revalidatePath } from "next/cache";
import {
  addRooms,
  BuildingNotEmptyError,
  FloorNotEmptyError,
  PropertyMissingError,
  removeBuilding,
  removeFloor,
  removeRoom,
  saveBuilding,
  saveFloor,
  saveFloorArea,
  saveRoom,
} from "@/core/buildings";
import { isUuid } from "@/shared/lib/uuid";
import { errorResult, failure, type KnownError } from "../../../action-result";
import { getEmployeeContext } from "../../../employee-context";
import { NO_ACCESS, type FormState } from "../../../form-state";

/*
 * Server actions på bygningssiden (bygninger, etasjer, areal og rom). Ingen tilgangslogikk her:
 * organisasjonen kommer fra `getEmployeeContext()`, og kjernen sjekker rettigheten. Et felt
 * `organizationId` i skjemaet leses aldri. Id-er som ikke er uuid stoppes før kjernen kalles.
 * Loggen får bare rute, bruker-id, id-er og feilnavn, aldri navn, kommentar eller arealtall.
 */

const ROUTE = "/oppdrag/[id]/bygninger";

/** Feilene fra kjernen som siden viser med egen tekst. */
const KNOWN_ERRORS: readonly KnownError[] = [
  { error: PropertyMissingError, message: new PropertyMissingError().message },
  { error: BuildingNotEmptyError, message: new BuildingNotEmptyError().message },
  { error: FloorNotEmptyError, message: new FloorNotEmptyError().message },
];

/** Tekstverdiene fra skjemaet. Bare de kjente feltene leses (aldri `organizationId` e.l.). */
function readFields<T extends string>(formData: FormData, fields: readonly T[]) {
  const values = {} as Record<T, string>;
  for (const name of fields) values[name] = String(formData.get(name) ?? "");
  return values;
}

/** En id fra skjemaet. Tom gir `null` (ny rad); ellers må den være en uuid. */
function optionalId(formData: FormData, name: string): string | null | false {
  const value = String(formData.get(name) ?? "").trim();
  if (value === "") return null;
  return isUuid(value) ? value : false;
}

function requiredId(formData: FormData, name: string): string | false {
  const value = String(formData.get(name) ?? "").trim();
  return isUuid(value) ? value : false;
}

/** Avkrysningen sendes bare når den er krysset av. */
function checked(formData: FormData, name: string) {
  return formData.get(name) !== null ? "on" : "";
}

/** Svaret når noe ble lagret: ingen feil, og `attempt` økes slik at skjemaet ser at det er lagret. */
function saved(previous: FormState): FormState {
  return { fieldErrors: {}, message: null, values: {}, attempt: previous.attempt + 1 };
}

function refresh() {
  revalidatePath(ROUTE, "page");
}

function handle(
  error: unknown,
  previous: FormState,
  values: FormState["values"],
  userId: string,
  ids: Record<string, string>,
) {
  return errorResult(
    error,
    previous,
    values,
    { route: ROUTE, userId, ...ids },
    { known: KNOWN_ERRORS },
  );
}

/** «Lagre» for en ny eller endret bygning. Ny bygning når `buildingId` er tom. */
export async function saveBuildingAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const assignmentId = requiredId(formData, "assignmentId");
  const buildingId = optionalId(formData, "buildingId");
  const values = readFields(formData, ["name"] as const);
  const context = await getEmployeeContext();
  if (!context || assignmentId === false || buildingId === false) {
    return failure(previous, values, {}, NO_ACCESS);
  }

  try {
    await saveBuilding(context.actor, context.organizationId, assignmentId, buildingId, values);
  } catch (error) {
    return handle(error, previous, values, context.actor.id, {
      assignmentId,
      ...(buildingId ? { buildingId } : {}),
    });
  }
  refresh();
  return saved(previous);
}

/** «Fjern» på en bygning. Bare når den ikke har etasjer. */
export async function removeBuildingAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const buildingId = requiredId(formData, "buildingId");
  const context = await getEmployeeContext();
  if (!context || buildingId === false) return failure(previous, {}, {}, NO_ACCESS);

  try {
    await removeBuilding(context.actor, context.organizationId, buildingId);
  } catch (error) {
    return handle(error, previous, {}, context.actor.id, { buildingId });
  }
  refresh();
  return saved(previous);
}

/** «Lagre» for en ny eller endret etasje. Ny etasje når `floorId` er tom. */
export async function saveFloorAction(previous: FormState, formData: FormData): Promise<FormState> {
  const buildingId = requiredId(formData, "buildingId");
  const floorId = optionalId(formData, "floorId");
  const values = {
    ...readFields(formData, ["name", "level"] as const),
    belowGround: checked(formData, "belowGround"),
  };
  const context = await getEmployeeContext();
  if (!context || buildingId === false || floorId === false) {
    return failure(previous, values, {}, NO_ACCESS);
  }

  try {
    await saveFloor(context.actor, context.organizationId, buildingId, floorId, values);
  } catch (error) {
    return handle(error, previous, values, context.actor.id, {
      buildingId,
      ...(floorId ? { floorId } : {}),
    });
  }
  refresh();
  return saved(previous);
}

/** «Fjern» på en etasje. Bare når den ikke har rom; arealet fjernes sammen med etasjen. */
export async function removeFloorAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const floorId = requiredId(formData, "floorId");
  const context = await getEmployeeContext();
  if (!context || floorId === false) return failure(previous, {}, {}, NO_ACCESS);

  try {
    await removeFloor(context.actor, context.organizationId, floorId);
  } catch (error) {
    return handle(error, previous, {}, context.actor.id, { floorId });
  }
  refresh();
  return saved(previous);
}

const AREA_FIELDS = ["braI", "braE", "braB", "alh", "measuredBy", "method", "comment"] as const;

/** «Lagre areal» for én etasje. */
export async function saveFloorAreaAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const floorId = requiredId(formData, "floorId");
  const values = readFields(formData, AREA_FIELDS);
  const context = await getEmployeeContext();
  if (!context || floorId === false) return failure(previous, values, {}, NO_ACCESS);

  try {
    await saveFloorArea(context.actor, context.organizationId, floorId, values);
  } catch (error) {
    return handle(error, previous, values, context.actor.id, { floorId });
  }
  refresh();
  return saved(previous);
}

/**
 * «Lagre» for et nytt eller endret rom. Skjemaet sender alltid arealtype og «under terreng»
 * (forslaget er satt i skjemaet og kan endres), så takstmannens valg vinner.
 */
export async function saveRoomAction(previous: FormState, formData: FormData): Promise<FormState> {
  const floorId = requiredId(formData, "floorId");
  const roomId = optionalId(formData, "roomId");
  const values = {
    ...readFields(formData, ["roomType", "name", "areaType"] as const),
    belowGround: checked(formData, "belowGround"),
  };
  const context = await getEmployeeContext();
  if (!context || floorId === false || roomId === false) {
    return failure(previous, values, {}, NO_ACCESS);
  }

  try {
    await saveRoom(context.actor, context.organizationId, floorId, roomId, {
      ...values,
      belowGround: values.belowGround === "on",
    });
  } catch (error) {
    return handle(error, previous, values, context.actor.id, {
      floorId,
      ...(roomId ? { roomId } : {}),
    });
  }
  refresh();
  return saved(previous);
}

/** Meldingen når romlisten fra dialogen ikke kan leses. */
const BAD_ROOM_LIST = "Noe gikk galt med romlisten. Prøv igjen.";

type AddRoomsInput = Parameters<typeof addRooms>[3];

/**
 * «Legg til N rom i <etasje>» fra dialogen «Legg til flere rom». `drafts` er romutkastene som
 * JSON (`[{ roomType, count }]`). Kjernen validerer listen, kilden og settet, og lager navnene;
 * klienten sender aldri navn. Romnavn logges aldri (bare id-er og feilnavn).
 */
export async function addRoomsAction(previous: FormState, formData: FormData): Promise<FormState> {
  const floorId = requiredId(formData, "floorId");
  const values = readFields(formData, ["source", "presetKey", "drafts"] as const);
  const context = await getEmployeeContext();
  if (!context || floorId === false) return failure(previous, values, {}, NO_ACCESS);

  let drafts: unknown;
  try {
    drafts = JSON.parse(values.drafts);
  } catch {
    return failure(previous, values, {}, BAD_ROOM_LIST);
  }

  // Kjernen validerer alt med Zod; typen her er bare det handlingen sender videre.
  const input = {
    drafts,
    source: values.source,
    ...(values.presetKey === "" ? {} : { presetKey: values.presetKey }),
  } as AddRoomsInput;

  try {
    await addRooms(context.actor, context.organizationId, floorId, input);
  } catch (error) {
    return handle(error, previous, values, context.actor.id, { floorId });
  }
  refresh();
  return saved(previous);
}

/** «Fjern» på et rom. */
export async function removeRoomAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const roomId = requiredId(formData, "roomId");
  const context = await getEmployeeContext();
  if (!context || roomId === false) return failure(previous, {}, {}, NO_ACCESS);

  try {
    await removeRoom(context.actor, context.organizationId, roomId);
  } catch (error) {
    return handle(error, previous, {}, context.actor.id, { roomId });
  }
  refresh();
  return saved(previous);
}
