"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@/shared/lib/cn";
import {
  AI_SUGGESTION_TEXTS,
  AiSuggestion,
  type AiSuggestionCardOutcome,
  type AiSuggestionCardStatus,
} from "@/shared/ui/ai-suggestion";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { FormMessage, Textarea } from "@/shared/ui/form";
import { decideTrialSuggestion, requestTrialSuggestion, type TrialLogged } from "./actions";

/*
 * Klientdelen av /prove/ki. Teksten i feltet holdes bare i nettleseren (ingen ny tabell). Egen
 * tekst overskrives aldri uten «Bruk», og tas vare på før byttet, så «Angre» gir den tilbake
 * (avklaring B i testplanen). Status og KI-merket bygger bare på status lest fra loggen.
 * Mål-id: én per sidevisning. Ny `requestId` per forespørsel.
 */

const UNKNOWN = "Noe gikk galt. Teksten din er uendret. Prøv igjen.";
const WRITE_FIRST = "Skriv en setning først.";

type Current = { usageId: string; text: string; status: AiSuggestionCardStatus | null };
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

export function AiTrialClient() {
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

  // Én mål-id per sidevisning, laget i nettleseren ved første forespørsel
  const targetId = useRef<string | null>(null);
  // Hindrer to kall av gangen (dobbelttrykk kommer før React rekker å låse knappen)
  const inFlight = useRef<string | null>(null);

  // Faller nettet midt i et kall, slippes kallet: ingenting henger, og egen tekst står
  useEffect(() => {
    function onOffline() {
      if (inFlight.current === null) return;
      inFlight.current = null;
      setPending(null);
    }
    window.addEventListener("offline", onOffline);
    return () => window.removeEventListener("offline", onOffline);
  }, []);

  function finish(callId: string) {
    if (inFlight.current !== callId) return;
    inFlight.current = null;
    setPending(null);
  }

  async function suggest() {
    if (inFlight.current !== null || !online || !aiEnabled) return;
    const sent = text;
    if (sent.trim() === "") {
      setMessage(WRITE_FIRST);
      return;
    }
    targetId.current ??= crypto.randomUUID();
    const requestId = crypto.randomUUID();
    inFlight.current = requestId;
    setPending("suggestion");
    setMessage(null);
    try {
      const result = await requestTrialSuggestion({
        requestId,
        targetId: targetId.current,
        text: sent,
      });
      if (inFlight.current !== requestId) return;
      if (result.kind === "failed") {
        setMessage(result.message);
      } else if (result.kind === "disabled") {
        setAiEnabled(false);
      } else if (result.kind === "suggestion") {
        setCurrent({
          usageId: result.usageId,
          text: result.text,
          status: cardStatus(result.logged),
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
    setPending("decision");
    setMessage(null);
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
        setText(ownBeforeUse ?? requestedText);
        setOwnBeforeUse(null);
      }
    } catch {
      if (inFlight.current !== callId) return;
      if (navigator.onLine) setMessage(UNKNOWN);
    } finally {
      finish(callId);
    }
  }

  const showCard = aiEnabled && (pending === "suggestion" || current !== null || outcome !== null);
  const latestIsOk = outcome === "ok";
  const canAsk = online && aiEnabled && pending === null && text.trim() !== "";
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
            className={cn("size-2.5 rounded-full", online ? "bg-emerald-600" : "bg-slate-400")}
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
            aria-describedby={!online || !aiEnabled ? "ai-trial-blocked" : undefined}
            onClick={() => void suggest()}
          >
            Foreslå bedre språk
          </Button>
          {!aiEnabled ? (
            <p id="ai-trial-blocked" className="text-sm text-slate-700">
              {AI_SUGGESTION_TEXTS.aiOff}
            </p>
          ) : !online ? (
            <p id="ai-trial-blocked" className="text-sm text-slate-700">
              {AI_SUGGESTION_TEXTS.offline}
            </p>
          ) : null}
        </div>
        {message ? <FormMessage message={message} /> : null}
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
