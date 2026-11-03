import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable, type PgColumn } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it } from "vitest";
import { requireOrganizationAccess, type Actor } from "@/core/access";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { createOrganization, RESET_TABLES, resetDatabase } from "./factories";
import { expectTenantIsolation } from "./tenant-isolation";
import {
  checkTenantRegistry,
  insertMinimalRow,
  tenantTables,
  type TenantTableEntry,
} from "./tenant-tables";

/**
 * Samlet bevis for tenant-isolasjon: hver tabell med `organization_id` i skjemaet får én sak med
 * `expectTenantIsolation`, og vakten `checkTenantRegistry` sørger for at hver slik tabell har en
 * egen tenant-test i modulen sin. Tabellene hentes fra Drizzle-skjemaet, ikke fra en håndskrevet liste.
 */

const schemaValues: unknown[] = Object.values(schema);
const allTables = schemaValues.filter((value): value is PgTable => is(value, PgTable));

function organizationColumn(table: PgTable): PgColumn | undefined {
  return Object.values(getTableColumns(table)).find((column) => column.name === "organization_id");
}

function column(table: PgTable, name: string): PgColumn {
  const found = Object.values(getTableColumns(table)).find((c) => c.name === name);
  if (!found) throw new Error(`tabellen ${getTableName(table)} mangler kolonnen ${name}`);
  return found;
}

const tenantTableList = allTables.filter((table) => organizationColumn(table) !== undefined);
const tenantTableNames = tenantTableList.map((table) => getTableName(table));
const globalTableNames = allTables
  .filter((table) => organizationColumn(table) === undefined)
  .map((table) => getTableName(table))
  .sort();

const tableCases = tenantTableList.map((table) => ({ name: getTableName(table), table }));

/** Leser filen fra repoet; `null` når den ikke finnes. */
function readText(relativePath: string): string | null {
  try {
    return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Generisk lesespørring for én tabell. Tilgangen sjekkes først, og filteret bruker
 * `grant.organizationId` fra tilgangssjekken, aldri parameteren.
 */
async function readRows(table: PgTable, actor: Actor, organizationId: string) {
  const grant = await requireOrganizationAccess(actor, organizationId); // standardrettigheten organization.read
  const columns = getTableColumns(table);
  const id = columns.id;
  const orgColumn = columns.organizationId;
  if (!id || !orgColumn)
    throw new Error(`tabellen ${getTableName(table)} mangler id eller organization_id`);
  return db.select({ id }).from(table).where(eq(orgColumn, grant.organizationId));
}

/**
 * Sammenligner tabellnavnene fra skjemaet med `RESET_TABLES`. Gir navnene som mangler på hver
 * side, sortert, slik at en glemt tabell navngis i meldingen i stedet for et tall.
 */
function compareTableLists(
  schemaNames: readonly string[],
  resetNames: readonly string[],
): { missingInResetTables: string[]; missingInSchema: string[] } {
  const inSchema = new Set(schemaNames);
  const inReset = new Set(resetNames);
  return {
    missingInResetTables: [...inSchema].filter((name) => !inReset.has(name)).sort(),
    missingInSchema: [...inReset].filter((name) => !inSchema.has(name)).sort(),
  };
}

/** Oppdiktet register-oppføring til selvtestene av vakten. */
function entry(table: string, testFile: string | null, reason?: string): TenantTableEntry {
  return { table, testFile, reason, insertRow: async () => "x" };
}

const GOOD_TEXT = "await expectTenantIsolation({ seed, query, idOf });";

describe("tabellene fra skjemaet", () => {
  it("U1 finner alle tabeller med organization_id fra skjemaet", () => {
    expect(tenantTableNames.length).toBeGreaterThan(0);
    expect(new Set(tenantTableNames).size).toBe(tenantTableNames.length);
    for (const table of tenantTableList) {
      expect(organizationColumn(table)?.notNull, getTableName(table)).toBe(true);
    }
    expect(compareTableLists([...tenantTableNames, ...globalTableNames], RESET_TABLES)).toEqual({
      missingInResetTables: [],
      missingInSchema: [],
    });
    expect(tenantTableNames).toContain("employee_roles");
    expect(tenantTableNames).toContain("files");
  });

  it("U1b hjelperen navngir en tabell i skjemaet som mangler i RESET_TABLES", () => {
    expect(
      compareTableLists(
        [...tenantTableNames, ...globalTableNames, "oppdiktet_tabell"],
        RESET_TABLES,
      ),
    ).toEqual({ missingInResetTables: ["oppdiktet_tabell"], missingInSchema: [] });
  });

  it("U1c hjelperen navngir en tabell i RESET_TABLES som mangler i skjemaet", () => {
    expect(
      compareTableLists(
        [...tenantTableNames, ...globalTableNames],
        [...RESET_TABLES, "oppdiktet_tabell"],
      ),
    ).toEqual({ missingInResetTables: [], missingInSchema: ["oppdiktet_tabell"] });
  });

  it("U2 tabellene uten organization_id er nøyaktig de seks kjente", () => {
    expect(globalTableNames).toEqual([
      "accounts",
      "login_attempts",
      "organizations",
      "sessions",
      "users",
      "verifications",
    ]);
  });
});

describe("vakten checkTenantRegistry", () => {
  it("U3 vakten er grønn mot det ekte registeret og de ekte filene", () => {
    const errors = checkTenantRegistry({
      tables: tenantTableNames,
      registry: tenantTables,
      readText,
    });
    expect(errors).toEqual([]);
  });

  it("U4 vakten er rød når en tabell mangler i registeret", () => {
    const errors = checkTenantRegistry({
      tables: ["a", "b"],
      registry: [entry("a", "src/core/x/x.test.ts")],
      readText: () => GOOD_TEXT,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/\bb\b/);
    expect(errors[0]).toContain("tests/tenant-tables.ts");
  });

  it("U5 vakten er rød når registeret nevner en tabell som ikke finnes", () => {
    const errors = checkTenantRegistry({
      tables: ["a"],
      registry: [entry("a", "src/core/x/x.test.ts"), entry("x", "src/core/x/x.test.ts")],
      readText: () => GOOD_TEXT,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/\bx\b/);
  });

  it("U6 vakten er rød når testFile ikke finnes", () => {
    const errors = checkTenantRegistry({
      tables: ["a"],
      registry: [entry("a", "src/core/x/x.test.ts")],
      readText: () => null,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/\ba\b/);
    expect(errors[0]).toContain("src/core/x/x.test.ts");
  });

  it.each([
    ["uten teksten", "it('noe', () => {});"],
    [
      "med navnet uten parentes",
      'import { expectTenantIsolation } from "../../../tests/tenant-isolation";\n// expectTenantIsolation',
    ],
  ])("U7 vakten er rød når testFile mangler expectTenantIsolation( (%s)", (_label, text) => {
    const errors = checkTenantRegistry({
      tables: ["a"],
      registry: [entry("a", "src/core/x/x.test.ts")],
      readText: () => text,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/\ba\b/);
  });

  it("U8 vakten er rød når testFile er null uten reason", () => {
    const run = (reason?: string) =>
      checkTenantRegistry({
        tables: ["a"],
        registry: [entry("a", null, reason)],
        readText: () => GOOD_TEXT,
      });
    expect(run(undefined)).toHaveLength(1);
    expect(run("")).toHaveLength(1);
    expect(run("ingen lesespørring i produktkoden ennå")).toEqual([]);
  });

  it.each([
    "tests/tenant-isolation.test.ts",
    "src/core/x/x.ts",
    "src/core/x/x.dev.test.ts",
    "src/../tests/tenant-isolation-all-tables.test.ts",
    "src/core/./x.test.ts",
  ])(
    "U10 vakten er rød når testFile peker utenfor src/ eller har feil endelse (%s)",
    (testFile) => {
      const errors = checkTenantRegistry({
        tables: ["a"],
        registry: [entry("a", testFile)],
        readText: () => GOOD_TEXT,
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(testFile);
    },
  );
});

describe("registeret tests/tenant-tables.ts", () => {
  it("U12 events står med testFile null og begrunnelse", () => {
    const eventsEntry = tenantTables.find((e) => e.table === "events");
    expect(eventsEntry?.testFile).toBeNull();
    expect(eventsEntry?.reason?.trim()).toBeTruthy();
    const otherNulls = tenantTables
      .filter((e) => e.table !== "events" && e.testFile === null)
      .map((e) => e.table);
    expect(otherNulls).toEqual([]);
  });

  it("U13 hver oppføring i registeret peker på hovedtestfilen for modulen", () => {
    const wrong = tenantTables.filter(
      (e) =>
        e.testFile !== null &&
        (e.testFile.endsWith("admin-core.test.ts") ||
          e.testFile.endsWith("integrations.dev.test.ts")),
    );
    expect(wrong.map((e) => `${e.table}: ${e.testFile}`)).toEqual([]);
  });
});

describe("tenant-isolasjon mot testdatabasen", () => {
  beforeEach(resetDatabase);

  it.each(tableCases)("isolasjon: $name", async ({ name, table }) => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => ({
        a: [await insertMinimalRow(name, grantA.organizationId)],
        b: [await insertMinimalRow(name, grantB.organizationId)],
      }),
      query: (actor, organizationId) => readRows(table, actor, organizationId),
      idOf: (row) => row.id as string,
    });
  });

  it("I14 radbygger for ukjent tabell feiler med tabellnavnet i meldingen", async () => {
    const org = await createOrganization();
    const attempt = insertMinimalRow("finnes_ikke", org.id);
    await expect(attempt).rejects.toThrow(/finnes_ikke/);
    await expect(attempt).rejects.toThrow(/tests\/tenant-tables\.ts/);
  });

  /** Tabeller der radbyggeren må lage en foreldre-rad (I16). */
  const PARENTS: Record<string, { column: string; parent: PgTable }> = {
    certifications: { column: "employee_id", parent: schema.employees },
    employee_roles: { column: "employee_id", parent: schema.employees },
    employee_permissions: { column: "employee_id", parent: schema.employees },
    trial_answers: { column: "trial_form_id", parent: schema.trialForms },
    trial_photos: { column: "trial_form_id", parent: schema.trialForms },
  };

  it("I16 foreldre-tabellene finnes i skjemaet med organization_id", () => {
    for (const name of Object.keys(PARENTS)) expect(tenantTableNames).toContain(name);
  });

  it.each(tableCases)(
    "I15/I16 radbyggeren legger raden (og foreldre-raden) i oppgitt organisasjon: $name",
    async ({ name, table }) => {
      // En annen organisasjon får rad først, så en radbygger som gjenbruker en eksisterende
      // rad eller foreldre-rad fra feil organisasjon blir avslørt.
      const other = await createOrganization("Oppdiktet nabo AS");
      await insertMinimalRow(name, other.id);
      const org = await createOrganization("Oppdiktet takst AS");
      const id = await insertMinimalRow(name, org.id);
      const [row] = await db
        .select({
          organizationId: column(table, "organization_id"),
          deletedAt: column(table, "deleted_at"),
        })
        .from(table)
        .where(eq(column(table, "id"), id));
      expect(row).toBeDefined();
      expect(row?.organizationId).toBe(org.id);
      expect(row?.deletedAt).toBeNull();

      // I16: foreldre-raden ligger i samme organisasjon.
      const link = PARENTS[name];
      if (link) {
        const [child] = await db
          .select({ parentId: column(table, link.column) })
          .from(table)
          .where(eq(column(table, "id"), id));
        const [parent] = await db
          .select({ organizationId: column(link.parent, "organization_id") })
          .from(link.parent)
          .where(eq(column(link.parent, "id"), child?.parentId as string));
        expect(parent?.organizationId).toBe(org.id);
      }
    },
  );
});
