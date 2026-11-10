import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AiRequestRejectedError } from "@/core/ai";
import { polishField, polishTarget } from "../../../tests/ai";
import { assertAllowedFields, parseAiRequest } from "./request";

/*
 * Validering av forespørselen (testplan docs/funksjoner/fase2a-ki-modul-logg-testplan.md
 * avsnitt 4). Regeltest som tabell mot valideringen `requestSuggestion` bruker: skjemaet (Zod),
 * de lovlige målene og tillatt-listen. Ren, ingen database.
 *
 * Støtter hovedmål: KI i bunnen (én streng vei inn) og færre reklamasjoner (et TG-felt eller et
 * felt med personopplysninger kommer aldri med).
 */

const field = polishField();

function valid(): Record<string, unknown> {
  return {
    requestId: randomUUID(),
    feature: "language_polish",
    assignmentId: null,
    reportId: null,
    target: polishTarget(),
    fields: { [field]: "Taket er gammelt og har noen sprekker" },
  };
}

/** Hele valideringen før rettigheten: skjema og mål, så tillatt-listen. */
function validate(input: unknown) {
  const parsed = parseAiRequest(input);
  assertAllowedFields(parsed.definition, parsed.request.fields);
  return parsed.request;
}

const NEUTRAL_MESSAGE = new AiRequestRejectedError().message;

function expectRejected(input: unknown) {
  let error: unknown;
  try {
    validate(input);
  } catch (caught) {
    error = caught;
  }
  expect(error, "avvist").toBeInstanceOf(AiRequestRejectedError);
  expect((error as Error).message).toBe(NEUTRAL_MESSAGE);
}

type Change = (request: Record<string, unknown>) => void;

const target = () => polishTarget();

describe("validering: gyldig forespørsel (4.1)", () => {
  it("4.1 gyldig forespørsel godtas og gir de samme verdiene tilbake", () => {
    const input = valid();
    const request = validate(input);
    expect(request.requestId).toBe(input.requestId);
    expect(request.feature).toBe("language_polish");
    expect(request.target).toEqual(input.target);
    expect(request.fields).toEqual(input.fields);
    expect(request.reportId).toBeNull();
  });

  it("4.1 assignmentId som UUID godtas", () => {
    expect(validate({ ...valid(), assignmentId: randomUUID() }).assignmentId).toBeTruthy();
  });
});

describe("validering: avvist (4.2–4.7)", () => {
  const cases: [string, Change][] = [
    ["4.2 requestId som ikke er UUID", (r) => (r.requestId = "ikke-en-uuid")],
    ["4.2 requestId tom", (r) => (r.requestId = "")],
    ["4.2 requestId mangler", (r) => delete r.requestId],
    ["4.2 requestId er et tall", (r) => (r.requestId = 42)],
    ["4.3 feature ukjent (tg_suggest)", (r) => (r.feature = "tg_suggest")],
    ["4.3 feature tom", (r) => (r.feature = "")],
    ["4.3 feature mangler", (r) => delete r.feature],
    [
      "4.4 target med ekstra nøkkel organizationId",
      (r) => (r.target = { ...target(), organizationId: randomUUID() }),
    ],
    ["4.4 target.id som ikke er UUID", (r) => (r.target = { ...target(), id: "abc" })],
    ["4.4 target med ulovlig type", (r) => (r.target = { ...target(), type: "contact" })],
    ["4.4 target med ulovlig fieldKey", (r) => (r.target = { ...target(), fieldKey: "notes" })],
    ["4.4 target med fieldKey tg", (r) => (r.target = { ...target(), fieldKey: "tg" })],
    ["4.4 target med fieldKey tg_value", (r) => (r.target = { ...target(), fieldKey: "tg_value" })],
    ["4.4 target mangler", (r) => delete r.target],
    ["4.5 reportId satt til en UUID", (r) => (r.reportId = randomUUID())],
    [
      "4.6 candidates med ett element",
      (r) => (r.candidates = [{ id: randomUUID(), text: "Frase" }]),
    ],
    ["4.7 verdi på 5 001 tegn", (r) => (r.fields = { [field]: "a".repeat(5001) })],
    ["4.7 felt utenfor tillatt-listen (email)", (r) => (r.fields = { [field]: "x", email: "x" })],
    [
      "4.7 felt utenfor tillatt-listen (address)",
      (r) => (r.fields = { address: "Oppdiktet vei 1" }),
    ],
    ["4.7 verdi som ikke er tekst (tall)", (r) => (r.fields = { [field]: 12 })],
    ["4.7 verdi som ikke er tekst (objekt)", (r) => (r.fields = { [field]: { text: "x" } })],
    ["4.7 fields mangler", (r) => delete r.fields],
  ];

  it.each(cases)("%s → nøytralt avslag", (_name, change) => {
    const input = valid();
    change(input);
    expectRejected(input);
  });

  it("4.4 assignmentId som ikke er UUID avvises", () => {
    expectRejected({ ...valid(), assignmentId: "oppdrag-1" });
  });
});

describe("validering: grenser som godtas (4.5–4.7)", () => {
  it("4.5 reportId = null godtas", () => {
    expect(validate({ ...valid(), reportId: null }).reportId).toBeNull();
  });

  it("4.6 candidates mangler eller er tom liste godtas", () => {
    const without = valid();
    delete without.candidates;
    expect(() => validate(without)).not.toThrow();
    expect(() => validate({ ...valid(), candidates: [] })).not.toThrow();
  });

  it("4.7 verdi på nøyaktig 5 000 tegn godtas", () => {
    const request = validate({ ...valid(), fields: { [field]: "a".repeat(5000) } });
    expect(request.fields[field]).toHaveLength(5000);
  });
});

describe("validering: ukjente nøkler på toppnivå (4.8)", () => {
  it.each(["organizationId", "employeeId", "provider"])(
    "4.8 %s avvises eller ignoreres, og brukes aldri",
    (key) => {
      const input = { ...valid(), [key]: key === "provider" ? "openai" : randomUUID() };
      let request: Record<string, unknown> | null = null;
      try {
        request = validate(input) as unknown as Record<string, unknown>;
      } catch (error) {
        expect(error).toBeInstanceOf(AiRequestRejectedError);
        return;
      }
      expect(request).not.toHaveProperty(key);
    },
  );
});
