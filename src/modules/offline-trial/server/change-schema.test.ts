import { describe, expect, it } from "vitest";
import * as changeSchemaModule from "./change-schema";
import { TRIAL_SYNC_LIMITS } from "./types";

// Zod-skjemaet for kroppen i POST /api/prove/synk/endringer (docs/funksjoner/fase1-kandidat-powersync.md
// pkt. 11 og «Data»). Testplan avsnitt 2.8. Alt utenfor grensene skal stoppes før databasen.

interface SafeParser {
  safeParse(input: unknown): { success: boolean };
}

/** Finner Zod-skjemaet for hele forespørselen blant eksportene, uansett hva det heter. */
function requestSchema(): SafeParser {
  const entries = Object.entries(changeSchemaModule as Record<string, unknown>).filter(
    (entry): entry is [string, SafeParser] =>
      typeof entry[1] === "object" &&
      entry[1] !== null &&
      typeof (entry[1] as { safeParse?: unknown }).safeParse === "function",
  );
  const preferred = entries.filter(([name]) => /request/i.test(name));
  const chosen = preferred.length === 1 ? preferred : entries;
  expect(
    chosen.map(([name]) => name),
    "change-schema.ts må eksportere skjemaet for kroppen",
  ).toHaveLength(1);
  return chosen[0]![1];
}

const ORG_ID = "0190a1b2-c3d4-7e5f-8a6b-0000000000aa";
const FORM_ID = "0190a1b2-c3d4-7e5f-8a6b-000000000001";
const ANSWER_ID = "0190a1b2-c3d4-7e5f-8a6b-000000000002";
const PHOTO_ID = "0190a1b2-c3d4-7e5f-8a6b-000000000003";

const formOp = { op: "PUT", table: "trial_forms", id: FORM_ID, data: { name: "Testskjema 1" } };
const answerOp = (data: Record<string, unknown> = {}) => ({
  op: "PATCH",
  table: "trial_answers",
  id: ANSWER_ID,
  data: { trial_form_id: FORM_ID, field_key: "floors", value: "7", device_id: "enhet-1", ...data },
});
const photoOp = {
  op: "PUT",
  table: "trial_photos",
  id: PHOTO_ID,
  data: {
    trial_form_id: FORM_ID,
    field_key: "cover_photo",
    name: "test-image.png",
    size_bytes: 120,
    device_id: "enhet-1",
  },
};

function body(operations: unknown[]) {
  return { organizationId: ORG_ID, operations };
}

function ok(input: unknown): boolean {
  return requestSchema().safeParse(input).success;
}

describe("skjemaet for endringsbunter", () => {
  it("godtar PUT og PATCH for de tre tabellene", () => {
    expect(ok(body([formOp, answerOp(), photoOp]))).toBe(true);
    expect(
      ok(
        body([
          { ...formOp, op: "PATCH" },
          { ...answerOp(), op: "PUT" },
        ]),
      ),
    ).toBe(true);
    expect(ok(body([]))).toBe(true);
  });

  it("avviser DELETE, ukjent op og ukjent tabell", () => {
    expect(ok(body([{ ...formOp, op: "DELETE" }]))).toBe(false);
    expect(ok(body([{ ...formOp, op: "UPSERT" }]))).toBe(false);
    expect(ok(body([{ ...formOp, table: "users" }]))).toBe(false);
    expect(ok(body([{ ...formOp, table: "sessions" }]))).toBe(false);
    // En gyldig operasjon i samme bunt redder ikke bunten
    expect(ok(body([formOp, { ...formOp, op: "DELETE" }]))).toBe(false);
  });

  it("avviser mer enn 500 operasjoner", () => {
    expect(TRIAL_SYNC_LIMITS.maxOperationsPerBatch).toBe(500);
    expect(ok(body(Array.from({ length: 500 }, () => formOp)))).toBe(true);
    expect(ok(body(Array.from({ length: 501 }, () => formOp)))).toBe(false);
  });

  it("avviser value og text_state over 64 kB og device_id over 64 tegn", () => {
    const limit = 64 * 1024;
    expect(TRIAL_SYNC_LIMITS.maxValueBytes).toBe(limit);
    expect(TRIAL_SYNC_LIMITS.maxTextStateBytes).toBe(limit);
    expect(TRIAL_SYNC_LIMITS.maxDeviceIdLength).toBe(64);

    // value er JSON-tekst slik den ligger lokalt; grensen gjelder hele teksten
    const valueAtLimit = JSON.stringify("a".repeat(limit - 2));
    expect(valueAtLimit.length).toBe(limit);
    expect(ok(body([answerOp({ field_key: "summary", value: valueAtLimit })]))).toBe(true);
    const valueOver = JSON.stringify("a".repeat(limit - 1));
    expect(ok(body([answerOp({ field_key: "summary", value: valueOver })]))).toBe(false);
    // Grensen er bytes: æ er to bytes i UTF-8
    const valueOverInBytes = JSON.stringify("æ".repeat(limit / 2));
    expect(valueOverInBytes.length).toBeLessThan(limit);
    expect(Buffer.byteLength(valueOverInBytes)).toBeGreaterThan(limit);
    expect(ok(body([answerOp({ field_key: "summary", value: valueOverInBytes })]))).toBe(false);

    const stateAtLimit = "A".repeat(limit);
    expect(ok(body([answerOp({ field_key: "summary", text_state: stateAtLimit })]))).toBe(true);
    expect(ok(body([answerOp({ field_key: "summary", text_state: `${stateAtLimit}A` })]))).toBe(
      false,
    );

    expect(ok(body([answerOp({ device_id: "d".repeat(64) })]))).toBe(true);
    expect(ok(body([answerOp({ device_id: "d".repeat(65) })]))).toBe(false);
  });

  it("avviser navn på skjema og bilde over 200 tegn, med norsk melding (småfunn 9)", () => {
    expect(TRIAL_SYNC_LIMITS.maxNameLength).toBe(200);
    const atLimit = "n".repeat(200);
    const over = "n".repeat(201);
    expect(ok(body([{ ...formOp, data: { name: atLimit } }]))).toBe(true);
    expect(ok(body([{ ...formOp, data: { name: over } }]))).toBe(false);
    expect(ok(body([{ ...photoOp, data: { ...photoOp.data, name: atLimit } }]))).toBe(true);
    expect(ok(body([{ ...photoOp, data: { ...photoOp.data, name: over } }]))).toBe(false);

    const result = changeSchemaModule.trialNameSchema.safeParse(over);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "Navnet er for langt. Det kan ha høyst 200 tegn.",
    );
  });

  it("avviser id som ikke er uuid", () => {
    expect(ok(body([{ ...formOp, id: "../x" }]))).toBe(false);
    expect(ok(body([{ ...formOp, id: "" }]))).toBe(false);
    expect(ok(body([{ ...formOp, id: "1; drop table trial_forms" }]))).toBe(false);
  });
});
