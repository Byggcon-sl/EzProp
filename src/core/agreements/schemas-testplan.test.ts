import { describe, expect, it } from "vitest";
import { agreementSchema } from "./schemas";

/*
 * Skjemaet for avtale med oppdragsgiver, ren regeltest som data.
 * Testplan: docs/funksjoner/fase2a-oppdragsgiveravtale-testplan.md avsnitt 1.
 *
 * Testdata er oppdiktet: «Testavtale forsikring», premisseteksten «Premiss for test. Ikke ekte
 * tekst.», rapportprofilen `test-profil`.
 *
 * Støtter hovedmål: reklamasjoner (feil periode og for lange tekster stoppes med norsk melding
 * ved feltet, aldri som databasefeil) og tid (feilen vises der den skal rettes).
 */

const FIRM_ID = "0190a000-0000-7000-8000-000000000019";

function input(overrides: Record<string, unknown> = {}) {
  return {
    firmId: FIRM_ID,
    name: "Testavtale forsikring",
    validFrom: "2026-03-01",
    validTo: "2026-10-31",
    premiseText: "Premiss for test. Ikke ekte tekst.",
    reportProfileCode: "test-profil",
    ...overrides,
  };
}

/** Meldingene ved feltet, eller `[]` når skjemaet godtar input. */
function messagesAt(value: Record<string, unknown>, field: string): string[] {
  const result = agreementSchema.safeParse(value);
  if (result.success) return [];
  return result.error.issues
    .filter((issue) => issue.path.join(".") === field)
    .map((issue) => issue.message);
}

/** Norsk melding: ikke tom, ingen engelske standardmeldinger fra Zod. */
function expectNorwegian(messages: string[]) {
  expect(messages.length, "ventet minst én melding ved feltet").toBeGreaterThan(0);
  for (const message of messages) {
    expect(message.trim()).not.toBe("");
    expect(message).not.toMatch(
      /\b(Invalid|Expected|Required|String must|Too (small|big)|received)\b/,
    );
  }
}

describe("1.1 grenser (n godtas, n+1 avvises)", () => {
  it.each([
    { field: "name", max: 120 },
    { field: "premiseText", max: 10_000 },
    { field: "reportProfileCode", max: 60 },
  ])("$field: $max tegn godtas, ett til avvises med norsk melding", ({ field, max }) => {
    const ok = agreementSchema.safeParse(input({ [field]: "a".repeat(max) }));
    expect(ok.success, `${max} tegn i ${field} skal godtas`).toBe(true);
    if (ok.success) expect((ok.data as Record<string, unknown>)[field]).toBe("a".repeat(max));

    expectNorwegian(messagesAt(input({ [field]: "a".repeat(max + 1) }), field));
  });
});

describe("1.2 påkrevde felt", () => {
  it.each([
    { name: "tomt navn", overrides: { name: "" }, field: "name" },
    { name: "navn med bare mellomrom", overrides: { name: "   " }, field: "name" },
    { name: "mangler validFrom", overrides: { validFrom: undefined }, field: "validFrom" },
    { name: "tom validFrom", overrides: { validFrom: "" }, field: "validFrom" },
    { name: "mangler firmId", overrides: { firmId: undefined }, field: "firmId" },
    { name: "tom firmId", overrides: { firmId: "" }, field: "firmId" },
  ])("$name → norsk melding ved $field", ({ overrides, field }) => {
    expectNorwegian(messagesAt(input(overrides), field));
  });
});

describe("1.3 perioden", () => {
  it.each([
    { name: "til-dato dagen før fra-dato", validTo: "2026-02-28", ok: false },
    { name: "til-dato lik fra-dato", validTo: "2026-03-01", ok: true },
    { name: "til-dato etter fra-dato", validTo: "2026-10-31", ok: true },
    { name: "tom til-dato (løpende)", validTo: "", ok: true },
    { name: "til-dato null (løpende)", validTo: null, ok: true },
  ])("$name → godtas: $ok", ({ validTo, ok }) => {
    const value = input({ validFrom: "2026-03-01", validTo });
    const result = agreementSchema.safeParse(value);
    expect(result.success).toBe(ok);
    if (!ok) expectNorwegian(messagesAt(value, "validTo"));
  });

  it("tom validTo blir null (løpende avtale)", () => {
    expect(agreementSchema.parse(input({ validTo: "" })).validTo).toBeNull();
    expect(agreementSchema.parse(input({ validTo: null })).validTo).toBeNull();
  });
});

describe("1.4 datoformat", () => {
  it.each([
    { field: "validFrom", value: "2026-13-01" },
    { field: "validFrom", value: "ikke-dato" },
    { field: "validTo", value: "2026-13-01" },
    { field: "validTo", value: "ikke-dato" },
  ])("$field = «$value» avvises med norsk melding (aldri databasefeil)", ({ field, value }) => {
    expect(agreementSchema.safeParse(input({ [field]: value })).success).toBe(false);
    expectNorwegian(messagesAt(input({ [field]: value }), field));
  });
});

describe("1.5 trimming og tomme felt", () => {
  it("navnet trimmes", () => {
    expect(agreementSchema.parse(input({ name: "  Testavtale forsikring  " })).name).toBe(
      "Testavtale forsikring",
    );
  });

  it.each(["premiseText", "reportProfileCode"])("tom %s blir null", (field) => {
    const parsed = agreementSchema.parse(input({ [field]: "" })) as Record<string, unknown>;
    expect(parsed[field]).toBeNull();
  });

  it("premisseteksten og rapportprofilen beholdes", () => {
    const parsed = agreementSchema.parse(input());
    expect(parsed.premiseText).toBe("Premiss for test. Ikke ekte tekst.");
    expect(parsed.reportProfileCode).toBe("test-profil");
  });
});

describe("1.6 organizationId i input", () => {
  it("tas ikke med av skjemaet", () => {
    const parsed = agreementSchema.parse(
      input({ organizationId: "0190a000-0000-7000-8000-0000000000bb" }),
    );
    expect(parsed).not.toHaveProperty("organizationId");
  });
});
