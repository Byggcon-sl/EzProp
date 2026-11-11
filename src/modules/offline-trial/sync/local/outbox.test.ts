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
  newlyResolved,
  pendingCount,
  pendingKeys,
  rejectedChangeOf,
  retryDelayMs,
  setAsideBatch,
  shouldAckBatch,
  takeBatch,
  unresolvedSetAside,
} from "./outbox";

// Endringskøen vi eier selv (docs/funksjoner/fase1-kandidat-electricsql.md avgjørelse D og
// «Avgjørelser før bygging» 1; brukes nå av egenbygd synk). Testplan avsnitt 2.1. Rene funksjoner over
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

  // Regelen fra pkt. 5. Lageret velger ackBatch eller keepBatch med
  // shouldAckBatch; e2e viser det ende til ende («endringskøen overlever omlasting …»).
  it("ackBatch kalles bare ved 200: hjelperen shouldAckBatch", () => {
    expect(shouldAckBatch(200)).toBe(true);
    const outcomes = [201, 204, 400, 401, 403, 409, 429, 500, 502, undefined];
    for (const status of outcomes) expect(shouldAckBatch(status), String(status)).toBe(false);

    // Det køen lover for alt annet enn 200: keepBatch mister ingenting
    const state = enqueueAll(createOutboxState(), [
      formEntry(),
      answerEntry(ANSWER_X, "floors", 7),
    ]);
    let current = state;
    for (const status of outcomes) {
      const { state: sending } = take(current);
      current = shouldAckBatch(status) ? ackBatch(sending) : keepBatch(sending);
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

  // Obligatorisk (tap av data). Selve slettingen av synkede rader skjer i lageret (IndexedDB, bare
  // e2e); her vises at ny innfletting aldri rører køen, og at nøklene i køen fortsatt beskytter de
  // usendte endringene når alt hentes på nytt.
  it("henting fra start rører aldri køen", () => {
    const state = enqueueAll(createOutboxState(), [
      formEntry(),
      answerEntry(ANSWER_X, "floors", 7),
    ]);
    const before = JSON.parse(JSON.stringify(state)) as OutboxState;

    // Ny henting fra start: serveren har fortsatt den gamle verdien
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

// Rett T-0001 (A181): én endring serveren avviser med 400, legges til side, og resten sendes.
// Testplan docs/agenter/oppgaver/rett-t0001-synkko-testplan.md avsnitt 1c (16–32).
describe("lagt til side etter 400 (outbox.ts)", () => {
  const AT = "2026-11-11T10:00:00.000Z";
  const ANSWER_Z = "0192d3a0-0000-7000-8000-0000000000a3";
  const DESCRIPTION_KEY = localRowKey("trial_answers", {
    trial_form_id: FORM,
    field_key: "general_description",
  });

  /** Tre svar i køen: Generell beskrivelse, byggeår og samlet kommentar (oppdiktet). */
  function threeAnswers(): OutboxState {
    return enqueueAll(createOutboxState(), [
      answerEntry(ANSWER_X, "general_description", "Fukt i kjeller"),
      answerEntry(ANSWER_Y, "building_year", 1985),
      answerEntry(ANSWER_Z, "summary", "Oppdiktet kommentar"),
    ]);
  }

  /** 400 som peker på `id`, så neste bunt får 200. */
  function rejectThenAck(state: OutboxState, id: string) {
    const first = take(state);
    const afterReject = setAsideBatch(first.state, { table: "trial_answers", id }, AT);
    const second = take(afterReject.state);
    return { afterReject, second, afterAck: ackBatch(second.state) };
  }

  it.each([
    ["først", ANSWER_X],
    ["i midten", ANSWER_Y],
    ["sist", ANSWER_Z],
  ])("giftig endring %s: legges til side, resten sendes og kvitteres", (_where, poisonId) => {
    const { afterReject, second, afterAck } = rejectThenAck(threeAnswers(), poisonId);

    expect(afterReject.setAside.map((entry) => entry.id)).toEqual([poisonId]);
    expect(afterReject.state.inFlight).toBeNull();
    // Resten sendes med en gang, uten den giftige.
    expect(second.batch.map((entry) => entry.id)).not.toContain(poisonId);
    expect(second.batch).toHaveLength(2);
    // Etter 200: bare den giftige ligger igjen, med merket.
    expect(afterAck.entries).toHaveLength(1);
    expect(afterAck.entries[0]).toMatchObject({ id: poisonId, setAside: { at: AT } });
  });

  it("alle køoppføringer med samme table+id i bunten legges til side", () => {
    // Den første er underveis når den andre skrives, så de blir to oppføringer for samme rad.
    let state = enqueueAll(createOutboxState(), [
      answerEntry(ANSWER_X, "general_description", "Fukt"),
      formEntry(),
    ]);
    const { state: sending } = take(state);
    state = enqueue(
      keepBatch(enqueue(sending, answerEntry(ANSWER_X, "general_description", "Fukt i kjeller"))),
      formEntry(FORM, "Nytt navn"),
    );
    const sameRow = state.entries.filter((entry) => entry.id === ANSWER_X);
    expect(sameRow).toHaveLength(2);

    const { state: again } = take(state);
    const result = setAsideBatch(again, { table: "trial_answers", id: ANSWER_X }, AT);
    expect(result.setAside.map((entry) => entry.seq).sort()).toEqual(
      sameRow.map((entry) => entry.seq).sort(),
    );
    const next = take(result.state);
    expect(next.batch.map((entry) => entry.table)).toEqual(["trial_forms"]);
  });

  it("400 uten endring og bunt med én endring: legges til side", () => {
    const state = enqueueAll(createOutboxState(), [answerEntry(ANSWER_X, "floors", 2)]);
    const result = setAsideBatch(take(state).state, null, AT);
    expect(result.setAside).toHaveLength(1);
    expect(result.state.entries[0]!.setAside).toEqual({ at: AT });
    expect(result.state.inFlight).toBeNull();
  });

  it("400 uten endring og flere i bunten: nytt forsøk, ingenting lagt til side", () => {
    const sending = take(threeAnswers()).state;
    const result = setAsideBatch(sending, null, AT);
    expect(result.setAside).toEqual([]);
    expect(result.state).toEqual(keepBatch(sending));
    expect(result.state.entries.some((entry) => entry.setAside)).toBe(false);
  });

  it("400 med endring som ikke finnes i bunten: nytt forsøk", () => {
    const sending = take(threeAnswers()).state;
    const result = setAsideBatch(sending, { table: "trial_answers", id: PHOTO }, AT);
    expect(result.setAside).toEqual([]);
    expect(result.state).toEqual(keepBatch(sending));
    // Samme id i en annen tabell er ikke samme endring.
    const otherTable = setAsideBatch(sending, { table: "trial_photos", id: ANSWER_X }, AT);
    expect(otherTable.setAside).toEqual([]);
  });

  it("uten bunt underveis gjør setAsideBatch ingenting", () => {
    const state = threeAnswers();
    expect(setAsideBatch(state, { table: "trial_answers", id: ANSWER_X }, AT).state).toBe(state);
  });

  it("kroppen i 400-svaret leses forsiktig", () => {
    expect(
      rejectedChangeOf({
        feil: "Kunne ikke lagre.",
        endring: { id: ANSWER_X, table: "trial_answers", field_key: "general_description" },
      }),
    ).toEqual({ id: ANSWER_X, table: "trial_answers" });
    expect(rejectedChangeOf({ feil: "Kunne ikke lagre." })).toBeNull();
    expect(rejectedChangeOf({ endring: { id: 1, table: "trial_answers" } })).toBeNull();
    expect(rejectedChangeOf(null)).toBeNull();
    expect(rejectedChangeOf("tekst")).toBeNull();
  });

  it("lagt til side slettes aldri, heller ikke etter flere runder med 200", () => {
    let { afterAck: state } = rejectThenAck(threeAnswers(), ANSWER_X);
    for (let round = 0; round < 3; round++) {
      state = enqueue(state, formEntry(FORM, `Navn ${round}`));
      state = ackBatch(take(state).state);
    }
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toMatchObject({ id: ANSWER_X, setAside: { at: AT } });
  });

  it("lagt til side sendes ikke", () => {
    const { afterAck } = rejectThenAck(threeAnswers(), ANSWER_X);
    expect(takeBatch(afterAck, 500)).toBeNull();
  });

  it("lagt til side overlever omlasting (createOutboxState fra lagret kø)", () => {
    const { afterReject } = rejectThenAck(threeAnswers(), ANSWER_Y);
    const stored = JSON.parse(JSON.stringify(afterReject.state.entries)) as OutboxEntry[];
    const reloaded = createOutboxState([...stored].reverse(), afterReject.state.nextSeq);
    expect(reloaded.entries.map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect(reloaded.entries[1]!.setAside).toEqual({ at: AT });
    expect(take(reloaded).batch.map((entry) => entry.id)).toEqual([ANSWER_X, ANSWER_Z]);
  });

  it("ventetallet teller ikke lagt til side", () => {
    const { afterReject } = rejectThenAck(threeAnswers(), ANSWER_Y);
    expect(afterReject.state.entries).toHaveLength(3);
    expect(pendingCount(afterReject.state)).toBe(2);
    expect(unresolvedSetAside(afterReject.state).map((entry) => entry.id)).toEqual([ANSWER_Y]);
  });

  it("ny endring i samme felt blir ny oppføring", () => {
    const { afterAck } = rejectThenAck(threeAnswers(), ANSWER_X);
    const before = afterAck.entries[0]!;
    const next = enqueue(
      afterAck,
      answerEntry(ANSWER_X, "general_description", "Fukt i kjelleren"),
    );
    expect(next.entries).toHaveLength(2);
    expect(next.entries[0]).toEqual(before);
    expect(next.entries[1]!.seq).toBeGreaterThan(before.seq);
    expect(next.entries[1]!.setAside).toBeUndefined();
  });

  it("pendingKeys har feltet så lenge det er lagt til side og ikke løst", () => {
    const { afterAck } = rejectThenAck(threeAnswers(), ANSWER_X);
    expect(pendingKeys(afterAck, localRowKey).has(DESCRIPTION_KEY)).toBe(true);
  });

  it("200 på senere endring i samme felt løser den gamle", () => {
    const { afterAck } = rejectThenAck(threeAnswers(), ANSWER_X);
    const queued = enqueue(
      afterAck,
      answerEntry(ANSWER_X, "general_description", "Fukt i kjelleren"),
    );
    const resolvedState = ackBatch(take(queued).state);

    expect(resolvedState.entries).toHaveLength(1);
    expect(resolvedState.entries[0]).toMatchObject({
      id: ANSWER_X,
      setAside: { at: AT, resolved: true },
    });
    expect(pendingKeys(resolvedState, localRowKey).has(DESCRIPTION_KEY)).toBe(false);
    expect(unresolvedSetAside(resolvedState)).toEqual([]);
    expect(newlyResolved(queued, resolvedState).map((entry) => entry.id)).toEqual([ANSWER_X]);
    // Et løst merke sendes heller ikke og teller ikke.
    expect(takeBatch(resolvedState, 500)).toBeNull();
    expect(pendingCount(resolvedState)).toBe(0);
  });

  it("200 på samme felt med ny id (svar nøkles på skjema og felt) løser også", () => {
    const { afterAck } = rejectThenAck(threeAnswers(), ANSWER_X);
    const queued = enqueue(afterAck, answerEntry(PHOTO, "general_description", "Ny rad"));
    const resolvedState = ackBatch(take(queued).state);
    expect(resolvedState.entries[0]!.setAside?.resolved).toBe(true);
  });

  it("200 på et annet felt løser ikke", () => {
    const { afterAck } = rejectThenAck(threeAnswers(), ANSWER_X);
    const queued = enqueue(afterAck, answerEntry(ANSWER_Y, "building_year", 1986));
    const after = ackBatch(take(queued).state);
    expect(after.entries[0]!.setAside?.resolved).toBeUndefined();
    expect(pendingKeys(after, localRowKey).has(DESCRIPTION_KEY)).toBe(true);
    expect(newlyResolved(queued, after)).toEqual([]);
  });

  it("shouldAckBatch er uendret: bare 200 slipper bunten", () => {
    expect(shouldAckBatch(200)).toBe(true);
    for (const status of [201, 204, 400, 401, 403, 409, 413, 500, 503, undefined]) {
      expect(shouldAckBatch(status)).toBe(false);
    }
  });
});

// Funn T-0001: endringer som er lagt til side (docs/agenter/oppgaver/rett-t0001-synkko.md
// Omfang 6–7, testplan avsnitt 1c, 24–32). Merket `setAside` ligger på oppføringen i køen. Her
// prøves de rene funksjonene med oppføringer som allerede har merket; hvordan merket settes ved
// 400, prøves gjennom lageret i trial-store-set-aside.test.ts. Alle data er oppdiktet.
type SetAsideEntry = OutboxEntry & { setAside?: { at: string; resolved?: boolean } };

describe("endringskøen: lagt til side (T-0001)", () => {
  const AT = "2026-11-11T09:00:00.000Z";
  const answerKey = localRowKey("trial_answers", {
    id: ANSWER_X,
    trial_form_id: FORM,
    field_key: "general_description",
  });

  /** Kø der svaret på «Generell beskrivelse» (seq 2) er lagt til side. */
  function withSetAside(resolved?: boolean): OutboxState {
    const poisoned: SetAsideEntry = {
      ...answerEntry(ANSWER_X, "general_description", "Fukt\u0000 i kjeller"),
      seq: 2,
      setAside: resolved === undefined ? { at: AT } : { at: AT, resolved },
    };
    return createOutboxState([
      { ...formEntry(), seq: 1 },
      poisoned,
      { ...answerEntry(ANSWER_Y, "building_year", 1985), seq: 3 },
    ]);
  }

  it("lagt til side sendes ikke", () => {
    const state = withSetAside();
    const { batch } = take(state);
    expect(batch.map((entry) => entry.seq)).toEqual([1, 3]);

    // Står bare lagt-til-side-oppføringer igjen, gir takeBatch ingen bunt
    const onlySetAside = createOutboxState(state.entries.filter((entry) => entry.seq === 2));
    expect(takeBatch(onlySetAside, 500)).toBeNull();
  });

  it("lagt til side slettes aldri av ackBatch for andre endringer", () => {
    let state = withSetAside();
    for (let round = 0; round < 3; round++) {
      state = enqueue(state, answerEntry(ANSWER_Y, "building_year", 1990 + round));
      const { state: sending } = take(state);
      state = ackBatch(sending);
    }
    const kept = state.entries.find((entry) => entry.seq === 2) as SetAsideEntry | undefined;
    expect(kept, "oppføringen som er lagt til side").toBeDefined();
    expect(kept!.setAside?.at).toBe(AT);
    expect(kept!.data.value).toBe(JSON.stringify("Fukt\u0000 i kjeller"));
  });

  it("lagt til side overlever omlasting (createOutboxState fra lagret kø)", () => {
    const state = withSetAside();
    const stored = JSON.parse(JSON.stringify(state.entries)) as SetAsideEntry[];
    // Lagret i tilfeldig rekkefølge (IndexedDB), lest inn på nytt
    const reloaded = createOutboxState([stored[2]!, stored[0]!, stored[1]!]);
    expect(reloaded.entries.map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect((reloaded.entries[1] as SetAsideEntry).setAside).toEqual({ at: AT });
    expect(reloaded.nextSeq).toBeGreaterThan(3);
  });

  it("ny endring i samme felt blir ny oppføring og fletter ikke inn i den som er lagt til side", () => {
    const state = withSetAside();
    const next = enqueue(state, answerEntry(ANSWER_X, "general_description", "Fukt i kjeller"));
    expect(next.entries).toHaveLength(4);
    const old = next.entries.find((entry) => entry.seq === 2)!;
    expect(old.data.value).toBe(JSON.stringify("Fukt\u0000 i kjeller"));
    const added = next.entries.find((entry) => entry.seq !== 2 && entry.id === ANSWER_X)!;
    expect(added).toBeDefined();
    expect(added.seq).toBeGreaterThan(3);
    expect(added.data.value).toBe(JSON.stringify("Fukt i kjeller"));
    expect((added as SetAsideEntry).setAside).toBeUndefined();
    // Den nye sendes, den gamle ikke
    const seqs = take(next).batch.map((entry) => entry.seq);
    expect(seqs).toContain(added.seq);
    expect(seqs).not.toContain(2);
  });

  it("pendingKeys har feltet så lenge det er lagt til side og ikke løst", () => {
    expect(pendingKeys(withSetAside(), localRowKey).has(answerKey)).toBe(true);
    expect(pendingKeys(withSetAside(false), localRowKey).has(answerKey)).toBe(true);
  });

  it("løst (setAside.resolved) er ute av pendingKeys, men ligger fortsatt i køen", () => {
    const state = withSetAside(true);
    expect(pendingKeys(state, localRowKey).has(answerKey)).toBe(false);
    expect(state.entries.some((entry) => entry.seq === 2)).toBe(true);
    // De andre nøklene er der som før
    expect(pendingKeys(state, localRowKey).has(localRowKey("trial_forms", { id: FORM }))).toBe(
      true,
    );
  });

  it("serverens svar overskriver ikke et felt som er lagt til side og ikke løst", () => {
    const local = {
      id: ANSWER_X,
      trial_form_id: FORM,
      field_key: "general_description",
      value: JSON.stringify("Fukt\u0000 i kjeller"),
      text_state: null,
    };
    const incoming = { ...local, value: JSON.stringify("Fukt i kjeller") };
    const result = applyIncoming(
      "trial_answers",
      [local],
      [{ table: "trial_answers", kind: "update", key: answerKey, row: incoming }],
      pendingKeys(withSetAside(), localRowKey),
    );
    expect(result.rows[0]!.value).toBe(JSON.stringify("Fukt\u0000 i kjeller"));
    expect(result.skippedKeys).toEqual([answerKey]);
  });

  it("shouldAckBatch er uendret: bare 200 slipper bunten, også ved 400", () => {
    expect(shouldAckBatch(200)).toBe(true);
    for (const status of [201, 204, 400, 401, 403, 409, 413, 500, 503, undefined]) {
      expect(shouldAckBatch(status), String(status)).toBe(false);
    }
  });
});
