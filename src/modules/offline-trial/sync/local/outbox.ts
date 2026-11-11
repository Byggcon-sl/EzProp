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
 * Funn T-0001: svarer serveren 400 og peker på én endring, legges den til side (`setAsideBatch`):
 * merket `setAside` på oppføringen, aldri slettet. Resten sendes videre med en gang.
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
  type TrialRejectedChange,
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

/** Lagt til side etter 400 (løst eller ikke). Slike oppføringer sendes aldri igjen. */
export function isSetAside(entry: OutboxEntry): boolean {
  return entry.setAside !== undefined;
}

/** Lagt til side og ikke løst av en senere endring: beskytter feltet og vises i statuslinjen. */
function isUnresolvedSetAside(entry: OutboxEntry): boolean {
  return entry.setAside !== undefined && entry.setAside.resolved !== true;
}

/**
 * Oppføringen `enqueue` vil flette inn i for (tabell, id): ikke underveis og ikke lagt til side.
 * `trial-store.ts` bruker den for å finne oppføringen som skal lagres etter `enqueue`.
 */
export function openEntryFor(
  state: OutboxState,
  table: OutboxEntry["table"],
  id: string,
): OutboxEntry | undefined {
  return state.entries.find(
    (entry) =>
      entry.table === table &&
      entry.id === id &&
      !isInFlight(state, entry.seq) &&
      !isSetAside(entry),
  );
}

export const enqueue: OutboxMachine["enqueue"] = (state, entry) => {
  const index = state.entries.findIndex(
    (existing) =>
      existing.table === entry.table &&
      existing.id === entry.id &&
      !isInFlight(state, existing.seq) &&
      // En ny endring flettes aldri inn i en som er lagt til side; den blir en ny oppføring.
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
  const batch = state.entries
    .filter((entry) => !isSetAside(entry))
    .sort((a, b) => a.seq - b.seq)
    .slice(0, Math.max(0, limit));
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

/**
 * Raden en oppføring gjelder. En PATCH kan mangle nøkkelkolonnene; da lånes de fra en annen
 * operasjon på samme rad (også fra de som er lagt til side).
 */
function rowsOf(entries: readonly OutboxEntry[]): (entry: OutboxEntry) => LocalRow {
  const identity = new Map<string, LocalRow>();
  for (const entry of entries) {
    const known = identity.get(`${entry.table}/${entry.id}`) ?? {};
    identity.set(`${entry.table}/${entry.id}`, { ...known, ...entry.data });
  }
  return (entry) => ({
    ...identity.get(`${entry.table}/${entry.id}`),
    ...entry.data,
    id: entry.id,
  });
}

export const pendingKeys: OutboxMachine["pendingKeys"] = (state, keyOf) => {
  const rowOf = rowsOf(state.entries);
  const keys = new Set<string>();
  for (const entry of state.entries) {
    // Løst = en senere endring på samme felt er kvittert; den gamle beskytter ikke lenger feltet.
    if (isSetAside(entry) && !isUnresolvedSetAside(entry)) continue;
    keys.add(keyOf(entry.table, rowOf(entry)));
  }
  return keys;
};

/** Ventetallet («Venter: N endringer»): oppføringer som ikke er lagt til side. */
export function pendingCount(state: OutboxState): number {
  return state.entries.filter((entry) => !isSetAside(entry)).length;
}

/**
 * Endringene som er lagt til side og ikke løst, med tabell og felt (aldri innholdet), i
 * `seq`-rekkefølge. Grunnlaget for «Kunne ikke sendes: <feltnavn>».
 */
export function rejectedChanges(state: OutboxState): TrialRejectedChange[] {
  const rowOf = rowsOf(state.entries);
  return state.entries.filter(isUnresolvedSetAside).map((entry) => {
    if (entry.table === "trial_forms") return { table: entry.table, fieldKey: null };
    const fieldKey = rowOf(entry).field_key;
    return { table: entry.table, fieldKey: typeof fieldKey === "string" ? fieldKey : null };
  });
}

/** Endringen serveren pekte på i et 400-svar (`endring` i kroppen). */
export interface RejectedChangeRef {
  id: string;
  table: string;
}

/**
 * Leser `endring` fra kroppen i et 400-svar. Alt som ikke har `id` og `table` som tekst, gir null.
 * Kroppen leses aldri videre (den logges ikke).
 */
export function rejectedChangeOf(body: unknown): RejectedChangeRef | null {
  if (typeof body !== "object" || body === null) return null;
  const change = (body as { endring?: unknown }).endring;
  if (typeof change !== "object" || change === null) return null;
  const { id, table } = change as { id?: unknown; table?: unknown };
  if (typeof id !== "string" || typeof table !== "string") return null;
  return { id, table };
}

/**
 * Ved 400 for bunten som er underveis:
 * - `rejected` satt: alle oppføringer i bunten med samme `table` + `id` merkes lagt til side.
 * - `rejected` null og bunten har én oppføring: den merkes.
 * - Ellers (flere i bunten uten `rejected`, eller `rejected` finnes ikke i bunten): ingenting merkes,
 *   som `keepBatch`, så bunten prøves igjen senere.
 * `inFlight` nullstilles alltid. Ingenting slettes. `setAside` er antallet som ble merket; er det
 * over null, kan resten sendes med en gang.
 */
export function setAsideBatch(
  state: OutboxState,
  rejected: RejectedChangeRef | null,
  at: string,
): { state: OutboxState; setAside: number } {
  if (state.inFlight === null) return { state, setAside: 0 };
  const inFlight = new Set(state.inFlight);
  const batch = state.entries.filter((entry) => inFlight.has(entry.seq));
  let targets: Set<number>;
  if (rejected) {
    targets = new Set(
      batch
        .filter((entry) => entry.table === rejected.table && entry.id === rejected.id)
        .map((entry) => entry.seq),
    );
  } else {
    targets = batch.length === 1 ? new Set([batch[0]!.seq]) : new Set();
  }
  const entries = state.entries.map((entry) =>
    targets.has(entry.seq) ? { ...entry, setAside: { at } } : entry,
  );
  return { state: { ...state, entries, inFlight: null }, setAside: targets.size };
}

/**
 * Etter 200: oppføringer lagt til side med en nøkkel (`LocalRowKey`) i `ackedKeys` merkes løst
 * (`setAside.resolved = true`). De blir liggende i køen; ingenting slettes, aldri.
 */
export function resolveSetAside(
  state: OutboxState,
  ackedKeys: ReadonlySet<string>,
  keyOf: LocalRowKey,
): OutboxState {
  if (ackedKeys.size === 0 || !state.entries.some(isUnresolvedSetAside)) return state;
  const rowOf = rowsOf(state.entries);
  let changed = false;
  const entries = state.entries.map((entry) => {
    if (!isUnresolvedSetAside(entry) || !ackedKeys.has(keyOf(entry.table, rowOf(entry)))) {
      return entry;
    }
    changed = true;
    return { ...entry, setAside: { ...entry.setAside!, resolved: true } };
  });
  return changed ? { ...state, entries } : state;
}

/** Oppføringene i `next` som er nye eller endret siden `previous` (for lagring med `put`). */
export function changedEntries(previous: OutboxState, next: OutboxState): OutboxEntry[] {
  const before = new Set(previous.entries);
  return next.entries.filter((entry) => !before.has(entry));
}

/** Bare 200 slipper bunten. Alt annet (også 201, 204 og nettverksfeil) beholder den. */
export function shouldAckBatch(status: number | undefined): boolean {
  return status === 200;
}

/**
 * Bare 400 legger en endring til side (A170). 401, 403, 409, 413, 5xx og nettfeil gir nytt forsøk.
 */
export function shouldSetAside(status: number | undefined): boolean {
  return status === 400;
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
