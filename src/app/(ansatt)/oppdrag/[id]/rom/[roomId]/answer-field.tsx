"use client";

import { useState } from "react";
import { formatDecimal } from "@/core/reports/logic";
import type { TemplateElementDoc } from "@/core/templates";
import type { AnswerValue, ReportFieldChange } from "@/core/reports/types";
import { ChoiceButtons } from "@/shared/ui/choice-buttons";
import { Checkbox, ChoiceGroup, Input } from "@/shared/ui/form";
import { FieldStatus } from "./field-status";
import { useField, useRoom, type FieldHandle } from "./room-context";
import { answerKey, domId, EMPTY_ANSWER, NUMBER_MESSAGE, parseNumberInput } from "./room-model";
import { ReportTextField } from "./report-text-field";

/*
 * Feltene under «Registrering» på et kontrollpunkt (design avsnitt 7 punkt 3), i malens
 * rekkefølge. Enkeltvalg er pilleknapper, flervalg avkrysning, tall et tallfelt med enheten etter,
 * tekst det felles tekstfeltet. Ingen nedtrekkslister. Hvert felt lagres for seg; lagres et svar
 * som en regel leser, sender serveren de nye forslagene tilbake. Lagring av et svar setter aldri
 * TG og lager aldri avvik.
 */

/** Avkrysning lagres som valget `yes` (krysset av) eller tom liste. */
export const CHECKBOX_CHECKED = "yes";

function answerChange(elementKey: string) {
  return (value: unknown, base: unknown, rowId: string | null): ReportFieldChange => ({
    table: "field_answers",
    id: rowId ?? "",
    elementKey,
    field: "value",
    value: value as AnswerValue,
    base: base as AnswerValue,
  });
}

function answerText(value: unknown, element: TemplateElementDoc, labels: (key: string) => string) {
  const answer = (value ?? EMPTY_ANSWER) as AnswerValue;
  if (answer.optionKeys && answer.optionKeys.length > 0) {
    if (element.field_type === "checkbox") return "Ja";
    return answer.optionKeys.map(labels).join(", ");
  }
  if (answer.number !== null) {
    return `${formatDecimal(answer.number)}${element.unit ? ` ${element.unit}` : ""}`;
  }
  return answer.text ?? "";
}

export function AnswerField({
  element,
  serverValue,
  serverRowId,
  newRowId,
}: {
  element: TemplateElementDoc;
  serverValue: AnswerValue | null;
  serverRowId: string | null;
  /** Id for raden når svaret er nytt (UUID v7 laget i nettleseren). */
  newRowId: string;
}) {
  const { canEdit, doc } = useRoom();
  const key = answerKey(element.key);
  const id = domId(key);
  const options = doc.options(element.key);
  const optionLabel = (optionKey: string) =>
    options.find((o) => o.key === optionKey)?.label ?? optionKey;

  if (element.field_type === "text") {
    return (
      <ReportTextField
        fieldKey={key}
        label={element.label}
        hint={element.help_text ?? undefined}
        serverValue={serverValue?.text ?? null}
        build={(value, base) => ({
          table: "field_answers",
          id: serverRowId ?? newRowId,
          elementKey: element.key,
          field: "value",
          value: { ...EMPTY_ANSWER, text: value === "" ? null : value },
          base: { ...EMPTY_ANSWER, ...(serverValue ?? {}), text: base === "" ? null : base },
        })}
      />
    );
  }
  return (
    <StructuredAnswer
      element={element}
      fieldKey={key}
      id={id}
      serverValue={serverValue ?? EMPTY_ANSWER}
      rowId={serverRowId ?? newRowId}
      canEdit={canEdit}
      optionLabel={optionLabel}
      options={options.map((o) => ({ value: o.key, label: o.label }))}
    />
  );
}

function StructuredAnswer({
  element,
  fieldKey,
  id,
  serverValue,
  rowId,
  canEdit,
  optionLabel,
  options,
}: {
  element: TemplateElementDoc;
  fieldKey: string;
  id: string;
  serverValue: AnswerValue;
  rowId: string;
  canEdit: boolean;
  optionLabel(key: string): string;
  options: { value: string; label: string }[];
}) {
  const field = useField(fieldKey, serverValue, answerChange(element.key), { rowId });
  const value = (field.entry.value ?? EMPTY_ANSWER) as AnswerValue;

  if (!canEdit) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium text-slate-700">{element.label}</p>
        <p className="text-slate-900">{answerText(value, element, optionLabel) || "–"}</p>
      </div>
    );
  }

  const status = (
    <FieldStatus field={field} formatValue={(v) => answerText(v, element, optionLabel)} />
  );

  if (element.field_type === "choice" && !element.multiple) {
    return (
      <div className="space-y-1.5">
        <ChoiceButtons
          id={id}
          legend={element.label}
          hint={element.help_text ?? undefined}
          options={options}
          value={value.optionKeys?.[0] ?? null}
          onChange={(optionKey) => field.edit({ ...EMPTY_ANSWER, optionKeys: [optionKey] }, 0)}
        />
        {status}
      </div>
    );
  }

  if (element.field_type === "choice") {
    const selected = new Set(value.optionKeys ?? []);
    return (
      <div className="space-y-1.5">
        <ChoiceGroup id={id} legend={element.label} hint={element.help_text ?? undefined}>
          {options.map((option, index) => (
            <Checkbox
              key={option.value}
              id={`${id}-${index}`}
              label={option.label}
              checked={selected.has(option.value)}
              onChange={(event) => {
                const next = new Set(selected);
                if (event.target.checked) next.add(option.value);
                else next.delete(option.value);
                const keys = options.map((o) => o.value).filter((k) => next.has(k));
                field.edit({ ...EMPTY_ANSWER, optionKeys: keys }, 0);
              }}
            />
          ))}
        </ChoiceGroup>
        {status}
      </div>
    );
  }

  if (element.field_type === "checkbox") {
    const checked = (value.optionKeys ?? []).includes(CHECKBOX_CHECKED);
    return (
      <div className="space-y-1.5">
        <Checkbox
          id={id}
          label={element.label}
          description={element.help_text ?? undefined}
          checked={checked}
          onChange={(event) =>
            field.edit(
              { ...EMPTY_ANSWER, optionKeys: event.target.checked ? [CHECKBOX_CHECKED] : [] },
              0,
            )
          }
        />
        {status}
      </div>
    );
  }

  return <NumberAnswer element={element} id={id} field={field} value={value} status={status} />;
}

function NumberAnswer({
  element,
  id,
  field,
  value,
  status,
}: {
  element: TemplateElementDoc;
  id: string;
  field: FieldHandle;
  value: AnswerValue;
  status: React.ReactNode;
}) {
  const stored = value.number === null ? "" : formatDecimal(value.number).replace(/ /g, "");
  const [raw, setRaw] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const shown = raw ?? stored;
  const hintId = element.help_text ? `${id}-hint` : null;
  const errorId = invalid ? `${id}-error` : null;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {element.label}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          inputMode="decimal"
          className="w-40"
          value={shown}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
          onChange={(event) => {
            const next = event.target.value;
            setRaw(next);
            const parsed = parseNumberInput(next);
            setInvalid(!parsed.ok);
            if (parsed.ok) field.edit({ ...EMPTY_ANSWER, number: parsed.value });
          }}
          onBlur={() => {
            if (!invalid) setRaw(null);
            field.commit();
          }}
        />
        {element.unit && <span className="text-slate-700">{element.unit}</span>}
      </div>
      {element.help_text && (
        <p id={hintId ?? undefined} className="text-sm text-slate-600">
          {element.help_text}
        </p>
      )}
      {invalid && (
        <p id={errorId ?? undefined} className="text-sm text-urgent-text">
          <span className="sr-only">Feil: </span>
          {NUMBER_MESSAGE}
        </p>
      )}
      {status}
    </div>
  );
}
