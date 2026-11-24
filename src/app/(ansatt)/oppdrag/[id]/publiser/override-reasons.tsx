"use client";

import {
  formatWholeNumber,
  PUBLISH_OVERRIDE_REASON_CHECK_MESSAGES,
  PUBLISH_OVERRIDE_REASON_CODES,
  PUBLISH_OVERRIDE_REASON_LABELS,
  PUBLISH_OVERRIDE_REASON_MAX_CHARS,
} from "@/core/reports/logic";
import type { PublishOverrideReasonCode } from "@/db/schema";
import { Button } from "@/shared/ui/button";
import { ChoiceButtons } from "@/shared/ui/choice-buttons";
import { Field, Textarea } from "@/shared/ui/form";
import { overrideError, type OverrideState } from "./publish-model";
import { PUBLISH_TEXTS } from "./publish-texts";

/*
 * Grunnene når en sperre krysses bort (F1, docs/funksjoner/fase2a-publisering-badet-design.md
 * avsnitt 8). Fire faste grunner rett under funnet, ingen dialog og ingen nedtrekk. «Annet» krever
 * tekst (minst 10 tegn); til de andre kan en kort tekst legges til. Kontrollen er den samme rene
 * funksjonen som serveren bruker (`checkPublishOverrideReason`). Ingenting lagres før «Publiser».
 * Støtter hovedmål: færre reklamasjoner (grunnen står i utgivelsen) og de ansatte (ett trykk).
 */

/** Tegnteller fra 800 tegn (design avsnitt 8). */
const COUNTER_FROM = 800;

export function reasonGroupId(baseId: string): string {
  return `${baseId}-reason`;
}

export function reasonTextId(baseId: string): string {
  return `${baseId}-reason-text`;
}

export function OverrideReasons({
  baseId,
  state,
  onChange,
}: {
  baseId: string;
  state: OverrideState;
  onChange: (next: OverrideState) => void;
}) {
  const groupId = reasonGroupId(baseId);
  const textId = reasonTextId(baseId);
  const error = state.showError ? overrideError(state) : null;
  const reasonMissing = state.reasonCode === null;
  const isOther = state.reasonCode === "other";
  const length = [...state.text].length;

  const select = (code: string) => {
    const reasonCode = code as PublishOverrideReasonCode;
    onChange({
      ...state,
      reasonCode,
      textOpen: state.textOpen || reasonCode === "other",
      showError: false,
    });
    if (reasonCode === "other") {
      requestAnimationFrame(() => document.getElementById(textId)?.focus());
    }
  };

  return (
    <div className="mt-3 space-y-3">
      <ChoiceButtons
        id={groupId}
        legend={PUBLISH_TEXTS.reasonLegend}
        options={PUBLISH_OVERRIDE_REASON_CODES.map((code) => ({
          value: code,
          label: PUBLISH_OVERRIDE_REASON_LABELS[code],
        }))}
        value={state.reasonCode}
        onChange={select}
        hint={
          reasonMissing && !error
            ? PUBLISH_OVERRIDE_REASON_CHECK_MESSAGES.reason_required
            : undefined
        }
        error={error && reasonMissing ? error : undefined}
      />
      {state.textOpen ? (
        <Field
          label={isOther ? PUBLISH_TEXTS.reasonTextLabel : PUBLISH_TEXTS.reasonTextOptionalLabel}
          htmlFor={textId}
          hint={
            <>
              {isOther ? PUBLISH_TEXTS.reasonHintOther : PUBLISH_TEXTS.reasonHint}
              {length >= COUNTER_FROM && (
                <span className="ml-2">
                  {PUBLISH_TEXTS.charCount(
                    formatWholeNumber(length),
                    formatWholeNumber(PUBLISH_OVERRIDE_REASON_MAX_CHARS),
                  )}
                </span>
              )}
            </>
          }
          error={error && !reasonMissing ? error : undefined}
        >
          <Textarea
            id={textId}
            required={isOther}
            className="min-h-24 py-2"
            value={state.text}
            onChange={(event) => onChange({ ...state, text: event.target.value })}
            onBlur={() => onChange({ ...state, showError: true })}
          />
        </Field>
      ) : (
        <Button
          variant="ghost"
          onClick={() => {
            onChange({ ...state, textOpen: true });
            requestAnimationFrame(() => document.getElementById(textId)?.focus());
          }}
        >
          {PUBLISH_TEXTS.addExplanation}
        </Button>
      )}
    </div>
  );
}
