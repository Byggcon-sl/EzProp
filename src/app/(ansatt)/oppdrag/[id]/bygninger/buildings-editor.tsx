"use client";

import { useActionState, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type {
  AreaSum,
  AssignmentBuildings,
  BuildingDetail,
  EmployeeOption,
  FloorAreaDetail,
  FloorDetail,
  RoomDetail,
} from "@/core/buildings";
import { FLOOR_NAME_SUGGESTIONS, suggestFloor, type RoomType } from "@/core/buildings/codes";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/shared/ui/form";
import { FormErrors, SubmitButton } from "../../../form-parts";
import { initialFormState, textValue, type FormState } from "../../../form-state";
import { AddRoomsDialog, type AddRoomsFloor, type RoomPresetOption } from "./add-rooms-dialog";
import {
  removeBuildingAction,
  removeFloorAction,
  removeRoomAction,
  saveBuildingAction,
  saveFloorAction,
  saveFloorAreaAction,
  saveRoomAction,
} from "./actions";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

export type CodeOption = { value: string; label: string };
export type RoomTypeOption = CodeOption & { areaType: string; belowGround: boolean };
export type RoomTypeGroupOption = { label: string; options: RoomTypeOption[] };

/** Kodelistene fra kjernen, med norske etiketter (siden lager dem). */
export type Codes = {
  roomTypeGroups: RoomTypeGroupOption[];
  /** Ferdige sett til «Legg til flere rom». */
  roomPresets: RoomPresetOption[];
  /** Romtypene som vises som fliser i «Legg til flere rom». */
  commonRoomTypes: RoomType[];
  areaTypes: CodeOption[];
  methods: CodeOption[];
};

const FLOOR_NAMES_LIST = "floor-name-suggestions";

/** Areal med én desimal og komma, som «180,1». */
function formatArea(value: number): string {
  return value.toFixed(1).replace(".", ",");
}

function areaInputValue(value: number | null | undefined): string {
  return value == null ? "" : formatArea(value);
}

function labelOf(options: readonly CodeOption[], code: string | null): string {
  if (code === null) return "";
  return options.find((option) => option.value === code)?.label ?? code;
}

/** Kaller `onSaved` når siste forsøk ble lagret uten feil. */
function useOnSaved(state: FormState, onSaved: () => void) {
  const savedAttempt = state.attempt > 0 && state.message === null ? state.attempt : 0;
  useEffect(() => {
    if (savedAttempt > 0) onSaved();
  }, [savedAttempt, onSaved]);
}

/** Summen av BRA, med fordelingen når mer enn én arealtype er brukt. */
function SumLine({ label, sum }: { label: string; sum: AreaSum }) {
  const parts = [
    sum.braI > 0 && `BRA-i ${formatArea(sum.braI)}`,
    sum.braE > 0 && `BRA-e ${formatArea(sum.braE)}`,
    sum.braB > 0 && `BRA-b ${formatArea(sum.braB)}`,
  ].filter(Boolean);
  return (
    <p className="text-slate-900">
      <span className="font-medium">{label}:</span>{" "}
      <span className="tabular-nums">{formatArea(sum.bra)} m²</span>
      {parts.length > 1 && <span className="text-sm text-slate-600"> ({parts.join(", ")} m²)</span>}
    </p>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-t border-slate-200 py-2 first:border-t-0 first:pt-0">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="mt-0.5 break-words whitespace-pre-line text-slate-900">{children}</dd>
    </div>
  );
}

const EMPTY = <span className="text-slate-500">Ikke oppgitt</span>;

/**
 * «Legg til …»: knappen åpner skjemaet. Etter lagring lukkes det, og neste åpning starter med
 * tomme felt.
 */
function AddSection({
  label,
  children,
}: {
  label: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const close = useCallback(() => {
    setOpen(false);
    setFormKey((key) => key + 1);
  }, []);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }
  return (
    <div key={formKey} className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
      {children(close)}
    </div>
  );
}

/** «Fjern»: myk sletting uten egen dialog. Meldingen fra kjernen vises over knappen. */
function RemoveForm({ name, id, action }: { name: string; id: string; action: Action }) {
  const [state, formAction] = useActionState(action, initialFormState);
  return (
    <form action={formAction} className="space-y-3">
      <FormErrors state={state} />
      <input type="hidden" name={name} value={id} />
      <SubmitButton variant="secondary" size="md">
        Fjern
      </SubmitButton>
    </form>
  );
}

function FormButtons({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 pt-1">
      <SubmitButton size="md">Lagre</SubmitButton>
      <Button variant="ghost" onClick={onCancel}>
        Avbryt
      </Button>
    </div>
  );
}

/** Navnet på bygningen: til «Legg til bygning» og «Endre». */
function BuildingForm({
  idPrefix,
  assignmentId,
  buildingId,
  initialName,
  onDone,
}: {
  idPrefix: string;
  assignmentId: string;
  buildingId: string | null;
  initialName: string;
  onDone: () => void;
}) {
  const [state, formAction] = useActionState(saveBuildingAction, initialFormState);
  useOnSaved(state, onDone);
  return (
    <form action={formAction} noValidate className="space-y-4">
      <FormErrors state={state} />
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <input type="hidden" name="buildingId" value={buildingId ?? ""} />
      <Field label="Navn på bygningen" htmlFor={`${idPrefix}-name`} error={state.fieldErrors.name}>
        <Input
          id={`${idPrefix}-name`}
          name="name"
          maxLength={100}
          autoComplete="off"
          defaultValue={textValue(state, "name", initialName)}
        />
      </Field>
      <FormButtons onCancel={onDone} />
    </form>
  );
}

type FloorValues = { name: string; level: string; belowGround: boolean };

/**
 * Etasjen: navn (med forslag), etasjenummer og «Under terreng». Når navnet endres til et kjent
 * forslag («Kjeller», «Underetasje», «Loft»), fylles nummer og «Under terreng» ut (F7, A236).
 * Feltene kan endres etterpå; de overskrives bare når navnet endres igjen.
 */
function FloorForm({
  idPrefix,
  buildingId,
  floorId,
  initial,
  existingLevels,
  onDone,
}: {
  idPrefix: string;
  buildingId: string;
  floorId: string | null;
  initial: FloorValues;
  /** Numrene på de andre etasjene i bygningen (ikke slettet, uten denne etasjen). */
  existingLevels: readonly number[];
  onDone: () => void;
}) {
  const [state, formAction] = useActionState(saveFloorAction, initialFormState);
  useOnSaved(state, onDone);
  const levelRef = useRef<HTMLInputElement>(null);
  const belowGroundRef = useRef<HTMLInputElement>(null);

  function onNameChange(name: string) {
    const suggestion = suggestFloor(name, existingLevels);
    if (!suggestion) return;
    if (levelRef.current) levelRef.current.value = String(suggestion.level);
    if (belowGroundRef.current) belowGroundRef.current.checked = suggestion.belowGround;
  }

  const belowGround =
    state.message !== null ? state.values.belowGround === "on" : initial.belowGround;
  return (
    <form action={formAction} noValidate className="space-y-4">
      <FormErrors state={state} />
      <input type="hidden" name="buildingId" value={buildingId} />
      <input type="hidden" name="floorId" value={floorId ?? ""} />
      <Field
        label="Etasje"
        htmlFor={`${idPrefix}-name`}
        hint="Velg et forslag eller skriv selv."
        error={state.fieldErrors.name}
      >
        <Input
          id={`${idPrefix}-name`}
          name="name"
          list={FLOOR_NAMES_LIST}
          maxLength={50}
          autoComplete="off"
          defaultValue={textValue(state, "name", initial.name)}
          onChange={(event) => onNameChange(event.target.value)}
        />
      </Field>
      <Field
        label="Etasjenummer"
        htmlFor={`${idPrefix}-level`}
        hint="Fra −3 til 20. Kjeller er −1, første etasje er 1."
        error={state.fieldErrors.level}
      >
        <Input
          id={`${idPrefix}-level`}
          name="level"
          type="number"
          inputMode="numeric"
          min={-3}
          max={20}
          step={1}
          className="max-w-32"
          ref={levelRef}
          defaultValue={textValue(state, "level", initial.level)}
        />
      </Field>
      <Checkbox
        key={`${state.attempt}`}
        name="belowGround"
        label="Under terreng"
        ref={belowGroundRef}
        defaultChecked={belowGround}
      />
      <FormButtons onCancel={onDone} />
    </form>
  );
}

type RoomValues = { roomType: string; name: string; areaType: string; belowGround: boolean };

/**
 * Rommet: romtype (gruppert), navn, arealtype og «Under terreng». Når romtypen velges, settes
 * arealtype og «Under terreng» til forslaget (A97); begge kan endres før lagring.
 */
function RoomForm({
  idPrefix,
  floorId,
  roomId,
  floorBelowGround,
  initial,
  codes,
  onDone,
}: {
  idPrefix: string;
  floorId: string;
  roomId: string | null;
  floorBelowGround: boolean;
  initial: RoomValues;
  codes: Codes;
  onDone: () => void;
}) {
  const [state, formAction] = useActionState(saveRoomAction, initialFormState);
  useOnSaved(state, onDone);
  const [areaType, setAreaType] = useState(initial.areaType);
  const [belowGround, setBelowGround] = useState(initial.belowGround);
  const [lastAttempt, setLastAttempt] = useState(state.attempt);

  // React tilbakestiller skjemaet etter hvert forsøk. Ved feil settes arealtype og «Under terreng»
  // til det som ble sendt, og listene og avkrysningen får ny nøkkel, slik at valgene står igjen.
  if (state.attempt !== lastAttempt) {
    setLastAttempt(state.attempt);
    if (state.message !== null) {
      setAreaType(textValue(state, "areaType", areaType));
      setBelowGround(state.values.belowGround === "on");
    }
  }

  function onRoomTypeChange(value: string) {
    for (const group of codes.roomTypeGroups) {
      const option = group.options.find((type) => type.value === value);
      if (option) {
        setAreaType(option.areaType);
        setBelowGround(floorBelowGround || option.belowGround);
        return;
      }
    }
  }

  return (
    <form action={formAction} noValidate className="space-y-4">
      <FormErrors state={state} />
      <input type="hidden" name="floorId" value={floorId} />
      <input type="hidden" name="roomId" value={roomId ?? ""} />
      <Field label="Romtype" htmlFor={`${idPrefix}-roomType`} error={state.fieldErrors.roomType}>
        <Select
          key={state.attempt}
          id={`${idPrefix}-roomType`}
          name="roomType"
          defaultValue={textValue(state, "roomType", initial.roomType)}
          onChange={(event) => onRoomTypeChange(event.target.value)}
        >
          <option value="">Velg romtype</option>
          {codes.roomTypeGroups.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </Field>
      <Field
        label="Navn på rommet"
        htmlFor={`${idPrefix}-name`}
        hint="Valgfritt. Tomt gir navnet på romtypen."
        error={state.fieldErrors.name}
      >
        <Input
          id={`${idPrefix}-name`}
          name="name"
          maxLength={100}
          autoComplete="off"
          defaultValue={textValue(state, "name", initial.name)}
        />
      </Field>
      <Field label="Arealtype" htmlFor={`${idPrefix}-areaType`} error={state.fieldErrors.areaType}>
        <Select
          key={state.attempt}
          id={`${idPrefix}-areaType`}
          name="areaType"
          value={areaType}
          onChange={(event) => setAreaType(event.target.value)}
        >
          {codes.areaTypes.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
      <Checkbox
        key={state.attempt}
        name="belowGround"
        label="Under terreng"
        checked={belowGround}
        onChange={(event) => setBelowGround(event.target.checked)}
      />
      <FormButtons onCancel={onDone} />
    </form>
  );
}

const AREA_FIELDS = [
  { name: "braI", label: "BRA-i" },
  { name: "braE", label: "BRA-e" },
  { name: "braB", label: "BRA-b" },
  { name: "alh", label: "ALH" },
] as const;

/** Arealet i én etasje: fire tall, «Målt av» (forhåndsvalgt), metode og kommentar. */
function FloorAreaForm({
  floorId,
  area,
  employees,
  currentEmployeeId,
  codes,
}: {
  floorId: string;
  area: FloorAreaDetail | null;
  employees: EmployeeOption[];
  currentEmployeeId: string;
  codes: Codes;
}) {
  const [state, formAction] = useActionState(saveFloorAreaAction, initialFormState);
  const idPrefix = `area-${floorId}`;
  // En tidligere måler som har sluttet, står fortsatt som valg.
  const measurers =
    area?.measuredBy && !employees.some((employee) => employee.id === area.measuredBy)
      ? [
          ...employees,
          { id: area.measuredBy, name: `${area.measuredByName ?? "Ukjent"} (har sluttet)` },
        ]
      : employees;

  return (
    <form action={formAction} noValidate className="space-y-4">
      <FormErrors state={state} />
      <input type="hidden" name="floorId" value={floorId} />
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {AREA_FIELDS.map((field) => (
          <Field
            key={field.name}
            label={field.label}
            htmlFor={`${idPrefix}-${field.name}`}
            error={state.fieldErrors[field.name]}
          >
            <Input
              id={`${idPrefix}-${field.name}`}
              name={field.name}
              inputMode="decimal"
              autoComplete="off"
              defaultValue={textValue(state, field.name, areaInputValue(area?.[field.name]))}
            />
          </Field>
        ))}
      </div>
      <p className="text-sm text-slate-600">
        Areal i m² med høyst én desimal. BRA er summen av BRA-i, BRA-e og BRA-b; ALH tas ikke med.
      </p>
      {/* Ny nøkkel på listene etter hvert forsøk: React tilbakestiller skjemaet, og listene tar
          ellers ikke valget fra forrige forsøk. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Field
          label="Målt av"
          htmlFor={`${idPrefix}-measuredBy`}
          error={state.fieldErrors.measuredBy}
        >
          <Select
            key={state.attempt}
            id={`${idPrefix}-measuredBy`}
            name="measuredBy"
            defaultValue={textValue(state, "measuredBy", area?.measuredBy ?? currentEmployeeId)}
          >
            {measurers.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Metode" htmlFor={`${idPrefix}-method`} error={state.fieldErrors.method}>
          <Select
            key={state.attempt}
            id={`${idPrefix}-method`}
            name="method"
            defaultValue={textValue(state, "method", area?.method ?? "")}
          >
            <option value="">Velg metode</option>
            {codes.methods.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field
        label="Kommentar"
        htmlFor={`${idPrefix}-comment`}
        hint="For eksempel hva som var vanskelig å måle."
        error={state.fieldErrors.comment}
      >
        <Textarea
          id={`${idPrefix}-comment`}
          name="comment"
          maxLength={1000}
          className="min-h-20"
          defaultValue={textValue(state, "comment", area?.comment ?? "")}
        />
      </Field>
      <SubmitButton size="md">Lagre areal</SubmitButton>
    </form>
  );
}

/** Arealet som tekst, for den som ikke kan endre. */
function FloorAreaDetails({ area, codes }: { area: FloorAreaDetail | null; codes: Codes }) {
  if (!area) return <p className="text-slate-600">Arealet er ikke ført ennå.</p>;
  return (
    <dl className="grid gap-x-6 sm:grid-cols-2">
      {AREA_FIELDS.map((field) => {
        const value = area[field.name];
        return (
          <Detail key={field.name} label={field.label}>
            {value == null ? EMPTY : <span className="tabular-nums">{formatArea(value)} m²</span>}
          </Detail>
        );
      })}
      <Detail label="Målt av">{area.measuredByName ?? EMPTY}</Detail>
      <Detail label="Metode">{area.method ? labelOf(codes.methods, area.method) : EMPTY}</Detail>
      <Detail label="Kommentar">{area.comment ?? EMPTY}</Detail>
    </dl>
  );
}

function roomTypeText(codes: Codes, roomType: string): string {
  for (const group of codes.roomTypeGroups) {
    const option = group.options.find((type) => type.value === roomType);
    if (option) return option.label;
  }
  return roomType;
}

function RoomItem({
  room,
  floor,
  canEdit,
  codes,
}: {
  room: RoomDetail;
  floor: FloorDetail;
  canEdit: boolean;
  codes: Codes;
}) {
  const [editing, setEditing] = useState(false);
  const close = useCallback(() => setEditing(false), []);
  const typeText = roomTypeText(codes, room.roomType);
  const title = room.name ?? typeText;

  return (
    <li aria-label={title} className="border-t border-slate-200 py-3 first:border-t-0">
      {editing ? (
        <RoomForm
          idPrefix={`room-${room.id}`}
          floorId={floor.id}
          roomId={room.id}
          floorBelowGround={floor.belowGround}
          initial={{
            roomType: room.roomType,
            name: room.name ?? "",
            areaType: room.areaType,
            belowGround: room.belowGround,
          }}
          codes={codes}
          onDone={close}
        />
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium break-words text-slate-900">{title}</p>
            <p className="text-sm text-slate-600">
              {[
                room.name ? typeText : null,
                labelOf(codes.areaTypes, room.areaType),
                room.belowGround ? "Under terreng" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          {canEdit && (
            <div className="flex flex-wrap items-start gap-3">
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Endre
              </Button>
              <RemoveForm name="roomId" id={room.id} action={removeRoomAction} />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function FloorBlock({
  floor,
  buildingId,
  otherLevels,
  data,
  canEdit,
  codes,
  onAddRooms,
}: {
  floor: FloorDetail;
  buildingId: string;
  /** Numrene på de andre etasjene i bygningen, til forslaget for «Loft». */
  otherLevels: readonly number[];
  data: AssignmentBuildings;
  canEdit: boolean;
  codes: Codes;
  /** Åpner dialogen «Legg til flere rom» for etasjen. */
  onAddRooms: (floor: FloorDetail) => void;
}) {
  const [editing, setEditing] = useState(false);
  const close = useCallback(() => setEditing(false), []);
  const headingId = `floor-${floor.id}-heading`;

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-4 border-t border-slate-200 pt-5 first:border-t-0 first:pt-0"
    >
      {editing ? (
        <>
          <h3 id={headingId} className="text-lg font-medium text-slate-900">
            Endre etasjen
          </h3>
          <FloorForm
            idPrefix={`floor-${floor.id}`}
            buildingId={buildingId}
            floorId={floor.id}
            initial={{
              name: floor.name,
              level: String(floor.level),
              belowGround: floor.belowGround,
            }}
            existingLevels={otherLevels}
            onDone={close}
          />
        </>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id={headingId} className="text-lg font-medium break-words text-slate-900">
              {floor.name}
            </h3>
            <p className="text-sm text-slate-600">
              Etasjenummer {floor.level}
              {floor.belowGround && " · Under terreng"}
            </p>
          </div>
          {canEdit && (
            <div className="flex flex-wrap items-start gap-3">
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Endre
              </Button>
              <RemoveForm name="floorId" id={floor.id} action={removeFloorAction} />
            </div>
          )}
        </div>
      )}

      <SumLine label="Sum BRA i etasjen" sum={floor.sum} />

      <div>
        <h4 className="mb-2 font-medium text-slate-900">Areal</h4>
        {canEdit ? (
          <FloorAreaForm
            key={JSON.stringify(floor.area)}
            floorId={floor.id}
            area={floor.area}
            employees={data.employees}
            currentEmployeeId={data.currentEmployeeId}
            codes={codes}
          />
        ) : (
          <FloorAreaDetails area={floor.area} codes={codes} />
        )}
      </div>

      <div>
        <h4 className="mb-2 font-medium text-slate-900">Rom</h4>
        {floor.rooms.length === 0 ? (
          <p className="mb-3 text-slate-600">Ingen rom er lagt inn ennå.</p>
        ) : (
          <ul className="mb-3">
            {floor.rooms.map((room) => (
              <RoomItem key={room.id} room={room} floor={floor} canEdit={canEdit} codes={codes} />
            ))}
          </ul>
        )}
        {canEdit && (
          <div className="space-y-3">
            <AddSection label="Legg til rom">
              {(close) => (
                <RoomForm
                  idPrefix={`new-room-${floor.id}`}
                  floorId={floor.id}
                  roomId={null}
                  floorBelowGround={floor.belowGround}
                  initial={{
                    roomType: "",
                    name: "",
                    areaType: "bra_i",
                    belowGround: floor.belowGround,
                  }}
                  codes={codes}
                  onDone={close}
                />
              )}
            </AddSection>
            <Button
              variant="secondary"
              data-testid="add-rooms-open"
              onClick={() => onAddRooms(floor)}
            >
              Legg til flere rom
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

/** Etasjen som dialogen «Legg til flere rom» er åpen for, med de aktive rommene. */
function findFloor(data: AssignmentBuildings, floorId: string | null): AddRoomsFloor | null {
  if (floorId === null) return null;
  for (const building of data.buildings) {
    const floor = building.floors.find((candidate) => candidate.id === floorId);
    if (floor) return floor;
  }
  return null;
}

/** Forslag til etasjenummer for en ny etasje: én over den høyeste, eller 1. */
function nextLevel(building: BuildingDetail): string {
  if (building.floors.length === 0) return "1";
  const highest = Math.max(...building.floors.map((floor) => floor.level));
  return String(Math.min(20, highest + 1));
}

function BuildingCard({
  building,
  assignmentId,
  data,
  canEdit,
  codes,
  onAddRooms,
}: {
  building: BuildingDetail;
  assignmentId: string;
  data: AssignmentBuildings;
  canEdit: boolean;
  codes: Codes;
  onAddRooms: (floor: FloorDetail) => void;
}) {
  const [editing, setEditing] = useState(false);
  const close = useCallback(() => setEditing(false), []);
  const headingId = `building-${building.id}-heading`;

  return (
    <section aria-labelledby={headingId}>
      <Card className="space-y-5">
        {editing ? (
          <>
            <h2 id={headingId} className="text-xl font-semibold text-slate-900">
              Endre bygningen
            </h2>
            <BuildingForm
              idPrefix={`building-${building.id}`}
              assignmentId={assignmentId}
              buildingId={building.id}
              initialName={building.name}
              onDone={close}
            />
          </>
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 id={headingId} className="text-xl font-semibold break-words text-slate-900">
              {building.name}
            </h2>
            {canEdit && (
              <div className="flex flex-wrap items-start gap-3">
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  Endre
                </Button>
                <RemoveForm name="buildingId" id={building.id} action={removeBuildingAction} />
              </div>
            )}
          </div>
        )}

        <SumLine label="Sum BRA i bygningen" sum={building.sum} />

        {building.floors.length === 0 ? (
          <p className="text-slate-600">Ingen etasjer er lagt inn ennå.</p>
        ) : (
          <div className="space-y-5">
            {building.floors.map((floor) => (
              <FloorBlock
                key={floor.id}
                floor={floor}
                buildingId={building.id}
                otherLevels={building.floors
                  .filter((other) => other.id !== floor.id)
                  .map((other) => other.level)}
                data={data}
                canEdit={canEdit}
                codes={codes}
                onAddRooms={onAddRooms}
              />
            ))}
          </div>
        )}

        {canEdit && (
          <div className="border-t border-slate-200 pt-5">
            <AddSection label="Legg til etasje">
              {(close) => (
                <FloorForm
                  idPrefix={`new-floor-${building.id}`}
                  buildingId={building.id}
                  floorId={null}
                  initial={{ name: "", level: nextLevel(building), belowGround: false }}
                  existingLevels={building.floors.map((floor) => floor.level)}
                  onDone={close}
                />
              )}
            </AddSection>
          </div>
        )}
      </Card>
    </section>
  );
}

/**
 * Bygningene på oppdraget med etasjer, areal og rom. Med `canEdit` kan alt legges til, endres og
 * fjernes; ellers står alt som tekst. Selve tilgangssjekken skjer i kjernen.
 */
export function BuildingsEditor({
  assignmentId,
  data,
  canEdit,
  codes,
}: {
  assignmentId: string;
  data: AssignmentBuildings;
  canEdit: boolean;
  codes: Codes;
}) {
  // Én dialog for hele siden (T-0058): id-en til etasjen som er åpen, og en teller per åpning.
  const [addRooms, setAddRooms] = useState<{ floorId: string; session: number } | null>(null);
  const openAddRooms = useCallback(
    (floor: FloorDetail) =>
      setAddRooms((current) => ({ floorId: floor.id, session: (current?.session ?? 0) + 1 })),
    [],
  );
  const closeAddRooms = useCallback(() => setAddRooms((current) => (current ? null : current)), []);
  const addRoomsFloor = findFloor(data, addRooms?.floorId ?? null);

  return (
    <div className="space-y-6">
      <datalist id={FLOOR_NAMES_LIST}>
        {FLOOR_NAME_SUGGESTIONS.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      {!data.hasProperty && (
        <p className="rounded-xl bg-watch-fill px-4 py-3 text-watch-text">
          Legg inn eiendommen først.
        </p>
      )}

      {data.buildings.length === 0 ? (
        <p className="text-slate-600">Ingen bygninger er lagt inn ennå.</p>
      ) : (
        data.buildings.map((building) => (
          <BuildingCard
            key={building.id}
            building={building}
            assignmentId={assignmentId}
            data={data}
            canEdit={canEdit}
            codes={codes}
            onAddRooms={openAddRooms}
          />
        ))
      )}

      {canEdit && (
        <AddRoomsDialog
          floor={addRoomsFloor}
          session={addRooms?.session ?? 0}
          housingType={data.housingType}
          presets={codes.roomPresets}
          commonRoomTypes={codes.commonRoomTypes}
          onClose={closeAddRooms}
        />
      )}

      {canEdit && data.hasProperty && (
        <AddSection label="Legg til bygning">
          {(close) => (
            <BuildingForm
              idPrefix="new-building"
              assignmentId={assignmentId}
              buildingId={null}
              initialName=""
              onDone={close}
            />
          )}
        </AddSection>
      )}

      {data.buildings.length > 0 && (
        <Card>
          <SumLine label="Sum BRA totalt" sum={data.sum} />
        </Card>
      )}
    </div>
  );
}
