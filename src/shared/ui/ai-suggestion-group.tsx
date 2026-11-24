"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/shared/lib/cn";
import {
  AI_SUGGESTION_TEXTS,
  SuggestionBox,
  suggestionView,
  type AiSuggestionCardOutcome,
  type AiSuggestionCardStatus,
  type AiSuggestionPending,
  type AiSuggestionView,
} from "./ai-suggestion";
import { AiSparkIcon, AiTextMark } from "./ai-text-mark";
import { AI_BUTTON_VARIANT, Button } from "./button";
import { Card } from "./card";

/*
 * Forslagskortet for flere felt (docs/funksjoner/fase2a-ki-i-veien-design.md avsnitt 5, A436 og
 * A460): før og etter per felt, «Bruk», «Behold min» og «Angre» per rad, og «Bruk alle», «Behold
 * min tekst» og «Nytt forslag» i bunnlinjen. Hver rad bruker `suggestionView` og `SuggestionBox`
 * fra forslagskortet, så tilstandene er de samme overalt. Et stoppet felt stopper ikke de andre,
 * og stoppet tekst vises aldri: raden viser bare meldingen skjermen har valgt, i nøytral flate.
 *
 * Komponenten vet ingenting om tilgang, lagring, nett eller vaktkoder: alt kommer inn som props,
 * og handlingene er funksjoner. Den importerer aldri `src/core`, `src/db` eller moduler.
 * Støtter hovedmål: de ansatte (hele avviket med ett trykk, felt for felt eller alt på én gang)
 * og KI i bunnen (samme kort og samme tone som resten av KI).
 */

export const AI_SUGGESTION_GROUP_TEXTS = {
  keepOne: "Behold min",
  useAll: "Bruk alle",
  noChange: "Ingen endring.",
  ready: (suggestions: number, stopped: number) =>
    stopped > 0
      ? `Språkvask klar: ${suggestions} forslag, ${stopped} stoppet.`
      : `Språkvask klar: ${suggestions} forslag.`,
  used: (label: string) => `${label}: forslaget er brukt.`,
  kept: (label: string) => `${label}: du beholdt din tekst.`,
  allUsed: "Alle forslag er brukt.",
  allKept: "Du beholdt din tekst.",
  undone: "Angret",
} as const;

/** Ett felt i kortet. Tilstanden er lest fra serveren; komponenten endrer den aldri selv. */
export type AiSuggestionGroupRow = {
  /** Fast nøkkel for raden, for eksempel feltkoden. */
  key: string;
  /** Feltnavnet, for eksempel «Avvik» eller «Tiltak 1». */
  label: string;
  /** Teksten som står i feltet nå. */
  ownText: string;
  /** Teksten forslaget ble laget fra. Er feltet endret siden, vises ikke «Bruk» (T-0004). */
  sourceText?: string | null;
  suggestionText: string | null;
  status: AiSuggestionCardStatus | null;
  outcome: AiSuggestionCardOutcome | null;
  aiUsageId?: string | null;
  /** Meldingen når utfallet er `stopped`, eller når feltet ikke kunne språkvaskes. */
  stoppedText?: string;
};

export type AiSuggestionGroupProps = {
  /** Overskriften etter «Forslag fra KI · », for eksempel «språkvask av avvik 1». */
  source: string;
  rows: readonly AiSuggestionGroupRow[];
  pending: AiSuggestionPending;
  online: boolean;
  aiEnabled: boolean;
  onUse(key: string): void;
  onKeep(key: string): void;
  onUndo(key: string): void;
  onUseAll(): void;
  onKeepAll(): void;
  onNewSuggestion(): void;
};

export type AiSuggestionGroupRowView = {
  row: AiSuggestionGroupRow;
  view: AiSuggestionView;
  buttons: { use: boolean; keep: boolean; undo: boolean };
  /** Forslaget venter på valg. */
  open: boolean;
  stopped: boolean;
};

export type AiSuggestionGroupView = {
  rows: AiSuggestionGroupRowView[];
  buttons: { useAll: boolean; keepAll: boolean; newSuggestion: boolean };
  disabled: boolean;
  /** Teksten når svaret er kommet: «Språkvask klar: 3 forslag, 1 stoppet.» */
  readyAnnouncement: string;
};

/** Hvordan én rad og hele kortet vises. Ren funksjon, testet i ai-suggestion-group.test.ts. */
export function suggestionGroupView(
  props: Pick<AiSuggestionGroupProps, "rows" | "pending" | "online" | "aiEnabled">,
): AiSuggestionGroupView {
  const rows = props.rows.map((row): AiSuggestionGroupRowView => {
    // KI svarte med samme tekst: ingen endring, ingen knapper.
    const unchanged =
      row.outcome === "no_match" ||
      (row.outcome === "ok" &&
        row.status === "suggested" &&
        row.suggestionText !== null &&
        row.suggestionText.trim() === row.ownText.trim());
    const view = suggestionView({
      ownText: row.ownText,
      suggestionText: unchanged ? null : row.suggestionText,
      status: unchanged ? null : row.status,
      outcome: unchanged ? "no_match" : row.outcome,
      pending: props.pending,
      online: props.online,
      aiEnabled: props.aiEnabled,
      hasNewerSuggestion: false,
      aiUsageId: row.aiUsageId ?? null,
      stoppedText: row.stoppedText,
      sourceText: row.sourceText ?? null,
      currentText: row.ownText,
    });
    if (unchanged && view.box?.kind === "message") {
      view.box = { ...view.box, text: AI_SUGGESTION_GROUP_TEXTS.noChange };
      view.announcement = AI_SUGGESTION_GROUP_TEXTS.noChange;
    }
    const shown = view.box?.kind === "suggestion";
    const buttons = shown
      ? { use: view.buttons.use, keep: view.buttons.keep, undo: view.buttons.undo }
      : { use: false, keep: false, undo: false };
    return {
      row,
      view,
      buttons,
      open: shown && view.shownStatus === "suggested" && buttons.use,
      stopped: row.outcome === "stopped",
    };
  });
  const anyOpen = rows.some((r) => r.open);
  const suggestions = rows.filter((r) => r.view.box?.kind === "suggestion").length;
  const stopped = rows.filter((r) => r.stopped).length;
  return {
    rows,
    buttons: { useAll: anyOpen, keepAll: anyOpen, newSuggestion: true },
    disabled: props.pending !== null || !props.online || !props.aiEnabled,
    readyAnnouncement: AI_SUGGESTION_GROUP_TEXTS.ready(suggestions, stopped),
  };
}

type LastAction =
  | { kind: "use"; label: string }
  | { kind: "keep"; label: string }
  | { kind: "useAll" }
  | { kind: "keepAll" }
  | { kind: "undo" }
  | null;

type FocusTarget = { kind: "undo"; key: string } | { kind: "new" } | { kind: "heading" } | null;

function announcementOf(action: LastAction, view: AiSuggestionGroupView): string {
  if (view.rows.some((r) => r.view.box?.kind === "message" && r.view.box.tone === "working")) {
    return AI_SUGGESTION_TEXTS.working;
  }
  if (!action) return view.readyAnnouncement;
  switch (action.kind) {
    case "use":
      return AI_SUGGESTION_GROUP_TEXTS.used(action.label);
    case "keep":
      return AI_SUGGESTION_GROUP_TEXTS.kept(action.label);
    case "useAll":
      return AI_SUGGESTION_GROUP_TEXTS.allUsed;
    case "keepAll":
      return AI_SUGGESTION_GROUP_TEXTS.allKept;
    case "undo":
      return AI_SUGGESTION_GROUP_TEXTS.undone;
  }
}

export function AiSuggestionGroup(props: AiSuggestionGroupProps) {
  const { source, onUse, onKeep, onUndo, onUseAll, onKeepAll, onNewSuggestion } = props;
  const view = suggestionGroupView(props);
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const newRef = useRef<HTMLButtonElement>(null);
  const undoRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusAfter = useRef<FocusTarget>({ kind: "heading" });
  const [lastAction, setLastAction] = useState<LastAction>(null);

  // Fokus til overskriften når svaret er kommet, til «Angre» etter «Bruk» i en rad og til «Nytt
  // forslag» etter «Bruk alle» (avsnitt 5, «Skjermleser og fokus»). Knappene er låst mens KI
  // jobber, så målet står til kortet kan brukes igjen.
  useEffect(() => {
    const target = focusAfter.current;
    if (!target || view.disabled) return;
    const element =
      target.kind === "heading"
        ? headingRef.current
        : target.kind === "new"
          ? newRef.current
          : (undoRefs.current.get(target.key) ?? null);
    if (element) {
      element.focus();
      focusAfter.current = null;
    }
  });

  function act(run: () => void, action: LastAction, focus: FocusTarget) {
    if (view.disabled) return;
    focusAfter.current = focus;
    setLastAction(action);
    run();
  }

  const announcement = announcementOf(props.pending === "suggestion" ? null : lastAction, view);

  return (
    <section aria-labelledby={headingId}>
      <Card>
        <h4
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="flex items-center gap-1.5 text-base font-semibold text-ai-900"
        >
          <AiSparkIcon className="text-ai-700" />
          {`${AI_SUGGESTION_TEXTS.heading} · ${source}`}
        </h4>
        <div className="mt-4 space-y-4">
          {view.rows.map(({ row, view: rowView, buttons, stopped }) => (
            <div
              key={row.key}
              className="space-y-3 border-t border-line pt-4"
              data-testid="ai-suggestion-group-row"
              data-row={row.key}
            >
              <h5 className="text-sm font-semibold text-slate-900">{row.label}</h5>
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <p className="text-sm font-medium text-slate-600">{rowView.ownHeading}</p>
                  <p
                    className={cn(
                      "mt-2 text-base leading-relaxed break-words whitespace-pre-wrap",
                      rowView.ownDimmed ? "text-slate-500" : "text-slate-900",
                    )}
                  >
                    {row.ownText}
                  </p>
                </div>
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-medium text-ai-900">
                    <AiSparkIcon className="text-ai-700" />
                    {AI_SUGGESTION_TEXTS.heading}
                  </p>
                  {rowView.box?.kind === "suggestion" && rowView.box.showMark ? (
                    <div className="mt-2">
                      <AiTextMark aiUsageId={row.aiUsageId} status={rowView.shownStatus} />
                    </div>
                  ) : null}
                  {rowView.box ? (
                    // Et stoppet svar leses opp ved feltet (K7.7): meldingen står i aria-live
                    <div
                      data-stopped={stopped || undefined}
                      role={stopped ? "status" : undefined}
                      aria-live={stopped ? "polite" : undefined}
                    >
                      <SuggestionBox box={rowView.box} />
                    </div>
                  ) : null}
                  {rowView.notes.map((note) => (
                    <p key={note} className="mt-2 text-sm text-slate-700">
                      {note}
                    </p>
                  ))}
                </div>
              </div>
              {buttons.use || buttons.keep || buttons.undo ? (
                <div className="flex flex-row-reverse flex-wrap justify-start gap-2 md:gap-3">
                  {buttons.use ? (
                    <Button
                      variant={AI_BUTTON_VARIANT}
                      size="md"
                      className="min-w-11"
                      disabled={view.disabled}
                      aria-label={`${AI_SUGGESTION_TEXTS.use}: ${row.label}`}
                      onClick={() =>
                        act(
                          () => onUse(row.key),
                          { kind: "use", label: row.label },
                          { kind: "undo", key: row.key },
                        )
                      }
                    >
                      {AI_SUGGESTION_TEXTS.use}
                    </Button>
                  ) : null}
                  {buttons.undo ? (
                    <Button
                      ref={(element) => {
                        if (element) undoRefs.current.set(row.key, element);
                        else undoRefs.current.delete(row.key);
                      }}
                      variant="secondary"
                      size="md"
                      className="min-w-11"
                      disabled={view.disabled}
                      aria-label={`${AI_SUGGESTION_TEXTS.undo}: ${row.label}`}
                      onClick={() => act(() => onUndo(row.key), { kind: "undo" }, { kind: "new" })}
                    >
                      {AI_SUGGESTION_TEXTS.undo}
                    </Button>
                  ) : null}
                  {buttons.keep ? (
                    <Button
                      variant="secondary"
                      size="md"
                      className="min-w-11"
                      disabled={view.disabled}
                      aria-label={`${AI_SUGGESTION_GROUP_TEXTS.keepOne}: ${row.label}`}
                      onClick={() =>
                        act(
                          () => onKeep(row.key),
                          { kind: "keep", label: row.label },
                          { kind: "undo", key: row.key },
                        )
                      }
                    >
                      {AI_SUGGESTION_GROUP_TEXTS.keepOne}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
        <div
          className="mt-4 flex flex-row-reverse flex-wrap justify-start gap-2 border-t border-line pt-4 md:gap-3"
          data-testid="ai-suggestion-group-buttons"
        >
          {view.buttons.useAll ? (
            <Button
              variant={AI_BUTTON_VARIANT}
              size="lg"
              className="max-lg:min-w-[50%]"
              disabled={view.disabled}
              onClick={() => act(onUseAll, { kind: "useAll" }, { kind: "new" })}
            >
              {AI_SUGGESTION_GROUP_TEXTS.useAll}
            </Button>
          ) : null}
          {view.buttons.keepAll ? (
            <Button
              variant="secondary"
              size="md"
              className="min-w-11"
              disabled={view.disabled}
              onClick={() => act(onKeepAll, { kind: "keepAll" }, { kind: "new" })}
            >
              {AI_SUGGESTION_TEXTS.keep}
            </Button>
          ) : null}
          <Button
            ref={newRef}
            variant="secondary"
            size="md"
            className="min-w-11"
            disabled={view.disabled}
            onClick={() => act(onNewSuggestion, null, { kind: "heading" })}
          >
            {AI_SUGGESTION_TEXTS.newSuggestion}
          </Button>
        </div>
      </Card>
    </section>
  );
}
