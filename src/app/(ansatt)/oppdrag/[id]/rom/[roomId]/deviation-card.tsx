"use client";

import { useRef, useState } from "react";
import {
  CAUSE_CRITERION_LABELS,
  checkOverrideReason,
  formatDecimal,
  hasMeasuresForTg,
  MAX_MEASURES_PER_DEVIATION,
  MERGE_FIELD_KEYS,
  mergeFieldMissingText,
  mergeFieldWarningText,
  OVERRIDE_REASON_CHECK_MESSAGES,
  OVERRIDE_REASON_LABELS,
  pickStandardMeasures,
  textsWrittenForOtherTg,
  textsWrittenForTgText,
} from "@/core/reports/logic";
import type { DeviationView, MeasureView, ReportFieldChange } from "@/core/reports/types";
import type { OverrideReasonCode } from "@/db/schema";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { ChoiceButtons, choiceButtonId } from "@/shared/ui/choice-buttons";
import { FormMessage, Radio, Textarea } from "@/shared/ui/form";
import { TgBadge } from "@/shared/ui/tg-badge";
import { Warning } from "@/shared/ui/warning";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  addMeasureAction,
  changeSuggestedDeviationTgAction,
  removeMeasureAction,
  saveFieldAction,
} from "./actions";
import { CostField } from "./cost-field";
import { FieldStatus } from "./field-status";
import { useField, useRoom } from "./room-context";
import { isActionError, ROOM_TEXTS, SUGGESTION_MESSAGES } from "./room-messages";
import {
  addMeasureButtonId,
  deviationCauseChoiceId,
  deviationFieldKey,
  deviationHeadingId,
  deviationTgChoiceId,
  domId,
  measureFieldKey,
  outcomeName,
  outcomeTgOf,
  REPORT_TEXT_LIMITS,
} from "./room-model";
import { ReportTextField } from "./report-text-field";

/*
 * Avvikskortet (design avsnitt 9, kortet Omfang 5): TG, avvik, årsak (kriterium som knapper og
 * tekst), konsekvens, tiltak i rekkefølge, kostnad og måling. Standardtekst fra malen står ferdig
 * utfylt; flettefelt uten verdi står som «[årstall mangler]» med advarsel, aldri som `{…}`.
 * «Fjern avviket» har ingen dialog: kortet blir en linje med «Angre» til punktet forlates.
 * Støtter hovedmål: færre reklamasjoner (forskriftens struktur som faste felt) og de ansatte.
 */

export const DEVIATION_TEXTS = {
  tg: "TG",
  chooseTg: "Velg TG2 eller TG3.",
  deviation: "Avvik",
  cause: "Årsak",
  causeCriterion: "Årsak, kriterium",
  consequence: "Konsekvens",
  measures: "Tiltak",
  measureLabel: (n: number) => `Tiltak ${n}`,
  moveUp: "Flytt opp",
  moveDown: "Flytt ned",
  removeMeasure: "Fjern tiltak",
  addMeasure: "+ Tiltak",
  addStandardMeasure: "+ Standardtiltak",
  standardMeasureLegend: "Tiltak fra malen",
  add: "Legg til",
  cancel: "Avbryt",
  measureLimit: `Avviket har ${MAX_MEASURES_PER_DEVIATION} tiltak, som er grensen.`,
  costText: "Kostnad, forklaring (valgfri)",
  measurement: "Måling",
  remove: "Fjern avviket",
  outcome: "Utfall:",
  fromRules: "Fra forslag fra reglene",
  hms: "HMS",
  measureSwapped: (tg: number) => `Tiltaket er byttet til teksten for TG${tg}.`,
  reasonLegend: "Hvorfor endrer du TG fra forslaget?",
  reasonRequired: SUGGESTION_MESSAGES.reasonMissing,
  reasonText: "Skriv grunnen",
  reasonTextOptional: "Forklaring (valgfri)",
  addExplanation: "Legg til forklaring",
  saveTg: (tg: string) => `Lagre ${tg}`,
  tgNotSaved: (tg: string) => `${tg} er ikke lagret.`,
  tgSaved: (tg: string) => `${tg} er lagret.`,
  tgCancelled: "TG er ikke endret.",
  tgConflict: "TG er endret av andre. Ingenting er lagret. Se TG og velg på nytt.",
  offline: "Du er uten nett. TG er ikke endret. Prøv igjen når nettet er tilbake.",
} as const;

const CAUSE_OPTIONS = (
  Object.keys(CAUSE_CRITERION_LABELS) as (keyof typeof CAUSE_CRITERION_LABELS)[]
).map((key) => ({ value: key, label: CAUSE_CRITERION_LABELS[key] }));

/** Advarsler under et tekstfelt for flettefelt uten verdi. */
function mergeWarnings(fieldKey: string, text: string | null) {
  if (!text) return [];
  return MERGE_FIELD_KEYS.filter((field) => text.includes(mergeFieldMissingText(field))).map(
    (field) => ({ id: `${domId(fieldKey)}-merge-${field}`, text: mergeFieldWarningText(field) }),
  );
}

function textChange(
  deviationId: string,
  field: "deviation_text" | "cause_text" | "consequence_text" | "cost_text",
) {
  return (value: string, base: string): ReportFieldChange => ({
    table: "deviations",
    id: deviationId,
    field,
    value: value === "" ? null : value,
    base: base === "" ? null : base,
  });
}

export function DeviationCard({
  deviation,
  number,
  checkpointKey,
}: {
  deviation: DeviationView;
  number: number;
  checkpointKey: string;
}) {
  const { canEdit, doc, announce, removeDeviation } = useRoom();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const headingId = deviationHeadingId(deviation.id);
  const outcome =
    deviation.questionKey && deviation.outcomeKey
      ? doc.outcome(checkpointKey, deviation.questionKey, deviation.outcomeKey)
      : undefined;
  const outcomeTg = outcome ? outcomeTgOf(outcome.kind) : null;
  const templateMeasures =
    deviation.questionKey && deviation.outcomeKey
      ? doc.measures(checkpointKey, deviation.questionKey, deviation.outcomeKey)
      : [];

  const tgField = useField(
    deviationFieldKey(deviation.id, "tg"),
    deviation.tg,
    (value, base): ReportFieldChange => ({
      table: "deviations",
      id: deviation.id,
      field: "tg",
      value: value as 2 | 3 | null,
      base: base as 2 | 3 | null,
    }),
  );
  const causeField = useField(
    deviationFieldKey(deviation.id, "cause_criterion"),
    deviation.causeCriterion,
    (value, base): ReportFieldChange => ({
      table: "deviations",
      id: deviation.id,
      field: "cause_criterion",
      value: value as DeviationView["causeCriterion"],
      base: base as DeviationView["causeCriterion"],
    }),
  );
  // Avvik fra et forslag bytter TG med egen handling (A490): TG-en er serverens til den er lagret
  const tg = deviation.suggestion ? deviation.tg : ((tgField.entry.value as 2 | 3 | null) ?? null);
  const isHms = deviation.kind === "hms";
  const otherTgWarning =
    !isHms &&
    outcomeTg !== null &&
    outcomeTg !== "choose" &&
    textsWrittenForOtherTg(outcomeTg, tg, hasMeasuresForTg(templateMeasures, tg));

  const remove = async () => {
    setBusy(true);
    setError(null);
    const message = await removeDeviation(deviation.id);
    setBusy(false);
    if (message) setError(message);
  };

  if (!canEdit) {
    return (
      <ReadOnlyDeviation
        deviation={deviation}
        number={number}
        outcomeText={outcome ? outcomeName(outcome) : null}
      />
    );
  }

  const tgChoiceId = deviationTgChoiceId(deviation.id);
  const chooseWarningId = `${tgChoiceId}-choose`;
  const otherTgWarningId = `${tgChoiceId}-other`;

  return (
    <Card>
      <section aria-labelledby={headingId} className="space-y-5">
        <div className="space-y-1">
          <h3
            id={headingId}
            tabIndex={-1}
            className="flex flex-wrap items-center justify-between gap-2 text-lg font-semibold text-slate-900"
          >
            <span>{ROOM_TEXTS.deviationNumber(number)}</span>
            {isHms ? (
              <Badge>{DEVIATION_TEXTS.hms}</Badge>
            ) : tg !== null ? (
              <TgBadge tg={String(tg) as "2" | "3"} long />
            ) : null}
          </h3>
          {outcome && (
            <p className="text-sm text-slate-700">
              {DEVIATION_TEXTS.outcome} {outcomeName(outcome)}
              {deviation.suggestedByRuleKey ? ` · ${DEVIATION_TEXTS.fromRules}` : ""}
            </p>
          )}
        </div>

        {!isHms && deviation.suggestion && (
          <SuggestedTgChoice
            deviation={deviation}
            tgChoiceId={tgChoiceId}
            chooseWarningId={chooseWarningId}
            otherTgWarningId={otherTgWarningId}
            otherTgWarning={otherTgWarning ? textsWrittenForTgText(outcomeTg) : null}
          />
        )}

        {!isHms && !deviation.suggestion && (
          <div className="space-y-1.5">
            <ChoiceButtons
              id={tgChoiceId}
              legend={DEVIATION_TEXTS.tg}
              options={[
                { value: "2", label: "TG2" },
                { value: "3", label: "TG3" },
              ]}
              value={tg === null ? null : String(tg)}
              describedBy={
                [tg === null ? chooseWarningId : null, otherTgWarning ? otherTgWarningId : null]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              onChange={(next) => {
                const nextTg = Number(next) as 2 | 3;
                tgField.edit(nextTg, 0);
                if (outcomeTg === "choose" && hasMeasuresForTg(templateMeasures, nextTg)) {
                  announce(DEVIATION_TEXTS.measureSwapped(nextTg));
                }
              }}
            />
            <FieldStatus field={tgField} formatValue={(v) => (v ? `TG${String(v)}` : "")} />
            {tg === null && <Warning id={chooseWarningId}>{DEVIATION_TEXTS.chooseTg}</Warning>}
            {otherTgWarning && (
              <Warning id={otherTgWarningId}>{textsWrittenForTgText(outcomeTg)}</Warning>
            )}
          </div>
        )}

        <ReportTextField
          fieldKey={deviationFieldKey(deviation.id, "deviation_text")}
          label={DEVIATION_TEXTS.deviation}
          serverValue={deviation.deviationText}
          build={textChange(deviation.id, "deviation_text")}
          warnings={mergeWarnings(
            deviationFieldKey(deviation.id, "deviation_text"),
            deviation.deviationText,
          )}
        />

        <div className="space-y-3">
          <div className="space-y-1.5">
            <ChoiceButtons
              id={deviationCauseChoiceId(deviation.id)}
              legend={DEVIATION_TEXTS.causeCriterion}
              options={CAUSE_OPTIONS}
              value={(causeField.entry.value as string | null) ?? null}
              onChange={(next) => causeField.edit(next, 0)}
            />
            <FieldStatus
              field={causeField}
              formatValue={(v) =>
                v ? CAUSE_CRITERION_LABELS[v as keyof typeof CAUSE_CRITERION_LABELS] : ""
              }
            />
          </div>
          <ReportTextField
            fieldKey={deviationFieldKey(deviation.id, "cause_text")}
            label={DEVIATION_TEXTS.cause}
            serverValue={deviation.causeText}
            build={textChange(deviation.id, "cause_text")}
            warnings={mergeWarnings(
              deviationFieldKey(deviation.id, "cause_text"),
              deviation.causeText,
            )}
          />
        </div>

        <ReportTextField
          fieldKey={deviationFieldKey(deviation.id, "consequence_text")}
          label={DEVIATION_TEXTS.consequence}
          serverValue={deviation.consequenceText}
          build={textChange(deviation.id, "consequence_text")}
          warnings={mergeWarnings(
            deviationFieldKey(deviation.id, "consequence_text"),
            deviation.consequenceText,
          )}
        />

        <Measures
          deviation={deviation}
          standardMeasures={pickStandardMeasures(templateMeasures, isHms ? null : tg)}
        />

        <div className="space-y-3">
          <CostField
            deviationId={deviation.id}
            serverValue={deviation.cost}
            tg={isHms ? null : tg}
          />
          <ReportTextField
            fieldKey={deviationFieldKey(deviation.id, "cost_text")}
            label={DEVIATION_TEXTS.costText}
            serverValue={deviation.costText}
            build={textChange(deviation.id, "cost_text")}
            maxLength={REPORT_TEXT_LIMITS.costText}
            singleLine
          />
        </div>

        {deviation.measurementValue !== null && (
          <p className="text-slate-900">
            <span className="text-sm font-medium text-slate-700">
              {DEVIATION_TEXTS.measurement}:{" "}
            </span>
            {formatDecimal(deviation.measurementValue)}
            {deviation.measurementUnit ? ` ${deviation.measurementUnit}` : ""}
          </p>
        )}

        {error && <FormMessage message={error} />}
        <div className="flex justify-end border-t border-line pt-4">
          <Button variant="ghost" onClick={remove} disabled={busy}>
            {busy ? ROOM_TEXTS.saving : DEVIATION_TEXTS.remove}
          </Button>
        </div>
      </section>
    </Card>
  );
}

const TG_OPTIONS = [
  { value: "2", label: "TG2" },
  { value: "3", label: "TG3" },
];

const REASON_OPTIONS = (
  Object.keys(OVERRIDE_REASON_LABELS) as (keyof typeof OVERRIDE_REASON_LABELS)[]
).map((code) => ({ value: code, label: OVERRIDE_REASON_LABELS[code] }));

/** Samme grense som på serveren (`REPORT_OVERRIDE_REASON_MAX`). */
const OVERRIDE_REASON_MAX = 500;

function tgLabel(tg: 2 | 3 | null): string {
  return tg === null ? "Tom TG" : `TG${tg}`;
}

/**
 * TG-valget på et avvik fra et regelforslag (T-0113, A490). Valg som ikke krever grunn
 * (`tgWithoutReason`), sendes med en gang. Andre valg viser grunnene som store knapper rett under
 * TG-raden, uten dialog: valgt TG står ikke som lagret før grunnen er valgt, og TG og grunn
 * sendes i ett kall. «Avbryt» og Escape setter TG tilbake og fokus tilbake til TG-valget. Uten
 * nett sendes ingenting, og meldingen sier det. Regler og KI setter aldri TG her.
 */
function SuggestedTgChoice({
  deviation,
  tgChoiceId,
  chooseWarningId,
  otherTgWarningId,
  otherTgWarning,
}: {
  deviation: DeviationView;
  tgChoiceId: string;
  chooseWarningId: string;
  otherTgWarningId: string;
  otherTgWarning: string | null;
}) {
  const { run, room, focus, announce } = useRoom();
  const suggestion = deviation.suggestion;
  const [pending, setPending] = useState<{ tg: 2 | 3 } | null>(null);
  const [reasonCode, setReasonCode] = useState<OverrideReasonCode | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [showText, setShowText] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Samme id ved nytt forsøk etter nettfeil, så serveren gir samme svar og ingen ny rad
  const attemptId = useRef<string | null>(null);
  const reasonGroupId = `${tgChoiceId}-reason`;
  const reasonTextId = `${tgChoiceId}-reason-text`;
  const statusId = `${tgChoiceId}-reason-status`;
  const savedTg = deviation.tg;
  const shownTg = pending ? pending.tg : savedTg;

  const savedTgFocusId = () => choiceButtonId(tgChoiceId, savedTg === 3 ? 1 : 0);

  const resetReason = () => {
    setReasonCode(null);
    setReasonText("");
    setShowText(false);
  };

  const cancel = () => {
    setPending(null);
    resetReason();
    setMessage(null);
    attemptId.current = null;
    announce(DEVIATION_TEXTS.tgCancelled);
    focus(savedTgFocusId());
  };

  const send = async (
    tg: 2 | 3 | null,
    reason: { code: OverrideReasonCode | null; text: string } | null,
  ) => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setMessage(DEVIATION_TEXTS.offline);
      return;
    }
    const id = attemptId.current ?? uuidv7();
    attemptId.current = id;
    setBusy(true);
    setMessage(null);
    const text = reason ? reason.text.trim() : "";
    const result = await run(() =>
      changeSuggestedDeviationTgAction(room, {
        id,
        deviationId: deviation.id,
        tg,
        base: savedTg,
        ...(reason?.code ? { overrideReasonCode: reason.code } : {}),
        ...(text ? { overrideReason: text } : {}),
      }),
    );
    setBusy(false);
    if (isActionError(result)) {
      // Valget står, så takstmannen kan prøve igjen; ingenting er lagret
      setMessage(result.message);
      return;
    }
    attemptId.current = null;
    setPending(null);
    resetReason();
    if (result.status === "conflict") {
      setMessage(DEVIATION_TEXTS.tgConflict);
      focus(savedTgFocusId());
      return;
    }
    announce(DEVIATION_TEXTS.tgSaved(tgLabel(tg)));
    focus(choiceButtonId(tgChoiceId, tg === 3 ? 1 : 0));
  };

  if (!suggestion) return null;

  const choose = (next: string) => {
    const nextTg = Number(next) as 2 | 3;
    setMessage(null);
    if (nextTg === savedTg) {
      // Tilbake til lagret TG: ingenting å sende
      if (pending) cancel();
      return;
    }
    attemptId.current = null;
    if (suggestion.tgWithoutReason.includes(nextTg)) {
      // Forslagets TG (eller TG-valget ved «velg TG2 eller TG3») trenger ingen grunn
      setPending(null);
      resetReason();
      void send(nextTg, null);
      return;
    }
    setPending({ tg: nextTg });
    resetReason();
    focus(choiceButtonId(reasonGroupId, 0));
  };

  const reasonCheck = checkOverrideReason({
    decision: "changed",
    code: reasonCode,
    text: reasonText.trim() === "" ? null : reasonText,
  });

  const chooseReason = (code: string) => {
    const chosen = code as OverrideReasonCode;
    setReasonCode(chosen);
    setMessage(null);
    if (chosen === "other" || showText) {
      setShowText(true);
      if (chosen === "other") focus(reasonTextId);
      return;
    }
    // Ett trykk: grunnen er valgt, og TG og grunn sendes sammen
    if (pending) void send(pending.tg, { code: chosen, text: "" });
  };

  const submitWithText = () => {
    if (!pending || busy) return;
    if (reasonCheck !== "ok") {
      focus(choiceButtonId(reasonGroupId, 0));
      return;
    }
    void send(pending.tg, { code: reasonCode, text: reasonText });
  };

  const missingReason =
    reasonCheck === "reason_required"
      ? DEVIATION_TEXTS.reasonRequired
      : reasonCheck === "text_required"
        ? OVERRIDE_REASON_CHECK_MESSAGES.text_required
        : null;

  return (
    <div className="space-y-1.5">
      <ChoiceButtons
        id={tgChoiceId}
        legend={DEVIATION_TEXTS.tg}
        options={TG_OPTIONS}
        value={shownTg === null ? null : String(shownTg)}
        disabled={busy}
        describedBy={
          [
            pending ? statusId : null,
            shownTg === null ? chooseWarningId : null,
            otherTgWarning ? otherTgWarningId : null,
          ]
            .filter(Boolean)
            .join(" ") || undefined
        }
        onChange={choose}
      />
      {busy && <p className="text-sm text-slate-700">{ROOM_TEXTS.saving}</p>}
      {pending && (
        <div
          className="space-y-3 rounded-card bg-sand p-4"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
          }}
        >
          <p id={statusId} role="status" className="font-medium text-slate-900">
            {DEVIATION_TEXTS.tgNotSaved(tgLabel(pending.tg))}
            {missingReason ? ` ${missingReason}` : ""}
          </p>
          <ChoiceButtons
            id={reasonGroupId}
            legend={DEVIATION_TEXTS.reasonLegend}
            options={REASON_OPTIONS}
            value={reasonCode}
            disabled={busy}
            describedBy={statusId}
            onChange={chooseReason}
          />
          {showText ? (
            <div className="space-y-1.5">
              <label htmlFor={reasonTextId} className="block text-sm font-medium text-slate-700">
                {reasonCode === "other"
                  ? DEVIATION_TEXTS.reasonText
                  : DEVIATION_TEXTS.reasonTextOptional}
              </label>
              <Textarea
                id={reasonTextId}
                className="min-h-24"
                value={reasonText}
                maxLength={OVERRIDE_REASON_MAX}
                onChange={(event) => setReasonText(event.target.value)}
              />
            </div>
          ) : (
            <Button
              variant="ghost"
              onClick={() => {
                setShowText(true);
                focus(reasonTextId);
              }}
            >
              {DEVIATION_TEXTS.addExplanation}
            </Button>
          )}
          <div className="flex flex-wrap gap-2">
            {showText && (
              <Button
                aria-disabled={reasonCheck !== "ok" || busy}
                aria-describedby={statusId}
                onClick={submitWithText}
              >
                {busy ? ROOM_TEXTS.saving : DEVIATION_TEXTS.saveTg(tgLabel(pending.tg))}
              </Button>
            )}
            <Button variant="ghost" onClick={cancel} disabled={busy}>
              {DEVIATION_TEXTS.cancel}
            </Button>
          </div>
        </div>
      )}
      {message && (
        <p role="status" className="rounded-xl bg-urgent-fill px-3 py-2 text-sm text-urgent-text">
          {message}
        </p>
      )}
      {shownTg === null && <Warning id={chooseWarningId}>{DEVIATION_TEXTS.chooseTg}</Warning>}
      {otherTgWarning && <Warning id={otherTgWarningId}>{otherTgWarning}</Warning>}
    </div>
  );
}

function Measures({
  deviation,
  standardMeasures,
}: {
  deviation: DeviationView;
  standardMeasures: { text: string }[];
}) {
  const { run, focus, store, room } = useRoom();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const measures = [...deviation.measures].sort((a, b) => a.sortOrder - b.sortOrder);
  const atLimit = measures.length >= MAX_MEASURES_PER_DEVIATION;
  const listId = `deviation-${deviation.id}-measures`;

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= measures.length) return;
    const order = [...measures];
    const [moved] = order.splice(index, 1);
    if (!moved) return;
    order.splice(target, 0, moved);
    order.forEach((measure, position) => {
      if (measure.sortOrder === position) return;
      const key = measureFieldKey(measure.id, "sort_order");
      store.ensure(key, measure.sortOrder, (value, base): ReportFieldChange => ({
        table: "deviation_measures",
        id: measure.id,
        field: "sort_order",
        value: value as number,
        base: base as number,
      }));
      store.edit(key, position, 0);
    });
    focus(`${domId(measureFieldKey(moved.id, "text"))}-${direction < 0 ? "up" : "down"}`);
  };

  const addMeasure = async (text: string | null) => {
    setBusy(true);
    setError(null);
    const id = uuidv7();
    const added = await run(() => addMeasureAction(room, { id, deviationId: deviation.id }));
    if (isActionError(added)) {
      setBusy(false);
      setError(added.message);
      return;
    }
    if (text) {
      const saved = await run(() =>
        saveFieldAction(room, {
          table: "deviation_measures",
          id,
          field: "text",
          value: text,
          base: "",
        }),
      );
      if (isActionError(saved)) setError(saved.message);
    }
    setBusy(false);
    setPicking(false);
    setPicked(null);
    focus(domId(measureFieldKey(id, "text")));
  };

  const removeMeasure = async (measure: MeasureView) => {
    setError(null);
    const result = await run(() => removeMeasureAction(room, measure.id));
    if (isActionError(result)) {
      setError(result.message);
      return;
    }
    store.drop(`measure:${measure.id}:`);
    focus(addMeasureButtonId(deviation.id));
  };

  return (
    <div className="space-y-3">
      <h4 id={listId} className="text-sm font-medium text-slate-700">
        {DEVIATION_TEXTS.measures}
      </h4>
      {measures.length > 0 && (
        <ol aria-labelledby={listId} className="space-y-4">
          {measures.map((measure, index) => {
            const key = measureFieldKey(measure.id, "text");
            const base = domId(key);
            return (
              <li key={measure.id} className="space-y-2">
                <ReportTextField
                  fieldKey={key}
                  label={DEVIATION_TEXTS.measureLabel(index + 1)}
                  serverValue={measure.text}
                  build={(value, baseText) => ({
                    table: "deviation_measures",
                    id: measure.id,
                    field: "text",
                    value,
                    base: baseText,
                  })}
                  warnings={mergeWarnings(key, measure.text)}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    id={`${base}-up`}
                    variant="secondary"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <span aria-hidden="true">↑</span>
                    {DEVIATION_TEXTS.moveUp}
                  </Button>
                  <Button
                    id={`${base}-down`}
                    variant="secondary"
                    disabled={index === measures.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <span aria-hidden="true">↓</span>
                    {DEVIATION_TEXTS.moveDown}
                  </Button>
                  <Button variant="ghost" onClick={() => removeMeasure(measure)}>
                    {DEVIATION_TEXTS.removeMeasure}
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {picking && (
        <div className="space-y-3 rounded-card bg-sand p-4">
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium text-slate-700">
              {DEVIATION_TEXTS.standardMeasureLegend}
            </legend>
            {standardMeasures.map((measure, index) => (
              <Radio
                key={index}
                id={`deviation-${deviation.id}-standard-${index}`}
                name={`deviation-${deviation.id}-standard`}
                label={measure.text}
                checked={picked === index}
                onChange={() => setPicked(index)}
              />
            ))}
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={picked === null || busy}
              onClick={() => {
                const chosen = picked === null ? null : standardMeasures[picked];
                if (chosen) void addMeasure(chosen.text);
              }}
            >
              {busy ? ROOM_TEXTS.saving : DEVIATION_TEXTS.add}
            </Button>
            <Button variant="ghost" onClick={() => setPicking(false)}>
              {DEVIATION_TEXTS.cancel}
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2 md:gap-3">
        <Button
          id={addMeasureButtonId(deviation.id)}
          variant="secondary"
          disabled={atLimit || busy}
          onClick={() => void addMeasure(null)}
        >
          {DEVIATION_TEXTS.addMeasure}
        </Button>
        {standardMeasures.length > 0 && (
          <Button
            variant="secondary"
            disabled={atLimit || busy}
            onClick={() => {
              setPicking(true);
              focus(`deviation-${deviation.id}-standard-0`);
            }}
          >
            {DEVIATION_TEXTS.addStandardMeasure}
          </Button>
        )}
      </div>
      {atLimit && <p className="text-sm text-slate-700">{DEVIATION_TEXTS.measureLimit}</p>}
      {error && <FormMessage message={error} />}
    </div>
  );
}

/** Avviket som tekst for den som ikke kan endre (kontor). */
function ReadOnlyDeviation({
  deviation,
  number,
  outcomeText,
}: {
  deviation: DeviationView;
  number: number;
  outcomeText: string | null;
}) {
  const headingId = deviationHeadingId(deviation.id);
  const measures = [...deviation.measures].sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <Card>
      <section aria-labelledby={headingId} className="space-y-4">
        <h3
          id={headingId}
          tabIndex={-1}
          className="flex flex-wrap items-center justify-between gap-2 text-lg font-semibold text-slate-900"
        >
          <span>{ROOM_TEXTS.deviationNumber(number)}</span>
          {deviation.kind === "hms" ? (
            <Badge>{DEVIATION_TEXTS.hms}</Badge>
          ) : deviation.tg !== null ? (
            <TgBadge tg={String(deviation.tg) as "2" | "3"} long />
          ) : null}
        </h3>
        {outcomeText && (
          <p className="text-sm text-slate-700">
            {DEVIATION_TEXTS.outcome} {outcomeText}
          </p>
        )}
        <ReadOnlyLine label={DEVIATION_TEXTS.deviation} text={deviation.deviationText} />
        <ReadOnlyLine
          label={DEVIATION_TEXTS.cause}
          text={[
            deviation.causeCriterion ? CAUSE_CRITERION_LABELS[deviation.causeCriterion] : null,
            deviation.causeText,
          ]
            .filter(Boolean)
            .join(". ")}
        />
        <ReadOnlyLine label={DEVIATION_TEXTS.consequence} text={deviation.consequenceText} />
        <div className="space-y-1">
          <p className="text-sm font-medium text-slate-700">{DEVIATION_TEXTS.measures}</p>
          {measures.length === 0 ? (
            <p className="text-slate-900">–</p>
          ) : (
            <ol className="list-decimal space-y-1 pl-5 text-slate-900">
              {measures.map((m) => (
                <li key={m.id} className="break-words whitespace-pre-wrap">
                  {m.text}
                </li>
              ))}
            </ol>
          )}
        </div>
        <CostReadOnly deviation={deviation} />
        {deviation.measurementValue !== null && (
          <ReadOnlyLine
            label={DEVIATION_TEXTS.measurement}
            text={`${formatDecimal(deviation.measurementValue)}${deviation.measurementUnit ? ` ${deviation.measurementUnit}` : ""}`}
          />
        )}
      </section>
    </Card>
  );
}

function CostReadOnly({ deviation }: { deviation: DeviationView }) {
  return <CostField deviationId={deviation.id} serverValue={deviation.cost} tg={deviation.tg} />;
}

function ReadOnlyLine({ label, text }: { label: string; text: string | null }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium text-slate-700">{label}</p>
      <p className="break-words whitespace-pre-wrap text-slate-900">{text || "–"}</p>
    </div>
  );
}
