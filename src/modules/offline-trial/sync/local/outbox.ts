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
 * Funn T-0001: svarer serveren 400 på én endring, legges den til side (`setAsideFromRejection`)
 * og resten sendes videre. Den slettes aldri, sendes aldri igjen og teller ikke som ventende.
 */
import { TRIAL_SYNC_LIMITS } from "../../server/types";
import { isTrialTableName, type TrialTableName } from "../local-columns";
import {
  RETRY_DELAY_MAX_MS,
  RETRY_DELAY_MIN_MS,
  type LocalRow,
  type LocalRowKey,
  type OutboxEntry,
  type OutboxMachine,
  type OutboxState,
  type RetryDelayMs,
  type SetAsideField,
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
  // Ikke inn i en oppføring som er underveis eller lagt til side: da blir det en ny oppføring.
  const index = state.entries.findIndex(
    (existing) =>
      existing.table === entry.table &&
      existing.id === entry.id &&
      !existing.setAside &&
      !isInFlight(state, existing.seq),
  );
  if (index === -1) {
    const added: OutboxEntry = {
      op: entry.op,
      table: entry.table,
      id: entry.id,
      data: { ...entry.data },
      seq: state.nextSeq,
    };
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
    .filter((entry) => !entry.setAside)
    .sort((a, b) => a.seq - b.seq)
    .slice(0, Math.max(0, limit));
  if (batch.length === 0) return null;
  return { state: { ...state, inFlight: batch.map((entry) => entry.seq) }, batch };
};

export const ackBatch: OutboxMachine["ackBatch"] = (state) => {
  if (state.inFlight === null) return state;
  const sent = new Set(state.inFlight);
  // Et felt med en endring lagt til side er løst når en senere endring i samme felt er kvittert.
  const keys = entryKeys(state, localRowKey);
  const sentKeys = new Set(
    state.entries.filter((entry) => sent.has(entry.seq)).map((entry) => keys.get(entry.seq)),
  );
  const entries: OutboxEntry[] = [];
  for (const entry of state.entries) {
    if (sent.has(entry.seq)) continue;
    const resolves =
      entry.setAside && !entry.setAside.resolved && sentKeys.has(keys.get(entry.seq));
    entries.push(resolves ? { ...entry, setAside: { ...entry.setAside!, resolved: true } } : entry);
  }
  return { ...state, entries, inFlight: null };
};

export const keepBatch: OutboxMachine["keepBatch"] = (state) => {
  if (state.inFlight === null) return state;
  return { ...state, inFlight: null };
};

/** `LocalRowKey` for hver oppføring (`seq` → nøkkel). */
function entryKeys(state: OutboxState, keyOf: LocalRowKey): Map<number, string> {
  // En PATCH kan mangle nøkkelkolonnene; da lånes de fra en annen operasjon på samme rad.
  const identity = new Map<string, LocalRow>();
  for (const entry of state.entries) {
    const known = identity.get(`${entry.table}/${entry.id}`) ?? {};
    identity.set(`${entry.table}/${entry.id}`, { ...known, ...entry.data });
  }
  const keys = new Map<number, string>();
  for (const entry of state.entries) {
    const row = { ...identity.get(`${entry.table}/${entry.id}`), ...entry.data, id: entry.id };
    keys.set(entry.seq, keyOf(entry.table, row));
  }
  return keys;
}

/** Venter fortsatt: ikke lagt til side, eller lagt til side og ikke løst (lokal tekst beskyttes). */
const isUnresolved = (entry: OutboxEntry) => !entry.setAside || !entry.setAside.resolved;

export const pendingKeys: OutboxMachine["pendingKeys"] = (state, keyOf) => {
  const keys = entryKeys(state, keyOf);
  const pending = new Set<string>();
  for (const entry of state.entries) {
    if (isUnresolved(entry)) pending.add(keys.get(entry.seq)!);
  }
  return pending;
};

/** Ventetallet («Venter: N endringer»): oppføringer som ikke er lagt til side. */
export function pendingCount(state: OutboxState): number {
  return state.entries.filter((entry) => !entry.setAside).length;
}

/**
 * Feltene med en endring lagt til side og ikke løst, i `seq`-rekkefølge, hvert felt én gang. Til
 * meldingen «Kunne ikke sendes: …». `fieldKey` er null for `trial_forms`.
 */
export function setAsideFields(state: OutboxState): SetAsideField[] {
  const identity = new Map<string, LocalRow>();
  for (const entry of state.entries) {
    const known = identity.get(`${entry.table}/${entry.id}`) ?? {};
    identity.set(`${entry.table}/${entry.id}`, { ...known, ...entry.data });
  }
  const seen = new Set<string>();
  const fields: SetAsideField[] = [];
  for (const entry of [...state.entries].sort((a, b) => a.seq - b.seq)) {
    if (!entry.setAside || entry.setAside.resolved) continue;
    const row = { ...identity.get(`${entry.table}/${entry.id}`), ...entry.data };
    const fieldKey =
      entry.table === "trial_forms" || typeof row.field_key !== "string" ? null : row.field_key;
    const id = `${entry.table}/${fieldKey ?? ""}`;
    if (seen.has(id)) continue;
    seen.add(id);
    fields.push({ table: entry.table, fieldKey });
  }
  return fields;
}

/** Bare 200 slipper bunten. Alt annet (også 201, 204 og nettverksfeil) beholder den. */
export function shouldAckBatch(status: number | undefined): boolean {
  return status === 200;
}

/** Endringen serveren peker på i et 400-svar: `{ feil, endring?: { id, table, field_key? } }`. */
function rejectedChange(body: unknown): { id: string; table: TrialTableName } | null {
  if (typeof body !== "object" || body === null) return null;
  const change = (body as { endring?: unknown }).endring;
  if (typeof change !== "object" || change === null) return null;
  const { id, table } = change as { id?: unknown; table?: unknown };
  if (typeof id !== "string" || typeof table !== "string" || !isTrialTableName(table)) return null;
  return { id, table };
}

/**
 * Om 400-svaret kommer fra vår egen synkrute (`{ feil: "…" }`). Et 400 fra noe foran appen
 * (mellomtjener, for store hoder) har ikke denne formen, og da prøves bunten på nytt i stedet for
 * at takstmannens endring legges til side.
 */
function isOwnRejection(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as { feil?: unknown }).feil === "string"
  );
}

/**
 * Hva som skjer med bunten som er underveis når serveren ikke svarte 200 (funn T-0001, A181).
 * Gir ny tilstand med endringen lagt til side og `inFlight` nullstilt, så resten sendes med en
 * gang, eller `null` når bunten skal prøves på nytt som før (`keepBatch`):
 * - 400 med `endring`: alle oppføringer i bunten med samme `table` + `id` legges til side. Finnes
 *   ingen slik oppføring i bunten, gir den `null` (aldri feil endring til side).
 * - 400 uten `endring` og én oppføring i bunten: den legges til side.
 * - 400 uten `endring` og flere i bunten, og alle andre svar (401, 403, 409, 413, 5xx, nettfeil): `null`.
 * - 400 som ikke kommer fra vår rute (kroppen er ikke `{ feil }`, f.eks. fra en mellomtjener): `null`.
 * Ingenting fjernes fra køen.
 */
export function setAsideFromRejection(
  state: OutboxState,
  status: number | undefined,
  body: unknown,
  at: string,
): OutboxState | null {
  if (status !== 400 || state.inFlight === null || state.inFlight.length === 0) return null;
  if (!isOwnRejection(body)) return null;
  const inFlight = new Set(state.inFlight);
  const batch = state.entries.filter((entry) => inFlight.has(entry.seq));
  const change = rejectedChange(body);
  let rejected: Set<number>;
  if (change) {
    rejected = new Set(
      batch
        .filter((entry) => entry.table === change.table && entry.id === change.id)
        .map((entry) => entry.seq),
    );
  } else {
    rejected = batch.length === 1 ? new Set([batch[0]!.seq]) : new Set();
  }
  if (rejected.size === 0) return null;
  return {
    ...state,
    entries: state.entries.map((entry) =>
      rejected.has(entry.seq) ? { ...entry, setAside: { at } } : entry,
    ),
    inFlight: null,
  };
}

/**
 * Oppføringene i `next` som er nye eller endret siden `previous` (samme `seq`, nytt objekt). Lageret
 * skriver bare disse til objektlageret `outbox`.
 */
export function changedEntries(previous: OutboxState, next: OutboxState): OutboxEntry[] {
  const before = new Map(previous.entries.map((entry) => [entry.seq, entry]));
  return next.entries.filter((entry) => before.get(entry.seq) !== entry);
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
