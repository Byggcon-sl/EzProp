"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/shared/ui/button";
import { SaveState } from "@/shared/ui/save-state";
import type { FieldHandle } from "./room-context";
import { displayStatus } from "./field-save-store";
import { useRoom } from "./room-context";

/*
 * Lagrestatus og «Endret av andre» under et felt (design avsnitt 10). Ingenting overskrives før
 * takstmannen har valgt «Bruk nyeste» eller «Behold min og lagre».
 */

export const CONFLICT_TEXTS = {
  title: "Endret av andre",
  heading: "Noen andre har endret dette feltet. Nyeste verdi:",
  useLatest: "Bruk nyeste",
  keepMine: "Behold min og lagre",
  showAll: "Vis alt",
  empty: "(tomt)",
} as const;

export function FieldStatus({
  field,
  formatValue,
}: {
  field: FieldHandle;
  /** Verdien som tekst i konfliktmeldingen. */
  formatValue(value: unknown): string;
}) {
  const { announce } = useRoom();
  const { entry } = field;
  const status = displayStatus(entry.status);
  const conflictRef = useRef<HTMLDivElement>(null);
  const [showAll, setShowAll] = useState(false);
  const inConflict = entry.status === "conflict";

  useEffect(() => {
    if (!inConflict) return;
    conflictRef.current?.focus();
    announce("Endret av andre");
  }, [inConflict, announce]);

  if (inConflict) {
    const text = formatValue(entry.conflictValue) || CONFLICT_TEXTS.empty;
    const long = text.split("\n").length > 6 || text.length > 600;
    return (
      <div
        ref={conflictRef}
        tabIndex={-1}
        className="space-y-3 rounded-card bg-sand p-4 text-sm text-slate-900"
      >
        <p className="font-semibold">{CONFLICT_TEXTS.title}</p>
        <p className="font-medium">{CONFLICT_TEXTS.heading}</p>
        <p
          className={long && !showAll ? "line-clamp-6 whitespace-pre-wrap" : "whitespace-pre-wrap"}
        >
          {text}
        </p>
        {long && !showAll && (
          <Button variant="ghost" onClick={() => setShowAll(true)}>
            {CONFLICT_TEXTS.showAll}
          </Button>
        )}
        <div className="flex flex-wrap gap-2 md:gap-3">
          <Button onClick={field.takeLatest}>{CONFLICT_TEXTS.useLatest}</Button>
          <Button variant="secondary" onClick={field.keepMine}>
            {CONFLICT_TEXTS.keepMine}
          </Button>
        </div>
      </div>
    );
  }
  if (status === null) return null;
  return (
    <SaveState
      scope="field"
      status={status}
      onRetry={entry.status === "failed" ? field.retry : undefined}
    />
  );
}
