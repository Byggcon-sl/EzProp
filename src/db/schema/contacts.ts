import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { baseColumns } from "./common";

/**
 * Firma: meglerforetak, forsikringsselskap, sameie/borettslag og andre (docs/05-domenemodell.md
 * 4.2). Organisasjonsnummeret er valgfritt, men unikt blant aktive firma i organisasjonen (D17).
 * Den unike delvise indeksen er eneste vakt mot dubletter; tjenesten gjør bruddet om til
 * `FirmDuplicateError`.
 *
 * Faste koder står i `@/core/contacts/codes`. CHECK-regelen under må ha de samme kodene.
 */
export const firms = pgTable(
  "firms",
  {
    ...baseColumns,
    name: text("name").notNull(),
    /** Ni sifre uten mellomrom, kontrollert med modulus 11 før lagring. */
    orgNumber: text("org_number"),
    firmType: text("firm_type").notNull().default("broker_firm"),
    notes: text("notes"),
  },
  (table) => [
    // Mål for sammensatte fremmednøkler fra andre tabeller (samme organisasjon)
    uniqueIndex("firms_organization_id_id_idx").on(table.organizationId, table.id),
    uniqueIndex("firms_organization_id_org_number_idx")
      .on(table.organizationId, table.orgNumber)
      .where(sql`${table.orgNumber} is not null and ${table.deletedAt} is null`),
    index("firms_organization_id_name_idx").on(table.organizationId, table.name),
    check(
      "firms_firm_type_check",
      sql`${table.firmType} in ('broker_firm', 'insurer', 'housing_association', 'other')`,
    ),
    check(
      "firms_org_number_check",
      sql`${table.orgNumber} is null or ${table.orgNumber} ~ '^[0-9]{9}$'`,
    ),
  ],
);
export type Firm = typeof firms.$inferSelect;

/**
 * Kontakt: person utenfor organisasjonen, for eksempel en megler (docs/05-domenemodell.md 4.2).
 * Personopplysninger: sendes aldri til KI, og verdiene skrives aldri i revisjonsloggen.
 * `source` sier hvor opplysningene kom fra (D17). Ingen sperre mot like kontakter.
 */
export const contacts = pgTable(
  "contacts",
  {
    ...baseColumns,
    firstName: text("first_name").notNull(),
    lastName: text("last_name"),
    email: text("email"),
    phone: text("phone"),
    firmId: uuid("firm_id"),
    notes: text("notes"),
    source: text("source").notNull().default("manual"),
  },
  (table) => [
    uniqueIndex("contacts_organization_id_id_idx").on(table.organizationId, table.id),
    index("contacts_organization_id_name_idx").on(
      table.organizationId,
      table.lastName,
      table.firstName,
    ),
    // Kontaktene i et firma (firmasiden, slå sammen firma). Nattløkken 13.11.2026.
    index("contacts_organization_id_firm_id_idx").on(table.organizationId, table.firmId),
    // Firmaet må høre til samme organisasjon som kontakten
    foreignKey({
      name: "contacts_firm_fk",
      columns: [table.organizationId, table.firmId],
      foreignColumns: [firms.organizationId, firms.id],
    }),
    check("contacts_source_check", sql`${table.source} in ('manual', 'order')`),
  ],
);
export type Contact = typeof contacts.$inferSelect;
