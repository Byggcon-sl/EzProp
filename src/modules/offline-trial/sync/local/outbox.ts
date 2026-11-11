/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Endringskøen vi eier selv. Rene funksjoner over `OutboxState`
 * etter `OutboxMachine` i `sync/types.ts`: ingen nettleser-API, ingen SDK. Lageret (`store.ts`)
 * skriver tilstanden til objektlageret `outbox` og sender buntene.
 *
 * Regelen som hindrer tap: en bunt tas ut av køen bare når serveren svarte 200 (`ackBatch`). Det
 * som skrives mens en bunt er underveis, legges som ny operasjon og fjernes aldri av svaret på
 * den gamle bunten.
 *
 * Lagt til side (A181): svarer serveren 400 og peker på én endring, merkes den med `setAside` og
 * resten sendes med en gang (`setAsideBatch`). En endring lagt til side slettes aldri, sendes ikke,
 * teller ikke i ventetallet og flettes aldri sammen med nye endringer. Den beskytter feltet
 * (`pendingKeys`) til en senere endring på samme rad har fått 200 (`ackBatch` setter `resolved`).
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

/** Endringen er lagt til side etter 400 (løst eller ikke). Sendes aldri og flettes aldri. */
export function isSetAside(entry: OutboxEntry): boolean {
  return entry.setAside !== undefined;
}

/** Lagt til side og ikke løst: beskytter feltet og vises i statuslinjen. */
export function isUnresolvedSetAside(entry: OutboxEntry): boolean {
  return entry.setAside !== undefined && entry.setAside.resolved !== true;
}

export const enqueue: OutboxMachine["enqueue"] = (state, entry) => {
  const index = state.entries.findIndex(
    (existing) =>
      existing.table === entry.table &&
      existing.id === entry.id &&
      !isInFlight(state, existing.seq) &&
      !isSetAside(existing),
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
  const batch = [...state.entries]
    .filter((entry) => !isSetAside(entry))
    .sort((a, b) => a.seq - b.seq)
    .slice(0, Math.max(0, limit));
  if (batch.length === 0) return null;
  return { state: { ...state, inFlight: batch.map((entry) => entry.seq) }, batch };
};

/** Nøkkelen til hver oppføring. En PATCH kan mangle nøkkelkolonnene; da lånes de fra samme rad. */
function keysOf(entries: readonly OutboxEntry[], keyOf: LocalRowKey): Map<number, string> {
  const identity = new Map<string, LocalRow>();
  for (const entry of entries) {
    const known = identity.get(`${entry.table}/${entry.id}`) ?? {};
    identity.set(`${entry.table}/${entry.id}`, { ...known, ...entry.data });
  }
  const keys = new Map<number, string>();
  for (const entry of entries) {
    const row = { ...identity.get(`${entry.table}/${entry.id}`), ...entry.data, id: entry.id };
    keys.set(entry.seq, keyOf(entry.table, row));
  }
  return keys;
}

export const ackBatch: OutboxMachine["ackBatch"] = (state) => {
  if (state.inFlight === null) return state;
  const sent = new Set(state.inFlight);
  const keys = keysOf(state.entries, localRowKey);
  const sentKeys = new Set(
    state.entries.filter((entry) => sent.has(entry.seq)).map((entry) => keys.get(entry.seq)),
  );
  return {
    ...state,
    entries: state.entries
      .filter((entry) => !sent.has(entry.seq))
      .map((entry) =>
        isUnresolvedSetAside(entry) && sentKeys.has(keys.get(entry.seq))
          ? { ...entry, setAside: { ...entry.setAside!, resolved: true } }
          : entry,
      ),
    inFlight: null,
  };
};

/** Oppføringene lagt til side som ble løst mellom `before` og `after` (skrives til lageret). */
export function newlyResolved(before: OutboxState, after: OutboxState): OutboxEntry[] {
  const open = new Set(before.entries.filter(isUnresolvedSetAside).map((entry) => entry.seq));
  return after.entries.filter((entry) => open.has(entry.seq) && entry.setAside?.resolved === true);
}

/** Endringen serveren pekte på i et 400-svar (`endring` i kroppen). */
export interface RejectedChange {
  table: string;
  id: string;
}

/** Leser `endring` fra kroppen i et 400-svar. Alt som ikke har `table` og `id` som tekst gir null. */
export function rejectedChangeOf(body: unknown): RejectedChange | null {
  if (typeof body !== "object" || body === null) return null;
  const change = (body as { endring?: unknown }).endring;
  if (typeof change !== "object" || change === null) return null;
  const { table, id } = change as { table?: unknown; id?: unknown };
  if (typeof table !== "string" || typeof id !== "string") return null;
  return { table, id };
}

/**
 * Serveren svarte 400 på bunten som er underveis (A181):
 * - `rejected` finnes i bunten: alle oppføringer i bunten med samme tabell og id legges til side,
 *   resten legges tilbake og kan sendes med en gang.
 * - `rejected` finnes ikke i bunten: som `keepBatch`, ingenting legges til side.
 * - `rejected` er null og bunten har én oppføring: den legges til side.
 * - `rejected` er null og bunten har flere: som `keepBatch` (ingen sending én og én).
 * `setAside` er oppføringene som ble lagt til side (skrives til lageret, slettes aldri).
 */
export function setAsideBatch(
  state: OutboxState,
  rejected: RejectedChange | null,
  at: string,
): { state: OutboxState; setAside: OutboxEntry[] } {
  if (state.inFlight === null) return { state, setAside: [] };
  const sent = new Set(state.inFlight);
  const batch = state.entries.filter((entry) => sent.has(entry.seq));
  const targets = new Set(
    (rejected === null
      ? batch.length === 1
        ? batch
        : []
      : batch.filter((entry) => entry.table === rejected.table && entry.id === rejected.id)
    ).map((entry) => entry.seq),
  );
  if (targets.size === 0) return { state: keepBatch(state), setAside: [] };
  const setAside: OutboxEntry[] = [];
  const entries = state.entries.map((entry) => {
    if (!targets.has(entry.seq)) return entry;
    const marked: OutboxEntry = { ...entry, setAside: { at } };
    setAside.push(marked);
    return marked;
  });
  return { state: { ...state, entries, inFlight: null }, setAside };
}

export const keepBatch: OutboxMachine["keepBatch"] = (state) => {
  if (state.inFlight === null) return state;
  return { ...state, inFlight: null };
};

export const pendingKeys: OutboxMachine["pendingKeys"] = (state, keyOf) => {
  // Lagt til side og løst beskytter ikke lenger feltet; lagt til side og ikke løst gjør det.
  const keyBySeq = keysOf(state.entries, keyOf);
  const keys = new Set<string>();
  for (const entry of state.entries) {
    if (isSetAside(entry) && !isUnresolvedSetAside(entry)) continue;
    keys.add(keyBySeq.get(entry.seq)!);
  }
  return keys;
};

/** Ventetallet: endringer som venter på å bli sendt. Lagt til side teller ikke. */
export function pendingCount(state: OutboxState): number {
  return state.entries.filter((entry) => !isSetAside(entry)).length;
}

/** Endringene lagt til side og ikke løst, i `seq`-rekkefølge (for statuslinjen). */
export function unresolvedSetAside(state: OutboxState): OutboxEntry[] {
  return state.entries.filter(isUnresolvedSetAside);
}

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
