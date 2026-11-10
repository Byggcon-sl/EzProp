import type { TemplateIssue } from "./errors";
import type { TemplateDocument } from "./schemas";

/*
 * Rene sjekker av at kodene i et maldokument henger sammen (docs/funksjoner/fase2a-malmotor.md,
 * Omfang 3): doble koder i samme område (A141) og referanser til koder som ikke finnes.
 * Arkiverte koder (A136) trenger databasen og sjekkes i `templates.ts`.
 */

/** Skilletegn mellom delene av en sammensatt kode. Kan ikke stå i en kode (`KEY_PATTERN`). */
const SEP = "/";

export function questionScope(checkpointKey: string, questionKey: string): string {
  return `${checkpointKey}${SEP}${questionKey}`;
}

export function outcomeScope(checkpointKey: string, questionKey: string, outcomeKey: string) {
  return `${checkpointKey}${SEP}${questionKey}${SEP}${outcomeKey}`;
}

export function optionScope(elementKey: string, optionKey: string): string {
  return `${elementKey}${SEP}${optionKey}`;
}

function duplicateIssues(
  issues: TemplateIssue[],
  list: string,
  ids: readonly string[],
  message: string,
) {
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (seen.has(id)) issues.push({ path: `${list}.${index}.key`, rule: "key_duplicate", message });
    seen.add(id);
  });
}

function unknown(issues: TemplateIssue[], path: string, message: string) {
  issues.push({ path, rule: "key_unknown", message });
}

/** Doble koder og ukjente referanser. Tom liste = kodene henger sammen. */
export function checkDocumentKeys(document: TemplateDocument): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  const d = document;

  const sectionKeys = d.sections.map((s) => s.key);
  const elementKeys = d.elements.map((e) => e.key);
  const optionIds = d.element_options.map((o) => optionScope(o.element_key, o.key));
  const checkpointKeys = d.checkpoints.map((c) => c.key);
  const questionIds = d.deviation_questions.map((q) => questionScope(q.checkpoint_key, q.key));
  const outcomeIds = d.outcomes.map((o) => outcomeScope(o.checkpoint_key, o.question_key, o.key));
  const ruleKeys = d.rules.map((r) => r.key);

  duplicateIssues(issues, "sections", sectionKeys, "Koden er brukt på to seksjoner.");
  duplicateIssues(issues, "elements", elementKeys, "Koden er brukt på to felt.");
  duplicateIssues(issues, "element_options", optionIds, "Koden er brukt på to valg i samme felt.");
  duplicateIssues(issues, "checkpoints", checkpointKeys, "Koden er brukt på to kontrollpunkter.");
  duplicateIssues(
    issues,
    "deviation_questions",
    questionIds,
    "Koden er brukt på to spørsmål i samme kontrollpunkt.",
  );
  duplicateIssues(issues, "outcomes", outcomeIds, "Koden er brukt på to utfall i samme spørsmål.");
  duplicateIssues(issues, "rules", ruleKeys, "Koden er brukt på to regler.");

  const sections = new Set(sectionKeys);
  const elements = new Set(elementKeys);
  const checkpoints = new Set(checkpointKeys);
  const questions = new Set(questionIds);
  const outcomes = new Set(outcomeIds);
  const rules = new Set(ruleKeys);

  const NO_SECTION = "Fant ikke seksjonen med denne koden.";
  const NO_ELEMENT = "Fant ikke feltet med denne koden.";
  const NO_CHECKPOINT = "Fant ikke kontrollpunktet med denne koden.";
  const NO_QUESTION = "Fant ikke avviksspørsmålet med denne koden.";
  const NO_OUTCOME = "Fant ikke utfallet med denne koden.";
  const NO_RULE = "Fant ikke regelen med denne koden.";

  d.sections.forEach((s, i) => {
    if (s.parent_key === null) return;
    if (s.parent_key === s.key || !sections.has(s.parent_key)) {
      unknown(issues, `sections.${i}.parent_key`, NO_SECTION);
    }
  });
  // Underseksjoner kan ikke gå i ring (A → B → A).
  const parentOf = new Map(d.sections.map((s) => [s.key, s.parent_key]));
  d.sections.forEach((s, i) => {
    if (s.parent_key === null || s.parent_key === s.key) return;
    let current: string | null = s.parent_key;
    for (let steps = 0; current !== null && steps <= d.sections.length; steps++) {
      if (current === s.key) {
        issues.push({
          path: `sections.${i}.parent_key`,
          rule: "schema",
          message: "Seksjonene kan ikke ligge under hverandre i ring.",
        });
        break;
      }
      current = parentOf.get(current) ?? null;
    }
  });
  d.elements.forEach((e, i) => {
    if (!sections.has(e.section_key)) unknown(issues, `elements.${i}.section_key`, NO_SECTION);
    if (e.checkpoint_key !== null && !checkpoints.has(e.checkpoint_key)) {
      unknown(issues, `elements.${i}.checkpoint_key`, NO_CHECKPOINT);
    }
  });
  d.element_options.forEach((o, i) => {
    if (!elements.has(o.element_key))
      unknown(issues, `element_options.${i}.element_key`, NO_ELEMENT);
  });
  d.checkpoints.forEach((c, i) => {
    if (!sections.has(c.section_key)) unknown(issues, `checkpoints.${i}.section_key`, NO_SECTION);
    c.related_checkpoint_keys.forEach((key, j) => {
      if (!checkpoints.has(key)) {
        unknown(issues, `checkpoints.${i}.related_checkpoint_keys.${j}`, NO_CHECKPOINT);
      }
    });
  });
  d.deviation_questions.forEach((q, i) => {
    if (!checkpoints.has(q.checkpoint_key)) {
      unknown(issues, `deviation_questions.${i}.checkpoint_key`, NO_CHECKPOINT);
    }
  });
  d.outcomes.forEach((o, i) => {
    if (!checkpoints.has(o.checkpoint_key)) {
      unknown(issues, `outcomes.${i}.checkpoint_key`, NO_CHECKPOINT);
    } else if (!questions.has(questionScope(o.checkpoint_key, o.question_key))) {
      unknown(issues, `outcomes.${i}.question_key`, NO_QUESTION);
    }
  });
  d.standard_measures.forEach((m, i) => {
    if (!checkpoints.has(m.checkpoint_key)) {
      unknown(issues, `standard_measures.${i}.checkpoint_key`, NO_CHECKPOINT);
    } else if (!questions.has(questionScope(m.checkpoint_key, m.question_key))) {
      unknown(issues, `standard_measures.${i}.question_key`, NO_QUESTION);
    } else if (!outcomes.has(outcomeScope(m.checkpoint_key, m.question_key, m.outcome_key))) {
      unknown(issues, `standard_measures.${i}.outcome_key`, NO_OUTCOME);
    }
  });

  function checkOutcomeRef(
    ref: { checkpoint_key: string; question_key: string; outcome_key: string } | null,
    path: string,
  ) {
    if (ref === null) return;
    if (!checkpoints.has(ref.checkpoint_key)) {
      unknown(issues, `${path}.checkpoint_key`, NO_CHECKPOINT);
    } else if (!questions.has(questionScope(ref.checkpoint_key, ref.question_key))) {
      unknown(issues, `${path}.question_key`, NO_QUESTION);
    } else if (!outcomes.has(outcomeScope(ref.checkpoint_key, ref.question_key, ref.outcome_key))) {
      unknown(issues, `${path}.outcome_key`, NO_OUTCOME);
    }
  }

  d.rules.forEach((r, i) => {
    const path = `rules.${i}`;
    if (r.target_element_key !== null && !elements.has(r.target_element_key)) {
      unknown(issues, `${path}.target_element_key`, NO_ELEMENT);
    }
    if (r.target_section_key !== null && !sections.has(r.target_section_key)) {
      unknown(issues, `${path}.target_section_key`, NO_SECTION);
    }
    if (r.target_checkpoint_key !== null && !checkpoints.has(r.target_checkpoint_key)) {
      unknown(issues, `${path}.target_checkpoint_key`, NO_CHECKPOINT);
    }
    if (r.target_question !== null) {
      const q = r.target_question;
      if (!checkpoints.has(q.checkpoint_key)) {
        unknown(issues, `${path}.target_question.checkpoint_key`, NO_CHECKPOINT);
      } else if (!questions.has(questionScope(q.checkpoint_key, q.question_key))) {
        unknown(issues, `${path}.target_question.question_key`, NO_QUESTION);
      }
    }
    checkOutcomeRef(r.suggested_outcome, `${path}.suggested_outcome`);
  });
  d.rule_conditions.forEach((c, i) => {
    if (!rules.has(c.rule_key)) unknown(issues, `rule_conditions.${i}.rule_key`, NO_RULE);
    if (c.element_key !== null && !elements.has(c.element_key)) {
      unknown(issues, `rule_conditions.${i}.element_key`, NO_ELEMENT);
    }
    if (c.checkpoint_key !== null && !checkpoints.has(c.checkpoint_key)) {
      unknown(issues, `rule_conditions.${i}.checkpoint_key`, NO_CHECKPOINT);
    }
  });
  d.rule_test_cases.forEach((t, i) => {
    if (!rules.has(t.rule_key)) unknown(issues, `rule_test_cases.${i}.rule_key`, NO_RULE);
    checkOutcomeRef(t.expected_outcome, `rule_test_cases.${i}.expected_outcome`);
  });

  return issues;
}
