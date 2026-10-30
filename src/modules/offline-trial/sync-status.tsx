"use client";

/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Synkstatusen som alltid vises øverst på listen og testskjemaet (docs/funksjoner/fase1-synkstatus.md
 * og -skisse.md): tilstand, «Lagret kl.» og knappen «Synk nå». Kjenner ingen kandidat; bruker bare
 * `status()`, `onStatusChange` og `syncNow` fra lageret via props.
 *
 * Prøve F (docs/funksjoner/fase1-prove-f-innlogging.md): når nettet kommer, appen blir synlig igjen
 * eller en synkrunde feiler, spør den serveren om innloggingen gjelder. Har den gått ut, vises
 * «Logg inn på nytt …» og lenken «Logg inn» i stedet for «Synk nå». Aldri uten nett, aldri ved
 * første lasting, ikke noe eget tidsur.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { cn } from "@/shared/lib/cn";
import { Button, buttonVariants } from "@/shared/ui/button";
import {
  createSessionChecker,
  nextSignInRequired,
  shouldCheckSession,
  type SessionCheckTrigger,
} from "./session-check";
import {
  SIGN_IN_LABEL,
  SYNC_BUTTON_IDLE,
  nextSavedAt,
  savedAtText,
  showSyncNow,
  signInHref,
  syncButtonReducer,
  syncButtonState,
  syncStatusKind,
  syncStatusText,
  type SyncStatusKind,
} from "./sync-status-text";
import { savedAtKey } from "./sync/select-store";
import { singleFlight } from "./sync/sync-now";
import type { TrialSyncCandidate, TrialSyncRoundResult, TrialSyncStatus } from "./sync/types";

const POLL_MS = 2000;

interface SyncStatusProps {
  getStatus: () => Promise<TrialSyncStatus>;
  /** Kaller `onChange` når køen eller synkstatusen kan ha endret seg. Returnerer avmelding. */
  subscribe?: (onChange: () => void) => () => void;
  syncNow: () => Promise<TrialSyncRoundResult>;
  /** Bestemmer nøkkelen for «Lagret kl.» i `localStorage`. */
  candidate: TrialSyncCandidate;
}

const PILL_CLASSES: Record<SyncStatusKind, string> = {
  allSaved: "bg-[#d9f2e6] text-[#155e3e]",
  pending: "bg-brand-50 text-brand-700",
  offline: "bg-[#fbe7b5] text-[#6b4405]",
  awaitingServer: "bg-[#e2e8f0] text-[#334155]",
  // Advarsel, samme som «Venter …»: ingenting er tapt.
  signInRequired: "bg-brand-50 text-brand-700",
};

function isOnline(): boolean {
  return typeof navigator === "undefined" ? false : navigator.onLine;
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Lagringen er full eller sperret; «Lagret kl.» vises likevel til siden lastes på nytt.
  }
}

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

/** Sky; tillegget under viser tilstanden (lås ved «Logg inn på nytt»). Bare pynt. */
function StateIcon({ kind }: { kind: SyncStatusKind }) {
  if (kind === "signInRequired") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-5 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </svg>
    );
  }
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 8.5H7Z" />
      {kind === "allSaved" ? <path d="m9.5 13.5 2 2 3.5-4" /> : null}
      {kind === "pending" ? <path d="M12 16v-5m-2.5 2.5L12 11l2.5 2.5" /> : null}
      {kind === "offline" ? <path d="M3 3l18 18" /> : null}
    </svg>
  );
}

function SyncIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={cn("size-5 shrink-0", spinning && "animate-spin motion-reduce:animate-none")}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9" />
      <path d="M18.5 3v4.2h-4.2M5.5 21v-4.2h4.2" />
    </svg>
  );
}

export function SyncStatus({ getStatus, subscribe, syncNow, candidate }: SyncStatusProps) {
  const [status, setStatus] = useState<TrialSyncStatus | null>(null);
  const key = savedAtKey(candidate);
  // Komponenten vises bare i nettleseren (etter at lageret er åpnet), så `localStorage` kan leses her.
  const [savedAt, setSavedAt] = useState<string | null>(() => readStored(key));
  const savedAtRef = useRef<string | null>(null);
  const [button, dispatch] = useReducer(syncButtonReducer, SYNC_BUTTON_IDLE);
  const latest = useRef(0);
  const active = useRef(true);
  const [signInRequired, setSignInRequired] = useState(false);
  /** Forrige statuslesing: om appen var på nett og om serveren hadde bekreftet. Null før første. */
  const previous = useRef<{ online: boolean; serverConfirmed: boolean } | null>(null);
  // Høyst én sjekk om gangen.
  const checkOnce = useMemo(() => createSessionChecker(), []);

  const runSessionCheck = useCallback(
    async (trigger: SessionCheckTrigger) => {
      if (!shouldCheckSession(trigger, isOnline())) return;
      const result = await checkOnce();
      if (!active.current) return;
      setSignInRequired((prev) => nextSignInRequired(prev, result));
    },
    [checkOnce],
  );

  const refresh = useCallback(async () => {
    const call = ++latest.current;
    try {
      const next = await getStatus();
      if (!active.current || call !== latest.current) return;
      const nextAt = nextSavedAt(next, savedAtRef.current, new Date());
      if (nextAt !== savedAtRef.current) {
        savedAtRef.current = nextAt;
        writeStored(key, nextAt);
        setSavedAt(nextAt);
      }
      const before = previous.current;
      previous.current = { online: next.online, serverConfirmed: next.serverConfirmed };
      setStatus(next);
      if (syncStatusKind(next) === "allSaved") dispatch({ type: "allSaved" });
      // Safari på iPad sender ikke alltid `online`: overgangen fra «Uten nett» utløser sjekken.
      // En bakgrunnsrunde som feiler (bekreftet før, ikke nå) gjør det samme.
      let trigger: SessionCheckTrigger = "poll";
      if (before && !before.online && next.online) trigger = "cameOnline";
      else if (before?.serverConfirmed && next.online && !next.serverConfirmed) {
        trigger = "syncFailed";
      }
      void runSessionCheck(trigger);
    } catch {
      // Lageret er ikke klart ennå; neste runde prøver igjen.
    }
  }, [getStatus, key, runSessionCheck]);

  useEffect(() => {
    active.current = true;
    savedAtRef.current = readStored(key);
    const onNetwork = () => void refresh();
    const onOnline = () => {
      void refresh();
      void runSessionCheck("online");
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void runSessionCheck("visible");
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onNetwork);
    document.addEventListener("visibilitychange", onVisibility);
    const unsubscribe = subscribe?.(() => void refresh());
    const interval = setInterval(() => void refresh(), POLL_MS);
    void refresh();
    return () => {
      active.current = false;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onNetwork);
      document.removeEventListener("visibilitychange", onVisibility);
      unsubscribe?.();
      clearInterval(interval);
    };
  }, [key, refresh, runSessionCheck, subscribe]);

  // To raske trykk gir én runde.
  const runOnce = useMemo(() => singleFlight(syncNow), [syncNow]);

  async function handleSyncNow() {
    dispatch({ type: "start" });
    let result: TrialSyncRoundResult;
    try {
      result = await runOnce();
    } catch {
      result = "failed";
    }
    if (!active.current) return;
    dispatch({ type: "done", result });
    if (result === "failed") void runSessionCheck("syncFailed");
    await refresh();
  }

  const view = syncButtonState(button);
  const kind = status ? syncStatusKind(status, signInRequired) : null;
  // «Prøver igjen automatisk» stemmer ikke når innloggingen må fornyes; linjen over sier det.
  const message = kind === "signInRequired" ? null : view.message;

  return (
    <section
      aria-label="Synkstatus"
      aria-busy={button.running || undefined}
      data-testid="sync-status"
      data-sync-state={kind ?? undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p
            role="status"
            data-testid="sync-status-state"
            className={cn(
              "inline-flex min-h-9 items-center gap-2 rounded-full px-3 py-1.5 text-base font-medium",
              kind ? PILL_CLASSES[kind] : "min-w-40 bg-[#e2e8f0]",
            )}
          >
            {kind ? <StateIcon kind={kind} /> : null}
            {status ? syncStatusText(status, signInRequired) : null}
          </p>
          <p
            data-testid="sync-status-saved-at"
            className="mt-1 text-sm text-slate-600 tabular-nums"
          >
            {savedAtText(savedAt, new Date(), deviceTimeZone())}
          </p>
        </div>
        {showSyncNow(kind) ? (
          <Button
            variant="secondary"
            size="lg"
            className="min-w-36 shrink-0 max-sm:w-full"
            disabled={view.disabled}
            onClick={() => void handleSyncNow()}
          >
            <SyncIcon spinning={button.running} />
            {view.label}
          </Button>
        ) : (
          // Vanlig lenke (full sidelasting): innloggingssiden lastes fra serveren.
          <a
            href={signInHref(window.location.pathname)}
            data-testid="sync-status-sign-in"
            className={cn(
              buttonVariants({ variant: "secondary", size: "lg" }),
              "min-w-36 shrink-0 max-sm:w-full",
            )}
          >
            {SIGN_IN_LABEL}
          </a>
        )}
      </div>
      <p
        data-testid="sync-status-message"
        aria-live="polite"
        className={cn("text-sm text-slate-800", message && "mt-2")}
      >
        {message ?? ""}
      </p>
    </section>
  );
}
