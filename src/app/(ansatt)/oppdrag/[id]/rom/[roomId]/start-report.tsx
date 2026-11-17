"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { FormMessage } from "@/shared/ui/form";
import { startReportAction } from "./actions";
import { isActionError, ROOM_ACTION_MESSAGES, ROOM_TEXTS } from "./room-messages";

/*
 * Før rapporten finnes (design avsnitt 5). Siden skriver aldri ved lesing: rapporten startes bare
 * når en takstmann trykker «Start rapporten», i en egen serverhandling. Kontoret ser kortet uten
 * knapp. Etter start lastes siden, og første punkt får fokus.
 */

export function StartReport({
  assignmentId,
  canStart,
  roomTitle,
}: {
  assignmentId: string;
  canStart: boolean;
  roomTitle: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const start = async () => {
    setBusy(true);
    setError(null);
    let result: Awaited<ReturnType<typeof startReportAction>>;
    try {
      result = await startReportAction(assignmentId);
    } catch {
      setBusy(false);
      setError(ROOM_ACTION_MESSAGES.startFailed);
      return;
    }
    if (isActionError(result)) {
      setBusy(false);
      setError(
        result.message === ROOM_ACTION_MESSAGES.templateMissing
          ? result.message
          : ROOM_ACTION_MESSAGES.startFailed,
      );
      return;
    }
    router.refresh();
  };

  return (
    <main className="max-w-3xl space-y-4">
      <Link
        href={`/oppdrag/${assignmentId}`}
        className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700"
      >
        <span aria-hidden="true">‹&nbsp;</span>
        {ROOM_TEXTS.back}
      </Link>
      <h1 className="font-heading text-2xl font-semibold text-slate-900">
        {ROOM_TEXTS.roomGroup} <span aria-hidden="true">›</span>
        <span className="sr-only">,</span> {roomTitle}
      </h1>
      <Card>
        <section aria-labelledby="not-started-heading" className="space-y-4">
          <h2 id="not-started-heading" className="text-lg font-semibold text-slate-900">
            {ROOM_TEXTS.notStartedHeading}
          </h2>
          <p className="text-slate-900">
            {canStart ? ROOM_TEXTS.notStartedCanStart : ROOM_TEXTS.notStartedCannotStart}
          </p>
          {canStart && (
            <Button size="lg" disabled={busy} onClick={() => void start()}>
              {busy ? ROOM_TEXTS.starting : ROOM_TEXTS.start}
            </Button>
          )}
          {error && (
            <div ref={errorRef} tabIndex={-1}>
              <FormMessage message={error} />
            </div>
          )}
        </section>
      </Card>
    </main>
  );
}
