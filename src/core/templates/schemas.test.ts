import { describe, expect, it } from "vitest";
import { OUTCOME_KINDS } from "@/db/schema";
import { buildTemplateDocument } from "../../../tests/template-document";
import {
  TEMPLATE_ISSUE_RULES,
  checkNoBlockerInCustom,
  checkNoTgLogicInCustom,
  isSameTemplateContent,
  parseTemplateDocument,
  type TemplateDocument,
  type TemplateIssue,
  type TemplateIssueRule,
} from "./index";

/*
 * Dokumentformatet og den rene sjekken av TG-logikk (docs/funksjoner/fase2a-malmotor-testplan.md
 * avsnitt 2). Regler som data: hver regel er en tabell med testsaker (dokument med én endring,
 * forventet godtatt eller avvist, og forventet `issues[].rule`). Ingen database.
 *
 * Støtter hovedmål: KI først og reklamasjoner (faste koder med fast format, ingen TGIU som utfall og
 * ingen TG-logikk i egne maler, så regelmotoren og KI senere kan knytte forslag og reklamasjoner til
 * samme punkt over mange år). Testdata er oppdiktet og uten fagtekst.
 */

type Doc = ReturnType<typeof buildTemplateDocument>;
type Change = (doc: Doc) => void;

/** Reglene som ble sett i avviste saker i denne filen (til dekningstesten nederst). */
const seenRules = new Set<TemplateIssueRule>();

function parse(change: Change) {
  const doc = buildTemplateDocument();
  change(doc);
  return parseTemplateDocument(doc);
}

function expectAccepted(change: Change) {
  const result = parse(change);
  expect(result.success ? [] : result.issues).toEqual([]);
  return result;
}

function expectRejected(change: Change, rule: TemplateIssueRule, path?: string) {
  const result = parse(change);
  expect(result.success, "dokumentet skulle vært avvist").toBe(false);
  const issues = result.success ? [] : result.issues;
  for (const issue of issues) seenRules.add(issue.rule);
  expect(issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining(path === undefined ? { rule } : { rule, path }),
    ]),
  );
  return issues;
}

function parsedDocument(change: Change = () => {}): TemplateDocument {
  const result = parse(change);
  if (!result.success)
    throw new Error(`testdokumentet er ugyldig: ${JSON.stringify(result.issues)}`);
  return result.document;
}

describe("buildTemplateDocument", () => {
  it("er gyldig etter skjemaet", () => {
    expectAccepted(() => {});
  });
});

// --- 2.1 key_format ---------------------------------------------------------------------------

/** Stedene med kode som prøves: tabell og sti til koden på første rad. */
const keyPlaces = [
  { table: "seksjon", list: "sections" },
  { table: "felt", list: "elements" },
  { table: "valg", list: "element_options" },
  { table: "kontrollpunkt", list: "checkpoints" },
  { table: "avviksspørsmål", list: "deviation_questions" },
  { table: "utfall", list: "outcomes" },
  { table: "regel", list: "rules" },
] as const;

function setKey(list: (typeof keyPlaces)[number]["list"], key: string): Change {
  return (doc) => {
    const rows = doc[list] as { key: string }[];
    rows[0]!.key = key;
  };
}

const goodKeys = ["wet_room.membrane", "a", "a1.b_2"];
const badKeys = ["Stor", "med mellomrom", "med-bindestrek", "", ".ledende", "æøå"];

describe("2.1 key_format", () => {
  it.each(keyPlaces.flatMap((place) => goodKeys.map((key) => ({ ...place, key }))))(
    "godtar «$key» på $table",
    ({ list, key }) => {
      expectAccepted(setKey(list, key));
    },
  );

  it.each(keyPlaces.flatMap((place) => badKeys.map((key) => ({ ...place, key }))))(
    "avviser «$key» på $table med key_format",
    ({ list, key }) => {
      expectRejected(setKey(list, key), "key_format", `${list}.0.key`);
    },
  );
});

// --- 2.2 outcome_tgiu -------------------------------------------------------------------------

describe("2.2 outcome_tgiu", () => {
  it("avviser utfall med tgiu", () => {
    expectRejected(
      (doc) => {
        doc.outcomes[0]!.kind = "tgiu" as never;
      },
      "outcome_tgiu",
      "outcomes.0.kind",
    );
  });

  it.each([...OUTCOME_KINDS])("godtar utfall med %s", (kind) => {
    expect(kind).not.toBe("tgiu");
    expectAccepted((doc) => {
      doc.outcomes[0]!.kind = kind;
    });
  });

  it("listen over lovlige utfall har TG2 og TG3, men ikke tgiu", () => {
    expect(OUTCOME_KINDS).toEqual(expect.arrayContaining(["tg2", "tg3"]));
    expect(OUTCOME_KINDS as readonly string[]).not.toContain("tgiu");
  });
});

// --- 2.3 schema -------------------------------------------------------------------------------

const schemaRejections: { name: string; change: Change; path: string }[] = [
  {
    name: "manglende key",
    change: (doc) => {
      delete (doc.sections[0] as { key?: string }).key;
    },
    path: "sections.0.key",
  },
  {
    name: "ukjent field_type",
    change: (doc) => {
      doc.elements[0]!.field_type = "slider" as never;
    },
    path: "elements.0.field_type",
  },
  {
    name: "ukjent repeat",
    change: (doc) => {
      doc.sections[0]!.repeat = "per_floor" as never;
    },
    path: "sections.0.repeat",
  },
  {
    name: "ukjent regeltype",
    change: (doc) => {
      doc.rules[0]!.purpose = "explode" as never;
    },
    path: "rules.0.purpose",
  },
  {
    name: "table_columns som tekst",
    change: (doc) => {
      doc.elements[2]!.table_columns = "a,b" as never;
    },
    path: "elements.2.table_columns",
  },
  {
    name: "table_columns som objekt",
    change: (doc) => {
      doc.elements[2]!.table_columns = { a: 1 } as never;
    },
    path: "elements.2.table_columns",
  },
  {
    name: "ukjent phrase_slot",
    change: (doc) => {
      doc.elements[0]!.phrase_slot = "ukjent_sted" as never;
    },
    path: "elements.0.phrase_slot",
  },
];

describe("2.3 schema", () => {
  it.each(schemaRejections)("avviser $name med schema", ({ change, path }) => {
    expectRejected(change, "schema", path);
  });

  it.each([
    {
      name: "tom liste i table_columns",
      change: ((doc) => {
        doc.elements[2]!.table_columns = [];
      }) as Change,
    },
    {
      name: "kjent phrase_slot",
      change: ((doc) => {
        doc.elements[0]!.phrase_slot = "deviation";
      }) as Change,
    },
  ])("godtar $name", ({ change }) => {
    expectAccepted(change);
  });
});

// --- 2.4 organizationId, id og version_id brukes aldri -----------------------------------------

describe("2.4 organizationId, id og version_id i dokumentet", () => {
  it("strippes eller avvises, aldri brukt", () => {
    const foreign = "00000000-0000-4000-8000-000000000001";
    const result = parse((doc) => {
      Object.assign(doc, { organizationId: foreign, organization_id: foreign, id: foreign });
      Object.assign(doc.sections[0]!, {
        organizationId: foreign,
        organization_id: foreign,
        id: foreign,
        version_id: foreign,
      });
      Object.assign(doc.checkpoints[0]!, { organizationId: foreign, id: foreign });
      Object.assign(doc.outcomes[0]!, { organization_id: foreign, id: foreign });
    });
    if (result.success) {
      expect(JSON.stringify(result.document)).not.toContain(foreign);
    } else {
      for (const issue of result.issues) expect(issue.rule).toBe("schema");
    }
  });
});

// --- 2.5 checkNoTgLogicInCustom ---------------------------------------------------------------

const onlyCheckpoint: Change = (doc) => {
  doc.rules = [];
  doc.rule_conditions = [];
  doc.rule_test_cases = [];
};
const noCheckpoints: Change = (doc) => {
  doc.checkpoints = [];
  doc.deviation_questions = [];
  doc.outcomes = [];
  doc.standard_measures = [];
  doc.elements[0]!.checkpoint_key = null;
};
function onlyRules(...purposes: string[]): Change {
  return (doc) => {
    noCheckpoints(doc);
    doc.rule_conditions = [];
    doc.rule_test_cases = [];
    doc.rules = purposes.map((purpose, i) => ({
      key: `rule.r${i}`,
      name: `Regel ${i}`,
      purpose: purpose as never,
      target_element_key: "el.count",
    }));
  };
}

const tgCases: {
  name: string;
  kind: "system" | "custom";
  change: Change;
  rejected: boolean;
}[] = [
  { name: "custom med kontrollpunkt", kind: "custom", change: onlyCheckpoint, rejected: true },
  {
    name: "custom med suggest_outcome",
    kind: "custom",
    change: onlyRules("suggest_outcome"),
    rejected: true,
  },
  {
    name: "custom med suggest_tgiu",
    kind: "custom",
    change: onlyRules("suggest_tgiu"),
    rejected: true,
  },
  {
    name: "custom med suggest_tg0",
    kind: "custom",
    change: onlyRules("suggest_tg0"),
    rejected: true,
  },
  {
    name: "custom med show og validate",
    kind: "custom",
    change: onlyRules("show", "validate"),
    rejected: false,
  },
  {
    name: "custom uten kontrollpunkt og regler",
    kind: "custom",
    change: onlyRules(),
    rejected: false,
  },
  { name: "system med alt", kind: "system", change: () => {}, rejected: false },
  {
    name: "system med alle fire regeltyper",
    kind: "system",
    change: (doc) => {
      doc.rules.push({
        key: "rule.tgiu",
        name: "TGIU-forslag",
        purpose: "suggest_tgiu",
        target_checkpoint_key: "cp.one",
      });
    },
    rejected: false,
  },
  {
    name: "R4.2 system med suggest_tg0",
    kind: "system",
    change: (doc) => {
      doc.rules.push({
        key: "rule.tg0",
        name: "TG0-forslag",
        purpose: "suggest_tg0",
        target_checkpoint_key: "cp.one",
      });
    },
    rejected: false,
  },
];

describe("2.5 checkNoTgLogicInCustom (beslutning 27.10.2026)", () => {
  it.each(tgCases)("$name: avvist = $rejected", ({ kind, change, rejected }) => {
    const issues: TemplateIssue[] = checkNoTgLogicInCustom(kind, parsedDocument(change));
    for (const issue of issues) seenRules.add(issue.rule);
    if (rejected) {
      expect(issues.length).toBeGreaterThan(0);
      for (const issue of issues) expect(issue.rule).toBe("tg_logic_in_custom");
    } else {
      expect(issues).toEqual([]);
    }
  });
});

// --- R4.4 checkNoBlockerInCustom (Ståle 12.11.2026, F9) ------------------------------------------

function validateRule(severity: "blocker" | "warning"): Change {
  return (doc) => {
    onlyRules()(doc);
    doc.rules = [
      {
        key: "rule.stopp",
        name: "Kontroll",
        purpose: "validate",
        target_element_key: "el.count",
        severity,
        message: "Meldingstekst",
      },
    ];
  };
}

describe("R4.4 checkNoBlockerInCustom (F9)", () => {
  it.each<{ kind: "system" | "custom"; severity: "blocker" | "warning"; rejected: boolean }>([
    { kind: "custom", severity: "blocker", rejected: true },
    { kind: "custom", severity: "warning", rejected: false },
    { kind: "system", severity: "blocker", rejected: false },
    { kind: "system", severity: "warning", rejected: false },
  ])("$kind med $severity: avvist = $rejected", ({ kind, severity, rejected }) => {
    const issues = checkNoBlockerInCustom(kind, parsedDocument(validateRule(severity)));
    if (!rejected) {
      expect(issues).toEqual([]);
      return;
    }
    expect(issues).toEqual([expect.objectContaining({ path: "rules.0.severity", rule: "schema" })]);
    expect(issues[0]!.message).toContain("rule.stopp");
    expect(issues[0]!.message).toMatch(/egen mal/);
  });

  it("R4.5 kalles på samme sted som checkNoTgLogicInCustom (begge lagringsveiene)", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./templates.ts", import.meta.url), "utf8");
    expect(source).toMatch(
      /checkNoTgLogicInCustom\(kind, parsed\.document\),\s*\.\.\.checkNoBlockerInCustom\(kind, parsed\.document\)/,
    );
  });
});

describe("R4.7 negate i dokumentformatet", () => {
  it("betingelse uten negate leses som false", () => {
    expect(parsedDocument().rule_conditions.every((c) => c.negate === false)).toBe(true);
  });

  it("negate som tekst avvises", () => {
    expectRejected(
      (doc) => {
        (doc.rule_conditions[0] as Record<string, unknown>).negate = "ja";
      },
      "schema",
      "rule_conditions.0.negate",
    );
  });

  it("to dokumenter som bare skiller seg i negate er ikke like", () => {
    const a = parsedDocument();
    const b = parsedDocument((doc) => {
      (doc.rule_conditions[0] as Record<string, unknown>).negate = true;
    });
    expect(isSameTemplateContent(a, b)).toBe(false);
  });
});

// --- Mal for bad: tekststatus, årsak og samme innhold (fase2a-mal-bad-testplan.md avsnitt 2) ---

/*
 * Støtter hovedmål: færre reklamasjoner og KI i bunnen. Hver fagtekst har status («utkast, ikke
 * godkjent av fagrådet» eller godkjent), og seed lager bare ny malversjon når innholdet faktisk er
 * endret.
 */

describe("mal for bad 2.1–2.4: text_status og default_cause_text i dokumentformatet (A200, A201, A209)", () => {
  it("2.1 text_status_default_draft: utfall og tiltak uten text_status får draft", () => {
    const doc = parsedDocument((d) => {
      for (const o of d.outcomes) delete (o as { text_status?: unknown }).text_status;
      for (const m of d.standard_measures) delete (m as { text_status?: unknown }).text_status;
    });
    expect(doc.outcomes.length).toBeGreaterThan(0);
    expect(doc.standard_measures.length).toBeGreaterThan(0);
    for (const o of doc.outcomes) expect(o.text_status, o.key).toBe("draft");
    for (const m of doc.standard_measures) expect(m.text_status, m.text).toBe("draft");
  });

  it("2.2 text_status_approved_accepted: approved godtas på utfall og tiltak (A209)", () => {
    const doc = parsedDocument((d) => {
      d.outcomes[0]!.text_status = "approved";
      d.standard_measures[0]!.text_status = "approved";
    });
    expect(doc.outcomes[0]!.text_status).toBe("approved");
    expect(doc.standard_measures[0]!.text_status).toBe("approved");
    // Det andre utfallet og tiltaket står som utkast
    expect(doc.outcomes[1]!.text_status).toBe("draft");
    expect(doc.standard_measures[1]!.text_status).toBe("draft");
  });

  it.each(
    (["outcomes", "standard_measures"] as const).flatMap((list) =>
      (["godkjent", "", null, "DRAFT", 1] as unknown[]).map((value) => ({
        list,
        value,
        label: JSON.stringify(value),
      })),
    ),
  )("2.3 unknown_text_status_rejected_by_schema: $list text_status = $label", ({ list, value }) => {
    expectRejected(
      (d) => {
        (d[list][0] as { text_status?: unknown }).text_status = value;
      },
      "schema",
      `${list}.0.text_status`,
    );
  });

  it("2.4 default_cause_text_optional: mangler, null og tom streng gir null", () => {
    const missing = parsedDocument();
    expect(missing.outcomes[0]!.default_cause_text).toBeNull();
    for (const value of [null, "", "   "]) {
      const doc = parsedDocument((d) => {
        d.outcomes[0]!.default_cause_text = value;
      });
      expect(doc.outcomes[0]!.default_cause_text, JSON.stringify(value)).toBeNull();
    }
    const filled = parsedDocument((d) => {
      d.outcomes[0]!.default_cause_text = "  Oppdiktet årsak.  ";
    });
    expect(filled.outcomes[0]!.default_cause_text).toBe("Oppdiktet årsak.");
  });

  it("2.4 default_cause_text som ikke er tekst avvises med schema", () => {
    expectRejected(
      (d) => {
        (d.outcomes[0] as { default_cause_text?: unknown }).default_cause_text = 42;
      },
      "schema",
      "outcomes.0.default_cause_text",
    );
  });
});

/** Hver liste i omvendt rekkefølge. */
function reversedLists(doc: TemplateDocument): TemplateDocument {
  const copy = structuredClone(doc);
  for (const list of Object.keys(copy) as (keyof TemplateDocument)[]) {
    (copy[list] as unknown[]).reverse();
  }
  return copy;
}

const sameContentCases: { name: string; change: Change; same: boolean }[] = [
  { name: "samme dokument", change: () => {}, same: true },
  {
    name: "endret avvikstekst",
    change: (d) => {
      d.outcomes[0]!.deviation_text = "Endret avvikstekst";
    },
    same: false,
  },
  {
    name: "default_cause_text lagt til",
    change: (d) => {
      d.outcomes[0]!.default_cause_text = "Oppdiktet årsak";
    },
    same: false,
  },
  {
    name: "text_status på utfall",
    change: (d) => {
      d.outcomes[0]!.text_status = "approved";
    },
    same: false,
  },
  {
    name: "text_status på tiltak",
    change: (d) => {
      d.standard_measures[0]!.text_status = "approved";
    },
    same: false,
  },
  {
    name: "ett felt mer",
    change: (d) => {
      d.elements.push({
        key: "el.extra",
        section_key: "sec.alpha",
        label: "Ekstra",
        field_type: "text",
      });
    },
    same: false,
  },
  {
    name: "endret tiltakstekst",
    change: (d) => {
      d.standard_measures[1]!.text = "Tiltak to endret";
    },
    same: false,
  },
];

describe("mal for bad 2.5: isSameTemplateContent", () => {
  it.each(sameContentCases)("is_same_template_content: $name gir $same", ({ change, same }) => {
    const a = parsedDocument();
    const b = parsedDocument(change);
    const aBefore = structuredClone(a);
    const bBefore = structuredClone(b);
    expect(isSameTemplateContent(a, b)).toBe(same);
    expect(isSameTemplateContent(b, a), "symmetrisk").toBe(same);
    // Funksjonen endrer ikke argumentene
    expect(a).toEqual(aBefore);
    expect(b).toEqual(bBefore);
  });

  it("is_same_template_content: samme innhold med listene i annen rekkefølge gir true", () => {
    const a = parsedDocument();
    const b = reversedLists(a);
    expect(b.sections[0]!.key).not.toBe(a.sections[0]!.key);
    const bBefore = structuredClone(b);
    expect(isSameTemplateContent(a, b)).toBe(true);
    expect(b).toEqual(bBefore);
  });

  it("is_same_template_content: endret innhold i annen rekkefølge gir fortsatt false", () => {
    const a = parsedDocument();
    const b = reversedLists(
      parsedDocument((d) => {
        d.outcomes[1]!.text_status = "approved";
      }),
    );
    expect(isSameTemplateContent(a, b)).toBe(false);
  });
});

// --- Reglene badet trenger: expected_state og regelfeltene (testplan 6.10) ----------------------

const RULE_CONDITION_KEY_COLUMNS = [
  "threshold_key",
  "age_year_element_key",
  "age_fallback_year_element_key",
  "age_source_element_key",
  "documentation_element_key",
  "material_element_key",
  "unit_element_key",
] as const;

/** Engelske ord fra Zod som ikke skal stå i en melding til brukeren. */
const ZOD_ENGLISH = /\b(invalid|expected|received|required|undefined|input)\b/i;

describe("regler bad 6.10: expected_state og regelfeltene i dokumentformatet", () => {
  it.each(["triggered", "not_triggered", "not_evaluated"] as const)(
    "godtar expected_state = %s",
    (state) => {
      const result = expectAccepted((doc) => {
        doc.rule_test_cases[0]!.expected_state = state;
      });
      if (result.success) expect(result.document.rule_test_cases[0]!.expected_state).toBe(state);
    },
  );

  it.each([
    { name: "ukjent verdi", value: "maybe" as unknown },
    { name: "boolsk (gammelt format)", value: true as unknown },
    { name: "tom tekst", value: "" as unknown },
    { name: "null", value: null as unknown },
  ])("avviser expected_state med $name, med norsk melding", ({ value }) => {
    const issues = expectRejected(
      (doc) => {
        (doc.rule_test_cases[0] as Record<string, unknown>).expected_state = value;
      },
      "schema",
      "rule_test_cases.0.expected_state",
    );
    for (const issue of issues) expect(issue.message, issue.message).not.toMatch(ZOD_ENGLISH);
  });

  it("expected_state som mangler avvises, også når det gamle expect_triggered er satt", () => {
    const issues = expectRejected(
      (doc) => {
        const testCase = doc.rule_test_cases[0] as Record<string, unknown>;
        delete testCase.expected_state;
        testCase.expect_triggered = true;
      },
      "schema",
      "rule_test_cases.0.expected_state",
    );
    for (const issue of issues) expect(issue.message).not.toMatch(ZOD_ENGLISH);
  });

  it("expect_triggered ved siden av expected_state lagres ikke stille (tas bort)", () => {
    const result = expectAccepted((doc) => {
      Object.assign(doc.rule_test_cases[0]!, { expect_triggered: false });
    });
    if (!result.success) return;
    const testCase = result.document.rule_test_cases[0]!;
    expect(testCase).not.toHaveProperty("expect_triggered");
    expect(testCase.expected_state).toBe("triggered");
  });

  it("inspection_year: tom godtas og blir null", () => {
    const result = expectAccepted(() => {});
    if (result.success) {
      for (const t of result.document.rule_test_cases) expect(t.inspection_year).toBeNull();
    }
    expectAccepted((doc) => {
      doc.rule_test_cases[0]!.inspection_year = 2026;
    });
  });

  it.each([
    { name: "1700", value: 1700 as unknown },
    { name: "3000", value: 3000 as unknown },
    { name: "desimal", value: 2026.5 as unknown },
    { name: "tekst", value: "2026" as unknown },
  ])("inspection_year: $name avvises med schema", ({ value }) => {
    expectRejected(
      (doc) => {
        (doc.rule_test_cases[0] as Record<string, unknown>).inspection_year = value;
      },
      "schema",
      "rule_test_cases.0.inspection_year",
    );
  });

  it.each(RULE_CONDITION_KEY_COLUMNS)(
    "%s: gyldig kode og null godtas, ugyldig kode avvises",
    (column) => {
      const accepted = expectAccepted((doc) => {
        (doc.rule_conditions[0] as Record<string, unknown>)[column] = "x.valid_code";
      });
      if (accepted.success) {
        expect((accepted.document.rule_conditions[0] as Record<string, unknown>)[column]).toBe(
          "x.valid_code",
        );
      }
      const empty = expectAccepted(() => {});
      if (empty.success) {
        expect((empty.document.rule_conditions[0] as Record<string, unknown>)[column]).toBeNull();
      }
      expectRejected(
        (doc) => {
          (doc.rule_conditions[0] as Record<string, unknown>)[column] = "Ugyldig Kode";
        },
        "key_format",
        `rule_conditions.0.${column}`,
      );
    },
  );
});

// --- Dekning: hver regelkode finnes i minst én avvist testsak -----------------------------------

/**
 * Regelkodene som trenger hele dokumentet eller databasen, og som prøves gjennom `saveDraftContent`
 * i `templates.test.ts` (4.5.6 key_unknown, 4.5.7 key_duplicate, 4.5.9 key_archived). Den filen har
 * sin egen dekningstest over alle kodene.
 */
const coveredInTemplatesTest: TemplateIssueRule[] = [
  "key_unknown",
  "key_duplicate",
  "key_archived",
];

describe("dekning av regelkodene", () => {
  it("alle verdiene i TemplateIssueRule er prøvd i en avvist testsak", () => {
    // Kjøres sist i filen (Vitest kjører testene i en fil i rekkefølge).
    const covered = new Set<string>([...seenRules, ...coveredInTemplatesTest]);
    expect([...TEMPLATE_ISSUE_RULES].sort()).toEqual([...covered].sort());
    expect([...seenRules].sort()).toEqual(
      ["key_format", "outcome_tgiu", "schema", "tg_logic_in_custom"].sort(),
    );
  });
});
