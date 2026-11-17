import { cn } from "@/shared/lib/cn";
import { Button } from "./button";

/*
 * Lagrestatus per felt og samlet (docs/funksjoner/fase2a-badet-pc-design.md avsnitt 10 og 14).
 * Bruker bare synk-tokenene, aldri TG-farger. Ikon og tekst står alltid sammen. Ingen kobling til
 * lagringen: komponenten får bare statusen. Bare den samlede statusen har `role="status"`, så
 * skjermleseren ikke leser opp hvert felt. Importerer ingenting fra `src/core`.
 * Støtter hovedmål: de ansatte (ser alltid om teksten er lagret, mister den aldri).
 */

export type SaveStatus = "saved" | "saving" | "failed" | "offline";

export type SaveStateProps = {
  status: SaveStatus;
  savedAt?: Date;
  scope: "field" | "total";
  /** Antall felt som ikke er lagret (samlet status ved `failed`). */
  failedCount?: number;
  onRetry?(): void;
  className?: string;
};

export const SAVE_STATE_TEXTS = {
  field: {
    saved: "Lagret",
    saving: "Lagrer …",
    failed: "Ikke lagret – prøv igjen",
    offline: "Uten nett",
  },
  retry: "Prøv igjen",
  totalSaving: "Lagrer …",
  totalOffline: "Uten nett – endringene dine er ikke lagret ennå",
} as const;

/** «Alt er lagret · 10:42» (norsk tid på enheten). */
export function totalSavedText(savedAt?: Date): string {
  if (!savedAt) return "Alt er lagret";
  const time = new Intl.DateTimeFormat("nb-NO", { hour: "2-digit", minute: "2-digit" }).format(
    savedAt,
  );
  return `Alt er lagret · ${time}`;
}

/** «1 felt er ikke lagret – prøv igjen». */
export function totalFailedText(count: number): string {
  return `${count} felt er ikke lagret – prøv igjen`;
}

/** Teksten for statusen. */
export function saveStateText(
  props: Pick<SaveStateProps, "status" | "scope" | "savedAt" | "failedCount">,
) {
  if (props.scope === "field") return SAVE_STATE_TEXTS.field[props.status];
  switch (props.status) {
    case "saved":
      return totalSavedText(props.savedAt);
    case "saving":
      return SAVE_STATE_TEXTS.totalSaving;
    case "failed":
      return totalFailedText(Math.max(1, props.failedCount ?? 1));
    case "offline":
      return SAVE_STATE_TEXTS.totalOffline;
  }
}

/** Tekstfarge og flate fra synk-tokenene. Skrevet ut, så Tailwind finner klassene. */
const TEXT_TONES: Record<SaveStatus, string> = {
  saved: "text-sync-saved-text",
  saving: "text-sync-pending-text",
  failed: "text-sync-waiting-text",
  offline: "text-sync-offline-text",
};

const PILL_TONES: Record<SaveStatus, string> = {
  saved: "bg-sync-saved-bg text-sync-saved-text",
  saving: "bg-sync-pending-bg text-sync-pending-text",
  failed: "bg-sync-waiting-bg text-sync-waiting-text",
  offline: "bg-sync-offline-bg text-sync-offline-text",
};

function StatusIcon({ status }: { status: SaveStatus }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false,
    className: "shrink-0",
  };
  switch (status) {
    case "saved":
      return (
        <svg {...common}>
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      );
    case "saving":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l2.5 2.5" />
        </svg>
      );
    case "failed":
      return (
        <svg {...common}>
          <path d="M12 7v6" />
          <path d="M12 17h.01" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
    case "offline":
      return (
        <svg {...common}>
          <path d="M3 3l18 18" />
          <path d="M8.5 16.5a5 5 0 017 0" />
          <path d="M5 13a10 10 0 0114 0" />
        </svg>
      );
  }
}

export function SaveState({
  status,
  savedAt,
  scope,
  failedCount,
  onRetry,
  className,
}: SaveStateProps) {
  const text = saveStateText({ status, scope, savedAt, failedCount });
  if (scope === "field") {
    return (
      <div className={cn("flex flex-wrap items-center justify-end gap-2", className)}>
        <span
          className={cn("inline-flex items-center gap-1.5 text-sm", TEXT_TONES[status])}
          data-save-state={status}
        >
          <StatusIcon status={status} />
          {text}
        </span>
        {status === "failed" && onRetry && (
          <Button variant="secondary" onClick={onRetry}>
            {SAVE_STATE_TEXTS.retry}
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <span
        role="status"
        aria-live="polite"
        data-save-state={status}
        className={cn(
          "inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium",
          PILL_TONES[status],
        )}
      >
        <StatusIcon status={status} />
        {text}
      </span>
      {status === "failed" && onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          {SAVE_STATE_TEXTS.retry}
        </Button>
      )}
    </div>
  );
}
