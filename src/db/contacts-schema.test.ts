import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { createFirm, createOrganization, resetDatabase } from "../../tests/factories";
import { tenantTables } from "../../tests/tenant-tables";

/*
 * Databasen selv stopper dubletter og fremmede firma (docs/funksjoner/fase2a-kontakter-firma-testplan.md
 * avsnitt 4). Direkte innsetting med SQL, utenom kjernen, så det er skrankene i databasen som
 * prøves. Feilkoden sjekkes, så en skrivefeil i et kolonnenavn ikke gir en falsk grønn test.
 *
 * Støtter hovedmål: tid (ett firma per organisasjonsnummer, D17) og reklamasjoner (en kontakt
 * kan aldri peke på et firma i en annen organisasjon). Testdata er oppdiktet.
 */

beforeEach(resetDatabase);

const CHECK = "23514";
const FOREIGN_KEY = "23503";
const UNIQUE = "23505";

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

function insertFirmSql(values: {
  organizationId: string;
  orgNumber?: string | null;
  firmType?: string;
  deletedAt?: Date | null;
}) {
  const firmType = values.firmType === undefined ? sql`default` : sql`${values.firmType}`;
  return db.execute(sql`
    insert into firms (organization_id, name, org_number, firm_type, deleted_at)
    values (
      ${values.organizationId}, 'Testmegling AS', ${values.orgNumber ?? null}, ${firmType},
      ${values.deletedAt?.toISOString() ?? null}
    )
    returning id, firm_type`);
}

function insertContactSql(values: {
  organizationId: string;
  firmId?: string | null;
  source?: string;
}) {
  const source = values.source === undefined ? sql`default` : sql`${values.source}`;
  return db.execute(sql`
    insert into contacts (organization_id, first_name, last_name, firm_id, source)
    values (${values.organizationId}, 'Megler', 'Test', ${values.firmId ?? null}, ${source})
    returning id, source`);
}

describe("4. firms og contacts i databasen", () => {
  it("4.1 to aktive firma med samme nummer i samme organisasjon → unik-feil", async () => {
    const org = await createOrganization();
    await insertFirmSql({ organizationId: org.id, orgNumber: "000000019" });
    await expectPgError(insertFirmSql({ organizationId: org.id, orgNumber: "000000019" }), UNIQUE);
  });

  it("4.2 samme nummer i to organisasjoner er lov", async () => {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    await insertFirmSql({ organizationId: orgA.id, orgNumber: "000000019" });
    await expect(
      insertFirmSql({ organizationId: orgB.id, orgNumber: "000000019" }),
    ).resolves.toBeDefined();
  });

  it("4.3 et myk-slettet firma sperrer ikke", async () => {
    const org = await createOrganization();
    await insertFirmSql({
      organizationId: org.id,
      orgNumber: "000000019",
      deletedAt: new Date("2026-11-01T08:00:00Z"),
    });
    await expect(
      insertFirmSql({ organizationId: org.id, orgNumber: "000000019" }),
    ).resolves.toBeDefined();
  });

  it("4.4 flere firma uten nummer i samme organisasjon er lov", async () => {
    const org = await createOrganization();
    await insertFirmSql({ organizationId: org.id, orgNumber: null });
    await insertFirmSql({ organizationId: org.id, orgNumber: null });
    const [row] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from firms where organization_id = ${org.id}`,
    );
    expect(row?.n).toBe(2);
  });

  it("4.5 kontakt med firma fra en annen organisasjon → avvist av den sammensatte fremmednøkkelen", async () => {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const firmB = await createFirm(orgB.id);
    await expectPgError(
      insertContactSql({ organizationId: orgA.id, firmId: firmB.id }),
      FOREIGN_KEY,
    );
    // Kontroll: samme firma i egen organisasjon går
    await expect(
      insertContactSql({ organizationId: orgB.id, firmId: firmB.id }),
    ).resolves.toBeDefined();
  });

  it("4.6 ukjent firm_type og source avvises (CHECK)", async () => {
    const org = await createOrganization();
    await expectPgError(insertFirmSql({ organizationId: org.id, firmType: "bank" }), CHECK);
    await expectPgError(insertContactSql({ organizationId: org.id, source: "import" }), CHECK);
  });

  it("4.7 standardverdier: firma får broker_firm, kontakt får manual", async () => {
    const org = await createOrganization();
    const [firm] = await insertFirmSql({ organizationId: org.id });
    expect(firm?.firm_type).toBe("broker_firm");
    const [contact] = await insertContactSql({ organizationId: org.id });
    expect(contact?.source).toBe("manual");
  });

  it("4.8 indeksene finnes", async () => {
    const result = await db.execute<{ tablename: string; indexname: string; indexdef: string }>(sql`
      select tablename, indexname, indexdef from pg_indexes
      where schemaname = 'public' and tablename in ('firms', 'contacts')`);
    const rows = [...result].map((row) => ({
      ...row,
      def: row.indexdef.replace(/\s+/g, " ").toLowerCase(),
    }));

    const duplicate = rows.find((row) => row.indexname === "firms_organization_id_org_number_idx");
    expect(duplicate, "firms_organization_id_org_number_idx").toBeDefined();
    expect(duplicate!.def).toContain("unique index");
    expect(duplicate!.def).toContain("(organization_id, org_number)");
    expect(duplicate!.def).toMatch(/where .*org_number is not null/);
    expect(duplicate!.def).toMatch(/where .*deleted_at is null/);

    expect(
      rows.some((row) => row.tablename === "firms" && row.def.includes("(organization_id, name)")),
      "indeks (organization_id, name) på firms",
    ).toBe(true);
    expect(
      rows.some(
        (row) =>
          row.tablename === "contacts" &&
          row.def.includes("(organization_id, last_name, first_name)"),
      ),
      "indeks (organization_id, last_name, first_name) på contacts",
    ).toBe(true);
  });

  it("4.9 firms og contacts står i tenant-registeret med radbygger og riktig testfil", async () => {
    const firms = tenantTables.find((entry) => entry.table === "firms");
    const contacts = tenantTables.find((entry) => entry.table === "contacts");
    expect(firms?.testFile).toBe("src/core/contacts/firms.test.ts");
    expect(contacts?.testFile).toBe("src/core/contacts/contacts.test.ts");

    // Testfilene har kallet som den samlede tenant-testen leter etter
    for (const file of [firms!.testFile!, contacts!.testFile!]) {
      const text = readFileSync(path.resolve(process.cwd(), file), "utf8");
      expect(text, file).toContain("expectTenantIsolation(");
    }

    const org = await createOrganization();
    const firmId = await firms!.insertRow(org.id);
    const contactId = await contacts!.insertRow(org.id);
    const [row] = await db.execute<{ firm: string; contact: string }>(sql`
      select
        (select organization_id from firms where id = ${firmId}) as firm,
        (select organization_id from contacts where id = ${contactId}) as contact`);
    expect(row).toEqual({ firm: org.id, contact: org.id });
  });
});
