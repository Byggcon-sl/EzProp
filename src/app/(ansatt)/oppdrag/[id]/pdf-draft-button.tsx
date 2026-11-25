"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/shared/lib/cn";
import { useOnline } from "@/shared/lib/use-online";
import { buttonVariants } from "@/shared/ui/button";
import { FormMessage } from "@/shared/ui/form";
import { SaveState } from "@/shared/ui/save-state";
import { draftPdfHref, PDF_BUTTON_TEXTS } from "./pdf-texts";

/*
 * Knappen «Lag PDF (utkast)» (docs/funksjoner/fase2a-pdf-badet.md, Skjermer; designet avsnitt
 * 5.1). Én komponent på badet og på oppdraget. Ingen tilgangslogikk: ruten sjekker innlogging og
 * tilgang selv, og knappen vises bare der siden alt har lest rapporten.
 *
 * - Uten ventende lagring er knappen en vanlig lenke til ruten i ny fane. Ingen `next/link`, så
 *   ingenting hentes på forhånd.
 * - Med ventende lagring (badet) åpnes fanen i samme trykk, og adressen settes når lagringen er
 *   ferdig. Safari på iPad blokkerer `window.open` etter `fetch`, så fanen må åpnes først.
 * - Uten nett er knappen sperret med forklaring.
 *
 * Støtter hovedmål: de ansatte (ett trykk gir PDF-en, også på iPad) og færre reklamasjoner (det
 * som nettopp er skrevet, kommer med i PDF-en).
 */

/** Lagringskøen på badet slik knappen ser den. */
export type PendingSaves = {
  hasUnsaved(): boolean;
  flush(): Promise<{ ok: boolean }>;
};

/** Hvor lenge «Lager PDF …» høyst vises når vi ikke merker at fanen er åpnet. */
const CREATING_MAX_MS = 6000;

type Phase = "idle" | "saving" | "creating" | "failed";

export function PdfIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
      className="shrink-0 motion-safe:animate-spin"
    >
      <path d="M12 3a9 9 0 109 9" />
    </svg>
  );
}

/**
 * Forklaringen uten nett, med synkstatusen ved siden av. Vises bare uten nett. `showSyncStatus`
 * er av der siden alt viser synkstatusen (badet).
 */
export function PdfOfflineNote({ id, showSyncStatus }: { id: string; showSyncStatus: boolean }) {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <p id={id} className="text-sm text-slate-700">
        {PDF_BUTTON_TEXTS.offline}
      </p>
      {showSyncStatus && <SaveState scope="field" status="offline" className="justify-start" />}
    </div>
  );
}

/** Teller ned «Lager PDF …»: borte når den ansatte er tilbake fra fanen, eller etter en stund. */
function useCreatingDone(active: boolean, done: () => void) {
  const doneRef = useRef(done);
  useEffect(() => {
    doneRef.current = done;
  });
  useEffect(() => {
    if (!active) return;
    let left = document.visibilityState === "hidden";
    const finish = () => doneRef.current();
    const onBlur = () => {
      left = true;
    };
    const onBack = () => {
      if (left && document.visibilityState === "visible") finish();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") left = true;
      else onBack();
    };
    const timer = window.setTimeout(finish, CREATING_MAX_MS);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onBack);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onBack);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active]);
}

export function DraftPdfButton({
  assignmentId,
  saves = null,
  showSyncStatus,
  className,
}: {
  assignmentId: string;
  /** Lagringskøen på badet. Uten kø (oppdraget) er knappen alltid en lenke. */
  saves?: PendingSaves | null;
  /** Vis «Uten nett» ved siden av forklaringen. Av der siden alt viser synkstatusen. */
  showSyncStatus: boolean;
  className?: string;
}) {
  const href = draftPdfHref(assignmentId);
  const online = useOnline();
  const [phase, setPhase] = useState<Phase>("idle");
  const errorRef = useRef<HTMLDivElement>(null);
  const noteId = useId();

  useCreatingDone(phase === "creating", () => setPhase("idle"));

  useEffect(() => {
    if (phase === "failed") errorRef.current?.focus();
  }, [phase]);

  const onClick = async (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!saves || !saves.hasUnsaved()) {
      // Lenken åpner fanen selv. Statusen byttes etter klikket, så lenken får gjøre jobben sin.
      window.setTimeout(() => setPhase("creating"), 0);
      return;
    }
    event.preventDefault();
    // Fanen åpnes i samme trykk; adressen settes når lagringen er ferdig.
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    setPhase("saving");
    let ok = false;
    try {
      ok = (await saves.flush()).ok;
    } catch {
      ok = false;
    }
    if (!ok) {
      tab?.close();
      setPhase("failed");
      return;
    }
    if (tab && !tab.closed) tab.location.href = href;
    else window.open(href, "_blank", "noopener");
    setPhase("creating");
  };

  const status =
    phase === "saving"
      ? PDF_BUTTON_TEXTS.saving
      : phase === "creating"
        ? PDF_BUTTON_TEXTS.creatingStatus
        : "";
  const classes = cn(buttonVariants({ variant: "secondary", size: "md" }), "shrink-0");

  let control: React.ReactNode;
  if (phase === "saving") {
    control = (
      <button type="button" aria-disabled="true" className={classes}>
        <Spinner />
        {PDF_BUTTON_TEXTS.saving}
      </button>
    );
  } else if (phase === "creating") {
    control = (
      <button type="button" disabled className={classes}>
        <Spinner />
        {PDF_BUTTON_TEXTS.creating}
      </button>
    );
  } else if (!online) {
    control = (
      <button type="button" disabled aria-describedby={noteId} className={classes}>
        <PdfIcon />
        {PDF_BUTTON_TEXTS.create}
      </button>
    );
  } else {
    control = (
      <a
        href={href}
        target="_blank"
        rel="noopener"
        onClick={(event) => void onClick(event)}
        className={classes}
      >
        <PdfIcon />
        {PDF_BUTTON_TEXTS.create}
        <span className="sr-only"> {PDF_BUTTON_TEXTS.newTab}</span>
      </a>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)} data-pdf-draft="">
      {phase === "failed" && (
        <div ref={errorRef} tabIndex={-1} className="rounded-xl">
          <FormMessage message={PDF_BUTTON_TEXTS.saveFailed} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">{control}</div>
      <span role="status" aria-live="polite" className="sr-only">
        {status}
      </span>
      <PdfOfflineNote id={noteId} showSyncStatus={showSyncStatus} />
    </div>
  );
}
