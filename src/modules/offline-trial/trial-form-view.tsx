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
import {
  TRIAL_TG_VALUES,
  type TrialColumn,
  type TrialField,
  type TrialForm,
  type TrialOption,
} from "./trial-form";
import { TrialRuleResult } from "./trial-rule-result";

type OnChange = (fieldKey: string, value: TrialValue) => void;
type OnTouched = () => void;
type OnAddPhotos = (
  fieldKey: string,
  items: ReadonlyArray<{ file: File; photo: TrialPhoto }>,
) => void;

interface TrialFormViewProps {
  form: TrialForm;
  answers: TrialAnswers;
  onChange: OnChange;
  /** Felt der en annen enhet sist endret verdien. Viser «Endret av en annen». */
  foreignChanges?: ReadonlySet<string>;
  /** Kalles når takstmannen rører et felt (fokus, trykk eller endring). */
  onFieldTouched?: (fieldKey: string) => void;
  /** Når satt, får denne de nye bildefilene i stedet for `onChange`. */
  onAddPhotos?: OnAddPhotos;
  /** Felt der svaret eller et bilde ikke ble lagret på enheten. Viser «ikke lagret». */
  unsavedFields?: ReadonlySet<string>;
}

/** Viser testskjemaet. Vet ikke hvor svarene lagres; alt går gjennom `onChange`. */
export function TrialFormView({
  form,
  answers,
  onChange,
  foreignChanges,
  onFieldTouched,
  onAddPhotos,
  unsavedFields,
}: TrialFormViewProps) {
  return (
    <div className="space-y-8">
      {form.groups.map((group) => (
        <section key={group.key} className="space-y-5">
          <h2 className="text-xl font-semibold text-slate-900">{group.title}</h2>
          {group.fields.map((field) => {
            const touched = () => onFieldTouched?.(field.key);
            const change: OnChange = (key, value) => {
              touched();
              onChange(key, value);
            };
            const showForeign =
              (field.type === "tg" || field.type === "choice" || field.type === "number") &&
              (foreignChanges?.has(field.key) ?? false);
            const unsaved = unsavedFields?.has(field.key) ?? false;
            return (
              <div
                key={field.key}
                data-field={field.key}
                data-field-saved={unsaved ? "no" : "yes"}
              >
                <FieldInput
                  field={field}
                  value={answers[field.key]}
                  onChange={change}
                  onTouched={touched}
                  onAddPhotos={onAddPhotos}
                />
                <TrialRuleResult fieldKey={field.key} answers={answers} />
                {showForeign ? <ForeignChangeNotice /> : null}
                {unsaved ? <NotSavedMark /> : null}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

/** Minste mulige varsel: tekst med ikon, ingen dialog og ikke farge alene. */
function ForeignChangeNotice() {
  return (
    <p role="status" className="mt-1.5 flex items-center gap-1.5 text-sm text-slate-700">
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="h-4 w-4 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <circle cx="8" cy="8" r="6.5" />
        <path d="M8 4.5v4M8 11v.5" strokeLinecap="round" />
      </svg>
      Endret av en annen
    </p>
  );
}

/** Merket på et felt som ikke er lagret på enheten. Ingen role: meldingen øverst er varselet. */
function NotSavedMark() {
  return (
    <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-red-50 px-2 py-1 text-sm font-medium text-red-800">
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="h-4 w-4 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <circle cx="8" cy="8" r="6.5" />
        <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" strokeLinecap="round" />
      </svg>
      ikke lagret
    </p>
  );
}

const inputClass =
  "block min-h-11 w-full rounded-xl border border-field bg-white px-3 py-2 text-base text-slate-900 focus:border-brand-600";
const labelClass = "mb-1.5 block text-sm font-medium text-slate-700";

function fieldId(key: string): string {
  return `trial-${key}`;
}

/** Viser et tall fra svarene: komma som desimaltegn, tomt ved null. */
function formatTrialNumber(value: unknown): string {
  return typeof value === "number" && !Number.isNaN(value) ? String(value).replace(".", ",") : "";
}

/**
 * Lokal kladd mens feltet har fokus. Uten fokus vises verdien fra svarene, slik at
 * en verdi fra synk eller fra en annen iPad vises riktig. Med fokus beholdes det
 * takstmannen skriver («12,» forsvinner ikke).
 */
function useFocusDraft(external: string) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(external);
  return {
    value: focused ? draft : external,
    setDraft,
    onFocus: () => {
      setDraft(external);
      setFocused(true);
    },
    onBlur: () => setFocused(false),
  };
}

function FieldInput({
  field,
  value,
  onChange,
  onTouched,
  onAddPhotos,
}: {
  field: TrialField;
  value: TrialValue | undefined;
  onChange: OnChange;
  onTouched: OnTouched;
  onAddPhotos?: OnAddPhotos;
}) {
  switch (field.type) {
    case "text":
      return (
        <TextInput
          field={field}
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          onTouched={onTouched}
        />
      );
    case "tg":
      return (
        <ChoiceButtons
          legend={field.label}
          options={TRIAL_TG_VALUES.map((tg) => ({ key: tg, label: tg }))}
          selected={typeof value === "string" ? value : null}
          onSelect={(key) => onChange(field.key, key)}
          onTouched={onTouched}
        />
      );
    case "choice":
      return (
        <ChoiceButtons
          legend={field.label}
          options={field.options ?? []}
          selected={typeof value === "string" ? value : null}
          onSelect={(key) => onChange(field.key, key)}
          onTouched={onTouched}
        />
      );
    case "number":
      return <NumberInput field={field} value={value} onChange={onChange} onTouched={onTouched} />;
    case "table":
      return (
        <TableInput
          field={field}
          rows={Array.isArray(value) ? (value as TrialTableRow[]) : []}
          onChange={onChange}
          onTouched={onTouched}
        />
      );
    case "photo":
      return (
        <PhotoInput
          field={field}
          photos={Array.isArray(value) ? (value as TrialPhoto[]) : []}
          onChange={onChange}
          onTouched={onTouched}
          onAddPhotos={onAddPhotos}
        />
      );
  }
}

function TextInput({
  field,
  value,
  onChange,
  onTouched,
}: {
  field: TrialField;
  value: string;
  onChange: OnChange;
  onTouched: OnTouched;
}) {
  const draft = useFocusDraft(value);
  return (
    <>
      <label htmlFor={fieldId(field.key)} className={labelClass}>
        {field.label}
      </label>
      <textarea
        id={fieldId(field.key)}
        rows={3}
        className={inputClass}
        value={draft.value}
        onFocus={() => {
          draft.onFocus();
          onTouched();
        }}
        onBlur={draft.onBlur}
        onPointerDown={onTouched}
        onChange={(e) => {
          draft.setDraft(e.target.value);
          onChange(field.key, e.target.value);
        }}
      />
    </>
  );
}

/** Knapper på rad for TG og valg. Valgt knapp har farge, tykk ramme og fet skrift. */
function ChoiceButtons({
  legend,
  options,
  selected,
  onSelect,
  onTouched,
}: {
  legend: string;
  options: TrialOption[];
  selected: string | null;
  onSelect: (key: string) => void;
  onTouched: OnTouched;
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
              onFocus={onTouched}
              onPointerDown={onTouched}
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

/** Tallfelt: råteksten holdes bare mens feltet har fokus; skjemaet får tallet (eller null). */
function NumberInput({
  field,
  value,
  onChange,
  onTouched,
}: {
  field: TrialField;
  value: TrialValue | undefined;
  onChange: OnChange;
  onTouched: OnTouched;
}) {
  const draft = useFocusDraft(formatTrialNumber(value));
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
          value={draft.value}
          onFocus={() => {
            draft.onFocus();
            onTouched();
          }}
          onBlur={draft.onBlur}
          onPointerDown={onTouched}
          onChange={(e) => {
            draft.setDraft(e.target.value);
            onChange(field.key, parseTrialNumber(e.target.value));
          }}
        />
        {field.unit ? <span className="text-slate-600">{field.unit}</span> : null}
      </div>
    </>
  );
}

/** Én celle i et tabellfelt. Samme kladd-mønster som de andre feltene. */
function TableCellInput({
  column,
  cell,
  ariaLabel,
  onCellChange,
  onTouched,
}: {
  column: TrialColumn;
  cell: string | number | null | undefined;
  ariaLabel: string;
  onCellChange: (value: string | number | null) => void;
  onTouched: OnTouched;
}) {
  const isNumber = column.type === "number";
  const draft = useFocusDraft(
    isNumber ? formatTrialNumber(cell) : typeof cell === "string" ? cell : "",
  );
  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        inputMode={isNumber ? "decimal" : undefined}
        aria-label={ariaLabel}
        placeholder={column.label}
        className={cn(inputClass, "min-w-11", isNumber ? "w-24" : "w-40")}
        value={draft.value}
        onFocus={() => {
          draft.onFocus();
          onTouched();
        }}
        onBlur={draft.onBlur}
        onPointerDown={onTouched}
        onChange={(e) => {
          const input = e.target.value;
          draft.setDraft(input);
          onCellChange(isNumber ? parseTrialNumber(input) : input);
        }}
      />
      {column.unit ? <span className="text-slate-600">{column.unit}</span> : null}
    </div>
  );
}

function TableInput({
  field,
  rows,
  onChange,
  onTouched,
}: {
  field: TrialField;
  rows: TrialTableRow[];
  onChange: OnChange;
  onTouched: OnTouched;
}) {
  const columns = field.columns ?? [];

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
              {columns.map((column) => (
                <TableCellInput
                  key={column.key}
                  column={column}
                  cell={row.cells[column.key]}
                  ariaLabel={`${column.label}, rad ${rowNumber}`}
                  onCellChange={(cellValue) => setCell(row.id, column.key, cellValue)}
                  onTouched={onTouched}
                />
              ))}
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

/** Bildefelt: bare navn og størrelse står i svarene. Filene går til `onAddPhotos` når den er satt. */
function PhotoInput({
  field,
  photos,
  onChange,
  onTouched,
  onAddPhotos,
}: {
  field: TrialField;
  photos: TrialPhoto[];
  onChange: OnChange;
  onTouched: OnTouched;
  onAddPhotos?: OnAddPhotos;
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
        onFocus={onTouched}
        onPointerDown={onTouched}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) {
            const added = files.map((file) => ({
              file,
              photo: { id: uuidv7(), name: file.name, sizeBytes: file.size },
            }));
            if (onAddPhotos) {
              onTouched();
              onAddPhotos(field.key, added);
            } else {
              onChange(field.key, [...photos, ...added.map((item) => item.photo)]);
            }
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
