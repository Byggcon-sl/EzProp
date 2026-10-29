import { describe, expect, it } from "vitest";
import { normalizeLocalRow } from "./normalize-row";

// Den felles normalisereren for rader fra serveren (docs/funksjoner/fase1-kandidat-egenbygd.md
// forarbeid pkt. 1). Testplan avsnitt 2.3: samme inn gir samme ut som før flyttingen fra
// electricsql/shape-messages.ts. Sakene er kopiert fra «value konverteres til de lokale
// kolonnetypene» i shape-messages.test.ts. Alle data er oppdiktet.

const FORM = "0192d3a0-0000-7000-8000-000000000001";
const ANSWER = "0192d3a0-0000-7000-8000-0000000000a1";
const PHOTO = "0192d3a0-0000-7000-8000-0000000000b1";

describe("normalizeLocalRow (local/normalize-row.ts)", () => {
  it("normaliseringen er lik for Electric og egenbygd", () => {
    // 1. Bilde: size_bytes som tekst blir tall, tid fra PostgreSQL blir ISO
    const photo = normalizeLocalRow("trial_photos", {
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
    });
    expect(photo.size_bytes).toBe(120);
    expect(typeof photo.size_bytes).toBe("number");
    expect(photo.created_at).toBe("2026-10-28T10:00:00.123Z");
    expect(photo.updated_at).toBe("2026-10-28T10:00:00.000Z");
    expect(photo.uploaded_at).toBe("2026-10-28T10:01:02.500Z");
    expect(photo.deleted_at).toBeNull();
    expect(photo.sha256).toBeNull();

    // 2. Svar: value er allerede JSON-tekst og står som den er
    const answer = normalizeLocalRow("trial_answers", {
      id: ANSWER,
      trial_form_id: FORM,
      field_key: "roof_tg",
      value: '"TG2"',
      text_state: null,
      device_id: "annen-enhet",
      created_at: "2026-10-28 10:00:00.123+00",
      updated_at: "2026-10-28 10:05:00+00",
      deleted_at: null,
    });
    expect(answer.value).toBe(JSON.stringify("TG2"));
    expect(JSON.parse(String(answer.value))).toBe("TG2");
    expect(answer.created_at).toBe("2026-10-28T10:00:00.123Z");
    expect(answer.deleted_at).toBeNull();
    expect(answer.text_state).toBeNull();

    // 3. ISO-tid fra hente-ruten står uendret, og ukjente kolonner overses
    const form = normalizeLocalRow("trial_forms", {
      id: FORM,
      name: "Testskjema 1",
      created_at: "2026-10-28T10:00:00.123Z",
      updated_at: "2026-10-28T10:05:00.000Z",
      deleted_at: "2026-10-28T10:06:00.000Z",
      organization_id: "0192d3a0-0000-7000-8000-0000000000f1",
      storage_path: "oppdiktet/sti",
      created_by: "oppdiktet",
    });
    expect(form).toEqual({
      id: FORM,
      name: "Testskjema 1",
      created_at: "2026-10-28T10:00:00.123Z",
      updated_at: "2026-10-28T10:05:00.000Z",
      deleted_at: "2026-10-28T10:06:00.000Z",
    });
  });
});
