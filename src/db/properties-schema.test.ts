import { readdirSync } from "node:fs";
import path from "node:path";
import { getTableColumns, getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import {
  createAssignment,
  createOrganization,
  createProperty,
  resetDatabase,
  TEST_NOW,
} from "../../tests/factories";
import { tenantTables } from "../../tests/tenant-tables";

/*
 * Databasen selv holder reglene for eiendom, matrikkel og fellesdeler
 * (docs/funksjoner/fase2a-eiendom-matrikkel-testplan.md avsnitt 3). Direkte innsetting med SQL,
 * utenom kjernen, så det er skrankene i databasen som prøves. Feilkoden sjekkes, så en skrivefeil
 * i et kolonnenavn ikke gir en falsk grønn test.
 *
 * Støtter hovedmål: reklamasjoner (bare de faste kodene for boligtype, eierform og ja/nei, aldri
 * en eiendom eller et oppdrag fra en annen organisasjon, aldri to aktive fellesdelsrader) og KI
 * først (`data_source` er `manual` til et oppslag finnes). Testdata er oppdiktet.
 */

beforeEach(resetDatabase);

const CHECK = "23514";
const FOREIGN_KEY = "23503";
const UNIQUE = "23505";
const NOT_NULL = "23502";

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

function rows(result: unknown): Record<string, unknown>[] {
  return result as Record<string, unknown>[];
}

function insertPropertySql(values: {
  organizationId: string;
  address?: string | null;
  housingType?: string | null;
  ownershipForm?: string | null;
  dataSource?: string;
}) {
  if (values.dataSource !== undefined) {
    return db.execute(sql`
      insert into properties (organization_id, address, housing_type, ownership_form, data_source)
      values (
        ${values.organizationId},
        ${values.address === undefined ? "Testveien 1" : values.address},
        ${values.housingType === undefined ? "detached" : values.housingType},
        ${values.ownershipForm === undefined ? "freehold" : values.ownershipForm},
        ${values.dataSource}
      ) returning id, data_source`);
  }
  return db.execute(sql`
    insert into properties (organization_id, address, housing_type, ownership_form)
    values (
      ${values.organizationId},
      ${values.address === undefined ? "Testveien 1" : values.address},
      ${values.housingType === undefined ? "detached" : values.housingType},
      ${values.ownershipForm === undefined ? "freehold" : values.ownershipForm}
    ) returning id, data_source`);
}

function insertCadastralSql(values: {
  organizationId: string;
  propertyId: string | null;
  gnr?: string | null;
  bnr?: string | null;
}) {
  return db.execute(sql`
    insert into cadastral_units (organization_id, property_id, gnr, bnr)
    values (
      ${values.organizationId}, ${values.propertyId},
      ${values.gnr === undefined ? "999" : values.gnr},
      ${values.bnr === undefined ? "999" : values.bnr}
    ) returning id`);
}

function insertCommonAreasSql(values: {
  organizationId: string;
  assignmentId: string | null;
  conditionReportStatus?: string;
  maintenancePlanStatus?: string;
  deletedAt?: Date | null;
}) {
  if (values.conditionReportStatus === undefined && values.maintenancePlanStatus === undefined) {
    return db.execute(sql`
      insert into common_areas (organization_id, assignment_id, deleted_at)
      values (
        ${values.organizationId}, ${values.assignmentId},
        ${values.deletedAt ? values.deletedAt.toISOString() : null}
      ) returning id, condition_report_status, maintenance_plan_status`);
  }
  return db.execute(sql`
    insert into common_areas (
      organization_id, assignment_id, condition_report_status, maintenance_plan_status, deleted_at
    ) values (
      ${values.organizationId}, ${values.assignmentId},
      ${values.conditionReportStatus ?? "unknown"}, ${values.maintenancePlanStatus ?? "unknown"},
      ${values.deletedAt ? values.deletedAt.toISOString() : null}
    ) returning id, condition_report_status, maintenance_plan_status`);
}

async function twoOrganizations() {
  const orgA = await createOrganization("Oppdiktet takst A");
  const orgB = await createOrganization("Oppdiktet takst B");
  return { orgA, orgB };
}

describe("3.1 CHECK: bare de faste kodene", () => {
  it.each(["villa", "", "Enebolig", "bond"])("boligtypen «%s» avvises", async (housingType) => {
    const org = await createOrganization("Oppdiktet takst A");
    await expectPgError(insertPropertySql({ organizationId: org.id, housingType }), CHECK);
  });

  it.each(["bond", "", "Selveier", "obligasjon"])("eierformen «%s» avvises", async (form) => {
    const org = await createOrganization("Oppdiktet takst A");
    await expectPgError(insertPropertySql({ organizationId: org.id, ownershipForm: form }), CHECK);
  });

  it.each([
    "detached",
    "semi_detached",
    "terraced",
    "apartment",
    "apartment_in_house",
    "holiday_home",
    "farm",
    "other",
  ])("boligtypen %s godtas", async (housingType) => {
    const org = await createOrganization("Oppdiktet takst A");
    await insertPropertySql({ organizationId: org.id, housingType });
  });

  it.each(["freehold", "section", "cooperative", "share"])(
    "eierformen %s godtas",
    async (ownershipForm) => {
      const org = await createOrganization("Oppdiktet takst A");
      await insertPropertySql({ organizationId: org.id, ownershipForm });
    },
  );

  it.each(["kartverket", "", "eiendomsverdi"])("data_source «%s» avvises", async (dataSource) => {
    const org = await createOrganization("Oppdiktet takst A");
    await expectPgError(insertPropertySql({ organizationId: org.id, dataSource }), CHECK);
  });

  it.each([
    ["condition_report_status", { conditionReportStatus: "maybe" }],
    ["maintenance_plan_status", { maintenancePlanStatus: "maybe" }],
    ["condition_report_status (tom)", { conditionReportStatus: "" }],
  ] as const)("%s med ukjent kode avvises", async (_name, codes) => {
    const org = await createOrganization("Oppdiktet takst A");
    const assignment = await createAssignment(org.id);
    await expectPgError(
      insertCommonAreasSql({ organizationId: org.id, assignmentId: assignment.id, ...codes }),
      CHECK,
    );
  });

  it.each(["yes", "no", "unknown"])("ja/nei/vet ikke %s godtas i begge feltene", async (code) => {
    const org = await createOrganization("Oppdiktet takst A");
    const assignment = await createAssignment(org.id);
    await insertCommonAreasSql({
      organizationId: org.id,
      assignmentId: assignment.id,
      conditionReportStatus: code,
      maintenancePlanStatus: code,
    });
  });
});

describe("3.2 standardverdier", () => {
  it("eiendom uten data_source får manual", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const [row] = rows(await insertPropertySql({ organizationId: org.id }));
    expect(row?.data_source).toBe("manual");
  });

  it("fellesdeler uten ja/nei-felt får unknown på begge", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const assignment = await createAssignment(org.id);
    const [row] = rows(
      await insertCommonAreasSql({ organizationId: org.id, assignmentId: assignment.id }),
    );
    expect(row).toMatchObject({
      condition_report_status: "unknown",
      maintenance_plan_status: "unknown",
    });
  });
});

describe("3.3–3.5 sammensatte fremmednøkler (samme organisasjon)", () => {
  it("3.3 matrikkelrad i A som peker på eiendom i B avvises", async () => {
    const { orgA, orgB } = await twoOrganizations();
    const { property } = await createProperty(orgB.id);
    await expectPgError(
      insertCadastralSql({ organizationId: orgA.id, propertyId: property.id }),
      FOREIGN_KEY,
    );
  });

  it("3.3 matrikkelrad mot eiendom i samme organisasjon godtas", async () => {
    const { orgA } = await twoOrganizations();
    const { property } = await createProperty(orgA.id);
    await insertCadastralSql({ organizationId: orgA.id, propertyId: property.id });
  });

  it("3.4 assignments.property_id mot eiendom i en annen organisasjon avvises", async () => {
    const { orgA, orgB } = await twoOrganizations();
    const assignment = await createAssignment(orgA.id);
    const { property } = await createProperty(orgB.id);
    await expectPgError(
      db.execute(
        sql`update assignments set property_id = ${property.id} where id = ${assignment.id}`,
      ),
      FOREIGN_KEY,
    );
  });

  it("3.4 assignments.property_id mot eiendom i samme organisasjon godtas", async () => {
    const { orgA } = await twoOrganizations();
    const assignment = await createAssignment(orgA.id);
    const { property } = await createProperty(orgA.id);
    await db.execute(
      sql`update assignments set property_id = ${property.id} where id = ${assignment.id}`,
    );
  });

  it("3.4 assignments.property_id mot en eiendom som ikke finnes avvises", async () => {
    const { orgA } = await twoOrganizations();
    const assignment = await createAssignment(orgA.id);
    await expectPgError(
      db.execute(
        sql`update assignments set property_id = ${"0190a000-0000-7000-8000-0000000000ff"} where id = ${assignment.id}`,
      ),
      FOREIGN_KEY,
    );
  });

  it("3.5 fellesdeler i A på oppdrag i B avvises", async () => {
    const { orgA, orgB } = await twoOrganizations();
    const assignment = await createAssignment(orgB.id);
    await expectPgError(
      insertCommonAreasSql({ organizationId: orgA.id, assignmentId: assignment.id }),
      FOREIGN_KEY,
    );
  });
});

describe("3.6 én aktiv fellesdelsrad per oppdrag", () => {
  it("to aktive rader for samme oppdrag avvises", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const assignment = await createAssignment(org.id);
    await insertCommonAreasSql({ organizationId: org.id, assignmentId: assignment.id });
    await expectPgError(
      insertCommonAreasSql({ organizationId: org.id, assignmentId: assignment.id }),
      UNIQUE,
    );
  });

  it("en myk-slettet rad og én aktiv godtas", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const assignment = await createAssignment(org.id);
    await insertCommonAreasSql({
      organizationId: org.id,
      assignmentId: assignment.id,
      deletedAt: TEST_NOW,
    });
    await insertCommonAreasSql({ organizationId: org.id, assignmentId: assignment.id });
  });

  it("aktive rader på to ulike oppdrag godtas", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    for (let i = 0; i < 2; i += 1) {
      const assignment = await createAssignment(org.id);
      await insertCommonAreasSql({ organizationId: org.id, assignmentId: assignment.id });
    }
  });
});

describe("3.7 påkrevde felt", () => {
  it.each([
    ["address", { address: null }],
    ["housing_type", { housingType: null }],
    ["ownership_form", { ownershipForm: null }],
  ] as const)("properties.%s er påkrevd", async (_name, values) => {
    const org = await createOrganization("Oppdiktet takst A");
    await expectPgError(insertPropertySql({ organizationId: org.id, ...values }), NOT_NULL);
  });

  it.each([
    ["gnr", { gnr: null }],
    ["bnr", { bnr: null }],
  ] as const)("cadastral_units.%s er påkrevd", async (_name, values) => {
    const org = await createOrganization("Oppdiktet takst A");
    const { property } = await createProperty(org.id);
    await expectPgError(
      insertCadastralSql({ organizationId: org.id, propertyId: property.id, ...values }),
      NOT_NULL,
    );
  });

  it("cadastral_units.property_id er påkrevd", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    await expectPgError(insertCadastralSql({ organizationId: org.id, propertyId: null }), NOT_NULL);
  });

  it("common_areas.assignment_id er påkrevd", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    await expectPgError(
      insertCommonAreasSql({ organizationId: org.id, assignmentId: null }),
      NOT_NULL,
    );
  });
});

describe("3.8 oppdrag uten eiendom", () => {
  it("property_id = null godtas (eldre oppdrag)", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const assignment = await createAssignment(org.id);
    const [row] = rows(
      await db.execute(sql`select property_id from assignments where id = ${assignment.id}`),
    );
    expect(row?.property_id).toBeNull();
  });
});

describe("3.9 tenant-tabellene", () => {
  const schemaValues: unknown[] = Object.values(schema);
  const tables = schemaValues.filter((value): value is PgTable => is(value, PgTable));
  const NAMES = ["properties", "cadastral_units", "common_areas"];

  it.each(NAMES)("%s finnes i skjemaet med organization_id og deleted_at", (name) => {
    const table = tables.find((candidate) => getTableName(candidate) === name);
    expect(table, `tabellen ${name} i skjemaet`).toBeDefined();
    const columns = Object.values(getTableColumns(table!)).map((column) => column.name);
    expect(columns).toEqual(expect.arrayContaining(["organization_id", "deleted_at"]));
  });

  it("assignments har kolonnen property_id", () => {
    const columns = Object.values(getTableColumns(schema.assignments)).map((c) => c.name);
    expect(columns).toContain("property_id");
  });

  it.each(NAMES)(
    "%s står i tests/tenant-tables.ts med src/core/properties/properties.test.ts",
    async (name) => {
      const entry = tenantTables.find((candidate) => candidate.table === name);
      expect(entry, `${name} i tests/tenant-tables.ts`).toBeDefined();
      expect(entry!.testFile).toBe("src/core/properties/properties.test.ts");
      const org = await createOrganization("Oppdiktet takst A");
      const id = await entry!.insertRow(org.id);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    },
  );
});

describe("3.10 migreringen", () => {
  it("0015 finnes og er den eneste med nummeret", () => {
    const dir = path.join(process.cwd(), "src/db/migrations");
    const files = readdirSync(dir).filter((name) => name.startsWith("0015_"));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.sql$/);
  });
});
