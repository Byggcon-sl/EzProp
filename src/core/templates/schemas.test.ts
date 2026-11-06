import { describe, expect, it } from "vitest";
import { OUTCOME_KINDS } from "@/db/schema";
import { buildTemplateDocument } from "../../../tests/template-document";
import {
  TEMPLATE_ISSUE_RULES,
  checkNoTgLogicInCustom,
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
