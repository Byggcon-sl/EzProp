/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Endringskøen vi eier selv (ElectricSQL synker bare lesing). Rene funksjoner over `OutboxState`
 * etter `OutboxMachine` i `sync/types.ts`: ingen nettleser-API, ingen SDK. Lageret (`store.ts`)
 * skriver tilstanden til objektlageret `outbox` og sender buntene.
 *
 * Regelen som hindrer tap: en bunt tas ut av køen bare når serveren svarte 200 (`ackBatch`). Det
 * som skrives mens en bunt er underveis, legges som ny operasjon og fjernes aldri av svaret på
 * den gamle bunten. Kan gjenbrukes av kandidat 3 (egenbygd).
 */
import { TRIAL_SYNC_LIMITS } from "../../server/types";
import type { TrialTableName } from "../local-columns";
import {
  RETRY_DELAY_MAX_MS,
  RETRY_DELAY_MIN_MS,
  type LocalRow,
  type LocalRowKey,
  type OutboxEntry,
  type OutboxMachine,
  type OutboxState,
  type RetryDelayMs,
} from "../types";
import type { OutboxBatchBody } from "./types";

/** Største bunt serveren tar imot (500). */
export const MAX_OPERATIONS_PER_BATCH = TRIAL_SYNC_LIMITS.maxOperationsPerBatch;

/** Nøkkelen en rad kjennes igjen på lokalt: svar på `trial_form_id:field_key`, ellers `id`. */
export const localRowKey: LocalRowKey = (table: TrialTableName, row: LocalRow): string => {
  if (table === "trial_answers") return `${String(row.trial_form_id)}:${String(row.field_key)}`;
  return String(row.id);
};

/** Ny kø, eventuelt fra det som ligger lagret. `nextSeq` er alltid større enn alle lagrede `seq`. */
export function createOutboxState(entries: readonly OutboxEntry[] = [], nextSeq = 1): OutboxState {
  const sorted = [...entries].sort((a, b) => a.seq - b.seq);
  const highest = sorted.reduce((max, entry) => Math.max(max, entry.seq), 0);
  return { entries: sorted, nextSeq: Math.max(nextSeq, highest + 1), inFlight: null };
}

function isInFlight(state: OutboxState, seq: number): boolean {
  return state.inFlight !== null && state.inFlight.includes(seq);
}

export const enqueue: OutboxMachine["enqueue"] = (state, entry) => {
  const index = state.entries.findIndex(
    (existing) =>
      existing.table === entry.table &&
      existing.id === entry.id &&
      !isInFlight(state, existing.seq),
  );
  if (index === -1) {
    const added: OutboxEntry = { ...entry, data: { ...entry.data }, seq: state.nextSeq };
    return { ...state, entries: [...state.entries, added], nextSeq: state.nextSeq + 1 };
  }
  // Koalesering: samme rad flettes inn i operasjonen som venter, med opprinnelig seq.
  // PUT vinner over PATCH, så en ny rad alltid sendes med alle kolonner.
  const existing = state.entries[index]!;
  const merged: OutboxEntry = {
    seq: existing.seq,
    op: existing.op === "PUT" || entry.op === "PUT" ? "PUT" : "PATCH",
    table: existing.table,
    id: existing.id,
    data: { ...existing.data, ...entry.data },
  };
  const entries = [...state.entries];
  entries[index] = merged;
  return { ...state, entries };
};

export const takeBatch: OutboxMachine["takeBatch"] = (state, limit) => {
  if (state.inFlight !== null) return null;
  const batch = [...state.entries].sort((a, b) => a.seq - b.seq).slice(0, Math.max(0, limit));
  if (batch.length === 0) return null;
  return { state: { ...state, inFlight: batch.map((entry) => entry.seq) }, batch };
};

export const ackBatch: OutboxMachine["ackBatch"] = (state) => {
  if (state.inFlight === null) return state;
  const sent = new Set(state.inFlight);
  return {
    ...state,
    entries: state.entries.filter((entry) => !sent.has(entry.seq)),
    inFlight: null,
  };
};

export const keepBatch: OutboxMachine["keepBatch"] = (state) => {
  if (state.inFlight === null) return state;
  return { ...state, inFlight: null };
};

export const pendingKeys: OutboxMachine["pendingKeys"] = (state, keyOf) => {
  // En PATCH kan mangle nøkkelkolonnene; da lånes de fra en annen operasjon på samme rad.
  const identity = new Map<string, LocalRow>();
  for (const entry of state.entries) {
    const known = identity.get(`${entry.table}/${entry.id}`) ?? {};
    identity.set(`${entry.table}/${entry.id}`, { ...known, ...entry.data });
  }
  const keys = new Set<string>();
  for (const entry of state.entries) {
    const row = { ...identity.get(`${entry.table}/${entry.id}`), ...entry.data, id: entry.id };
    keys.add(keyOf(entry.table, row));
  }
  return keys;
};

/** Bare 200 slipper bunten. Alt annet (også 201, 204 og nettverksfeil) beholder den. */
export function shouldAckBatch(status: number | undefined): boolean {
  return status === 200;
}

/** Ventetid før neste forsøk: 5 s, 10 s, 20 s, 40 s, så 60 s. */
export const retryDelayMs: RetryDelayMs = (attempt) => {
  const step = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  return Math.min(RETRY_DELAY_MIN_MS * 2 ** Math.min(step, 16), RETRY_DELAY_MAX_MS);
};

/** Kroppen til `POST /api/prove/synk/endringer` (uten `seq`). */
export const outboxBatchBody: OutboxBatchBody = (organizationId, batch) => ({
  organizationId,
  operations: batch.map(({ op, table, id, data }) => ({ op, table, id, data })),
});
