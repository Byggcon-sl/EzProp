"use client";

import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from "react";
import type { MergeValues, PhraseUsageCount } from "@/core/reports/logic";
import type { RoomRef, RoomTemplateDocument } from "@/core/reports/types";
import type { ChangeBuilder, FieldEntry, FieldSaveStore, FieldValidator } from "./field-save-store";
import type { ActionError } from "./room-messages";
import type { RoomDocumentIndex } from "./room-model";

/*
 * Det alle delene av skjermen for badet deler: rommet, lagringskøen, maldokumentet og
 * handlingene som flytter fokus, leser opp og bytter punkt. Ingen tilgangslogikk her: `canEdit`
 * kommer fra serveren og styrer bare hva som vises; serveren sjekker hver handling.
 */

/** En linje med «Angre» til punktet forlates (design avsnitt 9 og 12). */
export type UndoLine =
  | { kind: "deviation"; id: string; deviationId: string; number: number }
  | { kind: "tgiu"; id: string };

export type RoomContextValue = {
  room: RoomRef;
  canEdit: boolean;
  store: FieldSaveStore;
  doc: RoomDocumentIndex;
  /**
   * Kjører en handling: lagrer det som venter først, kaller serveren og tar inn det som er regnet
   * på nytt. Nettfeil blir en melding, aldri et unntak.
   */
  run<T extends { status: string }>(call: () => Promise<T | ActionError>): Promise<T | ActionError>;
  /** Leser opp i statusområdet på punktet. */
  announce(text: string): void;
  /** Legger fokus på elementet med id-en etter neste tegning. */
  focus(id: string): void;
  /** Åpner et punkt uten ny innlasting. `focusId` får fokus i stedet for overskriften. */
  openCheckpoint(checkpointKey: string, options?: { focusId?: string; announce?: string }): void;
  /** «Fjern avviket»: myk sletting, angre-linje og fokus på «Angre». Gir feilmelding eller `null`. */
  removeDeviation(deviationId: string): Promise<string | null>;
  undoLines: UndoLine[];
  addUndo(line: UndoLine): void;
  removeUndo(id: string): void;
  /** Nettleseren har nett. Uten nett gir «Forslag» tekstsøket, og KI-knappene sier fra (A439). */
  online: boolean;
  /** Rommets del av den låste malen, for tekstsøket uten KI (A485). */
  document: RoomTemplateDocument;
  /** «Mest brukt» (A468): antall valg per kandidat i organisasjonen, lastet med badet. */
  phraseUsage: readonly PhraseUsageCount[];
  /** Flettefeltene for et avvik på punktet, fra svarene slik de står nå. */
  mergeValuesFor(checkpointKey: string, measurementValue: number | null): MergeValues;
};

export const RoomContext = createContext<RoomContextValue | null>(null);

export function useRoom(): RoomContextValue {
  const value = useContext(RoomContext);
  if (!value) throw new Error("useRoom brukes utenfor RoomContext");
  return value;
}

export type FieldHandle = {
  entry: FieldEntry;
  edit(value: unknown, delayMs?: number): void;
  commit(): void;
  retry(): void;
  takeLatest(): void;
  keepMine(): void;
};

/** Ventetid etter siste tastetrykk før tekst lagres (design avsnitt 15). */
export const TEXT_SAVE_DELAY_MS = 800;

/**
 * Et felt i lagringskøen. Verdien står i køen, så den overlever bytte av punkt. Ny verdi fra
 * serveren tas bare inn når feltet ikke har ulagrede endringer.
 */
export function useField(
  key: string,
  serverValue: unknown,
  build: ChangeBuilder,
  options: { rowId?: string | null; validate?: FieldValidator | null } = {},
): FieldHandle {
  const { store } = useRoom();
  store.ensure(key, serverValue, build, options);
  const entry = useSyncExternalStore(
    store.subscribe,
    () => store.get(key) as FieldEntry,
    () => store.get(key) as FieldEntry,
  );
  const serverJson = JSON.stringify(serverValue ?? null);
  const rowId = options.rowId;
  useEffect(() => {
    store.syncServer(key, JSON.parse(serverJson), rowId);
  }, [store, key, serverJson, rowId]);

  const edit = useCallback(
    (value: unknown, delayMs = TEXT_SAVE_DELAY_MS) => store.edit(key, value, delayMs),
    [store, key],
  );
  const commit = useCallback(() => void store.commit(key), [store, key]);
  const retry = useCallback(() => void store.retry(key), [store, key]);
  const takeLatest = useCallback(() => store.takeLatest(key), [store, key]);
  const keepMine = useCallback(() => void store.keepMine(key), [store, key]);
  return { entry, edit, commit, retry, takeLatest, keepMine };
}
