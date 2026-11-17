"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useRestoredFocus } from "@/shared/lib/use-restored-focus";
import { Button } from "./button";
import { FormMessage } from "./form";

/*
 * Angre-meldingen etter «Fjern» (docs/funksjoner/fase2a-papirkurv-design.md avsnitt 3).
 *
 * - Én melding om gangen. En ny sletting erstatter meldingen, og «Angre» gjelder bare den siste;
 *   da vises «Mer i papirkurven».
 * - Står i 10 sekunder. Tiden står mens musa er over meldingen, mens fokus er i den, mens fanen er
 *   skjult og mens kallet går. Ingen nedtelling på skjermen. Feil står til den lukkes.
 * - Cmd/Ctrl+Z utløser «Angre» (ikke i tekstfelt og ikke mens en modal dialog er åpen). Esc lukker.
 * - Meldingen bor i provideren i layouten, så den står når siden lastes på nytt etter
 *   server-handlingen, men lukkes når den ansatte går til en annen side.
 * - Bare id, type og visningsnavn (og teksten) holdes i minnet: aldri i adressen, localStorage,
 *   sessionStorage eller loggeren.
 */

/** Hvor lenge meldingen står når ingenting stopper tiden. */
export const UNDO_TOAST_DURATION_MS = 10_000;

export const UNDO_TOAST_TEXTS = {
  undo: "Angre",
  undoing: "Henter tilbake …",
  close: "Lukk meldingen",
  more: "Mer i papirkurven",
  detail: "Du finner det også i papirkurven.",
  offline: "Du er uten nett.",
} as const;

export type UndoTargetType = "building" | "floor" | "room" | "party";

/** Det som ble fjernet: bare type, id og visningsnavn. */
export type UndoTarget = { type: UndoTargetType; id: string; label: string };

/** Svaret fra «Angre»: teksten som vises, og nøkkelen (`type:id`) som får fokus. */
export type UndoOutcome = { ok: true; message: string; focus: string | null } | { ok: false };

export type UndoToastShowOptions = {
  target: UndoTarget;
  /** Linje 1, for eksempel «Rommet «Bad» er fjernet.». */
  message: string;
  /** Teksten ved feil, for eksempel «Fikk ikke hentet tilbake rommet. …». */
  failureMessage: string;
  /** Id-en til papirkurven på siden, til «Mer i papirkurven». */
  trashId?: string | null;
  /** Henter tilbake det som ble fjernet (samme kjernefunksjon som papirkurven). */
  undo: () => Promise<UndoOutcome>;
};

export type UndoToastPhase = "removed" | "pending" | "error" | "result";

export type UndoToastView = {
  /** Økes for hver ny melding, så et gammelt svar aldri endrer en ny melding. */
  key: number;
  phase: UndoToastPhase;
  message: string;
  detail: string | null;
  error: string | null;
  /** «Mer i papirkurven»: en tidligere melding er erstattet. */
  showMore: boolean;
  trashId: string | null;
  target: UndoTarget | null;
};

export type PauseReason = "hover" | "focus" | "hidden";

type Timers = {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  now: () => number;
};

const defaultTimers: Timers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export type UndoToastStore = ReturnType<typeof createUndoToastStore>;

/**
 * Tilstanden og tiden for meldingen, uten React (testes med falske tidtakere). Provideren leser
 * den med `useSyncExternalStore`.
 */
export function createUndoToastStore({
  duration = UNDO_TOAST_DURATION_MS,
  isOffline = () => false,
  timers = defaultTimers,
}: { duration?: number; isOffline?: () => boolean; timers?: Timers } = {}) {
  let view: UndoToastView | null = null;
  let counter = 0;
  let undoFn: (() => Promise<UndoOutcome>) | null = null;
  let failureMessage = "";
  let focusHandler: ((key: string) => void) | null = null;
  const listeners = new Set<() => void>();
  const reasons = new Set<PauseReason>();
  let remaining = duration;
  let startedAt = 0;
  let handle: unknown = null;

  function emit() {
    for (const listener of listeners) listener();
  }

  function set(next: UndoToastView | null) {
    view = next;
    emit();
  }

  function timed(): boolean {
    return view !== null && (view.phase === "removed" || view.phase === "result");
  }

  function stopTimer() {
    if (handle === null) return;
    timers.clearTimeout(handle);
    handle = null;
    remaining = Math.max(0, remaining - (timers.now() - startedAt));
  }

  function runTimer() {
    if (handle !== null || !timed() || reasons.size > 0) return;
    startedAt = timers.now();
    handle = timers.setTimeout(() => {
      handle = null;
      close();
    }, remaining);
  }

  function restartTimer() {
    stopTimer();
    remaining = duration;
    runTimer();
  }

  function close() {
    stopTimer();
    undoFn = null;
    reasons.delete("hover");
    reasons.delete("focus");
    if (view !== null) set(null);
  }

  function show(options: UndoToastShowOptions) {
    const replaced =
      view !== null &&
      (view.phase === "removed" ||
        view.phase === "error" ||
        (view.showMore && view.phase !== "result"));
    counter += 1;
    undoFn = options.undo;
    failureMessage = options.failureMessage;
    set({
      key: counter,
      phase: "removed",
      message: options.message,
      detail: UNDO_TOAST_TEXTS.detail,
      error: null,
      showMore: replaced,
      trashId: options.trashId ?? null,
      target: {
        type: options.target.type,
        id: options.target.id,
        label: options.target.label,
      },
    });
    restartTimer();
  }

  /** Svaret etter «Gjenopprett» i papirkurven, i samme melding (uten «Angre»). */
  function showResult(message: string, focus: string | null = null) {
    counter += 1;
    undoFn = null;
    set({
      key: counter,
      phase: "result",
      message,
      detail: null,
      error: null,
      showMore: false,
      trashId: null,
      target: null,
    });
    restartTimer();
    if (focus) focusHandler?.(focus);
  }

  function canUndo(): boolean {
    return view !== null && (view.phase === "removed" || view.phase === "error") && !!undoFn;
  }

  async function undo(): Promise<void> {
    if (!canUndo() || view === null) return;
    const run = undoFn!;
    const key = view.key;
    stopTimer();
    set({ ...view, phase: "pending", error: null });

    let outcome: UndoOutcome;
    try {
      outcome = await run();
    } catch {
      outcome = { ok: false };
    }
    // En ny sletting eller lukking i mellomtiden: svaret gjelder ikke lenger meldingen.
    if (view === null || view.key !== key) return;

    if (outcome.ok) {
      undoFn = null;
      set({
        ...view,
        phase: "result",
        message: outcome.message,
        detail: null,
        error: null,
        showMore: false,
      });
      restartTimer();
      if (outcome.focus) focusHandler?.(outcome.focus);
      return;
    }
    const prefix = isOffline() ? `${UNDO_TOAST_TEXTS.offline} ` : "";
    set({ ...view, phase: "error", error: `${prefix}${failureMessage}` });
  }

  function setPaused(reason: PauseReason, paused: boolean) {
    if (paused) {
      reasons.add(reason);
      stopTimer();
    } else {
      reasons.delete(reason);
      runTimer();
    }
  }

  return {
    show,
    showResult,
    undo,
    close,
    canUndo,
    setPaused,
    setFocusHandler(handler: ((key: string) => void) | null) {
      focusHandler = handler;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot(): UndoToastView | null {
      return view;
    },
  };
}

/** Cmd+Z (Mac) eller Ctrl+Z, uten Shift og Alt (Shift gir «gjør om»). */
export function isUndoShortcut(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === "z"
  );
}

/** Fokus i et felt der Cmd/Ctrl+Z skal angre tastingen, ikke slettingen. */
export function isEditableTarget(
  target: { tagName?: string; isContentEditable?: boolean } | null | undefined,
): boolean {
  if (!target) return false;
  const tag = (target.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!target.isContentEditable;
}

function modalDialogOpen(): boolean {
  try {
    return document.querySelector("dialog:modal") !== null;
  } catch {
    return document.querySelector("dialog[open]") !== null;
  }
}

/** Åpner papirkurven på siden, ruller dit og gir overskriften fokus. */
function openTrash(trashId: string) {
  const element = document.getElementById(trashId);
  if (!element) return;
  if (element instanceof HTMLDetailsElement) element.open = true;
  const summary = element.querySelector<HTMLElement>("summary") ?? element;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  summary.focus({ preventScroll: true });
  element.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
}

type UndoToastApi = Pick<UndoToastStore, "show" | "showResult" | "close">;

const UndoToastContext = createContext<UndoToastApi | null>(null);

/** Meldingen fra provideren i layouten. Utenfor provideren gjør kallene ingenting. */
export function useUndoToast(): UndoToastApi {
  return useContext(UndoToastContext) ?? NO_PROVIDER;
}

const NO_PROVIDER: UndoToastApi = { show: () => {}, showResult: () => {}, close: () => {} };

function TrashIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="mt-0.5 shrink-0 text-stone"
    >
      <path d="M4 7h16" />
      <path d="M9 7V4.5h6V7" />
      <path d="M6.5 7l1 13h9l1-13" />
      <path d="M10 11v5.5M14 11v5.5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="mt-0.5 shrink-0 text-stone"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/**
 * Selve meldingen. Linjene står i `role="status"` (leses opp), knappene utenfor. Rammen finnes
 * alltid, så skjermleseren hører endringen; uten melding er den tom og usynlig.
 */
export function UndoToast({
  view,
  onUndo,
  onClose,
  onMore,
  onPause,
}: {
  view: UndoToastView | null;
  onUndo: () => void;
  onClose: () => void;
  onMore: (trashId: string) => void;
  onPause: (reason: PauseReason, paused: boolean) => void;
}) {
  const showUndo = view !== null && view.phase !== "result";
  const pending = view?.phase === "pending";

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onPause("focus", false);
  }
  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  }

  return (
    <div
      data-testid="undo-toast"
      className="pointer-events-none fixed left-1/2 z-40 w-[min(36rem,calc(100vw-32px))] -translate-x-1/2"
      style={{
        bottom: "calc(16px + env(safe-area-inset-bottom) + var(--fixed-bottom-bar-height, 0px))",
      }}
    >
      <div
        className={
          view
            ? "pointer-events-auto flex flex-col gap-3 rounded-card border border-line bg-white p-4 shadow-lg min-[480px]:flex-row min-[480px]:items-start"
            : "sr-only"
        }
        onMouseEnter={() => onPause("hover", true)}
        onMouseLeave={() => onPause("hover", false)}
        onFocus={() => onPause("focus", true)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {view && (view.phase === "result" ? <CheckIcon /> : <TrashIcon />)}
          <div className="min-w-0 flex-1 space-y-2">
            <div role="status" aria-live="polite" aria-atomic="true">
              {view && (
                <>
                  <p className="text-base font-medium break-words text-night">{view.message}</p>
                  {view.detail && <p className="text-sm text-stone">{view.detail}</p>}
                </>
              )}
            </div>
            {view?.error && <FormMessage message={view.error} />}
            {view?.showMore && view.trashId && (
              <Button
                variant="ghost"
                size="md"
                className="-ml-2 px-2"
                onClick={() => onMore(view.trashId!)}
              >
                {UNDO_TOAST_TEXTS.more}
              </Button>
            )}
          </div>
        </div>
        {view && (
          <div className="flex shrink-0 items-center gap-2">
            {showUndo && (
              <Button
                variant="primary"
                size="lg"
                aria-keyshortcuts="Meta+Z Control+Z"
                aria-disabled={pending ? "true" : undefined}
                onClick={() => {
                  if (!pending) onUndo();
                }}
              >
                {pending ? UNDO_TOAST_TEXTS.undoing : UNDO_TOAST_TEXTS.undo}
              </Button>
            )}
            <button
              type="button"
              aria-label={UNDO_TOAST_TEXTS.close}
              onClick={onClose}
              className="ml-auto inline-flex size-11 items-center justify-center rounded-full text-night hover:bg-slate-100"
            >
              <CloseIcon />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Holder angre-meldingen for de ansattes sider (`(ansatt)/layout.tsx`). Meldingen ligger etter
 * innholdet, så den nås sist med Tab.
 */
export function UndoToastProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() =>
    createUndoToastStore({
      isOffline: () => typeof navigator !== "undefined" && navigator.onLine === false,
    }),
  );
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot, () => null);
  const focusRestored = useRestoredFocus();
  const pathname = usePathname();
  const previousPath = useRef(pathname);

  useEffect(() => {
    store.setFocusHandler(focusRestored);
    return () => store.setFocusHandler(null);
  }, [store, focusRestored]);

  // Ny side: meldingen lukkes. Samme side lastet på nytt (revalidering): den står.
  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    store.close();
  }, [pathname, store]);

  useEffect(() => {
    const update = () => store.setPaused("hidden", document.visibilityState === "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, [store]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isUndoShortcut(event) || !store.canUndo()) return;
      if (isEditableTarget(document.activeElement as HTMLElement | null)) return;
      if (isEditableTarget(event.target as HTMLElement | null)) return;
      if (modalDialogOpen()) return;
      event.preventDefault();
      void store.undo();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [store]);

  const api = useMemo<UndoToastApi>(
    () => ({ show: store.show, showResult: store.showResult, close: store.close }),
    [store],
  );

  return (
    <UndoToastContext.Provider value={api}>
      {children}
      <UndoToast
        view={view}
        onUndo={() => void store.undo()}
        onClose={store.close}
        onMore={openTrash}
        onPause={store.setPaused}
      />
    </UndoToastContext.Provider>
  );
}
