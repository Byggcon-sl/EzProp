import { describe, expect, it } from "vitest";
import { validRequest } from "../../../tests/ai";
import * as requestModule from "./request";

/*
 * Validering av forespørselen (docs/funksjoner/fase2a-ki-modul-logg-testplan.md avsnitt 4).
 * Ren regeltest mot Zod-skjemaet som `requestSuggestion` bruker. Ingen database.
 *
 * Skjemaet er `aiSuggestionRequestSchema` i `src/core/ai/request.ts` (hele valideringen).
 *
 * Støtter hovedmål: KI i bunnen (én streng vei inn) og færre reklamasjoner (KI kan ikke få TG
 * som mål, og felt utenfor tillatt-listen sendes aldri).
 */

type SafeParse = (value: unknown) => { success: boolean; data?: unknown };

// Hele valideringen, også tillatt-listen for feltene
const schema: { safeParse: SafeParse } = requestModule.aiSuggestionRequestSchema;

const parse = (value: unknown) => schema.safeParse(value);
const accepted = (value: unknown) => parse(value).success;

const BASE = () => validRequest();

describe("validering av forespørselen (4)", () => {
  it("4.1 gyldig forespørsel godtas", () => {
    expect(accepted(BASE())).toBe(true);
  });

  it.each([
    { name: "ikke UUID", requestId: "abc-123" },
    { name: "tom", requestId: "" },
    { name: "mangler", requestId: undefined },
  ])("4.2 requestId $name avvises", ({ requestId }) => {
    const request: Record<string, unknown> = { ...BASE(), requestId };
    if (requestId === undefined) delete request.requestId;
    expect(accepted(request)).toBe(false);
  });

  it.each(["tg_suggest", ""])("4.3 ukjent feature «%s» avvises", (feature) => {
    expect(accepted({ ...BASE(), feature })).toBe(false);
  });

  it.each([
    {
      name: "ekstra nøkkel organizationId",
      target: (t: Record<string, unknown>) => ({ ...t, organizationId: crypto.randomUUID() }),
    },
    { name: "id som ikke er UUID", target: (t: Record<string, unknown>) => ({ ...t, id: "42" }) },
    {
      name: "ulovlig type",
      target: (t: Record<string, unknown>) => ({ ...t, type: "contact" }),
    },
    {
      name: "ulovlig fieldKey",
      target: (t: Record<string, unknown>) => ({ ...t, fieldKey: "address" }),
    },
    { name: "fieldKey tg", target: (t: Record<string, unknown>) => ({ ...t, fieldKey: "tg" }) },
    {
      name: "fieldKey tg_value",
      target: (t: Record<string, unknown>) => ({ ...t, fieldKey: "tg_value" }),
    },
    { name: "mangler", target: () => undefined },
  ])("4.4 target med $name avvises", ({ target }) => {
    const base = BASE();
    expect(accepted({ ...base, target: target(base.target) })).toBe(false);
  });

  it("4.5 reportId satt til en UUID avvises; null godtas", () => {
    expect(accepted({ ...BASE(), reportId: crypto.randomUUID() })).toBe(false);
    expect(accepted({ ...BASE(), reportId: null })).toBe(true);
  });

  it("4.6 candidates mangler eller [] godtas; med ett element avvises", () => {
    const without = BASE();
    delete without.candidates;
    expect(accepted(without)).toBe(true);
    expect(accepted({ ...BASE(), candidates: [] })).toBe(true);
    expect(
      accepted({ ...BASE(), candidates: [{ id: crypto.randomUUID(), text: "Fast frase" }] }),
    ).toBe(false);
  });

  it("4.7 verdi på 5 000 tegn godtas, 5 001 avvises", () => {
    expect(accepted({ ...BASE(), fields: { text: "a".repeat(5000) } })).toBe(true);
    expect(accepted({ ...BASE(), fields: { text: "a".repeat(5001) } })).toBe(false);
  });

  it.each([
    { name: "email", fields: { text: "Tekst", email: "ola@example.com" } },
    { name: "address", fields: { text: "Tekst", address: "Fjellveien 1" } },
    { name: "bare email", fields: { email: "ola@example.com" } },
  ])("4.7 felt utenfor tillatt-listen ($name) avvises", ({ fields }) => {
    expect(accepted({ ...BASE(), fields })).toBe(false);
  });

  it.each([
    { name: "tall", fields: { text: 42 } },
    { name: "objekt", fields: { text: { value: "Tekst" } } },
    { name: "liste", fields: { text: ["Tekst"] } },
    { name: "null", fields: { text: null } },
  ])("4.7 ikke-tekst-verdi ($name) avvises", ({ fields }) => {
    expect(accepted({ ...BASE(), fields })).toBe(false);
  });

  it.each(["organizationId", "employeeId", "provider"])(
    "4.8 ukjent nøkkel på toppnivå (%s) avvises eller fjernes",
    (key) => {
      const result = parse({
        ...BASE(),
        [key]: key === "provider" ? "openai" : crypto.randomUUID(),
      });
      if (result.success) {
        expect(Object.keys(result.data as Record<string, unknown>)).not.toContain(key);
      } else {
        expect(result.success).toBe(false);
      }
    },
  );
});
