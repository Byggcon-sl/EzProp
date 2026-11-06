import { describe, expect, it } from "vitest";
import { todayInOslo } from "@/shared/lib/dates";
import {
  CLAIM_OUTCOMES,
  CLAIM_TYPES,
  claimInputSchema,
  claimOutcomeLabel,
  claimTypeLabel,
} from "./index";

/*
 * Valideringsreglene for reklamasjonssaken, som testsaker i data (regler som data). Testplan:
 * docs/funksjoner/fase2a-reklamasjoner-testplan.md avsnitt 2.
 *
 * Hver regel er en tabell: input, godtatt eller avvist, og regelkoden (`params.rule` på feilen).
 * Dagens dato i Europe/Oslo sendes inn i skjemaet (`todayInOslo(now)`), så datogrensen kan testes
 * med fast tid. Testdata er oppdiktet: «Kjøper Test», «Fukt i kjeller ikke nevnt», «Kjeller,
 * yttervegg».
 *
 * Støtter hovedmål: reklamasjoner (saken lagres riktig: aldri fram i tid, beløp bare ved medhold
 * eller forlik, så tallene kan stoles på) og tid (feilene står ved feltet med norsk tekst).
 */

/** 03.11.2026 kl. 11.00 i Oslo. Samme som `TEST_NOW` i tests/factories.ts. */
const TEST_NOW = new Date("2026-11-03T10:00:00Z");
/** 03.11.2026 kl. 23.30 i Oslo (vintertid, UTC+1). */
const LATE_EVENING = new Date("2026-11-03T22:30:00Z");
/** 04.11.2026 kl. 00.30 i Oslo, men fortsatt 03.11 i UTC. */
const AFTER_MIDNIGHT = new Date("2026-11-03T23:30:00Z");

const PARTY_ID = "0190a8c2-1f2e-7a3b-8c4d-5e6f7a8b9c0d";

const RULES = [
  "claimant_required",
  "received_at_not_future",
  "amount_only_upheld_or_settled",
  "text_limits",
  "enum_values",
] as const;
type Rule = (typeof RULES)[number];

function input(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const result: Record<string, unknown> = {
    claimType: "complaint",
    receivedAt: "2026-11-02",
    claimantText: "Kjøper Test",
    description: "Fukt i kjeller ikke nevnt",
    buildingPartText: "Kjeller, yttervegg",
    ...overrides,
  };
  // `undefined` i overstyringen betyr at feltet mangler
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete result[key];
  }
  return result;
}

function schemaAt(now: Date) {
  return claimInputSchema(todayInOslo(now));
}

/** Regelkodene på feilene (`params.rule`), eller tom liste når skjemaet godtar. */
function rulesOf(values: Record<string, unknown>, now: Date): string[] {
  const result = schemaAt(now).safeParse(values);
  if (result.success) return [];
  return result.error.issues.map((issue) => {
    const params = (issue as { params?: { rule?: unknown } }).params;
    return typeof params?.rule === "string" ? params.rule : `uten regelkode: ${issue.message}`;
  });
}

function messagesOf(values: Record<string, unknown>, now: Date = TEST_NOW): string[] {
  const result = schemaAt(now).safeParse(values);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.message);
}

/** En norsk melding, ikke Zods engelske standardtekst. */
function expectNorwegianMessages(messages: string[]) {
  expect(messages.length, "skjemaet skulle avvist").toBeGreaterThan(0);
  for (const message of messages) {
    expect(message.trim().length).toBeGreaterThan(0);
    expect(message).not.toMatch(/^(Invalid|Too (small|big)|Expected|String must|Required)/);
  }
}

function parsed(values: Record<string, unknown>, now: Date = TEST_NOW): Record<string, unknown> {
  return schemaAt(now).parse(values) as Record<string, unknown>;
}

type RuleCase = {
  name: string;
  values: Record<string, unknown>;
  now?: Date;
  accepted: boolean;
  /** Regelkoden som skal stå på feilen når saken avvises. */
  rule?: Rule;
};

function rejected(name: string, values: Record<string, unknown>, rule: Rule, now?: Date): RuleCase {
  return { name, values, rule, now, accepted: false };
}

function accepted(name: string, values: Record<string, unknown>, now?: Date): RuleCase {
  return { name, values, now, accepted: true };
}

/** Alle testsakene, gruppert per regel. En egen test sjekker at alle reglene er dekket. */
const CASES: Record<Rule, RuleCase[]> = {
  claimant_required: [
    accepted("bare part", input({ claimantPartyId: PARTY_ID, claimantText: undefined })),
    accepted("bare fritekst «Kjøper Test»", input()),
    accepted("både part og fritekst", input({ claimantPartyId: PARTY_ID })),
    rejected("ingen av dem", input({ claimantText: undefined }), "claimant_required"),
    rejected(
      "part null og fritekst null",
      input({ claimantPartyId: null, claimantText: null }),
      "claimant_required",
    ),
    rejected("fritekst tom streng", input({ claimantText: "" }), "claimant_required"),
    rejected("fritekst bare mellomrom", input({ claimantText: "   " }), "claimant_required"),
  ],
  received_at_not_future: [
    accepted("TEST_NOW: i dag 2026-11-03", input({ receivedAt: "2026-11-03" })),
    accepted("TEST_NOW: i går 2026-11-02", input({ receivedAt: "2026-11-02" })),
    rejected(
      "TEST_NOW: i morgen 2026-11-04",
      input({ receivedAt: "2026-11-04" }),
      "received_at_not_future",
    ),
    rejected(
      "LATE_EVENING (03.11 kl. 23.30 i Oslo): 2026-11-04",
      input({ receivedAt: "2026-11-04" }),
      "received_at_not_future",
      LATE_EVENING,
    ),
    accepted("LATE_EVENING: 2026-11-03", input({ receivedAt: "2026-11-03" }), LATE_EVENING),
    accepted(
      "AFTER_MIDNIGHT (04.11 i Oslo, 03.11 i UTC): 2026-11-04",
      input({ receivedAt: "2026-11-04" }),
      AFTER_MIDNIGHT,
    ),
    rejected(
      "AFTER_MIDNIGHT: 2026-11-05",
      input({ receivedAt: "2026-11-05" }),
      "received_at_not_future",
      AFTER_MIDNIGHT,
    ),
  ],
  amount_only_upheld_or_settled: [
    accepted("medhold + 50 000", input({ outcome: "upheld", amount: 50_000 })),
    accepted("forlik + 0", input({ outcome: "settled", amount: 0 })),
    accepted("medhold uten beløp", input({ outcome: "upheld" })),
    accepted("forlik med beløp null", input({ outcome: "settled", amount: null })),
    ...(["open", "rejected", "withdrawn"] as const).map((outcome) =>
      rejected(
        `${outcome} + 10 000`,
        input({ outcome, amount: 10_000 }),
        "amount_only_upheld_or_settled",
      ),
    ),
    ...(["upheld", "settled", "open", "rejected"] as const).flatMap((outcome) => [
      rejected(
        `negativt beløp (-1), ${outcome}`,
        input({ outcome, amount: -1 }),
        "amount_only_upheld_or_settled",
      ),
      rejected(
        `desimal (100,5), ${outcome}`,
        input({ outcome, amount: 100.5 }),
        "amount_only_upheld_or_settled",
      ),
    ]),
    rejected(
      "gjenåpning: open + 20 000 (endring fra forlik + 20 000)",
      input({ outcome: "open", amount: 20_000 }),
      "amount_only_upheld_or_settled",
    ),
  ],
  text_limits: [
    rejected("beskrivelse tom", input({ description: "" }), "text_limits"),
    rejected("beskrivelse bare mellomrom", input({ description: "   " }), "text_limits"),
    accepted("beskrivelse 1 tegn", input({ description: "a" })),
    accepted("beskrivelse 2 000 tegn", input({ description: "a".repeat(2000) })),
    rejected("beskrivelse 2 001 tegn", input({ description: "a".repeat(2001) }), "text_limits"),
    accepted("klager 200 tegn", input({ claimantText: "a".repeat(200) })),
    rejected("klager 201 tegn", input({ claimantText: "a".repeat(201) }), "text_limits"),
    accepted("bygningsdel 200 tegn", input({ buildingPartText: "a".repeat(200) })),
    rejected("bygningsdel 201 tegn", input({ buildingPartText: "a".repeat(201) }), "text_limits"),
  ],
  enum_values: [
    ...CLAIM_TYPES.map((claimType) => accepted(`type ${claimType}`, input({ claimType }))),
    ...CLAIM_OUTCOMES.map((outcome) => accepted(`utfall ${outcome}`, input({ outcome }))),
    ...["internal", "closed", ""].map((claimType) =>
      rejected(`type ${JSON.stringify(claimType)}`, input({ claimType }), "enum_values"),
    ),
    rejected("type mangler", input({ claimType: undefined }), "enum_values"),
    ...["closed", "internal", ""].map((outcome) =>
      rejected(`utfall ${JSON.stringify(outcome)}`, input({ outcome }), "enum_values"),
    ),
  ],
};

describe.each(RULES)("2. regelen %s", (rule) => {
  it.each(CASES[rule])("$name: godtatt = $accepted", (testCase) => {
    const now = testCase.now ?? TEST_NOW;
    const rules = rulesOf(testCase.values, now);
    if (testCase.accepted) {
      expect(rules, `skulle vært godtatt, fikk ${rules.join(", ")}`).toEqual([]);
    } else {
      expect(rules.length, "skulle vært avvist").toBeGreaterThan(0);
      expect(rules).toContain(testCase.rule);
      expectNorwegianMessages(messagesOf(testCase.values, now));
    }
  });
});

describe("2. alle reglene har testsaker", () => {
  it("hver av de fem regelkodene står i minst én avvist testsak", () => {
    for (const rule of RULES) {
      const cases = Object.values(CASES)
        .flat()
        .filter((c) => !c.accepted && c.rule === rule);
      expect(cases.length, `regelen ${rule} mangler avvist testsak`).toBeGreaterThan(0);
    }
  });
});

describe("2.2 ugyldig dato", () => {
  it.each(["2026-02-30", "i går", "", "03.11.2026"])(
    "%j avvises med norsk melding",
    (receivedAt) => {
      expectNorwegianMessages(messagesOf(input({ receivedAt })));
    },
  );

  it("manglende dato avvises med norsk melding", () => {
    expectNorwegianMessages(messagesOf(input({ receivedAt: undefined })));
  });
});

describe("2.4 tekst trimmes, tom valgfri tekst blir null", () => {
  it("beskrivelse, klager og bygningsdel trimmes", () => {
    const result = parsed(
      input({
        description: "  Fukt i kjeller ikke nevnt  ",
        claimantText: "  Kjøper Test ",
        buildingPartText: " Kjeller, yttervegg  ",
      }),
    );
    expect(result.description).toBe("Fukt i kjeller ikke nevnt");
    expect(result.claimantText).toBe("Kjøper Test");
    expect(result.buildingPartText).toBe("Kjeller, yttervegg");
  });

  it("tom klager-fritekst (med part) og tom bygningsdel blir null", () => {
    const result = parsed(
      input({ claimantPartyId: PARTY_ID, claimantText: "", buildingPartText: "" }),
    );
    expect(result.claimantText).toBeNull();
    expect(result.buildingPartText).toBeNull();
  });

  it("bygningsdel med bare mellomrom blir null", () => {
    expect(parsed(input({ buildingPartText: "   " })).buildingPartText).toBeNull();
  });
});

describe("2.5 utfall som mangler", () => {
  it("gir open", () => {
    expect(parsed(input({ outcome: undefined })).outcome).toBe("open");
  });
});

describe("2.6 og 2.7 felt kjernen setter selv, brukes aldri", () => {
  it("closedAt, createdBy og organizationId fra klienten finnes ikke i resultatet", () => {
    const values = input({
      outcome: "rejected",
      closedAt: "2026-01-01T00:00:00Z",
      createdBy: PARTY_ID,
      organizationId: PARTY_ID,
      deletedAt: "2026-01-01T00:00:00Z",
      id: PARTY_ID,
    });
    const result = schemaAt(TEST_NOW).safeParse(values);
    // Skjemaet kan ta bort feltene eller avvise dem, men aldri gi dem videre
    if (result.success) {
      const data = result.data as Record<string, unknown>;
      for (const key of ["closedAt", "createdBy", "organizationId", "deletedAt", "id"]) {
        expect(data, `feltet ${key} skulle vært tatt bort`).not.toHaveProperty(key);
      }
    } else {
      expectNorwegianMessages(result.error.issues.map((issue) => issue.message));
    }
  });
});

describe("2.8 faste koder og norske etiketter (regel 6)", () => {
  it("CLAIM_TYPES er låst i fast rekkefølge", () => {
    expect([...CLAIM_TYPES]).toEqual(["complaint", "insurance_claim", "other"]);
  });

  it("CLAIM_OUTCOMES er låst i fast rekkefølge", () => {
    expect([...CLAIM_OUTCOMES]).toEqual(["open", "rejected", "upheld", "settled", "withdrawn"]);
  });

  it.each([
    ["complaint", "Reklamasjon"],
    ["insurance_claim", "Forsikringskrav"],
    ["other", "Annet"],
  ])("claimTypeLabel(%s) = %s", (code, label) => {
    expect(claimTypeLabel(code)).toBe(label);
  });

  it.each([
    ["open", "Åpen"],
    ["rejected", "Avvist"],
    ["upheld", "Medhold"],
    ["settled", "Forlik"],
    ["withdrawn", "Trukket"],
  ])("claimOutcomeLabel(%s) = %s", (code, label) => {
    expect(claimOutcomeLabel(code)).toBe(label);
  });

  it("ukjent kode gir koden tilbake, aldri undefined", () => {
    expect(claimTypeLabel("internal")).toBe("internal");
    expect(claimOutcomeLabel("closed")).toBe("closed");
    expect(claimTypeLabel("")).toBe("");
  });
});
