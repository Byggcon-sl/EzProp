import { readdirSync } from "node:fs";
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
