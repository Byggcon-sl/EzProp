import { describe, expect, it } from "vitest";
import { timeTrackingBaselineSchema, timeTrackingSettingsSchema, WORK_PHASES } from "./index";

/*
 * Skjemaet for nullpunktet og bryteren (docs/funksjoner/fase2a-tidsmaling-testplan.md avsnitt 3,
 * A123). Oppdiktet kilde: «Oppdiktet måling, 3 oppdrag».
 *
 * Støtter hovedmål: tid (nullpunktet er riktig, så sammenligningen med IVIT er til å stole på).
 */

const SOURCE = "Oppdiktet måling, 3 oppdrag";

function baseline(overrides: Record<string, unknown> = {}) {
  return {
    preparation: 30,
    inspection: 60,
    office: 120,
    delivery: 15,
    source: SOURCE,
    ...overrides,
  };
}

/** Norsk melding: ikke Zods engelske standardtekst, og ikke tom. */
function expectNorwegianMessage(message: string | undefined) {
  expect(message, "meldingen finnes").toBeTruthy();
  expect(message).not.toMatch(/\b(invalid|expected|too (big|small)|must|required|received)\b/i);
}

function firstIssue(result: {
  success: boolean;
  error?: { issues: { message: string; path: PropertyKey[] }[] };
}) {
  expect(result.success).toBe(false);
  return result.error!.issues[0]!;
}

describe("3.1 minutter per fase", () => {
  const rejected: [string, unknown][] = [
    ["-1", -1],
    ["10 001", 10_001],
    ["12.5", 12.5],
    ["tekst", "30"],
    ["tom tekst", ""],
    ["null", null],
  ];
  const accepted: [string, number][] = [
    ["0", 0],
    ["10 000", 10_000],
  ];

  describe.each([...WORK_PHASES])("%s", (phase) => {
    it.each(rejected)("%s avvises med norsk melding", (_label, value) => {
      const result = timeTrackingBaselineSchema.safeParse(baseline({ [phase]: value }));
      const issue = firstIssue(result);
      expect(issue.path).toEqual([phase]);
      expectNorwegianMessage(issue.message);

      const wrapped = timeTrackingSettingsSchema.safeParse({
        baseline: baseline({ [phase]: value }),
      });
      expect(wrapped.success).toBe(false);
    });

    it.each(accepted)("%s godtas", (_label, value) => {
      const result = timeTrackingBaselineSchema.safeParse(baseline({ [phase]: value }));
      expect(result.success).toBe(true);
      expect(result.data?.[phase]).toBe(value);
    });

    it("mangler fasen, avvises", () => {
      const input = baseline();
      delete (input as Record<string, unknown>)[phase];
      expect(timeTrackingBaselineSchema.safeParse(input).success).toBe(false);
    });
  });
});

describe("3.2 kilde", () => {
  it("tom kilde godtas", () => {
    const result = timeTrackingBaselineSchema.safeParse(baseline({ source: "" }));
    expect(result.success).toBe(true);
    expect(result.data?.source).toBe("");
  });

  it("200 tegn godtas", () => {
    const source = "a".repeat(200);
    const result = timeTrackingBaselineSchema.safeParse(baseline({ source }));
    expect(result.success).toBe(true);
    expect(result.data?.source).toBe(source);
  });

  it("201 tegn avvises med norsk melding", () => {
    const issue = firstIssue(
      timeTrackingBaselineSchema.safeParse(baseline({ source: "a".repeat(201) })),
    );
    expect(issue.path).toEqual(["source"]);
    expectNorwegianMessage(issue.message);
  });

  it("kilden trimmes", () => {
    const result = timeTrackingBaselineSchema.safeParse(baseline({ source: `  ${SOURCE}  ` }));
    expect(result.success).toBe(true);
    expect(result.data?.source).toBe(SOURCE);
  });

  it("200 tegn pluss mellomrom rundt godtas etter trimming", () => {
    const source = "b".repeat(200);
    const result = timeTrackingBaselineSchema.safeParse(baseline({ source: `  ${source}  ` }));
    expect(result.success).toBe(true);
    expect(result.data?.source).toBe(source);
  });
});

describe("3.3 bryteren", () => {
  it.each([true, false])("%s godtas", (enabled) => {
    const result = timeTrackingSettingsSchema.safeParse({ enabled });
    expect(result.success).toBe(true);
    expect(result.data?.enabled).toBe(enabled);
  });

  it.each([
    ["tekst «true»", "true"],
    ["tekst «on»", "on"],
    ["tallet 1", 1],
    ["tallet 0", 0],
    ["null", null],
  ])("%s avvises med norsk melding", (_label, enabled) => {
    const issue = firstIssue(timeTrackingSettingsSchema.safeParse({ enabled }));
    expectNorwegianMessage(issue.message);
  });
});

describe("3.4 ukjente nøkler tas ikke med", () => {
  it("access.inspectors_edit_all og organizationId forsvinner", () => {
    const result = timeTrackingSettingsSchema.safeParse({
      enabled: true,
      baseline: { ...baseline(), employeeId: "x" },
      "access.inspectors_edit_all": false,
      organizationId: "0190a000-0000-7000-8000-000000000002",
    });
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(["baseline", "enabled"]);
    expect(Object.keys(data.baseline as object).sort()).toEqual([
      "delivery",
      "inspection",
      "office",
      "preparation",
      "source",
    ]);
  });
});
