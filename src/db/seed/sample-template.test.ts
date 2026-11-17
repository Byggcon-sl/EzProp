import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getTemplateVersion,
  isSameTemplateContent,
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

// Opprettelse, gjentatt kjøring, ny versjon, utkast som finnes, bare prøveorganisasjonen,
// tenant-isolasjon og at tjenestene brukes, prøves én gang: i `sample-assignments.test.ts`
// (3.1–3.8). Her står bare det som ikke prøves der (småfunn fra PR #159: doble seed-tester).
describe("ensureSampleTemplate", () => {
  it("ugyldig dokument: kaster, og ingenting skrives", async () => {
    const context = await contextFor({ sampleData: true });
    await expect(ensureSampleTemplate(context, { sections: "feil" })).rejects.toThrow();
    expect(await countFor("template_families", context.organizationId)).toBe(0);
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
        "wet_room.hole_no_elevated_moisture",
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

// --- Badet på PC (docs/funksjoner/fase2a-badet-pc-testplan.md B2.10) ---------------------------

const CHOOSE_TG2_TG3 = "choose_tg2_tg3";

/** Malinnholdet før badet på PC: «Ukjent» med gammelt navn, ett tiltak uten TG per «velg»-utfall. */
function beforeBathroomPc(): TemplateDocument {
  const document = structuredClone(parsed(wetRoomTemplate));
  document.element_options = document.element_options.map((o) =>
    o.element_key === "wet_room.build_year_source" && o.key === "unknown"
      ? { ...o, label: "Ukjent (byggeåret for bygningen brukes)" }
      : o,
  );
  document.standard_measures = document.standard_measures
    .filter((m) => m.applies_to_tg !== 2)
    .map((m) => ({ ...m, applies_to_tg: null, sort_order: 0 }));
  return document;
}

/** Alle faste koder i et maldokument (seksjon, felt, valg, punkt, spørsmål, utfall, regel). */
function fixedKeys(document: TemplateDocument): string[] {
  return [
    ...document.sections.map((x) => `section ${x.key}`),
    ...document.elements.map((x) => `element ${x.key}`),
    ...document.element_options.map((x) => `option ${x.element_key} ${x.key}`),
    ...document.checkpoints.map((x) => `checkpoint ${x.key}`),
    ...document.deviation_questions.map((x) => `question ${x.key}`),
    ...document.outcomes.map((x) => `outcome ${x.question_key} ${x.key}`),
    ...document.rules.map((x) => `rule ${x.key}`),
  ].sort();
}

describe("badet på PC: seed av malen", () => {
  it("B2.10 ny publisert versjon fra seed, og ingen faste koder er endret eller fjernet", async () => {
    const context = await contextFor({ sampleData: true });
    expect(await ensureSampleTemplate(context, beforeBathroomPc())).toBe("created");
    expect(await ensureSampleTemplate(context)).toBe("created");

    const [v1, v2] = await versions(context.organizationId);
    expect([v1!.status, v2!.status]).toEqual(["retired", "published"]);
    const before = (await getTemplateVersion(context.actor, context.organizationId, v1!.id))
      .document;
    const after = (await getTemplateVersion(context.actor, context.organizationId, v2!.id))
      .document;
    expect(isSameTemplateContent(after, parsed(wetRoomTemplate))).toBe(true);
    expect(fixedKeys(after)).toEqual(fixedKeys(before));

    // T-0051: bare navnet er endret
    const unknown = after.element_options.find(
      (o) => o.element_key === "wet_room.build_year_source" && o.key === "unknown",
    );
    expect(unknown?.label).toBe("Ukjent");

    // T-0060: tiltak per TG bare på «velg TG2 eller TG3», lagret i databasen
    const chooseOutcomes = new Set(
      after.outcomes
        .filter((o) => o.kind === CHOOSE_TG2_TG3)
        .map((o) => `${o.question_key}/${o.key}`),
    );
    expect(chooseOutcomes.size).toBeGreaterThan(0);
    for (const m of after.standard_measures) {
      const choose = chooseOutcomes.has(`${m.question_key}/${m.outcome_key}`);
      if (!choose) expect(m.applies_to_tg, m.question_key).toBeNull();
    }
    for (const outcome of chooseOutcomes) {
      const tgs = after.standard_measures
        .filter((m) => `${m.question_key}/${m.outcome_key}` === outcome)
        .map((m) => m.applies_to_tg)
        .sort();
      expect(tgs, outcome).toEqual([2, 3]);
    }
    const stored = await rows<{ applies_to_tg: number | null; text_status: string }>(
      sql`select applies_to_tg, text_status from standard_measures
          where organization_id = ${context.organizationId} and deleted_at is null`,
    );
    expect(stored.some((r) => r.applies_to_tg === 2)).toBe(true);
    expect(stored.some((r) => r.applies_to_tg === 3)).toBe(true);
    expect(new Set(stored.map((r) => r.text_status))).toEqual(new Set(["draft"]));

    // v1 er urørt
    expect(
      (await getTemplateVersion(context.actor, context.organizationId, v1!.id)).document,
    ).toEqual(before);
  });
});
