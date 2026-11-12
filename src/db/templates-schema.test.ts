import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { checkpoints, templateFamilies, templateVersions } from "@/db/schema";
import {
  RESET_TABLES,
  createCheckpointRow,
  createDeviationQuestionRow,
  createOrganization,
  createOutcomeRow,
  createRuleConditionRow,
  createRuleRow,
  createRuleTestCaseRow,
  createStandardMeasureRow,
  createTemplateElementOptionRow,
  createTemplateElementRow,
  createTemplateFamilyRow,
  createTemplateSectionRow,
  createTemplateVersionRow,
  resetDatabase,
} from "../../tests/factories";
import { tenantTables } from "../../tests/tenant-tables";

/*
 * Databasen selv stopper maldata som peker inn i en annen organisasjon, TGIU som utfall, doble
 * aktive koder og to utkast i samme familie (docs/funksjoner/fase2a-malmotor-testplan.md avsnitt
 * 3). Direkte innsetting med radbyggerne i `tests/factories.ts`, utenom kjernen og Zod, så det er
 * skrankene i databasen som prøves. Feilkoden sjekkes, så en skrivefeil gir ikke falsk grønn test.
 *
 * Støtter hovedmål: KI først og reklamasjoner (en fast kode er unik i sitt område, og en mal kan
 * aldri peke inn i en annen organisasjon). Testdata er oppdiktet og uten fagtekst.
 */

beforeEach(resetDatabase);

const CHECK = "23514";
const FOREIGN_KEY = "23503";
const UNIQUE = "23505";
const DELETED_AT = new Date("2026-11-03T09:00:00Z");

/** Postgres-feilkoden, også når Drizzle har pakket feilen inn. */
function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

async function expectPgError(run: Promise<unknown>, code: string) {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, "databasen skulle avvist raden").not.toBeNull();
  expect(pgCode(error), `feilkode (fikk ${String(error)})`).toBe(code);
}

const TEMPLATE_TABLES = [
  "template_families",
  "template_versions",
  "template_sections",
  "template_elements",
  "template_element_options",
  "checkpoints",
  "deviation_questions",
  "outcomes",
  "standard_measures",
  "rules",
  "rule_conditions",
  "rule_test_cases",
] as const;

async function twoOrgs() {
  const orgA = await createOrganization("Organisasjon A");
  const orgB = await createOrganization("Organisasjon B");
  return { a: orgA.id, b: orgB.id };
}

// --- 3.1 Sammensatte fremmednøkler ---------------------------------------------------------------

type Orgs = { a: string; b: string };

/** Hver sak: en rad i B som peker på en forelder i A. */
const crossOrgCases: { name: string; insert: (orgs: Orgs) => Promise<unknown> }[] = [
  {
    name: "versjon → familie",
    insert: async ({ a, b }) => {
      const family = await createTemplateFamilyRow(a);
      return db
        .insert(templateVersions)
        .values({ organizationId: b, familyId: family.id, versionNumber: 1 });
    },
  },
  {
    name: "seksjon → versjon",
    insert: async ({ a, b }) => {
      const version = await createTemplateVersionRow(a);
      return createTemplateSectionRow(b, { versionId: version.id });
    },
  },
  {
    name: "underseksjon → seksjon",
    insert: async ({ a, b }) => {
      const parent = await createTemplateSectionRow(a);
      const version = await createTemplateVersionRow(b);
      return createTemplateSectionRow(b, { versionId: version.id, parentSectionId: parent.id });
    },
  },
  {
    name: "felt → seksjon",
    insert: async ({ a, b }) => {
      const section = await createTemplateSectionRow(a);
      const version = await createTemplateVersionRow(b);
      return createTemplateElementRow(b, { sectionId: section.id, versionId: version.id });
    },
  },
  {
    name: "valg → felt",
    insert: async ({ a, b }) => {
      const element = await createTemplateElementRow(a, { fieldType: "choice" });
      return createTemplateElementOptionRow(b, { elementId: element.id });
    },
  },
  {
    name: "kontrollpunkt → seksjon",
    insert: async ({ a, b }) => {
      const section = await createTemplateSectionRow(a);
      const version = await createTemplateVersionRow(b);
      return createCheckpointRow(b, { sectionId: section.id, versionId: version.id });
    },
  },
  {
    name: "spørsmål → kontrollpunkt",
    insert: async ({ a, b }) => {
      const checkpoint = await createCheckpointRow(a);
      return createDeviationQuestionRow(b, { checkpointId: checkpoint.id });
    },
  },
  {
    name: "utfall → spørsmål",
    insert: async ({ a, b }) => {
      const question = await createDeviationQuestionRow(a);
      return createOutcomeRow(b, { deviationQuestionId: question.id });
    },
  },
  {
    name: "tiltak → utfall",
    insert: async ({ a, b }) => {
      const outcome = await createOutcomeRow(a);
      return createStandardMeasureRow(b, { outcomeId: outcome.id });
    },
  },
  {
    name: "regel → versjon",
    insert: async ({ a, b }) => {
      const version = await createTemplateVersionRow(a);
      return createRuleRow(b, { versionId: version.id });
    },
  },
  {
    name: "betingelse → regel",
    insert: async ({ a, b }) => {
      const rule = await createRuleRow(a);
      return createRuleConditionRow(b, { ruleId: rule.id });
    },
  },
  {
    name: "testtilfelle → regel",
    insert: async ({ a, b }) => {
      const rule = await createRuleRow(a);
      return createRuleTestCaseRow(b, { ruleId: rule.id });
    },
  },
];

describe("3.1 sammensatte fremmednøkler", () => {
  it.each(crossOrgCases)("$name: rad i B som peker på forelder i A avvises", async ({ insert }) => {
    const orgs = await twoOrgs();
    await expectPgError(insert(orgs), FOREIGN_KEY);
  });

  it("samme kjede i én organisasjon godtas (kontroll av radbyggerne)", async () => {
    const { a } = await twoOrgs();
    const measure = await createStandardMeasureRow(a);
    const condition = await createRuleConditionRow(a);
    const testCase = await createRuleTestCaseRow(a);
    const option = await createTemplateElementOptionRow(a);
    for (const row of [measure, condition, testCase, option]) expect(row.organizationId).toBe(a);
  });
});

// --- 3.2 CHECK på utfall --------------------------------------------------------------------------

describe("3.2 CHECK på utfall", () => {
  it("direkte innsetting med tgiu avvises", async () => {
    const { a } = await twoOrgs();
    await expectPgError(createOutcomeRow(a, { kind: "tgiu" }), CHECK);
  });

  it("ukjent utfall avvises, tg2 og tg3 godtas", async () => {
    const { a } = await twoOrgs();
    await expectPgError(createOutcomeRow(a, { kind: "tg9" }), CHECK);
    await expect(createOutcomeRow(a, { kind: "tg2" })).resolves.toBeDefined();
    await expect(createOutcomeRow(a, { kind: "tg3" })).resolves.toBeDefined();
  });

  it("kode med feil format avvises også i databasen", async () => {
    const { a } = await twoOrgs();
    await expectPgError(createCheckpointRow(a, { key: "Med-Store" }), CHECK);
    await expectPgError(createTemplateSectionRow(a, { key: ".ledende" }), CHECK);
  });
});

// --- 3.3 Delvis unik indeks på kode ---------------------------------------------------------------

describe("3.3 delvis unik indeks på kode", () => {
  it("to aktive kontrollpunkter med samme kode i samme versjon avvises", async () => {
    const { a } = await twoOrgs();
    const section = await createTemplateSectionRow(a);
    await createCheckpointRow(a, { sectionId: section.id, key: "cp.one" });
    await expectPgError(createCheckpointRow(a, { sectionId: section.id, key: "cp.one" }), UNIQUE);
  });

  it("samme kode når den ene er slettet mykt godtas", async () => {
    const { a } = await twoOrgs();
    const section = await createTemplateSectionRow(a);
    await createCheckpointRow(a, { sectionId: section.id, key: "cp.one", deletedAt: DELETED_AT });
    await expect(
      createCheckpointRow(a, { sectionId: section.id, key: "cp.one" }),
    ).resolves.toBeDefined();
  });

  it("samme kode i to versjoner godtas", async () => {
    const { a } = await twoOrgs();
    await createCheckpointRow(a, { key: "cp.one" });
    await expect(createCheckpointRow(a, { key: "cp.one" })).resolves.toBeDefined();
    const rows = await db.select().from(checkpoints).where(eq(checkpoints.key, "cp.one"));
    expect(new Set(rows.map((r) => r.versionId)).size).toBe(2);
  });

  it.each([
    {
      name: "seksjoner i samme versjon",
      setup: async (org: string) => (await createTemplateVersionRow(org)).id,
      insert: (org: string, versionId: string) =>
        createTemplateSectionRow(org, { versionId, key: "sec.alpha" }),
    },
    {
      name: "felt i samme versjon",
      setup: async (org: string) => (await createTemplateSectionRow(org)).id,
      insert: (org: string, sectionId: string) =>
        createTemplateElementRow(org, { sectionId, key: "el.size" }),
    },
    {
      name: "regler i samme versjon",
      setup: async (org: string) => (await createTemplateVersionRow(org)).id,
      insert: (org: string, versionId: string) =>
        createRuleRow(org, { versionId, key: "rule.one" }),
    },
  ])("to aktive $name med samme kode avvises", async ({ setup, insert }) => {
    const { a } = await twoOrgs();
    const parent = await setup(a);
    await insert(a, parent);
    await expectPgError(insert(a, parent), UNIQUE);
  });

  it.each([
    {
      name: "valg under felt",
      parent: (org: string) => createTemplateElementRow(org, { fieldType: "choice" }),
      insert: (org: string, parentId: string) =>
        createTemplateElementOptionRow(org, { elementId: parentId, key: "opt.small" }),
    },
    {
      name: "spørsmål under kontrollpunkt",
      parent: (org: string) => createCheckpointRow(org),
      insert: (org: string, parentId: string) =>
        createDeviationQuestionRow(org, { checkpointId: parentId, key: "dq.first" }),
    },
    {
      name: "utfall under spørsmål",
      parent: (org: string) => createDeviationQuestionRow(org),
      insert: (org: string, parentId: string) =>
        createOutcomeRow(org, { deviationQuestionId: parentId, key: "out.a" }),
    },
  ])("$name: samme kode under to foreldre godtas, under samme avvises", async (c) => {
    const { a } = await twoOrgs();
    const first = await c.parent(a);
    const second = await c.parent(a);
    await c.insert(a, first.id);
    await expect(c.insert(a, second.id)).resolves.toBeDefined();
    await expectPgError(c.insert(a, first.id), UNIQUE);
  });
});

// --- 3.4 Ett utkast per familie -------------------------------------------------------------------

describe("3.4 ett utkast per familie", () => {
  it("to utkast i samme familie avvises", async () => {
    const { a } = await twoOrgs();
    const family = await createTemplateFamilyRow(a);
    await createTemplateVersionRow(a, { familyId: family.id, status: "draft" });
    await expectPgError(
      createTemplateVersionRow(a, { familyId: family.id, status: "draft" }),
      UNIQUE,
    );
  });

  it("utkast i to familier godtas, og utkast ved siden av publisert godtas", async () => {
    const { a } = await twoOrgs();
    const first = await createTemplateFamilyRow(a);
    const second = await createTemplateFamilyRow(a);
    await createTemplateVersionRow(a, { familyId: first.id, status: "published" });
    await createTemplateVersionRow(a, { familyId: first.id, status: "draft" });
    await expect(
      createTemplateVersionRow(a, { familyId: second.id, status: "draft" }),
    ).resolves.toBeDefined();
  });

  it("samme versjonsnummer to ganger i en familie avvises", async () => {
    const { a } = await twoOrgs();
    const family = await createTemplateFamilyRow(a);
    await createTemplateVersionRow(a, {
      familyId: family.id,
      status: "published",
      versionNumber: 1,
    });
    await expectPgError(
      createTemplateVersionRow(a, { familyId: family.id, status: "draft", versionNumber: 1 }),
      UNIQUE,
    );
  });
});

// --- 3.5 Standardverdier --------------------------------------------------------------------------

describe("3.5 standardverdier", () => {
  it("versjonen: status draft, deleted_at null, created_at og updated_at satt", async () => {
    const { a } = await twoOrgs();
    const family = await createTemplateFamilyRow(a);
    const [row] = await db
      .insert(templateVersions)
      .values({ organizationId: a, familyId: family.id, versionNumber: 1 })
      .returning();
    expect(row!.status).toBe("draft");
    expect(row!.deletedAt).toBeNull();
    expect(row!.createdAt).toBeInstanceOf(Date);
    expect(row!.updatedAt).toBeInstanceOf(Date);
    expect(row!.publishedAt).toBeNull();
  });

  it.each(TEMPLATE_TABLES)("%s har deleted_at null og tidspunktene satt", async (table) => {
    const { a } = await twoOrgs();
    const builders: Record<(typeof TEMPLATE_TABLES)[number], () => Promise<{ id: string }>> = {
      template_families: () => createTemplateFamilyRow(a),
      template_versions: () => createTemplateVersionRow(a),
      template_sections: () => createTemplateSectionRow(a),
      template_elements: () => createTemplateElementRow(a),
      template_element_options: () => createTemplateElementOptionRow(a),
      checkpoints: () => createCheckpointRow(a),
      deviation_questions: () => createDeviationQuestionRow(a),
      outcomes: () => createOutcomeRow(a),
      standard_measures: () => createStandardMeasureRow(a),
      rules: () => createRuleRow(a),
      rule_conditions: () => createRuleConditionRow(a),
      rule_test_cases: () => createRuleTestCaseRow(a),
    };
    const { id } = await builders[table]();
    const rows = await db.execute<{
      organization_id: string;
      deleted_at: unknown;
      created_at: unknown;
      updated_at: unknown;
    }>(
      sql`select organization_id, deleted_at, created_at, updated_at from ${sql.identifier(table)} where id = ${id}`,
    );
    const [row] = rows;
    expect(row!.organization_id).toBe(a);
    expect(row!.deleted_at).toBeNull();
    expect(row!.created_at).not.toBeNull();
    expect(row!.updated_at).not.toBeNull();
  });

  it("familien får kind fra listen, ukjent kind avvises", async () => {
    const { a } = await twoOrgs();
    await expectPgError(
      db.insert(templateFamilies).values({ organizationId: a, name: "Testmal", kind: "annet" }),
      CHECK,
    );
  });
});

// --- 3.6 Tenant-tabellene og RESET_TABLES ----------------------------------------------------------

describe("3.6 tenant-tabellene", () => {
  it.each(TEMPLATE_TABLES)(
    "%s står i tests/tenant-tables.ts med testfilen for malmotoren",
    (table) => {
      const entry = tenantTables.find((t) => t.table === table);
      expect(entry, `${table} mangler i tests/tenant-tables.ts`).toBeDefined();
      expect(entry!.testFile).toBe("src/core/templates/templates.test.ts");
    },
  );

  it.each(TEMPLATE_TABLES)("%s står i RESET_TABLES", (table) => {
    expect(RESET_TABLES as readonly string[]).toContain(table);
  });

  it("barn står før foreldre i RESET_TABLES", () => {
    const order = (t: string) => (RESET_TABLES as readonly string[]).indexOf(t);
    const parentOf: [string, string][] = [
      ["template_versions", "template_families"],
      ["template_sections", "template_versions"],
      ["template_elements", "template_sections"],
      ["template_element_options", "template_elements"],
      ["checkpoints", "template_sections"],
      ["template_elements", "checkpoints"],
      ["deviation_questions", "checkpoints"],
      ["outcomes", "deviation_questions"],
      ["standard_measures", "outcomes"],
      ["rules", "template_versions"],
      ["rules", "outcomes"],
      ["rule_conditions", "rules"],
      ["rule_test_cases", "rules"],
      ["rule_test_cases", "outcomes"],
    ];
    for (const [child, parent] of parentOf) {
      expect(order(child), `${child} før ${parent}`).toBeLessThan(order(parent));
    }
  });
});

// --- 3.7 Migreringen ------------------------------------------------------------------------------

describe("3.7 migreringen", () => {
  it("0024_malmotor finnes og er den eneste med nummer 0024", () => {
    const dir = path.join(process.cwd(), "src/db/migrations");
    const files = readdirSync(dir).filter((name) => name.startsWith("0024_"));
    expect(files).toEqual(["0024_malmotor.sql"]);
  });
});

// --- Reglene badet trenger: migrering 0030_regler-bad (testplan 6.1–6.5) --------------------------

const NOT_NULL = "23502";
type ConditionOverrides = Parameters<typeof createRuleConditionRow>[1];

const RULE_CONDITION_KEY_COLUMNS = [
  { column: "threshold_key", field: "thresholdKey" },
  { column: "age_year_element_key", field: "ageYearElementKey" },
  { column: "age_fallback_year_element_key", field: "ageFallbackYearElementKey" },
  { column: "age_source_element_key", field: "ageSourceElementKey" },
  { column: "documentation_element_key", field: "documentationElementKey" },
  { column: "material_element_key", field: "materialElementKey" },
  { column: "unit_element_key", field: "unitElementKey" },
] as const;

const MIGRATIONS_DIR = path.join(process.cwd(), "src/db/migrations");

describe("regler bad: migrering 0030", () => {
  it.each(RULE_CONDITION_KEY_COLUMNS)(
    "6.1 0030_columns_format_check: $column godtar gyldig kode og null, avviser ugyldig kode",
    async ({ column, field }) => {
      const org = await createOrganization();
      const valid = await createRuleConditionRow(org.id, {
        [field]: "wet_room.membrane_year",
      } as ConditionOverrides);
      expect((valid as Record<string, unknown>)[field]).toBe("wet_room.membrane_year");
      const empty = await createRuleConditionRow(org.id, { [field]: null } as ConditionOverrides);
      expect((empty as Record<string, unknown>)[field]).toBeNull();
      const plain = await createRuleConditionRow(org.id, {
        [field]: "weight_percent_15",
      } as ConditionOverrides);
      expect((plain as Record<string, unknown>)[field]).toBe("weight_percent_15");
      for (const bad of ["Ugyldig Kode", "", ".start", "slutt.", "to..punkt", "ÆØÅ"]) {
        await expectPgError(
          createRuleConditionRow(org.id, { [field]: bad } as ConditionOverrides),
          CHECK,
        );
      }
      // Kolonnen er tekst og kan være tom
      const [info] = await db.execute<{ data_type: string; is_nullable: string }>(sql`
        select data_type, is_nullable from information_schema.columns
        where table_name = 'rule_conditions' and column_name = ${column}`);
      expect(info).toMatchObject({ data_type: "text", is_nullable: "YES" });
    },
  );

  it("6.2 expected_state_check: NOT NULL og bare de tre tilstandene", async () => {
    const org = await createOrganization();
    for (const state of ["triggered", "not_triggered", "not_evaluated"] as const) {
      const row = await createRuleTestCaseRow(org.id, { expectedState: state });
      expect(row.expectedState).toBe(state);
    }
    await expectPgError(
      createRuleTestCaseRow(org.id, { expectedState: "maybe" as "triggered" }),
      CHECK,
    );
    await expectPgError(
      createRuleTestCaseRow(org.id, { expectedState: "TRIGGERED" as "triggered" }),
      CHECK,
    );
    const rule = await createRuleRow(org.id);
    await expectPgError(
      db.execute(sql`insert into rule_test_cases (organization_id, rule_id, name, input)
        values (${org.id}, ${rule.id}, 'Uten tilstand', '{}'::jsonb)`),
      NOT_NULL,
    );
    await expectPgError(
      db.execute(sql`insert into rule_test_cases (organization_id, rule_id, name, input, expected_state)
        values (${org.id}, ${rule.id}, 'Tom tilstand', '{}'::jsonb, null)`),
      NOT_NULL,
    );
    const columns = await db.execute<{ column_name: string; is_nullable: string }>(sql`
      select column_name, is_nullable from information_schema.columns
      where table_name = 'rule_test_cases'`);
    const names = columns.map((c) => c.column_name);
    expect(names).not.toContain("expect_triggered");
    expect(names).toEqual(expect.arrayContaining(["expected_state", "inspection_year"]));
    expect(columns.find((c) => c.column_name === "expected_state")!.is_nullable).toBe("NO");
  });

  it("6.3 inspection_year_check: tomt godtas, rimelig år godtas, urimelig år avvises", async () => {
    const org = await createOrganization();
    expect((await createRuleTestCaseRow(org.id)).inspectionYear).toBeNull();
    for (const year of [1900, 2026, 2200]) {
      expect((await createRuleTestCaseRow(org.id, { inspectionYear: year })).inspectionYear).toBe(
        year,
      );
    }
    for (const year of [1700, 1899, 2201, 3000, -2026, 0]) {
      await expectPgError(createRuleTestCaseRow(org.id, { inspectionYear: year }), CHECK);
    }
  });

  it("6.4 migration_keeps_meaning: expect_triggered true og false blir triggered og not_triggered", async () => {
    const migration = readFileSync(path.join(MIGRATIONS_DIR, "0030_regler-bad.sql"), "utf8");
    // Setningene i migreringen som gjelder testsakene, kjørt på en kopi av tabellen slik den var
    // etter 0028 (bare kolonnene migreringen leser), i et eget skjema.
    const statements = migration
      .split("--> statement-breakpoint")
      .map((part) =>
        part
          .split("\n")
          .filter((line) => !line.trim().startsWith("--"))
          .join("\n")
          .trim(),
      )
      .filter((part) => /^(ALTER TABLE|UPDATE)\s+"rule_test_cases"/i.test(part));
    expect(statements.length).toBeGreaterThanOrEqual(4);
    expect(statements.some((s) => /^UPDATE/i.test(s))).toBe(true);

    const schema = `test_mig_0030_${Date.now()}`;
    try {
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql.raw(`create schema "${schema}"`));
        await tx.execute(
          sql.raw(`create table "${schema}"."rule_test_cases" (
            id serial primary key,
            name text not null,
            expect_triggered boolean not null,
            deleted_at timestamptz
          )`),
        );
        await tx.execute(
          sql.raw(`insert into "${schema}"."rule_test_cases" (name, expect_triggered, deleted_at)
            values ('sann', true, null), ('usann', false, null),
                   ('sann slettet', true, now()), ('usann slettet', false, now())`),
        );
        await tx.execute(sql.raw(`set local search_path to "${schema}"`));
        for (const statement of statements) await tx.execute(sql.raw(statement));
        const rows = await tx.execute<{ name: string; expected_state: string }>(
          sql.raw(`select name, expected_state from "${schema}"."rule_test_cases" order by id`),
        );
        const columns = await tx.execute<{ column_name: string }>(
          sql`select column_name from information_schema.columns
              where table_schema = ${schema} and table_name = 'rule_test_cases'`,
        );
        return { rows: [...rows], columns: columns.map((c) => c.column_name) };
      });
      expect(result.rows).toEqual([
        { name: "sann", expected_state: "triggered" },
        { name: "usann", expected_state: "not_triggered" },
        { name: "sann slettet", expected_state: "triggered" },
        { name: "usann slettet", expected_state: "not_triggered" },
      ]);
      expect(result.columns).not.toContain("expect_triggered");
      expect(result.columns).toEqual(expect.arrayContaining(["expected_state", "inspection_year"]));
    } finally {
      await db.execute(sql.raw(`drop schema if exists "${schema}" cascade`));
    }
  });

  it("6.5 migration_number_free: 0030_regler-bad er den eneste med nummer 0030", () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((name) => name.startsWith("0030_"));
    expect(files).toEqual(["0030_regler-bad.sql"]);
    const snapshots = readdirSync(path.join(MIGRATIONS_DIR, "meta")).filter((name) =>
      name.startsWith("0030_"),
    );
    expect(snapshots).toEqual(["0030_snapshot.json"]);
  });

  it("myk sletting: en testsak med de nye kolonnene kan slettes mykt og står igjen", async () => {
    const org = await createOrganization();
    const row = await createRuleTestCaseRow(org.id, {
      expectedState: "not_evaluated",
      inspectionYear: 2026,
      deletedAt: DELETED_AT,
    });
    const [found] = await db.execute<{ expected_state: string; deleted_at: Date | null }>(
      sql`select expected_state, deleted_at from rule_test_cases where id = ${row.id}`,
    );
    expect(found!.expected_state).toBe("not_evaluated");
    expect(found!.deleted_at).not.toBeNull();
  });
});
