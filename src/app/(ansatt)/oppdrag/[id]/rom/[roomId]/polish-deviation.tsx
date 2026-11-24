"use client";

import { useCallback, useState, type ReactNode } from "react";
import type { PolishTarget, ReportFieldChange } from "@/core/reports/types";
import { uuidv7 } from "@/shared/lib/uuid";
import { AiSuggestionGroup, type AiSuggestionGroupRow } from "@/shared/ui/ai-suggestion-group";
import { undoAfterEdit } from "@/shared/ui/ai-suggestion";
import { AiSparkIcon } from "@/shared/ui/ai-text-mark";
import { Button } from "@/shared/ui/button";
import {
  decideAiSuggestionAction,
  polishDescriptionAction,
  polishDeviationAction,
  saveFieldAction,
  type PolishActionResult,
} from "./actions";
import { useRoom } from "./room-context";
import {
  AI_ROOM_TEXTS,
  isActionError,
  polishStoppedText,
  ROOM_ACTION_MESSAGES,
  type ActionError,
} from "./room-messages";

/*
 * Språkvask i avvikskortet og på beskrivelsen (docs/funksjoner/fase2a-ki-i-veien-design.md
 * avsnitt 3 og 5, A436, A439 og A460). «Språkvask avviket» sender feltene med tekst i ett kall;
 * serveren gjør ett leverandørkall, én loggrad og vaktene per felt, så et stoppet felt ikke tar med
 * seg de andre. Svaret vises som før og etter per felt i `AiSuggestionGroup`. Bare «Bruk» endrer
 * teksten, og den lagres sammen med beslutningen (A469). Uten nett eller uten tekst går det ikke
 * noe kall; meldingen står rett ved knappen.
 *
 * Ingen tilgangslogikk her: knappen vises bare når skjermen kan endres, og serveren sjekker hver
 * handling. Teksten fra KI lagres aldri i nettleseren.
 * Støtter hovedmål: de ansatte (hele avviket med to trykk), KI i bunnen (samme kort som resten av
 * KI) og færre reklamasjoner (svar som endrer TG eller tall stoppes og forklares ved feltet).
 */

/** Ett felt som kan språkvaskes. */
export type PolishField = {
  /** Nøkkelen i lagringskøen. */
  key: string;
  label: string;
  /** Teksten i feltet nå. */
  text: string;
  /** Målet i KI-loggen, så svaret kobles til riktig felt. */
  target: PolishTarget;
  /** Lager endringen som lagres ved «Bruk» og «Angre». */
  change(value: string, base: string): ReportFieldChange;
};

type RowState = AiSuggestionGroupRow & {
  usageId: string | null;
  /** Teksten «Bruk» satte inn, så «Angre» vet om feltet er endret siden (T-0005). */
  appliedText: string | null;
};

type Call = (
  items: { requestId: string; target: PolishTarget; text: string }[],
) => Promise<PolishActionResult | ActionError>;

function sameTarget(a: PolishTarget, b: PolishTarget): boolean {
  return a.type === b.type && a.id === b.id && a.fieldKey === b.fieldKey;
}

/**
 * Tilstanden for én språkvask-knapp med kortet sitt. Gir knappen, meldingen ved knappen og kortet.
 * `fields` leses på nytt ved hvert trykk, så det er teksten som står i feltene nå som sendes.
 */
export function usePolish(input: {
  /** «språkvask av avvik 1» eller «språkvask». */
  source: string;
  label: string;
  fields(): PolishField[];
  call: Call;
  /** Knappen i kortets topplinje er `md`; den på beskrivelsen også. */
  testId: string;
}) {
  const { run, store, online, announce, room } = useRoom();
  const [rows, setRows] = useState<RowState[] | null>(null);
  const [pending, setPending] = useState<"suggestion" | "decision" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [fieldsAtCall, setFieldsAtCall] = useState<PolishField[]>([]);

  const currentText = useCallback(
    (key: string, fallback: string) => {
      const value = store.get(key)?.value;
      return typeof value === "string" ? value : fallback;
    },
    [store],
  );

  const request = useCallback(async () => {
    setMessage(null);
    if (!online) {
      setMessage(AI_ROOM_TEXTS.offline);
      announce(AI_ROOM_TEXTS.offline);
      return;
    }
    const fields = input.fields().filter((f) => f.text.replace(/[\s ]+/gu, "") !== "");
    if (fields.length === 0) {
      setMessage(AI_ROOM_TEXTS.nothingToPolish);
      announce(AI_ROOM_TEXTS.nothingToPolish);
      return;
    }
    const items = fields.map((f) => ({ requestId: uuidv7(), target: f.target, text: f.text }));
    setFieldsAtCall(fields);
    setPending("suggestion");
    setRows(
      fields.map((f) => ({
        key: f.key,
        label: f.label,
        ownText: f.text,
        sourceText: f.text,
        suggestionText: null,
        status: null,
        outcome: null,
        usageId: null,
        appliedText: null,
      })),
    );
    const result = await run(() => input.call(items));
    setPending(null);
    if (isActionError(result)) {
      setRows(null);
      setMessage(result.message);
      return;
    }
    if (result.status === "nothing_to_polish") {
      setRows(null);
      setMessage(AI_ROOM_TEXTS.nothingToPolish);
      return;
    }
    if (result.status === "too_long") {
      setRows(null);
      setMessage(AI_ROOM_TEXTS.polishTooLong(result.limit));
      return;
    }
    const answered = result.fields;
    if (answered.length > 0 && answered.every((f) => f.result.status === "ai_off")) {
      setRows(null);
      setMessage(AI_ROOM_TEXTS.aiOff);
      announce(AI_ROOM_TEXTS.aiOff);
      return;
    }
    setRows(
      fields.flatMap((f): RowState[] => {
        // Beskrivelsen kan ha fått sin rad ved lagringen rett før kallet: én rad er alltid den ene.
        const answer =
          fields.length === 1 && answered.length === 1
            ? answered[0]
            : answered.find((a) => sameTarget(a.target, f.target));
        if (!answer) return [];
        const base: RowState = {
          key: f.key,
          label: f.label,
          ownText: f.text,
          sourceText: f.text,
          suggestionText: null,
          status: null,
          outcome: null,
          usageId: null,
          appliedText: null,
        };
        switch (answer.result.status) {
          case "suggestion":
            return [
              {
                ...base,
                suggestionText: answer.result.text,
                status: "suggested",
                outcome: "ok",
                usageId: answer.result.usageId,
                aiUsageId: answer.result.usageId,
              },
            ];
          case "stopped":
            return [
              {
                ...base,
                outcome: "stopped",
                stoppedText: polishStoppedText(answer.result.guard),
                usageId: answer.result.usageId,
              },
            ];
          case "no_match":
            return [{ ...base, outcome: "no_match", usageId: answer.result.usageId }];
          case "ai_off":
            return [{ ...base, outcome: "stopped", stoppedText: AI_ROOM_TEXTS.aiOff }];
          default:
            return [{ ...base, outcome: "error" }];
        }
      }),
    );
  }, [online, announce, input, run]);

  const update = (key: string, patch: Partial<RowState>) =>
    setRows((now) => now?.map((row) => (row.key === key ? { ...row, ...patch } : row)) ?? now);

  const fieldOf = (key: string) => fieldsAtCall.find((f) => f.key === key);

  /** «Bruk» på én rad: teksten og beslutningen lagres sammen (A469). */
  const use = async (key: string): Promise<boolean> => {
    const row = rows?.find((r) => r.key === key);
    const field = fieldOf(key);
    if (!row || !field || !row.usageId || row.suggestionText === null) return false;
    const now = currentText(key, row.ownText);
    const result = await run(() =>
      saveFieldAction(room, field.change(row.suggestionText as string, now), {
        aiDecision: { usageId: row.usageId as string, decision: "accepted" },
      }),
    );
    if (isActionError(result)) {
      setMessage(result.message);
      return false;
    }
    if (result.status === "conflict") {
      setMessage(ROOM_ACTION_MESSAGES.conflict);
      return false;
    }
    update(key, { status: "accepted", appliedText: row.suggestionText });
    return true;
  };

  const decide = async (key: string, decision: "rejected" | "undo"): Promise<boolean> => {
    const row = rows?.find((r) => r.key === key);
    if (!row?.usageId) return false;
    const usageId = row.usageId;
    const result = await run(() => decideAiSuggestionAction(room, { usageId, decision }));
    if (isActionError(result)) {
      setMessage(result.message);
      return false;
    }
    return true;
  };

  const withDecision = async (work: () => Promise<void>) => {
    setPending("decision");
    setMessage(null);
    try {
      await work();
    } finally {
      setPending(null);
    }
  };

  const onUse = (key: string) => void withDecision(async () => void (await use(key)));

  const onKeep = (key: string) =>
    void withDecision(async () => {
      if (await decide(key, "rejected")) update(key, { status: "rejected" });
    });

  const onUndo = (key: string) =>
    void withDecision(async () => {
      const row = rows?.find((r) => r.key === key);
      const field = fieldOf(key);
      if (!row || !field) return;
      if (row.status === "accepted" && row.appliedText !== null) {
        const now = currentText(key, row.appliedText);
        // Er feltet endret etter «Bruk», settes bare statusen tilbake (T-0005).
        if (undoAfterEdit(now, row.appliedText) === "restore") {
          const restored = await run(() =>
            saveFieldAction(room, field.change(row.ownText, row.appliedText as string)),
          );
          if (isActionError(restored)) {
            setMessage(restored.message);
            return;
          }
        }
      }
      if (await decide(key, "undo")) {
        update(key, { status: "suggested", appliedText: null });
      }
    });

  const openKeys = () =>
    (rows ?? [])
      .filter(
        (r) =>
          r.status === "suggested" &&
          r.outcome === "ok" &&
          r.suggestionText !== null &&
          r.suggestionText.trim() !== r.ownText.trim() &&
          currentText(r.key, r.ownText) === r.sourceText,
      )
      .map((r) => r.key);

  const onUseAll = () =>
    void withDecision(async () => {
      for (const key of openKeys()) {
        if (!(await use(key))) return;
      }
    });

  const onKeepAll = () =>
    void withDecision(async () => {
      for (const key of openKeys()) {
        if (await decide(key, "rejected")) update(key, { status: "rejected" });
      }
    });

  // Radene viser teksten som står i feltet nå, så «Bruk» forsvinner når feltet er endret (T-0004).
  const shownRows: AiSuggestionGroupRow[] | null =
    rows?.map((row) => ({
      ...row,
      ownText: row.status === "accepted" ? row.ownText : currentText(row.key, row.ownText ?? ""),
    })) ?? null;

  const button: ReactNode = (
    <Button
      variant="secondary"
      size="md"
      className="min-w-11"
      disabled={pending === "suggestion"}
      aria-describedby={message ? `${input.testId}-message` : undefined}
      onClick={() => void request()}
      data-ai-control="polish"
      data-testid={input.testId}
    >
      <AiSparkIcon className="text-ai-700" />
      {pending === "suggestion" ? AI_ROOM_TEXTS.polishing : input.label}
    </Button>
  );

  const messageNode: ReactNode = message ? (
    <p
      id={`${input.testId}-message`}
      role="status"
      aria-live="polite"
      className="text-sm text-slate-900"
    >
      {message}
    </p>
  ) : null;

  const card: ReactNode = shownRows ? (
    <AiSuggestionGroup
      source={input.source}
      rows={shownRows}
      pending={pending}
      online={online}
      aiEnabled
      onUse={onUse}
      onKeep={onKeep}
      onUndo={onUndo}
      onUseAll={onUseAll}
      onKeepAll={onKeepAll}
      onNewSuggestion={() => void request()}
    />
  ) : null;

  return { button, message: messageNode, card };
}

/** «Språkvask avviket»: avvik, årsak, konsekvens og tiltakene med tekst i ett kall. */
export function usePolishDeviation(input: {
  deviationId: string;
  number: number;
  fields(): PolishField[];
}) {
  const { room } = useRoom();
  return usePolish({
    source: AI_ROOM_TEXTS.polishSource(input.number),
    label: AI_ROOM_TEXTS.polishDeviation,
    fields: input.fields,
    testId: `polish-deviation-${input.deviationId}`,
    call: (items) =>
      polishDeviationAction(room, {
        deviationId: input.deviationId,
        items: items.flatMap((item) =>
          item.target.type === "checkpoint_result" ? [] : [{ ...item, target: item.target }],
        ),
      }),
  });
}

/** «Språkvask» på beskrivelsen ved punktet: eget kall, én rad. */
export function usePolishDescription(input: { checkpointKey: string; fields(): PolishField[] }) {
  const { room } = useRoom();
  return usePolish({
    source: AI_ROOM_TEXTS.polishDescriptionSource,
    label: AI_ROOM_TEXTS.polish,
    fields: input.fields,
    testId: `polish-description-${input.checkpointKey.replace(/[^A-Za-z0-9_-]/g, "-")}`,
    call: async (items) => {
      const item = items[0];
      if (!item) return { status: "nothing_to_polish" };
      return polishDescriptionAction(room, {
        requestId: item.requestId,
        checkpointKey: input.checkpointKey,
        text: item.text,
      });
    },
  });
}
