import { TG_RULE_PURPOSES } from "@/db/schema";
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

/** Feltkodene på en betingelse utenom `element_key`. Alle skal peke på et felt i dokumentet. */
const CONDITION_ELEMENT_FIELDS = [
  "age_year_element_key",
  "age_fallback_year_element_key",
  "age_source_element_key",
  "documentation_element_key",
  "material_element_key",
  "unit_element_key",
] as const;

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
    // Feltene alderskontrollen og målingen leser (småfunn fra #167).
    for (const field of CONDITION_ELEMENT_FIELDS) {
      const key = c[field];
      if (key !== null && !elements.has(key)) {
        unknown(issues, `rule_conditions.${i}.${field}`, NO_ELEMENT);
      }
    }
  });
  d.rule_test_cases.forEach((t, i) => {
    if (!rules.has(t.rule_key)) unknown(issues, `rule_test_cases.${i}.rule_key`, NO_RULE);
    checkOutcomeRef(t.expected_outcome, `rule_test_cases.${i}.expected_outcome`);
  });

  return issues;
}

/*
 * Kontrollene som beskytter reglene i systemmalen (docs/funksjoner/fase2a-regler-bad.md, Omfang 7,
 * testlagsfunn T-0014 punkt 2, 3 og 4). Rene funksjoner: samme dokument gir samme feil. Meldingene
 * er norske og nevner regelkoden, slik at den som lager malen finner regelen. Kodene som pekes på,
 * sjekkes av `checkDocumentKeys`; finnes et kontrollpunkt ikke, hoppes kontrollen over her (feilen
 * meldes der). Regelkoden for feilen er `schema` (feltene i regelen passer ikke sammen).
 */

/** Regelformålene som gir TG-forslag (`TG_RULE_PURPOSES` i skjemaet). */
function givesTgSuggestion(purpose: string): boolean {
  return (TG_RULE_PURPOSES as readonly string[]).includes(purpose);
}

/** Formålene som foreslår TGIU eller TG0 på kontrollpunktet, uten utfall. */
function suggestsOnCheckpoint(purpose: string): boolean {
  return purpose === "suggest_tgiu" || purpose === "suggest_tg0";
}

function ruleIssue(issues: TemplateIssue[], path: string, message: string) {
  issues.push({ path, rule: "schema", message });
}

/**
 * En regel som foreslår et avvik, må si hvilket avvik (T-0014 punkt 3). En regel som foreslår TGIU
 * eller TG0, må si hvilket kontrollpunkt, og foreslår ikke et avvik (TG0 er ikke et avvik, A234).
 */
export function checkRuleSuggestsOutcome(document: TemplateDocument): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  document.rules.forEach((r, i) => {
    if (r.purpose === "suggest_outcome" && r.suggested_outcome === null) {
      ruleIssue(
        issues,
        `rules.${i}.suggested_outcome`,
        `Regelen «${r.key}» skal foreslå en tilstandsgrad, men det er ikke valgt hvilket avvik den foreslår.`,
      );
    }
    if (!suggestsOnCheckpoint(r.purpose)) return;
    if (r.target_checkpoint_key === null) {
      ruleIssue(
        issues,
        `rules.${i}.target_checkpoint_key`,
        `Regelen «${r.key}» foreslår en tilstandsgrad, men det er ikke valgt hvilket kontrollpunkt den gjelder.`,
      );
    }
    if (r.suggested_outcome !== null) {
      ruleIssue(
        issues,
        `rules.${i}.suggested_outcome`,
        `Regelen «${r.key}» foreslår TGIU eller TG0 og skal ikke ha et avvik.`,
      );
    }
  });
  return issues;
}

/**
 * Regelen og avviket den foreslår, må høre til samme kontrollpunkt (T-0014 punkt 4). En regel som
 * foreslår et avvik, må ha kontrollpunktet satt; det hentes ikke stille fra avviket.
 */
export function checkRuleOutcomeSameCheckpoint(document: TemplateDocument): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  document.rules.forEach((r, i) => {
    if (r.purpose !== "suggest_outcome") return;
    if (r.target_checkpoint_key === null) {
      ruleIssue(
        issues,
        `rules.${i}.target_checkpoint_key`,
        `Regelen «${r.key}» foreslår en tilstandsgrad, men det er ikke valgt hvilket kontrollpunkt den gjelder.`,
      );
      return;
    }
    if (
      r.suggested_outcome !== null &&
      r.suggested_outcome.checkpoint_key !== r.target_checkpoint_key
    ) {
      ruleIssue(
        issues,
        `rules.${i}.suggested_outcome.checkpoint_key`,
        `Regelen «${r.key}» foreslår et avvik fra et annet kontrollpunkt enn det regelen gjelder.`,
      );
    }
  });
  return issues;
}

/**
 * En regel som foreslår TG, TGIU eller TG0, kan ikke gjelde et punkt som ikke gir TG (T-0014
 * punkt 2).
 */
export function checkRuleCheckpointGivesTg(document: TemplateDocument): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  const givesTg = new Map(document.checkpoints.map((c) => [c.key, c.gives_tg]));
  document.rules.forEach((r, i) => {
    if (!givesTgSuggestion(r.purpose)) return;
    const targets: { key: string; path: string }[] = [];
    if (r.target_checkpoint_key !== null) {
      targets.push({ key: r.target_checkpoint_key, path: `rules.${i}.target_checkpoint_key` });
    }
    if (r.suggested_outcome !== null) {
      targets.push({
        key: r.suggested_outcome.checkpoint_key,
        path: `rules.${i}.suggested_outcome.checkpoint_key`,
      });
    }
    // Ett funn per regel, også når kontrollpunktet og avviket peker på samme punkt.
    const hit = targets.find((t) => givesTg.get(t.key) === false);
    if (hit) {
      ruleIssue(
        issues,
        hit.path,
        `Regelen «${r.key}» foreslår tilstandsgrad på et kontrollpunkt som ikke gir tilstandsgrad.`,
      );
    }
  });
  return issues;
}

/**
 * Betingelsen må ha riktige felt for typen. Med terskelkode står grensen i terskelen, så
 * sammenligning og verdi er tomme. Alder mot levetid trenger feltet med årstallet og feltet med
 * materialet.
 */
export function checkRuleConditionShape(document: TemplateDocument): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  document.rule_conditions.forEach((c, i) => {
    const path = `rule_conditions.${i}`;
    if (c.threshold_key !== null && (c.operator !== null || c.value !== null)) {
      ruleIssue(
        issues,
        `${path}.threshold_key`,
        `En betingelse i regelen «${c.rule_key}» har både terskel og egen grense. Bruk bare terskelen.`,
      );
    }
    if (c.type === "age_vs_lifespan") {
      if (c.age_year_element_key === null) {
        ruleIssue(
          issues,
          `${path}.age_year_element_key`,
          `Alderskontrollen i regelen «${c.rule_key}» mangler feltet med årstallet.`,
        );
      }
      if (c.material_element_key === null) {
        ruleIssue(
          issues,
          `${path}.material_element_key`,
          `Alderskontrollen i regelen «${c.rule_key}» mangler feltet med materialet.`,
        );
      }
    }
  });
  return issues;
}

/** De fire kontrollene av reglene over. Tom liste = reglene henger sammen. */
export function checkDocumentRules(document: TemplateDocument): TemplateIssue[] {
  return [
    ...checkRuleSuggestsOutcome(document),
    ...checkRuleOutcomeSameCheckpoint(document),
    ...checkRuleCheckpointGivesTg(document),
    ...checkRuleConditionShape(document),
  ];
}
