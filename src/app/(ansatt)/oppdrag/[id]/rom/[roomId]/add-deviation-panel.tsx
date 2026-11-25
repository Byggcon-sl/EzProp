"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  findRegisteredDeviation,
  rankOutcomesBySimilarity,
  searchOutcomes,
  type OutcomeSearchHit,
} from "@/core/reports/logic";
import type {
  AddDeviationInput,
  ChooseOutcomeMatchInput,
  FindOutcomesResult,
  OutcomeMatchHit,
  RoomTemplateDocument,
} from "@/core/reports/types";
import { cn } from "@/shared/lib/cn";
import { AiSparkIcon } from "@/shared/ui/ai-text-mark";
import { Button } from "@/shared/ui/button";
import { FormMessage, Input } from "@/shared/ui/form";
import { Warning } from "@/shared/ui/warning";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  addDeviationAction,
  chooseOutcomeMatchAction,
  findOutcomesAction,
  rejectOutcomeMatchAction,
} from "./actions";
import { OutcomeHitButton } from "./outcome-hit-button";
import { OutcomeMatchHits } from "./outcome-match-hits";
import {
  nextOutcomeRequestId,
  normalizeOutcomeNote,
  OUTCOME_MATCH_IDLE,
  OUTCOME_MATCH_SETTLE_MS,
  OUTCOME_MATCH_TIMEOUT_MS,
  OUTCOME_NEAREST_DELAY_MS,
  openOutcomeMatchUsageId,
  outcomeMatchReducer,
  outcomeMatchSideEffect,
  outcomeMatchView,
  type OutcomeMatchEvent,
  type OutcomeMatchState,
} from "./outcome-match-model";
import { useRoom } from "./room-context";
import { isActionError, OUTCOME_MATCH_TEXTS, ROOM_TEXTS } from "./room-messages";
import {
  deviationHeadingId,
  deviationTgChoiceId,
  outcomeName,
  outcomeTgText,
  OUTCOME_HITS_MAX,
  SEARCH_INPUT_ID,
} from "./room-model";

/*
 * «+ Avvik» (design avsnitt 16, A382) med «Skriv det du ser» (skissen
 * docs/funksjoner/fase2a-skriv-det-du-ser-skisse.md, avsnitt 2–8). Takstmannen skriver hva han
 * ser, eller søker. Tekstsøket kjøres i nettleseren over maldokumentet mens han skriver, som før.
 * «Finn med KI» ligger rett under feltet: serveren bygger kandidatene fra den låste malen, KI
 * rangerer opptil tre av malens utfall, og ingen er valgt på forhånd. Valgt treff lager avviket på
 * serveren med beslutningen i samme transaksjon. Uten nett eller med KI av: tekstsøket som før, og
 * «Nærmeste treff (uten KI)» når tekstsøket ikke gir treff. Notatet står i rommets minne (A566).
 * Ingen tilgangslogikk her; serveren sjekker hvert kall.
 * Hovedmål: KI i bunnen (KI foreslår, takstmannen velger), de ansatte (tre trykk fra notat til
 * avvik, virker uten nett) og færre reklamasjoner (TG med tekst, «Registrert fra før»).
 */

export const ADD_DEVIATION_TEXTS = {
  heading: "Legg til avvik",
  hits: (n: number) => (n === 1 ? "1 treff" : `${n} treff`),
  noHits: "Ingen avvik passer.",
  cancel: "Avbryt",
  tgiuConflict: (tg: string) =>
    `Punktet har TGIU. Et avvik med ${tg} kan ikke stå sammen med TGIU.`,
  removeTgiuAndAdd: "Fjern TGIU og legg til avviket",
  keepTgiu: "Behold TGIU",
} as const;

const COUNTER_ID = "outcome-note-counter";
const FIND_BUTTON_ID = "outcome-match-find-button";
const FIELD_ERROR_ID = "outcome-note-error";

function tgOfKind(kind: OutcomeSearchHit["outcomeKind"]): 2 | 3 | null {
  return kind === "tg2" ? 2 : kind === "tg3" ? 3 : null;
}

type Conflict =
  | { kind: "text"; hit: OutcomeSearchHit; input: AddDeviationInput }
  | { kind: "ai"; hit: OutcomeMatchHit; input: ChooseOutcomeMatchInput };

export function AddDeviationPanel({
  checkpointKey,
  document,
  onClose,
}: {
  checkpointKey: string;
  document: RoomTemplateDocument;
  onClose(): void;
}) {
  const {
    doc,
    run,
    room,
    focus,
    announce,
    openCheckpoint,
    online,
    checkpoints,
    outcomeNote,
    dispatchOutcomeNote,
  } = useRoom();
  const query = outcomeNote.note;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [match, setMatch] = useState<OutcomeMatchState>(OUTCOME_MATCH_IDLE);
  const matchRef = useRef<OutcomeMatchState>(OUTCOME_MATCH_IDLE);
  const [settling, setSettling] = useState(false);
  const [nearestNote, setNearestNote] = useState(query);
  const deviationIds = useRef(new Map<string, string>());
  /** «Finn med KI» hadde fokus da søket startet: fokus settes tilbake når svaret er vist. */
  const refocusFind = useRef(false);
  const searchListRef = useRef<HTMLUListElement>(null);
  const aiListRef = useRef<HTMLDivElement>(null);

  /** Neste tilstand, også i `matchRef`, så svar som kommer etter hverandre ser den nyeste. */
  const send = (event: OutcomeMatchEvent) => {
    const next = outcomeMatchReducer(matchRef.current, event);
    if (next === matchRef.current) return;
    matchRef.current = next;
    setMatch(next);
  };

  const hits = useMemo(
    () => (query.trim() === "" ? [] : searchOutcomes(document, query)),
    [document, query],
  );

  const view = outcomeMatchView({
    state: match,
    note: query,
    online,
    aiOff: outcomeNote.aiOff,
    tooManyCandidates: outcomeNote.tooManyCandidates,
    textHitCount: hits.length,
    choosing: busy,
  });

  // «Nærmeste treff (uten KI)» regnes med 250 ms ro etter siste tastetrykk (skisse avsnitt 8).
  useEffect(() => {
    const timer = setTimeout(() => setNearestNote(query), OUTCOME_NEAREST_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);
  const nearest = useMemo(
    () =>
      view.showNearest && nearestNote.trim() !== ""
        ? rankOutcomesBySimilarity(document, nearestNote, {
            openCheckpointKey: checkpointKey,
            limit: OUTCOME_HITS_MAX,
          })
        : [],
    [view.showNearest, document, nearestNote, checkpointKey],
  );

  // iPad med tastatur oppe: overskriften til toppen, så feltet og knappen står over tastaturet.
  useEffect(() => {
    window.document
      .getElementById("add-deviation-heading")
      ?.scrollIntoView?.({ block: "start", behavior: "auto" });
  }, []);

  // Lukkes panelet på annen måte (bytte av punkt), avvises en åpen liste i bakgrunnen. Rommet
  // leses fra en ref, så en ny tegning av siden aldri avviser listen mens den står åpen.
  const roomRef = useRef(room);
  useEffect(() => {
    roomRef.current = room;
  }, [room]);
  useEffect(
    () => () => {
      const usageId = openOutcomeMatchUsageId(matchRef.current);
      if (usageId) {
        void rejectOutcomeMatchAction(roomRef.current, { usageId }).catch(() => undefined);
      }
    },
    [],
  );

  /** Avviser den åpne listen fra KI i bakgrunnen. Svaret vises ikke (skisse avsnitt 3). */
  const rejectOpen = () => {
    const usageId = openOutcomeMatchUsageId(matchRef.current);
    if (!usageId) return;
    send({ type: "cleared" });
    void rejectOutcomeMatchAction(room, { usageId }).catch(() => undefined);
  };

  /** «Avbryt» og Escape: notatet står, en åpen liste avvises. */
  const close = () => {
    rejectOpen();
    dispatchOutcomeNote({ type: "panel_closed" });
    onClose();
  };

  /** Panelet lukkes etter et valg: listen er alt avgjort, så ingen avvisning. */
  const finish = () => {
    matchRef.current = OUTCOME_MATCH_IDLE;
    onClose();
  };

  const registeredOf = (hit: OutcomeSearchHit): { id: string; number: number } | null => {
    const id = findRegisteredDeviation(hit, checkpoints);
    if (!id) return null;
    const checkpoint = checkpoints.find((c) => c.checkpointKey === hit.checkpointKey);
    const sorted = [...(checkpoint?.deviations ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
    return { id, number: Math.max(1, sorted.findIndex((d) => d.id === id) + 1) };
  };

  /** «Registrert fra før»: åpner avviket som finnes i stedet for å lage et nytt (A559). */
  const openExisting = (hit: OutcomeSearchHit, deviationId: string) => {
    rejectOpen();
    finish();
    const target = deviationHeadingId(deviationId);
    if (hit.checkpointKey !== checkpointKey) openCheckpoint(hit.checkpointKey, { focusId: target });
    else focus(target);
  };

  /** Etter lagret avvik: punktet åpnes, fokus på avviket (eller TG-valget) og melding. */
  const afterSaved = (
    hit: OutcomeSearchHit,
    savedCheckpointKey: string,
    deviationId: string,
    tg: 2 | 3 | null,
  ) => {
    const tgText = hit.outcomeKind === "hms" ? null : tg ? `TG${tg}` : null;
    const target =
      hit.outcomeKind === "choose_tg2_tg3"
        ? deviationTgChoiceId(deviationId)
        : deviationHeadingId(deviationId);
    const message = ROOM_TEXTS.deviationAdded(tgText);
    finish();
    if (savedCheckpointKey !== checkpointKey) {
      openCheckpoint(savedCheckpointKey, { focusId: target, announce: message });
    } else {
      focus(target);
      announce(message);
    }
  };

  /** Avvik fra tekstsøket, «Nærmeste treff» eller punktlisten (som før). */
  const add = async (hit: OutcomeSearchHit, input?: AddDeviationInput) => {
    const registered = input ? null : registeredOf(hit);
    if (registered) {
      openExisting(hit, registered.id);
      return;
    }
    rejectOpen();
    const payload: AddDeviationInput = input ?? {
      id: uuidv7(),
      checkpointKey: hit.checkpointKey,
      questionKey: hit.questionKey,
      outcomeKey: hit.outcomeKey,
      tg: tgOfKind(hit.outcomeKind),
    };
    setBusy(true);
    setError(null);
    const result = await run(() => addDeviationAction(room, payload));
    setBusy(false);
    if (isActionError(result)) {
      setError(result.message);
      return;
    }
    if (result.status === "tgiu_conflict") {
      setConflict({ kind: "text", hit, input: payload });
      focus("add-deviation-conflict");
      return;
    }
    if (result.status !== "saved") return;
    dispatchOutcomeNote({ type: "deviation_added" });
    afterSaved(hit, hit.checkpointKey, payload.id, payload.tg);
  };

  /** Valgt treff fra KI: serveren lager avviket og lagrer beslutningen i samme transaksjon. */
  const chooseAi = async (hit: OutcomeMatchHit, input?: ChooseOutcomeMatchInput) => {
    const state = matchRef.current;
    if (!input) {
      if (state.kind !== "ranked") return;
      const registered = registeredOf(hit);
      if (registered) {
        openExisting(hit, registered.id);
        return;
      }
    }
    let payload = input;
    if (!payload) {
      if (state.kind !== "ranked") return;
      const key = `${state.usageId}/${hit.ref.id}`;
      const deviationId = deviationIds.current.get(key) ?? uuidv7();
      deviationIds.current.set(key, deviationId);
      payload = {
        usageId: state.usageId,
        candidate: hit.ref,
        deviationId,
        tg: tgOfKind(hit.outcomeKind),
      };
    }
    const chosen = payload;
    setBusy(true);
    setError(null);
    const result = await run(() => chooseOutcomeMatchAction(room, chosen));
    setBusy(false);
    if (isActionError(result)) {
      setError(result.message);
      return;
    }
    if (result.status === "tgiu_conflict") {
      setConflict({ kind: "ai", hit, input: chosen });
      focus("add-deviation-conflict");
      return;
    }
    if (result.status === "suggestion_outdated") {
      setConflict(null);
      send({ type: "outdated" });
      return;
    }
    send({ type: "cleared" });
    dispatchOutcomeNote({
      type: "deviation_from_note",
      deviationId: result.deviationId,
      note: query,
    });
    afterSaved(hit, result.checkpointKey, result.deviationId, chosen.tg);
  };

  /** «Finn med KI», «Finn på nytt» og «Prøv igjen». */
  const find = async () => {
    if (!view.button || view.button.disabled) return;
    const note = normalizeOutcomeNote(query);
    // Knappen sperres mens søket går og flyttes under KI-gruppen når treffene kommer. Da mister
    // nettleseren fokuset; det settes tilbake på knappen (skisse avsnitt 5: fokus flyttes ikke).
    refocusFind.current = window.document.activeElement?.id === FIND_BUTTON_ID;
    const requestId = nextOutcomeRequestId(matchRef.current, note, uuidv7);
    setError(null);
    setConflict(null);
    send({ type: "requested", requestId, note });
    const timer = setTimeout(
      () => send({ type: "timed_out", requestId }),
      OUTCOME_MATCH_TIMEOUT_MS,
    );
    let result: FindOutcomesResult | null = null;
    let message: string | null = null;
    try {
      const answer = await findOutcomesAction(room, {
        requestId,
        note,
        openCheckpointKey: checkpointKey,
      });
      if (isActionError(answer)) message = answer.message;
      else result = answer;
    } catch {
      // Nettfeil: «KI svarte ikke. Bruk søket.»
    }
    clearTimeout(timer);
    const current = matchRef.current;
    if (current.kind !== "pending" || current.requestId !== requestId) return;
    if (message !== null) {
      // Et avslag fra serveren (for eksempel publisert rapport) vises som det er.
      send({ type: "cleared" });
      setError(message);
      return;
    }
    const effect = outcomeMatchSideEffect(result);
    if (effect) dispatchOutcomeNote({ type: "side_effect", effect });
    send({ type: "responded", requestId, result });
    // Tekstsøkets treff tar ikke imot trykk rett etter at KI-treffene er satt inn (skisse 2), så
    // et trykk som var på vei, ikke treffer et annet treff.
    if (matchRef.current.kind === "ranked") {
      setSettling(true);
      setTimeout(() => setSettling(false), OUTCOME_MATCH_SETTLE_MS);
    }
  };

  const focusFirst = (container: HTMLElement | null) =>
    container?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();

  /** Pil opp og ned mellom treffene i samme liste; pil opp fra første går til feltet. */
  const moveFocus = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const buttons = event.currentTarget
      .closest("ul")
      ?.querySelectorAll<HTMLButtonElement>("li > button");
    if (!buttons || buttons.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      buttons[Math.min(index + 1, buttons.length - 1)]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (index <= 0) window.document.getElementById(SEARCH_INPUT_ID)?.focus();
      else buttons[index - 1]?.focus();
    }
  };

  /** Punktlisten med tomt felt: pilleknappene som før. */
  const pointButton = (hit: OutcomeSearchHit) => (
    <Button
      variant="secondary"
      className="h-auto min-h-11 max-w-full py-2 text-left whitespace-normal"
      disabled={busy}
      onClick={() => void add(hit)}
    >
      <span className="min-w-0 break-words">
        {outcomeName({ deviation_text: hit.deviationText })} · {outcomeTgText(hit.outcomeKind)}
      </span>
    </Button>
  );

  /** Treffene som knapper. `ai` lager avviket fra KI-treffet, ellers som et manuelt valg. */
  const hitList = (list: readonly OutcomeSearchHit[], source: "ai" | "text", stale = false) =>
    list.map((hit, index) => (
      <li key={`${hit.checkpointKey}/${hit.questionKey}/${hit.outcomeKey}`}>
        <OutcomeHitButton
          hit={hit}
          openCheckpointKey={checkpointKey}
          registeredNumber={registeredOf(hit)?.number ?? null}
          disabled={busy}
          stale={stale}
          onChoose={() => void (source === "ai" ? chooseAi(hit as OutcomeMatchHit) : add(hit))}
          onKeyDown={(event) => moveFocus(event, index)}
        />
      </li>
    ));

  const ownHits = searchOutcomes(document, "").filter((hit) => hit.checkpointKey === checkpointKey);
  const showGroup = view.hits.length > 0;
  const describedBy =
    [view.counter ? COUNTER_ID : null, view.fieldError ? FIELD_ERROR_ID : null]
      .filter(Boolean)
      .join(" ") || undefined;

  useEffect(() => {
    if (view.state === "pending" || !refocusFind.current) return;
    refocusFind.current = false;
    window.document.getElementById(FIND_BUTTON_ID)?.focus();
  }, [view.state]);

  const findButton = view.button && (
    <Button
      variant="secondary"
      size="lg"
      id={FIND_BUTTON_ID}
      data-testid="outcome-match-find"
      disabled={view.button.disabled}
      aria-busy={view.button.busy || undefined}
      onClick={() => void find()}
    >
      <AiSparkIcon className="text-ai-700" />
      {view.button.label}
    </Button>
  );

  return (
    <section
      aria-labelledby="add-deviation-heading"
      className="space-y-4 rounded-card bg-sand p-5"
      data-state={view.state}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
      }}
    >
      <h3 id="add-deviation-heading" className="text-lg font-semibold text-slate-900">
        {ADD_DEVIATION_TEXTS.heading}
      </h3>
      <div className="space-y-1.5">
        <label htmlFor={SEARCH_INPUT_ID} className="block text-sm font-medium text-slate-700">
          {OUTCOME_MATCH_TEXTS.fieldLabel}
        </label>
        <Input
          id={SEARCH_INPUT_ID}
          type="search"
          autoComplete="off"
          enterKeyHint="search"
          className="min-h-14"
          value={query}
          aria-describedby={describedBy}
          aria-invalid={view.fieldError ? true : undefined}
          onChange={(event) => dispatchOutcomeNote({ type: "typed", note: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              focusFirst(showGroup ? aiListRef.current : searchListRef.current);
            } else if (event.key === "Enter" && view.enterRunsAi) {
              event.preventDefault();
              void find();
            }
          }}
        />
        {view.counter && (
          <p
            id={COUNTER_ID}
            className={cn("text-sm", view.counter.over ? "text-urgent-text" : "text-slate-700")}
          >
            {view.counter.text}
          </p>
        )}
        {view.fieldError && (
          <div id={FIELD_ERROR_ID}>
            <FormMessage message={view.fieldError} />
          </div>
        )}
      </div>

      {!showGroup && findButton}

      <p
        role="status"
        aria-live="polite"
        data-testid="outcome-match-message"
        className={cn(
          "text-sm empty:sr-only",
          view.message?.tone === "watch"
            ? "rounded-xl bg-watch-fill px-3 py-2 text-watch-text"
            : view.message?.tone === "neutral" && view.state === "no_match"
              ? "rounded-xl bg-snow px-3 py-2 text-slate-900"
              : "text-slate-700",
        )}
      >
        {view.message?.text ?? ""}
      </p>

      {conflict && (
        <div id="add-deviation-conflict" tabIndex={-1} className="space-y-3">
          <Warning>
            {ADD_DEVIATION_TEXTS.tgiuConflict(conflict.input.tg ? `TG${conflict.input.tg}` : "TG")}
          </Warning>
          <div className="flex flex-wrap gap-3">
            <Button
              size="lg"
              disabled={busy}
              onClick={() => {
                const pending = conflict;
                setConflict(null);
                if (pending.kind === "ai") {
                  void chooseAi(pending.hit, { ...pending.input, tgiuChoice: "remove_tgiu" });
                } else {
                  void add(pending.hit, { ...pending.input, tgiuChoice: "remove_tgiu" });
                }
              }}
            >
              {busy ? ROOM_TEXTS.saving : ADD_DEVIATION_TEXTS.removeTgiuAndAdd}
            </Button>
            <Button variant="secondary" onClick={() => setConflict(null)}>
              {ADD_DEVIATION_TEXTS.keepTgiu}
            </Button>
          </div>
        </div>
      )}

      {showGroup && (
        <div ref={aiListRef} className="space-y-3">
          <OutcomeMatchHits variant="ai" busy={busy} stale={view.hitsStale}>
            {hitList(view.hits, "ai", view.hitsStale)}
          </OutcomeMatchHits>
          {findButton}
        </div>
      )}

      {query.trim() !== "" ? (
        <div className="space-y-2">
          <h4 className="text-base font-medium text-slate-900">
            {OUTCOME_MATCH_TEXTS.searchHeading}
          </h4>
          <p role="status" aria-live="polite" className="text-sm text-slate-700">
            {hits.length > 0
              ? ADD_DEVIATION_TEXTS.hits(hits.length)
              : nearest.length > 0
                ? ADD_DEVIATION_TEXTS.hits(0)
                : ADD_DEVIATION_TEXTS.noHits}
          </p>
          <ul ref={searchListRef} className={cn("space-y-2", settling && "pointer-events-none")}>
            {hitList(hits, "text")}
          </ul>
          {nearest.length > 0 && (
            <div>
              <OutcomeMatchHits variant="nearest" busy={busy}>
                {hitList(nearest, "text")}
              </OutcomeMatchHits>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {doc.questions(checkpointKey).map((question) => {
            const questionHits = ownHits.filter((hit) => hit.questionKey === question.key);
            if (questionHits.length === 0) return null;
            return (
              <div key={question.key} className="space-y-2">
                <h4 className="text-base font-medium text-slate-900">{question.text}</h4>
                <div className="flex flex-wrap gap-2 md:gap-3">
                  {questionHits.map((hit) => (
                    <span key={hit.outcomeKey} className="max-w-full">
                      {pointButton(hit)}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {error && <FormMessage message={error} />}
      <div className="flex justify-end">
        <Button variant="ghost" onClick={close}>
          {ADD_DEVIATION_TEXTS.cancel}
        </Button>
      </div>
    </section>
  );
}
