import { describe, expect, it } from "vitest";
import { applyTextEdit, createTextState, mergeTextStates, textOf } from "../../text-merge";
import type { IncomingChange, LocalRow } from "../types";
import { applyIncoming } from "./apply-incoming";
import { localRowKey } from "./outbox";

// Innfletting av nedlastede rader i den lokale lagringen (kandidat 2, ElectricSQL). Ren funksjon.
// Testplan: docs/funksjoner/fase1-kandidat-electricsql-testplan.md avsnitt 2.2, med signaturen fra
// «Avgjørelser før bygging» pkt. 2: applyIncoming(table, localRows, changes, pendingKeys) →
// { rows, skippedKeys }. Hovedmål: reklamasjoner (nedlastede rader legges aldri over usendte endringer).

const FORM = "0190a1b2-c3d4-7e5f-8a6b-000000000001";
const T = "0190a1b2-c3d4-7e5f-8a6b-0000000000a1";
const S = "0190a1b2-c3d4-7e5f-8a6b-0000000000a2";
const NOW = "2026-10-28T12:00:00.000Z";
const LATER = "2026-10-28T12:05:00.000Z";
const NONE: ReadonlySet<string> = new Set();

function answer(fieldKey: string, value: unknown, extra: LocalRow = {}): LocalRow {
  return {
    id: T,
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
  keyRow: LocalRow = row,
): IncomingChange {
  return { table: "trial_answers", kind, key: keyOf(keyRow), row };
}

function only(rows: LocalRow[]): LocalRow {
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

describe("applyIncoming", () => {
  it("ny rad fra serveren legges til", () => {
    const incoming = answer("floors", 3, { device_id: "annen-enhet" });
    const result = applyIncoming("trial_answers", [], [change("insert", incoming)], NONE);
    expect(only(result.rows)).toMatchObject({ id: T, field_key: "floors", value: "3" });
    expect(result.skippedKeys).toEqual([]);
  });

  it("oppdatering fra serveren patcher bare kolonnene som kom", () => {
    // Standard replica: update har bare de endrede kolonnene (pluss nøkkelen)
    const tg = answer("roof_tg", "TG1", { device_id: "enhet-1" });
    const tgPatch: LocalRow = {
      id: T,
      trial_form_id: FORM,
      field_key: "roof_tg",
      value: JSON.stringify("TG2"),
    };
    const tgRow = only(
      applyIncoming("trial_answers", [tg], [change("update", tgPatch)], NONE).rows,
    );
    expect(tgRow.value).toBe(JSON.stringify("TG2"));
    expect(tgRow.text_state).toBeNull();
    expect(tgRow.device_id).toBe("enhet-1");
    expect(tgRow.created_at).toBe(NOW);

    // Tekstfelt: update med bare updated_at rører verken value eller text_state
    const state = createTextState("Taket er tett.");
    const text = answer("roof_description", "Taket er tett.", { text_state: state });
    const textPatch: LocalRow = {
      id: T,
      trial_form_id: FORM,
      field_key: "roof_description",
      updated_at: LATER,
    };
    const textRow = only(
      applyIncoming("trial_answers", [text], [change("update", textPatch)], NONE).rows,
    );
    expect(textRow.updated_at).toBe(LATER);
    expect(textRow.text_state).toBe(state);
    expect(textRow.value).toBe(JSON.stringify("Taket er tett."));
    expect(textRow.device_id).toBe("enhet-1");
  });

  it("nedlastet rad legges aldri over en usendt lokal endring", () => {
    const local = answer("floors", 7);
    const incoming = answer("floors", 3, { device_id: "annen-enhet", updated_at: LATER });
    const pending = new Set([keyOf(local)]);
    const before = JSON.parse(JSON.stringify(local)) as LocalRow;

    for (const kind of ["insert", "update"] as const) {
      const result = applyIncoming("trial_answers", [local], [change(kind, incoming)], pending);
      const row = only(result.rows);
      expect(row.value, kind).toBe("7");
      expect(row.device_id, kind).toBe("enhet-1");
      expect(result.skippedKeys, kind).toContain(keyOf(local));
    }
    // localRows endres aldri
    expect(local).toEqual(before);
  });

  it("usendt tekstendring og innkommende text_state flettes med mergeTextStates", () => {
    const start = createTextState("");
    const a = applyTextEdit(start, "Taket er tett.");
    const b = applyTextEdit(start, "Merk: ");
    const local = answer("roof_description", "Taket er tett.", { text_state: a });
    const incoming = answer("roof_description", "Merk: ", {
      text_state: b,
      device_id: "annen-enhet",
    });
    const pending = new Set([keyOf(local)]);

    const result = applyIncoming("trial_answers", [local], [change("update", incoming)], pending);
    const row = only(result.rows);
    const merged = mergeTextStates(a, b);
    expect(textOf(row.text_state as string)).toBe(textOf(merged));
    expect(textOf(row.text_state as string)).toContain("Merk: ");
    expect(textOf(row.text_state as string)).toContain("Taket er tett.");
    expect(row.value).toBe(JSON.stringify(textOf(merged)));
    // Ingen andre kolonner fra serveren legges over den usendte endringen
    expect(row.device_id).toBe("enhet-1");
  });

  it("innkommende text_state uten usendt lokal endring flettes også", () => {
    const start = createTextState("");
    const a = applyTextEdit(start, "Taket er tett.");
    const b = applyTextEdit(start, "Merk: ");
    const local = answer("roof_description", "Taket er tett.", { text_state: a });
    const incoming = answer("roof_description", "Merk: ", {
      text_state: b,
      device_id: "annen-enhet",
    });

    const result = applyIncoming("trial_answers", [local], [change("update", incoming)], NONE);
    const row = only(result.rows);
    const text = textOf(row.text_state as string);
    // Aldri bare den innkommende: to enheter, ingen av dem mister tekst
    expect(text).toBe(textOf(mergeTextStates(a, b)));
    expect(text).toContain("Taket er tett.");
    expect(text).toContain("Merk: ");
    expect(row.value).toBe(JSON.stringify(text));
  });

  it("text_state lages aldri fra en gammel value", () => {
    const state = createTextState("Taket er tett.");
    const local = answer("roof_description", "Taket er tett.", { text_state: state });
    const incoming: LocalRow = {
      id: T,
      trial_form_id: FORM,
      field_key: "roof_description",
      value: JSON.stringify("Gammel tekst"),
      text_state: null,
    };
    const result = applyIncoming("trial_answers", [local], [change("update", incoming)], NONE);
    const row = only(result.rows);
    // Valgt oppførsel: lokal text_state beholdes, og value følger tilstanden, ikke den gamle teksten
    expect(row.text_state).toBe(state);
    expect(row.value).toBe(JSON.stringify(textOf(state)));
  });

  it("delete-melding fjerner raden lokalt (myk slettet på serveren)", () => {
    const local = answer("floors", 7);
    const other = answer("building_year", 1985, { id: S });
    const result = applyIncoming(
      "trial_answers",
      [local, other],
      [change("delete", { id: T, trial_form_id: FORM, field_key: "floors" })],
      NONE,
    );
    expect(result.rows.map((row) => row.field_key)).toEqual(["building_year"]);
  });

  it("rad med deleted_at satt filtreres bort", () => {
    const insert = answer("floors", 3, { deleted_at: LATER });
    expect(applyIncoming("trial_answers", [], [change("insert", insert)], NONE).rows).toEqual([]);

    // Også en update som setter deleted_at på en rad som finnes lokalt
    const local = answer("floors", 7);
    const patch: LocalRow = { id: T, trial_form_id: FORM, field_key: "floors", deleted_at: LATER };
    expect(applyIncoming("trial_answers", [local], [change("update", patch)], NONE).rows).toEqual(
      [],
    );
  });

  it("trial_answers nøkles på (trial_form_id, field_key), ikke på id", () => {
    const local = answer("floors", 7, { id: T });
    const incoming = answer("floors", 3, { id: S, device_id: "annen-enhet" });
    const result = applyIncoming("trial_answers", [local], [change("insert", incoming)], NONE);
    const row = only(result.rows);
    // Serverens id vinner, som på serveren
    expect(row.id).toBe(S);
    expect(row.value).toBe("3");
  });

  it("bekreftet overlegg beholdes til neste melding for samme nøkkel", () => {
    // Avgjørelse før bygging pkt. 2: lageret sender bekreftede (200), ikke speilede nøkler inn
    // som en del av pendingKeys. Nøkkel i settet → raden urørt og i skippedKeys. Nøkkel ikke i
    // settet (lageret har tatt den ut etter første melding) → patch.
    const local = answer("floors", 7);
    const older = answer("floors", 3, { device_id: "annen-enhet" });
    const confirmed = new Set([keyOf(local)]);

    const first = applyIncoming("trial_answers", [local], [change("update", older)], confirmed);
    expect(only(first.rows).value).toBe("7");
    expect(first.skippedKeys).toEqual([keyOf(local)]);

    const second = applyIncoming("trial_answers", first.rows, [change("update", older)], NONE);
    expect(only(second.rows).value).toBe("3");
    expect(second.skippedKeys).toEqual([]);
  });

  it("ugyldig text_state i innkommende rad gir behold av lokal, ikke krasj", () => {
    const state = createTextState("Taket er tett.");
    const local = answer("roof_description", "Taket er tett.", { text_state: state });
    const incoming = answer("roof_description", "Noe annet", {
      text_state: "ikke base64!!",
      device_id: "annen-enhet",
    });
    for (const pending of [NONE, new Set([keyOf(local)])]) {
      let result: ReturnType<typeof applyIncoming> | undefined;
      expect(() => {
        result = applyIncoming("trial_answers", [local], [change("update", incoming)], pending);
      }).not.toThrow();
      const row = only(result!.rows);
      expect(row.text_state).toBe(state);
      expect(textOf(row.text_state as string)).toBe("Taket er tett.");
    }
  });

  it("skjemaer og bilder nøkles på id og patches per kolonne", () => {
    const form: LocalRow = { id: FORM, name: "Testskjema 1", created_at: NOW, updated_at: NOW };
    const renamed = applyIncoming(
      "trial_forms",
      [form],
      [
        {
          table: "trial_forms",
          kind: "update",
          key: localRowKey("trial_forms", form),
          row: { id: FORM, name: "Testskjema 2" },
        },
      ],
      NONE,
    );
    expect(only(renamed.rows)).toEqual({ ...form, name: "Testskjema 2" });

    const photo: LocalRow = {
      id: S,
      trial_form_id: FORM,
      field_key: "cover_photo",
      name: "test-image.png",
      size_bytes: 120,
      sha256: null,
      uploaded_at: null,
    };
    const uploaded = applyIncoming(
      "trial_photos",
      [photo],
      [
        {
          table: "trial_photos",
          kind: "update",
          key: localRowKey("trial_photos", photo),
          row: { id: S, uploaded_at: LATER, sha256: "a".repeat(64) },
        },
      ],
      NONE,
    );
    expect(only(uploaded.rows)).toEqual({ ...photo, uploaded_at: LATER, sha256: "a".repeat(64) });
  });
});
