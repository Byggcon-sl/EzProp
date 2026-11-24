"use client";

import { useEffect, useRef, useState } from "react";
import {
  checkOverrideReason,
  DECISION_LABELS,
  notEvaluatedLines,
  OVERRIDE_REASON_CHECK_MESSAGES,
  OVERRIDE_REASON_LABELS,
  reasonLines,
  RULE_SUGGESTION_HEADING,
  STALE_DEVIATION_ACTION_LABELS,
  SUGGESTION_KIND_TEXTS,
  SUGGESTION_OPEN_WITH_TG_DEVIATIONS_TEXT,
  SUGGESTION_STALE_TEXT,
  suggestionTgLabel,
  type ReasonLine,
} from "@/core/reports/logic";
import type { OutcomeDoc } from "@/core/templates";
import type { ChosenTg, OverrideReasonCode } from "@/db/schema";
import type {
  DecideSuggestionInput,
  DeviationView,
  InspectionYear,
  SuggestionView,
} from "@/core/reports/types";
import { Button } from "@/shared/ui/button";
import { ChoiceButtons } from "@/shared/ui/choice-buttons";
import { FormMessage, Textarea } from "@/shared/ui/form";
import { TgBadge, type TgBadgeValue } from "@/shared/ui/tg-badge";
import { Warning } from "@/shared/ui/warning";
import { uuidv7 } from "@/shared/lib/uuid";
import { decideSuggestionAction } from "./actions";
import { useRoom } from "./room-context";
import {
  isActionError,
  ROOM_ACTION_MESSAGES,
  ROOM_TEXTS,
  SUGGESTION_MESSAGES,
} from "./room-messages";
import {
  answerKey,
  deviationHeadingId,
  domId,
  DONE_BUTTON_ID,
  outcomeName,
  suggestionAsRuleResult,
  suggestionId,
  TGIU_HEADING_ID,
} from "./room-model";

/*
 * Forslag fra reglene (design avsnitt 8, kortet Omfang 4, A380, A388, A389, A395). Regelforslag er
 * ikke KI: aldri ordet «KI», aldri gnisteikonet, aldri KI-tonen. Godta er hovedknappen; Endre og
 * Avvis krever en grunn med ett trykk og skjer på samme flate. Avvis står minst 48 px unna Godta.
 * Serveren regner forslaget selv; skjermen sender bare regelkoden, beslutningen og valgene. Ingen
 * tast alene godtar eller avviser. Reglene setter aldri TG: TG settes når takstmannen trykker.
 * Støtter hovedmål: de ansatte (to trykk fra forslag til avvik), færre reklamasjoner (hver
 * beslutning logges med grunn).
 */

export const SUGGESTION_TEXTS = {
  why: "Hvorfor:",
  accept: "Godta",
  acceptAs: (tg: 2 | 3) => `Godta som TG${tg}`,
  change: "Endre",
  reject: "Avvis",
  chooseTg: "Velg TG",
  otherOutcome: "Annet utfall",
  changeReason: "Hvorfor endrer du?",
  rejectReason: "Hvorfor avviser du forslaget?",
  reasonText: "Skriv grunnen",
  reasonTextOptional: "Forklaring (valgfri)",
  addExplanation: "Legg til en forklaring (valgfri)",
  saveChange: "Lagre endringen",
  rejectConfirm: "Avvis forslaget",
  cancel: "Avbryt",
  chooseDifferentTg: "Velg en TG eller et utfall som er ulikt forslaget.",
  notEvaluated: "Ikke vurdert:",
  inspectionYear: (year: number) => `Befaringsår ${year}`,
  source: "Kilde:",
  accepted: "Godtatt:",
  /** «Forslag TG3, endret til TG2: Synlig skade». Grunnen er teksten for koden, aldri fritekst. */
  changed: (from: string, to: string, reason: string | null) =>
    `${from ? `Forslag ${from}, endret til` : "Endret til"} ${to}${reason ? `: ${reason}` : ""}`,
  rejected: "Avvist:",
  reason: "Grunn:",
  goToDeviation: (n: number) => `Gå til avvik ${n}`,
  tgiuConflict: (tg: string) =>
    `Punktet har TGIU. Et avvik med ${tg} kan ikke stå sammen med TGIU.`,
  removeTgiuAndAdd: "Fjern TGIU og legg til avviket",
  keepTgiu: "Behold TGIU",
  deviationConflict: (tg: "TGIU" | "TG0") =>
    `Punktet har avvik med TG. ${tg} kan ikke stå sammen med dem.`,
  removeDeviationsAndSet: (tg: "TGIU" | "TG0") => `Fjern avvikene med TG og sett ${tg}`,
  keepDeviations: "Behold avvikene",
  newSuggestion: (tg: string, name: string) => `Nytt forslag fra reglene: ${tg}, ${name}`,
} as const;

type Mode =
  | { kind: "idle" }
  | { kind: "changing" }
  | { kind: "rejecting" }
  | { kind: "tgiu_conflict"; input: DecideSuggestionInput; tgText: string }
  | { kind: "deviation_conflict"; input: DecideSuggestionInput; tg: "TGIU" | "TG0" }
  | { kind: "kept_open" };

/** TG-ene forslaget gjelder, som merker. */
export function suggestionTgs(
  suggestion: SuggestionView["suggestion"],
  outcome: OutcomeDoc | undefined,
): TgBadgeValue[] {
  if (!suggestion) return [];
  if (suggestion.kind === "tgiu") return ["IU"];
  if (suggestion.kind === "tg0") return ["0"];
  switch (outcome?.kind) {
    case "tg2":
      return ["2"];
    case "tg3":
      return ["3"];
    case "choose_tg2_tg3":
      return ["2", "3"];
    default:
      return [];
  }
}

function tgText(tgs: readonly TgBadgeValue[]): string {
  return tgs.map((tg) => (tg === "IU" ? "TGIU" : `TG${tg}`)).join(" eller ");
}

function chosenTgText(tg: ChosenTg | null): string {
  if (tg === null) return "";
  return tg === "IU" ? "TGIU" : `TG${tg}`;
}

/** Flytter fokus til et felt; for valgknapper til valgt knapp eller den første. */
export function focusElementById(id: string): boolean {
  const element = document.getElementById(id);
  if (!element) return false;
  if (element.tagName === "FIELDSET") {
    const target =
      element.querySelector<HTMLInputElement>("input:checked:not(:disabled)") ??
      element.querySelector<HTMLInputElement>("input:not(:disabled)");
    if (target) {
      target.focus();
      target.scrollIntoView({ block: "center" });
      return true;
    }
  }
  element.focus();
  element.scrollIntoView({ block: "center" });
  return true;
}

/** Id-en til meldingen i forslagskortet (`already_decided`). Står alltid i hovedkortet. */
export const suggestionNoticeId = (ruleKey: string) => `${suggestionId(ruleKey)}-notice`;

const noop = () => undefined;

export function RuleSuggestionCard({
  suggestion,
  deviations,
  inspectionYear,
  onStickyAccept = noop,
  variant = "full",
  notice = null,
  onNotice,
}: {
  suggestion: SuggestionView;
  deviations: readonly DeviationView[];
  inspectionYear: InspectionYear;
  /** Godta i nedre linje når kortet står utenfor skjermen (design avsnitt 8). Bare `full`. */
  onStickyAccept?(ruleKey: string, accept: StickyAccept | null): void;
  /**
   * `review`: kompakt kort i «Å se over» (A492): forslagets TG, kort grunn og de samme knappene.
   * Vises bare mens forslaget er åpent; id-ene får egen ending, så de ikke kolliderer med
   * hovedkortet.
   */
  variant?: "full" | "review";
  /** Meldingen etter `already_decided` («Godtatt i et annet vindu kl. 10.42: TG3»). */
  notice?: string | null;
  /** Setter eller tømmer meldingen. Den vises i hovedkortet, også når svaret kom fra «Å se over». */
  onNotice(ruleKey: string, text: string | null): void;
}) {
  const { canEdit, doc, run, room, announce, focus, removeDeviation } = useRoom();
  const review = variant === "review";
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosenTg, setChosenTg] = useState<ChosenTg | null>(null);
  const [chosenOutcome, setChosenOutcome] = useState<string | null>(null);
  const [reasonCode, setReasonCode] = useState<OverrideReasonCode | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [showText, setShowText] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const id = review
    ? `${suggestionId(suggestion.ruleKey)}-review`
    : suggestionId(suggestion.ruleKey);
  const noticeId = suggestionNoticeId(suggestion.ruleKey);
  const headingId = `${id}-heading`;
  const s = suggestion.suggestion;
  const outcome =
    s?.kind === "outcome"
      ? doc.outcome(s.checkpoint_key, s.question_key, s.outcome_key)
      : undefined;
  const tgs = suggestionTgs(s, outcome);
  const name =
    s?.kind === "outcome"
      ? outcome
        ? outcomeName(outcome)
        : ""
      : s?.kind === "tgiu"
        ? SUGGESTION_KIND_TEXTS.tgiu
        : s?.kind === "tg0"
          ? SUGGESTION_KIND_TEXTS.tg0
          : "";
  const decision = suggestion.latestDecision;
  const showsButtons =
    canEdit && suggestion.state === "triggered" && !suggestion.stale && decision === null;

  const accept = async (tg?: 2 | 3) => {
    if (!s) return;
    const input: DecideSuggestionInput = {
      id: uuidv7(),
      ruleKey: suggestion.ruleKey,
      decision: "accepted",
      ...(s.kind === "outcome" ? { deviationId: uuidv7() } : {}),
      ...(tg ? { chosenTg: tg } : {}),
    };
    await send(input, tg ? `TG${tg}` : tgText(tgs), "accept");
  };

  // Godta i nedre linje når kortet er utenfor skjermen.
  const acceptRef = useRef(accept);
  useEffect(() => {
    acceptRef.current = accept;
  });
  const isChoose = outcome?.kind === "choose_tg2_tg3";
  useEffect(() => {
    const element = sectionRef.current;
    if (
      !element ||
      review ||
      !showsButtons ||
      mode.kind !== "idle" ||
      typeof IntersectionObserver === "undefined"
    ) {
      onStickyAccept(suggestion.ruleKey, null);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      onStickyAccept(
        suggestion.ruleKey,
        entry.isIntersecting
          ? null
          : {
              buttons: isChoose
                ? [
                    { label: SUGGESTION_TEXTS.acceptAs(2), run: () => void acceptRef.current(2) },
                    { label: SUGGESTION_TEXTS.acceptAs(3), run: () => void acceptRef.current(3) },
                  ]
                : [{ label: SUGGESTION_TEXTS.accept, run: () => void acceptRef.current() }],
            },
      );
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      onStickyAccept(suggestion.ruleKey, null);
    };
  }, [review, showsButtons, mode.kind, isChoose, onStickyAccept, suggestion.ruleKey]);

  async function send(input: DecideSuggestionInput, tgLabel: string, button: string) {
    setBusy(button);
    setError(null);
    onNotice(suggestion.ruleKey, null);
    const result = await run(() => decideSuggestionAction(room, input));
    setBusy(null);
    if (isActionError(result)) {
      setError(result.message);
      return;
    }
    switch (result.status) {
      case "tgiu_conflict":
        setMode({ kind: "tgiu_conflict", input, tgText: tgLabel });
        focus(`${id}-conflict`);
        return;
      case "tgiu_conflicts_with_deviation":
        setMode({
          kind: "deviation_conflict",
          input,
          tg:
            (input.decision === "changed" ? input.chosenTg : s?.kind === "tg0" ? "0" : "IU") === "0"
              ? "TG0"
              : "TGIU",
        });
        focus(`${id}-conflict`);
        return;
      case "no_longer_applies":
        // `run` har tatt inn ny visning; kortet kan være borte, så meldingen leses også opp.
        setMode({ kind: "idle" });
        setError(ROOM_ACTION_MESSAGES.noLongerApplies);
        announce(ROOM_ACTION_MESSAGES.noLongerApplies);
        return;
      case "already_decided":
        // Avgjort i et annet vindu (A493): ingenting er lagret, kortet viser det som gjelder
        // (`refresh`), og meldingen sier hva og når, aldri hvem.
        setMode({ kind: "idle" });
        resetForm();
        onNotice(
          suggestion.ruleKey,
          SUGGESTION_MESSAGES.alreadyDecided(result.decision, result.chosenTg, result.decidedAt),
        );
        focus(noticeId);
        return;
      case "saved":
        setMode({ kind: "idle" });
        if (result.deviationId) {
          focus(deviationHeadingId(result.deviationId));
          announce(ROOM_TEXTS.deviationAdded(tgLabel));
        } else if (
          (input.decision === "accepted" && s?.kind === "tgiu") ||
          (input.decision === "changed" && input.chosenTg === "IU")
        ) {
          focus(TGIU_HEADING_ID);
          announce(ROOM_TEXTS.tgiuSet);
        } else if (
          (input.decision === "accepted" && s?.kind === "tg0") ||
          (input.decision === "changed" && input.chosenTg === "0")
        ) {
          focus(DONE_BUTTON_ID);
          announce(ROOM_TEXTS.tg0Set);
        } else {
          focus(headingId);
        }
    }
  }

  const resetForm = () => {
    setChosenTg(null);
    setChosenOutcome(null);
    setReasonCode(null);
    setReasonText("");
    setShowText(false);
    setError(null);
  };

  const openForm = (kind: "changing" | "rejecting") => {
    resetForm();
    setMode({ kind });
    focus(kind === "changing" ? `${id}-tg` : `${id}-reason`);
  };

  const cancelForm = (kind: "changing" | "rejecting") => {
    setMode({ kind: "idle" });
    resetForm();
    focus(kind === "changing" ? `${id}-change` : `${id}-reject`);
  };

  // --- Linjene etter en beslutning, «ikke vurdert» og «gjelder ikke lenger» ------------------

  const goToField = (elementKey: string) => (event: React.MouseEvent) => {
    event.preventDefault();
    focusElementById(domId(answerKey(elementKey)));
  };

  const reasonLink = (line: ReasonLine, index: number) =>
    line.elementKey ? (
      <li key={index}>
        <a
          href={`#${domId(answerKey(line.elementKey))}`}
          onClick={goToField(line.elementKey)}
          className="inline-flex min-h-11 items-center text-slate-900 underline underline-offset-4"
        >
          {line.text}
          <span className="sr-only">, {ROOM_TEXTS.goToField}</span>
        </a>
      </li>
    ) : (
      <li key={index} className="py-1">
        {line.text}
      </li>
    );

  // Meldingen etter `already_decided`. Står i hovedkortet uansett tilstand, og leses opp.
  const noticeElement =
    !review && notice ? (
      <p id={noticeId} role="status" tabIndex={-1} className="font-medium text-slate-900">
        {notice}
      </p>
    ) : null;

  if (review && !showsButtons) return null;

  if (suggestion.state === "not_evaluated" && decision === null) {
    const lines = notEvaluatedLines(suggestionAsRuleResult(suggestion), doc.labels);
    return (
      <section
        id={id}
        tabIndex={-1}
        aria-label={`${RULE_SUGGESTION_HEADING}: ${SUGGESTION_TEXTS.notEvaluated}`}
        className="rounded-card border border-line bg-white p-4 text-sm text-slate-900"
      >
        <ul className="space-y-1">
          {lines.map((line, index) => (
            <li key={index} className="flex flex-wrap items-center gap-x-3">
              <span
                aria-hidden="true"
                className="inline-flex size-5 items-center justify-center rounded-full ring-1 ring-slate-700 text-xs"
              >
                i
              </span>
              <span>
                {SUGGESTION_TEXTS.notEvaluated} {line.text}
              </span>
              {line.elementKey && (
                <a
                  href={`#${domId(answerKey(line.elementKey))}`}
                  onClick={goToField(line.elementKey)}
                  className="inline-flex min-h-11 items-center underline underline-offset-4"
                >
                  {ROOM_TEXTS.goToFieldLink}
                </a>
              )}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const deviationNumber = (deviationId: string | null) => {
    if (!deviationId) return null;
    const index = deviations.findIndex((d) => d.id === deviationId);
    return index < 0 ? null : index + 1;
  };

  if (suggestion.stale) {
    const linkedId = decision?.deviationId ?? null;
    const n = deviationNumber(linkedId);
    const removeLinked = async () => {
      if (!linkedId) return;
      setBusy("remove");
      setError(null);
      const message = await removeDeviation(linkedId);
      setBusy(null);
      if (message) setError(message);
    };
    return (
      <section id={id} tabIndex={-1} aria-labelledby={headingId} className="space-y-2">
        <h3 id={headingId} className="sr-only">
          {RULE_SUGGESTION_HEADING}
        </h3>
        <Warning
          action={
            linkedId && n !== null && canEdit ? (
              <>
                <Button variant="secondary" onClick={removeLinked} disabled={busy !== null}>
                  {busy === "remove"
                    ? ROOM_TEXTS.saving
                    : STALE_DEVIATION_ACTION_LABELS.remove_deviation}
                </Button>
                <Button variant="ghost" onClick={() => focus(deviationHeadingId(linkedId))}>
                  {STALE_DEVIATION_ACTION_LABELS.keep_deviation}
                </Button>
              </>
            ) : linkedId && n !== null ? (
              <a
                href={`#${deviationHeadingId(linkedId)}`}
                className="inline-flex min-h-11 items-center underline underline-offset-4"
              >
                {SUGGESTION_TEXTS.goToDeviation(n)}
              </a>
            ) : null
          }
        >
          {SUGGESTION_STALE_TEXT}
        </Warning>
        {noticeElement}
        {error && <FormMessage message={error} />}
      </section>
    );
  }

  if (decision !== null) {
    const n = deviationNumber(decision.deviationId);
    const reasonLabel = decision.overrideReasonCode
      ? OVERRIDE_REASON_LABELS[decision.overrideReasonCode]
      : null;
    return (
      <section
        id={id}
        tabIndex={-1}
        aria-labelledby={headingId}
        className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-card border border-line bg-white p-4 text-sm text-slate-900"
      >
        <h3 id={headingId} className="sr-only">
          {RULE_SUGGESTION_HEADING}
        </h3>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
          className="mt-0.5 shrink-0"
        >
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
        <div className="min-w-0 flex-1 space-y-1">
          <p>
            {decision.decision === "changed"
              ? SUGGESTION_TEXTS.changed(
                  decision.suggestionTg !== null
                    ? suggestionTgLabel(decision.suggestionTg)
                    : tgText(tgs),
                  chosenTgText(decision.chosenTg),
                  reasonLabel,
                )
              : decision.decision === "accepted"
                ? `${SUGGESTION_TEXTS.accepted} ${decision.chosenTg !== null ? chosenTgText(decision.chosenTg) : tgText(tgs)}${name ? ` – ${name}` : ""}`
                : `${SUGGESTION_TEXTS.rejected} ${tgText(tgs)}${name ? ` – ${name}` : ""}`}
          </p>
          {decision.decision === "rejected" && reasonLabel && (
            <p>
              {SUGGESTION_TEXTS.reason} {reasonLabel}
            </p>
          )}
          {decision.decision !== "accepted" && decision.overrideReason && (
            <p className="line-clamp-2 whitespace-pre-wrap text-slate-700">
              {decision.overrideReason}
            </p>
          )}
          {noticeElement}
        </div>
        {n !== null && decision.deviationId && (
          <a
            href={`#${deviationHeadingId(decision.deviationId)}`}
            onClick={(event) => {
              event.preventDefault();
              focusElementById(deviationHeadingId(decision.deviationId!));
            }}
            className="inline-flex min-h-11 items-center underline underline-offset-4"
          >
            {SUGGESTION_TEXTS.goToDeviation(n)}
          </a>
        )}
        <span className="sr-only">{DECISION_LABELS[decision.decision]}</span>
      </section>
    );
  }

  if (suggestion.state !== "triggered" || !s) return null;

  // --- Forslaget som venter på beslutning ----------------------------------------------------

  const allWhy = reasonLines(suggestionAsRuleResult(suggestion), doc.labels);
  // I «Å se over» står bare regelens korte grunn (første linje, målingen).
  const why = review ? allWhy.slice(0, 1) : allWhy;
  const otherOutcomes = s.kind === "outcome" ? doc.outcomes(s.checkpoint_key, s.question_key) : [];
  const tgOptions: { value: ChosenTg; label: string }[] =
    s.kind === "outcome"
      ? [
          { value: "2", label: "TG2" },
          { value: "3", label: "TG3" },
        ]
      : [
          { value: "0", label: "TG0" },
          { value: "1", label: "TG1" },
          { value: "IU", label: "TGIU" },
        ];
  const suggestedTg: ChosenTg | null =
    s.kind === "tgiu"
      ? "IU"
      : s.kind === "tg0"
        ? "0"
        : outcome?.kind === "tg2"
          ? "2"
          : outcome?.kind === "tg3"
            ? "3"
            : null;
  const decisionKind = mode.kind === "rejecting" ? "rejected" : "changed";
  const reasonCheck = checkOverrideReason({
    decision: decisionKind,
    code: reasonCode,
    text: reasonText.trim() === "" ? null : reasonText,
  });
  const outcomeChanged =
    chosenOutcome !== null && s.kind === "outcome" && chosenOutcome !== s.outcome_key;
  const choiceDiffers = (chosenTg !== null && chosenTg !== suggestedTg) || outcomeChanged;
  const changeReady = reasonCheck === "ok" && chosenTg !== null && choiceDiffers;
  const changeHint =
    reasonCheck !== "ok"
      ? OVERRIDE_REASON_CHECK_MESSAGES[reasonCheck]
      : !choiceDiffers || chosenTg === null
        ? SUGGESTION_TEXTS.chooseDifferentTg
        : null;

  const submitChange = () => {
    if (!changeReady || chosenTg === null) return;
    const createsDeviation = chosenTg === "2" || chosenTg === "3";
    const input: DecideSuggestionInput = {
      id: uuidv7(),
      ruleKey: suggestion.ruleKey,
      decision: "changed",
      chosenTg,
      ...(outcomeChanged && s.kind === "outcome" && chosenOutcome
        ? { chosenOutcome: { questionKey: s.question_key, outcomeKey: chosenOutcome } }
        : {}),
      ...(createsDeviation ? { deviationId: uuidv7() } : {}),
      ...(reasonCode ? { overrideReasonCode: reasonCode } : {}),
      ...(reasonText.trim() ? { overrideReason: reasonText.trim() } : {}),
    };
    void send(input, chosenTgText(chosenTg), "change");
  };

  const submitReject = () => {
    if (reasonCheck !== "ok") return;
    const input: DecideSuggestionInput = {
      id: uuidv7(),
      ruleKey: suggestion.ruleKey,
      decision: "rejected",
      ...(reasonCode ? { overrideReasonCode: reasonCode } : {}),
      ...(reasonText.trim() ? { overrideReason: reasonText.trim() } : {}),
    };
    void send(input, tgText(tgs), "reject");
  };

  const reasonButtons = (legend: string) => (
    <div className="space-y-3">
      <ChoiceButtons
        id={`${id}-reason`}
        legend={legend}
        options={(
          Object.keys(OVERRIDE_REASON_LABELS) as (keyof typeof OVERRIDE_REASON_LABELS)[]
        ).map((code) => ({ value: code, label: OVERRIDE_REASON_LABELS[code] }))}
        value={reasonCode}
        onChange={(code) => {
          setReasonCode(code as OverrideReasonCode);
          if (code === "other") {
            setShowText(true);
            focus(`${id}-reason-text`);
          }
        }}
      />
      {showText || reasonCode === "other" ? (
        <div className="space-y-1.5">
          <label htmlFor={`${id}-reason-text`} className="block text-sm font-medium text-slate-700">
            {reasonCode === "other"
              ? SUGGESTION_TEXTS.reasonText
              : SUGGESTION_TEXTS.reasonTextOptional}
          </label>
          <Textarea
            id={`${id}-reason-text`}
            className="min-h-24"
            value={reasonText}
            maxLength={2000}
            onChange={(event) => setReasonText(event.target.value)}
          />
        </div>
      ) : (
        <Button
          variant="ghost"
          onClick={() => {
            setShowText(true);
            focus(`${id}-reason-text`);
          }}
        >
          {SUGGESTION_TEXTS.addExplanation}
        </Button>
      )}
    </div>
  );

  return (
    <section
      ref={sectionRef}
      id={id}
      tabIndex={-1}
      aria-labelledby={headingId}
      className={
        review ? "space-y-3 rounded-xl bg-white p-4" : "space-y-3 rounded-card bg-sand p-5"
      }
    >
      <h3 id={headingId} className={review ? "sr-only" : "text-sm text-stone"}>
        {RULE_SUGGESTION_HEADING}
      </h3>
      <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-slate-900">
        {tgs.map((tg) => (
          <TgBadge key={tg} tg={tg} long={tgs.length === 1} />
        ))}
        {tgs.length > 1 && <span className="sr-only">{tgText(tgs)}</span>}
        <span>{name}</span>
      </p>
      {why.length > 0 && (
        <div className="text-sm text-slate-900">
          <p className="font-medium">{SUGGESTION_TEXTS.why}</p>
          <ul className="space-y-0.5">{why.map(reasonLink)}</ul>
        </div>
      )}
      {!review && (
        <p className="text-sm text-stone">
          {SUGGESTION_TEXTS.inspectionYear(inspectionYear.year)}
          {suggestion.sourceRef ? ` · ${SUGGESTION_TEXTS.source} ${suggestion.sourceRef}` : ""}
        </p>
      )}
      {noticeElement}

      {mode.kind === "kept_open" && (
        <p className="text-sm text-slate-900">{SUGGESTION_OPEN_WITH_TG_DEVIATIONS_TEXT}</p>
      )}

      {mode.kind === "tgiu_conflict" && (
        <div id={`${id}-conflict`} tabIndex={-1} className="space-y-3">
          <Warning>{SUGGESTION_TEXTS.tgiuConflict(mode.tgText)}</Warning>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              disabled={busy !== null}
              onClick={() =>
                void send({ ...mode.input, tgiuChoice: "remove_tgiu" }, mode.tgText, "conflict")
              }
            >
              {busy === "conflict" ? ROOM_TEXTS.saving : SUGGESTION_TEXTS.removeTgiuAndAdd}
            </Button>
            <Button variant="secondary" onClick={() => setMode({ kind: "idle" })}>
              {SUGGESTION_TEXTS.keepTgiu}
            </Button>
          </div>
        </div>
      )}

      {mode.kind === "deviation_conflict" && (
        <div id={`${id}-conflict`} tabIndex={-1} className="space-y-3">
          <Warning>{SUGGESTION_TEXTS.deviationConflict(mode.tg)}</Warning>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              disabled={busy !== null}
              onClick={() =>
                void send(
                  { ...mode.input, tgDeviationChoice: "remove_tg_deviations" },
                  mode.tg,
                  "conflict",
                )
              }
            >
              {busy === "conflict"
                ? ROOM_TEXTS.saving
                : SUGGESTION_TEXTS.removeDeviationsAndSet(mode.tg)}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setMode({ kind: "kept_open" });
                focus(`${id}-accept`);
              }}
            >
              {SUGGESTION_TEXTS.keepDeviations}
            </Button>
          </div>
        </div>
      )}

      {mode.kind === "changing" && (
        <div className="space-y-4">
          <ChoiceButtons
            id={`${id}-tg`}
            legend={SUGGESTION_TEXTS.chooseTg}
            options={tgOptions}
            value={chosenTg}
            onChange={(value) => setChosenTg(value as ChosenTg)}
          />
          {otherOutcomes.length > 1 && (
            <ChoiceButtons
              id={`${id}-outcome`}
              legend={SUGGESTION_TEXTS.otherOutcome}
              options={otherOutcomes.map((o) => ({ value: o.key, label: outcomeName(o) }))}
              value={chosenOutcome ?? (s.kind === "outcome" ? s.outcome_key : null)}
              onChange={setChosenOutcome}
            />
          )}
          {reasonButtons(SUGGESTION_TEXTS.changeReason)}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              aria-disabled={!changeReady || busy !== null}
              aria-describedby={changeHint ? `${id}-change-hint` : undefined}
              onClick={submitChange}
              className={!changeReady ? "bg-slate-500 hover:bg-slate-500" : undefined}
            >
              {busy === "change" ? ROOM_TEXTS.saving : SUGGESTION_TEXTS.saveChange}
            </Button>
            <Button variant="ghost" onClick={() => cancelForm("changing")}>
              {SUGGESTION_TEXTS.cancel}
            </Button>
          </div>
          {changeHint && (
            <p id={`${id}-change-hint`} className="text-sm text-slate-700">
              {changeHint}
            </p>
          )}
        </div>
      )}

      {mode.kind === "rejecting" && (
        <div className="space-y-4">
          {reasonButtons(SUGGESTION_TEXTS.rejectReason)}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              aria-disabled={reasonCheck !== "ok" || busy !== null}
              aria-describedby={reasonCheck !== "ok" ? `${id}-reject-hint` : undefined}
              onClick={submitReject}
              className={reasonCheck !== "ok" ? "bg-slate-500 hover:bg-slate-500" : undefined}
            >
              {busy === "reject" ? ROOM_TEXTS.saving : SUGGESTION_TEXTS.rejectConfirm}
            </Button>
            <Button variant="ghost" onClick={() => cancelForm("rejecting")}>
              {SUGGESTION_TEXTS.cancel}
            </Button>
          </div>
          {reasonCheck !== "ok" && (
            <p id={`${id}-reject-hint`} className="text-sm text-slate-700">
              {OVERRIDE_REASON_CHECK_MESSAGES[reasonCheck]}
            </p>
          )}
        </div>
      )}

      {canEdit && (mode.kind === "idle" || mode.kind === "kept_open") && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
          {isChoose ? (
            <>
              <Button
                id={`${id}-accept`}
                size="lg"
                className="min-w-40"
                disabled={busy !== null}
                onClick={() => void accept(2)}
              >
                {busy === "accept" ? ROOM_TEXTS.saving : SUGGESTION_TEXTS.acceptAs(2)}
              </Button>
              <Button
                size="lg"
                className="min-w-40"
                disabled={busy !== null}
                onClick={() => void accept(3)}
              >
                {busy === "accept" ? ROOM_TEXTS.saving : SUGGESTION_TEXTS.acceptAs(3)}
              </Button>
            </>
          ) : (
            <Button
              id={`${id}-accept`}
              size="lg"
              className="min-w-40"
              disabled={busy !== null}
              onClick={() => void accept()}
            >
              {busy === "accept" ? ROOM_TEXTS.saving : SUGGESTION_TEXTS.accept}
            </Button>
          )}
          <Button
            id={`${id}-change`}
            variant="secondary"
            disabled={busy !== null}
            onClick={() => openForm("changing")}
          >
            {SUGGESTION_TEXTS.change}
          </Button>
          <div className="basis-full max-[479px]:block min-[480px]:hidden" aria-hidden="true" />
          <span className="w-12 shrink-0" aria-hidden="true" />
          <Button
            id={`${id}-reject`}
            variant="secondary"
            disabled={busy !== null}
            className="min-[480px]:ml-auto"
            onClick={() => openForm("rejecting")}
          >
            {SUGGESTION_TEXTS.reject}
          </Button>
        </div>
      )}
      {error && <FormMessage message={error} />}
    </section>
  );
}

export type StickyAccept = { buttons: { label: string; run(): void }[] };
