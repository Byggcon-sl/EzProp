import { sql } from "drizzle-orm";
import { check, foreignKey, numeric, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { baseColumns } from "./common";
import { employees } from "./employees";
import { floors } from "./floors";

/** Areal i m² med én desimal (0–9999,9). Tallet kommer ut som `number`. */
function area(name: string) {
  return numeric(name, { precision: 7, scale: 1, mode: "number" });
}

/**
 * Arealet per etasje (docs/05-domenemodell.md 4.4, A86): BRA-i, BRA-e, BRA-b og ALH, hvem som
 * målte, metoden og en kommentar. Én aktiv rad per etasje. BRA er summen av BRA-i, BRA-e og BRA-b
 * og lagres ikke (`sumFloorArea` i `@/core/buildings`).
 *
 * Faste koder (`laser`, `drawing`, `other`) står i `@/core/buildings/codes`.
 */
export const floorAreas = pgTable(
  "floor_areas",
  {
    ...baseColumns,
    floorId: uuid("floor_id").notNull(),
    braI: area("bra_i"),
    braE: area("bra_e"),
    braB: area("bra_b"),
    alh: area("alh"),
    /** Den ansatte som målte. */
    measuredBy: uuid("measured_by"),
    method: text("method"),
    comment: text("comment"),
  },
  (table) => [
    uniqueIndex("floor_areas_organization_id_id_idx").on(table.organizationId, table.id),
    // Én aktiv rad per etasje
    uniqueIndex("floor_areas_active_floor_idx")
      .on(table.organizationId, table.floorId)
      .where(sql`${table.deletedAt} is null`),
    // Etasjen og den som målte må høre til samme organisasjon som raden
    foreignKey({
      name: "floor_areas_floor_fk",
      columns: [table.organizationId, table.floorId],
      foreignColumns: [floors.organizationId, floors.id],
    }),
    foreignKey({
      name: "floor_areas_measured_by_fk",
      columns: [table.organizationId, table.measuredBy],
      foreignColumns: [employees.organizationId, employees.id],
    }),
    check("floor_areas_bra_i_check", sql`${table.braI} >= 0`),
    check("floor_areas_bra_e_check", sql`${table.braE} >= 0`),
    check("floor_areas_bra_b_check", sql`${table.braB} >= 0`),
    check("floor_areas_alh_check", sql`${table.alh} >= 0`),
    check("floor_areas_method_check", sql`${table.method} in ('laser', 'drawing', 'other')`),
  ],
);
export type FloorArea = typeof floorAreas.$inferSelect;
