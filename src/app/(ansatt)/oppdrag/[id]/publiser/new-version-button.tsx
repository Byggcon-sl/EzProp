"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/shared/ui/button";
import { FormMessage } from "@/shared/ui/form";
import { startNewVersionAction } from "./actions";
import { PUBLISH_TEXTS } from "./publish-texts";

/*
 * «Lag ny versjon» (docs/funksjoner/fase2a-publisering-badet.md Omfang 11, design avsnitt 13).
 * Sekundærknapp, aldri ved siden av en hovedhandling, ingen dialog: eldre utgivelser røres ikke.
 * Serveren sjekker `report.edit`. Etterpå hentes siden på nytt, og sjekken kjøres helt på nytt;
 * ingen overstyring følger med.
 * Støtter hovedmål: færre reklamasjoner (en mangel som ikke er rettet, kommer tilbake som sperre).
 */

export function NewVersionButton({
  assignmentId,
  currentVersion,
  onStarted,
}: {
  assignmentId: string;
  currentVersion: number;
  /** Kalles med teksten «Du retter versjon 2. Versjon 1 er uendret.» før siden hentes på nytt. */
  onStarted?: (message: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await startNewVersionAction(assignmentId);
      if (result.status !== "started") {
        setError(result.message);
        return;
      }
      onStarted?.(PUBLISH_TEXTS.newVersionStarted(result.nextVersionNumber, currentVersion));
      router.refresh();
    } catch {
      setError(PUBLISH_TEXTS.newVersionFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button variant="secondary" disabled={busy} onClick={() => void start()}>
        {busy ? PUBLISH_TEXTS.creatingNewVersion : PUBLISH_TEXTS.newVersion}
      </Button>
      {error && <FormMessage message={error} />}
    </div>
  );
}
