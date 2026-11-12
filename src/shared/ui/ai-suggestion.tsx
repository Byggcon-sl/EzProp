"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/shared/lib/cn";
import { AiSparkIcon, AiTextMark } from "./ai-text-mark";
import { AI_BUTTON_VARIANT, Button } from "./button";
import { Card } from "./card";

/*
 * Forslagskortet (docs/funksjoner/fase2a-forslagsmonster.md Omfang 1, designfilen avsnitt 4).
 * Ett kort med samme knapper overalt: «Bruk», «Behold min tekst», «Nytt forslag» og «Angre».
 * Komponenten vet ingenting om tilgang, lagring eller nett: all tilstand kommer inn som props
 * (statusen er lest fra serveren), og handlingene er funksjoner. Den importerer aldri
 * `@/core/access`, `@/core/ai` eller `@/db` (statisk sjekk i ai-imports.test.ts).
 * Støtter hovedmål: de ansatte (lærer kortet én gang, mister aldri egen tekst, kan angre) og KI i
 * bunnen (alle KI-funksjoner i 2a-2 bruker samme kort).
 */

/** Statusen på et forslag, lest fra KI-loggen. */
export type AiSuggestionCardStatus = "suggested" | "accepted" | "edited" | "rejected";
/** Utfallet av siste forespørsel. */
export type AiSuggestionCardOutcome = "ok" | "no_match" | "error";
/** Hva som pågår: et nytt forslag, eller et valg (bruk, behold, angre). */
export type AiSuggestionPending = "suggestion" | "decision" | null;

export const AI_SUGGESTION_TEXTS = {
  heading: "Forslag fra KI",
  ownText: "Din tekst",
  ownTextBefore: "Din tekst før",
  use: "Bruk",
  keep: "Behold min tekst",
  newSuggestion: "Nytt forslag",
  undo: "Angre",
  working: "KI jobber …",
  noMatch: "KI hadde ikke noe forslag. Teksten din er uendret.",
  error: "KI svarte ikke. Prøv igjen.",
  aiOff: "KI er av.",
  offline: "Krever nett. Teksten din er lagret og kan skrives videre.",
  kept: "Du beholdt din tekst.",
  /** Forespørselen ligger i KI-køen på enheten (docs/funksjoner/fase2a-ki-ko.md Omfang 3). */
  queued: "Venter på KI. Forslaget kommer når nettet er tilbake.",
  /** Feltet er endret etter at forslaget ble laget (T-0004). */
  staleSource: "Forslaget gjelder teksten før du skrev videre.",
  /** «Angre» etter at teksten er endret: bare statusen settes tilbake (T-0005). */
  undoStatusOnly: "Statusen er satt tilbake. Teksten din er uendret.",
} as const;

/** Det kortet trenger for å vise seg. Ingen handlinger her. */
export type AiSuggestionState = {
  ownText: string;
  /** Forslaget fra siste forespørsel (bare når utfallet er `ok`). */
  suggestionText: string | null;
  /** Statusen til forslaget, lest fra serveren. */
  status: AiSuggestionCardStatus | null;
  /** Utfallet av siste forespørsel. `null` før første forespørsel. */
  outcome: AiSuggestionCardOutcome | null;
  pending: AiSuggestionPending;
  online: boolean;
  aiEnabled: boolean;
  /** Et nyere forslag finnes på samme mål: «Angre» vises ikke (A162). */
  hasNewerSuggestion: boolean;
  /** Forrige forslag som står igjen når et nytt ga `no_match` eller feil (A164). */
  staleSuggestion?: { text: string; status: AiSuggestionCardStatus } | null;
  /** Id-en i KI-loggen for forslaget som vises. Trengs for KI-merket. */
  aiUsageId?: string | null;
  /** Forespørselen ligger i KI-køen og venter på nett. Kortet viser «Venter på KI …». */
  queued?: boolean;
  /** Teksten forslaget ble laget fra. Sammen med `currentText` gir den `stale` (T-0004). */
  sourceText?: string | null;
  /** Teksten som står i feltet nå. */
  currentText?: string;
};

export type AiSuggestionBox =
  | { kind: "suggestion"; text: string; dimmed: boolean; showMark: boolean }
  | { kind: "message"; tone: "neutral" | "warning" | "working"; text: string };

export type AiSuggestionView = {
  box: AiSuggestionBox | null;
  /** Linjer under boksen (A164, «Du beholdt din tekst.», «Krever nett …»). */
  notes: string[];
  ownHeading: string;
  ownDimmed: boolean;
  buttons: { use: boolean; keep: boolean; newSuggestion: boolean; undo: boolean };
  /** Alle knappene er låst. */
  disabled: boolean;
  /** Teksten skjermleseren sier (aria-live). */
  announcement: string;
  /** Statusen knappene gjelder, eller `null` når ingen forslag vises. */
  shownStatus: AiSuggestionCardStatus | null;
  /** Forslaget gjelder eldre tekst enn feltet har nå: ingen «Bruk» (T-0004). */
  stale: boolean;
  /** Hovedknappen: «Bruk», eller «Nytt forslag» når forslaget gjelder eldre tekst. */
  primaryAction: "use" | "new";
};

const NO_BUTTONS = { use: false, keep: false, newSuggestion: false, undo: false } as const;

function buttonsFor(status: AiSuggestionCardStatus, canUndo: boolean) {
  if (status === "suggested") return { use: true, keep: true, newSuggestion: true, undo: false };
  if (status === "rejected") return { ...NO_BUTTONS, newSuggestion: true, undo: canUndo };
  return { ...NO_BUTTONS, undo: canUndo };
}

function announcementFor(status: AiSuggestionCardStatus): string {
  if (status === "suggested") return "Forslag klart";
  if (status === "rejected") return "Du beholdt din tekst";
  return "Forslaget er brukt";
}

/**
 * Hva «Angre» skal gjøre etter «Bruk» (T-0005). Er feltet endret etter «Bruk», settes bare
 * statusen tilbake og teksten beholdes; ellers gis teksten før «Bruk» tilbake som før.
 */
export function undoAfterEdit(currentText: string, appliedText: string): "status_only" | "restore" {
  return currentText === appliedText ? "restore" : "status_only";
}

/**
 * Hvilke tekster og knapper kortet viser. Ren funksjon, testet for seg
 * (docs/funksjoner/fase2a-forslagsmonster-testplan.md avsnitt 10).
 */
export function suggestionView(state: AiSuggestionState): AiSuggestionView {
  const base = {
    notes: [] as string[],
    ownHeading: AI_SUGGESTION_TEXTS.ownText,
    ownDimmed: false,
    stale: false,
    primaryAction: "use" as const,
  };

  if (!state.aiEnabled) {
    return {
      ...base,
      box: { kind: "message", tone: "neutral", text: AI_SUGGESTION_TEXTS.aiOff },
      buttons: NO_BUTTONS,
      disabled: true,
      announcement: AI_SUGGESTION_TEXTS.aiOff,
      shownStatus: null,
    };
  }

  // I kø: forslaget kommer når nettet er tilbake. Ingen «Bruk» før svaret er her.
  if (state.queued) {
    return {
      ...base,
      box: { kind: "message", tone: "neutral", text: AI_SUGGESTION_TEXTS.queued },
      buttons: NO_BUTTONS,
      disabled: true,
      announcement: AI_SUGGESTION_TEXTS.queued,
      shownStatus: null,
    };
  }

  // Uten nett vises aldri «KI jobber …» (ingenting skal henge)
  if (state.pending === "suggestion" && state.online) {
    return {
      ...base,
      box: { kind: "message", tone: "working", text: AI_SUGGESTION_TEXTS.working },
      buttons: { use: true, keep: true, newSuggestion: true, undo: false },
      disabled: true,
      announcement: "KI jobber",
      shownStatus: null,
    };
  }

  // Forslaget som vises: det nye (utfall ok), eller det gamle som står igjen (A164)
  let shown: { text: string; status: AiSuggestionCardStatus } | null = null;
  const notes: string[] = [];
  let messageBox: AiSuggestionBox | null = null;
  let announcement = "";

  if (state.outcome === "ok" && state.suggestionText !== null && state.status !== null) {
    shown = { text: state.suggestionText, status: state.status };
  } else if (state.outcome === "no_match" || state.outcome === "error") {
    const message =
      state.outcome === "no_match" ? AI_SUGGESTION_TEXTS.noMatch : AI_SUGGESTION_TEXTS.error;
    announcement = message;
    if (state.staleSuggestion) {
      shown = state.staleSuggestion;
      notes.push(message);
    } else {
      messageBox = {
        kind: "message",
        tone: state.outcome === "error" ? "warning" : "neutral",
        text: message,
      };
    }
  }

  let buttons: AiSuggestionView["buttons"] = { ...NO_BUTTONS };
  let box: AiSuggestionBox | null = messageBox;
  let ownHeading: string = AI_SUGGESTION_TEXTS.ownText;
  let ownDimmed = false;
  let stale = false;

  if (shown) {
    const approved = shown.status === "accepted" || shown.status === "edited";
    box = {
      kind: "suggestion",
      text: shown.text,
      dimmed: shown.status === "rejected",
      showMark: approved,
    };
    if (shown.status === "rejected") notes.unshift(AI_SUGGESTION_TEXTS.kept);
    if (approved) {
      ownHeading = AI_SUGGESTION_TEXTS.ownTextBefore;
      ownDimmed = true;
    }
    buttons = buttonsFor(shown.status, !state.hasNewerSuggestion);
    if (!announcement) announcement = announcementFor(shown.status);
    // T-0004: feltet er endret etter at forslaget ble laget. «Bruk» ville skrevet over ny tekst.
    if (
      !approved &&
      state.sourceText != null &&
      state.currentText !== undefined &&
      state.currentText !== state.sourceText
    ) {
      stale = true;
      notes.unshift(AI_SUGGESTION_TEXTS.staleSource);
      buttons = { ...buttons, use: false, newSuggestion: true };
    }
  } else if (messageBox) {
    buttons = { ...NO_BUTTONS, newSuggestion: true };
  }

  let disabled = state.pending !== null;
  if (!state.online) {
    disabled = true;
    announcement = AI_SUGGESTION_TEXTS.offline;
    if (shown) notes.push(AI_SUGGESTION_TEXTS.offline);
    else {
      box = { kind: "message", tone: "neutral", text: AI_SUGGESTION_TEXTS.offline };
      buttons = { ...NO_BUTTONS, newSuggestion: true };
    }
  }

  return {
    box,
    notes,
    ownHeading,
    ownDimmed,
    buttons,
    disabled,
    announcement,
    shownStatus: shown?.status ?? null,
    stale,
    primaryAction: stale ? "new" : "use",
  };
}

export type AiSuggestionProps = AiSuggestionState & {
  /** Kilden etter «Forslag fra KI · », for eksempel «språkvask». */
  source?: string;
  onUse(): void;
  onKeep(): void;
  onNewSuggestion(): void;
  onUndo(): void;
};

type FocusTarget = "use" | "undo" | null;

export function AiSuggestion(props: AiSuggestionProps) {
  const { ownText, source, onUse, onKeep, onNewSuggestion, onUndo } = props;
  const view = suggestionView(props);
  const headingId = useId();
  const useButtonRef = useRef<HTMLButtonElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const newSuggestionRef = useRef<HTMLButtonElement>(null);
  // Hvor fokus skal når kallet er ferdig (designfilen avsnitt 4, «Skjermleser og fokus»)
  const focusAfter = useRef<FocusTarget>(null);
  const [undone, setUndone] = useState(false);

  useEffect(() => {
    const target = focusAfter.current;
    if (!target || view.disabled) return;
    // Gjelder forslaget eldre tekst, finnes ikke «Bruk»: fokus går til «Nytt forslag»
    const button =
      target === "undo"
        ? undoRef.current
        : view.primaryAction === "new"
          ? newSuggestionRef.current
          : useButtonRef.current;
    if (button) {
      button.focus();
      focusAfter.current = null;
    }
  });

  const announcement =
    undone && view.shownStatus === "suggested" && !view.disabled ? "Angret" : view.announcement;

  function act(handler: () => void, focus: FocusTarget, isUndo = false) {
    if (view.disabled) return;
    focusAfter.current = focus;
    setUndone(isUndo);
    handler();
  }

  const heading = source
    ? `${AI_SUGGESTION_TEXTS.heading} · ${source}`
    : AI_SUGGESTION_TEXTS.heading;
  const box = view.box;

  return (
    <section aria-labelledby={headingId}>
      <Card>
        <h2 id={headingId} className="sr-only">
          {AI_SUGGESTION_TEXTS.heading}
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-medium text-slate-600">{view.ownHeading}</h3>
            <p
              className={cn(
                "mt-2 text-base leading-relaxed whitespace-pre-wrap",
                view.ownDimmed ? "text-slate-500" : "text-slate-900",
              )}
              data-testid="ai-suggestion-own-text"
            >
              {ownText}
            </p>
          </div>
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-medium text-ai-900">
              <AiSparkIcon className="text-ai-700" />
              {heading}
            </h3>
            {box?.kind === "suggestion" && box.showMark ? (
              <div className="mt-2">
                <AiTextMark aiUsageId={props.aiUsageId} status={view.shownStatus} />
              </div>
            ) : null}
            {box ? <SuggestionBox box={box} /> : null}
            {view.notes.map((note) => (
              <p key={note} className="mt-2 text-sm text-slate-700">
                {note}
              </p>
            ))}
          </div>
        </div>
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
        {view.buttons.use ||
        view.buttons.keep ||
        view.buttons.newSuggestion ||
        view.buttons.undo ? (
          <div
            className="mt-4 flex flex-row-reverse flex-wrap justify-start gap-2 border-t border-line pt-4 md:gap-3"
            data-testid="ai-suggestion-buttons"
          >
            {view.buttons.use ? (
              <Button
                ref={useButtonRef}
                variant={AI_BUTTON_VARIANT}
                size="lg"
                className="max-lg:min-w-[50%]"
                disabled={view.disabled}
                aria-disabled={view.disabled || undefined}
                onClick={() => act(onUse, "undo")}
              >
                {AI_SUGGESTION_TEXTS.use}
              </Button>
            ) : null}
            {view.buttons.undo ? (
              <Button
                ref={undoRef}
                variant="secondary"
                size="md"
                className="min-w-11"
                disabled={view.disabled}
                aria-disabled={view.disabled || undefined}
                onClick={() => act(onUndo, "use", true)}
              >
                {AI_SUGGESTION_TEXTS.undo}
              </Button>
            ) : null}
            {view.buttons.keep ? (
              <Button
                variant="secondary"
                size="md"
                className="min-w-11"
                disabled={view.disabled}
                aria-disabled={view.disabled || undefined}
                onClick={() => act(onKeep, "undo")}
              >
                {AI_SUGGESTION_TEXTS.keep}
              </Button>
            ) : null}
            {view.buttons.newSuggestion ? (
              <Button
                ref={newSuggestionRef}
                variant="secondary"
                size="md"
                className="min-w-11"
                disabled={view.disabled}
                aria-disabled={view.disabled || undefined}
                onClick={() => act(onNewSuggestion, "use")}
              >
                {AI_SUGGESTION_TEXTS.newSuggestion}
              </Button>
            ) : null}
          </div>
        ) : null}
      </Card>
    </section>
  );
}

function SuggestionBox({ box }: { box: AiSuggestionBox }) {
  if (box.kind === "suggestion") {
    return (
      <p
        className={cn(
          "mt-2 rounded-xl border border-l-4 border-ai-line bg-ai-50 p-4 text-base leading-relaxed whitespace-pre-wrap text-slate-900",
          box.dimmed && "text-slate-600",
        )}
        data-testid="ai-suggestion-text"
      >
        {box.text}
      </p>
    );
  }
  return (
    <p
      className={cn(
        "mt-2 rounded-xl p-4 text-base leading-relaxed",
        box.tone === "warning" ? "bg-watch-fill text-watch-text" : "bg-snow text-slate-900",
        box.tone === "working" && "motion-safe:animate-pulse",
      )}
      data-testid="ai-suggestion-message"
    >
      {box.text}
    </p>
  );
}
