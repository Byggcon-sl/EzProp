import { foreignKey, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { assignments } from "./assignments";
import { baseColumns } from "./common";

/**
 * Bygningen i rapporten (docs/05-domenemodell.md 4.4), enkel utgave i fase 2a: bare navnet.
 * Lagres per oppdrag til rapportene finnes (A94); da får tabellen `report_id`. Eiendommen finnes
 * via `assignments.property_id`, så den kan ikke komme i utakt.
 */
export const reportBuildings = pgTable(
  "report_buildings",
  {
    ...baseColumns,
    assignmentId: uuid("assignment_id").notNull(),
    name: text("name").notNull(),
  },
  (table) => [
    // Mål for sammensatte fremmednøkler fra andre tabeller (samme organisasjon)
    uniqueIndex("report_buildings_organization_id_id_idx").on(table.organizationId, table.id),
    index("report_buildings_organization_id_assignment_id_idx").on(
      table.organizationId,
      table.assignmentId,
    ),
    // Oppdraget må høre til samme organisasjon som bygningen
    foreignKey({
      name: "report_buildings_assignment_fk",
      columns: [table.organizationId, table.assignmentId],
      foreignColumns: [assignments.organizationId, assignments.id],
    }),
  ],
);
export type ReportBuilding = typeof reportBuildings.$inferSelect;
