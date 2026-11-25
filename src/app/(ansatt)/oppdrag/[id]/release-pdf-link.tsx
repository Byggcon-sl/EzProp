"use client";

import { useId } from "react";
import { cn } from "@/shared/lib/cn";
import { useOnline } from "@/shared/lib/use-online";
import { buttonVariants } from "@/shared/ui/button";
import { PdfIcon, PdfOfflineNote } from "./pdf-draft-button";
import { RELEASE_PDF_TEXTS, releasePdfHref } from "./pdf-texts";

/*
 * «Åpne PDF» for én utgivelse (docs/funksjoner/fase2a-pdf-badet.md Omfang 6b og F7; designet
 * avsnitt 5.2). Vanlig `<a>` i ny fane, aldri `next/link`, så ingenting hentes på forhånd. Uten
 * nett er lenken sperret med samme forklaring som «Lag PDF (utkast)». Ingen tilgangslogikk: ruten
 * sjekker tilgangen selv.
 * Støtter hovedmål: færre reklamasjoner (leder ser teksten og TG slik de ble publisert) og de
 * ansatte (ett trykk).
 */

export function ReleasePdfLink({
  assignmentId,
  releaseId,
  versionNumber,
  offlineNoteId,
  className,
}: {
  assignmentId: string;
  releaseId: string;
  versionNumber: number;
  /**
   * Id-en til en felles forklaring uten nett (utgivelseskortet har én for alle versjonene). Uten
   * den viser lenken sin egen forklaring med synkstatus.
   */
  offlineNoteId?: string;
  className?: string;
}) {
  const online = useOnline();
  const ownNoteId = useId();
  const noteId = offlineNoteId ?? ownNoteId;
  const classes = cn(buttonVariants({ variant: "secondary", size: "md" }), "shrink-0", className);
  const label = RELEASE_PDF_TEXTS.openLabel(versionNumber);
  const control = online ? (
    <a
      href={releasePdfHref(assignmentId, releaseId)}
      target="_blank"
      rel="noopener"
      aria-label={label}
      className={classes}
      data-release-pdf={versionNumber}
    >
      <PdfIcon />
      {RELEASE_PDF_TEXTS.open}
    </a>
  ) : (
    <button
      type="button"
      disabled
      aria-label={label}
      aria-describedby={noteId}
      className={classes}
      data-release-pdf={versionNumber}
    >
      <PdfIcon />
      {RELEASE_PDF_TEXTS.open}
    </button>
  );
  if (offlineNoteId) return control;
  return (
    <div className="flex flex-col items-start gap-2">
      {control}
      <PdfOfflineNote id={ownNoteId} showSyncStatus />
    </div>
  );
}
