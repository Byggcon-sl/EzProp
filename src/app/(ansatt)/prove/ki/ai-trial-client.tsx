"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  AI_QUEUE_GAVE_UP_MESSAGE,
  AI_QUEUE_REJECT_MESSAGES,
  createAiQueue,
  createIndexedDbAiQueueStore,
  type AiQueue,
  type AiQueueEvent,
  type AiQueueOwner,
  type AiQueueSendPayload,
} from "@/core/ai/client";
import { cn } from "@/shared/lib/cn";
import {
  AI_SUGGESTION_TEXTS,
  AiSuggestion,
  undoAfterEdit,
  type AiSuggestionCardOutcome,
  type AiSuggestionCardStatus,
} from "@/shared/ui/ai-suggestion";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { FormMessage, Textarea } from "@/shared/ui/form";
import {
  decideTrialSuggestion,
  requestTrialSuggestion,
  type TrialLogged,
  type TrialSuggestionResponse,
} from "./actions";

/*
 * Klientdelen av /prove/ki. Teksten i feltet holdes bare i nettleseren (ingen ny tabell). Egen
 * tekst overskrives aldri uten «Bruk», og tas vare på før byttet, så «Angre» gir den tilbake
 * (avklaring B i testplanen). Status og KI-merket bygger bare på status lest fra loggen.
 * Mål-id: én per sidevisning. Ny `requestId` per forespørsel.
 *
 * KI-køen (docs/funksjoner/fase2a-ki-ko.md Omfang 3–5): uten nett legges forespørselen i køen på
 * enheten og sendes gjennom serverhandlingen når nettet er tilbake. Ved ny lasting hentes mål-id
 * og tekst fra køen. Kortet husker teksten forslaget ble laget fra, så et sent forslag aldri
 * skriver over nyere egen tekst (T-0004). Teksten legges bare i IndexedDB, aldri i annen
 * lagring i nettleseren, adressen eller konsollen.
 * Støtter hovedmål: de ansatte (ett trykk uten nett, teksten står etter ny lasting) og færre
 * reklamasjoner (et sent forslag skriver aldri over nyere egen tekst).
 */

/** Måltypen for prøvesiden. Står bare her, aldri i `@/core/ai/client`. */
const TRIAL_TARGET_TYPE = "ai_trial";
const TRIAL_FIELD_KEY = "text";

const UNKNOWN = "Noe gikk galt. Teksten din er uendret. Prøv igjen.";
const WRITE_FIRST = "Skriv en setning først.";

type Current = {
  usageId: string;
  text: string;
  status: AiSuggestionCardStatus | null;
  /** Teksten forslaget ble laget fra (T-0004). */
  sourceText: string;
};
type Decision = "accepted" | "rejected" | "undo";

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

function cardStatus(logged: TrialLogged): AiSuggestionCardStatus | null {
  return logged?.status ?? null;
}

/** «Logget: …» for linjen under kortet. Bare status lest fra loggen. */
export function loggedLabel(logged: TrialLogged): string | null {
  if (!logged) return null;
  if (logged.status === "suggested") return "Logget: forslag";
  if (logged.status === "accepted" || logged.status === "edited") return "Logget: godtatt";
  if (logged.status === "rejected") return "Logget: avvist";
  if (logged.outcome === "no_match") return "Logget: ingen forslag";
  if (logged.outcome === "error") return "Logget: KI svarte ikke";
  return null;
}

/** Det køen sender: bare de tre feltene serverhandlingen tar imot (aldri eier, tid eller forsøk). */
function sendQueued(payload: AiQueueSendPayload): Promise<TrialSuggestionResponse> {
  return requestTrialSuggestion({
    requestId: payload.requestId,
    targetId: payload.targetId,
    text: payload.fields[TRIAL_FIELD_KEY] ?? "",
  });
}

export function AiTrialClient({ owner }: { owner: AiQueueOwner }) {
  const online = useOnline();
  const [text, setText] = useState("");
  /** Egen tekst slik den var da forslaget ble laget («Din tekst» i kortet). */
  const [requestedText, setRequestedText] = useState("");
  /** Egen tekst i feltet rett før «Bruk», så «Angre» kan gi den tilbake. */
  const [ownBeforeUse, setOwnBeforeUse] = useState<string | null>(null);
  const [current, setCurrent] = useState<Current | null>(null);
  const [outcome, setOutcome] = useState<AiSuggestionCardOutcome | null>(null);
  const [pending, setPending] = useState<"suggestion" | "decision" | null>(null);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [hasNewer, setHasNewer] = useState(false);
  const [logged, setLogged] = useState<TrialLogged>(null);
  const [message, setMessage] = useState<string | null>(null);
  /** Nøytral melding (ikke feil), for eksempel etter «Angre» med endret tekst. */
  const [notice, setNotice] = useState<string | null>(null);
  /** Forespørselen ligger i KI-køen og venter på nett. */
  const [queued, setQueued] = useState(false);
  /** Nettet falt midt i et kall: kortet står med «Krever nett …» til nettet er tilbake. */
  const [interrupted, setInterrupted] = useState(false);

  // Én mål-id per sidevisning, laget i nettleseren ved første forespørsel (eller hentet fra køen)
  const targetId = useRef<string | null>(null);
  // Hindrer to kall av gangen (dobbelttrykk kommer før React rekker å låse knappen)
  const inFlight = useRef<string | null>(null);
  // KI-køen på enheten. Lages først i nettleseren (IndexedDB finnes ikke på serveren).
  const queueRef = useRef<AiQueue | null>(null);
  // `requestId` på siste post denne siden la i køen (eller fant ved lasting)
  const queuedRequestId = useRef<string | null>(null);
  // Siste utgave av hendelsesbehandleren, så køen alltid ser gjeldende tilstand
  const onQueueEventRef = useRef<(event: AiQueueEvent<TrialSuggestionResponse>) => void>(() => {});
  // Starter en runde i køen (settes av effekten under, så den bruker køen for gjeldende eier)
  const runQueueRef = useRef<() => Promise<void>>(async () => {});
  // Køen behandles allerede: kjør én runde til når den er ferdig (ny post kom underveis)
  const running = useRef(false);
  const runAgain = useRef(false);

  // Faller nettet midt i et kall, slippes kallet: ingenting henger, og egen tekst står
  useEffect(() => {
    function onOffline() {
      if (inFlight.current === null) return;
      inFlight.current = null;
      setPending(null);
      setInterrupted(true);
    }
    window.addEventListener("offline", onOffline);
    return () => window.removeEventListener("offline", onOffline);
  }, []);

  // Køen lages ved lasting. Egen post fra før: mål-id og tekst hentes fra den (T-0035 punkt 4).
  // Køen behandles ved lasting og hver gang nettet kommer tilbake.
  const { organizationId, employeeId } = owner;
  useEffect(() => {
    let active = true;
    const queue = createAiQueue({
      store: createIndexedDbAiQueueStore(),
      owner: { organizationId, employeeId },
    });
    queueRef.current = queue;

    async function run() {
      if (!navigator.onLine) return;
      if (running.current) {
        runAgain.current = true;
        return;
      }
      running.current = true;
      try {
        do {
          runAgain.current = false;
          const result = await queue.processQueue<TrialSuggestionResponse>(
            (payload) => sendQueued(payload),
            (event) => {
              if (active) onQueueEventRef.current(event);
            },
          );
          if (result.kind === "stopped") break;
        } while (active && runAgain.current && navigator.onLine);
      } finally {
        running.current = false;
      }
    }
    runQueueRef.current = run;

    function onOnline() {
      setInterrupted(false);
      void run();
    }
    window.addEventListener("online", onOnline);

    void (async () => {
      const listed = await queue.list();
      if (!active) return;
      if (listed.kind === "listed") {
        const own = listed.entries.findLast(
          (entry) => entry.targetType === TRIAL_TARGET_TYPE && entry.fieldKey === TRIAL_FIELD_KEY,
        );
        const ownText = own?.fields[TRIAL_FIELD_KEY];
        if (own && ownText !== undefined && targetId.current === null) {
          targetId.current = own.targetId;
          queuedRequestId.current = own.requestId;
          setText((before) => (before === "" ? ownText : before));
          setRequestedText(ownText);
          setQueued(true);
        }
      }
      await run();
    })();

    return () => {
      active = false;
      window.removeEventListener("online", onOnline);
      if (queueRef.current === queue) queueRef.current = null;
    };
  }, [organizationId, employeeId]);

  /** Svaret på en forespørsel, fra kallet direkte eller fra køen. `sent` er teksten som ble sendt. */
  function applyResult(result: TrialSuggestionResponse, sent: string) {
    if (result.kind === "failed") {
      setMessage(result.message);
    } else if (result.kind === "disabled") {
      setAiEnabled(false);
    } else if (result.kind === "suggestion") {
      setCurrent({
        usageId: result.usageId,
        text: result.text,
        status: cardStatus(result.logged),
        sourceText: sent,
      });
      setRequestedText(sent);
      setOwnBeforeUse(null);
      setHasNewer(false);
      setOutcome("ok");
      setLogged(result.logged);
    } else {
      // Ingen forslag eller feil: forrige forslag står igjen (A164)
      if (!current) setRequestedText(sent);
      setOutcome(result.kind);
      setLogged(result.logged);
    }
  }

  // Hendelser fra køen. Bare siste post for denne sidens mål vises; feltet røres aldri.
  useEffect(() => {
    onQueueEventRef.current = (event) => {
      if (event.entry.targetId !== targetId.current) return;
      // Et eldre svar på samme felt (posten ble erstattet underveis) vises ikke
      if (event.entry.requestId !== queuedRequestId.current) return;
      queuedRequestId.current = null;
      setQueued(false);
      if (event.kind === "gave_up") {
        setMessage(AI_QUEUE_GAVE_UP_MESSAGE);
        return;
      }
      applyResult(event.result, event.entry.fields[TRIAL_FIELD_KEY] ?? "");
    };
  });

  function finish(callId: string) {
    if (inFlight.current !== callId) return;
    inFlight.current = null;
    setPending(null);
  }

  /** Uten nett: legg forespørselen i køen. Kortet viser «Venter på KI …». */
  async function enqueue(sent: string, target: string) {
    const queue = queueRef.current;
    if (!queue) {
      setMessage(AI_QUEUE_REJECT_MESSAGES.unavailable);
      return;
    }
    const result = await queue.enqueue({
      targetType: TRIAL_TARGET_TYPE,
      targetId: target,
      fieldKey: TRIAL_FIELD_KEY,
      assignmentId: null,
      feature: "language_polish",
      fields: { [TRIAL_FIELD_KEY]: sent },
    });
    if (result.kind === "rejected") {
      setMessage(AI_QUEUE_REJECT_MESSAGES[result.reason]);
      return;
    }
    queuedRequestId.current = result.entry.requestId;
    setRequestedText(sent);
    setQueued(true);
    // Kom nettet tilbake mens posten ble lagt i kø, sendes den nå
    if (navigator.onLine) void runQueueRef.current();
  }

  async function suggest() {
    if (inFlight.current !== null || !aiEnabled) return;
    const sent = text;
    if (sent.trim() === "") {
      setMessage(WRITE_FIRST);
      return;
    }
    targetId.current ??= crypto.randomUUID();
    setMessage(null);
    setNotice(null);
    setInterrupted(false);
    if (!navigator.onLine) {
      await enqueue(sent, targetId.current);
      return;
    }
    const requestId = crypto.randomUUID();
    inFlight.current = requestId;
    setPending("suggestion");
    try {
      const result = await requestTrialSuggestion({
        requestId,
        targetId: targetId.current,
        text: sent,
      });
      if (inFlight.current !== requestId) return;
      applyResult(result, sent);
    } catch {
      if (inFlight.current !== requestId) return;
      if (navigator.onLine) setOutcome("error");
    } finally {
      finish(requestId);
    }
  }

  async function decide(decision: Decision) {
    if (!current || inFlight.current !== null || !online) return;
    const callId = crypto.randomUUID();
    inFlight.current = callId;
    const fieldBefore = text;
    const statusBefore = current.status;
    // T-0005: er feltet endret etter «Bruk», settes bare statusen tilbake og teksten står
    const undoMode = undoAfterEdit(fieldBefore, current.text);
    setPending("decision");
    setMessage(null);
    setNotice(null);
    try {
      const result = await decideTrialSuggestion({ usageId: current.usageId, decision });
      if (inFlight.current !== callId) return;
      if (result.kind === "failed") {
        setMessage(result.message);
        return;
      }
      const status = cardStatus(result.logged);
      setCurrent({ ...current, status });
      setLogged(result.logged);
      setOutcome("ok");
      if (result.kind === "not_allowed") {
        setMessage(result.message);
        if (decision === "undo") setHasNewer(true);
        return;
      }
      if (decision === "accepted" && status === "accepted") {
        setOwnBeforeUse(fieldBefore);
        setText(current.text);
      }
      if (decision === "undo" && status === "suggested" && statusBefore === "accepted") {
        if (undoMode === "restore") setText(ownBeforeUse ?? requestedText);
        else setNotice(AI_SUGGESTION_TEXTS.undoStatusOnly);
        setOwnBeforeUse(null);
      }
    } catch {
      if (inFlight.current !== callId) return;
      if (navigator.onLine) setMessage(UNKNOWN);
    } finally {
      finish(callId);
    }
  }

  const showCard =
    aiEnabled &&
    (queued || interrupted || pending === "suggestion" || current !== null || outcome !== null);
  const latestIsOk = outcome === "ok";
  // Uten nett er knappen aktiv: forespørselen legges i KI-køen
  const canAsk = aiEnabled && pending === null && text.trim() !== "";
  const label = loggedLabel(logged);

  return (
    <main className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Prøv KI: språkvask</h1>
          <p className="mt-1 text-sm text-slate-600">
            Bruk oppdiktet tekst. Ikke skriv navn, adresse eller kundeopplysninger. Forslaget lagres
            i KI-loggen.
          </p>
        </div>
        <p
          role="status"
          className="inline-flex min-h-11 items-center gap-2 text-sm text-slate-700"
          data-testid="network-status"
        >
          <span
            aria-hidden="true"
            className={cn("size-2.5 rounded-full", online ? "bg-fjord" : "bg-slate-400")}
          />
          {online ? "På nett" : "Uten nett"}
        </p>
      </div>

      <Card className="space-y-3">
        <label htmlFor="ai-trial-text" className="block text-sm font-medium text-slate-900">
          Setning
        </label>
        <Textarea
          id="ai-trial-text"
          rows={3}
          className="min-h-24"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="flex flex-col items-end gap-2">
          <Button
            size="lg"
            disabled={!canAsk}
            aria-describedby={!aiEnabled ? "ai-trial-blocked" : undefined}
            onClick={() => void suggest()}
          >
            Foreslå bedre språk
          </Button>
          {!aiEnabled ? (
            <p id="ai-trial-blocked" className="text-sm text-slate-700">
              {AI_SUGGESTION_TEXTS.aiOff}
            </p>
          ) : null}
        </div>
        {message ? <FormMessage message={message} /> : null}
        {notice ? (
          <p role="status" className="text-sm text-slate-700" data-testid="ai-trial-notice">
            {notice}
          </p>
        ) : null}
      </Card>

      {showCard ? (
        <AiSuggestion
          ownText={requestedText}
          suggestionText={latestIsOk && current ? current.text : null}
          status={latestIsOk && current ? current.status : null}
          outcome={outcome}
          staleSuggestion={
            !latestIsOk && current?.status ? { text: current.text, status: current.status } : null
          }
          aiUsageId={current?.usageId ?? null}
          queued={queued}
          sourceText={current?.sourceText ?? null}
          currentText={text}
          pending={pending}
          online={online}
          aiEnabled={aiEnabled}
          hasNewerSuggestion={hasNewer}
          source="språkvask"
          onUse={() => void decide("accepted")}
          onKeep={() => void decide("rejected")}
          onNewSuggestion={() => void suggest()}
          onUndo={() => void decide("undo")}
        />
      ) : null}

      <p role="status" className="text-sm text-slate-600" data-testid="ai-trial-logged">
        {label}
      </p>
    </main>
  );
}
