import { describe, expect, it } from "vitest";
import { TRIAL_SYNC_LIMITS } from "../../server/types";
import { createTextState } from "../../text-merge";
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
  shouldAckBatch,
  takeBatch,
} from "./outbox";
import { parseShapeMessages } from "./shape-messages";

// Endringskøen for kandidat 2 (ElectricSQL): ren tilstandsmaskin, ingen DOM og ingen IndexedDB.
// Testplan: docs/funksjoner/fase1-kandidat-electricsql-testplan.md avsnitt 2.1, med navnene fra
// «Avgjørelser før bygging» pkt. 1 i oppgavekortet (rene funksjoner over `OutboxState`).
// Hovedmål: reklamasjoner (ingenting går tapt mellom befaring og rapport).

const FORM = "0190a1b2-c3d4-7e5f-8a6b-000000000001";
const ANSWER_X = "0190a1b2-c3d4-7e5f-8a6b-0000000000a1";

type NewEntry = Omit<OutboxEntry, "seq">;

function formEntry(id = FORM, name = "Testskjema 1"): NewEntry {
  return { op: "PUT", table: "trial_forms", id, data: { name } };
}

function answerEntry(
  value: unknown,
  id = ANSWER_X,
  fieldKey = "floors",
  op: NewEntry["op"] = "PUT",
): NewEntry {
  const data =
    op === "PATCH"
      ? { value: JSON.stringify(value) }
      : {
          trial_form_id: FORM,
          field_key: fieldKey,
          value: JSON.stringify(value),
          text_state: null,
          device_id: "enhet-1",
        };
  return { op, table: "trial_answers", id, data };
}

function photoEntry(id = "0190a1b2-c3d4-7e5f-8a6b-0000000000b1"): NewEntry {
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
  return entries.reduce((s, e) => enqueue(s, e), state);
}

/** Tar ut en bunt og feiler tydelig hvis køen ikke ga noen. */
function take(state: OutboxState, limit: number = TRIAL_SYNC_LIMITS.maxOperationsPerBatch) {
  const result = takeBatch(state, limit);
  expect(result, "takeBatch ga ingen bunt").not.toBeNull();
  return result!;
}

describe("endringskøen (outbox)", () => {
  it("enqueue gir stigende seq og takeBatch gir operasjonene i seq-rekkefølge", () => {
    const state = enqueueAll(createOutboxState(), [formEntry(), answerEntry(7), photoEntry()]);
    const { batch } = take(state, 500);
    expect(batch.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(batch.map((e) => e.table)).toEqual(["trial_forms", "trial_answers", "trial_photos"]);
  });

  it("enqueue på samme (tabell, id) slår sammen og beholder opprinnelig seq", () => {
    const state = enqueueAll(createOutboxState(), [answerEntry(1), formEntry(), answerEntry(2)]);
    expect(state.entries).toHaveLength(2);
    const answer = state.entries.find((e) => e.table === "trial_answers")!;
    expect(answer.seq).toBe(1);
    expect(answer.data.value).toBe(JSON.stringify(2));
    // Koalescering uten omsortering: skjemaet (seq 2) kommer etter svaret
    const { batch } = take(state);
    expect(batch.map((e) => e.table)).toEqual(["trial_answers", "trial_forms"]);
  });

  it("PATCH etter PUT på samme rad slås sammen til én PUT med alle kolonner", () => {
    const state = enqueueAll(createOutboxState(), [
      answerEntry(1),
      answerEntry(5, ANSWER_X, "floors", "PATCH"),
    ]);
    expect(state.entries).toHaveLength(1);
    const [entry] = state.entries;
    expect(entry!.op).toBe("PUT");
    expect(entry!.data).toEqual({
      trial_form_id: FORM,
      field_key: "floors",
      value: JSON.stringify(5),
      text_state: null,
      device_id: "enhet-1",
    });
  });

  // «skjemaet sendes alltid før svarene som peker på det» er erstattet av e2e-testen
  // «createForm legger skjemaet i køen før første svar» (oppgavekortet, avgjørelse før bygging 1).

  it("takeBatch gir høyst max operasjoner og tar aldri ut av køen", () => {
    const entries = Array.from({ length: 600 }, (_, i) =>
      answerEntry(i, `0190a1b2-c3d4-7e5f-8a6b-${String(i).padStart(12, "0")}`, `f${i}`),
    );
    const state = enqueueAll(createOutboxState(), entries);
    const first = take(state, 500);
    expect(first.batch).toHaveLength(500);
    expect(first.state.entries).toHaveLength(600);

    // Ingen skjult «under sending»-tilstand som kan gå tapt ved omlasting: lageret lagrer bare
    // operasjonene og nextSeq, og etter omlasting gir køen samme bunt igjen.
    const reloaded = createOutboxState(
      JSON.parse(JSON.stringify(first.state.entries)) as OutboxEntry[],
      first.state.nextSeq,
    );
    const again = take(reloaded, 500);
    expect(again.batch.map((e) => e.seq)).toEqual(first.batch.map((e) => e.seq));

    // Og etter keepBatch (svar som ikke var 200) gir neste takeBatch samme bunt
    const kept = keepBatch(first.state);
    expect(take(kept, 500).batch.map((e) => e.seq)).toEqual(first.batch.map((e) => e.seq));
  });

  it("ackBatch fjerner bare operasjonene i bunten", () => {
    const state = enqueueAll(createOutboxState(), [formEntry(), answerEntry(7), photoEntry()]);
    const { state: sending } = take(state, 2);
    const after = ackBatch(sending);
    expect(after.entries).toHaveLength(1);
    expect(after.entries[0]!.seq).toBe(3);
    expect(after.entries[0]!.table).toBe("trial_photos");
    expect(after.inFlight).toBeNull();
  });

  it("ackBatch etter en ny enqueue på samme nøkkel fjerner ikke den nye endringen", () => {
    const state = enqueue(createOutboxState(), answerEntry(1));
    const { state: sending, batch } = take(state);
    expect(batch[0]!.data.value).toBe(JSON.stringify(1));

    // Brukeren skriver mens bunten er underveis
    const typed = enqueue(sending, answerEntry(2));
    const after = ackBatch(typed);

    expect(after.entries).toHaveLength(1);
    const left = after.entries[0]!;
    expect(left.id).toBe(ANSWER_X);
    expect(left.data.value).toBe(JSON.stringify(2));
    expect(left.seq).toBeGreaterThan(batch[0]!.seq);
  });

  it("keepBatch endrer ingenting", () => {
    const state = enqueueAll(createOutboxState(), [formEntry(), answerEntry(7)]);
    const before = JSON.parse(JSON.stringify(state.entries)) as OutboxEntry[];
    const { state: sending } = take(state);
    const kept = keepBatch(sending);
    expect(kept.entries).toEqual(before);
    expect(kept.entries).toHaveLength(2);
    expect(kept.inFlight).toBeNull();
  });

  it("ackBatch kalles bare ved 200: hjelperen shouldAckBatch", () => {
    expect(shouldAckBatch(200)).toBe(true);
    for (const status of [201, 204, 400, 401, 403, 409, 429, 500, 502, undefined]) {
      expect(shouldAckBatch(status), String(status)).toBe(false);
    }
  });

  it("tom kø gir tom bunt og ingen feil", () => {
    const empty = createOutboxState();
    const taken = takeBatch(empty, 500);
    // Signaturen sier null for tom kø; en tom liste godtas også (testplanen sa «[]»)
    expect(taken === null || taken.batch.length === 0).toBe(true);
    expect(() => ackBatch(empty)).not.toThrow();
    expect(ackBatch(empty).entries).toEqual([]);
    expect(() => keepBatch(empty)).not.toThrow();
  });

  it("må-hente-på-nytt rører aldri køen", () => {
    const state = enqueueAll(createOutboxState(), [formEntry(), answerEntry(7)]);
    const snapshot = JSON.parse(JSON.stringify(state)) as OutboxState;

    // 409 / must-refetch fra Electric: lageret sletter shape_state og de synkede radene for
    // tabellen og henter fra offset=-1. Det eneste køen brukes til da, er pendingKeys.
    const parsed = parseShapeMessages("trial_answers", [{ headers: { control: "must-refetch" } }]);
    expect(parsed.mustRefetch).toBe(true);
    expect(parsed.changes).toEqual([]);

    const keys = pendingKeys(state, localRowKey);
    const ownKey = localRowKey("trial_answers", {
      id: ANSWER_X,
      trial_form_id: FORM,
      field_key: "floors",
    });
    expect(keys.has(ownKey)).toBe(true);

    // Full henting på nytt (tom lokal tabell) med en eldre serververdi for samme nøkkel
    const refetched = applyIncoming(
      "trial_answers",
      [],
      [
        {
          table: "trial_answers",
          kind: "insert",
          key: ownKey,
          row: {
            id: ANSWER_X,
            trial_form_id: FORM,
            field_key: "floors",
            value: "3",
            text_state: null,
            device_id: "annen-enhet",
          },
        },
      ],
      keys,
    );
    expect(refetched.skippedKeys).toContain(ownKey);
    expect(state).toEqual(snapshot);
  });

  it("tilstanden tåler JSON-rundtur", () => {
    const state = enqueueAll(createOutboxState(), [
      formEntry(),
      answerEntry(7),
      {
        op: "PUT",
        table: "trial_answers",
        id: "0190a1b2-c3d4-7e5f-8a6b-0000000000a2",
        data: {
          trial_form_id: FORM,
          field_key: "roof_description",
          value: JSON.stringify("Oppdiktet tekst"),
          text_state: createTextState("Oppdiktet tekst"),
          device_id: "enhet-1",
        },
      },
      photoEntry(),
    ]);
    const roundTrip = JSON.parse(JSON.stringify(state.entries)) as OutboxEntry[];
    expect(roundTrip).toEqual(state.entries);
    const restored = createOutboxState(roundTrip, state.nextSeq);
    expect(restored.entries).toEqual(state.entries);
    expect(restored.nextSeq).toBe(state.nextSeq);
    expect(take(restored).batch).toEqual(take(state).batch);
  });

  it("ventetiden ved feil dobles fra 5 s til høyst 60 s og nullstilles ved 200", () => {
    // RetryDelayMs i sync/types.ts: `attempt` starter på 0 etter en feil, og nullstilles ved 200
    // (da kalles den ikke før neste feil).
    expect(RETRY_DELAY_MIN_MS).toBe(5_000);
    expect(RETRY_DELAY_MAX_MS).toBe(60_000);
    expect(retryDelayMs(0)).toBe(5_000);
    expect(retryDelayMs(1)).toBe(10_000);
    expect(retryDelayMs(2)).toBe(20_000);
    expect(retryDelayMs(3)).toBe(40_000);
    expect(retryDelayMs(4)).toBe(60_000);
    expect(retryDelayMs(5)).toBe(60_000);
    expect(retryDelayMs(1_000)).toBe(60_000);
    for (let attempt = 0; attempt < 20; attempt++) {
      expect(retryDelayMs(attempt)).toBeGreaterThanOrEqual(5_000);
      expect(retryDelayMs(attempt)).toBeLessThanOrEqual(60_000);
    }
  });

  it("pendingKeys tar med operasjoner som er underveis, og svar nøkles på skjema og felt", () => {
    const state = enqueueAll(createOutboxState(), [formEntry(), answerEntry(7)]);
    const { state: sending } = take(state);
    const keys = pendingKeys(sending, localRowKey);
    expect(keys.has(localRowKey("trial_forms", { id: FORM }))).toBe(true);
    // Samme skjema og felt med en annen id er samme nøkkel; annet felt er en annen nøkkel
    const same = localRowKey("trial_answers", {
      id: "0190a1b2-c3d4-7e5f-8a6b-0000000000ff",
      trial_form_id: FORM,
      field_key: "floors",
    });
    const other = localRowKey("trial_answers", {
      id: ANSWER_X,
      trial_form_id: FORM,
      field_key: "building_year",
    });
    expect(keys.has(same)).toBe(true);
    expect(keys.has(other)).toBe(false);
    expect(ackBatch(sending).entries).toEqual([]);
    expect(pendingKeys(ackBatch(sending), localRowKey).size).toBe(0);
  });
});
