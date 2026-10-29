import { describe, expect, it } from "vitest";
import { localRowKey } from "./outbox";
import { nextShapeParams, parseShapeMessages, readShapeHeaders } from "./shape-messages";

// Tolking av meldinger og hoder fra Electric (kandidat 2). Ren fil, ingen @electric-sql/*.
// Testplan: docs/funksjoner/fase1-kandidat-electricsql-testplan.md avsnitt 2.3, med signaturen fra
// «Avgjørelser før bygging» pkt. 3: parseShapeMessages(table, body) → { changes, upToDate,
// mustRefetch }; nøkkelen regnes av localRowKey fra kolonnene, aldri av Electrics key-tekst.

const ORG = "0190a1b2-c3d4-7e5f-8a6b-0000000000aa";
const FORM = "0190a1b2-c3d4-7e5f-8a6b-000000000001";
const A1 = "0190a1b2-c3d4-7e5f-8a6b-0000000000a1";

function answerValue(extra: Record<string, unknown> = {}) {
  return {
    id: A1,
    trial_form_id: FORM,
    field_key: "floors",
    value: "7",
    text_state: null,
    device_id: "annen-enhet",
    created_at: "2026-10-28 12:00:00+00",
    updated_at: "2026-10-28 12:00:00+00",
    deleted_at: null,
    ...extra,
  };
}

const electricKey = `"public"."trial_answers"/"${A1}"`;

describe("parseShapeMessages", () => {
  it("insert, update og delete tolkes med key, value og operation", () => {
    const parsed = parseShapeMessages("trial_answers", [
      { key: electricKey, value: answerValue(), headers: { operation: "insert" } },
      {
        key: electricKey,
        value: { id: A1, trial_form_id: FORM, field_key: "floors", value: "8" },
        headers: { operation: "update" },
      },
      { key: electricKey, value: answerValue(), headers: { operation: "delete" } },
    ]);
    expect(parsed.changes.map((c) => c.kind)).toEqual(["insert", "update", "delete"]);
    const expectedKey = localRowKey("trial_answers", {
      id: A1,
      trial_form_id: FORM,
      field_key: "floors",
    });
    for (const change of parsed.changes) {
      expect(change.table).toBe("trial_answers");
      // Nøkkelen kommer fra kolonnene, ikke fra Electrics key-tekst
      expect(change.key).toBe(expectedKey);
      expect(change.key).not.toBe(electricKey);
    }
    expect(parsed.changes[0]!.row.field_key).toBe("floors");
    expect(parsed.changes[1]!.row.value).toBe("8");
    // Update har bare de kolonnene som kom
    expect(parsed.changes[1]!.row).not.toHaveProperty("device_id");
    expect(parsed.upToDate).toBe(false);
    expect(parsed.mustRefetch).toBe(false);
  });

  it("up-to-date-kontrollmelding gir upToDate", () => {
    const parsed = parseShapeMessages("trial_forms", [{ headers: { control: "up-to-date" } }]);
    expect(parsed.upToDate).toBe(true);
    expect(parsed.mustRefetch).toBe(false);
    expect(parsed.changes).toEqual([]);
  });

  it("must-refetch-kontrollmelding gir mustRefetch", () => {
    const parsed = parseShapeMessages("trial_forms", [{ headers: { control: "must-refetch" } }]);
    expect(parsed.mustRefetch).toBe(true);
    expect(parsed.changes).toEqual([]);
  });

  it("ukjent kontrollmelding og ukjent operasjon ignoreres uten krasj", () => {
    let parsed: ReturnType<typeof parseShapeMessages> | undefined;
    expect(() => {
      parsed = parseShapeMessages("trial_answers", [
        { headers: { control: "noe-nytt" } },
        { key: electricKey, value: answerValue(), headers: { operation: "upsert" } },
        { key: electricKey, value: answerValue(), headers: { operation: "insert" } },
        null,
        "tekst",
        { headers: {} },
      ]);
    }).not.toThrow();
    expect(parsed!.changes).toHaveLength(1);
    expect(parsed!.changes[0]!.kind).toBe("insert");
    expect(parsed!.upToDate).toBe(false);
    expect(parsed!.mustRefetch).toBe(false);
  });

  it("kropp som ikke er en liste gir tom liste", () => {
    for (const body of [null, undefined, {}, "tekst", 42]) {
      const parsed = parseShapeMessages("trial_forms", body);
      expect(parsed.changes, String(body)).toEqual([]);
      expect(parsed.upToDate).toBe(false);
      expect(parsed.mustRefetch).toBe(false);
    }
  });

  it("value konverteres til de lokale kolonnetypene", () => {
    const parsed = parseShapeMessages("trial_photos", [
      {
        key: `"public"."trial_photos"/"${A1}"`,
        value: {
          id: A1,
          trial_form_id: FORM,
          field_key: "cover_photo",
          name: "test-image.png",
          size_bytes: "120",
          sha256: null,
          uploaded_at: "2026-10-28 12:00:00.123+00",
          device_id: "enhet-1",
          created_at: "2026-10-28 12:00:00+00",
          updated_at: "2026-10-28 12:00:00+00",
          deleted_at: null,
        },
        headers: { operation: "insert" },
      },
    ]);
    const row = parsed.changes[0]!.row;
    expect(row.size_bytes).toBe(120);
    expect(row.uploaded_at).toBe("2026-10-28T12:00:00.123Z");
    expect(row.created_at).toBe("2026-10-28T12:00:00.000Z");
    expect(row.deleted_at).toBeNull();
    expect(row.sha256).toBeNull();

    // jsonb: Electric sender JSON-teksten; lokalt ligger value som JSON-tekst
    const answers = parseShapeMessages("trial_answers", [
      {
        key: electricKey,
        value: answerValue({ value: JSON.stringify("TG2") }),
        headers: { operation: "insert" },
      },
      {
        key: `"public"."trial_answers"/"x"`,
        value: answerValue({
          id: "0190a1b2-c3d4-7e5f-8a6b-0000000000a3",
          field_key: "drill_measurements",
          value: { rows: [{ location: "Oppdiktet sted" }] },
        }),
        headers: { operation: "insert" },
      },
    ]);
    expect(answers.changes[0]!.row.value).toBe(JSON.stringify("TG2"));
    expect(JSON.parse(answers.changes[1]!.row.value as string)).toEqual({
      rows: [{ location: "Oppdiktet sted" }],
    });
  });
});

describe("readShapeHeaders", () => {
  it("electric-handle, electric-offset, electric-cursor og electric-up-to-date leses fra hodene", () => {
    const all = readShapeHeaders(
      new Headers({
        "electric-handle": "12345-1730000000000",
        "electric-offset": "26800584_4",
        "electric-cursor": "1234",
        "electric-up-to-date": "",
      }),
    );
    expect(all).toEqual({
      handle: "12345-1730000000000",
      offset: "26800584_4",
      cursor: "1234",
      upToDate: true,
    });

    const plain = readShapeHeaders({ "electric-handle": "h-1", "electric-offset": "0_0" });
    expect(plain.handle).toBe("h-1");
    expect(plain.offset).toBe("0_0");
    expect(plain.upToDate).toBe(false);
  });

  it("ETag, Age og Cache-Control i hodene brukes aldri", () => {
    const result = readShapeHeaders(
      new Headers({
        etag: '"etag-verdi"',
        age: "30",
        "cache-control": "public, max-age=60",
        "electric-offset": "0_0",
      }),
    );
    for (const key of Object.keys(result)) {
      expect(["handle", "offset", "cursor", "upToDate"]).toContain(key);
    }
    const text = JSON.stringify(result);
    expect(text).not.toContain("etag-verdi");
    expect(text).not.toContain("max-age");
    expect(text).not.toContain('"30"');
  });
});

describe("nextShapeParams", () => {
  it("første henting har offset -1 og ingen handle, og live bare med lagret posisjon", () => {
    const first = nextShapeParams(ORG, "trial_forms", null, false);
    expect(first.organisasjon).toBe(ORG);
    expect(first.tabell).toBe("trial_forms");
    expect(first.offset).toBe("-1");
    expect(first.handle).toBeUndefined();
    expect(first.live).toBeUndefined();

    const state = { table: "trial_forms" as const, handle: "h-1", offset: "0_0", upToDate: true };
    const next = nextShapeParams(ORG, "trial_forms", state, false);
    expect(next).toMatchObject({ offset: "0_0", handle: "h-1" });
    expect(next.live).toBeUndefined();

    const live = nextShapeParams(ORG, "trial_forms", state, true, "1234");
    expect(live).toMatchObject({ offset: "0_0", handle: "h-1", live: "true", cursor: "1234" });
  });
});
