import { describe, expect, it } from "vitest";
import { applyTextEdit, createTextState, mergeTextStates, textOf } from "../../text-merge";
import type { IncomingChange, LocalRow } from "../types";
import { applyIncoming } from "./apply-incoming";
import { localRowKey } from "./outbox";

// Innfletting av nedlastede rader (docs/funksjoner/fase1-kandidat-electricsql.md avgjørelse D og
// «Avgjørelser før bygging» 2). Testplan avsnitt 2.2. Ren funksjon: ingen IndexedDB, ingen DOM.
// Teksttilstandene er ekte Yjs-tilstander fra text-merge.ts. Alle data er oppdiktet.

const FORM = "0192d3a0-0000-7000-8000-000000000001";
const LOCAL_ID = "0192d3a0-0000-7000-8000-0000000000a1";
const SERVER_ID = "0192d3a0-0000-7000-8000-0000000000a2";
const NOW = "2026-10-28T10:00:00.000Z";
const LATER = "2026-10-28T10:05:00.000Z";

function answerRow(fieldKey: string, value: unknown, extra: Partial<LocalRow> = {}): LocalRow {
  return {
    id: LOCAL_ID,
    trial_form_id: FORM,
    field_key: fieldKey,
    value: JSON.stringify(value),
    text_state: null,
    device_id: "enhet-1",
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    ...extra,
  };
}

function keyOf(row: LocalRow): string {
  return localRowKey("trial_answers", row);
}

function change(
  kind: IncomingChange["kind"],
  row: LocalRow,
  key: string = keyOf(row),
): IncomingChange {
  return { table: "trial_answers", kind, key, row };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Felles start: tom tekst. Lokal enhet skriver «Taket er tett.», en annen «Merk: ». */
function twoEdits() {
  const base = createTextState("");
  const local = applyTextEdit(base, "Taket er tett.");
  const incoming = applyTextEdit(base, "Merk: ");
  return { local, incoming };
}

describe("applyIncoming (apply-incoming.ts)", () => {
  it("ny rad fra serveren legges til", () => {
    const row = answerRow("floors", 7, { id: SERVER_ID, device_id: "annen-enhet" });
    const result = applyIncoming("trial_answers", [], [change("insert", row)], new Set());
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      id: SERVER_ID,
      trial_form_id: FORM,
      field_key: "floors",
      value: JSON.stringify(7),
    });
    expect(result.skippedKeys).toEqual([]);
  });

  it("oppdatering fra serveren patcher bare kolonnene som kom", () => {
    const textState = createTextState("Oppdiktet");
    const local = answerRow("floors", 2, { text_state: textState, device_id: "enhet-1" });
    const before = clone([local]);
    // Standard replica: update har bare nøkkelen og kolonnene som ble endret
    const result = applyIncoming(
      "trial_answers",
      [local],
      [
        change(
          "update",
          { id: LOCAL_ID, value: JSON.stringify(3), updated_at: LATER },
          keyOf(local),
        ),
      ],
      new Set(),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      id: LOCAL_ID,
      trial_form_id: FORM,
      field_key: "floors",
      value: JSON.stringify(3),
      text_state: textState,
      device_id: "enhet-1",
    });
    // Endrer aldri innputtet
    expect([local]).toEqual(before);
  });

  // Obligatorisk (tap av data)
  it("nedlastet rad legges aldri over en usendt lokal endring", () => {
    const local = answerRow("floors", 7);
    const before = clone([local]);
    const key = keyOf(local);
    const result = applyIncoming(
      "trial_answers",
      [local],
      [
        change("update", {
          ...answerRow("floors", 3),
          device_id: "annen-enhet",
          updated_at: LATER,
        }),
      ],
      new Set([key]),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.value).toBe(JSON.stringify(7));
    expect(result.rows[0]!.device_id).toBe("enhet-1");
    expect(result.skippedKeys).toContain(key);
    expect([local]).toEqual(before);
  });

  // Obligatorisk
  it("usendt tekstendring og innkommende text_state flettes med mergeTextStates", () => {
    const { local: localState, incoming: incomingState } = twoEdits();
    const local = answerRow("roof_description", "Taket er tett.", { text_state: localState });
    const key = keyOf(local);
    const result = applyIncoming(
      "trial_answers",
      [local],
      [
        change("update", {
          ...answerRow("roof_description", "Merk: ", { text_state: incomingState }),
          device_id: "annen-enhet",
          updated_at: LATER,
        }),
      ],
      new Set([key]),
    );
    expect(result.rows).toHaveLength(1);
    const merged = result.rows[0]!;
    const expected = textOf(mergeTextStates(localState, incomingState));
    const text = textOf(String(merged.text_state));
    expect(text).toBe(expected);
    expect(text).toContain("Merk: ");
    expect(text).toContain("Taket er tett.");
    expect(merged.value).toBe(JSON.stringify(text));
  });

  it("innkommende text_state uten usendt lokal endring flettes også", () => {
    const { local: localState, incoming: incomingState } = twoEdits();
    const local = answerRow("roof_description", "Taket er tett.", { text_state: localState });
    const result = applyIncoming(
      "trial_answers",
      [local],
      [
        change("update", {
          ...answerRow("roof_description", "Merk: ", { text_state: incomingState }),
          device_id: "annen-enhet",
          updated_at: LATER,
        }),
      ],
      new Set(),
    );
    const text = textOf(String(result.rows[0]!.text_state));
    // Aldri bare den innkommende: ingen av enhetene mister tekst
    expect(text).toBe(textOf(mergeTextStates(localState, incomingState)));
    expect(text).toContain("Taket er tett.");
    expect(text).toContain("Merk: ");
    expect(result.rows[0]!.value).toBe(JSON.stringify(text));
  });

  // Valg (testplanen lar utvikler velge): lokal text_state beholdes, og value følger den
  // (textOf(text_state)), aldri en gammel value uten tilstand.
  it("text_state lages aldri fra en gammel value", () => {
    const localState = createTextState("Taket er tett.");
    const local = answerRow("roof_description", "Taket er tett.", { text_state: localState });
    const result = applyIncoming(
      "trial_answers",
      [local],
      [
        change("update", {
          ...answerRow("roof_description", "Gammel tekst"),
          text_state: null,
          device_id: "annen-enhet",
          updated_at: LATER,
        }),
      ],
      new Set(),
    );
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    expect(row.text_state).toBe(localState);
    expect(textOf(String(row.text_state))).toBe("Taket er tett.");
    expect(row.value).toBe(JSON.stringify(textOf(String(row.text_state))));
  });

  it("delete-melding fjerner raden lokalt (myk slettet på serveren)", () => {
    const local = answerRow("floors", 7);
    const other = answerRow("roof_tg", "TG2", { id: SERVER_ID });
    // REPLICA IDENTITY FULL: delete-meldingen har hele raden
    const result = applyIncoming(
      "trial_answers",
      [local, other],
      [change("delete", local)],
      new Set(),
    );
    expect(result.rows.map((row) => row.field_key)).toEqual(["roof_tg"]);
  });

  it("rad med deleted_at satt filtreres bort", () => {
    const deleted = answerRow("floors", 7, { id: SERVER_ID, deleted_at: LATER });
    const inserted = applyIncoming("trial_answers", [], [change("insert", deleted)], new Set());
    expect(inserted.rows).toEqual([]);

    // Også når en eksisterende rad får deleted_at i en oppdatering
    const local = answerRow("floors", 7);
    const updated = applyIncoming(
      "trial_answers",
      [local],
      [change("update", { id: LOCAL_ID, deleted_at: LATER }, keyOf(local))],
      new Set(),
    );
    expect(updated.rows).toEqual([]);
  });

  it("trial_answers nøkles på (trial_form_id, field_key), ikke på id", () => {
    const local = answerRow("floors", 5);
    const incoming = answerRow("floors", 7, { id: SERVER_ID, device_id: "annen-enhet" });
    expect(keyOf(local)).toBe(keyOf(incoming));
    const result = applyIncoming("trial_answers", [local], [change("insert", incoming)], new Set());
    expect(result.rows).toHaveLength(1);
    // Serverens id vinner, som på serveren
    expect(result.rows[0]!.id).toBe(SERVER_ID);
    expect(result.rows[0]!.value).toBe(JSON.stringify(7));
  });

  // Skrevet om etter «Avgjørelser før bygging» 2: «bekreftet»-settet eies av lageret og sendes inn
  // som del av pendingKeys. Ingen updated_at-sammenligning.
  it("bekreftet overlegg beholdes til neste melding for samme nøkkel", () => {
    const local = answerRow("floors", 8);
    const key = keyOf(local);
    const echo = change("update", {
      ...answerRow("floors", 7),
      device_id: "annen-enhet",
      updated_at: LATER,
    });

    // Nøkkelen er bekreftet (200), men ennå ikke speilet: raden røres ikke
    const confirmed = applyIncoming("trial_answers", [local], [echo], new Set([key]));
    expect(confirmed.rows).toEqual([local]);
    expect(confirmed.skippedKeys).toEqual([key]);

    // Lageret har tatt nøkkelen ut av settet: neste melding patcher
    const next = applyIncoming("trial_answers", confirmed.rows, [echo], new Set());
    expect(next.rows).toHaveLength(1);
    expect(next.rows[0]!.value).toBe(JSON.stringify(7));
    expect(next.skippedKeys).toEqual([]);
  });

  it("ugyldig text_state i innkommende rad gir behold av lokal, ikke krasj", () => {
    const localState = createTextState("Taket er tett.");
    const local = answerRow("roof_description", "Taket er tett.", { text_state: localState });
    const before = clone(local);
    let result: ReturnType<typeof applyIncoming> | undefined;
    expect(() => {
      result = applyIncoming(
        "trial_answers",
        [local],
        [
          change(
            "update",
            { id: LOCAL_ID, text_state: "ikke base64!!", updated_at: LATER },
            keyOf(local),
          ),
        ],
        new Set(),
      );
    }).not.toThrow();
    expect(result!.rows).toEqual([before]);
  });
});
