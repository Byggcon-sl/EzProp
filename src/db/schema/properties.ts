import { sql } from "drizzle-orm";
import { check, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { baseColumns } from "./common";

/**
 * Eiendommen (docs/05-domenemodell.md 4.4), enkel utgave i fase 2a: adresse, kommune, boligtype og
 * eierform, lagt inn for hånd (`data_source = manual`). Hvert oppdrag har sin egen eiendom til søk
 * og gjenbruk kommer (A70). Matrikkelen står i `cadastral_units`.
 *
 * Faste koder står i `@/core/properties/codes`. CHECK-reglene under må ha de samme kodene.
 */
export const properties = pgTable(
  "properties",
  {
    ...baseColumns,
    address: text("address").notNull(),
    postalCode: text("postal_code"),
    city: text("city"),
    municipalityNumber: text("municipality_number"),
    municipalityName: text("municipality_name"),
    housingType: text("housing_type").notNull(),
    ownershipForm: text("ownership_form").notNull(),
    /** Hvor feltene kommer fra. Bare `manual` nå; senere et oppslag (KI først). */
    dataSource: text("data_source").notNull().default("manual"),
  },
  (table) => [
    // Mål for sammensatte fremmednøkler fra andre tabeller (samme organisasjon)
    uniqueIndex("properties_organization_id_id_idx").on(table.organizationId, table.id),
    check(
      "properties_housing_type_check",
      sql`${table.housingType} in ('detached', 'semi_detached', 'terraced', 'apartment', 'apartment_in_house', 'holiday_home', 'farm', 'other')`,
    ),
    check(
      "properties_ownership_form_check",
      sql`${table.ownershipForm} in ('freehold', 'section', 'cooperative', 'share')`,
    ),
    check("properties_data_source_check", sql`${table.dataSource} in ('manual')`),
  ],
);
export type Property = typeof properties.$inferSelect;
