import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

/*
 * Valg som pilleknapper (docs/funksjoner/fase2a-badet-pc-design.md avsnitt 14). Erstatter
 * nedtrekkslister i rapporten (prinsipp 6). Bygget på ekte radioknapper i `<fieldset>` med
 * `<legend>`, så piltaster og skjermleser virker uten egen kode. Selve radioknappen er visuelt
 * skjult; etiketten er pillen, minst 44 × 44 pt. Valgt pille har hakeikon foran, så valget aldri
 * bare er farge. Importerer ingenting fra `src/core`.
 * Støtter hovedmål: de ansatte (ett trykk per valg på iPad og PC) og færre reklamasjoner.
 */

export type ChoiceButtonOption = { value: string; label: ReactNode; disabled?: boolean };

export type ChoiceButtonsProps = {
  /** Id for gruppen. Radioknappene får `<id>-<indeks>`, og den første kan få fokus med `<id>-0`. */
  id: string;
  legend: string;
  /** Skjul gruppenavnet visuelt (det står i en overskrift like over). Skjermleseren får det. */
  legendHidden?: boolean;
  hint?: ReactNode;
  error?: string;
  options: readonly ChoiceButtonOption[];
  value: string | null;
  onChange(value: string): void;
  disabled?: boolean;
  /** Ekstra id-er for `aria-describedby`, for eksempel en advarsel under gruppen. */
  describedBy?: string;
};

function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/** Id-en til radioknappen for et valg. Brukes også for å flytte fokus til gruppen. */
export function choiceButtonId(groupId: string, index: number): string {
  return `${groupId}-${index}`;
}

export function ChoiceButtons({
  id,
  legend,
  legendHidden = false,
  hint,
  error,
  options,
  value,
  onChange,
  disabled = false,
  describedBy,
}: ChoiceButtonsProps) {
  const described =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null, describedBy ?? null]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <fieldset
      id={id}
      aria-describedby={described}
      aria-invalid={error ? true : undefined}
      disabled={disabled}
      className="min-w-0 space-y-1.5"
    >
      <legend
        className={cn("text-sm font-medium text-slate-700", legendHidden && "sr-only", "mb-1.5")}
      >
        {legend}
      </legend>
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-slate-600">
          {hint}
        </p>
      )}
      <div className="flex flex-wrap gap-2 md:gap-3">
        {options.map((option, index) => {
          const inputId = choiceButtonId(id, index);
          const checked = value === option.value;
          const locked = disabled || option.disabled === true;
          return (
            <span key={option.value} className="relative inline-flex">
              <input
                type="radio"
                id={inputId}
                name={id}
                value={option.value}
                checked={checked}
                disabled={locked}
                onChange={() => onChange(option.value)}
                className="peer sr-only"
              />
              <label
                htmlFor={inputId}
                className={cn(
                  "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-1.5 rounded-full px-4 text-base font-medium",
                  "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-fjord",
                  checked
                    ? "bg-night text-white"
                    : "bg-white text-slate-900 ring-1 ring-slate-700 ring-inset hover:bg-slate-100",
                  locked &&
                    !checked &&
                    "cursor-default text-slate-500 ring-slate-300 hover:bg-white",
                  locked && checked && "cursor-default",
                )}
              >
                {checked && <CheckIcon />}
                {option.label}
              </label>
            </span>
          );
        })}
      </div>
      {error && (
        <p id={`${id}-error`} className="text-sm text-urgent-text">
          <span className="sr-only">Feil: </span>
          {error}
        </p>
      )}
    </fieldset>
  );
}
