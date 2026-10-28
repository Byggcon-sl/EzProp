import { describe, expect, it } from "vitest";
import {
  RETRY_DELAY_MAX_MS,
  RETRY_DELAY_MIN_MS,
  type OutboxEntry,
  type OutboxState,
} from "../types";
import { applyIncoming } from "./apply-incoming";
import {
  ackBatch,
  createOutboxState,
  enqueue,
  keepBatch,
  localRowKey,
  pendingKeys,
  retryDelayMs,
  takeBatch,
} from "./outbox";
import { parseShapeMessages } from "./shape-messages";

// Endringskøen vi eier selv for ElectricSQL (docs/funksjoner/fase1-kandidat-electricsql.md
// avgjørelse D og «Avgjørelser før bygging» 1). Testplan avsnitt 2.1. Rene funksjoner over
// OutboxState: ingen IndexedDB, ingen DOM. Testen «skjemaet sendes alltid før svarene …» er
// erstattet av e2e-testen «createForm legger skjemaet i køen før første svar» (avgjørelse 1).
// Alle data er oppdiktet.

const FORM = "0192d3a0-0000-7000-8000-000000000001";
const ANSWER_X = "0192d3a0-0000-7000-8000-0000000000a1";
const ANSWER_Y = "0192d3a0-0000-7000-8000-0000000000a2";
const PHOTO = "0192d3a0-0000-7000-8000-0000000000b1";

type NewEntry = Omit<OutboxEntry, "seq">;

function formEntry(id = FORM, name = "Testskjema 1"): NewEntry {
  return { op: "PUT", table: "trial_forms", id, data: { name } };
}

function answerEntry(
  id: string,
  fieldKey: string,
  value: unknown,
  op: NewEntry["op"] = "PUT",
): NewEntry {
  const data: Record<string, unknown> =
    op === "PUT"
      ? {
          trial_form_id: FORM,
          field_key: fieldKey,
          value: JSON.stringify(value),
          text_state: null,
          device_id: "enhet-1",
        }
      : { value: JSON.stringify(value) };
  return { op, table: "trial_answers", id, data };
}

function photoEntry(id = PHOTO): NewEntry {
  return {
    op: "PUT",
    table: "trial_photos",
    id,
    data: {
      trial_form_id: FORM,
      field_key: "cover_photo",
      name: "test-image.png",
      size_bytes: 120,
      device_id: "enhet-1",
    },
  };
}

function enqueueAll(state: OutboxState, entries: NewEntry[]): OutboxState {
  return entries.reduce((current, entry) => enqueue(current, entry), state);
}

function take(state: OutboxState, limit = 500) {
  const taken = takeBatch(state, limit);
  expect(taken, "takeBatch ga ingen bunt").not.toBeNull();
  return taken!;
}

describe("endringskøen (outbox.ts)", () => {
  it("enqueue gir stigende seq og takeBatch gir operasjonene i seq-rekkefølge", () => {
    const state = enqueueAll(createOutboxState(), [
      formEntry(),
      answerEntry(ANSWER_X, "floors", 7),
      photoEntry(),
    ]);
    const { batch } = take(state);
    expect(batch.map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect(batch.map((entry) => entry.table)).toEqual([
      "trial_forms",
      "trial_answers",
      "trial_photos",
    ]);
    expect(state.nextSeq).toBe(4);
  });

  it("enqueue på samme (tabell, id) slår sammen og beholder opprinnelig seq", () => {
    const state = enqueueAll(createOutboxState(), [
      answerEntry(ANSWER_X, "floors", 1),
      formEntry(),
      answerEntry(ANSWER_X, "floors", 2),
    ]);
    expect(state.entries).toHaveLength(2);
    const { batch } = take(state);
    expect(batch.map((entry) => [entry.table, entry.seq])).toEqual([
      ["trial_answers", 1],
      ["trial_forms", 2],
    ]);
    expect(batch[0]!.data.value).toBe(JSON.stringify(2));
  });

  it("PATCH etter PUT på samme rad slås sammen til én PUT med alle kolonner", () => {
    const state = enqueueAll(createOutboxState(), [
      answerEntry(ANSWER_X, "floors", 1),
      answerEntry(ANSWER_X, "floors", 9, "PATCH"),
    ]);
    expect(state.entries).toHaveLength(1);
    const [entry] = state.entries;
    expect(entry!.op).toBe("PUT");
    expect(entry!.seq).toBe(1);
    expect(entry!.data).toEqual({
      trial_form_id: FORM,
      field_key: "floors",
      value: JSON.stringify(9),
      text_state: null,
      device_id: "enhet-1",
    });
  });

  it("takeBatch gir høyst max operasjoner og tar aldri ut av køen", () => {
    let state = createOutboxState();
    for (let i = 0; i < 600; i++) {
      state = enqueue(state, formEntry(`0192d3a0-0000-7000-8000-${String(i).padStart(12, "0")}`));
    }
    expect(state.entries).toHaveLength(600);

    const first = take(state, 500);
    expect(first.batch).toHaveLength(500);
    expect(first.batch.map((entry) => entry.seq)).toEqual(
      Array.from({ length: 500 }, (_, i) => i + 1),
    );
    // Bunten ligger fortsatt i køen, bare merket som underveis
    expect(first.state.entries).toHaveLength(600);
    expect(state.entries).toHaveLength(600);

    // Ren funksjon: samme tilstand gir samme bunt
    expect(take(state, 500).batch).toEqual(first.batch);
    // Mens en bunt er underveis, gis ingen ny
    expect(takeBatch(first.state, 500)).toBeNull();
    // Etter omlasting (inFlight lagres ikke) gis samme bunt igjen
    const reloaded = createOutboxState([...first.state.entries], first.state.nextSeq);
    expect(take(reloaded, 500).batch).toEqual(first.batch);
  });

  it("ackBatch fjerner bare operasjonene i bunten", () => {
    const state = enqueueAll(createOutboxState(), [
      formEntry(),
      answerEntry(ANSWER_X, "floors", 7),
      answerEntry(ANSWER_Y, "roof_tg", "TG2"),
    ]);
    const { state: sending, batch } = take(state, 2);
    expect(batch.map((entry) => entry.seq)).toEqual([1, 2]);
    const after = ackBatch(sending);
    expect(after.entries).toHaveLength(1);
    expect(after.entries[0]!.seq).toBe(3);
    expect(after.entries[0]!.id).toBe(ANSWER_Y);
    expect(after.inFlight).toBeNull();
  });

  // Obligatorisk (tap av data)
  it("ackBatch etter en ny enqueue på samme nøkkel fjerner ikke den nye endringen", () => {
    const state = enqueueAll(createOutboxState(), [
      formEntry(),
      answerEntry(ANSWER_X, "floors", 1),
    ]);
    const { state: sending, batch } = take(state);
    expect(batch.find((entry) => entry.id === ANSWER_X)!.data.value).toBe(JSON.stringify(1));

    // Brukeren skriver mens bunten er underveis
    const typed = enqueue(sending, answerEntry(ANSWER_X, "floors", 2));
    const after = ackBatch(typed);

    expect(after.entries).toHaveLength(1);
    const [left] = after.entries;
    expect(left!.id).toBe(ANSWER_X);
    expect(left!.data.value).toBe(JSON.stringify(2));
    expect(batch.map((entry) => entry.seq)).not.toContain(left!.seq);
    expect(left!.seq).toBeGreaterThan(Math.max(...batch.map((entry) => entry.seq)));
    // Den nye endringen sendes i neste bunt
    expect(take(after).batch.map((entry) => entry.id)).toEqual([ANSWER_X]);
  });

  it("keepBatch endrer ingenting", () => {
    const state = enqueueAll(createOutboxState(), [
      formEntry(),
      answerEntry(ANSWER_X, "floors", 7),
    ]);
    const { state: sending, batch } = take(state);
    const kept = keepBatch(sending);
    expect(kept.entries).toEqual(state.entries);
    expect(kept.nextSeq).toBe(state.nextSeq);
    expect(kept.inFlight).toBeNull();
    // Neste forsøk sender den samme bunten
    expect(take(kept).batch).toEqual(batch);
  });

  // Hvilken status som gir ackBatch, avgjøres i lageret (store.ts), ikke i den rene køen; navnet
  // shouldAckBatch står ikke blant de bindende navnene (avgjørelse 1). Testen viser det køen lover:
  // alt annet enn 200 går til keepBatch og mister ingenting. Selve 200-regelen vises ende til ende
  // i e2e («endringskøen overlever omlasting og tømmes bare etter 200», «avbrutt sending …»).
  it("ackBatch kalles bare ved 200: hjelperen shouldAckBatch", () => {
    const state = enqueueAll(createOutboxState(), [
      formEntry(),
      answerEntry(ANSWER_X, "floors", 7),
    ]);
    const outcomes = [201, 204, 400, 401, 403, 409, 429, 500, 502, undefined];
    let current = state;
    for (const status of outcomes) {
      const { state: sending } = take(current);
      current = keepBatch(sending);
      expect(current.entries, String(status)).toEqual(state.entries);
    }
    const { state: sending } = take(current);
    expect(ackBatch(sending).entries).toEqual([]);
  });

  it("tom kø gir tom bunt og ingen feil", () => {
    const empty = createOutboxState();
    expect(empty.entries).toEqual([]);
    expect(empty.inFlight).toBeNull();
    expect(takeBatch(empty, 500)).toBeNull();
    expect(() => ackBatch(empty)).not.toThrow();
    expect(ackBatch(empty).entries).toEqual([]);
    expect(() => keepBatch(empty)).not.toThrow();
    expect(pendingKeys(empty, localRowKey).size).toBe(0);
  });

  // Obligatorisk (tap av data). Selve slettingen av shape_state og synkede rader skjer i lageret
  // (IndexedDB, bare e2e); her vises at must-refetch og ny innfletting aldri rører køen, og at
  // nøklene i køen fortsatt beskytter de usendte endringene når shapen hentes på nytt.
  it("må-hente-på-nytt rører aldri køen", () => {
    const state = enqueueAll(createOutboxState(), [
      formEntry(),
      answerEntry(ANSWER_X, "floors", 7),
    ]);
    const before = JSON.parse(JSON.stringify(state)) as OutboxState;

    const parsed = parseShapeMessages("trial_answers", [{ headers: { control: "must-refetch" } }]);
    expect(parsed.mustRefetch).toBe(true);

    // Ny henting fra offset=-1: serveren har fortsatt den gamle verdien
    const keys = pendingKeys(state, localRowKey);
    const localRow = {
      id: ANSWER_X,
      trial_form_id: FORM,
      field_key: "floors",
      value: JSON.stringify(7),
      text_state: null,
      device_id: "enhet-1",
    };
    const key = localRowKey("trial_answers", localRow);
    expect(keys.has(key)).toBe(true);
    const merged = applyIncoming(
      "trial_answers",
      [localRow],
      [
        {
          table: "trial_answers",
          kind: "insert",
          key,
          row: { ...localRow, value: JSON.stringify(3), device_id: "annen-enhet" },
        },
      ],
      keys,
    );
    expect(merged.rows.find((row) => row.id === ANSWER_X)?.value).toBe(JSON.stringify(7));

    expect(state).toEqual(before);
    expect(take(state).batch.map((entry) => entry.id)).toEqual([FORM, ANSWER_X]);
  });

  it("tilstanden tåler JSON-rundtur", () => {
    const state = enqueueAll(createOutboxState(), [
      formEntry(),
      answerEntry(ANSWER_X, "floors", 7),
      photoEntry(),
    ]);
    const copy = JSON.parse(JSON.stringify(state)) as OutboxState;
    expect(copy).toEqual(state);
    expect(take(copy).batch).toEqual(take(state).batch);
    // Også gjenoppbygd fra lagrede oppføringer og nextSeq (slik lageret leser IndexedDB)
    const rebuilt = createOutboxState(
      JSON.parse(JSON.stringify(state.entries)) as OutboxEntry[],
      state.nextSeq,
    );
    expect(take(rebuilt).batch).toEqual(take(state).batch);
    expect(enqueue(rebuilt, formEntry(ANSWER_Y)).entries.at(-1)!.seq).toBe(state.nextSeq);
  });

  it("ventetiden ved feil dobles fra 5 s til høyst 60 s og nullstilles ved 200", () => {
    expect(RETRY_DELAY_MIN_MS).toBe(5_000);
    expect(RETRY_DELAY_MAX_MS).toBe(60_000);
    expect(retryDelayMs(0)).toBe(5_000);
    expect(retryDelayMs(1)).toBe(10_000);
    expect(retryDelayMs(2)).toBe(20_000);
    expect(retryDelayMs(3)).toBe(40_000);
    expect(retryDelayMs(4)).toBe(60_000);
    expect(retryDelayMs(10)).toBe(60_000);
    expect(retryDelayMs(1_000)).toBe(60_000);
    // Aldri tettere enn 5 s, uansett forsøk
    for (let attempt = 0; attempt < 20; attempt++) {
      expect(retryDelayMs(attempt)).toBeGreaterThanOrEqual(RETRY_DELAY_MIN_MS);
      expect(retryDelayMs(attempt)).toBeLessThanOrEqual(RETRY_DELAY_MAX_MS);
    }
    // Etter 200 starter tellingen på 0 igjen (lageret nullstiller attempt)
    expect(retryDelayMs(0)).toBe(5_000);
  });

  it("pendingKeys gir nøklene i køen, også de underveis (tillegg)", () => {
    const state = enqueueAll(createOutboxState(), [
      formEntry(),
      answerEntry(ANSWER_X, "floors", 7),
    ]);
    const { state: sending } = take(state);
    const keys = pendingKeys(sending, localRowKey);
    expect(keys.has(localRowKey("trial_forms", { id: FORM }))).toBe(true);
    expect(
      keys.has(
        localRowKey("trial_answers", { id: ANSWER_X, trial_form_id: FORM, field_key: "floors" }),
      ),
    ).toBe(true);
    // Svar nøkles på (trial_form_id, field_key), ikke id
    expect(
      localRowKey("trial_answers", { id: ANSWER_X, trial_form_id: FORM, field_key: "floors" }),
    ).toBe(
      localRowKey("trial_answers", { id: ANSWER_Y, trial_form_id: FORM, field_key: "floors" }),
    );
    expect(localRowKey("trial_forms", { id: FORM })).not.toBe(
      localRowKey("trial_forms", { id: ANSWER_Y }),
    );
  });
});
