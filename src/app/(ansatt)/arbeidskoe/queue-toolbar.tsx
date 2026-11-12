import Link from "next/link";
import {
  ASSIGNMENT_STATUSES,
  assignmentStatusLabel,
  type countWorkQueueByStatus,
} from "@/core/assignments";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/form";
import { QUEUE_PATH, queueHref, type QueueState } from "./queue-href";

export type WorkQueueCounts = Awaited<ReturnType<typeof countWorkQueueByStatus>>;

const SEARCH_LABEL = "Søk på adresse eller oppdragsnummer";

const segmentList = "flex flex-wrap gap-1 rounded-xl bg-white/60 p-1 ring-1 ring-slate-200/60";
const segmentLink =
  "inline-flex min-h-11 items-center gap-2 rounded-lg px-4 text-base text-slate-700 hover:bg-white";
const segmentCurrent = "bg-white font-medium text-slate-900 ring-1 ring-line";

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-slate-500"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="9" cy="9" r="6" />
      <path d="m14 14 4 4" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Fanene etter status (med antall), Mine/Alle og søket. Fanene og filteret er lenker i `<nav>`
 * med `aria-current`, så tilbake-knappen virker. Søket er et vanlig GET-skjema.
 */
export function QueueToolbar({ queue, counts }: { queue: QueueState; counts: WorkQueueCounts }) {
  return (
    <>
      <nav aria-label="Status" className="mt-6">
        <ul className={segmentList}>
          {ASSIGNMENT_STATUSES.map((status) => {
            const current = status === queue.status;
            return (
              <li key={status}>
                <Link
                  href={queueHref({ ...queue, status })}
                  aria-current={current ? "page" : undefined}
                  className={cn(segmentLink, current && segmentCurrent)}
                >
                  {assignmentStatusLabel(status)}
                  <span
                    data-testid={`work-queue-count-${status}`}
                    className={cn(
                      "rounded-full px-2 text-sm tabular-nums",
                      current ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-700",
                    )}
                  >
                    {counts[status]}
                  </span>
                  <span className="sr-only"> oppdrag</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <nav aria-label="Filter">
          <ul className={segmentList}>
            {[
              { mineOnly: true, label: "Mine" },
              { mineOnly: false, label: "Alle" },
            ].map((option) => {
              const current = option.mineOnly === queue.mineOnly;
              return (
                <li key={option.label}>
                  <Link
                    href={queueHref({ ...queue, mineOnly: option.mineOnly })}
                    aria-current={current ? "page" : undefined}
                    className={cn(segmentLink, current && segmentCurrent)}
                  >
                    {option.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <form
          method="get"
          action={QUEUE_PATH}
          role="search"
          className="flex min-w-64 flex-1 items-center gap-3"
        >
          <input type="hidden" name="status" value={queue.status} />
          {!queue.mineOnly && <input type="hidden" name="mine" value="0" />}
          <label htmlFor="work-queue-q" className="sr-only">
            {SEARCH_LABEL}
          </label>
          <div className="relative min-w-0 flex-1">
            <SearchIcon />
            <Input
              id="work-queue-q"
              name="q"
              type="search"
              maxLength={100}
              placeholder={SEARCH_LABEL}
              defaultValue={queue.query}
              className="pl-10"
            />
          </div>
          <Button type="submit" variant="secondary">
            Søk
          </Button>
        </form>
      </div>
      {queue.query !== "" && (
        <Link
          href={queueHref({ ...queue, query: "" })}
          className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-brand-700 hover:underline"
        >
          Tøm søk
        </Link>
      )}
    </>
  );
}
