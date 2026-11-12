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

/*
 * Et lite, gyldig dokument med regler til testene av regelmotoren og kontrollene i malmotoren
 * (docs/funksjoner/fase2a-regler-bad-testplan.md, avsnitt 0, 1, 5, 6 og 7.2).
 *
 * Ett kontrollpunkt som gir TG (`cp.room`), ett avviksspørsmål og ett utfall (`out.worn`, TG2).
 * Tre regler, én per betingelsestype:
 * - `chk.membrane` (`suggest_tgiu`): `option_selected` med `in` og en liste med valg.
 * - `chk.moisture` (`suggest_outcome`): `number_vs_limit` med terskelkode og enhetsfelt, uten
 *   egen sammenligning eller verdi.
 * - `chk.age` (`suggest_outcome`): `age_vs_lifespan` med alle fem alderfeltene og en liste med
 *   dokumentasjonsvalg som betyr «uten dokumentasjon».
 * Én testsak med `expected_state` og `inspection_year`.
 *
 * Regelkodene og feltkodene inneholder ingen engelske ord som «rule» eller «outcome», slik at
 * testene kan sjekke at feilmeldingene er norske selv om de nevner koden. Alt er oppdiktet og uten
 * fagtekst. Hvert kall gir et nytt objekt.
 */

/** Terskelkoden betingelsen `chk.moisture` bruker. Testene lager et terskelsett med denne koden. */
export const RULE_DOCUMENT_THRESHOLD_KEY = "x.moisture_limit";

/** Befaringsåret i testsaken (fast, aldri dagens dato). */
export const RULE_DOCUMENT_INSPECTION_YEAR = 2026;

/** Et nytt, gyldig dokument med regler. `overrides` erstatter hele lister. */
export function ruleDocument(
  overrides: Partial<TemplateDocumentInput> = {},
): Lists & TemplateDocumentInput {
  const document: Lists = {
    sections: [{ key: "sec.room", title: "Rom", sort_order: 0 }],
    elements: [
      {
        key: "x.material",
        section_key: "sec.room",
        checkpoint_key: "cp.room",
        label: "Materiale",
        field_type: "choice",
        sort_order: 0,
      },
      {
        key: "x.moisture",
        section_key: "sec.room",
        checkpoint_key: "cp.room",
        label: "Måling",
        field_type: "number",
        min_value: 0,
        max_value: 100,
        decimals: 1,
        sort_order: 1,
      },
      {
        key: "x.unit",
        section_key: "sec.room",
        checkpoint_key: "cp.room",
        label: "Enhet",
        field_type: "choice",
        sort_order: 2,
      },
      {
        key: "x.year",
        section_key: "sec.room",
        label: "Årstall",
        field_type: "number",
        min_value: 1800,
        max_value: 2200,
        decimals: 0,
        sort_order: 3,
      },
      {
        key: "x.year_fallback",
        section_key: "sec.room",
        label: "Årstall for bygget",
        field_type: "number",
        min_value: 1800,
        max_value: 2200,
        decimals: 0,
        sort_order: 4,
      },
      {
        key: "x.year_source",
        section_key: "sec.room",
        label: "Kilde for årstallet",
        field_type: "choice",
        sort_order: 5,
      },
      {
        key: "x.documentation",
        section_key: "sec.room",
        label: "Dokumentasjon",
        field_type: "choice",
        sort_order: 6,
      },
    ],
    element_options: [
      {
        element_key: "x.material",
        key: "opt.sheet",
        label: "Plate",
        material_code: "sheet",
        sort_order: 0,
      },
      {
        element_key: "x.material",
        key: "opt.paint",
        label: "Maling",
        material_code: "paint",
        sort_order: 1,
      },
      { element_key: "x.material", key: "opt.unknown", label: "Ukjent", sort_order: 2 },
      { element_key: "x.unit", key: "opt.weight_percent", label: "Vektprosent", sort_order: 0 },
      { element_key: "x.year_source", key: "opt.owner", label: "Eier", sort_order: 0 },
      { element_key: "x.year_source", key: "opt.papers", label: "Papirer", sort_order: 1 },
      { element_key: "x.documentation", key: "opt.yes", label: "Ja", sort_order: 0 },
      { element_key: "x.documentation", key: "opt.no", label: "Nei", sort_order: 1 },
      {
        element_key: "x.documentation",
        key: "opt.not_given",
        label: "Ikke oppgitt",
        sort_order: 2,
      },
    ],
    checkpoints: [
      {
        key: "cp.room",
        section_key: "sec.room",
        name: "Punkt rom",
        group: "room",
        gives_tg: true,
        sort_order: 0,
      },
    ],
    deviation_questions: [
      { checkpoint_key: "cp.room", key: "dq.state", text: "Spørsmål tilstand", sort_order: 0 },
    ],
    outcomes: [
      {
        checkpoint_key: "cp.room",
        question_key: "dq.state",
        key: "out.worn",
        kind: "tg2",
        deviation_text: "Utfallstekst slitt",
        sort_order: 0,
      },
    ],
    standard_measures: [],
    rules: [
      {
        key: "chk.membrane",
        name: "Ukjent materiale",
        purpose: "suggest_tgiu",
        target_checkpoint_key: "cp.room",
        message: "Meldingstekst materiale",
        source_ref: "Oppdiktet kilde",
        sort_order: 0,
      },
      {
        key: "chk.moisture",
        name: "Måling over grensen",
        purpose: "suggest_outcome",
        target_checkpoint_key: "cp.room",
        suggested_outcome: {
          checkpoint_key: "cp.room",
          question_key: "dq.state",
          outcome_key: "out.worn",
        },
        message: "Meldingstekst måling",
        source_ref: "Oppdiktet kilde",
        sort_order: 1,
      },
      {
        key: "chk.age",
        name: "Alder over levetid",
        purpose: "suggest_outcome",
        target_checkpoint_key: "cp.room",
        suggested_outcome: {
          checkpoint_key: "cp.room",
          question_key: "dq.state",
          outcome_key: "out.worn",
        },
        message: "Meldingstekst alder",
        source_ref: "Oppdiktet kilde",
        sort_order: 2,
      },
    ],
    rule_conditions: [
      {
        rule_key: "chk.membrane",
        type: "option_selected",
        element_key: "x.material",
        operator: "in",
        value: ["opt.unknown"],
        sort_order: 0,
      },
      {
        rule_key: "chk.moisture",
        type: "number_vs_limit",
        element_key: "x.moisture",
        threshold_key: RULE_DOCUMENT_THRESHOLD_KEY,
        unit_element_key: "x.unit",
        sort_order: 0,
      },
      {
        rule_key: "chk.age",
        type: "age_vs_lifespan",
        age_year_element_key: "x.year",
        age_fallback_year_element_key: "x.year_fallback",
        age_source_element_key: "x.year_source",
        documentation_element_key: "x.documentation",
        material_element_key: "x.material",
        value: ["opt.no", "opt.not_given"],
        sort_order: 0,
      },
    ],
    rule_test_cases: [
      {
        rule_key: "chk.age",
        name: "Gammelt og uten dokumentasjon",
        input: {
          "x.year": 1990,
          "x.year_source": "opt.papers",
          "x.documentation": "opt.no",
          "x.material": "opt.sheet",
        },
        expected_state: "triggered",
        inspection_year: RULE_DOCUMENT_INSPECTION_YEAR,
        sort_order: 0,
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
