"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_DEVIATIONS_PER_CHECKPOINT,
  TG_NOT_SET_LABEL,
  WARNING_FIX_LABELS,
  STALE_DEVIATION_ACTION_LABELS,
  warningText,
} from "@/core/reports/logic";
import type {
  AnswerView,
  CheckpointView,
  InspectionYear,
  ReportFieldChange,
  RoomTemplateDocument,
  SuggestionView,
} from "@/core/reports/types";
import type { TgDirect } from "@/db/schema";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { ChoiceButtons } from "@/shared/ui/choice-buttons";
import { FormMessage } from "@/shared/ui/form";
import { TgBadge } from "@/shared/ui/tg-badge";
import { Warning } from "@/shared/ui/warning";
import { restoreDeviationAction, setTgDirectAction } from "./actions";
import { AddDeviationPanel } from "./add-deviation-panel";
import { AnswerField } from "./answer-field";
import { DeviationCard } from "./deviation-card";
import { useRoom, type UndoLine } from "./room-context";
import { isActionError, ROOM_TEXTS, SUGGESTION_MESSAGES } from "./room-messages";
import {
  ADD_DEVIATION_BUTTON_ID,
  T0059_FIX,
  answerKey,
  CHECKPOINT_HEADING_ID,
  descriptionKey,
  deviationHeadingId,
  EMPTY_ANSWER,
  fixTargetId,
  outcomeName,
  suggestionId,
  TG_DIRECT_CHOICE_ID,
  TGIU_HEADING_ID,
  undoButtonId,
  WARNINGS_HEADING_ID,
  warningId,
  warningsWithFix,
} from "./room-model";
import { ReportTextField } from "./report-text-field";
import {
  focusElementById,
  RuleSuggestionCard,
  suggestionTgs,
  SUGGESTION_TEXTS,
  type StickyAccept,
} from "./rule-suggestion-card";
import { TgiuSection } from "./tgiu-section";

/*
 * Det valgte kontrollpunktet (design avsnitt 7): overskrift med TG, forslag fra reglene, feltene,
 * TG uten avvik, TGIU, avvikene, «+ Avvik», beskrivelse og «Å se over». Alt lagres per felt eller
 * med én handling; ingen «Lagre»-knapp. Advarslene sperrer aldri.
 * Støtter hovedmål: de ansatte (ett skjermbilde for punktet), færre reklamasjoner (mangler synes).
 */

export function CheckpointPanel({
  checkpoint,
  suggestions,
  answers,
  newAnswerIds,
  inspectionYear,
  document,
  searchOpenRequest,
  onStickyAccept,
}: {
  checkpoint: CheckpointView;
  suggestions: readonly SuggestionView[];
  answers: ReadonlyMap<string, AnswerView>;
  /** Id for nye svar per feltkode, laget én gang i nettleseren. */
  newAnswerIds: ReadonlyMap<string, string>;
  inspectionYear: InspectionYear;
  document: RoomTemplateDocument;
  /** Øker når Ctrl/Cmd+K er trykket: avvikssøket åpnes. */
  searchOpenRequest: number;
  onStickyAccept(ruleKey: string, accept: StickyAccept | null): void;
}) {
  const { canEdit, doc, announce, openCheckpoint, focus, undoLines } = useRoom();
  const cp = doc.checkpoint(checkpoint.checkpointKey);
  const [addOpen, setAddOpen] = useState(false);
  // Meldingen per forslag etter `already_decided` (A493). Punktet har egen nøkkel, så meldingene
  // forsvinner når punktet byttes.
  const [notices, setNotices] = useState<ReadonlyMap<string, string>>(() => new Map());
  const setNotice = useCallback((ruleKey: string, text: string | null) => {
    setNotices((map) => {
      if (text === null && !map.has(ruleKey)) return map;
      const copy = new Map(map);
      if (text === null) copy.delete(ruleKey);
      else copy.set(ruleKey, text);
      return copy;
    });
  }, []);
  const [handledSearchRequest, setHandledSearchRequest] = useState(searchOpenRequest);
  if (handledSearchRequest !== searchOpenRequest) {
    setHandledSearchRequest(searchOpenRequest);
    if (canEdit) setAddOpen(true);
  }
  const deviations = [...checkpoint.deviations].sort((a, b) => a.sortOrder - b.sortOrder);
  const ownSuggestions = suggestions.filter((s) => s.checkpointKey === checkpoint.checkpointKey);

  // Nytt forslag etter lagring av et felt leses opp (design avsnitt 8).
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const open = ownSuggestions.filter(
      (s) => s.state === "triggered" && !s.stale && s.latestDecision === null,
    );
    const keys = new Set(open.map((s) => s.ruleKey));
    if (seen.current !== null) {
      const fresh = open.find((s) => !seen.current?.has(s.ruleKey));
      if (fresh?.suggestion) {
        const outcome =
          fresh.suggestion.kind === "outcome"
            ? doc.outcome(
                fresh.suggestion.checkpoint_key,
                fresh.suggestion.question_key,
                fresh.suggestion.outcome_key,
              )
            : undefined;
        const tgs = suggestionTgs(fresh.suggestion, outcome)
          .map((tg) => (tg === "IU" ? "TGIU" : `TG${tg}`))
          .join(" eller ");
        const name = outcome ? outcomeName(outcome) : "";
        announce(SUGGESTION_TEXTS.newSuggestion(tgs, name));
      }
    }
    seen.current = keys;
  }, [ownSuggestions, doc, announce]);

  useEffect(() => {
    if (addOpen) focus("deviation-search");
  }, [addOpen, focus]);

  if (!cp) return null;
  const related = cp.related_checkpoint_keys
    .map((key) => doc.checkpoint(key))
    .filter((c): c is NonNullable<typeof c> => c !== undefined);
  const elements = doc.elements(cp.key);
  const atDeviationLimit = deviations.length >= MAX_DEVIATIONS_PER_CHECKPOINT;
  const ownUndo = undoLines;

  return (
    <div className="space-y-4 xl:space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2
            id={CHECKPOINT_HEADING_ID}
            tabIndex={-1}
            className="font-heading text-xl font-semibold break-words text-slate-900"
          >
            {cp.name}
          </h2>
          {related.length > 0 && (
            <p className="text-sm text-slate-700">
              {ROOM_TEXTS.seeWith}{" "}
              {related.map((r, index) => (
                <span key={r.key}>
                  <a
                    href={`?punkt=${encodeURIComponent(r.key)}`}
                    onClick={(event) => {
                      event.preventDefault();
                      openCheckpoint(r.key);
                    }}
                    className="inline-flex min-h-11 items-center underline underline-offset-4"
                  >
                    {r.name}
                  </a>
                  {index < related.length - 1 ? ", " : ""}
                </span>
              ))}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-700">
          <span>{ROOM_TEXTS.tgForCheckpoint}</span>
          {checkpoint.tg ? <TgBadge tg={checkpoint.tg} long /> : <span>{TG_NOT_SET_LABEL}</span>}
        </div>
      </header>

      {ownSuggestions.map((suggestion) => (
        <RuleSuggestionCard
          key={suggestion.ruleKey}
          suggestion={suggestion}
          deviations={deviations}
          inspectionYear={inspectionYear}
          onStickyAccept={onStickyAccept}
          notice={notices.get(suggestion.ruleKey) ?? null}
          onNotice={setNotice}
        />
      ))}

      {elements.length > 0 && (
        <Card>
          <section aria-labelledby="registration-heading" className="space-y-5">
            <h3 id="registration-heading" className="text-lg font-semibold text-slate-900">
              {ROOM_TEXTS.registration}
            </h3>
            {elements.map((element) => {
              const answer = answers.get(element.key);
              return (
                <AnswerField
                  key={element.key}
                  element={element}
                  serverValue={answer?.value ?? null}
                  serverRowId={answer?.id ?? null}
                  newRowId={newAnswerIds.get(element.key) ?? ""}
                />
              );
            })}
          </section>
        </Card>
      )}

      <TgDirectCard checkpoint={checkpoint} />

      {checkpoint.tgDirect === "IU" && (
        <TgiuSection
          checkpointKey={checkpoint.checkpointKey}
          details={checkpoint.tgiuDetails}
          warnings={checkpoint.warnings}
        />
      )}

      {ownUndo.map((line) => (
        <UndoRow key={line.id} line={line} checkpoint={checkpoint} />
      ))}

      {deviations.map((deviation, index) => (
        <DeviationCard
          key={deviation.id}
          deviation={deviation}
          number={index + 1}
          checkpointKey={checkpoint.checkpointKey}
        />
      ))}

      {canEdit &&
        (addOpen ? (
          <AddDeviationPanel
            checkpointKey={checkpoint.checkpointKey}
            document={document}
            onClose={() => {
              setAddOpen(false);
              focus(ADD_DEVIATION_BUTTON_ID);
            }}
          />
        ) : (
          <div className="space-y-1.5">
            <Button
              id={ADD_DEVIATION_BUTTON_ID}
              variant="secondary"
              size="lg"
              disabled={atDeviationLimit}
              onClick={() => setAddOpen(true)}
            >
              {ROOM_TEXTS.addDeviation}
            </Button>
            {atDeviationLimit && (
              <p className="text-sm text-slate-700">{ROOM_TEXTS.deviationLimit}</p>
            )}
          </div>
        ))}

      <ReportTextField
        fieldKey={descriptionKey(checkpoint.checkpointKey)}
        label={ROOM_TEXTS.description}
        serverValue={checkpoint.descriptionText}
        build={(value, base): ReportFieldChange => ({
          table: "checkpoint_results",
          checkpointKey: checkpoint.checkpointKey,
          field: "description_text",
          value: value === "" ? null : value,
          base: base === "" ? null : base,
        })}
      />

      <ReviewList
        checkpoint={checkpoint}
        suggestions={ownSuggestions}
        answers={answers}
        inspectionYear={inspectionYear}
        onNotice={setNotice}
      />
    </div>
  );
}

/** «TG uten avvik» (design avsnitt 7 punkt 4) med konfliktvalget når punktet har avvik med TG. */
function TgDirectCard({ checkpoint }: { checkpoint: CheckpointView }) {
  const { canEdit, run, room, focus, announce } = useRoom();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<TgDirect | null>(null);
  const [keptOpen, setKeptOpen] = useState(false);
  const hasTgDeviation = checkpoint.deviations.some((d) => d.kind === "tg" && d.tg !== null);

  const setTg = async (tgDirect: TgDirect | null, choice?: "remove_tg_deviations") => {
    setBusy(true);
    setError(null);
    setKeptOpen(false);
    const result = await run(() =>
      setTgDirectAction(room, {
        checkpointKey: checkpoint.checkpointKey,
        tgDirect,
        base: checkpoint.tgDirect,
        ...(choice ? { tgDeviationChoice: choice } : {}),
      }),
    );
    setBusy(false);
    if (isActionError(result)) {
      setError(result.message);
      return;
    }
    if (result.status === "tgiu_conflicts_with_deviation") {
      setConflict(tgDirect);
      focus("tg-direct-conflict");
      return;
    }
    setConflict(null);
    if (result.status === "conflict") {
      announce("Endret av andre");
      return;
    }
    if (tgDirect === "IU") {
      announce(ROOM_TEXTS.tgiuSet);
      focus(TGIU_HEADING_ID);
    }
  };

  if (!canEdit) {
    return (
      <Card>
        <h3 className="text-lg font-semibold text-slate-900">{ROOM_TEXTS.tgWithoutDeviation}</h3>
        <p className="mt-2 text-slate-900">
          {checkpoint.tgDirect ? <TgBadge tg={checkpoint.tgDirect} long /> : TG_NOT_SET_LABEL}
        </p>
      </Card>
    );
  }

  const conflictTg = conflict === "0" ? "TG0" : "TGIU";
  return (
    <Card>
      <section aria-labelledby="tg-direct-heading" className="space-y-3">
        <h3 id="tg-direct-heading" className="text-lg font-semibold text-slate-900">
          {ROOM_TEXTS.tgWithoutDeviation}
        </h3>
        <ChoiceButtons
          id={TG_DIRECT_CHOICE_ID}
          legend={ROOM_TEXTS.tgWithoutDeviation}
          legendHidden
          hint={
            hasTgDeviation ? ROOM_TEXTS.tgLockedByDeviations : ROOM_TEXTS.tgWithoutDeviationHint
          }
          options={[
            { value: "0", label: "TG0", disabled: hasTgDeviation },
            { value: "1", label: "TG1", disabled: hasTgDeviation },
            { value: "IU", label: "TGIU" },
          ]}
          value={checkpoint.tgDirect}
          disabled={busy}
          onChange={(value) => void setTg(value as TgDirect)}
        />
        {checkpoint.tgDirect !== null && (
          <Button variant="ghost" disabled={busy} onClick={() => void setTg(null)}>
            {ROOM_TEXTS.removeTg}
          </Button>
        )}
        {conflict !== null && (
          <div id="tg-direct-conflict" tabIndex={-1} className="space-y-3">
            <Warning>{SUGGESTION_TEXTS.deviationConflict(conflictTg)}</Warning>
            <div className="flex flex-wrap gap-3">
              <Button
                size="lg"
                disabled={busy}
                onClick={() => void setTg(conflict, "remove_tg_deviations")}
              >
                {busy ? ROOM_TEXTS.saving : SUGGESTION_TEXTS.removeDeviationsAndSet(conflictTg)}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setConflict(null);
                  setKeptOpen(true);
                }}
              >
                {SUGGESTION_TEXTS.keepDeviations}
              </Button>
            </div>
          </div>
        )}
        {keptOpen && <p className="text-sm text-slate-700">{ROOM_TEXTS.tgLockedByDeviations}</p>}
        {error && <FormMessage message={error} />}
      </section>
    </Card>
  );
}

/** Id-en til «Gå til forslaget» etter `newer_decision`. */
const newerDecisionButtonId = (lineId: string) => `${lineId}-go`;

/**
 * «Avvik 1 er fjernet.» / «TGIU er fjernet.» med «Angre» til punktet forlates. For avvik fra et
 * forslag: «Avviket er fjernet. Forslaget om TG3 er åpent igjen.» (T-0117). Avvises «Angre» fordi
 * forslaget er avgjort på nytt, står meldingen om det med «Gå til forslaget» (A494).
 */
function UndoRow({ line, checkpoint }: { line: UndoLine; checkpoint: CheckpointView }) {
  if (line.kind === "newer_decision") return <NewerDecisionRow line={line} />;
  return <UndoActionRow line={line} checkpoint={checkpoint} />;
}

function NewerDecisionRow({ line }: { line: Extract<UndoLine, { kind: "newer_decision" }> }) {
  const { removeUndo } = useRoom();
  const messageId = `${line.id}-message`;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-white px-4 py-3">
      <p id={messageId} role="status" className="min-w-0 flex-1 basis-60 text-slate-900">
        {SUGGESTION_MESSAGES.newerDecision}
      </p>
      <Button
        id={newerDecisionButtonId(line.id)}
        variant="secondary"
        aria-describedby={messageId}
        onClick={() => {
          if (focusElementById(suggestionId(line.ruleKey))) removeUndo(line.id);
        }}
      >
        {SUGGESTION_MESSAGES.goToSuggestion}
      </Button>
    </div>
  );
}

function UndoActionRow({
  line,
  checkpoint,
}: {
  line: Exclude<UndoLine, { kind: "newer_decision" }>;
  checkpoint: CheckpointView;
}) {
  const { run, room, focus, removeUndo, addUndo, announce } = useRoom();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tgiuChoice, setTgiuChoice] = useState(false);

  const undo = async (choice?: "remove_tgiu") => {
    setBusy(true);
    setError(null);
    if (line.kind === "deviation") {
      const result = await run(() =>
        restoreDeviationAction(room, {
          deviationId: line.deviationId,
          ...(choice ? { tgiuChoice: choice } : {}),
        }),
      );
      setBusy(false);
      if (isActionError(result)) return setError(result.message);
      if (result.status === "tgiu_conflict") {
        setTgiuChoice(true);
        return;
      }
      if (result.status === "newer_decision") {
        // Forslaget er avgjort på nytt etter at avviket ble fjernet: ingenting er endret (A494).
        const id = `newer-${line.deviationId}`;
        removeUndo(line.id);
        addUndo({ kind: "newer_decision", id, ruleKey: result.ruleKey });
        focus(newerDecisionButtonId(id));
        return;
      }
      removeUndo(line.id);
      focus(deviationHeadingId(line.deviationId));
      return;
    }
    const result = await run(() =>
      setTgDirectAction(room, {
        checkpointKey: checkpoint.checkpointKey,
        tgDirect: "IU",
        base: checkpoint.tgDirect,
      }),
    );
    setBusy(false);
    if (isActionError(result)) return setError(result.message);
    if (result.status === "tgiu_conflicts_with_deviation") {
      setError(SUGGESTION_TEXTS.deviationConflict("TGIU"));
      return;
    }
    removeUndo(line.id);
    announce(ROOM_TEXTS.tgiuSet);
    focus(TGIU_HEADING_ID);
  };

  const messageId = `${line.id}-message`;
  const reopened = line.kind === "deviation" && line.suggestion !== null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-white px-4 py-3">
        <p
          id={messageId}
          role={reopened ? "status" : undefined}
          className="min-w-0 flex-1 basis-60 text-slate-900"
        >
          {line.kind === "tgiu"
            ? ROOM_TEXTS.tgiuRemoved
            : line.suggestion
              ? SUGGESTION_MESSAGES.suggestionReopened(line.suggestion.tg)
              : ROOM_TEXTS.deviationRemoved(line.number)}
        </p>
        <Button
          id={undoButtonId(line.id)}
          variant="secondary"
          disabled={busy}
          aria-describedby={messageId}
          onClick={() => void undo()}
        >
          {busy ? ROOM_TEXTS.saving : ROOM_TEXTS.undo}
        </Button>
      </div>
      {tgiuChoice && (
        <div className="space-y-3">
          <Warning>{SUGGESTION_TEXTS.tgiuConflict("TG")}</Warning>
          <div className="flex flex-wrap gap-3">
            <Button size="lg" disabled={busy} onClick={() => void undo("remove_tgiu")}>
              {SUGGESTION_TEXTS.removeTgiuAndAdd}
            </Button>
            <Button variant="secondary" onClick={() => setTgiuChoice(false)}>
              {SUGGESTION_TEXTS.keepTgiu}
            </Button>
          </div>
        </div>
      )}
      {error && <FormMessage message={error} />}
    </div>
  );
}

/**
 * «Å se over» (design avsnitt 13): advarslene på punktet med «Rett nå». Sperrer aldri. Åpne
 * forslag på ferdig punkt står øverst (TG3 først) med Godta, Endre og Avvis (A492). Når alt er
 * løst, forsvinner listen, og «Å se over (0)» leses opp.
 */
function ReviewList({
  checkpoint,
  suggestions,
  answers,
  inspectionYear,
  onNotice,
}: {
  checkpoint: CheckpointView;
  suggestions: readonly SuggestionView[];
  answers: ReadonlyMap<string, AnswerView>;
  inspectionYear: InspectionYear;
  onNotice(ruleKey: string, text: string | null): void;
}) {
  const { store, removeDeviation, doc } = useRoom();
  const [error, setError] = useState<string | null>(null);
  const items = warningsWithFix(checkpoint, suggestions, doc);
  // Har listen hatt noe på dette punktet, leses «Å se over (0)» opp når den blir tom.
  const [hadItems, setHadItems] = useState(items.length > 0);
  if (items.length > 0 && !hadItems) setHadItems(true);
  // Statusområdet står fast, også når listen er tom, så endringen til 0 leses opp.
  const status = (
    <p role="status" aria-live="polite" className="sr-only">
      {hadItems ? ROOM_TEXTS.toReview(items.length) : ""}
    </p>
  );
  if (items.length === 0) return status;
  const deviations = [...checkpoint.deviations].sort((a, b) => a.sortOrder - b.sortOrder);
  const numberOf = (id: string | null) => {
    if (!id) return null;
    const index = deviations.findIndex((d) => d.id === id);
    return index < 0 ? null : index + 1;
  };
  const firstMeasureId = (deviationId: string) =>
    [...(deviations.find((d) => d.id === deviationId)?.measures ?? [])].sort(
      (a, b) => a.sortOrder - b.sortOrder,
    )[0]?.id ?? null;

  const changeAnswer = () => {
    const key = answerKey(T0059_FIX.elementKey);
    if (!store.get(key)) {
      const answer = answers.get(T0059_FIX.elementKey);
      store.ensure(
        key,
        answer?.value ?? EMPTY_ANSWER,
        (value, base, rowId) => ({
          table: "field_answers",
          id: rowId ?? answer?.id ?? "",
          elementKey: T0059_FIX.elementKey,
          field: "value",
          value: value as typeof EMPTY_ANSWER,
          base: base as typeof EMPTY_ANSWER,
        }),
        { rowId: answer?.id ?? null },
      );
    }
    store.edit(key, { ...EMPTY_ANSWER, optionKeys: [T0059_FIX.optionKey] }, 0);
  };

  return (
    <>
      {status}
      <Card>
        <section aria-labelledby={WARNINGS_HEADING_ID} className="space-y-3">
          <h3
            id={WARNINGS_HEADING_ID}
            tabIndex={-1}
            className="text-lg font-semibold text-slate-900"
          >
            {ROOM_TEXTS.toReview(items.length)}
          </h3>
          <ul className="space-y-2">
            {items.map(({ warning, fix, context, openSuggestion }, index) => {
              const n = numberOf(warning.deviationId);
              const text = `${n !== null ? `${ROOM_TEXTS.deviationNumber(n)}: ` : ""}${warningText(warning, context)}`;
              const target = fix
                ? fixTargetId(fix, { checkpointKey: checkpoint.checkpointKey, firstMeasureId })
                : warning.deviationId
                  ? deviationHeadingId(warning.deviationId)
                  : null;
              const linked =
                fix?.kind === "scroll_to_suggestion" && fix.deviationId ? fix.deviationId : null;
              return (
                <li
                  key={`${warning.code}-${warning.deviationId ?? ""}-${warning.ruleKey ?? ""}-${index}`}
                >
                  <Warning
                    id={warningId(index)}
                    focusable
                    action={
                      <>
                        {fix?.kind === "change_answer" && (
                          <Button variant="secondary" onClick={changeAnswer}>
                            {WARNING_FIX_LABELS.change_answer}
                          </Button>
                        )}
                        {fix && fix.kind !== "change_answer" && target && (
                          <Button variant="secondary" onClick={() => focusElementById(target)}>
                            {WARNING_FIX_LABELS[fix.kind]}
                          </Button>
                        )}
                        {linked && numberOf(linked) !== null && (
                          <>
                            <Button
                              variant="secondary"
                              onClick={async () => {
                                setError(await removeDeviation(linked));
                              }}
                            >
                              {STALE_DEVIATION_ACTION_LABELS.remove_deviation}
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() => focusElementById(deviationHeadingId(linked))}
                            >
                              {STALE_DEVIATION_ACTION_LABELS.keep_deviation}
                            </Button>
                          </>
                        )}
                        {!fix && target && (
                          <Button variant="ghost" onClick={() => focusElementById(target)}>
                            {ROOM_TEXTS.goToFieldLink}
                          </Button>
                        )}
                      </>
                    }
                  >
                    {text}
                  </Warning>
                  {openSuggestion && (
                    <RuleSuggestionCard
                      variant="review"
                      suggestion={openSuggestion}
                      deviations={deviations}
                      inspectionYear={inspectionYear}
                      onNotice={onNotice}
                    />
                  )}
                </li>
              );
            })}
          </ul>
          {error && <FormMessage message={error} />}
        </section>
      </Card>
    </>
  );
}
