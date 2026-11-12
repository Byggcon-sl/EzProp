import type { TemplateDocumentInput } from "@/core/templates";

/*
 * Et gyldig, nøytralt maldokument til testene av malmotoren
 * (docs/funksjoner/fase2a-malmotor-testplan.md, «Avtale om signaturer»).
 *
 * Bruker alle tolv tabellene: to seksjoner (én underseksjon), tre felt (`choice` med to valg,
 * `number`, `table`), ett kontrollpunkt med to avviksspørsmål, to utfall på det første spørsmålet,
 * to standardtiltak på det ene utfallet, tre regler (`show`, `suggest_outcome`, `validate`) med to
 * betingelser i to grupper og to testtilfeller.
 *
 * Alt er oppdiktet og uten fagtekst. Kodene er `sec.alpha`, `cp.one`, `el.size` osv. Hvert kall
 * gir et nytt objekt, så testene kan endre det fritt.
 */

/** Antall rader dokumentet gir i hver tabell (uten familie og versjon). */
export const TEMPLATE_DOCUMENT_ROWS = {
  template_sections: 2,
  template_elements: 3,
  template_element_options: 2,
  checkpoints: 1,
  deviation_questions: 2,
  outcomes: 2,
  standard_measures: 2,
  rules: 3,
  rule_conditions: 2,
  rule_test_cases: 2,
} as const;

/** Summen av radene i dokumentet (21). */
export const TEMPLATE_DOCUMENT_ROW_COUNT = Object.values(TEMPLATE_DOCUMENT_ROWS).reduce(
  (sum, n) => sum + n,
  0,
);

type Lists = Required<TemplateDocumentInput>;

/** Et nytt, gyldig dokument. `overrides` erstatter hele lister. */
export function buildTemplateDocument(
  overrides: Partial<TemplateDocumentInput> = {},
): Lists & TemplateDocumentInput {
  const document: Lists = {
    sections: [
      { key: "sec.alpha", title: "Seksjon alfa", sort_order: 0 },
      { key: "sec.alpha.sub", parent_key: "sec.alpha", title: "Underseksjon", sort_order: 1 },
    ],
    elements: [
      {
        key: "el.size",
        section_key: "sec.alpha.sub",
        checkpoint_key: "cp.one",
        label: "Størrelse",
        field_type: "choice",
        sort_order: 0,
      },
      {
        key: "el.count",
        section_key: "sec.alpha",
        label: "Antall",
        field_type: "number",
        min_value: 0,
        max_value: 100,
        decimals: 0,
        sort_order: 1,
      },
      {
        key: "el.grid",
        section_key: "sec.alpha",
        label: "Rutenett",
        field_type: "table",
        table_columns: [{ key: "col_a", label: "Kolonne A" }],
        sort_order: 2,
      },
    ],
    element_options: [
      { element_key: "el.size", key: "opt.small", label: "Liten", sort_order: 0 },
      { element_key: "el.size", key: "opt.large", label: "Stor", sort_order: 1 },
    ],
    checkpoints: [
      {
        key: "cp.one",
        section_key: "sec.alpha.sub",
        name: "Punkt en",
        group: "interior",
        sort_order: 0,
      },
    ],
    deviation_questions: [
      { checkpoint_key: "cp.one", key: "dq.first", text: "Spørsmål en", sort_order: 0 },
      { checkpoint_key: "cp.one", key: "dq.second", text: "Spørsmål to", sort_order: 1 },
    ],
    outcomes: [
      {
        checkpoint_key: "cp.one",
        question_key: "dq.first",
        key: "out.a",
        kind: "tg2",
        deviation_text: "Utfallstekst a",
        sort_order: 0,
      },
      {
        checkpoint_key: "cp.one",
        question_key: "dq.first",
        key: "out.b",
        kind: "tg3",
        deviation_text: "Utfallstekst b",
        sort_order: 1,
      },
    ],
    standard_measures: [
      {
        checkpoint_key: "cp.one",
        question_key: "dq.first",
        outcome_key: "out.a",
        text: "Tiltak en",
        sort_order: 0,
      },
      {
        checkpoint_key: "cp.one",
        question_key: "dq.first",
        outcome_key: "out.a",
        text: "Tiltak to",
        sort_order: 1,
      },
    ],
    rules: [
      {
        key: "rule.show_size",
        name: "Vis antall",
        purpose: "show",
        target_element_key: "el.count",
        sort_order: 0,
      },
      {
        key: "rule.suggest",
        name: "Foreslå utfall",
        purpose: "suggest_outcome",
        target_checkpoint_key: "cp.one",
        suggested_outcome: {
          checkpoint_key: "cp.one",
          question_key: "dq.first",
          outcome_key: "out.a",
        },
        sort_order: 1,
      },
      {
        key: "rule.check",
        name: "Kontroll",
        purpose: "validate",
        target_element_key: "el.count",
        severity: "warning",
        message: "Meldingstekst",
        sort_order: 2,
      },
    ],
    rule_conditions: [
      {
        rule_key: "rule.show_size",
        group_no: 1,
        type: "option_selected",
        element_key: "el.size",
        operator: "eq",
        value: "opt.small",
        sort_order: 0,
      },
      {
        rule_key: "rule.show_size",
        group_no: 2,
        type: "number_vs_limit",
        element_key: "el.count",
        operator: "gt",
        value: 5,
        sort_order: 1,
      },
    ],
    rule_test_cases: [
      {
        rule_key: "rule.show_size",
        name: "Liten gir vis",
        input: { "el.size": "opt.small" },
        expected_state: "triggered",
        sort_order: 0,
      },
      {
        rule_key: "rule.show_size",
        name: "Stor gir ikke vis",
        input: { "el.size": "opt.large" },
        expected_state: "not_triggered",
        sort_order: 1,
      },
    ],
  };
  return { ...document, ...structuredClone(overrides) } as Lists & TemplateDocumentInput;
}

/** Antall rader et dokument gir i innholdstabellene (alt under versjonen). */
export function templateDocumentRowCount(document: Lists): number {
  return (
    document.sections.length +
    document.elements.length +
    document.element_options.length +
    document.checkpoints.length +
    document.deviation_questions.length +
    document.outcomes.length +
    document.standard_measures.length +
    document.rules.length +
    document.rule_conditions.length +
    document.rule_test_cases.length
  );
}
