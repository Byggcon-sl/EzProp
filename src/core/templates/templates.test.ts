import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, type Actor } from "@/core/access";
import { db } from "@/db/client";
import {
  auditLog,
  employees,
  events,
  organizations,
  templateFamilies,
  templateVersions,
  type EmployeeRole,
} from "@/db/schema";
import {
  createEmployee,
  createOrganization,
  createTemplate,
  createUser,
  grantPermission,
  resetDatabase,
} from "../../../tests/factories";
import {
  TEMPLATE_DOCUMENT_ROWS,
  TEMPLATE_DOCUMENT_ROW_COUNT,
  buildTemplateDocument,
} from "../../../tests/template-document";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import {
  TEMPLATE_ISSUE_RULES,
  TemplateNotFoundError,
  TemplateStateError,
  TemplateValidationError,
  createDraftVersion,
  createTemplateFamily,
  getTemplateVersion,
  listTemplateFamilies,
  parseTemplateDocument,
  publishVersion,
  saveDraftContent,
  type TemplateIssue,
  type TemplateIssueRule,
} from "./index";

/*
 * Malmotoren: kjernen i src/core/templates (docs/funksjoner/fase2a-malmotor-testplan.md avsnitt 4).
 *
 * Alle ansatte leser malen. Å endre krever `template.edit_structure` (admin alltid, ellers som
 * enkeltrettighet). En mal i en annen organisasjon, en slettet mal og en ukjent id gir
 * `TemplateNotFoundError` («Fant ikke malen.»).
 *
 * Godkjennes ikke uten: 4.2 (seks expectTenantIsolation), 4.3 (fremmed id), 4.1.2 (alle fire
 * endringstjenestene uten rettighet), 4.1.5 (admin stenges aldri ute, regel 11), 4.5.4 og 4.5.5
 * (myk sletting, aldri hard sletting) og 4.5.9 (arkivert kode tas ikke i bruk igjen, regel 6).
 *
 * Støtter hovedmål: KI først og reklamasjoner (faste koder som aldri endres eller gjenbrukes,
 * publiserte versjoner som aldri endres, og systemmalen låst for alle uten maltilgang). Tid:
 * samme dokument lagret to ganger gir 0/0/0, som regneark-importen bygger på.
 *
 * Testdata er oppdiktet og uten fagtekst. Loggtestene bruker merker som ikke kan forekomme tilfeldig.
 */

beforeEach(resetDatabase);
afterEach(() => {
  vi.restoreAllMocks();
});

const NOT_FOUND_MESSAGE = "Fant ikke malen.";
const DRAFT_EXISTS_MESSAGE = "Det finnes allerede et utkast av denne malen.";
const NOT_DRAFT_MESSAGE = "Malversjonen er publisert og kan ikke endres.";

const MARK_TITLE = "MERKE-TITTEL-M4K";
const MARK_LABEL = "MERKE-LEDETEKST-M4K";
const MARK_DEVIATION = "MERKE-AVVIK-M4K";
const MARK_MEASURE = "MERKE-TILTAK-M4K";
const MARK_NAME = "MERKE-NAVN-M4K";
const MARK_MESSAGE = "MERKE-MELDING-M4K";
const MARKS = [MARK_TITLE, MARK_LABEL, MARK_DEVIATION, MARK_MEASURE, MARK_NAME, MARK_MESSAGE];

const CONTENT_TABLES = [
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
type ContentTable = (typeof CONTENT_TABLES)[number];

const ALL_TEMPLATE_TABLES = ["template_families", "template_versions", ...CONTENT_TABLES] as const;

type Doc = ReturnType<typeof buildTemplateDocument>;

// --- Hjelpere ------------------------------------------------------------------------------------

async function person(organizationId: string, roles: EmployeeRole[]) {
  const actor = await createUser();
  const employee = await createEmployee(actor, organizationId, roles);
  return { actor, employee };
}

async function orgWithAdmin(name = "Testfirma takst") {
  const org = await createOrganization(name);
  const { actor: admin, employee: adminEmployee } = await person(org.id, ["admin"]);
  return { org, admin, adminEmployee };
}

async function setInspectorsEditAll(organizationId: string, value: boolean) {
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": value } })
    .where(eq(organizations.id, organizationId));
}

/** Antall rader (også slettede) i alle tolv tabellene, i revisjonsloggen og i hendelsene. */
async function rowCounts(): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const table of [...ALL_TEMPLATE_TABLES, "audit_log", "events"]) {
    const [row] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(table)}`,
    );
    result[table] = row!.n;
  }
  return result;
}

/** Alle rader i alle tolv tabellene (alle kolonner), sortert på id. Til «ingenting endret». */
async function snapshot(): Promise<Record<string, unknown[]>> {
  const result: Record<string, unknown[]> = {};
  for (const table of ALL_TEMPLATE_TABLES) {
    result[table] = [
      ...(await db.execute(sql`select * from ${sql.identifier(table)} order by id`)),
    ];
  }
  return result;
}

/** SQL som gir radene i en innholdstabell som hører til versjonen (via foreldrene). */
function versionRowsSql(table: ContentTable, versionId: string) {
  switch (table) {
    case "template_sections":
    case "template_elements":
    case "checkpoints":
    case "rules":
      return sql`select t.* from ${sql.identifier(table)} t where t.version_id = ${versionId}`;
    case "template_element_options":
      return sql`select t.* from template_element_options t
        join template_elements p on p.id = t.element_id where p.version_id = ${versionId}`;
    case "deviation_questions":
      return sql`select t.* from deviation_questions t
        join checkpoints p on p.id = t.checkpoint_id where p.version_id = ${versionId}`;
    case "outcomes":
      return sql`select t.* from outcomes t
        join deviation_questions q on q.id = t.deviation_question_id
        join checkpoints p on p.id = q.checkpoint_id where p.version_id = ${versionId}`;
    case "standard_measures":
      return sql`select t.* from standard_measures t
        join outcomes o on o.id = t.outcome_id
        join deviation_questions q on q.id = o.deviation_question_id
        join checkpoints p on p.id = q.checkpoint_id where p.version_id = ${versionId}`;
    case "rule_conditions":
    case "rule_test_cases":
      return sql`select t.* from ${sql.identifier(table)} t
        join rules p on p.id = t.rule_id where p.version_id = ${versionId}`;
  }
}

type DbRow = Record<string, unknown> & {
  id: string;
  organization_id: string;
  deleted_at: unknown;
  key?: string;
};

/** Radene (også slettede) per innholdstabell i versjonen. */
async function versionRows(versionId: string): Promise<Record<ContentTable, DbRow[]>> {
  const result = {} as Record<ContentTable, DbRow[]>;
  for (const table of CONTENT_TABLES) {
    result[table] = [...(await db.execute<DbRow>(versionRowsSql(table, versionId)))].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
  }
  return result;
}

function activeCounts(rows: Record<ContentTable, DbRow[]>): Record<ContentTable, number> {
  const result = {} as Record<ContentTable, number>;
  for (const table of CONTENT_TABLES) {
    result[table] = rows[table].filter((r) => r.deleted_at === null).length;
  }
  return result;
}

async function versionRow(versionId: string) {
  const [row] = await db.select().from(templateVersions).where(eq(templateVersions.id, versionId));
  if (!row) throw new Error("fant ikke versjonen");
  return row;
}

async function versionsInFamily(familyId: string) {
  return db.select().from(templateVersions).where(eq(templateVersions.familyId, familyId));
}

/** Regelkodene som er sett i avviste kall i denne filen (til dekningstesten nederst). */
const seenRules = new Set<TemplateIssueRule>();

async function validationIssues(run: Promise<unknown>): Promise<TemplateIssue[]> {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, "skulle vært avvist med TemplateValidationError").toBeInstanceOf(
    TemplateValidationError,
  );
  const issues = (error as TemplateValidationError).issues;
  for (const issue of issues) seenRules.add(issue.rule);
  return issues;
}

async function expectIssue(run: Promise<unknown>, rule: TemplateIssueRule, pathPrefix?: string) {
  const issues = await validationIssues(run);
  const match = issues.find(
    (issue) =>
      issue.rule === rule && (pathPrefix === undefined || issue.path.startsWith(pathPrefix)),
  );
  expect(
    match,
    `fant ikke ${rule} på ${pathPrefix ?? "(alle)"} i ${JSON.stringify(issues)}`,
  ).toBeDefined();
  for (const issue of issues) {
    expect(typeof issue.message).toBe("string");
    expect(issue.message.length).toBeGreaterThan(0);
  }
  return issues;
}

/** Et utkast med admin, klart til å lagre innhold i. */
async function draftSetup() {
  const { org, admin, adminEmployee } = await orgWithAdmin();
  const { familyId, versionId } = await createTemplate(org.id);
  return { org, admin, adminEmployee, familyId, versionId };
}

/** Familie med publisert v1 (med dokumentet) via tjenestene, klar for nytt utkast. */
async function publishedSetup(document: Doc = buildTemplateDocument()) {
  const { org, admin, adminEmployee } = await orgWithAdmin();
  const { familyId, versionId } = await createTemplateFamily(admin, org.id, { name: "Testmal" });
  await saveDraftContent(admin, org.id, versionId, document);
  await publishVersion(admin, org.id, versionId, "Første versjon");
  return { org, admin, adminEmployee, familyId, v1: versionId };
}

/** Dokumentet uten kontrollpunktet `cp.one` og alt som henger på det. */
function withoutCheckpoint(doc: Doc = buildTemplateDocument()): Doc {
  doc.checkpoints = [];
  doc.deviation_questions = [];
  doc.outcomes = [];
  doc.standard_measures = [];
  doc.elements[0]!.checkpoint_key = null;
  doc.rules = doc.rules.filter((r) => r.key !== "rule.suggest");
  return doc;
}

/** JSON med sorterte nøkler, så rekkefølgen på feltene ikke betyr noe. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Hver liste i dokumentet som sortert liste av rader, så rekkefølgen på radene ikke betyr noe. */
function sortedLists(document: unknown) {
  const doc = document as Record<string, unknown[]>;
  const result: Record<string, string[]> = {};
  for (const [list, items] of Object.entries(doc)) {
    result[list] = items.map(canonical).sort();
  }
  return result;
}

function parsed(doc: Doc) {
  const result = parseTemplateDocument(doc);
  if (!result.success) throw new Error(`ugyldig testdokument: ${JSON.stringify(result.issues)}`);
  return result.document;
}

// ---------------------------------------------------------------------------------------------
// 4.1 Tilgang per rolle
// ---------------------------------------------------------------------------------------------

describe("4.1 tilgang per rolle", () => {
  const roleCases: { name: string; roles: EmployeeRole[]; grant: boolean; canEdit: boolean }[] = [
    { name: "takstmann", roles: ["inspector"], grant: false, canEdit: false },
    { name: "kontor", roles: ["office"], grant: false, canEdit: false },
    { name: "leder", roles: ["manager"], grant: false, canEdit: false },
    { name: "leder med enkeltrettighet", roles: ["manager"], grant: true, canEdit: true },
    { name: "admin uten enkeltrettigheter", roles: ["admin"], grant: false, canEdit: true },
  ];

  it.each(roleCases)(
    "4.1.1 $name: leser malen, endrer = $canEdit",
    async ({ roles, grant, canEdit }) => {
      const { org } = await orgWithAdmin();
      const { familyId, versionId } = await createTemplate(org.id);
      const { actor, employee } = await person(org.id, roles);
      if (grant) await grantPermission(employee, "template.edit_structure");

      const version = await getTemplateVersion(actor, org.id, versionId);
      expect(version.id).toBe(versionId);
      expect(version.familyId).toBe(familyId);

      const before = await rowCounts();
      const save = saveDraftContent(actor, org.id, versionId, buildTemplateDocument());
      if (canEdit) {
        await expect(save).resolves.toEqual({
          added: TEMPLATE_DOCUMENT_ROW_COUNT,
          changed: 0,
          removed: 0,
        });
      } else {
        await expect(save).rejects.toThrow(AccessDeniedError);
        expect(await rowCounts()).toEqual(before);
      }
    },
  );

  it("4.1.1b takstmann med enkeltrettighet kan endre", async () => {
    const { org } = await orgWithAdmin();
    const { versionId } = await createTemplate(org.id);
    const { actor, employee } = await person(org.id, ["inspector"]);
    await grantPermission(employee, "template.edit_structure");
    await expect(
      saveDraftContent(actor, org.id, versionId, buildTemplateDocument()),
    ).resolves.toMatchObject({ added: TEMPLATE_DOCUMENT_ROW_COUNT });
  });

  it("4.1.2 takstmann uten rettighet får nei på alle fire endringstjenestene, ingen rader endret", async () => {
    const { org } = await orgWithAdmin();
    const draft = await createTemplate(org.id);
    const published = await createTemplate(org.id, {
      status: "published",
      document: buildTemplateDocument(),
    });
    const { actor } = await person(org.id, ["inspector"]);
    const before = await rowCounts();
    const beforeRows = await snapshot();

    await expect(createTemplateFamily(actor, org.id, { name: "Ny mal" })).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(createDraftVersion(actor, org.id, published.familyId)).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(
      saveDraftContent(actor, org.id, draft.versionId, buildTemplateDocument()),
    ).rejects.toThrow(AccessDeniedError);
    await expect(publishVersion(actor, org.id, draft.versionId, null)).rejects.toThrow(
      AccessDeniedError,
    );

    expect(await rowCounts()).toEqual(before);
    expect(await snapshot()).toEqual(beforeRows);
  });

  it("4.1.3 access.inspectors_edit_all på gir ikke maltilgang", async () => {
    const { org } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, true);
    const { versionId } = await createTemplate(org.id);
    const { actor } = await person(org.id, ["inspector"]);
    const before = await rowCounts();

    await expect(
      saveDraftContent(actor, org.id, versionId, buildTemplateDocument()),
    ).rejects.toThrow(AccessDeniedError);
    await expect(publishVersion(actor, org.id, versionId, null)).rejects.toThrow(AccessDeniedError);
    expect(await rowCounts()).toEqual(before);
  });

  it("4.1.4 fjernet ansatt får nei på listTemplateFamilies og saveDraftContent", async () => {
    const { org } = await orgWithAdmin();
    const { versionId } = await createTemplate(org.id);
    const { actor, employee } = await person(org.id, ["admin"]);
    await db.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, employee.id));
    const before = await rowCounts();

    await expect(listTemplateFamilies(actor, org.id)).rejects.toThrow(AccessDeniedError);
    await expect(getTemplateVersion(actor, org.id, versionId)).rejects.toThrow(AccessDeniedError);
    await expect(
      saveDraftContent(actor, org.id, versionId, buildTemplateDocument()),
    ).rejects.toThrow(AccessDeniedError);
    expect(await rowCounts()).toEqual(before);
  });

  it("4.1.4b deaktivert ansatt med enkeltrettighet får nei", async () => {
    const { org } = await orgWithAdmin();
    const { versionId } = await createTemplate(org.id);
    const { actor, employee } = await person(org.id, ["manager"]);
    await grantPermission(employee, "template.edit_structure");
    await db
      .update(employees)
      .set({ deactivatedAt: new Date() })
      .where(eq(employees.id, employee.id));

    await expect(
      saveDraftContent(actor, org.id, versionId, buildTemplateDocument()),
    ).rejects.toThrow(AccessDeniedError);
  });

  it("4.1.5 admin stenges aldri ute (regel 11, skal aldri fjernes): lager, lagrer, publiserer og lager nytt utkast", async () => {
    const org = await createOrganization();
    await setInspectorsEditAll(org.id, false);
    const { actor: admin } = await person(org.id, ["admin"]);

    const { familyId, versionId } = await createTemplateFamily(admin, org.id, { name: "Testmal" });
    await expect(
      saveDraftContent(admin, org.id, versionId, buildTemplateDocument()),
    ).resolves.toEqual({ added: TEMPLATE_DOCUMENT_ROW_COUNT, changed: 0, removed: 0 });
    await expect(publishVersion(admin, org.id, versionId, null)).resolves.toEqual({ versionId });
    const next = await createDraftVersion(admin, org.id, familyId);
    expect(next.versionId).not.toBe(versionId);
    expect((await versionRow(next.versionId)).status).toBe("draft");
  });
});

// ---------------------------------------------------------------------------------------------
// 4.2 Tenant-isolasjon: ett expectTenantIsolation per tjeneste
// ---------------------------------------------------------------------------------------------

describe("4.2 tenant-isolasjon", () => {
  it("4.2.1 listTemplateFamilies viser aldri maler fra en annen organisasjon", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createTemplate(grantA.organizationId);
        const b = await createTemplate(grantB.organizationId);
        return { a: [a.familyId], b: [b.familyId] };
      },
      query: (actor, organizationId) => listTemplateFamilies(actor, organizationId),
      idOf: (row) => row.id,
    });
  });

  it("4.2.2 getTemplateVersion gir aldri en versjon fra en annen organisasjon", async () => {
    const versionFor = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createTemplate(grantA.organizationId, {
          document: buildTemplateDocument(),
        });
        const b = await createTemplate(grantB.organizationId, {
          document: buildTemplateDocument(),
        });
        versionFor.set(grantA.organizationId, a.versionId);
        versionFor.set(grantB.organizationId, b.versionId);
        return { a: [a.versionId], b: [b.versionId] };
      },
      query: async (actor, organizationId) => [
        await getTemplateVersion(
          actor,
          organizationId,
          versionFor.get(organizationId) ?? randomUUID(),
        ),
      ],
      idOf: (row) => row.id,
    });
  });

  it("4.2.3 createTemplateFamily lager bare i egen organisasjon", async () => {
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor, organizationId) => {
        const { familyId, versionId } = await createTemplateFamily(actor, organizationId, {
          name: "Testmal",
        });
        const [family] = await db
          .select()
          .from(templateFamilies)
          .where(eq(templateFamilies.id, familyId));
        const version = await versionRow(versionId);
        expect(version.organizationId).toBe(family!.organizationId);
        return [{ id: family!.organizationId }];
      },
      idOf: (row) => row.id,
    });

    const familiesB = await db
      .select()
      .from(templateFamilies)
      .where(eq(templateFamilies.organizationId, orgB));
    expect(familiesB).toHaveLength(1);
    const versionsB = await db
      .select()
      .from(templateVersions)
      .where(eq(templateVersions.organizationId, orgB));
    expect(versionsB).toHaveLength(1);
    expect(versionsB[0]!.familyId).toBe(familiesB[0]!.id);
    const auditB = await db
      .select()
      .from(auditLog)
      .where(sql`${auditLog.changes}->>'versionId' = ${versionsB[0]!.id}`);
    expect(auditB.length).toBeGreaterThan(0);
    for (const row of auditB) expect(row.organizationId).toBe(orgB);
    expect(await db.select().from(templateFamilies)).toHaveLength(2);
  });

  it("4.2.4 createDraftVersion lager bare utkast i egen organisasjon", async () => {
    const familyFor = new Map<string, string>();
    let orgB = "";
    let familyB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        const document = buildTemplateDocument();
        const a = await createTemplate(grantA.organizationId, { status: "published", document });
        const b = await createTemplate(grantB.organizationId, { status: "published", document });
        familyFor.set(grantA.organizationId, a.familyId);
        familyFor.set(grantB.organizationId, b.familyId);
        familyB = b.familyId;
        return { a: [a.familyId], b: [b.familyId] };
      },
      query: async (actor, organizationId) => {
        const { versionId } = await createDraftVersion(
          actor,
          organizationId,
          familyFor.get(organizationId) ?? randomUUID(),
        );
        return [{ id: (await versionRow(versionId)).familyId }];
      },
      idOf: (row) => row.id,
    });

    const drafts = (await versionsInFamily(familyB)).filter((v) => v.status === "draft");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.organizationId).toBe(orgB);
    const rows = await versionRows(drafts[0]!.id);
    expect(activeCounts(rows)).toEqual(TEMPLATE_DOCUMENT_ROWS);
    for (const table of CONTENT_TABLES) {
      for (const row of rows[table]) expect(row.organization_id).toBe(orgB);
    }
  });

  it("4.2.5 saveDraftContent lagrer bare i egen organisasjon", async () => {
    const versionFor = new Map<string, string>();
    let orgB = "";
    let versionB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        const a = await createTemplate(grantA.organizationId);
        const b = await createTemplate(grantB.organizationId);
        versionFor.set(grantA.organizationId, a.versionId);
        versionFor.set(grantB.organizationId, b.versionId);
        versionB = b.versionId;
        return { a: [a.versionId], b: [b.versionId] };
      },
      query: async (actor, organizationId) => {
        const versionId = versionFor.get(organizationId) ?? randomUUID();
        const counts = await saveDraftContent(
          actor,
          organizationId,
          versionId,
          buildTemplateDocument(),
        );
        return [{ id: versionId, ...counts }];
      },
      idOf: (row) => row.id,
    });

    const rows = await versionRows(versionB);
    expect(activeCounts(rows)).toEqual(TEMPLATE_DOCUMENT_ROWS);
    for (const table of CONTENT_TABLES) {
      for (const row of rows[table]) expect(row.organization_id).toBe(orgB);
    }
  });

  it("4.2.6 publishVersion publiserer bare i egen organisasjon", async () => {
    const versionFor = new Map<string, string>();
    let versionB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createTemplate(grantA.organizationId);
        const b = await createTemplate(grantB.organizationId);
        versionFor.set(grantA.organizationId, a.versionId);
        versionFor.set(grantB.organizationId, b.versionId);
        versionB = b.versionId;
        return { a: [a.versionId], b: [b.versionId] };
      },
      query: async (actor, organizationId) => [
        await publishVersion(
          actor,
          organizationId,
          versionFor.get(organizationId) ?? randomUUID(),
          null,
        ),
      ],
      idOf: (row) => row.versionId,
    });
    expect((await versionRow(versionB)).status).toBe("published");
  });
});

// ---------------------------------------------------------------------------------------------
// 4.3 Fremmed id med egen grant (IDOR)
// ---------------------------------------------------------------------------------------------

describe("4.3 fremmed id med egen grant", () => {
  /** Admin i A, og i B: en familie med publisert versjon og en med utkast. */
  async function foreignSetup() {
    const { org: orgA, admin } = await orgWithAdmin("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const published = await createTemplate(orgB.id, {
      status: "published",
      document: buildTemplateDocument(),
    });
    const draft = await createTemplate(orgB.id, { document: buildTemplateDocument() });
    return { orgA, orgB, admin, published, draft };
  }

  type Ids = Awaited<ReturnType<typeof foreignSetup>>;
  const services: {
    name: string;
    call: (actor: Actor, orgId: string, ids: Ids) => Promise<unknown>;
  }[] = [
    {
      name: "getTemplateVersion med Bs versionId",
      call: (actor, orgId, ids) => getTemplateVersion(actor, orgId, ids.published.versionId),
    },
    {
      name: "saveDraftContent med Bs versionId",
      call: (actor, orgId, ids) =>
        saveDraftContent(actor, orgId, ids.draft.versionId, buildTemplateDocument()),
    },
    {
      name: "publishVersion med Bs versionId",
      call: (actor, orgId, ids) => publishVersion(actor, orgId, ids.draft.versionId, null),
    },
    {
      name: "createDraftVersion med Bs familyId",
      call: (actor, orgId, ids) => createDraftVersion(actor, orgId, ids.published.familyId),
    },
  ];

  it.each(services)(
    "4.3.1 $name gir TemplateNotFoundError, B uendret, A uten nye rader",
    async ({ call }) => {
      const ids = await foreignSetup();
      const before = await snapshot();
      const countsBefore = await rowCounts();

      const error = await call(ids.admin, ids.orgA.id, ids).then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(TemplateNotFoundError);
      expect((error as Error).message).toBe(NOT_FOUND_MESSAGE);

      expect(await snapshot()).toEqual(before);
      expect(await rowCounts()).toEqual(countsBefore);
    },
  );

  const badIds = [
    { name: "tilfeldig uuid", id: () => randomUUID() },
    { name: "«ikke-en-id»", id: () => "ikke-en-id" },
  ];
  const idServices: {
    name: string;
    call: (actor: Actor, orgId: string, id: string) => Promise<unknown>;
  }[] = [
    { name: "getTemplateVersion", call: (a, o, id) => getTemplateVersion(a, o, id) },
    {
      name: "saveDraftContent",
      call: (a, o, id) => saveDraftContent(a, o, id, buildTemplateDocument()),
    },
    { name: "publishVersion", call: (a, o, id) => publishVersion(a, o, id, null) },
    { name: "createDraftVersion", call: (a, o, id) => createDraftVersion(a, o, id) },
  ];

  it.each(badIds.flatMap((bad) => idServices.map((service) => ({ ...service, bad }))))(
    "4.3.2 $name med $bad.name gir TemplateNotFoundError, aldri databasefeil",
    async ({ call, bad }) => {
      const { org, admin } = await orgWithAdmin();
      const error = await call(admin, org.id, bad.id()).then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(TemplateNotFoundError);
      expect((error as Error).message).toBe(NOT_FOUND_MESSAGE);
    },
  );

  const deletedCases = [
    {
      name: "slettet familie",
      options: { deletedAt: new Date("2026-11-03T09:00:00Z") },
    },
    {
      name: "slettet versjon",
      options: { versionDeletedAt: new Date("2026-11-03T09:00:00Z") },
    },
  ];

  it.each(
    deletedCases.flatMap((c) =>
      (["draft", "published"] as const).flatMap((status) =>
        idServices.map((service) => ({ ...service, deleted: c, status })),
      ),
    ),
  )(
    "4.3.3 $deleted.name ($status): $name gir TemplateNotFoundError",
    async ({ call, name, deleted, status }) => {
      const { org, admin } = await orgWithAdmin();
      const ids = await createTemplate(org.id, {
        status,
        document: buildTemplateDocument(),
        ...deleted.options,
      });
      const before = await snapshot();
      const id = name === "createDraftVersion" ? ids.familyId : ids.versionId;
      const error = await call(admin, org.id, id).then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(TemplateNotFoundError);
      expect((error as Error).message).toBe(NOT_FOUND_MESSAGE);
      expect(await snapshot()).toEqual(before);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// 4.4 Versjoner
// ---------------------------------------------------------------------------------------------

describe("4.4 versjoner", () => {
  it("4.4.1 createTemplateFamily lager familien og en tom utkastversjon 1", async () => {
    const { org, admin } = await orgWithAdmin();
    const { familyId, versionId } = await createTemplateFamily(admin, org.id, { name: "Testmal" });

    const [family] = await db
      .select()
      .from(templateFamilies)
      .where(eq(templateFamilies.id, familyId));
    expect(family).toMatchObject({ organizationId: org.id, kind: "system", deletedAt: null });
    const version = await versionRow(versionId);
    expect(version).toMatchObject({
      familyId,
      organizationId: org.id,
      versionNumber: 1,
      status: "draft",
      basedOnVersionId: null,
      publishedAt: null,
    });
    const detail = await getTemplateVersion(admin, org.id, versionId);
    for (const list of Object.values(detail.document)) expect(list).toEqual([]);
    expect(await versionsInFamily(familyId)).toHaveLength(1);
  });

  it("4.4.1b kind = custom avvises (A139), ingen rader", async () => {
    const { org, admin } = await orgWithAdmin();
    const before = await rowCounts();
    await expect(
      createTemplateFamily(admin, org.id, { name: "Egen mal", kind: "custom" }),
    ).rejects.toThrow(TemplateValidationError);
    expect(await rowCounts()).toEqual(before);
  });

  it("4.4.2 createDraftVersion kopierer hele treet med samme koder og nye id-er, kilden urørt", async () => {
    const { org, admin } = await orgWithAdmin();
    const { familyId, versionId: v1 } = await createTemplateFamily(admin, org.id, {
      name: "Testmal",
    });
    // Rader som slettes mykt i v1 før publisering, skal ikke kopieres.
    const extra = buildTemplateDocument();
    extra.rules.push({
      key: "rule.extra",
      name: "Ekstra",
      purpose: "show",
      target_element_key: "el.count",
    });
    await saveDraftContent(admin, org.id, v1, extra);
    const document = buildTemplateDocument();
    document.standard_measures[1]!.text = "Tiltak to endret";
    await saveDraftContent(admin, org.id, v1, document);
    await publishVersion(admin, org.id, v1, "Første versjon");

    const sourceBefore = await versionRows(v1);
    const sourceVersionBefore = await versionRow(v1);
    expect(sourceBefore.rules.some((r) => r.deleted_at !== null)).toBe(true);
    expect(sourceBefore.standard_measures.some((r) => r.deleted_at !== null)).toBe(true);

    const { versionId: v2 } = await createDraftVersion(admin, org.id, familyId);

    const version = await versionRow(v2);
    expect(version).toMatchObject({
      familyId,
      versionNumber: 2,
      status: "draft",
      basedOnVersionId: v1,
      organizationId: org.id,
    });

    const copy = await versionRows(v2);
    expect(activeCounts(copy)).toEqual(TEMPLATE_DOCUMENT_ROWS);
    for (const table of CONTENT_TABLES) {
      // Ingen slettede rader kopiert, bare nye id-er
      expect(
        copy[table].every((r) => r.deleted_at === null),
        table,
      ).toBe(true);
      const sourceIds = new Set(sourceBefore[table].map((r) => r.id));
      for (const row of copy[table]) expect(sourceIds.has(row.id), table).toBe(false);
      // Samme koder
      const activeKeys = (rows: DbRow[]) =>
        rows
          .filter((r) => r.deleted_at === null)
          .map((r) => r.key ?? null)
          .sort();
      expect(activeKeys(copy[table]), table).toEqual(activeKeys(sourceBefore[table]));
    }

    const docV1 = (await getTemplateVersion(admin, org.id, v1)).document;
    const docV2 = (await getTemplateVersion(admin, org.id, v2)).document;
    expect(docV2).toEqual(docV1);

    // Kilden er urørt
    expect(await versionRows(v1)).toEqual(sourceBefore);
    expect(await versionRow(v1)).toEqual(sourceVersionBefore);
  });

  it("4.4.3 createDraftVersion når det finnes et utkast gir TemplateStateError (også når v1 aldri er publisert)", async () => {
    const { org, admin } = await orgWithAdmin();
    const { familyId } = await createTemplateFamily(admin, org.id, { name: "Testmal" });
    const before = await rowCounts();
    const error = await createDraftVersion(admin, org.id, familyId).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(TemplateStateError);
    expect((error as Error).message).toBe(DRAFT_EXISTS_MESSAGE);
    expect(await rowCounts()).toEqual(before);

    const published = await publishedSetup();
    await createDraftVersion(published.admin, published.org.id, published.familyId);
    await expect(
      createDraftVersion(published.admin, published.org.id, published.familyId),
    ).rejects.toThrow(DRAFT_EXISTS_MESSAGE);
    expect(
      (await versionsInFamily(published.familyId)).filter((v) => v.status === "draft"),
    ).toHaveLength(1);
  });

  it("4.4.4 to samtidige createDraftVersion gir ett utkast og én TemplateStateError", async () => {
    const { org, admin, familyId } = await publishedSetup();
    const results = await Promise.allSettled([
      createDraftVersion(admin, org.id, familyId),
      createDraftVersion(admin, org.id, familyId),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(TemplateStateError);
    expect((await versionsInFamily(familyId)).filter((v) => v.status === "draft")).toHaveLength(1);
  });

  it("4.4.5 publisering: utkast blir publisert med hvem, når og merknad; forrige blir utgått", async () => {
    const { org, admin, adminEmployee, familyId, v1 } = await publishedSetup();
    const first = await versionRow(v1);
    expect(first).toMatchObject({
      status: "published",
      publishedBy: adminEmployee.id,
      changeNote: "Første versjon",
    });
    expect(first.publishedAt).toBeInstanceOf(Date);

    const { versionId: v2 } = await createDraftVersion(admin, org.id, familyId);
    const before = Date.now();
    await expect(publishVersion(admin, org.id, v2, "Andre versjon")).resolves.toEqual({
      versionId: v2,
    });
    const second = await versionRow(v2);
    expect(second).toMatchObject({
      status: "published",
      publishedBy: adminEmployee.id,
      changeNote: "Andre versjon",
    });
    expect(second.publishedAt!.getTime()).toBeGreaterThanOrEqual(before - 5_000);
    expect((await versionRow(v1)).status).toBe("retired");
    const statuses = (await versionsInFamily(familyId)).map((v) => v.status).sort();
    expect(statuses).toEqual(["published", "retired"]);
  });

  it("4.4.6 to samtidige publiseringer av samme utkast gir én vinner", async () => {
    const { org, admin, familyId } = await publishedSetup();
    const { versionId: v2 } = await createDraftVersion(admin, org.id, familyId);
    const results = await Promise.allSettled([
      publishVersion(admin, org.id, v2, null),
      publishVersion(admin, org.id, v2, null),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(TemplateStateError);
    const versions = await versionsInFamily(familyId);
    expect(versions.filter((v) => v.status === "published")).toHaveLength(1);
    expect(versions.filter((v) => v.status === "published")[0]!.id).toBe(v2);
  });

  it.each(
    (["published", "retired"] as const).flatMap((status) =>
      (["saveDraftContent", "publishVersion"] as const).map((service) => ({ status, service })),
    ),
  )(
    "4.4.7 $status versjon: $service gir TemplateStateError, ingen rader endret",
    async ({ status, service }) => {
      const { org, admin } = await orgWithAdmin();
      const { versionId } = await createTemplate(org.id, {
        status,
        document: buildTemplateDocument(),
      });
      const before = await snapshot();
      const countsBefore = await rowCounts();
      const changed = buildTemplateDocument();
      changed.sections[0]!.title = "Endret tittel";
      const run =
        service === "saveDraftContent"
          ? saveDraftContent(admin, org.id, versionId, changed)
          : publishVersion(admin, org.id, versionId, "Merknad");
      const error = await run.then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(TemplateStateError);
      expect((error as Error).message).toBe(NOT_DRAFT_MESSAGE);
      expect(await snapshot()).toEqual(before);
      expect(await rowCounts()).toEqual(countsBefore);
    },
  );

  it("4.4.8 getTemplateVersion gir hele treet sortert etter sort_order, uten slettede rader", async () => {
    const { org, admin, versionId } = await draftSetup();
    const original = buildTemplateDocument();
    // Lagret i stokket rekkefølge
    const shuffled = buildTemplateDocument();
    for (const list of Object.keys(shuffled) as (keyof Doc)[]) {
      (shuffled[list] as unknown[]).reverse();
    }
    // En rad som fjernes igjen, så den er slettet mykt
    const withExtra = buildTemplateDocument();
    withExtra.sections.push({ key: "sec.gone", title: "Borte", sort_order: 9 });
    await saveDraftContent(admin, org.id, versionId, withExtra);
    await saveDraftContent(admin, org.id, versionId, shuffled);

    const { document } = await getTemplateVersion(admin, org.id, versionId);
    // Samme innhold som originalen (uavhengig av rekkefølge), ingen slettede rader
    expect(sortedLists(document)).toEqual(sortedLists(parsed(original)));
    expect(document.sections.map((s) => s.key)).not.toContain("sec.gone");

    // Innenfor hver forelder: stigende sort_order
    const parentOf: Record<string, (item: Record<string, unknown>) => string> = {
      sections: (s) => String(s.parent_key),
      elements: (e) => String(e.section_key),
      element_options: (o) => String(o.element_key),
      checkpoints: (c) => String(c.section_key),
      deviation_questions: (q) => String(q.checkpoint_key),
      outcomes: (o) => `${String(o.checkpoint_key)}/${String(o.question_key)}`,
      standard_measures: (m) =>
        `${String(m.checkpoint_key)}/${String(m.question_key)}/${String(m.outcome_key)}`,
      rules: () => "",
      rule_conditions: (c) => String(c.rule_key),
      rule_test_cases: (t) => String(t.rule_key),
    };
    for (const [list, items] of Object.entries(document) as [string, Record<string, unknown>[]][]) {
      const lastOrder = new Map<string, number>();
      for (const item of items) {
        const parent = parentOf[list]!(item);
        const order = item.sort_order as number;
        expect(order, `${list} under ${parent}`).toBeGreaterThanOrEqual(
          lastOrder.get(parent) ?? -1,
        );
        lastOrder.set(parent, order);
      }
    }
    // Der det bare er én forelder, er rekkefølgen den samme som i originalen
    expect(document.rules.map((r) => r.key)).toEqual(original.rules.map((r) => r.key));
    expect(document.standard_measures.map((m) => m.text)).toEqual(["Tiltak en", "Tiltak to"]);
    expect(document.deviation_questions.map((q) => q.key)).toEqual(["dq.first", "dq.second"]);
    expect(document.rule_test_cases.map((t) => t.name)).toEqual(
      original.rule_test_cases.map((t) => t.name),
    );
  });

  it("4.4.9 listTemplateFamilies viser ikke slettede familier", async () => {
    const { org, admin } = await orgWithAdmin();
    const kept = await createTemplate(org.id, { name: "Beholdt" });
    await createTemplate(org.id, { name: "Slettet", deletedAt: new Date("2026-11-03T09:00:00Z") });
    const list = await listTemplateFamilies(admin, org.id);
    expect(list.map((f) => f.id)).toEqual([kept.familyId]);
  });

  it("4.4.9b alle ansatte kan liste malene (takstmann og kontor)", async () => {
    const { org } = await orgWithAdmin();
    const { familyId } = await createTemplate(org.id);
    for (const roles of [["inspector"], ["office"]] as EmployeeRole[][]) {
      const { actor } = await person(org.id, roles);
      expect((await listTemplateFamilies(actor, org.id)).map((f) => f.id)).toEqual([familyId]);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 4.5 saveDraftContent
// ---------------------------------------------------------------------------------------------

describe("4.5 saveDraftContent", () => {
  it("4.5.1 første lagring legger til alle radene", async () => {
    const { org, admin, versionId } = await draftSetup();
    await expect(
      saveDraftContent(admin, org.id, versionId, buildTemplateDocument()),
    ).resolves.toEqual({ added: TEMPLATE_DOCUMENT_ROW_COUNT, changed: 0, removed: 0 });
    expect(activeCounts(await versionRows(versionId))).toEqual(TEMPLATE_DOCUMENT_ROWS);
  });

  it("4.5.2 samme dokument to ganger gir 0/0/0 og ingen ny updated_at (A144)", async () => {
    const { org, admin, versionId } = await draftSetup();
    await saveDraftContent(admin, org.id, versionId, buildTemplateDocument());
    const before = await versionRows(versionId);
    await expect(
      saveDraftContent(admin, org.id, versionId, buildTemplateDocument()),
    ).resolves.toEqual({ added: 0, changed: 0, removed: 0 });
    expect(await versionRows(versionId)).toEqual(before);
  });

  it("4.5.3 endret teller bare rader der et lagret felt er ulikt", async () => {
    const { org, admin, versionId } = await draftSetup();
    await saveDraftContent(admin, org.id, versionId, buildTemplateDocument());
    const doc = buildTemplateDocument();
    doc.elements[1]!.label = "Antall endret";
    await expect(saveDraftContent(admin, org.id, versionId, doc)).resolves.toEqual({
      added: 0,
      changed: 1,
      removed: 0,
    });
    const rows = await versionRows(versionId);
    const element = rows.template_elements.find((r) => r.key === "el.count")!;
    expect(element.label).toBe("Antall endret");
    expect(element.deleted_at).toBeNull();
  });

  it("4.5.4 fjernet er myk sletting; antall rader går aldri ned", async () => {
    const { org, admin, versionId } = await draftSetup();
    await saveDraftContent(admin, org.id, versionId, buildTemplateDocument());
    const totalBefore = Object.values(await rowCounts()).reduce((s, n) => s + n, 0);
    const rowsBefore = await versionRows(versionId);
    const grid = rowsBefore.template_elements.find((r) => r.key === "el.grid")!;

    const doc = buildTemplateDocument();
    doc.elements = doc.elements.filter((e) => e.key !== "el.grid");
    await expect(saveDraftContent(admin, org.id, versionId, doc)).resolves.toEqual({
      added: 0,
      changed: 0,
      removed: 1,
    });

    const rowsAfter = await versionRows(versionId);
    const gone = rowsAfter.template_elements.find((r) => r.id === grid.id)!;
    expect(gone, "raden skal stå igjen").toBeDefined();
    expect(gone.deleted_at).not.toBeNull();
    expect(gone.key).toBe("el.grid");
    for (const table of CONTENT_TABLES) {
      expect(rowsAfter[table].length, table).toBeGreaterThanOrEqual(rowsBefore[table].length);
    }
    const totalAfter = Object.values(await rowCounts()).reduce((s, n) => s + n, 0);
    expect(totalAfter).toBeGreaterThanOrEqual(totalBefore);
    expect(
      (await getTemplateVersion(admin, org.id, versionId)).document.elements.map((e) => e.key),
    ).not.toContain("el.grid");
  });

  it("4.5.4b å fjerne kontrollpunktet sletter hele grenen mykt, ingenting hardt", async () => {
    const { org, admin, versionId } = await draftSetup();
    await saveDraftContent(admin, org.id, versionId, buildTemplateDocument());
    const before = await versionRows(versionId);
    const result = await saveDraftContent(admin, org.id, versionId, withoutCheckpoint());
    // kontrollpunkt, 2 spørsmål, 2 utfall, 2 tiltak og regelen rule.suggest
    expect(result.removed).toBe(8);
    expect(result.added).toBe(0);
    const after = await versionRows(versionId);
    for (const table of CONTENT_TABLES) {
      expect(
        after[table].map((r) => r.id),
        table,
      ).toEqual(before[table].map((r) => r.id));
    }
    expect(after.checkpoints.every((r) => r.deleted_at !== null)).toBe(true);
    expect(after.outcomes.every((r) => r.deleted_at !== null)).toBe(true);
    expect(after.standard_measures.every((r) => r.deleted_at !== null)).toBe(true);
  });

  type ListCase = {
    table: "standard_measures" | "rule_conditions" | "rule_test_cases";
    reorder: (doc: Doc) => void;
    change: (doc: Doc) => void;
  };
  const keylessCases: ListCase[] = [
    {
      table: "standard_measures",
      reorder: (doc) => {
        doc.standard_measures[0]!.sort_order = 1;
        doc.standard_measures[1]!.sort_order = 0;
      },
      change: (doc) => {
        doc.standard_measures[1]!.text = "Tiltak to endret";
      },
    },
    {
      table: "rule_conditions",
      reorder: (doc) => {
        doc.rule_conditions[0]!.sort_order = 1;
        doc.rule_conditions[1]!.sort_order = 0;
      },
      change: (doc) => {
        doc.rule_conditions[1]!.value = 7;
      },
    },
    {
      table: "rule_test_cases",
      reorder: (doc) => {
        doc.rule_test_cases[0]!.sort_order = 1;
        doc.rule_test_cases[1]!.sort_order = 0;
      },
      change: (doc) => {
        doc.rule_test_cases[1]!.name = "Stor gir ikke vis, endret";
      },
    },
  ];

  it.each(keylessCases)(
    "4.5.5 $table uten kode erstattes samlet per forelder (A142)",
    async ({ table, reorder, change }) => {
      const { org, admin, versionId } = await draftSetup();
      await saveDraftContent(admin, org.id, versionId, buildTemplateDocument());

      // Lik liste: ingenting skjer
      await expect(
        saveDraftContent(admin, org.id, versionId, buildTemplateDocument()),
      ).resolves.toEqual({ added: 0, changed: 0, removed: 0 });

      // Endret rekkefølge: de to gamle slettes mykt, to nye legges til
      const reordered = buildTemplateDocument();
      reorder(reordered);
      await expect(saveDraftContent(admin, org.id, versionId, reordered)).resolves.toEqual({
        added: 2,
        changed: 0,
        removed: 2,
      });
      let rows = (await versionRows(versionId))[table];
      expect(rows).toHaveLength(4);
      expect(rows.filter((r) => r.deleted_at === null)).toHaveLength(2);

      // Lik liste igjen: ingenting skjer
      await expect(saveDraftContent(admin, org.id, versionId, reordered)).resolves.toEqual({
        added: 0,
        changed: 0,
        removed: 0,
      });

      // Én ny verdi: hele listen erstattes
      const changed = buildTemplateDocument();
      reorder(changed);
      change(changed);
      await expect(saveDraftContent(admin, org.id, versionId, changed)).resolves.toEqual({
        added: 2,
        changed: 0,
        removed: 2,
      });
      rows = (await versionRows(versionId))[table];
      expect(rows).toHaveLength(6);
      expect(rows.filter((r) => r.deleted_at === null)).toHaveLength(2);
    },
  );

  const unknownCases: { name: string; change: (doc: Doc) => void; path: string }[] = [
    {
      name: "forelderseksjon",
      change: (d) => {
        d.sections[1]!.parent_key = "sec.none";
      },
      path: "sections.1.parent_key",
    },
    {
      name: "seksjon på felt",
      change: (d) => {
        d.elements[1]!.section_key = "sec.none";
      },
      path: "elements.1.section_key",
    },
    {
      name: "seksjon på kontrollpunkt",
      change: (d) => {
        d.checkpoints[0]!.section_key = "sec.none";
      },
      path: "checkpoints.0.section_key",
    },
    {
      name: "kontrollpunkt på felt",
      change: (d) => {
        d.elements[0]!.checkpoint_key = "cp.none";
      },
      path: "elements.0.checkpoint_key",
    },
    {
      name: "kontrollpunkt på spørsmål",
      change: (d) => {
        d.deviation_questions[1]!.checkpoint_key = "cp.none";
      },
      path: "deviation_questions.1.checkpoint_key",
    },
    {
      name: "felt på valg",
      change: (d) => {
        d.element_options[1]!.element_key = "el.none";
      },
      path: "element_options.1.element_key",
    },
    {
      name: "spørsmål på utfall",
      change: (d) => {
        d.outcomes[1]!.question_key = "dq.none";
      },
      path: "outcomes.1",
    },
    {
      name: "utfall på tiltak",
      change: (d) => {
        d.standard_measures[1]!.outcome_key = "out.none";
      },
      path: "standard_measures.1",
    },
    {
      name: "suggested_outcome",
      change: (d) => {
        d.rules[1]!.suggested_outcome = {
          checkpoint_key: "cp.one",
          question_key: "dq.first",
          outcome_key: "out.none",
        };
      },
      path: "rules.1.suggested_outcome",
    },
    {
      name: "regelmål felt",
      change: (d) => {
        d.rules[0]!.target_element_key = "el.none";
      },
      path: "rules.0.target_element_key",
    },
    {
      name: "regelmål seksjon",
      change: (d) => {
        d.rules[0]!.target_section_key = "sec.none";
      },
      path: "rules.0.target_section_key",
    },
    {
      name: "regelmål kontrollpunkt",
      change: (d) => {
        d.rules[1]!.target_checkpoint_key = "cp.none";
      },
      path: "rules.1.target_checkpoint_key",
    },
    {
      name: "related_checkpoint_keys",
      change: (d) => {
        d.checkpoints[0]!.related_checkpoint_keys = ["cp.none"];
      },
      path: "checkpoints.0.related_checkpoint_keys",
    },
    {
      name: "betingelsens element_key",
      change: (d) => {
        d.rule_conditions[0]!.element_key = "el.none";
      },
      path: "rule_conditions.0.element_key",
    },
    {
      name: "betingelsens checkpoint_key",
      change: (d) => {
        d.rule_conditions[1]!.checkpoint_key = "cp.none";
      },
      path: "rule_conditions.1.checkpoint_key",
    },
    {
      name: "regel på betingelse",
      change: (d) => {
        d.rule_conditions[0]!.rule_key = "rule.none";
      },
      path: "rule_conditions.0.rule_key",
    },
    {
      name: "regel på testtilfelle",
      change: (d) => {
        d.rule_test_cases[0]!.rule_key = "rule.none";
      },
      path: "rule_test_cases.0.rule_key",
    },
  ];

  it.each(unknownCases)("4.5.6 key_unknown: $name", async ({ change, path }) => {
    const { org, admin, versionId } = await draftSetup();
    const doc = buildTemplateDocument();
    change(doc);
    const before = await rowCounts();
    await expectIssue(saveDraftContent(admin, org.id, versionId, doc), "key_unknown", path);
    expect(await rowCounts()).toEqual(before);
  });

  const duplicateCases: { name: string; change: (doc: Doc) => void; list: string }[] = [
    {
      name: "to seksjoner",
      change: (d) => {
        d.sections.push({ key: "sec.alpha", title: "Kopi", sort_order: 5 });
      },
      list: "sections",
    },
    {
      name: "to felt",
      change: (d) => {
        d.elements.push({ ...d.elements[1]!, label: "Kopi" });
      },
      list: "elements",
    },
    {
      name: "to kontrollpunkter",
      change: (d) => {
        d.checkpoints.push({ ...d.checkpoints[0]!, name: "Kopi" });
      },
      list: "checkpoints",
    },
    {
      name: "to regler",
      change: (d) => {
        d.rules.push({ ...d.rules[0]!, name: "Kopi" });
      },
      list: "rules",
    },
    {
      name: "to valg under samme felt",
      change: (d) => {
        d.element_options.push({ element_key: "el.size", key: "opt.small", label: "Kopi" });
      },
      list: "element_options",
    },
    {
      name: "to spørsmål under samme kontrollpunkt",
      change: (d) => {
        d.deviation_questions.push({ checkpoint_key: "cp.one", key: "dq.first", text: "Kopi" });
      },
      list: "deviation_questions",
    },
    {
      name: "to utfall under samme spørsmål",
      change: (d) => {
        d.outcomes.push({
          checkpoint_key: "cp.one",
          question_key: "dq.first",
          key: "out.a",
          kind: "tg3",
        });
      },
      list: "outcomes",
    },
  ];

  it.each(duplicateCases)("4.5.7 key_duplicate: $name", async ({ change, list }) => {
    const { org, admin, versionId } = await draftSetup();
    const doc = buildTemplateDocument();
    change(doc);
    const before = await rowCounts();
    await expectIssue(saveDraftContent(admin, org.id, versionId, doc), "key_duplicate", `${list}.`);
    expect(await rowCounts()).toEqual(before);
  });

  it("4.5.8 lovlig gjenbruk: samme valgkode under to felt, og samme kode på seksjon og kontrollpunkt (A141)", async () => {
    const { org, admin, versionId } = await draftSetup();
    const doc = buildTemplateDocument();
    doc.elements.push({
      key: "el.other",
      section_key: "sec.alpha",
      label: "Annet valg",
      field_type: "choice",
      sort_order: 3,
    });
    doc.element_options.push({ element_key: "el.other", key: "opt.small", label: "Liten" });
    doc.sections.push({ key: "cp.one", title: "Seksjon med samme kode", sort_order: 2 });
    doc.deviation_questions.push({ checkpoint_key: "cp.one", key: "out.a", text: "Spørsmål tre" });
    await expect(saveDraftContent(admin, org.id, versionId, doc)).resolves.toEqual({
      added: TEMPLATE_DOCUMENT_ROW_COUNT + 4,
      changed: 0,
      removed: 0,
    });
  });

  it("4.5.9 key_archived: en kode som er fjernet i siste publiserte versjon kan ikke tas i bruk igjen (A136, regel 6)", async () => {
    const { org, admin, familyId } = await publishedSetup();
    const { versionId: v2 } = await createDraftVersion(admin, org.id, familyId);
    await saveDraftContent(admin, org.id, v2, withoutCheckpoint());
    await publishVersion(admin, org.id, v2, "Uten kontrollpunktet");
    const { versionId: v3 } = await createDraftVersion(admin, org.id, familyId);

    const before = await rowCounts();
    const issues = await expectIssue(
      saveDraftContent(admin, org.id, v3, buildTemplateDocument()),
      "key_archived",
      "checkpoints.0",
    );
    // Også spørsmålene og utfallene under det arkiverte punktet, og regelen
    expect(issues.filter((i) => i.rule === "key_archived").length).toBeGreaterThanOrEqual(2);
    expect(await rowCounts()).toEqual(before);
    expect(activeCounts(await versionRows(v3)).checkpoints).toBe(0);
  });

  it("4.5.9b fjernet og lagt til igjen i samme utkast godtas når koden finnes i siste publiserte", async () => {
    const { org, admin, familyId } = await publishedSetup();
    const { versionId: v2 } = await createDraftVersion(admin, org.id, familyId);
    await saveDraftContent(admin, org.id, v2, withoutCheckpoint());
    const result = await saveDraftContent(admin, org.id, v2, buildTemplateDocument());
    expect(result.removed).toBe(0);
    expect(result.added).toBe(8);
    const rows = await versionRows(v2);
    expect(activeCounts(rows)).toEqual(TEMPLATE_DOCUMENT_ROWS);
  });

  it("4.5.9c en kode som aldri er publisert er ikke arkivert (fjernet og lagt til igjen i v1)", async () => {
    const { org, admin, versionId } = await draftSetup();
    await saveDraftContent(admin, org.id, versionId, buildTemplateDocument());
    await saveDraftContent(admin, org.id, versionId, withoutCheckpoint());
    await expect(
      saveDraftContent(admin, org.id, versionId, buildTemplateDocument()),
    ).resolves.toMatchObject({ added: 8, removed: 0 });
  });

  const keyFormatCases = [
    { list: "sections", change: (d: Doc) => void (d.sections[0]!.key = "Stor") },
    { list: "elements", change: (d: Doc) => void (d.elements[0]!.key = "med mellomrom") },
    {
      list: "element_options",
      change: (d: Doc) => void (d.element_options[0]!.key = "med-bindestrek"),
    },
    { list: "checkpoints", change: (d: Doc) => void (d.checkpoints[0]!.key = "") },
    {
      list: "deviation_questions",
      change: (d: Doc) => void (d.deviation_questions[0]!.key = ".ledende"),
    },
    { list: "outcomes", change: (d: Doc) => void (d.outcomes[0]!.key = "æøå") },
    { list: "rules", change: (d: Doc) => void (d.rules[0]!.key = "Regel.En") },
  ];

  it.each(keyFormatCases)("4.5.10 key_format via tjenesten: $list", async ({ list, change }) => {
    const { org, admin, versionId } = await draftSetup();
    const doc = buildTemplateDocument();
    change(doc);
    const before = await rowCounts();
    await expectIssue(
      saveDraftContent(admin, org.id, versionId, doc),
      "key_format",
      `${list}.0.key`,
    );
    expect(await rowCounts()).toEqual(before);
  });

  it("4.5.10b outcome_tgiu og schema via tjenesten", async () => {
    const { org, admin, versionId } = await draftSetup();
    const tgiu = buildTemplateDocument();
    tgiu.outcomes[0]!.kind = "tgiu" as never;
    await expectIssue(
      saveDraftContent(admin, org.id, versionId, tgiu),
      "outcome_tgiu",
      "outcomes.0",
    );
    const bad = buildTemplateDocument();
    bad.elements[0]!.field_type = "slider" as never;
    await expectIssue(saveDraftContent(admin, org.id, versionId, bad), "schema", "elements.0");
    expect(activeCounts(await versionRows(versionId)).template_elements).toBe(0);
  });

  it("4.5.10c egen mal (custom) med kontrollpunkt og TG-regel avvises av saveDraftContent", async () => {
    const { org, admin, familyId, versionId } = await draftSetup();
    await db
      .update(templateFamilies)
      .set({ kind: "custom" })
      .where(eq(templateFamilies.id, familyId));
    const before = await rowCounts();
    await expectIssue(
      saveDraftContent(admin, org.id, versionId, buildTemplateDocument()),
      "tg_logic_in_custom",
    );
    expect(await rowCounts()).toEqual(before);

    // show og validate uten kontrollpunkt er lov i en egen mal
    const allowed = withoutCheckpoint();
    await expect(saveDraftContent(admin, org.id, versionId, allowed)).resolves.toMatchObject({
      removed: 0,
    });
  });

  it("4.5.11 feil midt i lagringen etterlater ingenting", async () => {
    const { org, admin, versionId } = await draftSetup();
    const before = await snapshot();
    const countsBefore = await rowCounts();
    await db.execute(sql`
      create or replace function test_fail_rule_test_cases() returns trigger as $$
      begin raise exception 'testfeil midt i lagringen'; end; $$ language plpgsql`);
    await db.execute(sql`
      create trigger test_fail_rule_test_cases before insert on rule_test_cases
      for each row execute function test_fail_rule_test_cases()`);
    try {
      const error = await saveDraftContent(admin, org.id, versionId, buildTemplateDocument()).then(
        () => null,
        (caught: unknown) => caught,
      );
      // Feilen skal komme fra triggeren, altså etter at de andre tabellene er skrevet
      const messages: string[] = [];
      for (let e: unknown = error, depth = 0; e && depth < 5; depth += 1) {
        messages.push(String((e as Error).message));
        e = (e as { cause?: unknown }).cause;
      }
      expect(messages.join(" | ")).toContain("testfeil midt i lagringen");
    } finally {
      await db.execute(sql`drop trigger if exists test_fail_rule_test_cases on rule_test_cases`);
      await db.execute(sql`drop function if exists test_fail_rule_test_cases()`);
    }
    expect(await snapshot()).toEqual(before);
    expect(await rowCounts()).toEqual(countsBefore);
  });

  it("4.5.12 valideringsfeil i siste regel etterlater ingenting", async () => {
    const { org, admin, versionId } = await draftSetup();
    await saveDraftContent(admin, org.id, versionId, buildTemplateDocument());
    const before = await snapshot();
    const countsBefore = await rowCounts();
    const doc = buildTemplateDocument();
    doc.sections[0]!.title = "Ny tittel";
    doc.elements = doc.elements.filter((e) => e.key !== "el.grid");
    doc.rules[2]!.target_element_key = "el.none";
    await expectIssue(saveDraftContent(admin, org.id, versionId, doc), "key_unknown", "rules.2");
    expect(await snapshot()).toEqual(before);
    expect(await rowCounts()).toEqual(countsBefore);
  });

  it("4.5.13 organization_id på alle nye rader er grant.organizationId", async () => {
    const { org, admin, versionId } = await draftSetup();
    const other = await createOrganization("Annen organisasjon");
    const otherTemplate = await createTemplate(other.id, { document: buildTemplateDocument() });
    // Prøver å smugle inn en annen organisasjon i dokumentet
    const doc = buildTemplateDocument();
    Object.assign(doc, { organizationId: other.id, organization_id: other.id });
    Object.assign(doc.sections[0]!, { organizationId: other.id, organization_id: other.id });
    const result = parseTemplateDocument(doc);
    if (result.success) {
      await saveDraftContent(admin, org.id, versionId, doc);
    } else {
      await saveDraftContent(admin, org.id, versionId, buildTemplateDocument());
    }
    const rows = await versionRows(versionId);
    expect(activeCounts(rows)).toEqual(TEMPLATE_DOCUMENT_ROWS);
    for (const table of CONTENT_TABLES) {
      for (const row of rows[table]) expect(row.organization_id, table).toBe(org.id);
    }
    // Den andre organisasjonens rader er urørt
    expect(activeCounts(await versionRows(otherTemplate.versionId))).toEqual(
      TEMPLATE_DOCUMENT_ROWS,
    );
  });
});

// ---------------------------------------------------------------------------------------------
// 4.6 Revisjonsloggen og hendelser
// ---------------------------------------------------------------------------------------------

describe("4.6 revisjonsloggen og hendelser", () => {
  function auditFor(versionId: string) {
    return db
      .select()
      .from(auditLog)
      .where(
        sql`${auditLog.entityId} = ${versionId} or ${auditLog.changes}->>'versionId' = ${versionId}`,
      );
  }

  it("4.6.1 én rad per handling med versionId, hvem og handling; lagret har riktige tall", async () => {
    const { org, admin, adminEmployee } = await orgWithAdmin();
    const { versionId } = await createTemplateFamily(admin, org.id, { name: "Testmal" });
    let rows = await auditFor(versionId);
    expect(rows).toHaveLength(1);
    const created = rows[0]!;

    const counts = await saveDraftContent(admin, org.id, versionId, buildTemplateDocument());
    rows = await auditFor(versionId);
    expect(rows).toHaveLength(2);
    const saved = rows.find((r) => r.id !== created.id)!;
    expect(saved.changes).toMatchObject({
      added: counts.added,
      changed: counts.changed,
      removed: counts.removed,
    });

    const second = buildTemplateDocument();
    second.elements[1]!.label = "Endret";
    second.rules = second.rules.filter((r) => r.key !== "rule.check");
    const counts2 = await saveDraftContent(admin, org.id, versionId, second);
    expect(counts2).toEqual({ added: 0, changed: 1, removed: 1 });
    rows = await auditFor(versionId);
    expect(rows).toHaveLength(3);
    expect(
      rows.some(
        (r) =>
          (r.changes as Record<string, unknown>).changed === 1 &&
          (r.changes as Record<string, unknown>).removed === 1,
      ),
    ).toBe(true);

    await publishVersion(admin, org.id, versionId, "Merknad");
    rows = await auditFor(versionId);
    expect(rows).toHaveLength(4);

    for (const row of rows) {
      expect(row.organizationId).toBe(org.id);
      expect(row.actorEmployeeId).toBe(adminEmployee.id);
      expect(row.changes).toMatchObject({ versionId });
    }
    // Opprettet, lagret og publisert er tre ulike handlinger
    const actions = new Set(rows.map((r) => r.action));
    expect(actions.size).toBe(3);
    expect(rows.find((r) => r.id === created.id)!.action).not.toBe(saved.action);
  });

  it("4.6.1b createDraftVersion gir én loggrad for det nye utkastet", async () => {
    const { org, admin, familyId } = await publishedSetup();
    const { versionId: v2 } = await createDraftVersion(admin, org.id, familyId);
    const rows = await auditFor(v2);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.changes).toMatchObject({ versionId: v2 });
  });

  it("4.6.2 ingen titler, ledetekster eller fagtekst i revisjonsloggen eller hendelsene", async () => {
    const { org, admin } = await orgWithAdmin();
    const { familyId, versionId } = await createTemplateFamily(admin, org.id, { name: MARK_NAME });
    const doc = buildTemplateDocument();
    doc.sections[0]!.title = MARK_TITLE;
    doc.elements[0]!.label = MARK_LABEL;
    doc.outcomes[0]!.deviation_text = MARK_DEVIATION;
    doc.standard_measures[0]!.text = MARK_MEASURE;
    doc.rules[2]!.message = MARK_MESSAGE;
    await saveDraftContent(admin, org.id, versionId, doc);
    const changed = structuredClone(doc);
    changed.sections[0]!.title = `${MARK_TITLE} 2`;
    await saveDraftContent(admin, org.id, versionId, changed);
    await publishVersion(admin, org.id, versionId, "Merknad");
    await createDraftVersion(admin, org.id, familyId);

    // Kontroll: merkene er faktisk lagret i maltabellene
    const detail = await getTemplateVersion(admin, org.id, versionId);
    expect(JSON.stringify(detail)).toContain(MARK_LABEL);

    const logged = JSON.stringify(await db.select().from(auditLog));
    const evented = JSON.stringify(await db.select().from(events));
    expect(logged.length).toBeGreaterThan(2);
    for (const mark of MARKS) {
      expect(logged, `revisjonsloggen har ${mark}`).not.toContain(mark);
      expect(evented, `hendelsene har ${mark}`).not.toContain(mark);
    }
  });

  it("4.6.3 ingen ny hendelse (A145)", async () => {
    const { org, admin } = await orgWithAdmin();
    const before = (await rowCounts()).events;
    const { familyId, versionId } = await createTemplateFamily(admin, org.id, { name: "Testmal" });
    await saveDraftContent(admin, org.id, versionId, buildTemplateDocument());
    await publishVersion(admin, org.id, versionId, null);
    await createDraftVersion(admin, org.id, familyId);
    expect((await rowCounts()).events).toBe(before);
  });

  it("4.6.4 avvist handling (tilgang, status, validering) gir ingen loggrad", async () => {
    const { org, admin } = await orgWithAdmin();
    const draft = await createTemplate(org.id);
    const published = await createTemplate(org.id, { status: "published" });
    const { actor: inspector } = await person(org.id, ["inspector"]);
    const before = (await rowCounts()).audit_log;

    await expect(
      saveDraftContent(inspector, org.id, draft.versionId, buildTemplateDocument()),
    ).rejects.toThrow(AccessDeniedError);
    await expect(createTemplateFamily(inspector, org.id, { name: "Ny" })).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(
      saveDraftContent(admin, org.id, published.versionId, buildTemplateDocument()),
    ).rejects.toThrow(TemplateStateError);
    await expect(publishVersion(admin, org.id, published.versionId, null)).rejects.toThrow(
      TemplateStateError,
    );
    await expect(createDraftVersion(admin, org.id, draft.familyId)).rejects.toThrow(
      TemplateStateError,
    );
    const bad = buildTemplateDocument();
    bad.rules[0]!.target_element_key = "el.none";
    await expect(saveDraftContent(admin, org.id, draft.versionId, bad)).rejects.toThrow(
      TemplateValidationError,
    );
    await expect(
      createTemplateFamily(admin, org.id, { name: "Egen", kind: "custom" }),
    ).rejects.toThrow(TemplateValidationError);

    expect((await rowCounts()).audit_log).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------
// Dekning av regelkodene gjennom tjenesten (kjøres sist i filen)
// ---------------------------------------------------------------------------------------------

describe("dekning av regelkodene", () => {
  it("alle verdiene i TemplateIssueRule er sett i et avvist kall til saveDraftContent", () => {
    expect([...seenRules].sort()).toEqual([...TEMPLATE_ISSUE_RULES].sort());
  });
});
