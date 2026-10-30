import { sql } from "drizzle-orm";
import { boolean, check, date, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { baseColumns } from "./common";

/**
 * Selskapet i organisasjonen (docs/05-domenemodell.md 4.1). Utsteder rapporten, og har
 * ansvarsforsikring og firmatekst. Alt unntatt navnet fylles ut av admin senere.
 * Logo, regnskapstilkobling og standard rapportprofil legges til når tabellene finnes.
 */
export const companies = pgTable(
  "companies",
  {
    ...baseColumns,
    legalName: text("legal_name").notNull(),
    orgNumber: text("org_number"),
    vatRegistered: boolean("vat_registered").notNull().default(true),
    address: text("address"),
    postalCode: text("postal_code"),
    city: text("city"),
    /** Firmatekst i rapporten. */
    companyText: text("company_text"),
    liabilityInsurer: text("liability_insurer"),
    liabilityPolicyNumber: text("liability_policy_number"),
    liabilityValidTo: date("liability_valid_to"),
  },
  (table) => [
    // Mål for den sammensatte fremmednøkkelen fra employees (samme organisasjon)
    uniqueIndex("companies_organization_id_id_idx").on(table.organizationId, table.id),
    uniqueIndex("companies_organization_id_org_number_idx")
      .on(table.organizationId, table.orgNumber)
      .where(sql`${table.deletedAt} is null`),
    check(
      "companies_org_number_format_check",
      sql`${table.orgNumber} is null or ${table.orgNumber} ~ '^[0-9]{9}$'`,
    ),
  ],
);
export type Company = typeof companies.$inferSelect;

/** Kontoret. Går på tvers av selskapene (ingen `company_id`). */
export const offices = pgTable(
  "offices",
  {
    ...baseColumns,
    name: text("name").notNull(),
    address: text("address"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    uniqueIndex("offices_organization_id_id_idx").on(table.organizationId, table.id),
    uniqueIndex("offices_organization_id_name_idx")
      .on(table.organizationId, table.name)
      .where(sql`${table.deletedAt} is null`),
  ],
);
export type Office = typeof offices.$inferSelect;
