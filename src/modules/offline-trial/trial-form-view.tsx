"use client";

import { useState } from "react";
import { cn } from "@/shared/lib/cn";
import { uuidv7 } from "@/shared/lib/uuid";
import { Button } from "@/shared/ui/button";
import {
  parseTrialNumber,
  type TrialAnswers,
  type TrialPhoto,
  type TrialTableRow,
  type TrialValue,
} from "./answers";
import { TRIAL_TG_VALUES, type TrialField, type TrialForm, type TrialOption } from "./trial-form";

type OnChange = (fieldKey: string, value: TrialValue) => void;

interface TrialFormViewProps {
  form: TrialForm;
  answers: TrialAnswers;
  onChange: OnChange;
}

/** Viser testskjemaet. Vet ikke hvor svarene lagres; alt går gjennom `onChange`. */
export function TrialFormView({ form, answers, onChange }: TrialFormViewProps) {
  return (
    <div className="space-y-8">
      {form.groups.map((group) => (
        <section key={group.key} className="space-y-5">
          <h2 className="text-xl font-semibold text-slate-900">{group.title}</h2>
          {group.fields.map((field) => (
            <div key={field.key} data-field={field.key}>
              <FieldInput field={field} value={answers[field.key]} onChange={onChange} />
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

const inputClass =
  "block min-h-11 w-full rounded-xl border border-field bg-white px-3 py-2 text-base text-slate-900 focus:border-brand-600";
const labelClass = "mb-1.5 block text-sm font-medium text-slate-700";

function fieldId(key: string): string {
  return `trial-${key}`;
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: TrialField;
  value: TrialValue | undefined;
  onChange: OnChange;
}) {
  switch (field.type) {
    case "text":
      return (
        <>
          <label htmlFor={fieldId(field.key)} className={labelClass}>
            {field.label}
          </label>
          <textarea
            id={fieldId(field.key)}
            rows={3}
            className={inputClass}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(field.key, e.target.value)}
          />
        </>
      );
    case "tg":
      return (
        <ChoiceButtons
          legend={field.label}
          options={TRIAL_TG_VALUES.map((tg) => ({ key: tg, label: tg }))}
          selected={typeof value === "string" ? value : null}
          onSelect={(key) => onChange(field.key, key)}
        />
      );
    case "choice":
      return (
        <ChoiceButtons
          legend={field.label}
          options={field.options ?? []}
          selected={typeof value === "string" ? value : null}
          onSelect={(key) => onChange(field.key, key)}
        />
      );
    case "number":
      return <NumberInput field={field} onChange={onChange} />;
    case "table":
      return (
        <TableInput
          field={field}
          rows={Array.isArray(value) ? (value as TrialTableRow[]) : []}
          onChange={onChange}
        />
      );
    case "photo":
      return (
        <PhotoInput
          field={field}
          photos={Array.isArray(value) ? (value as TrialPhoto[]) : []}
          onChange={onChange}
        />
      );
  }
}

/** Knapper på rad for TG og valg. Valgt knapp har farge, tykk ramme og fet skrift. */
function ChoiceButtons({
  legend,
  options,
  selected,
  onSelect,
}: {
  legend: string;
  options: TrialOption[];
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <fieldset>
      <legend className={labelClass}>{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const pressed = option.key === selected;
          return (
            <button
              key={option.key}
              type="button"
              aria-pressed={pressed ? "true" : "false"}
              onClick={() => onSelect(option.key)}
              className={cn(
                "min-h-11 min-w-11 rounded-xl border-2 px-4 text-base",
                pressed
                  ? "border-brand-900 bg-brand-600 font-bold text-white underline"
                  : "border-slate-300 bg-white font-medium text-slate-900 hover:bg-slate-50",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Tallfelt: rå tekst holdes her, skjemaet får bare tallet (eller null). */
function NumberInput({ field, onChange }: { field: TrialField; onChange: OnChange }) {
  const [text, setText] = useState("");
  return (
    <>
      <label htmlFor={fieldId(field.key)} className={labelClass}>
        {field.label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={fieldId(field.key)}
          type="text"
          inputMode="decimal"
          className={cn(inputClass, "min-w-11 max-w-40")}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onChange(field.key, parseTrialNumber(e.target.value));
          }}
        />
        {field.unit ? <span className="text-slate-600">{field.unit}</span> : null}
      </div>
    </>
  );
}

function TableInput({
  field,
  rows,
  onChange,
}: {
  field: TrialField;
  rows: TrialTableRow[];
  onChange: OnChange;
}) {
  const columns = field.columns ?? [];
  // Rå tekst for tallceller, slik at «12,» ikke forsvinner mens man skriver.
  const [rawText, setRawText] = useState<Record<string, string>>({});

  function addRow() {
    const cells = Object.fromEntries(columns.map((c) => [c.key, null]));
    onChange(field.key, [...rows, { id: uuidv7(), cells }]);
  }

  function deleteRow(id: string) {
    onChange(
      field.key,
      rows.filter((row) => row.id !== id),
    );
  }

  function setCell(rowId: string, columnKey: string, cellValue: string | number | null) {
    onChange(
      field.key,
      rows.map((row) =>
        row.id === rowId ? { ...row, cells: { ...row.cells, [columnKey]: cellValue } } : row,
      ),
    );
  }

  return (
    <div>
      <p className={labelClass}>{field.label}</p>
      <div className="space-y-3">
        {rows.map((row, index) => {
          const rowNumber = index + 1;
          return (
            <div key={row.id} className="flex flex-wrap items-end gap-2 rounded-xl bg-slate-50 p-3">
              {columns.map((column) => {
                const cellKey = `${row.id}:${column.key}`;
                const cell = row.cells[column.key];
                const shown =
                  column.type === "number"
                    ? (rawText[cellKey] ?? (typeof cell === "number" ? String(cell) : ""))
                    : typeof cell === "string"
                      ? cell
                      : "";
                return (
                  <div key={column.key} className="flex items-center gap-1">
                    <input
                      type="text"
                      inputMode={column.type === "number" ? "decimal" : undefined}
                      aria-label={`${column.label}, rad ${rowNumber}`}
                      placeholder={column.label}
                      className={cn(
                        inputClass,
                        "min-w-11",
                        column.type === "number" ? "w-24" : "w-40",
                      )}
                      value={shown}
                      onChange={(e) => {
                        const input = e.target.value;
                        if (column.type === "number") {
                          setRawText((prev) => ({ ...prev, [cellKey]: input }));
                          setCell(row.id, column.key, parseTrialNumber(input));
                        } else {
                          setCell(row.id, column.key, input);
                        }
                      }}
                    />
                    {column.unit ? <span className="text-slate-600">{column.unit}</span> : null}
                  </div>
                );
              })}
              <Button variant="secondary" className="min-w-11" onClick={() => deleteRow(row.id)}>
                Slett rad {rowNumber}
              </Button>
            </div>
          );
        })}
      </div>
      <Button variant="secondary" className="mt-3 min-w-11" onClick={addRow}>
        Legg til rad
      </Button>
    </div>
  );
}

/** Bildefelt: bare navn og størrelse lagres. Ingen forhåndsvisning og ingen opplasting. */
function PhotoInput({
  field,
  photos,
  onChange,
}: {
  field: TrialField;
  photos: TrialPhoto[];
  onChange: OnChange;
}) {
  return (
    <>
      <label htmlFor={fieldId(field.key)} className={labelClass}>
        {field.label}
      </label>
      <input
        id={fieldId(field.key)}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="block min-h-11 min-w-11 text-base text-slate-900 file:mr-3 file:min-h-11 file:rounded-xl file:border-0 file:bg-brand-600 file:px-4 file:text-white"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) {
            const added = files.map((file) => ({
              id: uuidv7(),
              name: file.name,
              sizeBytes: file.size,
            }));
            onChange(field.key, [...photos, ...added]);
          }
          e.target.value = "";
        }}
      />
      {photos.length > 0 ? (
        <div className="mt-2 text-sm text-slate-700">
          <p className="font-medium">
            {photos.length === 1 ? "1 bilde" : `${photos.length} bilder`}
          </p>
          <ul className="mt-1 list-disc pl-5">
            {photos.map((photo) => (
              <li key={photo.id}>{photo.name}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
