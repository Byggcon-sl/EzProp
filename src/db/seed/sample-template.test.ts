import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/core/access";
import {
  createDraftVersion,
  getTemplateVersion,
  isSameTemplateContent,
  listTemplateFamilies,
  parseTemplateDocument,
  type TemplateDocument,
} from "@/core/templates";
import { db } from "@/db/client";
import {
  createEmployee,
  createOffice,
  createOrganization,
  createUser,
  resetDatabase,
  TEST_NOW,
} from "../../../tests/factories";
import { runSeed } from "./run";
import {
  ensureSampleTemplate,
  isSampleOrganization,
  runSampleSeed,
  type SampleSeedContext,
} from "./sample-assignments";
import { wetRoomTemplate } from "./templates/wet-room";

/*
 * `ensureSampleTemplate` og `isSampleOrganization` (docs/funksjoner/fase2a-mal-bad.md Omfang 6,
 * testplanen del 3). Mot testdatabasen. Alle navn er oppdiktet.
 *
 * Støtter hovedmål: best for de ansatte og testlaget (badet finnes i prøveorganisasjonen, så
 * regler, skjerm og PDF kan prøves) og færre reklamasjoner (malen havner aldri i en ekte
 * organisasjon ved en feil, og ny versjon lages bare når innholdet er endret).
 */

beforeEach(async () => {
  await resetDatabase();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

type Settings = Record<string, unknown> | "none";

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(query)) as unknown as T[];
}

async function contextFor(
  settings: Settings,
  name = "Oppdiktet Prøvetakst",
): Promise<SampleSeedContext> {
  const organization = await createOrganization(name);
  const json = settings === "none" ? {} : settings;
  await db.execute(
    sql`update organizations set settings = ${JSON.stringify(json)}::jsonb where id = ${organization.id}`,
  );
  const admin = await createUser({ name: `Test Admin ${name}` });
  await createEmployee(admin, organization.id, ["admin"]);
  const inspector = await createEmployee(
    await createUser({ name: `Test Takstmann ${name}` }),
    organization.id,
    ["inspector"],
  );
  const office = await createOffice(organization.id);
  return {
    actor: admin,
    organizationId: organization.id,
    officeId: office.id,
    inspectorEmployeeId: inspector.id,
    now: TEST_NOW,
  };
}

async function versions(organizationId: string) {
  return rows<{ id: string; version_number: number; status: string }>(
    sql`select id, version_number, status from template_versions
        where organization_id = ${organizationId} order by version_number`,
  );
}

async function countFor(table: string, organizationId: string): Promise<number> {
  const [row] = await rows<{ count: number }>(
    sql`select count(*)::int as count from ${sql.identifier(table)} where organization_id = ${organizationId}`,
  );
  return row!.count;
}

function parsed(document: unknown): TemplateDocument {
  const result = parseTemplateDocument(document);
  if (!result.success) throw new Error("malfilen er ugyldig");
  return result.document;
}

/** Malfilen med én avvikstekst endret. */
function changedDocument(): TemplateDocument {
  const document = structuredClone(parsed(wetRoomTemplate));
  const first = document.outcomes[0]!;
  document.outcomes[0] = { ...first, deviation_text: `${first.deviation_text ?? ""} Endret.` };
  return document;
}

describe("isSampleOrganization", () => {
  it("sann bare med sampleData = true (boolsk), og bare for organisasjonen selv", async () => {
    const sample = await contextFor({ sampleData: true }, "Prøve A");
    const other = await contextFor({}, "Annen B");
    expect(await isSampleOrganization(sample.organizationId)).toBe(true);
    expect(await isSampleOrganization(other.organizationId)).toBe(false);
  });

  it('nei når sampleData er teksten "true" eller false', async () => {
    const asText = await contextFor({ sampleData: "true" }, "Tekst C");
    const asFalse = await contextFor({ sampleData: false }, "Usann D");
    expect(await isSampleOrganization(asText.organizationId)).toBe(false);
    expect(await isSampleOrganization(asFalse.organizationId)).toBe(false);
  });
});

describe("ensureSampleTemplate", () => {
  it("seed_creates_published_v1: én familie, én publisert v1, åtte kontrollpunkter, tekstene er utkast", async () => {
    const context = await contextFor({ sampleData: true });
    expect(await ensureSampleTemplate(context)).toBe("created");

    const families = await listTemplateFamilies(context.actor, context.organizationId);
    expect(families).toHaveLength(1);
    const family = families[0]!;
    expect(family).toMatchObject({
      name: "Tilstandsrapport bolig",
      kind: "system",
      reportType: "condition_report",
    });
    expect(family.versions).toHaveLength(1);
    expect(family.versions[0]).toMatchObject({ versionNumber: 1, status: "published" });

    const version = await getTemplateVersion(
      context.actor,
      context.organizationId,
      family.versions[0]!.id,
    );
    expect(version.document.checkpoints).toHaveLength(8);
    expect(isSameTemplateContent(version.document, parsed(wetRoomTemplate))).toBe(true);
    const statuses = await rows<{ text_status: string }>(
      sql`select text_status from outcomes where organization_id = ${context.organizationId}
          union all
          select text_status from standard_measures where organization_id = ${context.organizationId}`,
    );
    expect(statuses.length).toBeGreaterThan(0);
    expect(new Set(statuses.map((row) => row.text_status))).toEqual(new Set(["draft"]));
  });

  it("seed_twice_no_new_version: andre kjøring gir existing, ingen ny versjon, intet utkast og ingen nye logg-rader", async () => {
    const context = await contextFor({ sampleData: true });
    await ensureSampleTemplate(context);
    const before = {
      versions: await versions(context.organizationId),
      audit: await countFor("audit_log", context.organizationId),
      events: await countFor("events", context.organizationId),
    };

    expect(await ensureSampleTemplate(context)).toBe("existing");
    expect(await versions(context.organizationId)).toEqual(before.versions);
    expect(await countFor("audit_log", context.organizationId)).toBe(before.audit);
    expect(await countFor("events", context.organizationId)).toBe(before.events);
  });

  it("seed_changed_document_new_version: v2 published, v1 retired og urørt", async () => {
    const context = await contextFor({ sampleData: true });
    await ensureSampleTemplate(context);
    const [v1] = await versions(context.organizationId);
    const v1Document = (await getTemplateVersion(context.actor, context.organizationId, v1!.id))
      .document;

    expect(await ensureSampleTemplate(context, changedDocument())).toBe("created");
    const after = await versions(context.organizationId);
    expect(after.map((v) => [v.version_number, v.status])).toEqual([
      [1, "retired"],
      [2, "published"],
    ]);
    const v1After = await getTemplateVersion(context.actor, context.organizationId, v1!.id);
    expect(v1After.document).toEqual(v1Document);
  });

  it("seed_existing_draft: et utkast som finnes, brukes når innholdet er endret", async () => {
    const context = await contextFor({ sampleData: true });
    await ensureSampleTemplate(context);
    const [family] = await listTemplateFamilies(context.actor, context.organizationId);
    const { versionId } = await createDraftVersion(
      context.actor,
      context.organizationId,
      family!.id,
      TEST_NOW,
    );

    expect(await ensureSampleTemplate(context, changedDocument())).toBe("created");
    const after = await versions(context.organizationId);
    expect(after).toHaveLength(2);
    expect(after.find((v) => v.id === versionId)?.status).toBe("published");
  });

  it("seed_existing_draft: et utkast som finnes, står når innholdet er likt", async () => {
    const context = await contextFor({ sampleData: true });
    await ensureSampleTemplate(context);
    const [family] = await listTemplateFamilies(context.actor, context.organizationId);
    await createDraftVersion(context.actor, context.organizationId, family!.id, TEST_NOW);
    const before = await versions(context.organizationId);

    expect(await ensureSampleTemplate(context)).toBe("existing");
    expect(await versions(context.organizationId)).toEqual(before);
    expect(before.map((v) => v.status)).toEqual(["published", "draft"]);
  });

  it("ugyldig dokument: kaster, og ingenting skrives", async () => {
    const context = await contextFor({ sampleData: true });
    await expect(ensureSampleTemplate(context, { sections: "feil" })).rejects.toThrow();
    expect(await countFor("template_families", context.organizationId)).toBe(0);
  });

  it.each<{ name: string; settings: Settings }>([
    { name: "nøkkelen sampleData mangler", settings: "none" },
    { name: "sampleData = false", settings: { sampleData: false } },
    { name: 'sampleData = "true" (tekst)', settings: { sampleData: "true" } },
    { name: "sampleData = 1", settings: { sampleData: 1 } },
  ])("seed_only_sample_org: $name gir skipped og ingen malrader", async ({ settings }) => {
    const context = await contextFor(settings);
    expect(await ensureSampleTemplate(context)).toBe("skipped");
    expect(await countFor("template_families", context.organizationId)).toBe(0);
    expect(await countFor("template_versions", context.organizationId)).toBe(0);
  });

  it("seed_family_not_visible_in_other_org: annen organisasjon ser ingen familie og får nei på versjonen", async () => {
    const sample = await contextFor({ sampleData: true }, "Prøve A");
    const other = await contextFor({ sampleData: true }, "Annen B");
    await ensureSampleTemplate(sample);
    const [family] = await listTemplateFamilies(sample.actor, sample.organizationId);
    const versionId = family!.versions[0]!.id;

    expect(await listTemplateFamilies(other.actor, other.organizationId)).toEqual([]);
    await expect(
      getTemplateVersion(other.actor, sample.organizationId, versionId),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(
      getTemplateVersion(other.actor, other.organizationId, versionId),
    ).rejects.toThrow();
  });

  it("seed_uses_services: created_by og published_by er admin i prøveorganisasjonen", async () => {
    const context = await contextFor({ sampleData: true });
    await ensureSampleTemplate(context);
    const [admin] = await rows<{ id: string }>(
      sql`select id from employees where organization_id = ${context.organizationId}
          and user_id = ${context.actor.id}`,
    );
    const [family] = await rows<{ created_by: string }>(
      sql`select created_by from template_families where organization_id = ${context.organizationId}`,
    );
    const [version] = await rows<{ created_by: string; published_by: string }>(
      sql`select created_by, published_by from template_versions where organization_id = ${context.organizationId}`,
    );
    expect(family!.created_by).toBe(admin!.id);
    expect(version!.published_by).toBe(admin!.id);
  });
});

describe("runSampleSeed med malen", () => {
  const env = { SEED_ADMIN_EMAIL: "admin@example.com", SEED_ADMIN_NAME: "Test Admin" };

  it("sammendraget har malen, andre kjøring gir existing, og Byggcon får ingen familie", async () => {
    await runSeed(env);
    const first = await runSampleSeed(env, TEST_NOW);
    expect(first.template).toBe("created");
    const second = await runSampleSeed(env, TEST_NOW);
    expect(second.template).toBe("existing");

    const families = await rows<{ organization_id: string; name: string }>(
      sql`select f.organization_id, o.name from template_families f
          join organizations o on o.id = f.organization_id`,
    );
    expect(families).toHaveLength(1);
    const [sample] = await rows<{ id: string }>(
      sql`select id from organizations where settings -> 'sampleData' = 'true'::jsonb`,
    );
    expect(families[0]!.organization_id).toBe(sample!.id);
  });
});

// --- Reglene badet trenger (docs/funksjoner/fase2a-regler-bad-testplan.md avsnitt 9) ------------

/** Navnene på byggeforskrift fra PR #159, før de ble rettet. */
const OLD_BUILDING_CODE_LABELS: Record<string, string> = {
  before_1997: "Før 1997",
  from_1997_to_2010: "1997–2010",
  tek10: "TEK10",
  tek17: "TEK17",
  unknown: "Ukjent",
};

const PAST_LIFESPAN_QUESTION = "wet_room.membrane_drain.membrane_past_lifespan";

/** Malinnholdet slik det var i v1 fra PR #159: uten regler, uten det nye utfallet, gamle navn. */
function previousDocument(): TemplateDocument {
  const document = structuredClone(parsed(wetRoomTemplate));
  document.rules = [];
  document.rule_conditions = [];
  document.rule_test_cases = [];
  document.deviation_questions = document.deviation_questions.filter(
    (q) => q.key !== PAST_LIFESPAN_QUESTION,
  );
  document.outcomes = document.outcomes.filter((o) => o.question_key !== PAST_LIFESPAN_QUESTION);
  document.standard_measures = document.standard_measures.filter(
    (m) => m.question_key !== PAST_LIFESPAN_QUESTION,
  );
  document.element_options = document.element_options.map((o) =>
    o.element_key === "wet_room.building_code"
      ? { ...o, label: OLD_BUILDING_CODE_LABELS[o.key] ?? o.label }
      : o,
  );
  return document;
}

function buildingCodeOptions(document: TemplateDocument) {
  return document.element_options
    .filter((o) => o.element_key === "wet_room.building_code")
    .map((o) => [o.key, o.label]);
}

describe("regler bad: seed av malen med reglene", () => {
  it("9.1 seed_new_version_on_change: v1 fra PR #159 gir ny publisert v2 med reglene, v1 urørt", async () => {
    const context = await contextFor({ sampleData: true });
    expect(await ensureSampleTemplate(context, previousDocument())).toBe("created");
    const [v1] = await versions(context.organizationId);
    const v1Document = (await getTemplateVersion(context.actor, context.organizationId, v1!.id))
      .document;
    expect(v1Document.rules).toEqual([]);
    expect(buildingCodeOptions(v1Document).map(([, label]) => label)).toContain("1997–2010");

    // Ny seed med dagens malfil
    expect(await ensureSampleTemplate(context)).toBe("created");
    const after = await versions(context.organizationId);
    expect(after.map((v) => [v.version_number, v.status])).toEqual([
      [1, "retired"],
      [2, "published"],
    ]);
    const v2Document = (
      await getTemplateVersion(context.actor, context.organizationId, after[1]!.id)
    ).document;
    expect(isSameTemplateContent(v2Document, parsed(wetRoomTemplate))).toBe(true);
    expect(v2Document.rules.map((r) => r.key).sort()).toEqual(
      [
        "wet_room.hole_drilling_not_done",
        "wet_room.hole_moisture_over_limit",
        "wet_room.membrane_before_2000",
        "wet_room.membrane_past_lifespan",
      ].sort(),
    );
    expect(v2Document.rule_test_cases.length).toBe(parsed(wetRoomTemplate).rule_test_cases.length);
    expect(buildingCodeOptions(v2Document)).toEqual([
      ["before_1997", "Før 1997"],
      ["from_1997_to_2010", "TEK97 (1997–2010)"],
      ["tek10", "TEK10 (2010–2017)"],
      ["tek17", "TEK17 (fra 2017)"],
      ["unknown", "Ukjent"],
    ]);
    // v1 er urørt
    const v1After = await getTemplateVersion(context.actor, context.organizationId, v1!.id);
    expect(v1After.document).toEqual(v1Document);
  });

  it("9.2 seed_idempotent: seed to ganger med reglene gir ingen ny versjon", async () => {
    const context = await contextFor({ sampleData: true });
    expect(await ensureSampleTemplate(context, previousDocument())).toBe("created");
    expect(await ensureSampleTemplate(context)).toBe("created");
    const before = await versions(context.organizationId);
    const audit = await countFor("audit_log", context.organizationId);
    expect(await ensureSampleTemplate(context)).toBe("existing");
    expect(await ensureSampleTemplate(context)).toBe("existing");
    expect(await versions(context.organizationId)).toEqual(before);
    expect(await countFor("audit_log", context.organizationId)).toBe(audit);
  });

  it("9.3 codes_unchanged: valgkodene for byggeforskrift er de samme i v1 og v2", async () => {
    const context = await contextFor({ sampleData: true });
    await ensureSampleTemplate(context, previousDocument());
    await ensureSampleTemplate(context);
    const [v1, v2] = await versions(context.organizationId);
    const codes = async (id: string) =>
      buildingCodeOptions(
        (await getTemplateVersion(context.actor, context.organizationId, id)).document,
      ).map(([key]) => key);
    expect(await codes(v2!.id)).toEqual(await codes(v1!.id));
    expect(await codes(v1!.id)).toEqual([
      "before_1997",
      "from_1997_to_2010",
      "tek10",
      "tek17",
      "unknown",
    ]);
  });
});
