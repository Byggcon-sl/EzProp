import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

/*
 * Advarsel som ikke sperrer (docs/funksjoner/fase2a-badet-pc-design.md avsnitt 13 og 14). Flate
 * `sand` og trekantikon i `night`, ikke TG-tonene (gult betyr TG2). «Se over:» står foran som
 * tekst for skjermleser. Ikke `role="alert"`: advarselen skal ikke avbryte, og leses opp via
 * `aria-describedby` eller statusområdet på punktet. Valgfri handling (for eksempel «Rett nå»)
 * står til høyre. Importerer ingenting fra `src/core`.
 * Støtter hovedmål: færre reklamasjoner (mangler synes før rapporten går ut) og de ansatte.
 */

export const WARNING_SCREEN_READER_PREFIX = "Se over: ";

export type WarningProps = {
  id?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
  /** Gjør advarselen fokuserbar, så «Rett nå» og «gå til neste» kan legge fokus på den. */
  focusable?: boolean;
};

export function Warning({ id, children, action, className, focusable = false }: WarningProps) {
  return (
    <div
      id={id}
      tabIndex={focusable ? -1 : undefined}
      className={cn(
        "flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl bg-sand px-4 py-3 text-sm text-slate-900",
        className,
      )}
    >
      <p className="flex min-w-0 flex-1 basis-60 items-start gap-2">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
          className="mt-0.5 shrink-0 text-night"
        >
          <path d="M12 3.5L2.5 20h19L12 3.5z" />
          <path d="M12 10v4.5" />
          <path d="M12 17.5h.01" />
        </svg>
        <span className="min-w-0 break-words">
          <span className="sr-only">{WARNING_SCREEN_READER_PREFIX}</span>
          {children}
        </span>
      </p>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}
