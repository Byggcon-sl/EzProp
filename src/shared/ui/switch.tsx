"use client";

import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

/*
 * Bryter med tekst (docs/funksjoner/fase2a-publisering-badet-design.md avsnitt 8). Brukes der et
 * valg må gjøres aktivt, for eksempel «Publiser likevel». Ekte `<button role="switch">` med
 * `aria-checked`, så mellomrom og Enter veksler uten egen kode. Hele raden (etikett, bryter og
 * tilstandstekst) er trykkflaten og minst 44 pt høy. Tilstanden står alltid som tekst («Av» /
 * «På»), aldri bare som farge eller plassering. Ingen animasjon. Importerer ingenting fra
 * `src/core`, `src/db` eller modulene.
 * Støtter hovedmål: færre reklamasjoner (et aktivt, tydelig valg) og de ansatte (stor flate).
 */

export const SWITCH_STATE_TEXTS = { off: "Av", on: "På" } as const;

export type SwitchProps = {
  id: string;
  label: ReactNode;
  checked: boolean;
  onChange(checked: boolean): void;
  disabled?: boolean;
  /** Ekstra id-er for `aria-describedby`, for eksempel en hjelpetekst under raden. */
  describedBy?: string;
};

export function Switch({
  id,
  label,
  checked,
  onChange,
  disabled = false,
  describedBy,
}: SwitchProps) {
  const labelId = `${id}-label`;
  const stateId = `${id}-state`;
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-labelledby={`${labelId} ${stateId}`}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex min-h-11 w-full items-center gap-3 rounded-xl px-1 py-1.5 text-left",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fjord",
        disabled ? "cursor-default text-slate-500" : "cursor-pointer text-slate-900",
      )}
    >
      <span id={labelId} className="min-w-0 flex-1 text-base font-medium">
        {label}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex h-8 w-13 shrink-0 items-center rounded-full",
          checked ? "bg-night" : "bg-white ring-1 ring-field ring-inset",
        )}
      >
        <span
          className={cn(
            "absolute top-1 flex size-6 items-center justify-center rounded-full bg-white",
            checked ? "left-6 text-night" : "left-1 ring-1 ring-field",
          )}
        >
          {checked && (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              focusable="false"
            >
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          )}
        </span>
      </span>
      <span id={stateId} className="w-6 shrink-0 text-sm">
        {checked ? SWITCH_STATE_TEXTS.on : SWITCH_STATE_TEXTS.off}
      </span>
    </button>
  );
}
