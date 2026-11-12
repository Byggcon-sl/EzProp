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
