"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  mergeFieldWarningText,
  textsWrittenForTgText,
  type PhraseField,
} from "@/core/reports/logic";
import type { DeviationView, RankedPhraseCandidate } from "@/core/reports/types";
import { uuidv7 } from "@/shared/lib/uuid";
import { AiSparkIcon } from "@/shared/ui/ai-text-mark";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { TgBadge, tgBadgeFullText } from "@/shared/ui/tg-badge";
import { Warning } from "@/shared/ui/warning";
import {
  addMeasureAction,
  applyPhraseAction,
  decideAiSuggestionAction,
  removeMeasureAction,
  saveFieldAction,
  suggestPhrasesAction,
} from "./actions";
import { useRoom } from "./room-context";
import { AI_ROOM_TEXTS, isActionError, ROOM_ACTION_MESSAGES } from "./room-messages";
import {
  domId,
  focusIndexAfterSwap,
  listKeyTarget,
  measureFieldKey,
  phraseActionFor,
  phraseItems,
  phraseTextSearch,
  type PhraseAction,
  type PhraseItem,
} from "./room-model";
import { isTextField } from "./shortcuts";

/*
 * Forslag fra frasebanken i avvikskortet (docs/funksjoner/fase2a-ki-i-veien-design.md avsnitt 4,
 * A485, A433, A437, A438 og A468). «Forslag» åpner en liste i flyten rett under feltet: først
 * tekstsøket over kandidatene som er lastet med badet, så byttet én gang til KI-rekkefølgen når
 * svaret er kommet. Uten nett, med KI av eller når KI ikke svarer, blir tekstsøket stående: ingen
 * kall og ingen logg. Ingen ny tekst lagres lokalt i nettleseren.
 *
 * Teksten som settes inn, er alltid malens egen (med flettefeltene satt inn), aldri tekst fra KI.
 * Velges en kandidat fra KI-listen, lagrer serveren teksten og beslutningen sammen (A469); lukkes
 * listen uten valg, avvises forslaget, så ingen rad blir stående som forslag. Ingen tilgangslogikk
 * her: knappen vises bare når skjermen kan endres, og serveren sjekker hver handling.
 * Støtter hovedmål: de ansatte (to trykk fra «Forslag» til tekst, også uten nett), KI i bunnen
 * (KI sorterer, takstmannen velger) og færre reklamasjoner (like formuleringer, TG som tekst).
 */

/** Hvor lenge listen tar imot trykk ikke mens den byttes (avsnitt 10). */
export const PHRASE_SWAP_MS = 150;

type Phase = "searching" | "swapping" | "ranked" | "no_match" | "fallback" | "limit";

type ListState = {
  phase: Phase;
  items: PhraseItem[];
  /** Raden i KI-loggen for KI-listen (og for «Ingen treff» fra KI). */
  usageId: string | null;
  /** Elementet fokus går tilbake til ved Esc og «Lukk». */
  returnFocusId: string;
};

type UndoState = {
  action: PhraseAction;
  /** Feltet «Angre» står ved. Fokus på et annet tekstfelt fjerner linjen. */
  fieldId: string;
  /** Det nye tiltaket, når valget la til et tiltak. */
  measureId: string | null;
  otherTg: 2 | 3 | null;
  run(): Promise<string | null>;
};

export type PhraseSuggestionsInput = {
  deviation: DeviationView;
  checkpointKey: string;
  field: PhraseField;
  /** Teksten i feltet nå (tom for tiltak). */
  current: string;
  /** Teksten i feltet er malens standardtekst. Da heter valget «Sett inn». */
  currentIsTemplateText: boolean;
  /** Nøkkelen til feltet i lagringskøen (ikke for tiltak). */
  fieldKey: string | null;
};

const ACTION_WORD: Record<PhraseAction, string> = {
  insert: AI_ROOM_TEXTS.actionInsert,
  replace: AI_ROOM_TEXTS.actionReplace,
  add_measure: AI_ROOM_TEXTS.actionAddMeasure,
};

const AFTER_TEXT: Record<PhraseAction, string> = {
  insert: AI_ROOM_TEXTS.inserted,
  replace: AI_ROOM_TEXTS.replaced,
  add_measure: AI_ROOM_TEXTS.measureAdded,
};

/** Legger markøren sist i feltet. */
function focusEnd(id: string): boolean {
  const element = document.getElementById(id);
  if (!element) return false;
  element.focus();
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    const end = element.value.length;
    element.setSelectionRange(end, end);
  }
  return true;
}

/** Fokus etter neste tegning, når elementet kan komme senere (et nytt tiltak). */
function focusSoon(id: string, end = false) {
  const tryFocus = () => (end ? focusEnd(id) : Boolean(document.getElementById(id)?.focus()));
  requestAnimationFrame(() => {
    if (!document.getElementById(id)) requestAnimationFrame(() => void tryFocus());
    else void tryFocus();
  });
}

/**
 * Tilstanden for «Forslag» ved ett felt. Gir knappen, listen og linjen med «Angre», som skjermen
 * setter inn der designet sier.
 */
export function usePhraseSuggestions(input: PhraseSuggestionsInput) {
  const { deviation, checkpointKey, field, current, currentIsTemplateText, fieldKey } = input;
  const { room, run, store, online, document, doc, phraseUsage, mergeValuesFor, announce } =
    useRoom();
  const listId = useId();
  const [list, setListState] = useState<ListState | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  // Listen slik den er nå, for handlingene som kjører etter et kall (samme verdi som `list`)
  const openRef = useRef<ListState | null>(null);
  const setList = useCallback((next: ListState | null) => {
    openRef.current = next;
    setListState(next);
  }, []);

  // Flettefeltene leses ved hvert trykk, så svarene som er endret siden, er med.
  const toItems = useCallback(
    (candidates: Parameters<typeof phraseItems>[0]) =>
      phraseItems(candidates, {
        doc,
        mergeValues: mergeValuesFor(checkpointKey, deviation.measurementValue),
        deviationTg: deviation.tg,
      }),
    [doc, mergeValuesFor, checkpointKey, deviation.measurementValue, deviation.tg],
  );
  const fieldId = fieldKey ? domId(fieldKey) : null;
  const action = phraseActionFor(field, current, currentIsTemplateText);

  /** Avviser KI-listen som lukkes uten valg, så ingen rad blir stående som forslag. */
  const rejectQuietly = useCallback(
    (usageId: string | null) => {
      if (!usageId) return;
      void decideAiSuggestionAction(room, { usageId, decision: "rejected" }).catch(() => {});
    },
    [room],
  );

  // Listen lukkes når avvikskortet forsvinner (bytte av punkt): KI-listen avvises.
  useEffect(
    () => () => {
      const open = openRef.current;
      if (open && (open.phase === "ranked" || open.phase === "no_match")) {
        rejectQuietly(open.usageId);
      }
    },
    [rejectQuietly],
  );

  // «Angre» står til fokus går til et annet tekstfelt (avsnitt 4).
  useEffect(() => {
    if (!undo) return;
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Element | null;
      if (target && isTextField(target) && target.id !== undo.fieldId) setUndo(null);
    };
    window.document.addEventListener("focusin", onFocusIn);
    return () => window.document.removeEventListener("focusin", onFocusIn);
  }, [undo]);

  const close = useCallback(
    (returnFocus: boolean) => {
      const open = openRef.current;
      request.current += 1;
      setList(null);
      if (!open) return;
      if (open.phase === "ranked" || open.phase === "no_match") rejectQuietly(open.usageId);
      if (returnFocus) focusSoon(open.returnFocusId, true);
    },
    [rejectQuietly, setList],
  );

  const openList = useCallback(
    async (returnFocusId: string) => {
      if (openRef.current) return;
      setError(null);
      setUndo(null);
      const searched = toItems(
        phraseTextSearch({
          document,
          field,
          deviation,
          checkpointKey,
          current,
          currentIsTemplateText,
          usage: phraseUsage,
        }),
      );
      const ticket = ++request.current;
      if (!online) {
        setList({ phase: "fallback", items: searched, usageId: null, returnFocusId });
        announce(
          searched.length > 0 ? AI_ROOM_TEXTS.liveFallback(searched.length) : AI_ROOM_TEXTS.noHits,
        );
        return;
      }
      setList({ phase: "searching", items: searched, usageId: null, returnFocusId });
      announce(
        searched.length > 0 ? AI_ROOM_TEXTS.liveHits(searched.length) : AI_ROOM_TEXTS.noHits,
      );
      const result = await run(() =>
        suggestPhrasesAction(room, {
          requestId: uuidv7(),
          deviationId: deviation.id,
          field,
          text: field === "new_measure" ? "" : current,
        }),
      );
      // Listen er lukket eller åpnet på nytt mens KI jobbet: svaret gjelder ikke lenger.
      if (ticket !== request.current) {
        if (
          !isActionError(result) &&
          (result.status === "ranked" || result.status === "no_match")
        ) {
          rejectQuietly(result.usageId);
        }
        return;
      }
      if (isActionError(result) || result.status === "ai_off" || result.status === "ai_error") {
        setList({ phase: "fallback", items: searched, usageId: null, returnFocusId });
        announce(
          searched.length > 0 ? AI_ROOM_TEXTS.liveFallback(searched.length) : AI_ROOM_TEXTS.noHits,
        );
        return;
      }
      if (result.status === "too_many_candidates") {
        setList({ phase: "limit", items: searched, usageId: null, returnFocusId });
        return;
      }
      if (result.status === "no_match") {
        setList({ phase: "no_match", items: [], usageId: result.usageId, returnFocusId });
        announce(AI_ROOM_TEXTS.noHits);
        return;
      }
      const ranked = toItems(result.candidates satisfies RankedPhraseCandidate[]);
      // Byttet én gang; listen tar ikke imot trykk mens det skjer.
      setList({ phase: "swapping", items: ranked, usageId: result.usageId, returnFocusId });
      setTimeout(() => {
        if (ticket !== request.current) return;
        const now = openRef.current;
        if (now && now.phase === "swapping") setList({ ...now, phase: "ranked" });
        announce(AI_ROOM_TEXTS.liveRanked(ranked.length));
      }, PHRASE_SWAP_MS);
    },
    [
      setList,
      toItems,
      document,
      field,
      deviation,
      checkpointKey,
      current,
      currentIsTemplateText,
      phraseUsage,
      online,
      announce,
      run,
      room,
      rejectQuietly,
    ],
  );

  /** Setter inn tekst uten KI-listen (tekstsøket): som om takstmannen skrev den. */
  const insertLocal = useCallback(
    async (item: PhraseItem): Promise<UndoState | string> => {
      if (field === "new_measure") {
        const id = uuidv7();
        const added = await run(() => addMeasureAction(room, { id, deviationId: deviation.id }));
        if (isActionError(added)) return added.message;
        const saved = await run(() =>
          saveFieldAction(room, {
            table: "deviation_measures",
            id,
            field: "text",
            value: item.text,
            base: "",
          }),
        );
        if (isActionError(saved)) return saved.message;
        return {
          action: "add_measure",
          fieldId: domId(measureFieldKey(id, "text")),
          measureId: id,
          otherTg: item.otherTg,
          run: async () => {
            const removed = await run(() => removeMeasureAction(room, id));
            if (isActionError(removed)) return removed.message;
            store.drop(`measure:${id}:`);
            return null;
          },
        };
      }
      if (!fieldKey || !fieldId) return ROOM_ACTION_MESSAGES.invalid;
      const previous = current;
      store.edit(fieldKey, item.text, 0);
      return {
        action,
        fieldId,
        measureId: null,
        otherTg: item.otherTg,
        run: async () => {
          store.edit(fieldKey, previous, 0);
          return null;
        },
      };
    },
    [field, run, room, deviation.id, store, fieldKey, fieldId, current, action],
  );

  /** Setter inn en kandidat fra KI-listen: serveren lagrer teksten og beslutningen sammen. */
  const insertRanked = useCallback(
    async (item: PhraseItem, usageId: string): Promise<UndoState | string> => {
      if (!item.ref) return ROOM_ACTION_MESSAGES.invalid;
      const measureId = field === "new_measure" ? uuidv7() : undefined;
      const previous = current;
      const result = await run(() =>
        applyPhraseAction(room, {
          usageId,
          candidate: item.ref!,
          base: field === "new_measure" ? null : previous === "" ? null : previous,
          ...(measureId ? { measureId } : {}),
        }),
      );
      if (isActionError(result)) return result.message;
      if (result.status === "conflict") return ROOM_ACTION_MESSAGES.conflict;
      const undoDecision = async () => {
        const undone = await decideAiSuggestionAction(room, { usageId, decision: "undo" }).catch(
          () => ({ status: "error" as const, message: ROOM_ACTION_MESSAGES.network }),
        );
        return isActionError(undone) ? undone.message : null;
      };
      if (measureId) {
        return {
          action: "add_measure",
          fieldId: domId(measureFieldKey(measureId, "text")),
          measureId,
          otherTg: item.otherTg,
          run: async () => {
            const removed = await run(() => removeMeasureAction(room, measureId));
            if (isActionError(removed)) return removed.message;
            store.drop(`measure:${measureId}:`);
            return undoDecision();
          },
        };
      }
      if (!fieldKey || !fieldId) return ROOM_ACTION_MESSAGES.invalid;
      return {
        action,
        fieldId,
        measureId: null,
        otherTg: item.otherTg,
        run: async () => {
          store.edit(fieldKey, previous, 0);
          return undoDecision();
        },
      };
    },
    [field, current, run, room, store, fieldKey, fieldId, action],
  );

  const choose = useCallback(
    async (item: PhraseItem) => {
      const open = openRef.current;
      if (!open || open.phase === "swapping" || busy) return;
      setBusy(true);
      setError(null);
      // Listen lukkes; et valg fra KI-listen er beslutningen, så den avvises ikke.
      request.current += 1;
      setList(null);
      const fromAi = open.phase === "ranked" && open.usageId !== null && item.ref !== null;
      if (!fromAi && (open.phase === "ranked" || open.phase === "no_match")) {
        rejectQuietly(open.usageId);
      }
      const outcome = fromAi
        ? await insertRanked(item, open.usageId as string)
        : await insertLocal(item);
      setBusy(false);
      if (typeof outcome === "string") {
        setError(outcome);
        focusSoon(open.returnFocusId);
        return;
      }
      setUndo(outcome);
      announce(AI_ROOM_TEXTS.liveApplied(AFTER_TEXT[outcome.action]));
      focusSoon(outcome.fieldId, true);
    },
    [busy, setList, rejectQuietly, insertRanked, insertLocal, announce],
  );

  const runUndo = useCallback(async () => {
    if (!undo) return;
    setBusy(true);
    const message = await undo.run();
    setBusy(false);
    setUndo(null);
    if (message) {
      setError(message);
      return;
    }
    announce(AI_ROOM_TEXTS.liveUndone);
    if (fieldId) focusSoon(fieldId, true);
  }, [undo, announce, fieldId]);

  const button = (
    <PhraseButton
      field={field}
      expanded={list !== null}
      controls={listId}
      disabled={busy}
      onClick={(event) => {
        if (list) close(true);
        else void openList(event.currentTarget.id);
      }}
      id={`${listId}-button`}
    />
  );

  const listNode = list ? (
    <PhraseList
      id={listId}
      state={list}
      action={action}
      onChoose={(item) => void choose(item)}
      onClose={() => close(true)}
    />
  ) : null;

  const undoNode = undo ? (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-sm text-slate-900">{AFTER_TEXT[undo.action]}</p>
        <Button
          variant="secondary"
          size="md"
          className="min-w-11"
          disabled={busy}
          onClick={() => void runUndo()}
        >
          {AI_ROOM_TEXTS.undo}
        </Button>
      </div>
      {undo.otherTg !== null && <Warning>{textsWrittenForTgText(undo.otherTg)}</Warning>}
    </div>
  ) : null;

  const errorNode = error ? (
    <p role="alert" className="text-sm text-urgent-text">
      {error}
    </p>
  ) : null;

  return {
    button,
    list: listNode,
    undo: undoNode,
    undoMeasureId: undo?.measureId ?? null,
    error: errorNode,
    /** Åpner listen fra feltet («/» eller Ctrl+.). Fokus går tilbake til feltet. */
    openFromField: () => {
      if (fieldId) void openList(fieldId);
    },
  };
}

/** Tre korte streker: «Forslag» er malens tekster, ikke KI (D3). */
function LinesIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 7h14M5 12h14M5 17h9" />
    </svg>
  );
}

/** «Forslag» i etikettlinjen (avsnitt 3). Tilgjengelig navn «Forslag til avvik (/)» osv. */
export function PhraseButton({
  id,
  field,
  expanded,
  controls,
  disabled,
  onClick,
}: {
  id: string;
  field: PhraseField;
  expanded: boolean;
  controls: string;
  disabled?: boolean;
  onClick(event: React.MouseEvent<HTMLButtonElement>): void;
}) {
  return (
    <Button
      id={id}
      variant="secondary"
      size="md"
      className="min-w-11 px-3"
      aria-label={AI_ROOM_TEXTS.suggestLabel(field)}
      aria-expanded={expanded}
      aria-controls={expanded ? controls : undefined}
      disabled={disabled}
      onClick={onClick}
      data-ai-control="phrase"
    >
      <LinesIcon />
      {AI_ROOM_TEXTS.suggest}
    </Button>
  );
}

function headingFor(phase: Phase): { text: string; ai: boolean } {
  switch (phase) {
    case "ranked":
    case "swapping":
    case "no_match":
      return { text: AI_ROOM_TEXTS.listRanked, ai: true };
    case "fallback":
      return { text: AI_ROOM_TEXTS.listFallback, ai: false };
    default:
      return { text: AI_ROOM_TEXTS.listTextSearch, ai: false };
  }
}

/** Listen rett under feltet (avsnitt 4). Ikke sprettopp, ikke dialog. */
export function PhraseList({
  id,
  state,
  action,
  onChoose,
  onClose,
}: {
  id: string;
  state: Pick<ListState, "phase" | "items">;
  action: PhraseAction;
  onChoose(item: PhraseItem): void;
  onClose(): void;
}) {
  const [activeKey, setActiveKey] = useState<string | null>(state.items[0]?.key ?? null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const listRef = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  const [previousItems, setPreviousItems] = useState(state.items);
  const swapping = state.phase === "swapping";

  // Byttes listen, står samme kandidat aktiv på sin nye plass; ellers den første.
  if (previousItems !== state.items) {
    setPreviousItems(state.items);
    const index = focusIndexAfterSwap(activeKey, state.items);
    setActiveKey(state.items[index]?.key ?? null);
  }

  // Fokus på første kandidat når listen åpnes, og på samme kandidat når listen byttes
  useEffect(() => {
    const focusInList = listRef.current?.contains(window.document.activeElement) ?? false;
    if (!opened.current || focusInList) {
      const target = activeKey ? buttons.current.get(activeKey) : null;
      if (target) {
        target.focus();
        opened.current = true;
      } else if (!opened.current && state.items.length === 0) {
        listRef.current?.querySelector<HTMLButtonElement>("[data-phrase-close]")?.focus();
        opened.current = true;
      }
    }
  }, [activeKey, state.items]);

  const heading = headingFor(state.phase);
  const count =
    state.phase === "ranked" || state.phase === "swapping"
      ? AI_ROOM_TEXTS.countRanked(state.items.length)
      : AI_ROOM_TEXTS.countHits(state.items.length);

  let empty: ReactNode = null;
  if (state.items.length === 0) {
    if (state.phase === "searching") {
      empty = (
        <p className="text-base text-slate-900">
          {AI_ROOM_TEXTS.noHitsSearching}{" "}
          <span aria-hidden="true" className="motion-safe:animate-pulse">
            …
          </span>
        </p>
      );
    } else if (state.phase === "no_match") {
      empty = <p className="text-base text-slate-900">{AI_ROOM_TEXTS.noMatchAi}</p>;
    } else {
      empty = <p className="text-base text-slate-900">{AI_ROOM_TEXTS.noHits}</p>;
    }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (swapping) {
      if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) {
        event.preventDefault();
      }
      return;
    }
    const index = state.items.findIndex((item) => item.key === activeKey);
    const next = listKeyTarget(event.key, Math.max(0, index), state.items.length);
    if (next === null) return;
    event.preventDefault();
    const key = state.items[next]?.key ?? null;
    setActiveKey(key);
    if (key) buttons.current.get(key)?.focus();
  };

  return (
    <div
      id={id}
      ref={listRef}
      className="space-y-3 rounded-xl bg-sand p-4"
      onKeyDown={onKeyDown}
      data-testid="phrase-list"
      data-phase={state.phase}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p
          className={
            heading.ai
              ? "flex items-center gap-1.5 font-medium text-ai-900"
              : "font-medium text-slate-700"
          }
          data-testid="phrase-list-heading"
        >
          {heading.ai && <AiSparkIcon className="text-ai-700" />}
          {heading.text}
        </p>
        {state.items.length > 0 && <p className="text-slate-700">{count}</p>}
      </div>
      {state.phase === "limit" && <p className="text-sm text-slate-900">{AI_ROOM_TEXTS.limit}</p>}
      {empty}
      {state.items.length > 0 && (
        <ul
          aria-busy={swapping || undefined}
          className={
            swapping ? "pointer-events-none space-y-2 md:space-y-3" : "space-y-2 md:space-y-3"
          }
        >
          {state.items.map((item) => (
            <li key={item.key}>
              <PhraseCandidateButton
                item={item}
                action={action}
                active={item.key === activeKey}
                buttonRef={(element) => {
                  if (element) buttons.current.set(item.key, element);
                  else buttons.current.delete(item.key);
                }}
                onFocus={() => setActiveKey(item.key)}
                onChoose={() => {
                  if (!swapping) onChoose(item);
                }}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end">
        <Button
          variant="secondary"
          size="md"
          className="min-w-11"
          onClick={onClose}
          data-phrase-close
        >
          {AI_ROOM_TEXTS.close}
        </Button>
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {liveText(state)}
      </p>
    </div>
  );
}

function liveText(state: Pick<ListState, "phase" | "items">): string {
  const n = state.items.length;
  switch (state.phase) {
    case "searching":
      return n > 0 ? AI_ROOM_TEXTS.liveHits(n) : AI_ROOM_TEXTS.noHits;
    case "ranked":
      return AI_ROOM_TEXTS.liveRanked(n);
    case "fallback":
      return n > 0 ? AI_ROOM_TEXTS.liveFallback(n) : AI_ROOM_TEXTS.noHits;
    case "no_match":
      return AI_ROOM_TEXTS.noHits;
    case "limit":
      return AI_ROOM_TEXTS.limit;
    default:
      return "";
  }
}

function tgText(item: PhraseItem): string | null {
  if (item.hms) return AI_ROOM_TEXTS.hms;
  return item.tg === null ? null : `TG${item.tg}`;
}

/** Én kandidat (avsnitt 4): teksten slik den havner i feltet, metalinjen og handlingsordet. */
function PhraseCandidateButton({
  item,
  action,
  active,
  buttonRef,
  onFocus,
  onChoose,
}: {
  item: PhraseItem;
  action: PhraseAction;
  active: boolean;
  buttonRef(element: HTMLButtonElement | null): void;
  onFocus(): void;
  onChoose(): void;
}) {
  const word = ACTION_WORD[action];
  const tg = tgText(item);
  const label = [
    `${word}: ${item.text}`,
    item.checkpointName,
    item.outcomeName,
    item.hms ? AI_ROOM_TEXTS.hms : null,
    item.tg !== null && !item.hms ? tgBadgeFullText(String(item.tg) as "2" | "3") : null,
    item.draft ? "utkast" : null,
    item.mostUsed ? "mest brukt" : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <button
      ref={buttonRef}
      type="button"
      tabIndex={active ? 0 : -1}
      aria-label={label}
      onFocus={onFocus}
      onClick={onChoose}
      className="min-h-11 w-full rounded-xl border border-line bg-white p-4 text-left hover:bg-snow"
      data-testid="phrase-candidate"
    >
      <span className="block text-base break-words whitespace-pre-wrap text-slate-900">
        {item.text}
      </span>
      {item.missing.map((field) => (
        <span key={field} className="mt-1 block text-sm text-slate-700">
          {mergeFieldWarningText(field)}
        </span>
      ))}
      <span className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-700">
        <span className="break-words">
          {[item.checkpointName, item.outcomeName].filter(Boolean).join(" · ")}
        </span>
        {item.hms ? (
          <Badge>{AI_ROOM_TEXTS.hms}</Badge>
        ) : tg !== null ? (
          <TgBadge tg={String(item.tg) as "2" | "3"} />
        ) : null}
        {item.draft && <Badge>{AI_ROOM_TEXTS.draft}</Badge>}
        {item.mostUsed && (
          <Badge>
            {AI_ROOM_TEXTS.mostUsed}
            <span className="sr-only">{AI_ROOM_TEXTS.mostUsedSr}</span>
          </Badge>
        )}
        <span className="ml-auto font-semibold text-slate-900">{word}</span>
      </span>
    </button>
  );
}
