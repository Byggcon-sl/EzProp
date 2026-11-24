"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { ReportFieldChange } from "@/core/reports/types";
import { Badge } from "@/shared/ui/badge";
import { Input, Textarea } from "@/shared/ui/form";
import { Warning } from "@/shared/ui/warning";
import { FieldStatus } from "./field-status";
import { useField, useRoom } from "./room-context";
import { AI_ROOM_TEXTS } from "./room-messages";
import { characterCountText, domId, REPORT_TEXT_LIMITS, reportTextValidator } from "./room-model";
import { opensPhraseList } from "./shortcuts";

/*
 * Felles tekstfelt i rapporten (design avsnitt 15, kortet «KI i bunnen» og «Rettes i koden» 6):
 * avvik, årsak, konsekvens, tiltak, beskrivelse av punktet og TGIU-feltene. Lagres per felt når
 * feltet forlates og 800 ms etter siste tastetrykk; teksten står i lagringskøen, så den overlever
 * bytte av punkt. Over feltet er plassen for KI-merket (`AiTextMark`), i etikettlinjen plassen
 * for «Forslag» eller «Språkvask» (`labelAction`), og under feltet plassen for «Angre» og for
 * forslagslisten eller forslagskortet («KI i veien», designet avsnitt 7). «Utkast» står ved
 * etiketten når teksten er malens standardtekst som ikke er godkjent ennå (D4). Tekst med en
 * plassholder fra vasken lagres ikke (A466). `text_source` settes av serveren.
 * Støtter hovedmål: KI i bunnen (samme felt for alle KI-funksjoner), de ansatte (ingen tekst går
 * tapt, ingenting hopper når knappene kommer og går).
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
  /** Lengdegrensen (samme som serveren). Standard: lang fritekst. */
  maxLength?: number;
  /** Én linje i stedet for flere (for eksempel kostnadsforklaring). */
  singleLine?: boolean;
  /** Plass for KI-merket over feltet. */
  aiMark?: ReactNode;
  /** Plass for forslagslisten eller forslagskortet under feltet. */
  aiSuggestion?: ReactNode;
  /** Står til høyre i etikettlinjen («Forslag», «Språkvask»). Bare når feltet kan endres. */
  labelAction?: ReactNode;
  /** Merket «Utkast»: teksten er malens standardtekst med `text_status = draft` (D4). */
  draftMark?: boolean;
  /** Plassen for linjen med «Angre», mellom lagrestatusen og forslagslisten. */
  undo?: ReactNode;
  /** «/» først i tomt felt eller Ctrl+. (A438). Uten funksjon skrives tegnet som vanlig. */
  onSuggestShortcut?: () => void;
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
  maxLength = REPORT_TEXT_LIMITS.long,
  aiMark,
  aiSuggestion,
  labelAction,
  draftMark = false,
  undo,
  onSuggestShortcut,
}: ReportTextFieldProps) {
  const { canEdit } = useRoom();
  const field = useField(
    fieldKey,
    serverValue ?? "",
    (value, base) => build(String(value ?? ""), String(base ?? "")),
    { validate: reportTextValidator(maxLength) },
  );
  const value = String(field.entry.value ?? "");
  const id = domId(fieldKey);
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(ref, value);

  const draftBadge = draftMark ? (
    <Badge>
      {AI_ROOM_TEXTS.draft}
      <span className="sr-only">{AI_ROOM_TEXTS.draftSr}</span>
    </Badge>
  ) : null;

  if (!canEdit) {
    return (
      <div className="space-y-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-700">
          {label}
          {draftBadge}
        </p>
        <p className="break-words whitespace-pre-wrap text-slate-900">{value || "–"}</p>
      </div>
    );
  }

  const error = field.entry.status === "invalid" ? (field.entry.error ?? undefined) : undefined;
  const count = characterCountText(value.length, maxLength);
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
    onKeyDown: onSuggestShortcut
      ? (event: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
          if (
            opensPhraseList({
              key: event.key,
              ctrlKey: event.ctrlKey,
              metaKey: event.metaKey,
              altKey: event.altKey,
              value: event.currentTarget.value,
              isComposing: event.nativeEvent.isComposing,
            })
          ) {
            event.preventDefault();
            onSuggestShortcut();
          }
        }
      : undefined,
  };

  return (
    <div className="space-y-1.5">
      {aiMark ? <div>{aiMark}</div> : null}
      <div className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <label htmlFor={id} className="block text-sm font-medium text-slate-700">
            {label}
          </label>
          {draftBadge}
        </div>
        {labelAction ? <div className="shrink-0">{labelAction}</div> : null}
      </div>
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
      {undo ? <div>{undo}</div> : null}
      {warnings.map((warning) => (
        <Warning key={warning.id} id={warning.id} action={warning.action}>
          {warning.text}
        </Warning>
      ))}
      {aiSuggestion ? <div>{aiSuggestion}</div> : null}
    </div>
  );
}
