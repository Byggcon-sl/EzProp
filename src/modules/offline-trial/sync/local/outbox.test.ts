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
  pendingCount,
  pendingKeys,
  retryDelayMs,
  setAsideFields,
  setAsideFromRejection,
  shouldAckBatch,
  takeBatch,
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

// Funn T-0001: én endring serveren avviser med 400, legges til side, og resten sendes videre.
// Testplan docs/agenter/oppgaver/rett-t0001-giftig-endring-testplan.md avsnitt 1c (16–32).
describe("endring lagt til side ved 400 (setAsideFromRejection)", () => {
  const AT = "2026-11-11T10:00:00.000Z";
  const ANSWER_Z = "0192d3a0-0000-7000-8000-0000000000a3";
  const keyOf = (fieldKey: string) =>
    localRowKey("trial_answers", { trial_form_id: FORM, field_key: fieldKey });

  /** Tre svar i køen: Generell beskrivelse, Byggeår og Bad – beskrivelse. */
  function threeAnswers(): OutboxState {
    return enqueueAll(createOutboxState(), [
      answerEntry(ANSWER_X, "general_description", "Fukt i kjeller"),
      answerEntry(ANSWER_Y, "building_year", 1985),
      answerEntry(ANSWER_Z, "bathroom_description", "Tett"),
    ]);
  }

  const rejection = (entry: OutboxEntry) => ({
    feil: "Endringen kunne ikke lagres.",
    endring: { id: entry.id, table: entry.table, field_key: entry.data.field_key },
  });

  /** Én runde: bunt, 400 for oppføringen på `poisonIndex`, så ny bunt med 200. */
  function roundWithPoison(state: OutboxState, poisonIndex: number) {
    const first = take(state);
    const poison = first.batch[poisonIndex]!;
    const afterReject = setAsideFromRejection(first.state, 400, rejection(poison), AT);
    expect(afterReject).not.toBeNull();
    const second = take(afterReject!);
    expect(second.batch.map((entry) => entry.seq)).not.toContain(poison.seq);
    expect(second.batch).toHaveLength(2);
    return { poison, state: ackBatch(second.state) };
  }

  it.each([
    ["først", 0],
    ["i midten", 1],
    ["sist", 2],
  ])("giftig endring %s: legges til side, resten sendes og kvitteres", (_, index) => {
    const { poison, state } = roundWithPoison(threeAnswers(), index);
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]!.seq).toBe(poison.seq);
    expect(state.entries[0]!.setAside).toEqual({ at: AT });
    expect(state.entries[0]!.data).toEqual(poison.data);
    expect(takeBatch(state, 500)).toBeNull();
  });

  it("alle køoppføringer med samme table+id i bunten legges til side", () => {
    // To oppføringer for samme rad: den andre kom mens den første var underveis.
    let state = enqueueAll(createOutboxState(), [
      answerEntry(ANSWER_X, "general_description", "a"),
    ]);
    state = take(state).state;
    state = enqueueAll(state, [
      answerEntry(ANSWER_X, "general_description", "b", "PATCH"),
      answerEntry(ANSWER_Y, "building_year", 1985),
    ]);
    state = keepBatch(state);
    const taken = take(state);
    expect(taken.batch).toHaveLength(3);
    const next = setAsideFromRejection(taken.state, 400, rejection(taken.batch[0]!), AT)!;
    expect(next.entries.filter((entry) => entry.setAside).map((entry) => entry.seq)).toEqual([
      1, 2,
    ]);
    expect(take(next).batch.map((entry) => entry.id)).toEqual([ANSWER_Y]);
  });

  it("400 uten endring og bunt med én endring: legges til side", () => {
    const state = take(enqueueAll(createOutboxState(), [formEntry()])).state;
    const next = setAsideFromRejection(state, 400, { feil: "Ugyldig." }, AT)!;
    expect(next.entries[0]!.setAside).toEqual({ at: AT });
    expect(next.inFlight).toBeNull();
    // Kropp som ikke kunne leses (ugyldig JSON gir null), gir det samme.
    expect(setAsideFromRejection(state, 400, null, AT)!.entries[0]!.setAside).toEqual({ at: AT });
  });

  it("400 uten endring og flere i bunten: nytt forsøk, ingenting lagt til side", () => {
    const { state } = take(threeAnswers());
    expect(setAsideFromRejection(state, 400, { feil: "Ugyldig." }, AT)).toBeNull();
    const kept = keepBatch(state);
    expect(kept.entries.some((entry) => entry.setAside)).toBe(false);
    expect(kept.entries).toHaveLength(3);
  });

  it("400 med endring som ikke finnes i bunten: nytt forsøk", () => {
    const { state } = take(threeAnswers());
    const body = {
      feil: "x",
      endring: { id: "0192d3a0-0000-7000-8000-0000000000ff", table: "trial_answers" },
    };
    expect(setAsideFromRejection(state, 400, body, AT)).toBeNull();
    // Ukjent tabell regnes som uten endring (flere i bunten: nytt forsøk).
    const odd = { feil: "x", endring: { id: ANSWER_X, table: "users" } };
    expect(setAsideFromRejection(state, 400, odd, AT)).toBeNull();
  });

  it.each([401, 403, 409, 413, 500, 503, undefined])(
    "%s gir nytt forsøk og legger ingenting til side",
    (status) => {
      const { state, batch } = take(threeAnswers());
      expect(setAsideFromRejection(state, status, rejection(batch[0]!), AT)).toBeNull();
      const kept = keepBatch(state);
      expect(kept.entries.some((entry) => entry.setAside)).toBe(false);
      expect(kept.entries).toHaveLength(3);
    },
  );

  it("lagt til side slettes aldri, heller ikke etter flere runder med 200", () => {
    const first = roundWithPoison(threeAnswers(), 0);
    let state = first.state;
    for (let round = 0; round < 3; round++) {
      state = enqueue(state, answerEntry(ANSWER_Y, "building_year", 1990 + round));
      state = ackBatch(take(state).state);
    }
    expect(state.entries.map((entry) => entry.seq)).toEqual([first.poison.seq]);
  });

  it("lagt til side sendes ikke, og ventetallet teller den ikke", () => {
    const { state } = roundWithPoison(threeAnswers(), 0);
    expect(takeBatch(state, 500)).toBeNull();
    expect(pendingCount(state)).toBe(0);
    const more = enqueue(state, answerEntry(ANSWER_Y, "building_year", 2000));
    expect(pendingCount(more)).toBe(1);
    expect(take(more).batch).toHaveLength(1);
  });

  it("ventetallet gir 2 når 3 ligger og 1 er lagt til side", () => {
    const { state } = take(threeAnswers());
    const next = setAsideFromRejection(state, 400, rejection(state.entries[1]!), AT)!;
    expect(next.entries).toHaveLength(3);
    expect(pendingCount(next)).toBe(2);
  });

  it("lagt til side overlever omlasting", () => {
    const { state } = roundWithPoison(threeAnswers(), 1);
    const more = enqueue(state, formEntry());
    const reloaded = createOutboxState(structuredClone([...more.entries]).reverse(), more.nextSeq);
    expect(reloaded.entries).toEqual(more.entries);
    expect(reloaded.entries[0]!.setAside).toEqual({ at: AT });
    expect(take(reloaded).batch.map((entry) => entry.table)).toEqual(["trial_forms"]);
  });

  it("ny endring i samme felt blir ny oppføring", () => {
    const { poison, state } = roundWithPoison(threeAnswers(), 0);
    const next = enqueue(state, answerEntry(ANSWER_X, "general_description", "Ny tekst"));
    expect(next.entries).toHaveLength(2);
    expect(next.entries[0]).toEqual({ ...poison, setAside: { at: AT } });
    expect(next.entries[1]!.seq).toBeGreaterThan(poison.seq);
    expect(next.entries[1]!.setAside).toBeUndefined();
  });

  it("pendingKeys har feltet så lenge det er lagt til side og ikke løst", () => {
    const { state } = roundWithPoison(threeAnswers(), 0);
    expect(pendingKeys(state, localRowKey).has(keyOf("general_description"))).toBe(true);
  });

  it("200 på senere endring i samme felt løser den gamle", () => {
    const { poison, state } = roundWithPoison(threeAnswers(), 0);
    // PATCH uten nøkkelkolonner: nøkkelen lånes fra den gamle oppføringen på samme rad.
    const next = ackBatch(
      take(enqueue(state, answerEntry(ANSWER_X, "general_description", "Ny", "PATCH"))).state,
    );
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0]!.seq).toBe(poison.seq);
    expect(next.entries[0]!.setAside).toEqual({ at: AT, resolved: true });
    expect(pendingKeys(next, localRowKey).has(keyOf("general_description"))).toBe(false);
    expect(setAsideFields(next)).toEqual([]);
  });

  it("200 på et annet felt løser ikke", () => {
    const { state } = roundWithPoison(threeAnswers(), 0);
    const next = ackBatch(take(enqueue(state, answerEntry(ANSWER_Y, "floors", 2))).state);
    expect(next.entries[0]!.setAside?.resolved).toBeUndefined();
    expect(pendingKeys(next, localRowKey).has(keyOf("general_description"))).toBe(true);
  });

  it("setAsideFields gir hvert felt én gang, i rekkefølge, og null for skjemaet", () => {
    let state = enqueueAll(createOutboxState(), [
      formEntry(),
      photoEntry(),
      answerEntry(ANSWER_X, "general_description", "a"),
    ]);
    state = take(state).state;
    state = keepBatch(enqueue(state, answerEntry(ANSWER_X, "general_description", "b")));
    state = {
      ...state,
      entries: state.entries.map((entry) => ({ ...entry, setAside: { at: AT } })),
    };
    expect(setAsideFields(state)).toEqual([
      { table: "trial_forms", fieldKey: null },
      { table: "trial_photos", fieldKey: "cover_photo" },
      { table: "trial_answers", fieldKey: "general_description" },
    ]);
  });

  it("shouldAckBatch er uendret: bare 200 slipper bunten", () => {
    expect(shouldAckBatch(200)).toBe(true);
    for (const status of [201, 204, 400, 500, undefined]) {
      expect(shouldAckBatch(status)).toBe(false);
    }
  });
});

// --- Funn T-0001: én endring som ikke kan lagres, stopper ikke køen ---------------------------
//
// docs/agenter/oppgaver/rett-t0001-giftig-endring.md Omfang 5–7, testplan avsnitt 1c (16–32).
// Utvikleren valgte `setAsideFromRejection(state, status, body, at)`, som gir `null` når bunten
// skal prøves på nytt som før. Hjelperen `setAside` under sender et 400-svar med `endring` (eller
// uten) og bruker `keepBatch` ved `null`, så `inFlight` alltid nullstilles. `pendingCount` er
// tallet bak «Venter: N endringer» (uten lagt til side). `ackBatch` merker eldre lagt-til-side på
// samme `localRowKey` som `setAside.resolved = true`.
// Alle data er oppdiktet.

type SetAsideMark = { at: string; resolved?: boolean };
type MarkedEntry = OutboxEntry & { setAside?: SetAsideMark };
type ChangeRef = { id: string; table: string; field_key?: string } | null;

const AT = "2026-11-11T09:00:00.000Z";
const ANSWER_Z = "0192d3a0-0000-7000-8000-0000000000a3";

function setAside(state: OutboxState, change: ChangeRef, at = AT): OutboxState {
  const body = change ? { feil: "Endringen kunne ikke lagres.", endring: change } : {};
  return setAsideFromRejection(state, 400, body, at) ?? keepBatch(state);
}

function marked(state: OutboxState): MarkedEntry[] {
  return state.entries as MarkedEntry[];
}

function setAsideIds(state: OutboxState): string[] {
  return marked(state)
    .filter((entry) => entry.setAside)
    .map((entry) => entry.id);
}

/** Tre svar: Generell beskrivelse (X), Byggeår (Y), Samlet kommentar (Z). */
function threeAnswers(): OutboxState {
  return enqueueAll(createOutboxState(), [
    answerEntry(ANSWER_X, "general_description", "Fukt\u0000 i kjeller"),
    answerEntry(ANSWER_Y, "building_year", 1985),
    answerEntry(ANSWER_Z, "summary", "Oppdiktet samlet kommentar"),
  ]);
}

const IDS = [ANSWER_X, ANSWER_Y, ANSWER_Z];

function keyOfAnswer(id: string, state: OutboxState): string {
  const entry = state.entries.find((candidate) => candidate.id === id)!;
  return localRowKey(entry.table, { ...entry.data, id });
}

describe("endringskøen: lagt til side ved 400 (T-0001)", () => {
  it.each([
    ["16 giftig endring først: legges til side, resten sendes og kvitteres", 0],
    ["17 giftig endring i midten", 1],
    ["18 giftig endring sist", 2],
  ] as const)("%s", (_name, index) => {
    const poison = IDS[index]!;
    const sending = take(threeAnswers()).state;

    const afterReject = setAside(sending, { id: poison, table: "trial_answers" });
    expect(afterReject.inFlight).toBeNull();
    expect(setAsideIds(afterReject)).toEqual([poison]);

    const next = take(afterReject);
    expect(next.batch.map((entry) => entry.id)).toEqual(IDS.filter((id) => id !== poison));
    const done = ackBatch(next.state);

    expect(done.entries.map((entry) => entry.id)).toEqual([poison]);
    const [left] = marked(done);
    expect(left!.setAside?.at).toBe(AT);
    expect(left!.data.value).toBe(sending.entries[index]!.data.value);
  });

  it("19 alle køoppføringer med samme table+id i bunten legges til side", () => {
    let state = enqueue(createOutboxState(), answerEntry(ANSWER_X, "general_description", "a"));
    state = take(state).state;
    // Laget mens den første var underveis: ny oppføring for samme rad
    state = enqueue(state, answerEntry(ANSWER_X, "general_description", "ab", "PATCH"));
    state = keepBatch(state);
    state = enqueue(state, answerEntry(ANSWER_Y, "building_year", 1985));
    const sending = take(state);
    expect(sending.batch.map((entry) => entry.id)).toEqual([ANSWER_X, ANSWER_X, ANSWER_Y]);

    const afterReject = setAside(sending.state, { id: ANSWER_X, table: "trial_answers" });

    expect(setAsideIds(afterReject)).toEqual([ANSWER_X, ANSWER_X]);
    const next = take(afterReject);
    expect(next.batch.map((entry) => entry.id)).toEqual([ANSWER_Y]);
  });

  it("19b samme id i en annen tabell legges ikke til side", () => {
    let state = enqueueAll(createOutboxState(), [
      answerEntry(ANSWER_X, "general_description", "a"),
      photoEntry(PHOTO),
    ]);
    state = take(state).state;
    const afterReject = setAside(state, { id: PHOTO, table: "trial_answers" });
    expect(setAsideIds(afterReject)).toEqual([]);
  });

  it("20 400 uten endring og bunt med én endring: legges til side", () => {
    const sending = take(enqueue(createOutboxState(), answerEntry(ANSWER_X, "summary", "x")));
    const afterReject = setAside(sending.state, null);
    expect(afterReject.inFlight).toBeNull();
    expect(setAsideIds(afterReject)).toEqual([ANSWER_X]);
    expect(takeBatch(afterReject, 500)).toBeNull();
  });

  it("21 400 uten endring og flere i bunten: nytt forsøk, ingenting lagt til side", () => {
    const sending = take(threeAnswers());
    const afterReject = setAside(sending.state, null);
    expect(afterReject.inFlight).toBeNull();
    expect(setAsideIds(afterReject)).toEqual([]);
    expect(take(afterReject).batch.map((entry) => entry.id)).toEqual(IDS);
  });

  it("22 400 med endring som ikke finnes i bunten: nytt forsøk", () => {
    let state = enqueue(createOutboxState(), answerEntry(ANSWER_X, "summary", "x"));
    state = take(state).state;
    // Y kom i køen mens X var underveis, og er ikke i bunten
    state = enqueue(state, answerEntry(ANSWER_Y, "building_year", 1985));
    const afterReject = setAside(state, { id: ANSWER_Y, table: "trial_answers" });
    expect(afterReject.inFlight).toBeNull();
    expect(setAsideIds(afterReject)).toEqual([]);

    const unknown = setAside(take(threeAnswers()).state, {
      id: "0192d3a0-0000-7000-8000-0000000000ff",
      table: "trial_answers",
    });
    expect(setAsideIds(unknown)).toEqual([]);
    expect(take(unknown).batch).toHaveLength(3);
  });

  it.each([401, 403, 409, 413, 500, 503, undefined])(
    "23 status %s gir nytt forsøk og legger ingenting til side",
    (status) => {
      const sending = take(threeAnswers()).state;
      expect(shouldAckBatch(status)).toBe(false);
      // Alt annet enn 200 og 400 går til keepBatch, som aldri legger til side. At lageret bare
      // kaller «legg til side» ved 400, vises i trial-store.test.ts (samme nummer).
      const kept = keepBatch(sending);
      expect(setAsideIds(kept)).toEqual([]);
      expect(kept.entries.map((entry) => entry.id)).toEqual(IDS);
      expect(take(kept).batch).toHaveLength(3);
    },
  );

  it("24 lagt til side slettes aldri", () => {
    let state = setAside(take(threeAnswers()).state, { id: ANSWER_X, table: "trial_answers" });
    for (let round = 0; round < 3; round++) {
      state = enqueue(state, answerEntry(ANSWER_Y, "building_year", 1990 + round, "PATCH"));
      state = ackBatch(take(state).state);
    }
    // Også ackBatch uten noe underveis og keepBatch lar den stå
    state = keepBatch(ackBatch(state));
    expect(state.entries.map((entry) => entry.id)).toContain(ANSWER_X);
    expect(marked(state).find((entry) => entry.id === ANSWER_X)!.setAside?.at).toBe(AT);
  });

  it("25 lagt til side sendes ikke", () => {
    let state = setAside(take(threeAnswers()).state, { id: ANSWER_Y, table: "trial_answers" });
    const next = take(state);
    expect(next.batch.map((entry) => entry.id)).not.toContain(ANSWER_Y);
    state = ackBatch(next.state);
    expect(state.entries.map((entry) => entry.id)).toEqual([ANSWER_Y]);
    expect(takeBatch(state, 500)).toBeNull();
  });

  it("26 lagt til side overlever omlasting", () => {
    const state = setAside(take(threeAnswers()).state, { id: ANSWER_Y, table: "trial_answers" });
    const stored = structuredClone(state.entries) as MarkedEntry[];
    // Rekkefølgen fra IndexedDB er ikke gitt
    const reloaded = createOutboxState([...stored].reverse(), state.nextSeq);

    expect(reloaded.entries.map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect(setAsideIds(reloaded)).toEqual([ANSWER_Y]);
    expect(marked(reloaded).find((entry) => entry.id === ANSWER_Y)!.setAside).toEqual({ at: AT });
    expect(take(reloaded).batch.map((entry) => entry.id)).toEqual([ANSWER_X, ANSWER_Z]);
  });

  it("27 ventetallet teller ikke lagt til side", () => {
    const state = setAside(take(threeAnswers()).state, { id: ANSWER_X, table: "trial_answers" });
    expect(state.entries).toHaveLength(3);
    expect(pendingCount(state)).toBe(2);
    expect(pendingCount(threeAnswers())).toBe(3);
    expect(pendingCount(createOutboxState())).toBe(0);
  });

  it("28 ny endring i samme felt blir ny oppføring", () => {
    const state = setAside(take(threeAnswers()).state, { id: ANSWER_X, table: "trial_answers" });
    const oldData = structuredClone(state.entries[0]!.data);
    const next = enqueue(
      state,
      answerEntry(ANSWER_X, "general_description", "Fukt i kjeller", "PATCH"),
    );

    expect(next.entries).toHaveLength(4);
    const forX = marked(next).filter((entry) => entry.id === ANSWER_X);
    expect(forX).toHaveLength(2);
    expect(forX[0]!.setAside).toBeDefined();
    expect(forX[0]!.data).toEqual(oldData);
    expect(forX[1]!.setAside).toBeUndefined();
    expect(forX[1]!.seq).toBe(state.nextSeq);
  });

  it("29 pendingKeys har feltet så lenge det er lagt til side og ikke løst", () => {
    const sending = take(threeAnswers()).state;
    const key = keyOfAnswer(ANSWER_X, sending);
    let state = setAside(sending, { id: ANSWER_X, table: "trial_answers" });
    state = ackBatch(take(state).state);
    expect(state.entries).toHaveLength(1);
    expect(pendingKeys(state, localRowKey).has(key)).toBe(true);
  });

  it("30 200 på senere endring i samme felt løser den gamle", () => {
    const sending = take(threeAnswers()).state;
    const key = keyOfAnswer(ANSWER_X, sending);
    let state = setAside(sending, { id: ANSWER_X, table: "trial_answers" });
    state = ackBatch(take(state).state);
    // Takstmannen skriver feltet om: en PATCH uten nøkkelkolonnene
    state = enqueue(state, answerEntry(ANSWER_X, "general_description", "Fukt i kjeller", "PATCH"));
    state = ackBatch(take(state).state);

    const old = marked(state).find((entry) => entry.id === ANSWER_X);
    expect(old, "den gamle oppføringen skal ikke slettes").toBeDefined();
    expect(old!.setAside?.resolved).toBe(true);
    expect(old!.setAside?.at).toBe(AT);
    expect(pendingKeys(state, localRowKey).has(key)).toBe(false);
    expect(pendingCount(state)).toBe(0);
    expect(takeBatch(state, 500)).toBeNull();
  });

  it("31 200 på et annet felt løser ikke", () => {
    const sending = take(threeAnswers()).state;
    const key = keyOfAnswer(ANSWER_X, sending);
    let state = setAside(sending, { id: ANSWER_X, table: "trial_answers" });
    state = ackBatch(take(state).state);
    state = enqueue(state, answerEntry(ANSWER_Y, "building_year", 1990, "PATCH"));
    state = ackBatch(take(state).state);

    const old = marked(state).find((entry) => entry.id === ANSWER_X)!;
    expect(old.setAside?.resolved).toBeUndefined();
    expect(pendingKeys(state, localRowKey).has(key)).toBe(true);
  });

  it("32 shouldAckBatch er uendret: bare 200 slipper bunten", () => {
    expect(shouldAckBatch(200)).toBe(true);
    for (const status of [201, 204, 400, 401, 403, 409, 413, 500, 503, undefined]) {
      expect(shouldAckBatch(status), String(status)).toBe(false);
    }
  });
});
