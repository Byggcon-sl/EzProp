"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type SyntheticEvent,
} from "react";
import type { RoomDraft, RoomPresetKey } from "@/core/buildings";
import {
  ROOM_TYPE_GROUPS,
  ROOM_TYPES,
  roomTypeGroupLabel,
  roomTypeLabel,
  type RoomType,
} from "@/core/buildings/codes";
import { numberRoomDrafts, suggestRoomPreset } from "@/core/buildings/room-presets";
import type { HousingType } from "@/core/properties/codes";
import { cn } from "@/shared/lib/cn";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { FormMessage } from "@/shared/ui/form";
import { FIX_FIELDS, initialFormState } from "../../../form-state";
import { addRoomsAction } from "./actions";

/** Høyeste antall per romtype i dialogen (A272). 40 totalt sjekkes av serveren. */
export const MAX_PER_ROOM_TYPE = 20;

/** Et ferdig sett slik siden sender det (nøkkel, norsk navn og romutkastene). */
export type RoomPresetOption = {
  key: RoomPresetKey;
  label: string;
  drafts: readonly RoomDraft[];
};

/** Etasjen dialogen er åpnet for, med de aktive rommene (til «allerede N rom» og nummereringen). */
export type AddRoomsFloor = {
  id: string;
  name: string;
  level: number;
  belowGround: boolean;
  rooms: readonly { roomType: string; name: string | null }[];
};

type Source = "manual" | "preset";

/** Ny liste der romtypen har `count`. 0 fjerner den; ny romtype legges sist. */
function setCount(drafts: readonly RoomDraft[], roomType: RoomType, count: number): RoomDraft[] {
  const next = Math.max(0, Math.min(MAX_PER_ROOM_TYPE, count));
  const exists = drafts.some((draft) => draft.roomType === roomType);
  if (!exists) return next > 0 ? [...drafts, { roomType, count: next }] : [...drafts];
  return drafts
    .map((draft) => (draft.roomType === roomType ? { roomType, count: next } : draft))
    .filter((draft) => draft.count > 0);
}

/** Meldingene fra serveren: meldingen øverst og feilene per felt (uten «Rett feltene …»). */
function errorMessages(message: string | null, fieldErrors: Record<string, string>): string[] {
  const all = [message === FIX_FIELDS ? null : message, ...Object.values(fieldErrors)];
  return [...new Set(all.filter((text): text is string => Boolean(text)))];
}

/** Flis for én romtype: trykk gir +1, egen «–»-knapp gir −1. */
function RoomTile({
  roomType,
  count,
  onChange,
}: {
  roomType: RoomType;
  count: number;
  onChange: (roomType: RoomType, count: number) => void;
}) {
  const label = roomTypeLabel(roomType);
  return (
    <li className="flex min-w-0 items-stretch gap-2">
      <button
        type="button"
        aria-label={label}
        data-testid={`tile-${roomType}`}
        disabled={count >= MAX_PER_ROOM_TYPE}
        onClick={() => onChange(roomType, count + 1)}
        className={cn(
          "flex min-h-14 min-w-0 flex-1 items-center justify-between gap-2 rounded-xl px-3 py-2 text-left ring-1 ring-inset transition-colors",
          count > 0
            ? "bg-brand-50 text-slate-900 ring-brand-600"
            : "bg-white text-slate-900 ring-slate-300 hover:bg-slate-50",
          "disabled:text-slate-600",
        )}
      >
        <span className="min-w-0 font-medium break-words">{label}</span>
        <span
          data-testid={`tile-count-${roomType}`}
          className={cn(
            "text-2xl font-semibold tabular-nums",
            count > 0 ? "text-slate-900" : "text-slate-500",
          )}
        >
          {count}
        </span>
      </button>
      <button
        type="button"
        aria-label={`Færre ${label.toLowerCase()}`}
        data-testid={`tile-minus-${roomType}`}
        disabled={count === 0}
        onClick={() => onChange(roomType, count - 1)}
        className="min-h-11 min-w-11 shrink-0 self-center rounded-full text-2xl leading-none font-semibold text-slate-900 ring-1 ring-slate-700 ring-inset hover:bg-slate-100 disabled:text-slate-400 disabled:ring-slate-300"
      >
        <span aria-hidden="true">–</span>
      </button>
    </li>
  );
}

/**
 * Innholdet i dialogen for én åpning. Nøkkelen på komponenten byttes ved hver åpning, så
 * tellerne alltid starter på 0. Romutkastene (`RoomDraft[]`) er den ene listen som settene og
 * tellerne fyller; KI-forslaget fra plantegning (2a-3) skal kunne fylle samme liste.
 */
function AddRoomsForm({
  floor,
  housingType,
  presets,
  commonRoomTypes,
  onClose,
  registerCancel,
}: {
  floor: AddRoomsFloor;
  housingType: HousingType | null;
  presets: readonly RoomPresetOption[];
  commonRoomTypes: readonly RoomType[];
  onClose: () => void;
  registerCancel: (handler: () => void) => void;
}) {
  const [state, formAction, pending] = useActionState(addRoomsAction, initialFormState);
  const [drafts, setDrafts] = useState<RoomDraft[]>([]);
  const [source, setSource] = useState<Source>("manual");
  const [presetKey, setPresetKey] = useState<RoomPresetKey | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const submitting = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const moreId = useId();

  const total = drafts.reduce((sum, draft) => sum + draft.count, 0);
  const counts = new Map(drafts.map((draft) => [draft.roomType, draft.count]));
  const suggested = suggestRoomPreset({
    housingType,
    floorLevel: floor.level,
    floorBelowGround: floor.belowGround,
  });
  const orderedPresets = [
    ...presets.filter((preset) => preset.key === suggested),
    ...presets.filter((preset) => preset.key !== suggested),
  ];
  const common = new Set<string>(commonRoomTypes);
  const moreGroups = ROOM_TYPE_GROUPS.map((group) => ({
    group,
    types: ROOM_TYPES.filter((type) => type.group === group && !common.has(type.key)).map(
      (type) => type.key as RoomType,
    ),
  })).filter((entry) => entry.types.length > 0);
  const preview = numberRoomDrafts(
    drafts,
    floor.rooms.map((room) => ({ roomType: room.roomType, name: room.name ?? "" })),
  ).map((room) => room.name || roomTypeLabel(room.roomType));

  // Svar fra serveren: ved lagring lukkes dialogen; ved feil står tellerne igjen og meldingen får
  // fokus. Sperren mot dobbel lagring slippes når svaret er kommet.
  useEffect(() => {
    if (!pending) submitting.current = false;
  }, [pending, state.attempt]);
  const savedAttempt = state.attempt > 0 && state.message === null ? state.attempt : 0;
  useEffect(() => {
    if (savedAttempt > 0) onClose();
  }, [savedAttempt, onClose]);
  const errors = errorMessages(state.message, state.fieldErrors);
  useEffect(() => {
    if (state.attempt > 0 && state.message !== null) errorRef.current?.focus();
  }, [state.attempt, state.message]);

  // Esc, «Avbryt» og X: med tellere over 0 spørres det først.
  function requestClose() {
    if (total > 0) setConfirmDiscard(true);
    else onClose();
  }
  const requestCloseRef = useRef(requestClose);
  useEffect(() => {
    requestCloseRef.current = requestClose;
  });
  useEffect(() => {
    registerCancel(() => requestCloseRef.current());
  }, [registerCancel]);
  useEffect(() => {
    if (confirmDiscard) continueRef.current?.focus();
  }, [confirmDiscard]);

  function changeCount(roomType: RoomType, count: number) {
    setDrafts((current) => setCount(current, roomType, count));
    // Etter et sett forblir kilden «preset» (kortet: rettede tellere er fortsatt settet).
    if (presetKey === null) setSource("manual");
  }

  function choosePreset(preset: RoomPresetOption) {
    setDrafts(preset.drafts.map((draft) => ({ roomType: draft.roomType, count: draft.count })));
    setSource("preset");
    setPresetKey(preset.key);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (submitting.current || pending || total === 0) {
      event.preventDefault();
      return;
    }
    submitting.current = true;
  }

  return (
    <form
      action={formAction}
      onSubmit={onSubmit}
      noValidate
      className="flex max-h-[calc(100dvh-2rem)] min-h-0 flex-col"
    >
      <input type="hidden" name="floorId" value={floor.id} />
      <input type="hidden" name="source" value={source} />
      <input type="hidden" name="presetKey" value={source === "preset" ? (presetKey ?? "") : ""} />
      <input type="hidden" name="drafts" value={JSON.stringify(drafts)} />

      <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 pt-5 pb-4">
        <div className="min-w-0">
          <h2 id="add-rooms-title" className="text-sm font-medium text-slate-600">
            Legg til flere rom
          </h2>
          <p
            data-testid="add-rooms-floor"
            className="text-xl font-semibold break-words text-slate-900"
          >
            {floor.name}
          </p>
          {floor.rooms.length > 0 && (
            <p data-testid="add-rooms-existing" className="mt-1 text-sm text-slate-600">
              Etasjen har allerede {floor.rooms.length} rom
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label="Lukk"
          onClick={requestClose}
          className="min-h-11 min-w-11 shrink-0 rounded-full text-2xl leading-none text-slate-900 hover:bg-slate-100"
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-x-hidden overflow-y-auto px-5 py-4">
        {errors.length > 0 && (
          <div ref={errorRef} tabIndex={-1} className="space-y-2">
            {errors.map((text) => (
              <FormMessage key={text} message={text} />
            ))}
          </div>
        )}

        <div>
          <h3 id="add-rooms-presets" className="mb-2 font-semibold text-slate-900">
            Ferdige sett
          </h3>
          <ul className="flex flex-wrap gap-2">
            {orderedPresets.map((preset) => {
              const chosen = source === "preset" && presetKey === preset.key;
              return (
                <li key={preset.key}>
                  <button
                    type="button"
                    data-testid={`preset-${preset.key}`}
                    aria-pressed={chosen}
                    onClick={() => choosePreset(preset)}
                    className={cn(
                      "inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-left font-semibold ring-1 ring-inset",
                      chosen
                        ? "bg-night text-white ring-night"
                        : "bg-transparent text-slate-900 ring-slate-700 hover:bg-slate-100",
                    )}
                  >
                    {preset.label}
                    {preset.key === suggested && <Badge tone="brand">Foreslått</Badge>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <h3 id="add-rooms-common" className="mb-2 font-semibold text-slate-900">
            Vanlige rom
          </h3>
          <ul className="grid gap-3 sm:grid-cols-2">
            {commonRoomTypes.map((roomType) => (
              <RoomTile
                key={roomType}
                roomType={roomType}
                count={counts.get(roomType) ?? 0}
                onChange={changeCount}
              />
            ))}
          </ul>
        </div>

        <div>
          <Button
            variant="secondary"
            data-testid="add-rooms-more"
            aria-expanded={showMore}
            aria-controls={moreId}
            onClick={() => setShowMore((open) => !open)}
          >
            {showMore ? "Færre romtyper" : "Flere romtyper"}
          </Button>
          <div id={moreId} hidden={!showMore} className="mt-4 space-y-4">
            {showMore &&
              moreGroups.map(({ group, types }) => (
                <div key={group}>
                  <h4
                    id={`add-rooms-group-${group}`}
                    className="mb-2 text-sm font-semibold text-slate-700"
                  >
                    {roomTypeGroupLabel(group)}
                  </h4>
                  <ul className="grid gap-3 sm:grid-cols-2">
                    {types.map((roomType) => (
                      <RoomTile
                        key={roomType}
                        roomType={roomType}
                        count={counts.get(roomType) ?? 0}
                        onChange={changeCount}
                      />
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        </div>

        <div>
          <h3 id="add-rooms-preview-title" className="mb-1 font-semibold text-slate-900">
            Rommene som blir lagt til
          </h3>
          <p data-testid="add-rooms-preview" className="break-words text-slate-700">
            {preview.length > 0 ? preview.join(", ") : "Ingen rom er valgt ennå."}
          </p>
        </div>
      </div>

      <footer className="border-t border-slate-200 bg-white px-5 py-4">
        {confirmDiscard ? (
          <div
            role="group"
            aria-labelledby="add-rooms-discard"
            className="flex flex-wrap items-center gap-3"
          >
            <p id="add-rooms-discard" className="mr-auto font-semibold text-slate-900">
              Forkaste {total} rom?
            </p>
            <Button variant="secondary" onClick={onClose}>
              Forkast
            </Button>
            <Button ref={continueRef} onClick={() => setConfirmDiscard(false)}>
              Fortsett
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={requestClose}>
              Avbryt
            </Button>
            <Button
              type="submit"
              size="lg"
              data-testid="add-rooms-submit"
              disabled={total === 0 || pending}
              aria-busy={pending}
              className="min-w-0 flex-1"
            >
              {pending ? "Lagrer …" : `Legg til ${total} rom i ${floor.name}`}
            </Button>
          </div>
        )}
      </footer>
    </form>
  );
}

/**
 * Dialogen «Legg til flere rom». Én instans for hele siden (T-0058), styrt av hvilken etasje som
 * er åpen (`floor`). Native `<dialog>` med `showModal`, så fokus holdes i dialogen og går tilbake
 * til knappen som åpnet den. Ingen tilgangslogikk her: kjernen sjekker rettigheten.
 */
export function AddRoomsDialog({
  floor,
  session,
  housingType,
  presets,
  commonRoomTypes,
  onClose,
}: {
  floor: AddRoomsFloor | null;
  /** Økes ved hver åpning, så tellerne starter på 0. */
  session: number;
  housingType: HousingType | null;
  presets: readonly RoomPresetOption[];
  commonRoomTypes: readonly RoomType[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelHandler = useRef<() => void>(() => onClose());
  const registerCancel = useCallback((handler: () => void) => {
    cancelHandler.current = handler;
  }, []);
  const open = floor !== null;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Esc: dialogen lukkes ikke av nettleseren; spørsmålet om å forkaste avgjør.
  function onCancel(event: SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    cancelHandler.current();
  }

  // Lukket av nettleseren likevel (for eksempel Esc to ganger): siden følger etter.
  function onDialogClose() {
    if (open) onClose();
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="add-rooms-title"
      data-testid="add-rooms-dialog"
      onCancel={onCancel}
      onClose={onDialogClose}
      className="m-auto w-[min(42rem,calc(100vw-2rem))] max-w-none overflow-hidden rounded-xl bg-white p-0 text-slate-900 shadow-xl backdrop:bg-night/40"
    >
      {floor && (
        <AddRoomsForm
          key={`${floor.id}-${session}`}
          floor={floor}
          housingType={housingType}
          presets={presets}
          commonRoomTypes={commonRoomTypes}
          onClose={onClose}
          registerCancel={registerCancel}
        />
      )}
    </dialog>
  );
}
