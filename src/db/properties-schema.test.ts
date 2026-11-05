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
} from "../../tests/factories";
import { tenantTables } from "../../tests/tenant-tables";

/*
 * Databasen selv holder reglene for eiendom, matrikkel og fellesdeler
 * (docs/funksjoner/fase2a-eiendom-matrikkel-testplan.md avsnitt 3). Direkte innsetting med SQL,
 * utenom kjernen, så det er skrankene i databasen som prøves. Feilkoden sjekkes, så en
 * skrivefeil i et kolonnenavn ikke gir en falsk grønn test.
 *
 * Støtter hovedmål: reklamasjoner (bare faste koder for boligtype, eierform og ja/nei, aldri en
 * eiendom eller et oppdrag fra en annen organisasjon, aldri to aktive fellesdelsrader) og KI
 * først (`data_source = manual` som standard). Testdata er oppdiktet.
 */

beforeEach(resetDatabase);

const CHECK = "23514";
const FOREIGN_KEY = "23503";
const UNIQUE = "23505";
const NOT_NULL = "23502";
const DELETED_AT = "2026-11-03T09:00:00Z";

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

type Row = Record<string, unknown>;

function rowsOf(result: unknown): Row[] {
  return result as Row[];
}

function insertPropertySql(
  organizationId: string,
  values: {
    housingType?: string | null;
    ownershipForm?: string | null;
    address?: string | null;
  } = {},
) {
  return db.execute(sql`
    insert into properties (organization_id, address, housing_type, ownership_form)
    values (
      ${organizationId},
      ${values.address === undefined ? "Testveien 1" : values.address},
      ${values.housingType === undefined ? "apartment" : values.housingType},
      ${values.ownershipForm === undefined ? "cooperative" : values.ownershipForm}
    )
    returning id, data_source`);
}

async function propertyId(organizationId: string): Promise<string> {
  const [row] = rowsOf(await insertPropertySql(organizationId));
  return row!.id as string;
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
    )
    returning id`);
}

function insertCommonSql(values: {
  organizationId: string;
  assignmentId: string | null;
  deletedAt?: string | null;
}) {
  return db.execute(sql`
    insert into common_areas (organization_id, assignment_id, deleted_at)
    values (${values.organizationId}, ${values.assignmentId}, ${values.deletedAt ?? null})
    returning id, condition_report_status, maintenance_plan_status, managing_agent, notes`);
}

function insertCommonWithStatusSql(values: {
  organizationId: string;
  assignmentId: string;
  conditionReportStatus: string;
  maintenancePlanStatus: string;
}) {
  return db.execute(sql`
    insert into common_areas (
      organization_id, assignment_id, condition_report_status, maintenance_plan_status
    ) values (
      ${values.organizationId}, ${values.assignmentId}, ${values.conditionReportStatus},
      ${values.maintenancePlanStatus}
    )`);
}

async function twoOrgs() {
  const a = await createOrganization("Oppdiktet takst A");
  const b = await createOrganization("Oppdiktet takst B");
  return { a, b };
}

describe("3.1 CHECK på faste koder", () => {
  it.each(["villa", "", "Detached", "house"])(
    "ukjent housing_type «%s» avvises",
    async (housingType) => {
      const org = await createOrganization();
      await expectPgError(insertPropertySql(org.id, { housingType }), CHECK);
    },
  );

  it.each([
    "detached",
    "semi_detached",
    "terraced",
    "apartment",
    "apartment_in_house",
    "holiday_home",
    "farm",
    "other",
  ])("kjent housing_type %s godtas", async (housingType) => {
    const org = await createOrganization();
    await insertPropertySql(org.id, { housingType });
  });

  it.each(["bond", "", "Freehold", "rental"])(
    "ukjent ownership_form «%s» avvises (bond er ikke med, A64)",
    async (ownershipForm) => {
      const org = await createOrganization();
      await expectPgError(insertPropertySql(org.id, { ownershipForm }), CHECK);
    },
  );

  it.each(["freehold", "section", "cooperative", "share"])(
    "kjent ownership_form %s godtas",
    async (ownershipForm) => {
      const org = await createOrganization();
      await insertPropertySql(org.id, { ownershipForm });
    },
  );

  it.each(["kartverket", "eiendomsverdi", ""])(
    "data_source «%s» avvises (bare manual nå)",
    async (dataSource) => {
      const org = await createOrganization();
      await expectPgError(
        db.execute(sql`
          insert into properties (organization_id, address, housing_type, ownership_form, data_source)
          values (${org.id}, 'Testveien 1', 'detached', 'freehold', ${dataSource})`),
        CHECK,
      );
    },
  );

  it.each([
    ["condition_report_status", "maybe", "unknown"],
    ["maintenance_plan_status", "unknown", "maybe"],
    ["condition_report_status", "Ja", "unknown"],
  ])("%s med ukjent kode avvises", async (_column, condition, maintenance) => {
    const org = await createOrganization();
    const assignment = await createAssignment(org.id);
    await expectPgError(
      insertCommonWithStatusSql({
        organizationId: org.id,
        assignmentId: assignment.id,
        conditionReportStatus: condition,
        maintenancePlanStatus: maintenance,
      }),
      CHECK,
    );
  });

  it.each(["yes", "no", "unknown"])("ja/nei-koden %s godtas i begge kolonnene", async (code) => {
    const org = await createOrganization();
    const assignment = await createAssignment(org.id);
    await insertCommonWithStatusSql({
      organizationId: org.id,
      assignmentId: assignment.id,
      conditionReportStatus: code,
      maintenancePlanStatus: code,
    });
  });
});

describe("3.2 standardverdier", () => {
  it("data_source er manual når den ikke er satt", async () => {
    const org = await createOrganization();
    const [row] = rowsOf(await insertPropertySql(org.id));
    expect(row!.data_source).toBe("manual");
  });

  it("fellesdeler uten ja/nei-felt får unknown på begge, og tom forretningsfører og notater", async () => {
    const org = await createOrganization();
    const assignment = await createAssignment(org.id);
    const [row] = rowsOf(
      await insertCommonSql({ organizationId: org.id, assignmentId: assignment.id }),
    );
    expect(row).toMatchObject({
      condition_report_status: "unknown",
      maintenance_plan_status: "unknown",
      managing_agent: null,
      notes: null,
    });
  });
});

describe("3.3–3.5 sammensatte fremmednøkler på tvers av organisasjoner", () => {
  it("3.3 matrikkelrad i A som peker på eiendom i B avvises", async () => {
    const { a, b } = await twoOrgs();
    const foreign = await propertyId(b.id);
    await expectPgError(
      insertCadastralSql({ organizationId: a.id, propertyId: foreign }),
      FOREIGN_KEY,
    );
  });

  it("3.3 matrikkelrad mot egen eiendom godtas", async () => {
    const { a } = await twoOrgs();
    const own = await propertyId(a.id);
    await insertCadastralSql({ organizationId: a.id, propertyId: own });
  });

  it("3.3 matrikkelrad mot eiendom som ikke finnes avvises", async () => {
    const { a } = await twoOrgs();
    await expectPgError(
      insertCadastralSql({
        organizationId: a.id,
        propertyId: "0190a000-0000-7000-8000-000000000099",
      }),
      FOREIGN_KEY,
    );
  });

  it("3.4 assignments.property_id mot eiendom i en annen organisasjon avvises", async () => {
    const { a, b } = await twoOrgs();
    const assignment = await createAssignment(a.id);
    const foreign = await propertyId(b.id);
    await expectPgError(
      db.execute(sql`update assignments set property_id = ${foreign} where id = ${assignment.id}`),
      FOREIGN_KEY,
    );
  });

  it("3.4 assignments.property_id mot egen eiendom godtas", async () => {
    const { a } = await twoOrgs();
    const assignment = await createAssignment(a.id);
    const own = await propertyId(a.id);
    await db.execute(sql`update assignments set property_id = ${own} where id = ${assignment.id}`);
  });

  it("3.4 assignments.property_id mot eiendom som ikke finnes avvises", async () => {
    const { a } = await twoOrgs();
    const assignment = await createAssignment(a.id);
    await expectPgError(
      db.execute(
        sql`update assignments set property_id = ${"0190a000-0000-7000-8000-0000000000ff"} where id = ${assignment.id}`,
      ),
      FOREIGN_KEY,
    );
  });

  it("3.5 fellesdeler i A på oppdrag i B avvises", async () => {
    const { a, b } = await twoOrgs();
    const foreign = await createAssignment(b.id);
    await expectPgError(
      insertCommonSql({ organizationId: a.id, assignmentId: foreign.id }),
      FOREIGN_KEY,
    );
  });
});

describe("3.6 én aktiv fellesdelsrad per oppdrag", () => {
  it("to aktive rader for samme oppdrag avvises (unik delvis indeks)", async () => {
    const org = await createOrganization();
    const assignment = await createAssignment(org.id);
    await insertCommonSql({ organizationId: org.id, assignmentId: assignment.id });
    await expectPgError(
      insertCommonSql({ organizationId: org.id, assignmentId: assignment.id }),
      UNIQUE,
    );
  });

  it("en myk-slettet rad sperrer ikke for en ny aktiv rad", async () => {
    const org = await createOrganization();
    const assignment = await createAssignment(org.id);
    await insertCommonSql({
      organizationId: org.id,
      assignmentId: assignment.id,
      deletedAt: DELETED_AT,
    });
    await insertCommonSql({ organizationId: org.id, assignmentId: assignment.id });
  });

  it("to myk-slettede rader og én aktiv godtas", async () => {
    const org = await createOrganization();
    const assignment = await createAssignment(org.id);
    for (let i = 0; i < 2; i++) {
      await insertCommonSql({
        organizationId: org.id,
        assignmentId: assignment.id,
        deletedAt: DELETED_AT,
      });
    }
    await insertCommonSql({ organizationId: org.id, assignmentId: assignment.id });
  });

  it("aktive rader på to ulike oppdrag godtas", async () => {
    const org = await createOrganization();
    const first = await createAssignment(org.id);
    const second = await createAssignment(org.id);
    await insertCommonSql({ organizationId: org.id, assignmentId: first.id });
    await insertCommonSql({ organizationId: org.id, assignmentId: second.id });
  });
});

describe("3.7 påkrevde felt", () => {
  it.each([
    ["address", { address: null }],
    ["housing_type", { housingType: null }],
    ["ownership_form", { ownershipForm: null }],
  ] as const)("properties.%s er NOT NULL", async (_column, values) => {
    const org = await createOrganization();
    await expectPgError(insertPropertySql(org.id, values), NOT_NULL);
  });

  it.each([
    ["gnr", { gnr: null }],
    ["bnr", { bnr: null }],
  ] as const)("cadastral_units.%s er NOT NULL", async (_column, values) => {
    const org = await createOrganization();
    const own = await propertyId(org.id);
    await expectPgError(
      insertCadastralSql({ organizationId: org.id, propertyId: own, ...values }),
      NOT_NULL,
    );
  });

  it("cadastral_units.property_id er NOT NULL", async () => {
    const org = await createOrganization();
    await expectPgError(insertCadastralSql({ organizationId: org.id, propertyId: null }), NOT_NULL);
  });

  it("common_areas.assignment_id er NOT NULL", async () => {
    const org = await createOrganization();
    await expectPgError(insertCommonSql({ organizationId: org.id, assignmentId: null }), NOT_NULL);
  });

  it("valgfrie felt kan stå tomme: postnummer, sted, kommune, fnr, snr, borettslag, org.nr. og andelsnummer", async () => {
    const org = await createOrganization();
    const { property, cadastralUnit } = await createProperty(org.id);
    expect(property).toMatchObject({
      postalCode: null,
      city: null,
      municipalityNumber: null,
      municipalityName: null,
    });
    expect(cadastralUnit).toMatchObject({
      fnr: null,
      snr: null,
      associationName: null,
      associationOrgNumber: null,
      shareNumber: null,
    });
  });
});

describe("3.8 oppdrag uten eiendom", () => {
  it("property_id = null godtas (eldre oppdrag)", async () => {
    const org = await createOrganization();
    const assignment = await createAssignment(org.id);
    const result = rowsOf(
      await db.execute(sql`select property_id from assignments where id = ${assignment.id}`),
    );
    expect(result[0]!.property_id).toBeNull();
  });

  it("en eiendom tåler flere matrikkelrader (domenemodellen; skjermen viser én, A65)", async () => {
    const org = await createOrganization();
    const own = await propertyId(org.id);
    await insertCadastralSql({ organizationId: org.id, propertyId: own });
    await insertCadastralSql({ organizationId: org.id, propertyId: own, gnr: "998" });
  });
});

describe("3.9 tenant-tabellene", () => {
  const schemaValues: unknown[] = Object.values(schema);
  const tables = schemaValues.filter((value): value is PgTable => is(value, PgTable));
  const NAMES = ["properties", "cadastral_units", "common_areas"] as const;

  it.each(NAMES)("%s finnes i skjemaet med organization_id og deleted_at", (name) => {
    const table = tables.find((candidate) => getTableName(candidate) === name);
    expect(table, `tabellen ${name} i skjemaet`).toBeDefined();
    const columns = Object.values(getTableColumns(table!)).map((column) => column.name);
    expect(columns).toEqual(expect.arrayContaining(["organization_id", "deleted_at"]));
  });

  it("assignments har kolonnen property_id", () => {
    const table = tables.find((candidate) => getTableName(candidate) === "assignments");
    const columns = Object.values(getTableColumns(table!)).map((column) => column.name);
    expect(columns).toContain("property_id");
  });

  it.each(NAMES)(
    "%s står i tests/tenant-tables.ts med testfilen for eiendom, og radbyggeren virker",
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
