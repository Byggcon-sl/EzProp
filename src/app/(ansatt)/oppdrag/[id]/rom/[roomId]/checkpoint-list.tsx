"use client";

import {
  CHECKPOINT_STATUS_LABELS,
  nextCheckpointToReview,
  progressText,
  reviewCountText,
} from "@/core/reports/logic";
import type { CheckpointView, SuggestionView } from "@/core/reports/types";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { TgBadge } from "@/shared/ui/tg-badge";
import { ROOM_TEXTS } from "./room-messages";

/*
 * Listen over kontrollpunktene (design avsnitt 6 og 13): status, TG og advarsler som tekst, aldri
 * bare farge. «x av 8 ferdig» og fremdriften bruker samme tall. «x å se over – gå til neste»
 * hopper til neste punkt med advarsel. Valg av punkt bytter punkt uten ny innlasting.
 */

export const LIST_TEXTS = {
  toReview: (n: number) => `${n} å se over`,
  stale: "Forslag gjelder ikke lenger",
} as const;

export function CheckpointList({
  order,
  names,
  checkpoints,
  suggestions,
  progress,
  currentKey,
  onOpen,
  onReviewNext,
}: {
  order: readonly string[];
  names: ReadonlyMap<string, string>;
  checkpoints: ReadonlyMap<string, CheckpointView>;
  suggestions: readonly SuggestionView[];
  progress: { done: number; total: number };
  currentKey: string;
  onOpen(checkpointKey: string): void;
  onReviewNext(checkpointKey: string): void;
}) {
  const review = nextCheckpointToReview(
    order.map((key) => ({
      checkpointKey: key,
      warningCount: checkpoints.get(key)?.warnings.length ?? 0,
    })),
    currentKey,
  );
  const progressLabel = progressText(progress.done, progress.total);
  return (
    <div className="space-y-4">
      <div className="space-y-2 px-1">
        <h2 className="font-heading text-xl font-semibold text-slate-900">
          {ROOM_TEXTS.listHeading}
        </h2>
        <p className="text-sm text-slate-700">{progressLabel}</p>
        <progress
          max={progress.total}
          value={progress.done}
          aria-label={ROOM_TEXTS.progressLabel}
          aria-valuetext={progressLabel}
          className="h-2 w-full overflow-hidden rounded-full [&::-moz-progress-bar]:bg-fjord [&::-webkit-progress-bar]:bg-line [&::-webkit-progress-value]:bg-fjord"
        />
        {review.next !== null && (
          <Button variant="ghost" className="-ml-1" onClick={() => onReviewNext(review.next!)}>
            {reviewCountText(review.count)}
          </Button>
        )}
      </div>
      <nav aria-label={ROOM_TEXTS.listNav}>
        <ol className="space-y-1">
          {order.map((key) => {
            const checkpoint = checkpoints.get(key);
            const name = names.get(key) ?? key;
            const current = key === currentKey;
            const warnings = checkpoint?.warnings.length ?? 0;
            const stale = suggestions.some((s) => s.checkpointKey === key && s.stale);
            const status = checkpoint?.status ?? "not_started";
            const parts = [
              CHECKPOINT_STATUS_LABELS[status],
              warnings > 0 ? LIST_TEXTS.toReview(warnings) : null,
              stale ? LIST_TEXTS.stale : null,
            ].filter(Boolean);
            return (
              <li key={key}>
                <a
                  href={`?punkt=${encodeURIComponent(key)}`}
                  aria-current={current ? "page" : undefined}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)
                      return;
                    event.preventDefault();
                    onOpen(key);
                  }}
                  className={cn(
                    "block min-h-14 rounded-card px-4 py-3 text-slate-900 hover:bg-white",
                    current && "bg-white ring-2 ring-night ring-inset",
                  )}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="text-base font-medium break-words">{name}</span>
                    {checkpoint?.tg && <TgBadge tg={checkpoint.tg} />}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-700">
                    {status === "done" && (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    )}
                    {parts.join(" · ")}
                  </span>
                </a>
              </li>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}
