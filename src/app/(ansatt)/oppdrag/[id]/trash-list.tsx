"use client";

import { useId, useState } from "react";
import { restoreKey } from "@/shared/lib/use-restored-focus";
import { Button } from "@/shared/ui/button";
import { Disclosure } from "@/shared/ui/disclosure";
import { FormMessage } from "@/shared/ui/form";
import { UNDO_TOAST_TEXTS, useUndoToast } from "@/shared/ui/undo-toast";
import { SubmitButton } from "../../form-parts";
import { restorePartyAction } from "./actions";
import { restoreStructureAction } from "./bygninger/actions";
import { restoreFailedMessage, restoreResultMessage, type TrashType } from "./trash-texts";
import { TRASH_VIEW_LIMIT, type TrashEntryView } from "./trash-view";

/*
 * Papirkurven på oppdraget (docs/funksjoner/fase2a-papirkurv-design.md avsnitt 4). Ingen
 * tilgangslogikk her: `canRestore` kommer fra siden (samme som «Fjern»), og kjernen sjekker
 * rettigheten. Ingen tømming og ingen «Slett for godt» (regel 3).
 */

/** Henter tilbake med samme kjernefunksjon som «Angre», men `how: "trash"`. */
async function restore(type: TrashType, id: string) {
  return type === "party"
    ? restorePartyAction({ id, how: "trash" })
    : restoreStructureAction({ type, id, how: "trash" });
}

function offlinePrefix(): string {
  return typeof navigator !== "undefined" && navigator.onLine === false
    ? `${UNDO_TOAST_TEXTS.offline} `
    : "";
}

/** «Gjenopprett» for én linje eller ett rom i en gruppe. Feil står under linjen. */
function RestoreForm({ type, id, label }: { type: TrashType; id: string; label: string }) {
  const toast = useUndoToast();
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    let result: Awaited<ReturnType<typeof restore>>;
    try {
      result = await restore(type, id);
    } catch {
      setError(`${offlinePrefix()}${restoreFailedMessage(type)}`);
      return;
    }
    if (!result.ok) {
      setError(`${offlinePrefix()}${restoreFailedMessage(type)}`);
      return;
    }
    toast.showResult(restoreResultMessage(type, label, result), restoreKey(type, id));
  }

  return (
    <form action={submit} className="flex shrink-0 flex-col items-start gap-2">
      <SubmitButton
        variant="secondary"
        size="md"
        pendingLabel="Henter tilbake …"
        ariaLabel={`Gjenopprett ${label}`}
      >
        Gjenopprett
      </SubmitButton>
      {error && <FormMessage message={error} />}
    </form>
  );
}

/** Én linje: hva, hvor, hvem og når, og «Gjenopprett» (bare med endringsrett). */
export function TrashItem({ entry, canRestore }: { entry: TrashEntryView; canRestore: boolean }) {
  const [showChildren, setShowChildren] = useState(false);
  const childrenId = useId();

  return (
    <li className="border-t border-line px-6 py-4 first:border-t-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-0.5">
          <p className="text-base font-medium break-words text-night">{entry.title}</p>
          {entry.where && <p className="text-sm break-words text-stone">{entry.where}</p>}
          <p className="text-sm text-stone">
            {entry.removedPrefix}
            <time dateTime={entry.removedAtIso}>{entry.removedAtText}</time>
          </p>
        </div>
        {canRestore && <RestoreForm type={entry.type} id={entry.id} label={entry.label} />}
      </div>
      {entry.childrenLabel && (
        <div className="mt-2">
          <Button
            variant="ghost"
            size="md"
            className="-ml-2 px-2"
            aria-expanded={showChildren}
            aria-controls={childrenId}
            onClick={() => setShowChildren((open) => !open)}
          >
            {entry.childrenLabel}
          </Button>
          <ul id={childrenId} hidden={!showChildren} className="mt-2 border-l border-line pl-4">
            {entry.children.map((child) => (
              <li
                key={child.id}
                className="flex flex-col gap-2 py-2 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-medium break-words text-night">{child.label}</p>
                  {child.where && <p className="text-sm break-words text-stone">{child.where}</p>}
                </div>
                {canRestore && <RestoreForm type={child.type} id={child.id} label={child.label} />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

/**
 * «Papirkurv (n)» som sammenfoldet del. Tom papirkurv vises ikke. `id` er `papirkurv-bygninger`
 * eller `papirkurv-parter`, som «Mer i papirkurven» åpner.
 */
export function TrashList({
  id,
  entries,
  canRestore,
  truncated,
  className,
}: {
  id: string;
  entries: TrashEntryView[];
  canRestore: boolean;
  /** Kjernen ga 200 linjer: det kan finnes eldre. */
  truncated: boolean;
  className?: string;
}) {
  if (entries.length === 0) return null;
  return (
    <Disclosure id={id} title={`Papirkurv (${entries.length})`} className={className}>
      <ul>
        {entries.map((entry) => (
          <TrashItem key={`${entry.type}:${entry.id}`} entry={entry} canRestore={canRestore} />
        ))}
      </ul>
      {truncated && (
        <p className="border-t border-line px-6 py-3 text-sm text-stone">
          Viser de {TRASH_VIEW_LIMIT} nyeste.
        </p>
      )}
    </Disclosure>
  );
}
