import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns } from "./common";
import { firms } from "./contacts";

/**
 * Avtale med oppdragsgiver (docs/05-domenemodell.md 4.3), for eksempel Fremtind. Knyttet til et
 * firma i kontaktregisteret. Premisseteksten lagres bare til PDF-en kommer (A115, A118), og
 * logges aldri i revisjonsloggen. `report_profile_code` er en kort tekst til `report_profiles`
 * finnes (A115).
 *
 * Datoene er rene datoer (ÅÅÅÅ-MM-DD) i norsk tid. `valid_to` er siste gyldige dag; tom betyr
 * løpende.
 */
export const clientAgreements = pgTable(
  "client_agreements",
  {
    ...baseColumns,
    firmId: uuid("firm_id").notNull(),
    name: text("name").notNull(),
    validFrom: date("valid_from", { mode: "string" }).notNull(),
    validTo: date("valid_to", { mode: "string" }),
    premiseText: text("premise_text"),
    reportProfileCode: text("report_profile_code"),
  },
  (table) => [
    // Mål for sammensatte fremmednøkler fra andre tabeller (samme organisasjon)
    uniqueIndex("client_agreements_organization_id_id_idx").on(table.organizationId, table.id),
    index("client_agreements_organization_id_firm_id_idx")
      .on(table.organizationId, table.firmId)
      .where(sql`${table.deletedAt} is null`),
    // Firmaet må høre til samme organisasjon som avtalen
    foreignKey({
      name: "client_agreements_firm_fk",
      columns: [table.organizationId, table.firmId],
      foreignColumns: [firms.organizationId, firms.id],
    }),
    check(
      "client_agreements_valid_range_check",
      sql`${table.validTo} is null or ${table.validTo} >= ${table.validFrom}`,
    ),
  ],
);
export type ClientAgreement = typeof clientAgreements.$inferSelect;
