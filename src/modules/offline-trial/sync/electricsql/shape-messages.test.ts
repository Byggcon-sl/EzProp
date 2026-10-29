import { describe, expect, it } from "vitest";
import { localRowKey } from "../local/outbox";
import { nextShapeParams, parseShapeMessages, readShapeHeaders } from "./shape-messages";

// Tolking av meldingene fra Electric slik proxyen videresender dem (docs/funksjoner/
// fase1-kandidat-electricsql.md avgjørelse D og «Avgjørelser før bygging» 3). Testplan avsnitt 2.3.
// Kroppene under har Electrics format på ledningen: verdier som tekst (PostgreSQL tekstformat).
// Alle data er oppdiktet.

const ORG = "0192d3a0-0000-7000-8000-0000000000f1";
const FORM = "0192d3a0-0000-7000-8000-000000000001";
const ANSWER = "0192d3a0-0000-7000-8000-0000000000a1";
const PHOTO = "0192d3a0-0000-7000-8000-0000000000b1";

function electricKey(table: string, id: string): string {
  return `"public"."${table}"/"${id}"`;
}

function answerValue(fieldKey: string, jsonText: string, extra: Record<string, unknown> = {}) {
  return {
    id: ANSWER,
    trial_form_id: FORM,
    field_key: fieldKey,
    value: jsonText,
    text_state: null,
    device_id: "annen-enhet",
    created_at: "2026-10-28 10:00:00.123+00",
    updated_at: "2026-10-28 10:05:00+00",
    deleted_at: null,
    ...extra,
  };
}

function rowMessage(operation: string, value: Record<string, unknown>, table = "trial_answers") {
  return {
    key: electricKey(table, String(value.id)),
    value,
    headers: { operation, relation: ["public", table] },
  };
}

describe("parseShapeMessages og readShapeHeaders (shape-messages.ts)", () => {
  it("insert, update og delete tolkes med key, value og operation", () => {
    const body = [
      rowMessage("insert", answerValue("floors", "7")),
      rowMessage("update", answerValue("floors", "8")),
      rowMessage("delete", answerValue("floors", "8")),
    ];
    const parsed = parseShapeMessages("trial_answers", body);
    expect(parsed.changes.map((c) => c.kind)).toEqual(["insert", "update", "delete"]);
    const expectedKey = localRowKey("trial_answers", {
      id: ANSWER,
      trial_form_id: FORM,
      field_key: "floors",
    });
    for (const change of parsed.changes) {
      expect(change.table).toBe("trial_answers");
      // Nøkkelen regnes av localRowKey, aldri av Electrics key-tekst
      expect(change.key).toBe(expectedKey);
      expect(change.key).not.toContain('"public"');
      expect(change.row.id).toBe(ANSWER);
      expect(change.row.field_key).toBe("floors");
    }
    expect(parsed.changes[0]!.row.value).toBe("7");
    expect(parsed.changes[1]!.row.value).toBe("8");
    expect(parsed.upToDate).toBe(false);
    expect(parsed.mustRefetch).toBe(false);
  });

  it("up-to-date-kontrollmelding gir upToDate", () => {
    const parsed = parseShapeMessages("trial_forms", [
      { headers: { control: "up-to-date", global_last_seen_lsn: "26800584" } },
    ]);
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
    const body = [
      { headers: { control: "noe-nytt" } },
      rowMessage("upsert", answerValue("floors", "1")),
      "tekst",
      null,
      42,
      { headers: null },
      { value: answerValue("floors", "2") },
      rowMessage("insert", answerValue("roof_tg", '"TG2"')),
      { headers: { control: "up-to-date" } },
    ];
    let parsed: ReturnType<typeof parseShapeMessages> | undefined;
    expect(() => {
      parsed = parseShapeMessages("trial_answers", body);
    }).not.toThrow();
    expect(parsed!.changes).toHaveLength(1);
    expect(parsed!.changes[0]!.kind).toBe("insert");
    expect(parsed!.changes[0]!.row.field_key).toBe("roof_tg");
    expect(parsed!.upToDate).toBe(true);
    expect(parsed!.mustRefetch).toBe(false);
  });

  it("kropp som ikke er en liste gir tom liste", () => {
    for (const body of [null, undefined, {}, "tekst", 42, { headers: { control: "up-to-date" } }]) {
      const parsed = parseShapeMessages("trial_forms", body);
      expect(parsed.changes, JSON.stringify(body)).toEqual([]);
      expect(parsed.mustRefetch, JSON.stringify(body)).toBe(false);
    }
  });

  it("electric-handle, electric-offset, electric-cursor og electric-up-to-date leses fra hodene", () => {
    // Electric sender electric-up-to-date uten verdi; det er nærværet som teller
    const fromHeaders = readShapeHeaders(
      new Headers({
        "electric-handle": "12345-1730000000000",
        "electric-offset": "26800584_4",
        "electric-cursor": "42",
        "electric-up-to-date": "",
      }),
    );
    expect(fromHeaders).toEqual({
      handle: "12345-1730000000000",
      offset: "26800584_4",
      cursor: "42",
      upToDate: true,
    });

    const fromObject = readShapeHeaders({
      "electric-handle": "12345-1730000000000",
      "electric-offset": "0_0",
      "electric-cursor": "43",
      "electric-up-to-date": "true",
    });
    expect(fromObject).toMatchObject({
      handle: "12345-1730000000000",
      offset: "0_0",
      cursor: "43",
      upToDate: true,
    });

    const notYet = readShapeHeaders(
      new Headers({ "electric-handle": "12345-1730000000000", "electric-offset": "0_0" }),
    );
    expect(notYet.upToDate).toBe(false);
    expect(notYet.handle).toBe("12345-1730000000000");
    expect(readShapeHeaders({}).upToDate).toBe(false);
  });

  it("ETag, Age og Cache-Control i hodene brukes aldri", () => {
    const result = readShapeHeaders(
      new Headers({
        etag: '"12345-1730000000000:-1:26800584_4"',
        age: "12",
        "cache-control": "public, max-age=60",
        "electric-offset": "26800584_4",
      }),
    );
    expect(
      Object.keys(result).every((key) => ["handle", "offset", "cursor", "upToDate"].includes(key)),
    ).toBe(true);
    const values = JSON.stringify(result);
    expect(values).not.toContain("1730000000000:-1");
    expect(values).not.toContain("max-age");
    expect(result.offset).toBe("26800584_4");
    expect(result.handle).toBeUndefined();
    expect(result.upToDate).toBe(false);
  });

  it("value konverteres til de lokale kolonnetypene", () => {
    const photo = parseShapeMessages("trial_photos", [
      rowMessage(
        "insert",
        {
          id: PHOTO,
          trial_form_id: FORM,
          field_key: "cover_photo",
          name: "test-image.png",
          size_bytes: "120",
          sha256: null,
          uploaded_at: "2026-10-28 10:01:02.5+00",
          device_id: "annen-enhet",
          created_at: "2026-10-28 10:00:00.123+00",
          updated_at: "2026-10-28 10:00:00+00",
          deleted_at: null,
        },
        "trial_photos",
      ),
    ]);
    expect(photo.changes).toHaveLength(1);
    const row = photo.changes[0]!.row;
    expect(row.size_bytes).toBe(120);
    expect(typeof row.size_bytes).toBe("number");
    expect(row.created_at).toBe("2026-10-28T10:00:00.123Z");
    expect(row.updated_at).toBe("2026-10-28T10:00:00.000Z");
    expect(row.uploaded_at).toBe("2026-10-28T10:01:02.500Z");
    expect(row.deleted_at).toBeNull();
    expect(row.sha256).toBeNull();
    expect(photo.changes[0]!.key).toBe(localRowKey("trial_photos", { id: PHOTO }));

    // value er jsonb: tekstformen fra Electric er allerede JSON-tekst, som i den lokale raden
    const answers = parseShapeMessages("trial_answers", [
      rowMessage("insert", answerValue("roof_tg", '"TG2"')),
    ]);
    const answer = answers.changes[0]!.row;
    expect(answer.value).toBe(JSON.stringify("TG2"));
    expect(JSON.parse(String(answer.value))).toBe("TG2");
    expect(answer.created_at).toBe("2026-10-28T10:00:00.123Z");
    expect(answer.deleted_at).toBeNull();
    expect(answer.text_state).toBeNull();
  });

  it("ukjente kolonner overses (tillegg)", () => {
    const parsed = parseShapeMessages("trial_photos", [
      rowMessage(
        "insert",
        {
          id: PHOTO,
          trial_form_id: FORM,
          field_key: "cover_photo",
          name: "test-image.png",
          size_bytes: "120",
          storage_path: "ORG/oppdiktet",
          organization_id: ORG,
        },
        "trial_photos",
      ),
    ]);
    expect(parsed.changes).toHaveLength(1);
    expect(parsed.changes[0]!.row).not.toHaveProperty("storage_path");
  });

  it("nextShapeParams gir offset -1 første gang og live med cursor når shapen er oppdatert (tillegg)", () => {
    const first = nextShapeParams(ORG, "trial_forms", null, false);
    expect(first).toMatchObject({ organisasjon: ORG, tabell: "trial_forms", offset: "-1" });
    expect(first.handle).toBeUndefined();
    expect(first.live).toBeUndefined();

    const state = {
      table: "trial_forms" as const,
      handle: "12345-1730000000000",
      offset: "26800584_4",
      upToDate: true,
    };
    const catchUp = nextShapeParams(ORG, "trial_forms", state, false);
    expect(catchUp).toMatchObject({ offset: "26800584_4", handle: "12345-1730000000000" });
    expect(catchUp.live).toBeUndefined();

    const live = nextShapeParams(ORG, "trial_forms", state, true, "42");
    expect(live).toMatchObject({
      organisasjon: ORG,
      tabell: "trial_forms",
      offset: "26800584_4",
      handle: "12345-1730000000000",
      live: "true",
      cursor: "42",
    });
  });
});
