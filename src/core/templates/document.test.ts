import { describe, expect, it } from "vitest";
import { buildTemplateDocument } from "../../../tests/template-document";
import {
  checkDocumentRules,
  checkRuleCheckpointGivesTg,
  checkRuleConditionShape,
  checkRuleOutcomeSameCheckpoint,
  checkRuleSuggestsOutcome,
  parseTemplateDocument,
  type TemplateDocument,
  type TemplateIssue,
} from "./index";

/*
 * Kontrollene som beskytter reglene i malmotoren (docs/funksjoner/fase2a-regler-bad-testplan.md
 * avsnitt 5, testlagsfunn T-0014 punkt 2, 3 og 4). Rene funksjoner, ingen database. Lagringen med
 * `saveDraftContent` prøves i `templates.test.ts` (4.5.14).
 *
 * Hver kontroll gir ingen feil på et godt dokument og på badmalen, og gir norsk melding som nevner
 * regelkoden på et dokument laget for å feile.
 *
 * Støtter hovedmål: færre reklamasjoner (en regel som peker feil eller har feil form, kan ikke
 * lagres) og de ansatte (tydelig norsk melding om hva som er galt).
 *
 * Regelkodene i testene (`chk.*`) har ingen engelske ord, så vi kan sjekke at meldingene er norske.
 * Testdata er oppdiktet og uten fagtekst.
 */

type Doc = ReturnType<typeof buildTemplateDocument>;
type Check = (doc: TemplateDocument) => TemplateIssue[];

const SUGGEST = "chk.forslag";
const TGIU = "chk.ikke_undersokt";
const AGE = "chk.alder";
const LIMIT = "chk.grense";

/**
 * Et godt dokument med regler: buildTemplateDocument med et ekstra kontrollpunkt (`cp.two`), en
 * TGIU-regel, en aldersregel og en terskelregel. Alle regler med TG-forslag står på `cp.one`.
 */
function goodDocument(): Doc {
  const doc = buildTemplateDocument();
  // Bytt regelkoden «rule.suggest» til en norsk kode
  for (const r of doc.rules) if (r.key === "rule.suggest") r.key = SUGGEST;
  doc.checkpoints.push({
    key: "cp.two",
    section_key: "sec.alpha",
    name: "Punkt to",
    group: "interior",
    sort_order: 1,
  });
  doc.deviation_questions.push({
    checkpoint_key: "cp.two",
    key: "dq.other",
    text: "Spørsmål tre",
    sort_order: 2,
  });
  doc.outcomes.push({
    checkpoint_key: "cp.two",
    question_key: "dq.other",
    key: "out.c",
    kind: "tg2",
    deviation_text: "Utfallstekst c",
    sort_order: 0,
  });
  doc.rules.push(
    {
      key: TGIU,
      name: "Ikke undersøkt",
      purpose: "suggest_tgiu",
      target_checkpoint_key: "cp.one",
      sort_order: 3,
    },
    {
      key: AGE,
      name: "Alder",
      purpose: "suggest_outcome",
      target_checkpoint_key: "cp.one",
      suggested_outcome: {
        checkpoint_key: "cp.one",
        question_key: "dq.first",
        outcome_key: "out.a",
      },
      sort_order: 4,
    },
    {
      key: LIMIT,
      name: "Grense",
      purpose: "suggest_outcome",
      target_checkpoint_key: "cp.one",
      suggested_outcome: {
        checkpoint_key: "cp.one",
        question_key: "dq.first",
        outcome_key: "out.b",
      },
      sort_order: 5,
    },
  );
  doc.rule_conditions.push(
    {
      rule_key: TGIU,
      type: "option_selected",
      element_key: "el.size",
      operator: "in",
      value: ["opt.small"],
      sort_order: 0,
    },
    {
      rule_key: AGE,
      type: "age_vs_lifespan",
      age_year_element_key: "el.count",
      age_fallback_year_element_key: "el.count",
      material_element_key: "el.size",
      documentation_element_key: "el.size",
      value: ["opt.large"],
      sort_order: 0,
    },
    {
      rule_key: LIMIT,
      type: "number_vs_limit",
      element_key: "el.count",
      threshold_key: "x_limit",
      unit_element_key: "el.size",
      sort_order: 0,
    },
  );
  return doc;
}

function parsed(doc: Doc): TemplateDocument {
  const result = parseTemplateDocument(doc);
  if (!result.success) throw new Error(`ugyldig testdokument: ${JSON.stringify(result.issues)}`);
  return result.document;
}

const ruleOf = (doc: Doc, key: string) => doc.rules.find((r) => r.key === key)!;
const conditionOf = (doc: Doc, ruleKey: string) =>
  doc.rule_conditions.find((c) => c.rule_key === ruleKey)!;

const checks: [string, Check][] = [
  ["checkRuleSuggestsOutcome", checkRuleSuggestsOutcome],
  ["checkRuleOutcomeSameCheckpoint", checkRuleOutcomeSameCheckpoint],
  ["checkRuleCheckpointGivesTg", checkRuleCheckpointGivesTg],
  ["checkRuleConditionShape", checkRuleConditionShape],
];

/** Dokumentene som skal feile: testplanen 5.1–5.5. `ruleKey` skal stå i meldingen. */
const BAD_RULE_DOCUMENTS: {
  id: string;
  name: string;
  check: Check;
  ruleKey: string;
  change: (doc: Doc) => void;
}[] = [
  {
    id: "5.1",
    name: "suggest_outcome uten suggested_outcome",
    check: checkRuleSuggestsOutcome,
    ruleKey: AGE,
    change: (doc) => {
      ruleOf(doc, AGE).suggested_outcome = null;
    },
  },
  {
    id: "5.2",
    name: "regelen på ett punkt, utfallet på et annet",
    check: checkRuleOutcomeSameCheckpoint,
    ruleKey: AGE,
    change: (doc) => {
      ruleOf(doc, AGE).suggested_outcome = {
        checkpoint_key: "cp.two",
        question_key: "dq.other",
        outcome_key: "out.c",
      };
    },
  },
  {
    id: "5.3",
    name: "suggest_outcome mot punkt med gives_tg = false",
    check: checkRuleCheckpointGivesTg,
    ruleKey: AGE,
    change: (doc) => {
      doc.checkpoints.find((c) => c.key === "cp.one")!.gives_tg = false;
      // Bare aldersregelen igjen, så meldingen bare gjelder den
      doc.rules = doc.rules.filter((r) => r.key === AGE || r.purpose === "show");
      doc.rule_conditions = doc.rule_conditions.filter((c) =>
        doc.rules.some((r) => r.key === c.rule_key),
      );
      doc.rule_test_cases = doc.rule_test_cases.filter((t) =>
        doc.rules.some((r) => r.key === t.rule_key),
      );
    },
  },
  {
    id: "5.3",
    name: "suggest_tgiu mot punkt med gives_tg = false",
    check: checkRuleCheckpointGivesTg,
    ruleKey: TGIU,
    change: (doc) => {
      ruleOf(doc, TGIU).target_checkpoint_key = "cp.two";
      doc.checkpoints.find((c) => c.key === "cp.two")!.gives_tg = false;
      doc.outcomes = doc.outcomes.filter((o) => o.checkpoint_key !== "cp.two");
      doc.deviation_questions = doc.deviation_questions.filter(
        (q) => q.checkpoint_key !== "cp.two",
      );
    },
  },
  {
    id: "5.4",
    name: "threshold_key sammen med operator",
    check: checkRuleConditionShape,
    ruleKey: LIMIT,
    change: (doc) => {
      conditionOf(doc, LIMIT).operator = "gte";
    },
  },
  {
    id: "5.4",
    name: "threshold_key sammen med value",
    check: checkRuleConditionShape,
    ruleKey: LIMIT,
    change: (doc) => {
      conditionOf(doc, LIMIT).value = 15;
    },
  },
  {
    id: "5.5",
    name: "age_vs_lifespan uten age_year_element_key",
    check: checkRuleConditionShape,
    ruleKey: AGE,
    change: (doc) => {
      conditionOf(doc, AGE).age_year_element_key = null;
    },
  },
  {
    id: "5.5",
    name: "age_vs_lifespan uten material_element_key",
    check: checkRuleConditionShape,
    ruleKey: AGE,
    change: (doc) => {
      conditionOf(doc, AGE).material_element_key = null;
    },
  },
];

function bad(change: (doc: Doc) => void): TemplateDocument {
  const doc = goodDocument();
  change(doc);
  return parsed(doc);
}

/** Engelske ord som ikke skal stå i en norsk melding (regelkoden er tatt ut først). */
const ENGLISH =
  /\b(rule|rules|outcome|outcomes|checkpoint|condition|threshold|suggest\w*|missing|must|gives_tg|null)\b/i;

describe("5 kontrollene i malmotoren", () => {
  it.each(checks)("%s gir ingen feil på det gode dokumentet", (_, check) => {
    expect(check(parsed(goodDocument()))).toEqual([]);
  });

  it.each(checks)("%s gir ingen feil på buildTemplateDocument", (_, check) => {
    expect(check(parsed(buildTemplateDocument()))).toEqual([]);
  });

  it.each(checks)("%s gir ingen feil på badmalen", async (_, check) => {
    const { wetRoomTemplate } = await import("@/db/seed/templates/wet-room");
    expect(check(parsed(wetRoomTemplate as Doc))).toEqual([]);
  });

  it("checkDocumentRules gir ingen feil på det gode dokumentet", () => {
    expect(checkDocumentRules(parsed(goodDocument()))).toEqual([]);
  });

  it.each(BAD_RULE_DOCUMENTS)("$id $name avvises", ({ check, change }) => {
    const document = bad(change);
    const issues = check(document);
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(issue.path).toMatch(/^(rules|rule_conditions)\.\d+/);
      expect(typeof issue.rule).toBe("string");
    }
    // Samlet kontroll fanger det samme
    expect(checkDocumentRules(document).length).toBeGreaterThanOrEqual(issues.length);
  });

  it.each(BAD_RULE_DOCUMENTS)(
    "5.6 messages_norwegian: $id $name gir norsk melding med regelkoden",
    ({ check, change, ruleKey }) => {
      const issues = check(bad(change));
      expect(issues.length).toBeGreaterThan(0);
      for (const issue of issues) {
        expect(issue.message, issue.path).toContain(ruleKey);
        const withoutCode = issue.message.split(ruleKey).join("");
        expect(withoutCode, issue.message).not.toMatch(ENGLISH);
        expect(withoutCode, issue.message).toMatch(/[æøå]|regel|kontrollpunkt|avvik|terskel/i);
      }
    },
  );

  it("andre regler og andre kontroller blir ikke dratt med (ingen falske feil)", () => {
    const document = bad((doc) => {
      ruleOf(doc, AGE).suggested_outcome = null;
    });
    const issues = checkRuleSuggestsOutcome(document);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain(AGE);
    expect(checkRuleConditionShape(document)).toEqual([]);
  });

  it("show og validate er ikke TG-forslag og stoppes ikke av punkt uten TG", () => {
    const document = bad((doc) => {
      doc.checkpoints.find((c) => c.key === "cp.one")!.gives_tg = false;
      doc.rules = doc.rules.filter((r) => r.purpose === "show" || r.purpose === "validate");
      doc.rule_conditions = doc.rule_conditions.filter((c) =>
        doc.rules.some((r) => r.key === c.rule_key),
      );
      doc.rule_test_cases = doc.rule_test_cases.filter((t) =>
        doc.rules.some((r) => r.key === t.rule_key),
      );
    });
    expect(checkRuleCheckpointGivesTg(document)).toEqual([]);
  });
});
