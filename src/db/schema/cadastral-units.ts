import { foreignKey, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { baseColumns } from "./common";
import { properties } from "./properties";

/**
 * Matrikkelen til eiendommen (docs/05-domenemodell.md 4.4): gårds-, bruks-, feste- og
 * seksjonsnummer, og for borettslag, sameie og boligaksjeselskap navn, organisasjonsnummer og
 * andelsnummer. Tabellen tåler flere rader per eiendom; skjermen viser og lagrer én (A70).
 */
export const cadastralUnits = pgTable(
  "cadastral_units",
  {
    ...baseColumns,
    propertyId: uuid("property_id").notNull(),
    gnr: text("gnr").notNull(),
    bnr: text("bnr").notNull(),
    fnr: text("fnr"),
    snr: text("snr"),
    /** Navnet på borettslaget, sameiet eller boligaksjeselskapet. */
    associationName: text("association_name"),
    associationOrgNumber: text("association_org_number"),
    /** Andelsnummer eller aksjenummer. */
    shareNumber: text("share_number"),
  },
  (table) => [
    index("cadastral_units_organization_id_property_id_idx").on(
      table.organizationId,
      table.propertyId,
    ),
    // Eiendommen må høre til samme organisasjon som matrikkelraden
    foreignKey({
      name: "cadastral_units_property_fk",
      columns: [table.organizationId, table.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }),
  ],
);
export type CadastralUnit = typeof cadastralUnits.$inferSelect;
