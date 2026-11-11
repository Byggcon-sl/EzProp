import { describe, expect, it } from "vitest";
import type { OutboxEntry, OutboxState } from "../types";
import {
  ackBatch,
  createOutboxState,
  enqueue,
  keepBatch,
  localRowKey,
  pendingCount,
  pendingKeys,
  rejectedChangeOf,
  rejectedChanges,
  resolveSetAside,
  setAsideBatch,
  shouldAckBatch,
  shouldSetAside,
  takeBatch,
} from "./outbox";

// Funn T-0001: én avvist endring skal ikke stoppe resten av køen. Testplan
// docs/agenter/oppgaver/rett-t0001-synkko-testplan.md avsnitt 1c (16–32). Rene funksjoner, samme
// som trial-store.ts kaller: shouldAckBatch, shouldSetAside, setAsideBatch, resolveSetAside.
// Alle data er oppdiktet.

const FORM = "0192d3a0-0000-7000-8000-000000000001";
const DESCRIPTION = "0192d3a0-0000-7000-8000-0000000000a1";
const YEAR = "0192d3a0-0000-7000-8000-0000000000a2";
const SUMMARY = "0192d3a0-0000-7000-8000-0000000000a3";
const AT = "2026-11-11T10:00:00.000Z";

type NewEntry = Omit<OutboxEntry, "seq">;

function answer(id: string, fieldKey: string, value: unknown): NewEntry {
  return {
    op: "PUT",
    table: "trial_answers",
    id,
    data: {
      trial_form_id: FORM,
      field_key: fieldKey,
      value: JSON.stringify(value),
      text_state: null,
      device_id: "enhet-1",
    },
  };
}

const ENTRIES: NewEntry[] = [
  answer(DESCRIPTION, "general_description", "Fukt\u0000 i kjeller"),
  answer(YEAR, "building_year", 1985),
  answer(SUMMARY, "summary", "Samlet sett i orden"),
];

function queueOf(entries: NewEntry[]): OutboxState {
  return entries.reduce((state, entry) => enqueue(state, entry), createOutboxState());
}

function take(state: OutboxState) {
  const taken = takeBatch(state, 500);
  expect(taken, "takeBatch ga ingen bunt").not.toBeNull();
  return taken!;
}

/** Sender køen én runde: 400 som peker på `poison`, så 200 for resten. */
function rejectThenAck(state: OutboxState, poison: { id: string; table: string }) {
  const rejected = setAsideBatch(take(state).state, poison, AT);
  expect(rejected.setAside).toBe(1);
  const next = take(rejected.state);
  return { batch: next.batch, state: ackBatch(next.state) };
}

describe("lagt til side ved 400 (outbox.ts, funn T-0001)", () => {
  it.each([
    ["først", DESCRIPTION],
    ["i midten", YEAR],
    ["sist", SUMMARY],
  ])("giftig endring %s: legges til side, resten sendes og kvitteres", (_where, poisonId) => {
    const { batch, state } = rejectThenAck(queueOf(ENTRIES), {
      id: poisonId,
      table: "trial_answers",
    });

    expect(batch.map((entry) => entry.id)).not.toContain(poisonId);
    expect(batch).toHaveLength(2);
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]!.id).toBe(poisonId);
    expect(state.entries[0]!.setAside).toEqual({ at: AT });
    expect(state.inFlight).toBeNull();
  });

  it("alle køoppføringer med samme table+id i bunten legges til side", () => {
    // Første bunt er underveis; en ny endring på samme rad blir ny oppføring (nytt seq).
    let state = queueOf([answer(DESCRIPTION, "general_description", "a")]);
    state = take(state).state;
    state = enqueue(state, answer(DESCRIPTION, "general_description", "b"));
    state = enqueue(state, answer(YEAR, "building_year", 1985));
    state = keepBatch(state);
    expect(state.entries).toHaveLength(3);

    const result = setAsideBatch(
      take(state).state,
      { id: DESCRIPTION, table: "trial_answers" },
      AT,
    );
    expect(result.setAside).toBe(2);
    const next = take(result.state);
    expect(next.batch.map((entry) => entry.id)).toEqual([YEAR]);
  });

  it("400 uten endring og bunt med én endring: legges til side", () => {
    const result = setAsideBatch(take(queueOf([ENTRIES[0]!])).state, null, AT);
    expect(result.setAside).toBe(1);
    expect(result.state.entries[0]!.setAside).toEqual({ at: AT });
    expect(result.state.inFlight).toBeNull();
  });

  it("400 uten endring og flere i bunten: nytt forsøk, ingenting lagt til side", () => {
    const result = setAsideBatch(take(queueOf(ENTRIES)).state, null, AT);
    expect(result.setAside).toBe(0);
    expect(result.state.inFlight).toBeNull();
    expect(result.state.entries.every((entry) => entry.setAside === undefined)).toBe(true);
    expect(take(result.state).batch).toHaveLength(3);
  });

  it("400 med endring som ikke finnes i bunten: nytt forsøk", () => {
    const result = setAsideBatch(
      take(queueOf(ENTRIES)).state,
      { id: "0192d3a0-0000-7000-8000-0000000000ff", table: "trial_answers" },
      AT,
    );
    expect(result.setAside).toBe(0);
    expect(result.state.entries.every((entry) => entry.setAside === undefined)).toBe(true);
    // Riktig id, feil tabell, legger heller ikke til side.
    const wrongTable = setAsideBatch(
      take(queueOf(ENTRIES)).state,
      { id: DESCRIPTION, table: "trial_photos" },
      AT,
    );
    expect(wrongTable.setAside).toBe(0);
  });

  it.each([401, 403, 409, 413, 500, 503, undefined])(
    "status %s gir nytt forsøk og legger ingenting til side",
    (status) => {
      expect(shouldAckBatch(status)).toBe(false);
      expect(shouldSetAside(status)).toBe(false);
      const state = keepBatch(take(queueOf(ENTRIES)).state);
      expect(state.entries).toHaveLength(3);
      expect(state.entries.every((entry) => entry.setAside === undefined)).toBe(true);
    },
  );

  it("bare 400 legger til side, og bare 200 slipper bunten", () => {
    expect(shouldSetAside(400)).toBe(true);
    expect(shouldAckBatch(200)).toBe(true);
    for (const status of [201, 204]) expect(shouldAckBatch(status)).toBe(false);
  });

  it("lagt til side slettes aldri og sendes ikke", () => {
    let { state } = rejectThenAck(queueOf(ENTRIES), { id: DESCRIPTION, table: "trial_answers" });
    for (let round = 0; round < 3; round++) {
      state = enqueue(state, answer(YEAR, "building_year", 1990 + round));
      const next = take(state);
      expect(next.batch.map((entry) => entry.id)).toEqual([YEAR]);
      state = ackBatch(next.state);
    }
    expect(state.entries.map((entry) => entry.id)).toEqual([DESCRIPTION]);
    expect(takeBatch(state, 500)).toBeNull();
  });

  it("lagt til side overlever omlasting", () => {
    const { state } = rejectThenAck(queueOf(ENTRIES), { id: YEAR, table: "trial_answers" });
    const stored = structuredClone(state.entries) as OutboxEntry[];
    const reloaded = createOutboxState(stored, state.nextSeq);
    expect(reloaded.entries).toEqual(state.entries);
    expect(reloaded.entries[0]!.setAside).toEqual({ at: AT });
    expect(takeBatch(reloaded, 500)).toBeNull();
  });

  it("ventetallet teller ikke lagt til side", () => {
    const rejected = setAsideBatch(
      take(queueOf(ENTRIES)).state,
      { id: DESCRIPTION, table: "trial_answers" },
      AT,
    );
    expect(rejected.state.entries).toHaveLength(3);
    expect(pendingCount(rejected.state)).toBe(2);
  });

  it("ny endring i samme felt blir ny oppføring", () => {
    const { state } = rejectThenAck(queueOf(ENTRIES), { id: DESCRIPTION, table: "trial_answers" });
    const before = structuredClone(state.entries[0]!);
    const next = enqueue(state, answer(DESCRIPTION, "general_description", "Fukt i kjeller"));
    expect(next.entries).toHaveLength(2);
    expect(next.entries[0]).toEqual(before);
    expect(next.entries[1]!.seq).toBeGreaterThan(before.seq);
    expect(next.entries[1]!.setAside).toBeUndefined();
  });

  it("pendingKeys har feltet så lenge det er lagt til side og ikke løst", () => {
    const { state } = rejectThenAck(queueOf(ENTRIES), { id: DESCRIPTION, table: "trial_answers" });
    expect(pendingKeys(state, localRowKey)).toEqual(new Set([`${FORM}:general_description`]));
  });

  it("200 på senere endring i samme felt løser den gamle", () => {
    let { state } = rejectThenAck(queueOf(ENTRIES), { id: DESCRIPTION, table: "trial_answers" });
    state = enqueue(state, answer(DESCRIPTION, "general_description", "Fukt i kjeller"));
    const taken = take(state);
    const acked = new Set(
      taken.batch.map((entry) => localRowKey(entry.table, { ...entry.data, id: entry.id })),
    );
    state = ackBatch(resolveSetAside(taken.state, acked, localRowKey));

    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]!.setAside).toEqual({ at: AT, resolved: true });
    expect(pendingKeys(state, localRowKey).size).toBe(0);
    expect(rejectedChanges(state)).toEqual([]);
    expect(pendingCount(state)).toBe(0);
  });

  it("200 på et annet felt løser ikke", () => {
    let { state } = rejectThenAck(queueOf(ENTRIES), { id: DESCRIPTION, table: "trial_answers" });
    state = enqueue(state, answer(YEAR, "building_year", 2001));
    const taken = take(state);
    const acked = new Set(
      taken.batch.map((entry) => localRowKey(entry.table, { ...entry.data, id: entry.id })),
    );
    const resolved = resolveSetAside(taken.state, acked, localRowKey);
    expect(resolved).toBe(taken.state);
    state = ackBatch(resolved);
    expect(state.entries[0]!.setAside).toEqual({ at: AT });
    expect(pendingKeys(state, localRowKey)).toContain(`${FORM}:general_description`);
  });

  it("rejectedChanges gir tabell og felt, også for PATCH uten field_key", () => {
    let state = queueOf([ENTRIES[0]!]);
    state = take(state).state;
    // PATCH på samme rad mens den første er underveis: mangler field_key.
    state = enqueue(state, {
      op: "PATCH",
      table: "trial_answers",
      id: DESCRIPTION,
      data: { value: JSON.stringify("x") },
    });
    state = enqueue(state, { op: "PUT", table: "trial_forms", id: FORM, data: { name: "T" } });
    state = keepBatch(state);
    const all = take(state);
    // Serveren peker først på svaret (begge oppføringene på raden), så på skjemaet.
    let next = setAsideBatch(all.state, { id: DESCRIPTION, table: "trial_answers" }, AT).state;
    next = setAsideBatch(take(next).state, { id: FORM, table: "trial_forms" }, AT).state;
    expect(rejectedChanges(next)).toEqual([
      { table: "trial_answers", fieldKey: "general_description" },
      { table: "trial_answers", fieldKey: "general_description" },
      { table: "trial_forms", fieldKey: null },
    ]);
  });

  it("rejectedChangeOf leser bare id og tabell fra kroppen", () => {
    expect(
      rejectedChangeOf({
        feil: "Kunne ikke lagre.",
        endring: { id: DESCRIPTION, table: "trial_answers", field_key: "general_description" },
      }),
    ).toEqual({ id: DESCRIPTION, table: "trial_answers" });
    expect(rejectedChangeOf({ feil: "x" })).toBeNull();
    expect(rejectedChangeOf(null)).toBeNull();
    expect(rejectedChangeOf("tekst")).toBeNull();
    expect(rejectedChangeOf({ endring: { id: 1, table: "trial_answers" } })).toBeNull();
  });
});
