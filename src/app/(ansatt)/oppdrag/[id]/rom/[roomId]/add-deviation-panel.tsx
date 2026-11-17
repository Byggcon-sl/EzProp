"use client";

import { useMemo, useRef, useState } from "react";
import { searchOutcomes, type OutcomeSearchHit } from "@/core/reports/logic";
import type { AddDeviationInput, RoomTemplateDocument } from "@/core/reports/types";
import { Button } from "@/shared/ui/button";
import { FormMessage, Input } from "@/shared/ui/form";
import { Warning } from "@/shared/ui/warning";
import { uuidv7 } from "@/shared/lib/uuid";
import { addDeviationAction } from "./actions";
import { useRoom } from "./room-context";
import { isActionError, ROOM_TEXTS } from "./room-messages";
import {
  deviationHeadingId,
  deviationTgChoiceId,
  outcomeName,
  outcomeTgText,
  SEARCH_INPUT_ID,
} from "./room-model";

/*
 * «+ Avvik» (design avsnitt 16, A382). Spørsmålene fra malen for punktet med utfallene som knapper;
 * ett trykk lager avviket med standardtekstene fra malen. Søket kjøres i nettleseren over
 * maldokumentet som alt er lastet (ingen KI, ingen serverkall) og viser treffene som en synlig
 * liste med knapper, ikke en combobox. Pil ned fra søkefeltet går til første treff, pil opp/ned
 * mellom treffene, Enter velger. Treff på et annet punkt åpner det punktet uten ny innlasting.
 * Støtter hovedmål: de ansatte (raskt å finne riktig avvik) og færre reklamasjoner (standardtekst).
 */

export const ADD_DEVIATION_TEXTS = {
  heading: "Legg til avvik",
  search: "Søk etter avvik i badet",
  hits: (n: number) => (n === 1 ? "1 treff" : `${n} treff`),
  noHits: "Ingen avvik passer.",
  cancel: "Avbryt",
  tgiuConflict: (tg: string) =>
    `Punktet har TGIU. Et avvik med ${tg} kan ikke stå sammen med TGIU.`,
  removeTgiuAndAdd: "Fjern TGIU og legg til avviket",
  keepTgiu: "Behold TGIU",
} as const;

function tgOfKind(kind: OutcomeSearchHit["outcomeKind"]): 2 | 3 | null {
  return kind === "tg2" ? 2 : kind === "tg3" ? 3 : null;
}

export function AddDeviationPanel({
  checkpointKey,
  document,
  onClose,
}: {
  checkpointKey: string;
  document: RoomTemplateDocument;
  onClose(): void;
}) {
  const { doc, run, room, focus, announce, openCheckpoint } = useRoom();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{
    hit: OutcomeSearchHit;
    input: AddDeviationInput;
  } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const hits = useMemo(
    () => (query.trim() === "" ? [] : searchOutcomes(document, query)),
    [document, query],
  );

  const add = async (hit: OutcomeSearchHit, input?: AddDeviationInput) => {
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
      setConflict({ hit, input: payload });
      focus("add-deviation-conflict");
      return;
    }
    if (result.status !== "saved") return;
    const tgText = hit.outcomeKind === "hms" ? null : payload.tg ? `TG${payload.tg}` : null;
    const target =
      hit.outcomeKind === "choose_tg2_tg3"
        ? deviationTgChoiceId(payload.id)
        : deviationHeadingId(payload.id);
    const message = ROOM_TEXTS.deviationAdded(tgText);
    onClose();
    if (hit.checkpointKey !== checkpointKey) {
      openCheckpoint(hit.checkpointKey, { focusId: target, announce: message });
    } else {
      focus(target);
      announce(message);
    }
  };

  const moveFocus = (event: React.KeyboardEvent, index: number) => {
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("button");
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

  const outcomeButton = (hit: OutcomeSearchHit, index: number, showCheckpoint: boolean) => (
    <Button
      variant="secondary"
      className="h-auto min-h-11 max-w-full py-2 text-left whitespace-normal"
      disabled={busy}
      onKeyDown={(event) => moveFocus(event, index)}
      onClick={() => void add(hit)}
    >
      <span className="min-w-0 break-words">
        {outcomeName({ deviation_text: hit.deviationText })} · {outcomeTgText(hit.outcomeKind)}
        {showCheckpoint && hit.checkpointKey !== checkpointKey ? ` · ${hit.checkpointName}` : ""}
      </span>
    </Button>
  );

  const ownHits = searchOutcomes(document, "").filter((hit) => hit.checkpointKey === checkpointKey);

  return (
    <section aria-labelledby="add-deviation-heading" className="space-y-4 rounded-card bg-sand p-5">
      <h3 id="add-deviation-heading" className="text-lg font-semibold text-slate-900">
        {ADD_DEVIATION_TEXTS.heading}
      </h3>
      <div className="space-y-1.5">
        <label htmlFor={SEARCH_INPUT_ID} className="block text-sm font-medium text-slate-700">
          {ADD_DEVIATION_TEXTS.search}
        </label>
        <Input
          id={SEARCH_INPUT_ID}
          type="search"
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              listRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
            } else if (event.key === "Escape") {
              onClose();
            }
          }}
        />
      </div>

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
                void add(pending.hit, { ...pending.input, tgiuChoice: "remove_tgiu" });
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

      {query.trim() !== "" ? (
        <div className="space-y-2">
          <p role="status" aria-live="polite" className="text-sm text-slate-700">
            {hits.length === 0 ? ADD_DEVIATION_TEXTS.noHits : ADD_DEVIATION_TEXTS.hits(hits.length)}
          </p>
          <ul ref={listRef} className="space-y-2">
            {hits.map((hit, index) => (
              <li key={`${hit.checkpointKey}/${hit.questionKey}/${hit.outcomeKey}`}>
                {outcomeButton(hit, index, true)}
              </li>
            ))}
          </ul>
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
                      {outcomeButton(hit, -1, false)}
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
        <Button variant="ghost" onClick={onClose}>
          {ADD_DEVIATION_TEXTS.cancel}
        </Button>
      </div>
    </section>
  );
}
