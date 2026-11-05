import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { contacts, firms } from "@/db/schema";
import {
  createContact,
  createFirm,
  createOrganization,
  resetDatabase,
} from "../../tests/factories";
import { tenantTables } from "../../tests/tenant-tables";

/*
 * Tabellene firms og contacts direkte i databasen (uten tjenestene).
 * Testplan: docs/funksjoner/fase2a-kontakter-firma-testplan.md avsnitt 4.
 * Testdata er oppdiktet. Ingen ny spørring med organizationId her, så filen trenger ikke
 * expectTenantIsolation (den står i src/core/contacts/firms.test.ts og contacts.test.ts).
 * Støtter hovedmål: tid (ett firma per organisasjonsnummer) og reklamasjoner (kilde på kontakten).
 */

beforeEach(resetDatabase);

describe("firms", () => {
  it("to aktive firma med samme nummer i samme organisasjon avvises", async () => {
    const org = await createOrganization();
    await createFirm(org.id, { orgNumber: "000000019" });
    await expect(createFirm(org.id, { orgNumber: "000000019" })).rejects.toThrow();
  });

  it("samme nummer i to organisasjoner er lov", async () => {
    const a = await createOrganization("Organisasjon A");
    const b = await createOrganization("Organisasjon B");
    await createFirm(a.id, { orgNumber: "000000019" });
    await expect(createFirm(b.id, { orgNumber: "000000019" })).resolves.toBeDefined();
  });

  it("et myk-slettet firma sperrer ikke", async () => {
    const org = await createOrganization();
    await createFirm(org.id, { orgNumber: "000000019", deletedAt: new Date() });
    await expect(createFirm(org.id, { orgNumber: "000000019" })).resolves.toBeDefined();
  });

  it("flere firma uten nummer er lov", async () => {
    const org = await createOrganization();
    await createFirm(org.id, { orgNumber: null });
    await expect(createFirm(org.id, { orgNumber: null })).resolves.toBeDefined();
  });

  it("ukjent firmatype avvises, og standard er broker_firm", async () => {
    const org = await createOrganization();
    await expect(createFirm(org.id, { firmType: "bank" })).rejects.toThrow();
    const [row] = await db
      .insert(firms)
      .values({ organizationId: org.id, name: "Testmegling AS" })
      .returning();
    expect(row?.firmType).toBe("broker_firm");
  });
});

describe("contacts", () => {
  it("kontakt med firma fra en annen organisasjon avvises av den sammensatte nøkkelen", async () => {
    const a = await createOrganization("Organisasjon A");
    const b = await createOrganization("Organisasjon B");
    const firmB = await createFirm(b.id);
    await expect(createContact(a.id, { firmId: firmB.id })).rejects.toThrow();
  });

  it("ukjent kilde avvises, og standard er manual", async () => {
    const org = await createOrganization();
    await expect(createContact(org.id, { source: "import" })).rejects.toThrow();
    const [row] = await db
      .insert(contacts)
      .values({ organizationId: org.id, firstName: "Megler" })
      .returning();
    expect(row?.source).toBe("manual");
  });
});

describe("indekser og registre", () => {
  it("indeksene finnes", async () => {
    const rows = await db.execute<{ indexname: string; indexdef: string }>(sql`
      select indexname, indexdef from pg_indexes where tablename in ('firms', 'contacts')
    `);
    const defs = Object.fromEntries(rows.map((row) => [row.indexname, row.indexdef]));
    expect(defs.firms_organization_id_org_number_idx).toMatch(/UNIQUE INDEX/);
    expect(defs.firms_organization_id_org_number_idx).toMatch(/org_number IS NOT NULL/);
    expect(defs.firms_organization_id_org_number_idx).toMatch(/deleted_at IS NULL/);
    expect(defs.firms_organization_id_name_idx).toMatch(/\(organization_id, name\)/);
    expect(defs.contacts_organization_id_name_idx).toMatch(
      /\(organization_id, last_name, first_name\)/,
    );
  });

  it("firms og contacts står i tenant-registeret med riktige testfiler", () => {
    const byTable = Object.fromEntries(tenantTables.map((entry) => [entry.table, entry.testFile]));
    expect(byTable.firms).toBe("src/core/contacts/firms.test.ts");
    expect(byTable.contacts).toBe("src/core/contacts/contacts.test.ts");
  });
});
