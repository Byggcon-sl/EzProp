"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { CheckpointView, ReportSummaryView } from "@/core/reports/types";
import type { SummaryBasisEntry } from "@/db/schema";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  AiSuggestion,
  type AiSuggestionCardOutcome,
  type AiSuggestionCardStatus,
} from "@/shared/ui/ai-suggestion";
import { AiSparkIcon } from "@/shared/ui/ai-text-mark";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Textarea } from "@/shared/ui/form";
import { Warning } from "@/shared/ui/warning";
import {
  decideAiSuggestionAction,
  draftSummaryAction,
  getSummaryAction,
  saveSummaryAction,
} from "./actions";
import { useRoom } from "./room-context";
import {
  AI_ROOM_TEXTS,
  type ActionError,
  isActionError,
  ROOM_ACTION_MESSAGES,
  ROOM_TEXTS,
  summaryStoppedText,
} from "./room-messages";
import {
  characterCountText,
  CHECKPOINT_HEADING_ID,
  deviationHeadingId,
  deviationTgChoiceId,
  reportTextValidator,
  summaryChangeItems,
  type SummaryWarningItem,
} from "./room-model";

/*
 * «Sammendrag for hele rapporten» nederst på badskjermen (docs/funksjoner/fase2a-ki-i-veien-design.md
 * avsnitt 8, A483, A434, A435, A461, A462 og A465). Tekstfeltet lagres når det forlates og 800 ms
 * etter siste tastetrykk. «Lag utkast» overskriver aldri: utkastet vises i forslagskortet, og bare
 * «Bruk» bytter teksten (med «Angre»). Koden setter overskriftene med TG; KI skriver bare teksten
 * per funn. Advarslene sier fra når sammendraget ikke stemmer med funnene, men sperrer aldri.
 *
 * Kontor og andre uten `report.edit` ser teksten og advarslene, ingen knapper. Det styres av
 * `canEdit` fra serveren; serveren sjekker hver handling.
 * Støtter hovedmål: de ansatte (utkast med ett trykk), KI i bunnen (samme forslagskort) og færre
 * reklamasjoner (TG alltid fra koden, advarsel når funnene er endret eller et TG3-funn ikke nevnt).
 */

export const SUMMARY_HEADING_ID = "summary-heading";
const SUMMARY_FIELD_ID = "summary-text";
const SAVE_DELAY_MS = 800;
const SUMMARY_MAX = 10_000;

type Draft = {
  usageId: string | null;
  text: string;
  basis: SummaryBasisEntry[];
  status: AiSuggestionCardStatus | null;
  outcome: AiSuggestionCardOutcome;
  stoppedText?: string;
  /** Teksten i feltet før «Bruk», for «Angre». */
  before: string | null;
};

type SaveState = "idle" | "pending" | "saving" | "saved" | "failed";

export function ReportSummarySection({
  initial,
  checkpoints,
}: {
  initial: ReportSummaryView;
  /** Punktene i rommet slik de står nå. Endres de, leses advarslene på nytt. */
  checkpoints: readonly CheckpointView[];
}) {
  const refreshKey = checkpoints;
  const { room, online, announce, openCheckpoint, doc } = useRoom();
  const [summary, setSummary] = useState(initial);
  const [text, setText] = useState(initial.text ?? "");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [missingTg, setMissingTg] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState<"suggestion" | "decision" | null>(null);
  const [live, setLive] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saved = useRef(initial.text ?? "");
  const rowVersion = useRef(initial.rowVersion);
  const hintId = useId();
  const validate = reportTextValidator(SUMMARY_MAX);

  const takeSummary = useCallback((next: ReportSummaryView, replaceText: boolean) => {
    setSummary(next);
    rowVersion.current = next.rowVersion;
    if (replaceText) {
      saved.current = next.text ?? "";
      setText(next.text ?? "");
    }
  }, []);

  // Advarslene følger funnene: les sammendraget på nytt når rommet er endret.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!online) return;
    let cancelled = false;
    const wait = setTimeout(async () => {
      const result = await getSummaryAction(room).catch(() => null);
      if (cancelled || !result || isActionError(result) || !result.summary) return;
      const hadChanges = summary.changedSinceDraft !== null;
      takeSummary(result.summary, false);
      if (!hadChanges && result.summary.changedSinceDraft !== null) {
        setLive(AI_ROOM_TEXTS.summaryStale);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(wait);
    };
    // Bare ved nye funn, ikke ved hver lagring av sammendraget
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, online, room]);

  const save = useCallback(
    async (
      value: string,
      draftInput?: { usageId: string | null; basis: SummaryBasisEntry[]; edited: boolean },
    ): Promise<boolean> => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      const invalid = validate(value);
      if (invalid) {
        setError(invalid);
        setSaveState("failed");
        return false;
      }
      if (value === saved.current && !draftInput) {
        setSaveState((s) => (s === "pending" ? "idle" : s));
        return true;
      }
      setError(null);
      setSaveState("saving");
      const result = await saveSummaryAction(room, {
        text: value === "" ? null : value,
        baseRowVersion: rowVersion.current,
        ...(draftInput ? { draft: draftInput } : {}),
      }).catch((): ActionError => ({ status: "error", message: ROOM_ACTION_MESSAGES.network }));
      if (isActionError(result)) {
        setError(result.message);
        setSaveState("failed");
        return false;
      }
      if (result.status === "conflict") {
        takeSummary(result.summary, true);
        setError(AI_ROOM_TEXTS.summaryConflict);
        setSaveState("failed");
        return false;
      }
      saved.current = value;
      takeSummary(result.summary, false);
      setSaveState("saved");
      return true;
    },
    [room, takeSummary, validate],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onChange = (value: string) => {
    setText(value);
    setSaveState("pending");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(value), SAVE_DELAY_MS);
  };

  const requestDraft = async () => {
    setMessage(null);
    setMissingTg(null);
    if (!online) {
      setMessage(AI_ROOM_TEXTS.offline);
      announce(AI_ROOM_TEXTS.offline);
      return;
    }
    if (text !== saved.current && !(await save(text))) return;
    setPending("suggestion");
    setDraft((now) => (now ? { ...now } : null));
    const result = await draftSummaryAction(room, { requestId: uuidv7() }).catch(() => ({
      status: "error" as const,
      message: ROOM_ACTION_MESSAGES.network,
    }));
    setPending(null);
    if (isActionError(result)) {
      setMessage(result.message);
      return;
    }
    switch (result.status) {
      case "suggestion":
        setDraft({
          usageId: result.usageId,
          text: result.text,
          basis: result.basis,
          status: "suggested",
          outcome: "ok",
          before: null,
        });
        setMissingTg(result.missingTgCount > 0 ? result.missingTgCount : null);
        setLive(AI_ROOM_TEXTS.summaryReady);
        return;
      case "no_findings":
        setDraft(null);
        setMessage(AI_ROOM_TEXTS.summaryNoFindings);
        setMissingTg(result.missingTgCount > 0 ? result.missingTgCount : null);
        return;
      case "ai_off":
        setDraft(null);
        setMessage(AI_ROOM_TEXTS.aiOff);
        return;
      case "too_many_findings":
        setDraft(null);
        setMessage(AI_ROOM_TEXTS.summaryTooMany(result.limit));
        return;
      case "stopped":
        setDraft({
          usageId: null,
          text: "",
          basis: [],
          status: null,
          outcome: "stopped",
          stoppedText: summaryStoppedText(result.guard),
          before: null,
        });
        return;
      default:
        setDraft({
          usageId: null,
          text: "",
          basis: [],
          status: null,
          outcome: "error",
          before: null,
        });
    }
  };

  const decide = async (usageId: string | null, decision: "rejected" | "undo") => {
    if (!usageId) return true;
    const result = await decideAiSuggestionAction(room, { usageId, decision }).catch(() => ({
      status: "error" as const,
      message: ROOM_ACTION_MESSAGES.network,
    }));
    if (isActionError(result)) {
      setMessage(result.message);
      return false;
    }
    return true;
  };

  const onUse = async () => {
    if (!draft || draft.outcome !== "ok") return;
    setPending("decision");
    const before = text;
    const ok = await save(draft.text, {
      usageId: draft.usageId,
      basis: draft.basis,
      edited: false,
    });
    setPending(null);
    if (!ok) return;
    setText(draft.text);
    setDraft({ ...draft, status: "accepted", before });
    setLive(AI_ROOM_TEXTS.summaryUsed);
  };

  const onKeep = async () => {
    if (!draft) return;
    setPending("decision");
    const ok = await decide(draft.usageId, "rejected");
    setPending(null);
    if (ok) setDraft({ ...draft, status: "rejected" });
  };

  const onUndo = async () => {
    if (!draft) return;
    setPending("decision");
    if (draft.status === "accepted" && draft.before !== null && text === draft.text) {
      if (!(await save(draft.before))) {
        setPending(null);
        return;
      }
      setText(draft.before);
    }
    const ok = await decide(draft.usageId, "undo");
    setPending(null);
    if (ok) setDraft({ ...draft, status: "suggested", before: null });
  };

  // --- Advarslene ----------------------------------------------------------------------------

  const changeItems = summaryChangeItems(summary, {
    added: AI_ROOM_TEXTS.summaryAdded,
    changed: AI_ROOM_TEXTS.summaryChangedItem,
    removed: AI_ROOM_TEXTS.summaryRemoved,
  });

  const goTo = (item: SummaryWarningItem) => {
    if (!item.checkpointKey) return;
    const focusId =
      item.id.startsWith("changed-") || item.id.startsWith("added-")
        ? deviationHeadingId(item.id.replace(/^(changed|added)-/, ""))
        : CHECKPOINT_HEADING_ID;
    openCheckpoint(item.checkpointKey, { focusId });
  };

  const findingLink = (item: SummaryWarningItem) => {
    if (!item.checkpointKey) return <span>{item.text}</span>;
    if (item.roomId === room.roomId && doc.checkpoint(item.checkpointKey)) {
      return (
        <button
          type="button"
          className="min-h-11 text-left underline underline-offset-4"
          onClick={() => goTo(item)}
        >
          {item.text}
        </button>
      );
    }
    if (!item.roomId) return <span>{item.text}</span>;
    return (
      <Link
        className="inline-flex min-h-11 items-center underline underline-offset-4"
        href={`/oppdrag/${room.assignmentId}/rom/${item.roomId}?punkt=${encodeURIComponent(item.checkpointKey)}`}
      >
        {item.text}
      </Link>
    );
  };

  const uncovered = summary.uncovered.filter((f) => f.group === "tg3" || f.group === "tgiu");
  /** Første avvik uten TG i rommet, i malens rekkefølge («Rett nå», A465). */
  const firstMissingTg = () => {
    for (const checkpoint of doc.checkpoints) {
      const view = checkpoints.find((c) => c.checkpointKey === checkpoint.key);
      const deviation = [...(view?.deviations ?? [])]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .find((d) => d.kind === "tg" && d.tg === null);
      if (deviation) return { checkpointKey: checkpoint.key, deviationId: deviation.id };
    }
    return null;
  };

  const warnings = (
    <>
      {changeItems.length > 0 && (
        <Warning>
          <span className="block">{AI_ROOM_TEXTS.summaryChanged}</span>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {changeItems.map((item) => (
              <li key={item.id}>{findingLink(item)}</li>
            ))}
          </ul>
        </Warning>
      )}
      {uncovered.map((finding) => (
        <Warning key={`uncovered-${finding.id}`}>
          {AI_ROOM_TEXTS.summaryUncovered(
            finding.checkpointName,
            finding.group === "tg3" ? "TG3" : "TGIU",
          )}
        </Warning>
      ))}
    </>
  );

  const canDraft = summary.findingCount > 0;
  const count = characterCountText(text.length, SUMMARY_MAX);

  if (!summary.canEdit) {
    return (
      <section
        aria-labelledby={SUMMARY_HEADING_ID}
        className="mt-12 space-y-4 border-t border-line pt-8"
      >
        <h2 id={SUMMARY_HEADING_ID} className="font-heading text-xl font-semibold text-slate-900">
          {AI_ROOM_TEXTS.summaryHeading}
        </h2>
        {warnings}
        <Card>
          <p className="text-sm font-medium text-slate-700">{AI_ROOM_TEXTS.summaryLabel}</p>
          <p className="mt-1 break-words whitespace-pre-wrap text-slate-900">
            {summary.text || AI_ROOM_TEXTS.summaryNotWritten}
          </p>
        </Card>
      </section>
    );
  }

  const saveText =
    saveState === "saving" || saveState === "pending"
      ? ROOM_TEXTS.saving
      : saveState === "saved"
        ? "Lagret"
        : "";

  return (
    <section
      aria-labelledby={SUMMARY_HEADING_ID}
      className="mt-12 space-y-4 border-t border-line pt-8"
    >
      <h2
        id={SUMMARY_HEADING_ID}
        tabIndex={-1}
        className="font-heading text-xl font-semibold text-slate-900"
      >
        {AI_ROOM_TEXTS.summaryHeading}
      </h2>
      <p role="status" aria-live="polite" className="sr-only">
        {live}
      </p>
      {warnings}
      <Card>
        <div className="space-y-1.5">
          <div className="flex items-end justify-between gap-3">
            <label htmlFor={SUMMARY_FIELD_ID} className="block text-sm font-medium text-slate-700">
              {AI_ROOM_TEXTS.summaryLabel}
            </label>
            <Button
              variant="secondary"
              size="md"
              className="min-w-11 shrink-0"
              disabled={!canDraft || pending === "suggestion"}
              aria-describedby={!canDraft ? hintId : message ? `${hintId}-message` : undefined}
              onClick={() => void requestDraft()}
              data-ai-control="summary"
            >
              <AiSparkIcon className="text-ai-700" />
              {pending === "suggestion"
                ? AI_ROOM_TEXTS.summaryDrafting
                : AI_ROOM_TEXTS.summaryDraft}
            </Button>
          </div>
          <Textarea
            id={SUMMARY_FIELD_ID}
            value={text}
            rows={6}
            className="min-h-40"
            aria-invalid={error ? true : undefined}
            aria-describedby={
              [error ? `${hintId}-error` : null, count ? `${hintId}-count` : null]
                .filter(Boolean)
                .join(" ") || undefined
            }
            onChange={(event) => onChange(event.target.value)}
            onBlur={() => void save(text)}
          />
          {error && (
            <p id={`${hintId}-error`} className="text-sm text-urgent-text">
              <span className="sr-only">Feil: </span>
              {error}
            </p>
          )}
          {count && (
            <p id={`${hintId}-count`} className="text-right text-sm text-slate-700">
              {count}
            </p>
          )}
          <p className="min-h-5 text-right text-sm text-slate-700" aria-live="polite">
            {saveText}
          </p>
          {!canDraft && (
            <p id={hintId} className="text-sm text-slate-900">
              {AI_ROOM_TEXTS.summaryNoFindings}
            </p>
          )}
          {message && (
            <p id={`${hintId}-message`} role="status" className="text-sm text-slate-900">
              {message}
            </p>
          )}
        </div>
      </Card>
      {missingTg !== null && (
        <Warning
          action={
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                const target = firstMissingTg();
                if (target) {
                  openCheckpoint(target.checkpointKey, {
                    focusId: deviationTgChoiceId(target.deviationId),
                  });
                }
              }}
            >
              {AI_ROOM_TEXTS.summaryFixNow}
            </Button>
          }
        >
          {AI_ROOM_TEXTS.summaryMissingTg(missingTg)}
        </Warning>
      )}
      {draft && (
        <AiSuggestion
          source={AI_ROOM_TEXTS.summarySource}
          ownText={text}
          suggestionText={draft.outcome === "ok" ? draft.text : null}
          status={draft.outcome === "ok" ? draft.status : null}
          outcome={pending === "suggestion" ? null : draft.outcome}
          stoppedText={draft.stoppedText}
          pending={pending}
          online={online}
          aiEnabled
          hasNewerSuggestion={false}
          aiUsageId={draft.usageId}
          onUse={() => void onUse()}
          onKeep={() => void onKeep()}
          onUndo={() => void onUndo()}
          onNewSuggestion={() => void requestDraft()}
        />
      )}
    </section>
  );
}
