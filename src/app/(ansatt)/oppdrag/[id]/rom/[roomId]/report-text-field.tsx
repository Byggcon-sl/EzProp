"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { ReportFieldChange } from "@/core/reports/types";
import { Input, Textarea } from "@/shared/ui/form";
import { Warning } from "@/shared/ui/warning";
import { FieldStatus } from "./field-status";
import { useField, useRoom } from "./room-context";
import { characterCountText, checkReportText, domId } from "./room-model";

/*
 * Felles tekstfelt i rapporten (design avsnitt 15, kortet «KI i bunnen» og «Rettes i koden» 6):
 * avvik, årsak, konsekvens, tiltak, beskrivelse av punktet og TGIU-feltene. Lagres per felt når
 * feltet forlates og 800 ms etter siste tastetrykk; teksten står i lagringskøen, så den overlever
 * bytte av punkt. Over feltet er plassen for KI-merket (`AiTextMark`) og under det plassen for
 * forslagskortet (`AiSuggestion`); begge er tomme nå, og det finnes ingen KI-knapp. `text_source`
 * settes av serveren og sier aldri noe om KI.
 * Støtter hovedmål: KI i bunnen (krokene står klare), de ansatte (ingen tekst går tapt).
 */

export type ReportTextFieldProps = {
  /** Nøkkelen i lagringskøen. Feltets id i DOM-en lages av den. */
  fieldKey: string;
  label: string;
  /** Lagret verdi fra serveren. */
  serverValue: string | null;
  /** Lager endringen. `value` og `base` er teksten (tom tekst er tom verdi). */
  build(value: string, base: string): ReportFieldChange;
  hint?: ReactNode;
  /** Advarsler under feltet (sperrer ikke). */
  warnings?: readonly { id: string; text: ReactNode; action?: ReactNode }[];
  /** Én linje i stedet for flere (for eksempel kostnadsforklaring). */
  singleLine?: boolean;
  /** Plass for KI-merket over feltet. Tom nå («KI i veien» kobler seg på her). */
  aiMark?: ReactNode;
  /** Plass for forslagskortet under feltet. Tom nå. */
  aiSuggestion?: ReactNode;
};

const MAX_ROWS = 12;

/** Tekstfeltet vokser med innholdet til 12 linjer. */
function useAutoGrow(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(element).lineHeight) || 24;
    const max = lineHeight * MAX_ROWS + 24;
    element.style.height = `${Math.min(element.scrollHeight + 2, max)}px`;
  }, [ref, value]);
}

export function ReportTextField({
  fieldKey,
  label,
  serverValue,
  build,
  hint,
  warnings = [],
  singleLine = false,
  aiMark,
  aiSuggestion,
}: ReportTextFieldProps) {
  const { canEdit } = useRoom();
  const field = useField(
    fieldKey,
    serverValue ?? "",
    (value, base) => build(String(value ?? ""), String(base ?? "")),
    { validate: checkReportText },
  );
  const value = String(field.entry.value ?? "");
  const id = domId(fieldKey);
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(ref, value);

  if (!canEdit) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium text-slate-700">{label}</p>
        <p className="break-words whitespace-pre-wrap text-slate-900">{value || "–"}</p>
      </div>
    );
  }

  const error = field.entry.status === "invalid" ? (field.entry.error ?? undefined) : undefined;
  const count = characterCountText(value.length);
  const describedBy = [
    hint ? `${id}-hint` : null,
    error ? `${id}-error` : null,
    count ? `${id}-count` : null,
    ...warnings.map((w) => w.id),
  ]
    .filter(Boolean)
    .join(" ");
  const common = {
    id,
    value,
    "aria-describedby": describedBy || undefined,
    "aria-invalid": error ? true : undefined,
    onChange: (event: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) =>
      field.edit(event.target.value),
    onBlur: () => field.commit(),
  };

  return (
    <div className="space-y-1.5">
      {aiMark ? <div>{aiMark}</div> : null}
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      {singleLine ? (
        <Input {...common} />
      ) : (
        <Textarea ref={ref} rows={3} className="min-h-24 resize-none" {...common} />
      )}
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-slate-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-urgent-text">
          <span className="sr-only">Feil: </span>
          {error}
        </p>
      )}
      {count && (
        <p id={`${id}-count`} className="text-right text-sm text-slate-700">
          {count}
        </p>
      )}
      <FieldStatus field={field} formatValue={(v) => String(v ?? "")} />
      {warnings.map((warning) => (
        <Warning key={warning.id} id={warning.id} action={warning.action}>
          {warning.text}
        </Warning>
      ))}
      {aiSuggestion ? <div>{aiSuggestion}</div> : null}
    </div>
  );
}
