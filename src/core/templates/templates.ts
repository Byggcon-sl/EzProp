import { and, asc, desc, eq, inArray, isNull, max, ne, or } from "drizzle-orm";
import {
  requireOrganizationAccess,
  requireTemplateEditAccess,
  type Actor,
  type EmployeeGrant,
} from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { isUniqueViolation } from "@/core/organization/errors";
import { db, type DbExecutor } from "@/db/client";
import {
  checkpoints,
  deviationQuestions,
  outcomes,
  ruleConditions,
  rules,
  ruleTestCases,
  standardMeasures,
  templateElementOptions,
  templateElements,
  templateFamilies,
  templateSections,
  templateVersions,
  type Checkpoint,
  type DeviationQuestion,
  type Outcome,
  type Rule,
  type RuleCondition,
  type RuleTestCase,
  type StandardMeasure,
  type TemplateElement,
  type TemplateElementOption,
  type TemplateKind,
  type TemplateSection,
  type TemplateVersionStatus,
} from "@/db/schema";
import { isUuid, uuidv7 } from "@/shared/lib/uuid";
import { checkDocumentKeys, optionScope, outcomeScope, questionScope } from "./document";
import {
  TEMPLATE_DRAFT_EXISTS_MESSAGE,
  TEMPLATE_NOT_DRAFT_MESSAGE,
  TemplateNotFoundError,
  TemplateStateError,
  TemplateValidationError,
  type TemplateIssue,
} from "./errors";
import {
  changeNoteSchema,
  checkNoTgLogicInCustom,
  createTemplateFamilyInputSchema,
  norwegianMessage,
  parseTemplateDocument,
  templateDocumentSchema,
  toTemplateIssues,
  type CreateTemplateFamilyInput,
  type TemplateDocument,
  type TemplateDocumentInput,
} from "./schemas";

/*
 * Malmotoren (docs/funksjoner/fase2a-malmotor.md, Omfang 3–6).
 *
 * - Lesing krever `organization.read`. Endring henter familien (for `kind`) og kaller
 *   `requireTemplateEditAccess`; ingen annen tilgangslogikk her.
 * - All filtrering bruker `grant.organizationId`, aldri parameteren. Ugyldig, fremmed eller
 *   slettet id gir `TemplateNotFoundError`.
 * - Innholdet lagres som et dokument med faste koder (`schemas.ts`). Rader med samme kode
 *   oppdateres, nye legges til, de som mangler slettes mykt. Rader uten kode erstattes samlet per
 *   forelder når listen er ulik (A142). Aldri hard sletting.
 * - Publiserte og utgåtte versjoner endres aldri.
 * - Revisjonsloggen får bare id-er, versjonsnummer og antall, aldri tekst fra malen.
 */

// --- Typer ut av kjernen ---------------------------------------------------------------------

export type TemplateVersionSummary = {
  id: string;
  versionNumber: number;
  status: TemplateVersionStatus;
  publishedAt: Date | null;
};

export type TemplateFamilyListItem = {
  id: string;
  name: string;
  kind: TemplateKind;
  reportType: string;
  createdAt: Date;
  /** Versjonene som ikke er slettet, nyeste først. */
  versions: TemplateVersionSummary[];
};

export type TemplateVersionDetail = {
  id: string;
  familyId: string;
  familyName: string;
  kind: TemplateKind;
  reportType: string;
  versionNumber: number;
  status: TemplateVersionStatus;
  validFrom: string | null;
  nsEdition: string | null;
  regulationVersion: string | null;
  basedOnVersionId: string | null;
  changeNote: string | null;
  publishedBy: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Hele treet med faste koder, sortert etter `sort_order` på hvert nivå, uten slettede rader. */
  document: TemplateDocument;
};

export type TemplateContentCounts = { added: number; changed: number; removed: number };

// --- Lesing av innholdet ---------------------------------------------------------------------

type WithVersion<T> = { row: T; versionId: string };

/** Alle aktive rader i en eller flere versjoner, med foreldrenes koder. */
type Content = {
  sections: TemplateSection[];
  elements: TemplateElement[];
  checkpoints: Checkpoint[];
  rules: Rule[];
  options: (WithVersion<TemplateElementOption> & { elementKey: string })[];
  questions: (WithVersion<DeviationQuestion> & { checkpointKey: string })[];
  outcomes: (WithVersion<Outcome> & { checkpointKey: string; questionKey: string })[];
  measures: (WithVersion<StandardMeasure> & {
    checkpointKey: string;
    questionKey: string;
    outcomeKey: string;
  })[];
  conditions: (WithVersion<RuleCondition> & { ruleKey: string })[];
  testCases: (WithVersion<RuleTestCase> & { ruleKey: string })[];
};

const EMPTY_CONTENT: Content = {
  sections: [],
  elements: [],
  checkpoints: [],
  rules: [],
  options: [],
  questions: [],
  outcomes: [],
  measures: [],
  conditions: [],
  testCases: [],
};

/**
 * Leser aktive rader i versjonene. Barn hentes bare når forelderen også er aktiv og i samme
 * organisasjon (join på id og organisasjon).
 */
async function loadContent(ex: DbExecutor, orgId: string, versionIds: string[]): Promise<Content> {
  if (versionIds.length === 0) return EMPTY_CONTENT;

  const [sections, elements, checkpointRows, ruleRows] = await Promise.all([
    ex
      .select()
      .from(templateSections)
      .where(
        and(
          eq(templateSections.organizationId, orgId),
          inArray(templateSections.versionId, versionIds),
          isNull(templateSections.deletedAt),
        ),
      ),
    ex
      .select()
      .from(templateElements)
      .where(
        and(
          eq(templateElements.organizationId, orgId),
          inArray(templateElements.versionId, versionIds),
          isNull(templateElements.deletedAt),
        ),
      ),
    ex
      .select()
      .from(checkpoints)
      .where(
        and(
          eq(checkpoints.organizationId, orgId),
          inArray(checkpoints.versionId, versionIds),
          isNull(checkpoints.deletedAt),
        ),
      ),
    ex
      .select()
      .from(rules)
      .where(
        and(
          eq(rules.organizationId, orgId),
          inArray(rules.versionId, versionIds),
          isNull(rules.deletedAt),
        ),
      ),
  ]);

  const elementJoin = and(
    eq(templateElements.id, templateElementOptions.elementId),
    eq(templateElements.organizationId, orgId),
    isNull(templateElements.deletedAt),
  );
  const checkpointJoin = and(
    eq(checkpoints.id, deviationQuestions.checkpointId),
    eq(checkpoints.organizationId, orgId),
    isNull(checkpoints.deletedAt),
  );
  const questionJoin = and(
    eq(deviationQuestions.id, outcomes.deviationQuestionId),
    eq(deviationQuestions.organizationId, orgId),
    isNull(deviationQuestions.deletedAt),
  );
  const outcomeJoin = and(
    eq(outcomes.id, standardMeasures.outcomeId),
    eq(outcomes.organizationId, orgId),
    isNull(outcomes.deletedAt),
  );

  const [options, questions, outcomeRows, measures, conditions, testCases] = await Promise.all([
    ex
      .select({
        row: templateElementOptions,
        elementKey: templateElements.key,
        versionId: templateElements.versionId,
      })
      .from(templateElementOptions)
      .innerJoin(templateElements, elementJoin)
      .where(
        and(
          eq(templateElementOptions.organizationId, orgId),
          inArray(templateElements.versionId, versionIds),
          isNull(templateElementOptions.deletedAt),
        ),
      ),
    ex
      .select({
        row: deviationQuestions,
        checkpointKey: checkpoints.key,
        versionId: checkpoints.versionId,
      })
      .from(deviationQuestions)
      .innerJoin(checkpoints, checkpointJoin)
      .where(
        and(
          eq(deviationQuestions.organizationId, orgId),
          inArray(checkpoints.versionId, versionIds),
          isNull(deviationQuestions.deletedAt),
        ),
      ),
    ex
      .select({
        row: outcomes,
        checkpointKey: checkpoints.key,
        questionKey: deviationQuestions.key,
        versionId: checkpoints.versionId,
      })
      .from(outcomes)
      .innerJoin(deviationQuestions, questionJoin)
      .innerJoin(checkpoints, checkpointJoin)
      .where(
        and(
          eq(outcomes.organizationId, orgId),
          inArray(checkpoints.versionId, versionIds),
          isNull(outcomes.deletedAt),
        ),
      ),
    ex
      .select({
        row: standardMeasures,
        checkpointKey: checkpoints.key,
        questionKey: deviationQuestions.key,
        outcomeKey: outcomes.key,
        versionId: checkpoints.versionId,
      })
      .from(standardMeasures)
      .innerJoin(outcomes, outcomeJoin)
      .innerJoin(deviationQuestions, questionJoin)
      .innerJoin(checkpoints, checkpointJoin)
      .where(
        and(
          eq(standardMeasures.organizationId, orgId),
          inArray(checkpoints.versionId, versionIds),
          isNull(standardMeasures.deletedAt),
        ),
      ),
    ex
      .select({ row: ruleConditions, ruleKey: rules.key, versionId: rules.versionId })
      .from(ruleConditions)
      .innerJoin(
        rules,
        and(
          eq(rules.id, ruleConditions.ruleId),
          eq(rules.organizationId, orgId),
          isNull(rules.deletedAt),
        ),
      )
      .where(
        and(
          eq(ruleConditions.organizationId, orgId),
          inArray(rules.versionId, versionIds),
          isNull(ruleConditions.deletedAt),
        ),
      ),
    ex
      .select({ row: ruleTestCases, ruleKey: rules.key, versionId: rules.versionId })
      .from(ruleTestCases)
      .innerJoin(
        rules,
        and(
          eq(rules.id, ruleTestCases.ruleId),
          eq(rules.organizationId, orgId),
          isNull(rules.deletedAt),
        ),
      )
      .where(
        and(
          eq(ruleTestCases.organizationId, orgId),
          inArray(rules.versionId, versionIds),
          isNull(ruleTestCases.deletedAt),
        ),
      ),
  ]);

  return {
    sections,
    elements,
    checkpoints: checkpointRows,
    rules: ruleRows,
    options,
    questions,
    outcomes: outcomeRows,
    measures,
    conditions,
    testCases,
  };
}

/** Bare radene i én versjon. */
function contentFor(content: Content, versionId: string): Content {
  return {
    sections: content.sections.filter((r) => r.versionId === versionId),
    elements: content.elements.filter((r) => r.versionId === versionId),
    checkpoints: content.checkpoints.filter((r) => r.versionId === versionId),
    rules: content.rules.filter((r) => r.versionId === versionId),
    options: content.options.filter((r) => r.versionId === versionId),
    questions: content.questions.filter((r) => r.versionId === versionId),
    outcomes: content.outcomes.filter((r) => r.versionId === versionId),
    measures: content.measures.filter((r) => r.versionId === versionId),
    conditions: content.conditions.filter((r) => r.versionId === versionId),
    testCases: content.testCases.filter((r) => r.versionId === versionId),
  };
}

/** Stabil tekst for sammenligning: nøklene i objekter sortert, datoer som ISO-tekst. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) => {
    if (v instanceof Date) return v.toISOString();
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
      );
    }
    return v;
  });
}

function same(a: unknown, b: unknown): boolean {
  return canonical(a ?? null) === canonical(b ?? null);
}

type SortKey = (string | number)[];

function compareSortKeys(a: SortKey, b: SortKey): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? "";
    const y = b[i] ?? "";
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}

function sortBy<T>(items: readonly T[], key: (item: T) => SortKey): T[] {
  return [...items].sort((a, b) => compareSortKeys(key(a), key(b)));
}

/** Plassen i en sortert liste, slik at barn sorteres etter forelderens plass først. */
function indexOf<T>(items: readonly T[], id: (item: T) => string): Map<string, number> {
  return new Map(items.map((item, index) => [id(item), index]));
}

type QuestionRef = { checkpoint_key: string; question_key: string };
type OutcomeRef = QuestionRef & { outcome_key: string };

/**
 * Gjør radene i én versjon om til dokumentet. Sortert etter `sort_order` på hvert nivå: barn
 * etter forelderens plass, så `sort_order`, så kode (eller innhold for rader uten kode).
 */
function toDocument(content: Content): TemplateDocument {
  const sectionKeyById = new Map(content.sections.map((r) => [r.id, r.key]));
  const elementKeyById = new Map(content.elements.map((r) => [r.id, r.key]));
  const checkpointKeyById = new Map(content.checkpoints.map((r) => [r.id, r.key]));
  const questionById = new Map<string, QuestionRef>(
    content.questions.map((q) => [
      q.row.id,
      { checkpoint_key: q.checkpointKey, question_key: q.row.key },
    ]),
  );
  const outcomeById = new Map<string, OutcomeRef>(
    content.outcomes.map((o) => [
      o.row.id,
      { checkpoint_key: o.checkpointKey, question_key: o.questionKey, outcome_key: o.row.key },
    ]),
  );
  const keyOf = (map: Map<string, string>, id: string | null) =>
    id === null ? null : (map.get(id) ?? null);

  const sections = sortBy(content.sections, (r) => [r.sortOrder, r.key]);
  const sectionIndex = indexOf(sections, (r) => r.key);
  const checkpointRows = sortBy(content.checkpoints, (r) => [
    sectionIndex.get(sectionKeyById.get(r.sectionId) ?? "") ?? -1,
    r.sortOrder,
    r.key,
  ]);
  const checkpointIndex = indexOf(checkpointRows, (r) => r.key);
  const elements = sortBy(content.elements, (r) => [
    sectionIndex.get(sectionKeyById.get(r.sectionId) ?? "") ?? -1,
    r.sortOrder,
    r.key,
  ]);
  const elementIndex = indexOf(elements, (r) => r.key);
  const options = sortBy(content.options, (o) => [
    elementIndex.get(o.elementKey) ?? -1,
    o.row.sortOrder,
    o.row.key,
  ]);
  const questions = sortBy(content.questions, (q) => [
    checkpointIndex.get(q.checkpointKey) ?? -1,
    q.row.sortOrder,
    q.row.key,
  ]);
  const questionIndex = indexOf(questions, (q) => questionScope(q.checkpointKey, q.row.key));
  const outcomeRows = sortBy(content.outcomes, (o) => [
    questionIndex.get(questionScope(o.checkpointKey, o.questionKey)) ?? -1,
    o.row.sortOrder,
    o.row.key,
  ]);
  const outcomeIndex = indexOf(outcomeRows, (o) =>
    outcomeScope(o.checkpointKey, o.questionKey, o.row.key),
  );
  const measures = sortBy(content.measures, (m) => [
    outcomeIndex.get(outcomeScope(m.checkpointKey, m.questionKey, m.outcomeKey)) ?? -1,
    m.row.sortOrder,
    m.row.text,
  ]);
  const ruleRows = sortBy(content.rules, (r) => [r.sortOrder, r.key]);
  const ruleIndex = indexOf(ruleRows, (r) => r.key);
  const conditions = sortBy(content.conditions, (c) => [
    ruleIndex.get(c.ruleKey) ?? -1,
    c.row.sortOrder,
    c.row.groupNo ?? 0,
    canonical([c.row.type, c.row.elementKey, c.row.checkpointKey, c.row.operator, c.row.value]),
  ]);
  const testCases = sortBy(content.testCases, (t) => [
    ruleIndex.get(t.ruleKey) ?? -1,
    t.row.sortOrder,
    t.row.name,
  ]);

  type Doc = TemplateDocument;
  return {
    sections: sections.map((r) => ({
      key: r.key,
      parent_key: keyOf(sectionKeyById, r.parentSectionId),
      title: r.title,
      repeat: r.repeat as Doc["sections"][number]["repeat"],
      room_type_groups: r.roomTypeGroups as Doc["sections"][number]["room_type_groups"],
      optional: r.optional,
      standard_text: r.standardText,
      help_text: r.helpText,
      sort_order: r.sortOrder,
    })),
    elements: elements.map((r) => ({
      key: r.key,
      section_key: sectionKeyById.get(r.sectionId) ?? "",
      checkpoint_key: keyOf(checkpointKeyById, r.checkpointId),
      label: r.label,
      field_type: r.fieldType as Doc["elements"][number]["field_type"],
      multiple: r.multiple,
      unit: r.unit,
      min_value: r.minValue,
      max_value: r.maxValue,
      decimals: r.decimals,
      table_columns: r.tableColumns as Doc["elements"][number]["table_columns"],
      phrase_slot: r.phraseSlot as Doc["elements"][number]["phrase_slot"],
      required: r.required,
      default_value: r.defaultValue as Doc["elements"][number]["default_value"],
      help_text: r.helpText,
      show_in_report: r.showInReport,
      sort_order: r.sortOrder,
    })),
    element_options: options.map((o) => ({
      element_key: o.elementKey,
      key: o.row.key,
      label: o.row.label,
      material_code: o.row.materialCode,
      sort_order: o.row.sortOrder,
    })),
    checkpoints: checkpointRows.map((r) => ({
      key: r.key,
      section_key: sectionKeyById.get(r.sectionId) ?? "",
      name: r.name,
      group: r.group as Doc["checkpoints"][number]["group"],
      mandatory: r.mandatory,
      regulation_ref: r.regulationRef,
      gives_tg: r.givesTg,
      scope: r.scope as Doc["checkpoints"][number]["scope"],
      room_type_groups: r.roomTypeGroups as Doc["checkpoints"][number]["room_type_groups"],
      applies_to_unit: r.appliesToUnit as Doc["checkpoints"][number]["applies_to_unit"],
      related_checkpoint_keys: r.relatedCheckpointKeys,
      sort_order: r.sortOrder,
    })),
    deviation_questions: questions.map((q) => ({
      checkpoint_key: q.checkpointKey,
      key: q.row.key,
      text: q.row.text,
      sort_order: q.row.sortOrder,
    })),
    outcomes: outcomeRows.map((o) => ({
      checkpoint_key: o.checkpointKey,
      question_key: o.questionKey,
      key: o.row.key,
      kind: o.row.kind as Doc["outcomes"][number]["kind"],
      deviation_text: o.row.deviationText,
      default_cause_text: o.row.defaultCauseText,
      default_cause_criterion: o.row
        .defaultCauseCriterion as Doc["outcomes"][number]["default_cause_criterion"],
      default_consequence_text: o.row.defaultConsequenceText,
      source_ref: o.row.sourceRef,
      text_status: o.row.textStatus,
      sort_order: o.row.sortOrder,
    })),
    standard_measures: measures.map((m) => ({
      checkpoint_key: m.checkpointKey,
      question_key: m.questionKey,
      outcome_key: m.outcomeKey,
      text: m.row.text,
      text_status: m.row.textStatus,
      sort_order: m.row.sortOrder,
    })),
    rules: ruleRows.map((r) => ({
      key: r.key,
      name: r.name,
      purpose: r.purpose as Doc["rules"][number]["purpose"],
      match: r.match as Doc["rules"][number]["match"],
      target_element_key: keyOf(elementKeyById, r.targetElementId),
      target_section_key: keyOf(sectionKeyById, r.targetSectionId),
      target_checkpoint_key: keyOf(checkpointKeyById, r.targetCheckpointId),
      target_question:
        r.targetQuestionId === null ? null : (questionById.get(r.targetQuestionId) ?? null),
      suggested_outcome:
        r.suggestedOutcomeId === null ? null : (outcomeById.get(r.suggestedOutcomeId) ?? null),
      validation_code: r.validationCode,
      severity: r.severity as Doc["rules"][number]["severity"],
      message: r.message,
      source_ref: r.sourceRef,
      active: r.active,
      sort_order: r.sortOrder,
    })),
    rule_conditions: conditions.map((c) => ({
      rule_key: c.ruleKey,
      group_no: c.row.groupNo,
      type: c.row.type as Doc["rule_conditions"][number]["type"],
      element_key: c.row.elementKey,
      checkpoint_key: c.row.checkpointKey,
      operator: c.row.operator as Doc["rule_conditions"][number]["operator"],
      value: c.row.value as Doc["rule_conditions"][number]["value"],
      sort_order: c.row.sortOrder,
    })),
    rule_test_cases: testCases.map((t) => ({
      rule_key: t.ruleKey,
      name: t.row.name,
      input: t.row.input as Doc["rule_test_cases"][number]["input"],
      expect_triggered: t.row.expectTriggered,
      expected_outcome:
        t.row.expectedOutcomeId === null
          ? null
          : (outcomeById.get(t.row.expectedOutcomeId) ?? null),
      sort_order: t.row.sortOrder,
    })),
  };
}

/**
 * Dokumentet med hver liste i fast rekkefølge: etter kodene (med forelderens kode der koden bare
 * er unik under forelderen), så `sort_order`, så hele raden. Rader uten kode (standardtiltak,
 * betingelser, testtilfeller) sorteres etter forelderen, `sort_order` og innholdet.
 */
function sortedDocument(doc: TemplateDocument): TemplateDocument {
  const whole = (item: unknown) => canonical(item);
  return {
    sections: sortBy(doc.sections, (s) => [s.key]),
    elements: sortBy(doc.elements, (e) => [e.key]),
    element_options: sortBy(doc.element_options, (o) => [o.element_key, o.key]),
    checkpoints: sortBy(doc.checkpoints, (c) => [c.key]),
    deviation_questions: sortBy(doc.deviation_questions, (q) => [q.checkpoint_key, q.key]),
    outcomes: sortBy(doc.outcomes, (o) => [o.checkpoint_key, o.question_key, o.key]),
    standard_measures: sortBy(doc.standard_measures, (m) => [
      m.checkpoint_key,
      m.question_key,
      m.outcome_key,
      m.sort_order,
      m.text,
      whole(m),
    ]),
    rules: sortBy(doc.rules, (r) => [r.key]),
    rule_conditions: sortBy(doc.rule_conditions, (c) => [
      c.rule_key,
      c.group_no ?? 0,
      c.sort_order,
      whole(c),
    ]),
    rule_test_cases: sortBy(doc.rule_test_cases, (t) => [
      t.rule_key,
      t.sort_order,
      t.name,
      whole(t),
    ]),
  };
}

/**
 * Har to maldokumenter samme innhold? Rekkefølgen i listene teller ikke; alt annet gjør det,
 * også `sort_order`, tekstene, `text_status` og `default_cause_text`. Ren funksjon uten database.
 * Brukes av seed for å avgjøre om det trengs en ny versjon (A209).
 */
export function isSameTemplateContent(a: TemplateDocument, b: TemplateDocument): boolean {
  return canonical(sortedDocument(a)) === canonical(sortedDocument(b));
}

// --- Skriving av innholdet -------------------------------------------------------------------

type WriteContext = {
  organizationId: string;
  /** Den ansatte som gjør endringen (tom i testfabrikken). */
  employeeId: string | null;
  now: Date;
};

type ContentTable =
  | typeof templateSections
  | typeof templateElements
  | typeof templateElementOptions
  | typeof checkpoints
  | typeof deviationQuestions
  | typeof outcomes
  | typeof standardMeasures
  | typeof rules
  | typeof ruleConditions
  | typeof ruleTestCases;

type Values = Record<string, unknown>;

/** Drizzle klarer ikke en union av tabeller i `insert`/`update`; alle har de samme fellesfeltene. */
function asTable(table: ContentTable) {
  return table as typeof templateSections;
}

async function insertRows(
  tx: DbExecutor,
  ctx: WriteContext,
  table: ContentTable,
  rows: (Values & { id: string })[],
) {
  if (rows.length === 0) return;
  await tx.insert(asTable(table)).values(
    rows.map((values) => ({
      ...values,
      organizationId: ctx.organizationId,
      createdBy: ctx.employeeId,
      updatedBy: ctx.employeeId,
    })) as never,
  );
}

async function updateRow(
  tx: DbExecutor,
  ctx: WriteContext,
  table: ContentTable,
  id: string,
  values: Values,
) {
  const t = asTable(table);
  await tx
    .update(t)
    .set({ ...values, updatedBy: ctx.employeeId } as never)
    .where(and(eq(t.id, id), eq(t.organizationId, ctx.organizationId)));
}

async function softDelete(tx: DbExecutor, ctx: WriteContext, table: ContentTable, ids: string[]) {
  if (ids.length === 0) return;
  const t = asTable(table);
  await tx
    .update(t)
    .set({ deletedAt: ctx.now, deletedBy: ctx.employeeId, updatedBy: ctx.employeeId })
    .where(and(inArray(t.id, ids), eq(t.organizationId, ctx.organizationId), isNull(t.deletedAt)));
}

/** Feltene i `values` som er ulike i den lagrede raden. */
function changedColumns(row: Values, values: Values): string[] {
  return Object.keys(values).filter((column) => !same(row[column], values[column]));
}

/**
 * Rader med fast kode: samme identitet oppdateres (bare når minst ett felt er ulikt, A144), nye
 * legges til, de som mangler slettes mykt. Identiteten er koden, med forelderens kode der koden
 * bare er unik under forelderen (A141).
 */
async function syncKeyed(
  tx: DbExecutor,
  ctx: WriteContext,
  table: ContentTable,
  existing: { identity: string; row: Values & { id: string } }[],
  desired: { identity: string; values: Values }[],
  counts: TemplateContentCounts,
) {
  const existingByIdentity = new Map(existing.map((e) => [e.identity, e.row]));
  const idOf = new Map<string, string>();
  const created = new Set<string>();
  const changed = new Set<string>();
  const inserts: (Values & { id: string })[] = [];

  for (const item of desired) {
    const row = existingByIdentity.get(item.identity);
    if (row) {
      idOf.set(item.identity, row.id);
      if (changedColumns(row, item.values).length > 0) {
        await updateRow(tx, ctx, table, row.id, item.values);
        changed.add(item.identity);
        counts.changed += 1;
      }
    } else {
      const id = uuidv7();
      idOf.set(item.identity, id);
      created.add(item.identity);
      inserts.push({ id, ...item.values });
      counts.added += 1;
    }
  }
  const wanted = new Set(desired.map((d) => d.identity));
  const removed = existing.filter((e) => !wanted.has(e.identity)).map((e) => e.row.id);
  // Fjern først, så en kode som flyttes til en ny forelder aldri treffer den unike indeksen.
  await softDelete(tx, ctx, table, removed);
  counts.removed += removed.length;
  await insertRows(tx, ctx, table, inserts);
  return { idOf, created, changed, existingByIdentity };
}

/**
 * Rader uten kode (standardtiltak, betingelser, testtilfeller): er listen under forelderen lik
 * den lagrede (samme verdier, rekkefølge etter `sort_order`), skjer ingenting. Ellers slettes de
 * gamle mykt og de nye legges inn (A142).
 */
async function syncLists(
  tx: DbExecutor,
  ctx: WriteContext,
  table: ContentTable,
  columns: readonly string[],
  existing: { parentId: string; row: Values & { id: string } }[],
  desired: { parentId: string; values: Values }[],
  counts: TemplateContentCounts,
) {
  const project = (row: Values) => Object.fromEntries(columns.map((c) => [c, row[c] ?? null]));
  const normalize = (rows: Values[]) =>
    rows
      .map((row) => canonical(project(row)))
      .sort()
      .join("\n");

  const parents = new Set([...existing.map((e) => e.parentId), ...desired.map((d) => d.parentId)]);
  const removed: string[] = [];
  const inserts: (Values & { id: string })[] = [];
  for (const parentId of parents) {
    const before = existing.filter((e) => e.parentId === parentId);
    const after = desired.filter((d) => d.parentId === parentId);
    if (normalize(before.map((e) => e.row)) === normalize(after.map((d) => d.values))) continue;
    removed.push(...before.map((e) => e.row.id));
    inserts.push(...after.map((d) => ({ id: uuidv7(), ...d.values })));
  }
  await softDelete(tx, ctx, table, removed);
  await insertRows(tx, ctx, table, inserts);
  counts.removed += removed.length;
  counts.added += inserts.length;
}

function required(map: Map<string, string>, key: string): string {
  const id = map.get(key);
  // Kan ikke skje: `checkDocumentKeys` har sjekket alle referanser før lagring.
  if (!id) throw new Error("Fant ikke en kode i malen under lagring.");
  return id;
}

function optional(map: Map<string, string>, key: string | null): string | null {
  return key === null ? null : required(map, key);
}

/**
 * Lagrer dokumentet i versjonen etter kode. Dokumentet må være sjekket (`checkDocumentKeys`).
 * Kalles i en transaksjon. Gir antall rader lagt til, endret og fjernet (A144).
 */
async function applyDocument(
  tx: DbExecutor,
  ctx: WriteContext,
  versionId: string,
  existing: Content,
  doc: TemplateDocument,
): Promise<TemplateContentCounts> {
  const counts: TemplateContentCounts = { added: 0, changed: 0, removed: 0 };

  // Seksjoner: først uten forelder, så forelderen når alle id-ene finnes.
  const sec = await syncKeyed(
    tx,
    ctx,
    templateSections,
    existing.sections.map((row) => ({ identity: row.key, row })),
    doc.sections.map((s) => ({
      identity: s.key,
      values: {
        versionId,
        key: s.key,
        title: s.title,
        repeat: s.repeat,
        roomTypeGroups: s.room_type_groups,
        optional: s.optional,
        standardText: s.standard_text,
        helpText: s.help_text,
        sortOrder: s.sort_order,
      },
    })),
    counts,
  );
  for (const s of doc.sections) {
    const parentSectionId = optional(sec.idOf, s.parent_key);
    const before = sec.existingByIdentity.get(s.key) as TemplateSection | undefined;
    const current = sec.created.has(s.key) ? null : (before?.parentSectionId ?? null);
    if (current === parentSectionId) continue;
    await updateRow(tx, ctx, templateSections, required(sec.idOf, s.key), { parentSectionId });
    if (!sec.created.has(s.key) && !sec.changed.has(s.key)) counts.changed += 1;
  }

  const cp = await syncKeyed(
    tx,
    ctx,
    checkpoints,
    existing.checkpoints.map((row) => ({ identity: row.key, row })),
    doc.checkpoints.map((c) => ({
      identity: c.key,
      values: {
        versionId,
        sectionId: required(sec.idOf, c.section_key),
        key: c.key,
        name: c.name,
        group: c.group,
        mandatory: c.mandatory,
        regulationRef: c.regulation_ref,
        givesTg: c.gives_tg,
        scope: c.scope,
        roomTypeGroups: c.room_type_groups,
        appliesToUnit: c.applies_to_unit,
        relatedCheckpointKeys: c.related_checkpoint_keys,
        sortOrder: c.sort_order,
      },
    })),
    counts,
  );

  const el = await syncKeyed(
    tx,
    ctx,
    templateElements,
    existing.elements.map((row) => ({ identity: row.key, row })),
    doc.elements.map((e) => ({
      identity: e.key,
      values: {
        versionId,
        sectionId: required(sec.idOf, e.section_key),
        checkpointId: optional(cp.idOf, e.checkpoint_key),
        key: e.key,
        label: e.label,
        fieldType: e.field_type,
        multiple: e.multiple,
        unit: e.unit,
        minValue: e.min_value,
        maxValue: e.max_value,
        decimals: e.decimals,
        tableColumns: e.table_columns,
        phraseSlot: e.phrase_slot,
        required: e.required,
        defaultValue: e.default_value,
        helpText: e.help_text,
        showInReport: e.show_in_report,
        sortOrder: e.sort_order,
      },
    })),
    counts,
  );

  await syncKeyed(
    tx,
    ctx,
    templateElementOptions,
    existing.options.map((o) => ({ identity: optionScope(o.elementKey, o.row.key), row: o.row })),
    doc.element_options.map((o) => ({
      identity: optionScope(o.element_key, o.key),
      values: {
        elementId: required(el.idOf, o.element_key),
        key: o.key,
        label: o.label,
        materialCode: o.material_code,
        sortOrder: o.sort_order,
      },
    })),
    counts,
  );

  const dq = await syncKeyed(
    tx,
    ctx,
    deviationQuestions,
    existing.questions.map((q) => ({
      identity: questionScope(q.checkpointKey, q.row.key),
      row: q.row,
    })),
    doc.deviation_questions.map((q) => ({
      identity: questionScope(q.checkpoint_key, q.key),
      values: {
        checkpointId: required(cp.idOf, q.checkpoint_key),
        key: q.key,
        text: q.text,
        sortOrder: q.sort_order,
      },
    })),
    counts,
  );

  const out = await syncKeyed(
    tx,
    ctx,
    outcomes,
    existing.outcomes.map((o) => ({
      identity: outcomeScope(o.checkpointKey, o.questionKey, o.row.key),
      row: o.row,
    })),
    doc.outcomes.map((o) => ({
      identity: outcomeScope(o.checkpoint_key, o.question_key, o.key),
      values: {
        deviationQuestionId: required(dq.idOf, questionScope(o.checkpoint_key, o.question_key)),
        key: o.key,
        kind: o.kind,
        deviationText: o.deviation_text,
        defaultCauseText: o.default_cause_text,
        defaultCauseCriterion: o.default_cause_criterion,
        defaultConsequenceText: o.default_consequence_text,
        sourceRef: o.source_ref,
        textStatus: o.text_status,
        sortOrder: o.sort_order,
      },
    })),
    counts,
  );
  const outcomeId = (ref: OutcomeRef | null) =>
    ref === null
      ? null
      : required(out.idOf, outcomeScope(ref.checkpoint_key, ref.question_key, ref.outcome_key));

  await syncLists(
    tx,
    ctx,
    standardMeasures,
    ["outcomeId", "text", "textStatus", "sortOrder"],
    existing.measures.map((m) => ({ parentId: m.row.outcomeId, row: m.row })),
    doc.standard_measures.map((m) => {
      const id = required(out.idOf, outcomeScope(m.checkpoint_key, m.question_key, m.outcome_key));
      return {
        parentId: id,
        values: { outcomeId: id, text: m.text, textStatus: m.text_status, sortOrder: m.sort_order },
      };
    }),
    counts,
  );

  const ru = await syncKeyed(
    tx,
    ctx,
    rules,
    existing.rules.map((row) => ({ identity: row.key, row })),
    doc.rules.map((r) => ({
      identity: r.key,
      values: {
        versionId,
        key: r.key,
        name: r.name,
        purpose: r.purpose,
        match: r.match,
        targetElementId: optional(el.idOf, r.target_element_key),
        targetQuestionId:
          r.target_question === null
            ? null
            : required(
                dq.idOf,
                questionScope(r.target_question.checkpoint_key, r.target_question.question_key),
              ),
        targetSectionId: optional(sec.idOf, r.target_section_key),
        targetCheckpointId: optional(cp.idOf, r.target_checkpoint_key),
        suggestedOutcomeId: outcomeId(r.suggested_outcome),
        validationCode: r.validation_code,
        severity: r.severity,
        message: r.message,
        sourceRef: r.source_ref,
        active: r.active,
        sortOrder: r.sort_order,
      },
    })),
    counts,
  );

  await syncLists(
    tx,
    ctx,
    ruleConditions,
    ["ruleId", "groupNo", "type", "elementKey", "checkpointKey", "operator", "value", "sortOrder"],
    existing.conditions.map((c) => ({ parentId: c.row.ruleId, row: c.row })),
    doc.rule_conditions.map((c) => {
      const ruleId = required(ru.idOf, c.rule_key);
      return {
        parentId: ruleId,
        values: {
          ruleId,
          groupNo: c.group_no,
          type: c.type,
          elementKey: c.element_key,
          checkpointKey: c.checkpoint_key,
          operator: c.operator,
          value: c.value,
          sortOrder: c.sort_order,
        },
      };
    }),
    counts,
  );

  await syncLists(
    tx,
    ctx,
    ruleTestCases,
    ["ruleId", "name", "input", "expectTriggered", "expectedOutcomeId", "sortOrder"],
    existing.testCases.map((t) => ({ parentId: t.row.ruleId, row: t.row })),
    doc.rule_test_cases.map((t) => {
      const ruleId = required(ru.idOf, t.rule_key);
      return {
        parentId: ruleId,
        values: {
          ruleId,
          name: t.name,
          input: t.input,
          expectTriggered: t.expect_triggered,
          expectedOutcomeId: outcomeId(t.expected_outcome),
          sortOrder: t.sort_order,
        },
      };
    }),
    counts,
  );

  return counts;
}

// --- Arkiverte koder (A136) ------------------------------------------------------------------

/** Identitetene (koder i sitt område) per liste i dokumentet, i samme form som i `applyDocument`. */
function identitiesOf(content: Content) {
  return {
    sections: new Set(content.sections.map((r) => r.key)),
    elements: new Set(content.elements.map((r) => r.key)),
    element_options: new Set(content.options.map((o) => optionScope(o.elementKey, o.row.key))),
    checkpoints: new Set(content.checkpoints.map((r) => r.key)),
    deviation_questions: new Set(
      content.questions.map((q) => questionScope(q.checkpointKey, q.row.key)),
    ),
    outcomes: new Set(
      content.outcomes.map((o) => outcomeScope(o.checkpointKey, o.questionKey, o.row.key)),
    ),
    rules: new Set(content.rules.map((r) => r.key)),
  };
}

/**
 * En kode er arkivert når den fantes i en tidligere versjon av familien, men ikke i den siste
 * publiserte (A136). Den kan ikke tas i bruk igjen.
 */
async function archivedKeyIssues(
  tx: DbExecutor,
  orgId: string,
  familyId: string,
  draftVersionId: string,
  doc: TemplateDocument,
): Promise<TemplateIssue[]> {
  const versions = await tx
    .select({
      id: templateVersions.id,
      status: templateVersions.status,
      versionNumber: templateVersions.versionNumber,
    })
    .from(templateVersions)
    .where(
      and(
        eq(templateVersions.organizationId, orgId),
        eq(templateVersions.familyId, familyId),
        ne(templateVersions.id, draftVersionId),
        isNull(templateVersions.deletedAt),
        or(eq(templateVersions.status, "published"), eq(templateVersions.status, "retired")),
      ),
    )
    .orderBy(desc(templateVersions.versionNumber));
  if (versions.length === 0) return [];
  const latest = versions.find((v) => v.status === "published") ?? versions[0]!;
  const older = versions.filter((v) => v.id !== latest.id);
  if (older.length === 0) return [];

  const content = await loadContent(
    tx,
    orgId,
    versions.map((v) => v.id),
  );
  const inLatest = identitiesOf(contentFor(content, latest.id));
  const olderContent = older.map((v) => identitiesOf(contentFor(content, v.id)));
  const archived = (list: keyof typeof inLatest, identity: string) =>
    !inLatest[list].has(identity) && olderContent.some((ids) => ids[list].has(identity));

  const issues: TemplateIssue[] = [];
  const check = (list: keyof typeof inLatest, identities: string[]) => {
    identities.forEach((identity, index) => {
      if (archived(list, identity)) {
        issues.push({
          path: `${list}.${index}.key`,
          rule: "key_archived",
          message: "Koden er arkivert og kan ikke brukes igjen. Lag en ny kode.",
        });
      }
    });
  };
  check(
    "sections",
    doc.sections.map((s) => s.key),
  );
  check(
    "elements",
    doc.elements.map((e) => e.key),
  );
  check(
    "element_options",
    doc.element_options.map((o) => optionScope(o.element_key, o.key)),
  );
  check(
    "checkpoints",
    doc.checkpoints.map((c) => c.key),
  );
  check(
    "deviation_questions",
    doc.deviation_questions.map((q) => questionScope(q.checkpoint_key, q.key)),
  );
  check(
    "outcomes",
    doc.outcomes.map((o) => outcomeScope(o.checkpoint_key, o.question_key, o.key)),
  );
  check(
    "rules",
    doc.rules.map((r) => r.key),
  );
  return issues;
}

// --- Versjon og familie ----------------------------------------------------------------------

/** Versjonen (ikke slettet) i en familie som ikke er slettet, med familiens `kind`. */
async function findVersion(ex: DbExecutor, orgId: string, versionId: string, lock = false) {
  const query = ex
    .select({
      id: templateVersions.id,
      familyId: templateVersions.familyId,
      versionNumber: templateVersions.versionNumber,
      status: templateVersions.status,
      kind: templateFamilies.kind,
    })
    .from(templateVersions)
    .innerJoin(
      templateFamilies,
      and(
        eq(templateFamilies.id, templateVersions.familyId),
        eq(templateFamilies.organizationId, orgId),
        isNull(templateFamilies.deletedAt),
      ),
    )
    .where(
      and(
        eq(templateVersions.id, versionId),
        eq(templateVersions.organizationId, orgId),
        isNull(templateVersions.deletedAt),
      ),
    );
  const [row] = lock ? await query.for("update", { of: templateVersions }) : await query;
  if (!row) throw new TemplateNotFoundError();
  return { ...row, kind: row.kind as TemplateKind, status: row.status as TemplateVersionStatus };
}

async function findFamily(ex: DbExecutor, orgId: string, familyId: string, lock = false) {
  const query = ex
    .select({ id: templateFamilies.id, kind: templateFamilies.kind })
    .from(templateFamilies)
    .where(
      and(
        eq(templateFamilies.id, familyId),
        eq(templateFamilies.organizationId, orgId),
        isNull(templateFamilies.deletedAt),
      ),
    );
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw new TemplateNotFoundError();
  return { ...row, kind: row.kind as TemplateKind };
}

/**
 * Finner versjonen og sjekker maltilgangen for familien. Først medlemskap i organisasjonen
 * (slik at oppslaget filtrerer på `grant.organizationId`), så maltilgangen.
 */
async function requireEditableVersion(actor: Actor, organizationId: string, versionId: string) {
  const member = await requireOrganizationAccess(actor, organizationId, "organization.read");
  if (!isUuid(versionId)) throw new TemplateNotFoundError();
  const version = await findVersion(db, member.organizationId, versionId);
  const grant = await requireTemplateEditAccess(actor, member.organizationId, {
    kind: version.kind,
  });
  return { grant, version };
}

async function audit(
  tx: DbExecutor,
  grant: EmployeeGrant,
  action: "create" | "update" | "publish",
  changes: { versionId: string; familyId: string; versionNumber: number } & Record<
    string,
    string | number | null
  >,
) {
  // Bare id-er, versjonsnummer og antall. Aldri navn, titler, ledetekster eller tekster.
  await recordAuditEvent(tx, grant, {
    entityType: "template_version",
    entityId: changes.versionId,
    action,
    changes,
  });
}

function validated(document: unknown, kind: TemplateKind): TemplateDocument {
  const parsed = parseTemplateDocument(document);
  if (!parsed.success) throw new TemplateValidationError(parsed.issues);
  const issues = [
    ...checkDocumentKeys(parsed.document),
    ...checkNoTgLogicInCustom(kind, parsed.document),
  ];
  if (issues.length > 0) throw new TemplateValidationError(issues);
  return parsed.document;
}

// --- Tjenestene ------------------------------------------------------------------------------

/** Malfamiliene i organisasjonen (ikke slettede), med versjonene. Alle ansatte. */
export async function listTemplateFamilies(
  actor: Actor,
  organizationId: string,
): Promise<TemplateFamilyListItem[]> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  const orgId = grant.organizationId;
  const families = await db
    .select({
      id: templateFamilies.id,
      name: templateFamilies.name,
      kind: templateFamilies.kind,
      reportType: templateFamilies.reportType,
      createdAt: templateFamilies.createdAt,
    })
    .from(templateFamilies)
    .where(and(eq(templateFamilies.organizationId, orgId), isNull(templateFamilies.deletedAt)))
    .orderBy(asc(templateFamilies.name), asc(templateFamilies.id));
  if (families.length === 0) return [];
  const versions = await db
    .select({
      id: templateVersions.id,
      familyId: templateVersions.familyId,
      versionNumber: templateVersions.versionNumber,
      status: templateVersions.status,
      publishedAt: templateVersions.publishedAt,
    })
    .from(templateVersions)
    .where(
      and(
        eq(templateVersions.organizationId, orgId),
        inArray(
          templateVersions.familyId,
          families.map((f) => f.id),
        ),
        isNull(templateVersions.deletedAt),
      ),
    )
    .orderBy(desc(templateVersions.versionNumber));
  return families.map((family) => ({
    ...family,
    kind: family.kind as TemplateKind,
    versions: versions
      .filter((v) => v.familyId === family.id)
      .map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        status: v.status as TemplateVersionStatus,
        publishedAt: v.publishedAt,
      })),
  }));
}

/** Én malversjon med hele treet. Alle ansatte. */
export async function getTemplateVersion(
  actor: Actor,
  organizationId: string,
  versionId: string,
): Promise<TemplateVersionDetail> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  if (!isUuid(versionId)) throw new TemplateNotFoundError();
  const orgId = grant.organizationId;
  const [row] = await db
    .select({
      id: templateVersions.id,
      familyId: templateVersions.familyId,
      familyName: templateFamilies.name,
      kind: templateFamilies.kind,
      reportType: templateFamilies.reportType,
      versionNumber: templateVersions.versionNumber,
      status: templateVersions.status,
      validFrom: templateVersions.validFrom,
      nsEdition: templateVersions.nsEdition,
      regulationVersion: templateVersions.regulationVersion,
      basedOnVersionId: templateVersions.basedOnVersionId,
      changeNote: templateVersions.changeNote,
      publishedBy: templateVersions.publishedBy,
      publishedAt: templateVersions.publishedAt,
      createdAt: templateVersions.createdAt,
      updatedAt: templateVersions.updatedAt,
    })
    .from(templateVersions)
    .innerJoin(
      templateFamilies,
      and(
        eq(templateFamilies.id, templateVersions.familyId),
        eq(templateFamilies.organizationId, orgId),
        isNull(templateFamilies.deletedAt),
      ),
    )
    .where(
      and(
        eq(templateVersions.id, versionId),
        eq(templateVersions.organizationId, orgId),
        isNull(templateVersions.deletedAt),
      ),
    );
  if (!row) throw new TemplateNotFoundError();
  const content = await loadContent(db, orgId, [row.id]);
  return {
    ...row,
    kind: row.kind as TemplateKind,
    status: row.status as TemplateVersionStatus,
    document: toDocument(content),
  };
}

/**
 * Ny malfamilie med en tom utkastversjon 1 (A143), i én transaksjon. Bare systemmaler (A139).
 */
export async function createTemplateFamily(
  actor: Actor,
  organizationId: string,
  input: CreateTemplateFamilyInput,
): Promise<{ familyId: string; versionId: string }> {
  const requestedKind = typeof input?.kind === "string" ? input.kind : "system";
  const grant = await requireTemplateEditAccess(actor, organizationId, { kind: requestedKind });
  const parsed = createTemplateFamilyInputSchema.safeParse(input, { error: norwegianMessage });
  if (!parsed.success) throw new TemplateValidationError(toTemplateIssues(parsed.error));
  const orgId = grant.organizationId;
  const familyId = uuidv7();
  const versionId = uuidv7();

  await db.transaction(async (tx) => {
    await tx.insert(templateFamilies).values({
      id: familyId,
      organizationId: orgId,
      name: parsed.data.name,
      kind: parsed.data.kind,
      reportType: parsed.data.report_type,
      createdBy: grant.employeeId,
      updatedBy: grant.employeeId,
    });
    await tx.insert(templateVersions).values({
      id: versionId,
      organizationId: orgId,
      familyId,
      versionNumber: 1,
      status: "draft",
      createdBy: grant.employeeId,
      updatedBy: grant.employeeId,
    });
    await audit(tx, grant, "create", { versionId, familyId, versionNumber: 1 });
  });
  return { familyId, versionId };
}

/**
 * Nytt utkast fra siste publiserte versjon: hele treet kopieres med samme koder og nye id-er
 * (A138). Kilden er urørt. Finnes det allerede et utkast, gir den `TemplateStateError`.
 */
export async function createDraftVersion(
  actor: Actor,
  organizationId: string,
  familyId: string,
  now: Date = new Date(),
): Promise<{ versionId: string }> {
  const member = await requireOrganizationAccess(actor, organizationId, "organization.read");
  if (!isUuid(familyId)) throw new TemplateNotFoundError();
  const family = await findFamily(db, member.organizationId, familyId);
  const grant = await requireTemplateEditAccess(actor, member.organizationId, family);
  const orgId = grant.organizationId;

  try {
    return await db.transaction(async (tx) => {
      // Låser familien, så to samtidige kall venter på hverandre.
      await findFamily(tx, orgId, familyId, true);
      const familyVersions = and(
        eq(templateVersions.organizationId, orgId),
        eq(templateVersions.familyId, familyId),
      );
      const [draft] = await tx
        .select({ id: templateVersions.id })
        .from(templateVersions)
        .where(
          and(
            familyVersions,
            eq(templateVersions.status, "draft"),
            isNull(templateVersions.deletedAt),
          ),
        );
      if (draft) throw new TemplateStateError(TEMPLATE_DRAFT_EXISTS_MESSAGE);
      const [source] = await tx
        .select({
          id: templateVersions.id,
          validFrom: templateVersions.validFrom,
          nsEdition: templateVersions.nsEdition,
          regulationVersion: templateVersions.regulationVersion,
        })
        .from(templateVersions)
        .where(
          and(
            familyVersions,
            eq(templateVersions.status, "published"),
            isNull(templateVersions.deletedAt),
          ),
        )
        .orderBy(desc(templateVersions.versionNumber))
        .limit(1);
      if (!source) throw new TemplateNotFoundError();
      // Også slettede versjoner, fordi nummeret er unikt i familien.
      const [highest] = await tx
        .select({ value: max(templateVersions.versionNumber) })
        .from(templateVersions)
        .where(familyVersions);
      const versionNumber = (highest?.value ?? 0) + 1;
      const versionId = uuidv7();
      await tx.insert(templateVersions).values({
        id: versionId,
        organizationId: orgId,
        familyId,
        versionNumber,
        status: "draft",
        validFrom: source.validFrom,
        nsEdition: source.nsEdition,
        regulationVersion: source.regulationVersion,
        basedOnVersionId: source.id,
        createdBy: grant.employeeId,
        updatedBy: grant.employeeId,
      });
      const document = toDocument(await loadContent(tx, orgId, [source.id]));
      await applyDocument(
        tx,
        { organizationId: orgId, employeeId: grant.employeeId, now },
        versionId,
        EMPTY_CONTENT,
        document,
      );
      await audit(tx, grant, "create", {
        versionId,
        familyId,
        versionNumber,
        basedOnVersionId: source.id,
      });
      return { versionId };
    });
  } catch (error) {
    if (
      isUniqueViolation(error, "template_versions_one_draft_per_family_idx") ||
      isUniqueViolation(error, "template_versions_family_id_version_number_idx")
    ) {
      throw new TemplateStateError(TEMPLATE_DRAFT_EXISTS_MESSAGE);
    }
    throw error;
  }
}

/**
 * Lagrer hele innholdet i et utkast etter kode, i én transaksjon. Gir antall rader lagt til,
 * endret og fjernet (A144). Ugyldig dokument gir `TemplateValidationError` og ingen endring.
 */
export async function saveDraftContent(
  actor: Actor,
  organizationId: string,
  versionId: string,
  document: TemplateDocumentInput,
  now: Date = new Date(),
): Promise<TemplateContentCounts> {
  const { grant, version } = await requireEditableVersion(actor, organizationId, versionId);
  const orgId = grant.organizationId;
  if (version.status !== "draft") throw new TemplateStateError(TEMPLATE_NOT_DRAFT_MESSAGE);
  const doc = validated(document, version.kind);

  return db.transaction(async (tx) => {
    const locked = await findVersion(tx, orgId, version.id, true);
    if (locked.status !== "draft") throw new TemplateStateError(TEMPLATE_NOT_DRAFT_MESSAGE);
    const archived = await archivedKeyIssues(tx, orgId, locked.familyId, locked.id, doc);
    if (archived.length > 0) throw new TemplateValidationError(archived);

    const existing = await loadContent(tx, orgId, [locked.id]);
    const counts = await applyDocument(
      tx,
      { organizationId: orgId, employeeId: grant.employeeId, now },
      locked.id,
      existing,
      doc,
    );
    await audit(tx, grant, "update", {
      versionId: locked.id,
      familyId: locked.familyId,
      versionNumber: locked.versionNumber,
      ...counts,
    });
    return counts;
  });
}

/**
 * Publiserer utkastet. Forrige publiserte versjon i familien blir utgått, i samme transaksjon.
 * To samtidige kall gir én vinner: oppdateringen krever `status = 'draft'`, og den andre får
 * `TemplateStateError`. Ingen fagkontroll ennå (A140), ingen hendelse (A145).
 */
export async function publishVersion(
  actor: Actor,
  organizationId: string,
  versionId: string,
  changeNote: string | null,
  now: Date = new Date(),
): Promise<{ versionId: string }> {
  const { grant, version } = await requireEditableVersion(actor, organizationId, versionId);
  const orgId = grant.organizationId;
  if (version.status !== "draft") throw new TemplateStateError(TEMPLATE_NOT_DRAFT_MESSAGE);
  const note = changeNoteSchema.safeParse(changeNote ?? null, { error: norwegianMessage });
  if (!note.success) {
    throw new TemplateValidationError(
      toTemplateIssues(note.error).map((issue) => ({ ...issue, path: "changeNote" })),
    );
  }

  return db.transaction(async (tx) => {
    const [published] = await tx
      .update(templateVersions)
      .set({
        status: "published",
        publishedBy: grant.employeeId,
        publishedAt: now,
        changeNote: note.data,
        updatedBy: grant.employeeId,
      })
      .where(
        and(
          eq(templateVersions.id, version.id),
          eq(templateVersions.organizationId, orgId),
          eq(templateVersions.status, "draft"),
          isNull(templateVersions.deletedAt),
        ),
      )
      .returning({ id: templateVersions.id, familyId: templateVersions.familyId });
    if (!published) {
      // Noen andre publiserte (eller slettet) versjonen samtidig.
      await findVersion(tx, orgId, version.id);
      throw new TemplateStateError(TEMPLATE_NOT_DRAFT_MESSAGE);
    }
    const retired = await tx
      .update(templateVersions)
      .set({ status: "retired", updatedBy: grant.employeeId })
      .where(
        and(
          eq(templateVersions.organizationId, orgId),
          eq(templateVersions.familyId, published.familyId),
          eq(templateVersions.status, "published"),
          ne(templateVersions.id, published.id),
        ),
      )
      .returning({ id: templateVersions.id });
    await audit(tx, grant, "publish", {
      versionId: published.id,
      familyId: published.familyId,
      versionNumber: version.versionNumber,
      retiredVersionId: retired[0]?.id ?? null,
    });
    return { versionId: published.id };
  });
}

// --- Testfabrikken ---------------------------------------------------------------------------

/**
 * Legger en malfamilie med én versjon og innhold rett inn i databasen, uten tilgangssjekk og uten
 * revisjonslogg. **Bare for `tests/factories.ts`.** Eksporteres ikke fra `index.ts`, slik at
 * ingen modul kan bruke den.
 */
export async function insertTemplateWithoutAccessCheck(
  organizationId: string,
  options: {
    name?: string;
    kind?: TemplateKind;
    status?: TemplateVersionStatus;
    versionNumber?: number;
    document?: TemplateDocumentInput;
    deletedAt?: Date | null;
    versionDeletedAt?: Date | null;
    familyId?: string;
    now?: Date;
  } = {},
): Promise<{ familyId: string; versionId: string }> {
  const now = options.now ?? new Date();
  const document = templateDocumentSchema.parse(options.document ?? {});
  const issues = checkDocumentKeys(document);
  if (issues.length > 0) throw new TemplateValidationError(issues);
  const status = options.status ?? "draft";
  const versionId = uuidv7();

  return db.transaction(async (tx) => {
    let familyId = options.familyId;
    if (!familyId) {
      familyId = uuidv7();
      await tx.insert(templateFamilies).values({
        id: familyId,
        organizationId,
        name: options.name ?? "Testmal",
        kind: options.kind ?? "system",
        deletedAt: options.deletedAt ?? null,
      });
    }
    await tx.insert(templateVersions).values({
      id: versionId,
      organizationId,
      familyId,
      versionNumber: options.versionNumber ?? 1,
      status,
      publishedAt: status === "draft" ? null : now,
      deletedAt: options.versionDeletedAt ?? null,
    });
    await applyDocument(
      tx,
      { organizationId, employeeId: null, now },
      versionId,
      EMPTY_CONTENT,
      document,
    );
    return { familyId, versionId };
  });
}
