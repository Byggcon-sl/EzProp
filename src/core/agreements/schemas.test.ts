import { describe, expect, it } from "vitest";
import { agreementSchema } from "./schemas";

/*
 * Skjemaet for avtale med oppdragsgiver, som testsaker i data. Testplan:
 * docs/funksjoner/fase2a-oppdragsgiveravtale-testplan.md avsnitt 1.
 *
 * Grensene prøves med n (godtas) og n+1 (avvises). Testdata er oppdiktet: «Testavtale
 * forsikring», premisseteksten «Premiss for test. Ikke ekte tekst.», rapportprofilen `test-profil`.
 *
 * Støtter hovedmål: reklamasjoner (feil periode stoppes før lagring, så en avtale aldri gjelder
 * baklengs) og tid (feilen står ved feltet med en norsk tekst).
 */

const FIRM_ID = "0190a8c2-1f2e-7a3b-8c4d-5e6f7a8b9c0d";

type OptionalField = "premiseText" | "reportProfileCode";

function input(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    firmId: FIRM_ID,
    name: "Testavtale forsikring",
    validFrom: "2026-01-01",
    validTo: "",
    premiseText: "Premiss for test. Ikke ekte tekst.",
    reportProfileCode: "test-profil",
    ...overrides,
  };
}

/** Meldingene ved feltet når skjemaet avviser, ellers tom liste. */
function messagesAt(values: Record<string, unknown>, field: string): string[] {
  const result = agreementSchema.safeParse(values);
  if (result.success) return [];
  return result.error.issues
    .filter((issue) => String(issue.path[0] ?? "") === field)
    .map((issue) => issue.message);
}

/** En norsk melding, ikke Zods engelske standardtekst. */
function expectNorwegianMessage(messages: string[]) {
  expect(messages.length, "feilen har en melding ved feltet").toBeGreaterThan(0);
  for (const message of messages) {
    expect(message.trim().length).toBeGreaterThan(0);
    expect(message).not.toMatch(/^(Invalid|Too (small|big)|Expected|String must|Required)/);
  }
}

function parse(values: Record<string, unknown>) {
  return agreementSchema.parse(values);
}

describe("1.1 grenser (n godtas, n+1 avvises)", () => {
  it.each([
    { field: "name", max: 120 },
    { field: "premiseText", max: 10_000 },
    { field: "reportProfileCode", max: 60 },
  ])("$field: $max tegn godtas, ett til avvises med norsk melding", ({ field, max }) => {
    expect(agreementSchema.safeParse(input({ [field]: "a".repeat(max) })).success).toBe(true);
    expectNorwegianMessage(messagesAt(input({ [field]: "a".repeat(max + 1) }), field));
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
  ])("$name avvises med norsk melding ved feltet", ({ overrides, field }) => {
    expectNorwegianMessage(messagesAt(input(overrides), field));
  });
});

describe("1.3 periode", () => {
  it.each([
    { validFrom: "2026-03-01", validTo: "2026-02-28", ok: false },
    { validFrom: "2026-03-01", validTo: "2026-03-01", ok: true },
    { validFrom: "2026-03-01", validTo: "2026-10-31", ok: true },
    { validFrom: "2026-03-01", validTo: "", ok: true },
  ])("fra $validFrom til «$validTo» → godtas: $ok", ({ validFrom, validTo, ok }) => {
    const values = input({ validFrom, validTo });
    if (ok) {
      expect(agreementSchema.safeParse(values).success).toBe(true);
    } else {
      expectNorwegianMessage(messagesAt(values, "validTo"));
    }
  });

  it("tom validTo blir null (løpende), og null godtas også", () => {
    expect(parse(input({ validTo: "" })).validTo).toBeNull();
    expect(parse(input({ validTo: null })).validTo).toBeNull();
    expect(parse(input({ validTo: "2026-10-31" })).validTo).toBe("2026-10-31");
    expect(parse(input()).validFrom).toBe("2026-01-01");
  });
});

describe("1.4 datoformat", () => {
  it.each([
    { field: "validFrom", value: "2026-13-01" },
    { field: "validFrom", value: "ikke-dato" },
    { field: "validTo", value: "2026-13-01" },
    { field: "validTo", value: "ikke-dato" },
  ])("$field = «$value» avvises med norsk melding, aldri unntak", ({ field, value }) => {
    expect(() => agreementSchema.safeParse(input({ [field]: value }))).not.toThrow();
    expectNorwegianMessage(messagesAt(input({ [field]: value }), field));
  });
});

describe("1.5 trimming og tomme felt", () => {
  it("navnet trimmes", () => {
    expect(parse(input({ name: "  Testavtale forsikring  " })).name).toBe("Testavtale forsikring");
  });

  it.each<OptionalField>(["premiseText", "reportProfileCode"])("tom %s blir null", (field) => {
    expect(parse(input({ [field]: "" }))[field]).toBeNull();
    expect(parse(input({ [field]: "   " }))[field]).toBeNull();
  });

  it("verdiene kommer ut som de ble sendt inn", () => {
    expect(parse(input())).toMatchObject({
      firmId: FIRM_ID,
      name: "Testavtale forsikring",
      validFrom: "2026-01-01",
      validTo: null,
      premiseText: "Premiss for test. Ikke ekte tekst.",
      reportProfileCode: "test-profil",
    });
  });
});

describe("1.6 organizationId i input", () => {
  it("tas ikke med av skjemaet (organisasjonen kommer fra tilgangssjekken)", () => {
    const parsed = parse(input({ organizationId: "0190a8c2-0000-7000-8000-000000000000" }));
    expect(parsed).not.toHaveProperty("organizationId");
  });
});
