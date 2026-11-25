"use client";

import type { ReactNode } from "react";
import {
  appendNoteToDeviationText,
  canReplaceDeviationTextWithNote,
  replaceDeviationTextWithNote,
} from "@/core/reports/logic";
import { Button } from "@/shared/ui/button";
import type { NoteOffer as NoteOfferState } from "./outcome-match-model";
import { useRoom } from "./room-context";
import { OUTCOME_MATCH_TEXTS } from "./room-messages";
import { deviationFieldKey } from "./room-model";

/*
 * Notatet etter valget (skisse for «Skriv det du ser», avsnitt 6, A556 og A557). Står i avvikskortet
 * rett under avviksteksten, bare for avviket som nettopp ble laget fra et notat. «Legg notatet til»
 * og «Bruk bare notatet» lagres gjennom den vanlige feltlagringen; «Angre» er en ny vanlig lagring
 * med teksten som stod før, uten tidsgrense. Notatet er takstmannens egne ord, så flaten har ingen
 * KI-tone. Notatet lever bare i rommets minne.
 * Hovedmål: færre reklamasjoner (malens tekst med måling eller årstall forsvinner aldri uten at
 * takstmannen ber om det) og de ansatte (ett trykk legger notatet til).
 */

export const noteOfferUndoId = (deviationId: string) => `note-offer-${deviationId}-undo`;
export const noteOfferAddId = (deviationId: string) => `note-offer-${deviationId}-add`;

export function NoteOffer({
  offer,
  deviationId,
  templateDeviationText,
  serverValue,
  polishButton,
}: {
  offer: NoteOfferState;
  deviationId: string;
  /** Malens avvikstekst for utfallet, med flettefeltene (`outcomes.deviation_text`). */
  templateDeviationText: string | null;
  /** Avviksteksten fra serveren, når feltet ikke er endret i lagringskøen. */
  serverValue: string | null;
  /** «Språkvask avviket», flyttet hit etter trykk (skisse avsnitt 6). */
  polishButton: ReactNode;
}) {
  const { store, dispatchOutcomeNote, focus, announce } = useRoom();
  const fieldKey = deviationFieldKey(deviationId, "deviation_text");
  const canUseOnly = canReplaceDeviationTextWithNote(templateDeviationText);
  const headingId = `note-offer-${deviationId}-heading`;

  const currentText = (): string => {
    const value = store.get(fieldKey)?.value;
    return typeof value === "string" ? value : (serverValue ?? "");
  };

  const apply = (next: string, phase: "added" | "used") => {
    const original = currentText();
    store.edit(fieldKey, next, 0);
    dispatchOutcomeNote({ type: "offer_changed", phase, original });
    announce(phase === "added" ? OUTCOME_MATCH_TEXTS.noteAdded : OUTCOME_MATCH_TEXTS.noteUsed);
    focus(noteOfferUndoId(deviationId));
  };

  const add = () => apply(appendNoteToDeviationText(currentText(), offer.note), "added");
  const useOnly = () => {
    const next = replaceDeviationTextWithNote(templateDeviationText, offer.note);
    if (next !== null) apply(next, "used");
  };
  const undo = () => {
    store.edit(fieldKey, offer.original ?? "", 0);
    dispatchOutcomeNote({ type: "offer_changed", phase: "restored" });
    announce(OUTCOME_MATCH_TEXTS.templateRestored);
    focus(noteOfferAddId(deviationId));
  };

  if (offer.phase === "added" || offer.phase === "used") {
    return (
      <div data-testid="note-offer" className="space-y-3">
        <p role="status" className="text-sm text-slate-900">
          {offer.phase === "added" ? OUTCOME_MATCH_TEXTS.noteAdded : OUTCOME_MATCH_TEXTS.noteUsed}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            id={noteOfferUndoId(deviationId)}
            variant="secondary"
            size="md"
            data-testid="note-offer-undo"
            onClick={undo}
          >
            {OUTCOME_MATCH_TEXTS.undo}
          </Button>
          {polishButton}
        </div>
      </div>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid="note-offer"
      className="space-y-3 rounded-card border border-line bg-snow p-4"
    >
      <h4 id={headingId} className="text-base font-semibold text-slate-900">
        {OUTCOME_MATCH_TEXTS.noteHeading}
      </h4>
      {offer.phase === "restored" && (
        <p role="status" className="text-sm text-slate-900">
          {OUTCOME_MATCH_TEXTS.templateRestored}
        </p>
      )}
      <p className="text-base break-words text-slate-900">«{offer.note}»</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          id={noteOfferAddId(deviationId)}
          size="lg"
          data-testid="note-offer-add"
          onClick={add}
        >
          {OUTCOME_MATCH_TEXTS.addNote}
        </Button>
        {canUseOnly && (
          <Button variant="secondary" size="md" data-testid="note-offer-only" onClick={useOnly}>
            {OUTCOME_MATCH_TEXTS.useNoteOnly}
          </Button>
        )}
      </div>
      {!canUseOnly && (
        <p className="text-sm text-slate-700">{OUTCOME_MATCH_TEXTS.noteOnlyBlocked}</p>
      )}
    </section>
  );
}
