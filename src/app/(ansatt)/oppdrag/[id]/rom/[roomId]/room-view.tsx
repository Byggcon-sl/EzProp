"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type {
  AnswerView,
  CheckpointView,
  RoomRef,
  RoomRefresh,
  RoomReportView,
  SuggestionView,
} from "@/core/reports/types";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { FormMessage } from "@/shared/ui/form";
import { Notice } from "@/shared/ui/notice";
import { SaveState } from "@/shared/ui/save-state";
import { uuidv7 } from "@/shared/lib/uuid";
import { removeDeviationAction, saveFieldAction, setCheckpointDoneAction } from "./actions";
import { CheckpointList } from "./checkpoint-list";
import { CheckpointPanel } from "./checkpoint-panel";
import { FieldSaveStore } from "./field-save-store";
import { RoomContext, type RoomContextValue, type UndoLine } from "./room-context";
import { isActionError, ROOM_ACTION_MESSAGES, ROOM_TEXTS, type ActionError } from "./room-messages";
import {
  ALL_DONE_NOTICE_ID,
  CHECKPOINT_HEADING_ID,
  deviationPrefix,
  domId,
  DONE_BUTTON_ID,
  indexDocument,
  initialCheckpointKey,
  isOpenSuggestion,
  neighbours,
  nextUndoneCheckpoint,
  SEARCH_INPUT_ID,
  undoButtonId,
  warningId,
} from "./room-model";
import { focusElementById, type StickyAccept } from "./rule-suggestion-card";
import { isTextField, SHORTCUT_LIST, shortcutFor } from "./shortcuts";

/*
 * Skjermen for badet på PC og iPad (docs/funksjoner/fase2a-badet-pc-design.md avsnitt 3–17). Ett
 * skjermbilde for hele badet: listen til venstre, punktet til høyre, lagrestatus i toppen og
 * «Ferdig med punktet» i nedre linje. Bytte av punkt skjer uten ny innlasting (bare `?punkt=`
 * endres), så lagringskøen og teksten beholdes; nettleseren varsler ved lukking når noe ikke er
 * lagret. Ingen rapportdata i localStorage eller IndexedDB.
 *
 * Tilgang: `canEdit` kommer fra serveren og styrer bare visningen. Serveren sjekker hver handling.
 * Støtter hovedmål: de ansatte (raskt, trygt, ingenting går tapt), færre reklamasjoner
 * (advarsler før rapporten går ut) og KI i bunnen (tekstfeltene har plass til KI-merket).
 */

type StartedView = Extract<RoomReportView, { state: "started" }>;

function useOnline(): boolean {
  return useSyncExternalStore(
    (notify) => {
      window.addEventListener("online", notify);
      window.addEventListener("offline", notify);
      return () => {
        window.removeEventListener("online", notify);
        window.removeEventListener("offline", notify);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

/** Punktet i adressen (`?punkt=`). */
function checkpointFromLocation(): string | null {
  return new URLSearchParams(window.location.search).get("punkt");
}

export function RoomView({
  view,
  room,
  assignmentNumber,
  roomTitle,
  requestedCheckpoint,
}: {
  view: StartedView;
  room: RoomRef;
  assignmentNumber: string | null;
  roomTitle: string;
  requestedCheckpoint: string | null;
}) {
  const doc = useMemo(() => indexDocument(view.document), [view.document]);
  const order = useMemo(() => doc.checkpoints.map((c) => c.key), [doc]);
  const names = useMemo(() => new Map(doc.checkpoints.map((c) => [c.key, c.name])), [doc]);
  const canEdit = view.canEdit;

  const [checkpoints, setCheckpoints] = useState<CheckpointView[]>(view.checkpoints);
  const [suggestions, setSuggestions] = useState<SuggestionView[]>(view.suggestions);
  const [progress, setProgress] = useState(view.progress);
  const [currentKey, setCurrentKey] = useState(() =>
    initialCheckpointKey(order, requestedCheckpoint),
  );
  const [undoLines, setUndoLines] = useState<UndoLine[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const [doneBusy, setDoneBusy] = useState(false);
  const [doneError, setDoneError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [searchRequest, setSearchRequest] = useState(0);
  const [allDone, setAllDone] = useState(false);
  const [sticky, setSticky] = useState<Map<string, StickyAccept>>(() => new Map());
  const [focusTick, setFocusTick] = useState(0);
  const pendingFocus = useRef<string | null>(null);
  // Punktet som vises nå, satt med en gang ved bytte (state kommer først ved neste tegning).
  const shownKey = useRef(currentKey);
  // Sann rett etter at en handling som startet på et annet punkt, er ferdig: da flyttes ikke
  // fokus, og ingen angre-linje legges på punktet takstmannen har gått videre til.
  const staleRun = useRef(false);
  const listDialog = useRef<HTMLDialogElement>(null);
  const helpButton = useRef<HTMLElement | null>(null);
  const online = useOnline();

  const answers = useMemo(
    () => new Map<string, AnswerView>(view.answers.map((a) => [a.elementKey, a])),
    [view.answers],
  );
  const [newAnswerIds] = useState(
    () => new Map(view.document.elements.map((e) => [e.key, uuidv7()])),
  );

  const applyRefresh = useCallback((refresh: RoomRefresh) => {
    setCheckpoints(refresh.checkpoints);
    setSuggestions(refresh.suggestions);
    setProgress(refresh.progress);
  }, []);

  const [store] = useState(
    () =>
      new FieldSaveStore({
        send: (change) => saveFieldAction(room, change),
        onRefresh: applyRefresh,
        isOnline: () => typeof navigator === "undefined" || navigator.onLine,
      }),
  );
  const summary = useSyncExternalStore(store.subscribe, store.getSummary, store.getSummary);

  // --- Fokus og opplesning -------------------------------------------------------------------

  const requestFocus = useCallback((id: string) => {
    pendingFocus.current = id;
    setFocusTick((tick) => tick + 1);
  }, []);

  /** Fokus fra en handling. Ignoreres når punktet er byttet mens handlingen pågikk. */
  const focus = useCallback(
    (id: string) => {
      if (staleRun.current) return;
      requestFocus(id);
    },
    [requestFocus],
  );

  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    if (focusElementById(id)) {
      pendingFocus.current = null;
      return;
    }
    // Elementet kan komme med neste tegning (for eksempel et nytt avvikskort).
    const frame = requestAnimationFrame(() => {
      if (pendingFocus.current === id && focusElementById(id)) pendingFocus.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [focusTick]);

  const announce = useCallback((text: string) => {
    // Samme tekst to ganger leses også opp: et usynlig tegn skiller dem.
    setAnnouncement((previous) => (previous === text ? `${text}​` : text));
  }, []);

  // --- Handlinger -----------------------------------------------------------------------------

  const run = useCallback(
    async <T extends { status: string }>(call: () => Promise<T | ActionError>) => {
      const startKey = shownKey.current;
      await store.flush();
      let result: T | ActionError;
      try {
        result = await call();
      } catch {
        return { status: "error", message: ROOM_ACTION_MESSAGES.network } as ActionError;
      }
      if (shownKey.current !== startKey) {
        // Fortsettelsen hos den som kalte, kjører før neste oppgave i nettleseren.
        staleRun.current = true;
        setTimeout(() => {
          staleRun.current = false;
        }, 0);
      }
      if (!isActionError(result) && "refresh" in result && result.refresh) {
        applyRefresh(result.refresh as RoomRefresh);
      }
      return result;
    },
    [store, applyRefresh],
  );

  const openCheckpoint = useCallback(
    (key: string, options: { focusId?: string; announce?: string } = {}) => {
      if (!order.includes(key)) return;
      if (key !== currentKey) {
        shownKey.current = key;
        setCurrentKey(key);
        setUndoLines([]);
        setSticky(new Map());
        setHelpOpen(false);
        setAllDone(false);
        setDoneError(null);
        window.history.pushState(null, "", `?punkt=${encodeURIComponent(key)}`);
      }
      listDialog.current?.close();
      requestFocus(options.focusId ?? CHECKPOINT_HEADING_ID);
      if (options.announce) announce(options.announce);
    },
    [order, currentKey, requestFocus, announce],
  );

  const removeDeviation = useCallback(
    async (deviationId: string): Promise<string | null> => {
      const checkpoint = checkpoints.find((c) => c.deviations.some((d) => d.id === deviationId));
      const sorted = [...(checkpoint?.deviations ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
      const number = sorted.findIndex((d) => d.id === deviationId) + 1;
      // Avvik fra et forslag: forslaget står åpent igjen med en gang (`refresh`), og linjen sier
      // det i stedet for «Avvik n er fjernet.» (T-0117).
      const link = sorted.find((d) => d.id === deviationId)?.suggestion ?? null;
      const result = await run(() => removeDeviationAction(room, deviationId));
      if (isActionError(result)) return result.message;
      const reopened =
        link !== null &&
        result.status === "saved" &&
        isOpenSuggestion(result.refresh.suggestions, link.ruleKey, checkpoint?.checkpointKey);
      const undoId = `deviation-${deviationId}`;
      store.drop(deviationPrefix(deviationId));
      // Punktet er forlatt: Angre gjelder bare til punktet forlates.
      if (staleRun.current) return null;
      setUndoLines((lines) => [
        ...lines.filter((l) => l.id !== undoId),
        {
          kind: "deviation",
          id: undoId,
          deviationId,
          number: Math.max(1, number),
          suggestion: link && reopened ? { ruleKey: link.ruleKey, tg: link.suggestionTg } : null,
        },
      ]);
      focus(undoButtonId(undoId));
      return null;
    },
    [checkpoints, run, room, store, focus],
  );

  const contextValue: RoomContextValue = useMemo(
    () => ({
      room,
      canEdit,
      store,
      doc,
      run,
      announce,
      focus,
      openCheckpoint,
      removeDeviation,
      undoLines,
      addUndo: (line) => {
        if (staleRun.current) return;
        setUndoLines((lines) => [...lines.filter((l) => l.id !== line.id), line]);
      },
      removeUndo: (id) => setUndoLines((lines) => lines.filter((l) => l.id !== id)),
    }),
    [room, canEdit, store, doc, run, announce, focus, openCheckpoint, removeDeviation, undoLines],
  );

  const checkpointMap = useMemo(
    () => new Map(checkpoints.map((c) => [c.checkpointKey, c])),
    [checkpoints],
  );
  const current = checkpointMap.get(currentKey);
  const currentName = names.get(currentKey) ?? "";
  const { previous, next } = neighbours(order, currentKey);
  const position = order.indexOf(currentKey) + 1;

  // «Ferdig med punktet»: lagrer det som venter først (design avsnitt 17).
  const markDone = useCallback(async () => {
    if (!canEdit || doneBusy || !current) return;
    setDoneBusy(true);
    setDoneError(null);
    const flushed = await store.flush();
    if (!flushed.ok) {
      setDoneBusy(false);
      announce(ROOM_TEXTS.notDoneFieldUnsaved);
      const target = flushed.failedKeys.map(domId).find((id) => document.getElementById(id));
      if (target) focus(target);
      return;
    }
    const result = await run(() =>
      setCheckpointDoneAction(room, { checkpointKey: current.checkpointKey, done: true }),
    );
    setDoneBusy(false);
    if (isActionError(result)) {
      setDoneError(result.message);
      return;
    }
    // Takstmannen har gått til et annet punkt mens det ble lagret: bli der.
    if (result.status !== "saved" || staleRun.current) return;
    const refreshed = result.refresh;
    const after = refreshed.checkpoints.find((c) => c.checkpointKey === current.checkpointKey);
    const warnings = after?.warnings.length ?? 0;
    const nextKey = nextUndoneCheckpoint(order, refreshed.checkpoints, current.checkpointKey);
    if (nextKey === null) {
      setAllDone(true);
      announce(ROOM_TEXTS.allDone(refreshed.progress.total));
      focus(ALL_DONE_NOTICE_ID);
      return;
    }
    openCheckpoint(nextKey, {
      announce: ROOM_TEXTS.doneAnnouncement(
        refreshed.progress.done,
        refreshed.progress.total,
        names.get(nextKey) ?? null,
        warnings,
      ),
    });
  }, [canEdit, doneBusy, current, store, announce, focus, run, room, order, openCheckpoint, names]);

  const reopen = useCallback(async () => {
    if (!current) return;
    setDoneBusy(true);
    const result = await run(() =>
      setCheckpointDoneAction(room, { checkpointKey: current.checkpointKey, done: false }),
    );
    setDoneBusy(false);
    if (isActionError(result)) setDoneError(result.message);
    else focus(DONE_BUTTON_ID);
  }, [current, run, room, focus]);

  // --- Adressen, tittelen, nettet og lukking ------------------------------------------------

  useEffect(() => {
    const onPop = () => {
      const key = initialCheckpointKey(order, checkpointFromLocation());
      shownKey.current = key;
      setCurrentKey(key);
      setUndoLines([]);
      requestFocus(CHECKPOINT_HEADING_ID);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [order, requestFocus]);

  useEffect(() => {
    if (currentName) document.title = `${currentName} – ${ROOM_TEXTS.listHeading}`;
  }, [currentName]);

  useEffect(() => {
    if (online) void store.retryAll();
    else store.markOffline();
  }, [online, store]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!store.hasUnsaved()) return;
      event.preventDefault();
      // Eldre nettlesere trenger en verdi; teksten bestemmer nettleseren selv.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [store]);

  // --- Snarveier (A383) -------------------------------------------------------------------

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const shortcut = shortcutFor({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        inTextField: isTextField(document.activeElement),
        isComposing: event.isComposing,
      });
      if (!shortcut) return;
      switch (shortcut) {
        case "done":
          if (!canEdit || current?.done) return;
          event.preventDefault();
          void markDone();
          return;
        case "previous":
          if (!previous) return;
          event.preventDefault();
          openCheckpoint(previous);
          return;
        case "next":
          if (!next) return;
          event.preventDefault();
          openCheckpoint(next);
          return;
        case "search":
          if (!canEdit) return;
          event.preventDefault();
          if (document.getElementById(SEARCH_INPUT_ID)) focus(SEARCH_INPUT_ID);
          else setSearchRequest((n) => n + 1);
          return;
        case "help":
          event.preventDefault();
          helpButton.current = document.activeElement as HTMLElement | null;
          setHelpOpen(true);
          focus("shortcuts-heading");
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canEdit, current, markDone, previous, next, openCheckpoint, focus]);

  const closeHelp = () => {
    setHelpOpen(false);
    const back = helpButton.current;
    if (back && document.contains(back)) back.focus();
    else focus(CHECKPOINT_HEADING_ID);
  };

  const onStickyAccept = useCallback((ruleKey: string, accept: StickyAccept | null) => {
    setSticky((map) => {
      if (!accept && !map.has(ruleKey)) return map;
      const copy = new Map(map);
      if (accept) copy.set(ruleKey, accept);
      else copy.delete(ruleKey);
      return copy;
    });
  }, []);
  const stickyAccept = [...sticky.values()][0] ?? null;

  const reviewNext = (key: string) => {
    openCheckpoint(key, { focusId: warningId(0) });
  };

  // --- Visning --------------------------------------------------------------------------------

  const totalStatus = online ? summary.status : summary.status === "failed" ? "failed" : "offline";
  const list = (
    <CheckpointList
      order={order}
      names={names}
      checkpoints={checkpointMap}
      suggestions={suggestions}
      progress={progress}
      currentKey={currentKey}
      onOpen={(key) => openCheckpoint(key)}
      onReviewNext={reviewNext}
    />
  );

  return (
    <RoomContext.Provider value={contextValue}>
      <div className="-mx-5 -mt-6 lg:-mx-8 lg:-mt-8">
        <header className="sticky top-0 z-20 border-b border-line bg-white px-5 py-3 lg:px-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2">
              <Link
                href={`/oppdrag/${room.assignmentId}`}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-lg text-slate-900 hover:bg-slate-100"
              >
                <span aria-hidden="true">‹</span>
                <span className="sr-only">{ROOM_TEXTS.backLabel}</span>
              </Link>
              <div className="min-w-0">
                <p className="text-sm text-stone">
                  {assignmentNumber ? `Oppdrag ${assignmentNumber} · ` : ""}
                  {ROOM_TEXTS.reportType}
                </p>
                <h1 className="font-heading text-xl font-semibold break-words text-slate-900">
                  {ROOM_TEXTS.roomGroup} <span aria-hidden="true">›</span>
                  <span className="sr-only">,</span> {roomTitle}
                </h1>
              </div>
            </div>
            {canEdit && (
              <SaveState
                scope="total"
                status={totalStatus}
                failedCount={summary.failedCount}
                savedAt={summary.savedAt === null ? undefined : new Date(summary.savedAt)}
                onRetry={() => void store.retryAll()}
              />
            )}
          </div>
          <p className="mt-1 text-sm text-stone">
            {view.inspectionYear.source === "assignment"
              ? ROOM_TEXTS.inspectionYearFromAssignment(view.inspectionYear.year)
              : ROOM_TEXTS.inspectionYearFromToday(view.inspectionYear.year)}
          </p>
          <div className="mt-2 lg:hidden">
            <Button variant="secondary" onClick={() => listDialog.current?.showModal()}>
              {ROOM_TEXTS.checkpoints(progress.done, progress.total)}
            </Button>
            <span className="ml-3 text-sm text-slate-700">
              {position} av {order.length}
            </span>
          </div>
        </header>
        {!canEdit && (
          <p className="bg-sand px-5 py-3 text-sm text-slate-900 md:px-6">{ROOM_TEXTS.readOnly}</p>
        )}

        <dialog
          ref={listDialog}
          aria-label={ROOM_TEXTS.listNav}
          className="m-0 h-dvh max-h-dvh w-full max-w-full bg-sand p-5 shadow-xl backdrop:bg-night/40 min-[480px]:w-90"
        >
          <div className="mb-3 flex justify-end">
            <Button variant="secondary" onClick={() => listDialog.current?.close()}>
              {ROOM_TEXTS.close}
            </Button>
          </div>
          {list}
        </dialog>

        <div className="lg:flex">
          <aside className="hidden shrink-0 self-start bg-sand p-4 lg:sticky lg:top-28 lg:block lg:max-h-[calc(100dvh-7rem)] lg:w-70 lg:overflow-y-auto xl:w-80">
            {list}
          </aside>
          <div className="min-w-0 flex-1">
            <main className="mx-auto max-w-190 space-y-4 px-5 pt-5 pb-8 md:px-6 xl:space-y-6">
              <div id="room-announcer" role="status" aria-live="polite" className="sr-only">
                {announcement}
              </div>
              {helpOpen && (
                <Card
                  onKeyDown={(event) => {
                    if (event.key === "Escape") closeHelp();
                  }}
                >
                  <section aria-labelledby="shortcuts-heading" className="space-y-3">
                    <h2
                      id="shortcuts-heading"
                      tabIndex={-1}
                      className="text-lg font-semibold text-slate-900"
                    >
                      {ROOM_TEXTS.shortcutsHeading}
                    </h2>
                    <dl className="space-y-2">
                      {SHORTCUT_LIST.map((item) => (
                        <div key={item.keys} className="flex flex-wrap gap-x-3">
                          <dt className="font-medium text-slate-900">{item.keys}</dt>
                          <dd className="text-slate-700">{item.text}</dd>
                        </div>
                      ))}
                    </dl>
                    <Button variant="secondary" onClick={closeHelp}>
                      {ROOM_TEXTS.close}
                    </Button>
                  </section>
                </Card>
              )}
              {allDone && (
                <div id={ALL_DONE_NOTICE_ID} tabIndex={-1}>
                  <Notice message={ROOM_TEXTS.allDone(progress.total)} />
                </div>
              )}
              {current && (
                <CheckpointPanel
                  key={current.checkpointKey}
                  checkpoint={current}
                  suggestions={suggestions}
                  answers={answers}
                  newAnswerIds={newAnswerIds}
                  inspectionYear={view.inspectionYear}
                  document={view.document}
                  searchOpenRequest={searchRequest}
                  onStickyAccept={onStickyAccept}
                />
              )}
            </main>
            <div className="sticky bottom-0 z-10 border-t border-line bg-white px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:px-6">
              <div className="mx-auto flex max-w-190 flex-wrap items-center justify-end gap-2 md:gap-3">
                {doneError && (
                  <div className="basis-full">
                    <FormMessage message={doneError} />
                  </div>
                )}
                {canEdit && stickyAccept && (
                  <div className="mr-auto flex flex-wrap gap-2 max-lg:hidden">
                    {stickyAccept.buttons.map((button) => (
                      <Button key={button.label} size="lg" onClick={button.run}>
                        {button.label}
                      </Button>
                    ))}
                  </div>
                )}
                {canEdit && (
                  <button
                    type="button"
                    className="mr-auto hidden min-h-11 items-center text-sm text-slate-900 underline underline-offset-4 lg:inline-flex"
                    onClick={() => {
                      helpButton.current = document.activeElement as HTMLElement | null;
                      setHelpOpen(true);
                      focus("shortcuts-heading");
                    }}
                  >
                    {ROOM_TEXTS.shortcutsLink}
                  </button>
                )}
                <Button
                  variant="secondary"
                  size="lg"
                  className="lg:hidden"
                  disabled={!previous}
                  onClick={() => previous && openCheckpoint(previous)}
                >
                  <span aria-hidden="true">‹ </span>
                  {ROOM_TEXTS.previous}
                </Button>
                {canEdit &&
                  (current?.done ? (
                    <Button
                      id={DONE_BUTTON_ID}
                      variant="secondary"
                      size="lg"
                      className="lg:min-w-60"
                      disabled={doneBusy}
                      onClick={() => void reopen()}
                    >
                      {ROOM_TEXTS.reopen}
                    </Button>
                  ) : (
                    <Button
                      id={DONE_BUTTON_ID}
                      size="lg"
                      className="lg:min-w-60"
                      disabled={doneBusy}
                      aria-disabled={doneBusy || undefined}
                      onClick={() => void markDone()}
                    >
                      {doneBusy ? ROOM_TEXTS.saving : ROOM_TEXTS.done}
                    </Button>
                  ))}
                <Button
                  variant="secondary"
                  size="lg"
                  className="lg:hidden"
                  disabled={!next}
                  onClick={() => next && openCheckpoint(next)}
                >
                  {ROOM_TEXTS.next}
                  <span aria-hidden="true"> ›</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </RoomContext.Provider>
  );
}
