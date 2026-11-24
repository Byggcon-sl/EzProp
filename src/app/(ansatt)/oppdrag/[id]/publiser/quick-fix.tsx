"use client";

import { useEffect, useRef, useState } from "react";
import { COST_BAND_LABELS, COST_BANDS, type CostBandKey } from "@/core/reports/logic";
import type { PublishFindingView } from "@/core/reports/publish-types";
import type { ReportFieldChange, RoomRef } from "@/core/reports/types";
import { uuidv7 } from "@/shared/lib/uuid";
import { ChoiceButtons, choiceButtonId } from "@/shared/ui/choice-buttons";
import { FormMessage } from "@/shared/ui/form";
import { tgBadgeFullText } from "@/shared/ui/tg-badge";
import { saveFieldAction, setTgDirectAction } from "../rom/[roomId]/actions";
import { isActionError } from "../rom/[roomId]/room-messages";
import { holeFixContextAction, type HoleFixContext } from "./actions";
import { costText, deviationName, type QuickFixKind } from "./publish-model";
import { PUBLISH_TEXTS } from "./publish-texts";

/*
 * «Rett nå» i linjen (F2, docs/funksjoner/fase2a-publisering-badet-design.md avsnitt 7). Åpnes på
 * samme flate som sperren, ingen dialog. Hvert valg lagres straks med de samme serverhandlingene
 * som rommet (`saveFieldAction`, `setTgDirectAction`), og serveren sjekker tilgangen og at
 * rapporten ikke er publisert. Ingen TG er forhåndsvalgt, og KI foreslår aldri noe her.
 * Hulltaking «Annet» krever en forklaring i tekst: den skrives på rommet («Gå til»).
 * Støtter hovedmål: de ansatte (det opplagte rettes uten sideskifte) og færre reklamasjoner.
 */

export type QuickFixResult =
  { kind: "saved"; fixedText: string } | { kind: "conflict" } | { kind: "failed"; message: string };

type Props = {
  baseId: string;
  assignmentId: string;
  item: PublishFindingView;
  fix: QuickFixKind;
  /** Teller endringer på vei til serveren (nedre linje: «Venter på synk»). */
  track: <T>(call: () => Promise<T>) => Promise<T>;
  /** Etter hver lagring: siden henter listen på nytt. */
  onResult: (result: QuickFixResult) => void;
};

const NONE_COST = { type: "none", bandKey: null, amount: null } as const;

export function quickFixFirstId(baseId: string): string {
  return choiceButtonId(`${baseId}-fix`, 0);
}

export function QuickFix(props: Props) {
  switch (props.fix.kind) {
    case "hole_drilling":
      return <HoleDrillingFix {...props} roomId={props.fix.roomId} />;
    case "cost":
      return <CostFix {...props} roomId={props.fix.roomId} deviationId={props.fix.deviationId} />;
    case "checkpoint_tg":
      return (
        <CheckpointTgFix
          {...props}
          roomId={props.fix.roomId}
          checkpointKey={props.fix.checkpointKey}
        />
      );
    case "deviation_tg":
      return (
        <DeviationTgFix {...props} roomId={props.fix.roomId} deviationId={props.fix.deviationId} />
      );
  }
}

/** Fokus til første valg når «Rett nå» åpnes (design avsnitt 17). */
function useFocusFirst(baseId: string, ready: boolean) {
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    document.getElementById(quickFixFirstId(baseId))?.focus();
  }, [baseId, ready]);
}

/** Lagrer én endring og sier hvordan det gikk. */
async function saveChange(
  props: Props,
  room: RoomRef,
  change: ReportFieldChange,
  fixedText: string,
): Promise<QuickFixResult> {
  try {
    const result = await props.track(() => saveFieldAction(room, change));
    if (isActionError(result)) return { kind: "failed", message: result.message };
    if (result.status === "conflict") return { kind: "conflict" };
    return { kind: "saved", fixedText };
  } catch {
    return { kind: "failed", message: PUBLISH_TEXTS.saveFailed };
  }
}

function Saving({ saving, error }: { saving: boolean; error: string | null }) {
  return (
    <>
      {saving && <p className="text-sm text-slate-700">{PUBLISH_TEXTS.saving}</p>}
      {error && <FormMessage message={error} />}
    </>
  );
}

function CostFix(props: Props & { roomId: string; deviationId: string }) {
  const [value, setValue] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useFocusFirst(props.baseId, true);
  const room = { assignmentId: props.assignmentId, roomId: props.roomId };
  const bands = COST_BANDS.filter((band) => !band.archived);

  const choose = async (bandKey: string) => {
    setValue(bandKey);
    setSaving(true);
    setError(null);
    const cost = { type: "band" as const, bandKey, amount: null };
    const result = await saveChange(
      props,
      room,
      { table: "deviations", id: props.deviationId, field: "cost", value: cost, base: NONE_COST },
      PUBLISH_TEXTS.fixedCost(deviationName(props.item.deviationNumber), costText(cost)),
    );
    setSaving(false);
    if (result.kind === "failed") setError(result.message);
    props.onResult(result);
  };

  return (
    <div className="space-y-2">
      <ChoiceButtons
        id={`${props.baseId}-fix`}
        legend={PUBLISH_TEXTS.costLegend}
        options={bands.map((band) => ({
          value: band.key,
          label: `${COST_BAND_LABELS[band.key as CostBandKey]} kr`,
        }))}
        value={value}
        onChange={(key) => void choose(key)}
        disabled={saving}
      />
      <Saving saving={saving} error={error} />
    </div>
  );
}

function CheckpointTgFix(props: Props & { roomId: string; checkpointKey: string }) {
  const [value, setValue] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useFocusFirst(props.baseId, true);
  const room = { assignmentId: props.assignmentId, roomId: props.roomId };

  const choose = async (tg: string) => {
    const tgDirect = tg as "0" | "1" | "IU";
    setValue(tg);
    setSaving(true);
    setError(null);
    let result: QuickFixResult;
    try {
      const response = await props.track(() =>
        setTgDirectAction(room, { checkpointKey: props.checkpointKey, tgDirect, base: null }),
      );
      if (isActionError(response)) result = { kind: "failed", message: response.message };
      else if (response.status === "conflict") result = { kind: "conflict" };
      else if (response.status !== "saved") {
        result = { kind: "failed", message: PUBLISH_TEXTS.tgiuConflict };
      } else {
        const place = props.item.checkpointLabel ?? "Punktet";
        result = {
          kind: "saved",
          fixedText: PUBLISH_TEXTS.fixedTg(place, tgBadgeFullText(tgDirect)),
        };
      }
    } catch {
      result = { kind: "failed", message: PUBLISH_TEXTS.saveFailed };
    }
    setSaving(false);
    if (result.kind === "failed") setError(result.message);
    props.onResult(result);
  };

  return (
    <div className="space-y-2">
      <ChoiceButtons
        id={`${props.baseId}-fix`}
        legend={PUBLISH_TEXTS.tgCheckpointLegend}
        hint={PUBLISH_TEXTS.tgCheckpointHint}
        options={(["0", "1", "IU"] as const).map((tg) => ({
          value: tg,
          label: tgBadgeFullText(tg),
        }))}
        value={value}
        onChange={(tg) => void choose(tg)}
        disabled={saving}
      />
      <Saving saving={saving} error={error} />
    </div>
  );
}

function DeviationTgFix(props: Props & { roomId: string; deviationId: string }) {
  const [value, setValue] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useFocusFirst(props.baseId, true);
  const room = { assignmentId: props.assignmentId, roomId: props.roomId };

  const choose = async (choice: string) => {
    const tg = choice === "3" ? 3 : 2;
    setValue(choice);
    setSaving(true);
    setError(null);
    const name = deviationName(props.item.deviationNumber);
    const result = await saveChange(
      props,
      room,
      { table: "deviations", id: props.deviationId, field: "tg", value: tg, base: null },
      PUBLISH_TEXTS.fixedTg(name, tgBadgeFullText(choice === "3" ? "3" : "2")),
    );
    setSaving(false);
    if (result.kind === "failed") setError(result.message);
    props.onResult(result);
  };

  return (
    <div className="space-y-2">
      <ChoiceButtons
        id={`${props.baseId}-fix`}
        legend={PUBLISH_TEXTS.tgDeviationLegend(props.item.deviationNumber)}
        options={(["2", "3"] as const).map((tg) => ({ value: tg, label: tgBadgeFullText(tg) }))}
        value={value}
        onChange={(tg) => void choose(tg)}
        disabled={saving}
      />
      <Saving saving={saving} error={error} />
    </div>
  );
}

function HoleDrillingFix(props: Props & { roomId: string }) {
  const [context, setContext] = useState<HoleFixContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drilling, setDrilling] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ids] = useState(() => ({ drilling: uuidv7(), reason: uuidv7() }));
  useFocusFirst(props.baseId, context !== null);

  const { assignmentId, roomId } = props;
  useEffect(() => {
    let active = true;
    holeFixContextAction(assignmentId, roomId, ids)
      .then((response) => {
        if (!active) return;
        if (response.status === "ok") {
          setContext(response.context);
          setDrilling(response.context.drilling.value.optionKeys?.[0] ?? null);
          setReason(response.context.reason?.value.optionKeys?.[0] ?? null);
        } else setLoadError(response.message);
      })
      .catch(() => {
        if (active) setLoadError(PUBLISH_TEXTS.saveFailed);
      });
    return () => {
      active = false;
    };
  }, [assignmentId, roomId, ids]);

  if (loadError) return <FormMessage message={loadError} />;
  if (!context) return <p className="text-sm text-slate-700">{PUBLISH_TEXTS.loading}</p>;

  const save = async (
    field: HoleFixContext["drilling"],
    optionKey: string,
    fixedText: string,
  ): Promise<QuickFixResult> => {
    setSaving(true);
    setError(null);
    const result = await saveChange(
      props,
      context.room,
      {
        table: "field_answers",
        id: field.answerId,
        elementKey: field.elementKey,
        field: "value",
        value: { ...field.value, optionKeys: [optionKey] },
        base: field.value,
      },
      fixedText,
    );
    setSaving(false);
    if (result.kind === "failed") setError(result.message);
    if (result.kind === "saved") {
      // Neste lagring på samme felt bygger på verdien som nå er lagret.
      const value = { ...field.value, optionKeys: [optionKey] };
      setContext((current) => {
        if (!current) return current;
        if (current.drilling.elementKey === field.elementKey) {
          return { ...current, drilling: { ...current.drilling, value } };
        }
        if (current.reason && current.reason.elementKey === field.elementKey) {
          return { ...current, reason: { ...current.reason, value } };
        }
        return current;
      });
    }
    return result;
  };

  const chooseDrilling = async (key: string) => {
    setDrilling(key);
    const result = await save(context.drilling, key, PUBLISH_TEXTS.fixedHole);
    props.onResult(result);
  };

  const chooseReason = async (key: string) => {
    if (!context.reason) return;
    setReason(key);
    const result = await save(context.reason, key, PUBLISH_TEXTS.fixedHole);
    props.onResult(result);
  };

  const notDone = drilling === context.notDoneOptionKey;
  return (
    <div className="space-y-3">
      <ChoiceButtons
        id={`${props.baseId}-fix`}
        legend={PUBLISH_TEXTS.holeLegend}
        options={context.drilling.options.map((o) => ({ value: o.key, label: o.label }))}
        value={drilling}
        onChange={(key) => void chooseDrilling(key)}
        disabled={saving}
      />
      {notDone && context.reason && (
        <ChoiceButtons
          id={`${props.baseId}-fix-reason`}
          legend={PUBLISH_TEXTS.holeReasonLegend}
          options={context.reason.options.map((o) => ({ value: o.key, label: o.label }))}
          value={reason}
          onChange={(key) => void chooseReason(key)}
          disabled={saving}
        />
      )}
      <Saving saving={saving} error={error} />
    </div>
  );
}
