import type { TemplateDocument } from "@/core/templates";

/**
 * Et gyldig, nøytralt maldokument som bruker alle tolv tabellene (testplanen for malmotoren,
 * «Avtale om signaturer»). Oppdiktet, uten fagtekst:
 * - to seksjoner (`sec.alpha` og underseksjonen `sec.alpha.sub`),
 * - tre felt (`el.size` choice med valgene `opt.small` og `opt.large`, `el.count` number,
 *   `el.grid` table),
 * - ett kontrollpunkt `cp.one` med spørsmålene `dq.first` og `dq.second`,
 * - utfallene `out.a` og `out.b` på `dq.first`, to standardtiltak på `out.a`,
 * - tre regler (`rule.show_size` show, `rule.suggest_a` suggest_outcome, `rule.check_count`
 *   validate) med to betingelser i to grupper og to testtilfeller.
 *
 * `overrides` bytter ut hele lister. Dokumentet har alle felt utfylt, slik det ser ut etter Zod,
 * og kan endres fritt av testen (ny kopi hver gang).
 */
export function buildTemplateDocument(overrides: Partial<TemplateDocument> = {}): TemplateDocument {
  const document: TemplateDocument = {
    sections: [
      {
        key: "sec.alpha",
        parent_key: null,
        title: "Seksjon alfa",
        repeat: "once",
        room_type_groups: [],
        optional: false,
        standard_text: null,
        help_text: null,
        sort_order: 0,
      },
      {
        key: "sec.alpha.sub",
        parent_key: "sec.alpha",
        title: "Underseksjon alfa",
        repeat: "per_room",
        room_type_groups: ["wet_room"],
        optional: true,
        standard_text: null,
        help_text: "Hjelpetekst for test",
        sort_order: 1,
      },
    ],
    elements: [
      {
        key: "el.size",
        section_key: "sec.alpha",
        checkpoint_key: "cp.one",
        label: "Størrelse",
        field_type: "choice",
        multiple: false,
        unit: null,
        min_value: null,
        max_value: null,
        decimals: null,
        table_columns: null,
        phrase_slot: null,
        required: true,
        default_value: null,
        help_text: null,
        show_in_report: true,
        sort_order: 0,
      },
      {
        key: "el.count",
        section_key: "sec.alpha",
        checkpoint_key: null,
        label: "Antall",
        field_type: "number",
        multiple: false,
        unit: "antall",
        min_value: 0,
        max_value: 100,
        decimals: 0,
        table_columns: null,
        phrase_slot: null,
        required: false,
        default_value: null,
        help_text: null,
        show_in_report: true,
        sort_order: 1,
      },
      {
        key: "el.grid",
        section_key: "sec.alpha.sub",
        checkpoint_key: null,
        label: "Tabell",
        field_type: "table",
        multiple: false,
        unit: null,
        min_value: null,
        max_value: null,
        decimals: null,
        table_columns: [
          { key: "place", label: "Sted", type: "text" },
          { key: "value", label: "Verdi", type: "number" },
        ],
        phrase_slot: null,
        required: false,
        default_value: null,
        help_text: null,
        show_in_report: false,
        sort_order: 0,
      },
    ],
    element_options: [
      {
        element_key: "el.size",
        key: "opt.small",
        label: "Liten",
        material_code: null,
        sort_order: 0,
      },
      {
        element_key: "el.size",
        key: "opt.large",
        label: "Stor",
        material_code: null,
        sort_order: 1,
      },
    ],
    checkpoints: [
      {
        key: "cp.one",
        section_key: "sec.alpha",
        name: "Punkt en",
        group: "interior",
        mandatory: true,
        regulation_ref: null,
        gives_tg: true,
        scope: "building",
        room_type_groups: [],
        applies_to_unit: null,
        related_checkpoint_keys: [],
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
        deviation_text: "Avvikstekst a",
        default_cause_criterion: null,
        default_consequence_text: "Konsekvens a",
        source_ref: null,
        sort_order: 0,
      },
      {
        checkpoint_key: "cp.one",
        question_key: "dq.first",
        key: "out.b",
        kind: "tg3",
        deviation_text: "Avvikstekst b",
        default_cause_criterion: null,
        default_consequence_text: null,
        source_ref: null,
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
        name: "Vis størrelse",
        purpose: "show",
        match: "all",
        target_element_key: "el.size",
        target_section_key: null,
        target_checkpoint_key: null,
        target_question: null,
        suggested_outcome: null,
        validation_code: null,
        severity: null,
        message: null,
        source_ref: null,
        active: true,
        sort_order: 0,
      },
      {
        key: "rule.suggest_a",
        name: "Foreslå a",
        purpose: "suggest_outcome",
        match: "any",
        target_element_key: null,
        target_section_key: null,
        target_checkpoint_key: "cp.one",
        target_question: { checkpoint_key: "cp.one", question_key: "dq.first" },
        suggested_outcome: {
          checkpoint_key: "cp.one",
          question_key: "dq.first",
          outcome_key: "out.a",
        },
        validation_code: null,
        severity: null,
        message: "Melding for test",
        source_ref: null,
        active: true,
        sort_order: 1,
      },
      {
        key: "rule.check_count",
        name: "Sjekk antall",
        purpose: "validate",
        match: "all",
        target_element_key: "el.count",
        target_section_key: null,
        target_checkpoint_key: null,
        target_question: null,
        suggested_outcome: null,
        validation_code: "count_required",
        severity: "warning",
        message: null,
        source_ref: null,
        active: true,
        sort_order: 2,
      },
    ],
    rule_conditions: [
      {
        rule_key: "rule.suggest_a",
        group_no: 1,
        type: "option_selected",
        element_key: "el.size",
        checkpoint_key: null,
        operator: "eq",
        value: "opt.large",
        sort_order: 0,
      },
      {
        rule_key: "rule.suggest_a",
        group_no: 2,
        type: "number_vs_limit",
        element_key: "el.count",
        checkpoint_key: null,
        operator: "gt",
        value: 10,
        sort_order: 1,
      },
    ],
    rule_test_cases: [
      {
        rule_key: "rule.suggest_a",
        name: "Stor gir a",
        input: { "el.size": "opt.large" },
        expect_triggered: true,
        expected_outcome: {
          checkpoint_key: "cp.one",
          question_key: "dq.first",
          outcome_key: "out.a",
        },
        sort_order: 0,
      },
      {
        rule_key: "rule.suggest_a",
        name: "Liten gir ingenting",
        input: { "el.size": "opt.small", "el.count": 1 },
        expect_triggered: false,
        expected_outcome: null,
        sort_order: 1,
      },
    ],
  };
  return { ...structuredClone(document), ...overrides };
}

/** Antall rader dokumentet gir i de elleve innholdstabellene (alt under versjonen). */
export function templateDocumentRowCount(document: TemplateDocument): number {
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
