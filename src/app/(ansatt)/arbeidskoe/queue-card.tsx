import Link from "next/link";
import {
  assignmentStatusLabel,
  isOverdue,
  NOTE_MAX_LENGTH,
  type listWorkQueue,
} from "@/core/assignments";
import { cn } from "@/shared/lib/cn";
import { Badge } from "@/shared/ui/badge";
import { Button, buttonVariants } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Field, Textarea } from "@/shared/ui/form";
import { formatDueDate, formatInspectionAt } from "../oslo-format";
import { saveNoteAction } from "./actions";
import { cardAnchor, queueHref, type QueueState } from "./queue-href";

export type WorkQueueItem = Awaited<ReturnType<typeof listWorkQueue>>["items"][number];

function PersonIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5" fill="currentColor">
      <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5 6a5 5 0 0 1 10 0v.5H3V14Z" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="currentColor">
      <path d="M11.7 1.3a1 1 0 0 1 1.4 0l1.6 1.6a1 1 0 0 1 0 1.4L5.6 13.4 2 14l.6-3.6 9.1-9.1Z" />
    </svg>
  );
}

/**
 * Merkene i fast rekkefølge: status, Rettet, befaring, frist, Forfalt, takstmann. Teksten bærer
 * betydningen; fargen er bare tillegg.
 */
function Badges({ item, now }: { item: WorkQueueItem; now: Date }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Badge tone="brand">{assignmentStatusLabel(item.status)}</Badge>
      {item.corrected && <Badge tone="warning">Rettet</Badge>}
      <Badge>
        {item.inspectionAt
          ? `Befaring ${formatInspectionAt(item.inspectionAt, now)}`
          : "Befaring ikke avtalt"}
      </Badge>
      <Badge>{item.dueDate ? `Frist ${formatDueDate(item.dueDate, now)}` : "Ingen frist"}</Badge>
      {isOverdue({ dueDate: item.dueDate, status: item.status }, now) && (
        <Badge tone="danger">Forfalt</Badge>
      )}
      <Badge>
        <span className="inline-flex items-center gap-1">
          <PersonIcon />
          {item.responsibleName ? (
            <>
              <span className="sr-only">Ansvarlig takstmann: </span>
              {item.responsibleName}
            </>
          ) : (
            "Ingen ansvarlig"
          )}
        </span>
      </Badge>
    </div>
  );
}

/**
 * Ett oppdrag i arbeidskøen: adressen som lenke til oppdraget, nummeret, merkene og notatet.
 * Notatet redigeres i `<details>` med et vanlig skjema (virker uten JavaScript). «Avbryt» er en
 * vanlig lenke til samme kø-adresse, så siden lastes på nytt og `<details>` lukkes. Skjemaet
 * vises ut fra `canEdit`; selve sjekken skjer i kjernen.
 */
export function QueueCard({
  item,
  queue,
  canEdit,
  noteError,
  now,
}: {
  item: WorkQueueItem;
  queue: QueueState;
  canEdit: boolean;
  /** Feilen ved notatet etter et mislykket «Lagre», eller `null`. */
  noteError: string | null;
  now: Date;
}) {
  const noteId = `note-${item.id}`;
  const noteTextId = `note-text-${item.id}`;
  return (
    <li
      id={cardAnchor(item.id)}
      tabIndex={-1}
      data-testid="work-queue-card"
      className="rounded-card"
    >
      <Card className="p-5">
        <Link
          href={`/oppdrag/${item.id}`}
          className="flex min-h-11 items-center py-1 text-lg font-medium break-words text-slate-900 hover:text-brand-700 hover:underline"
        >
          {item.address ?? "Adresse mangler"}
        </Link>
        <p className="mt-0.5 text-sm text-slate-600 tabular-nums">{item.number}</p>
        <Badges item={item} now={now} />

        {(item.internalNote || canEdit) && (
          <div className="mt-4 border-t border-slate-200 pt-3">
            {item.internalNote && (
              <p id={noteTextId} className="text-base break-words text-slate-800">
                <span className="sr-only">Notat: </span>
                {item.internalNote}
              </p>
            )}
            {canEdit && (
              <details open={noteError !== null}>
                <summary
                  aria-describedby={item.internalNote ? noteTextId : undefined}
                  className={cn(
                    buttonVariants({ variant: "ghost" }),
                    "-ml-3 w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden",
                  )}
                >
                  <PencilIcon />
                  Notat
                </summary>
                <form action={saveNoteAction} className="mt-2 space-y-3">
                  <input type="hidden" name="assignmentId" value={item.id} />
                  <input type="hidden" name="status" value={queue.status} />
                  <input type="hidden" name="mine" value={queue.mineOnly ? "1" : "0"} />
                  <input type="hidden" name="q" value={queue.query} />
                  <Field
                    label="Notat"
                    htmlFor={noteId}
                    hint="Internt, høyst 200 tegn. Kommer aldri i rapporten."
                    error={noteError ?? undefined}
                  >
                    <Textarea
                      id={noteId}
                      name="note"
                      rows={2}
                      maxLength={NOTE_MAX_LENGTH}
                      className="min-h-20"
                      defaultValue={item.internalNote ?? ""}
                    />
                  </Field>
                  <div className="flex gap-3">
                    <Button type="submit">Lagre</Button>
                    <a href={queueHref(queue)} className={buttonVariants({ variant: "secondary" })}>
                      Avbryt
                    </a>
                  </div>
                </form>
              </details>
            )}
          </div>
        )}
      </Card>
    </li>
  );
}
