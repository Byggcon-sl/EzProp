import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns } from "./common";
import { reportBuildings } from "./report-buildings";

/**
 * Etasjen i en bygning (docs/05-domenemodell.md 4.4). `level` gir rekkefølgen (−3 til 20), og
 * `below_ground` brukes som forslag for rommene i etasjen (A87).
 */
export const floors = pgTable(
  "floors",
  {
    ...baseColumns,
    reportBuildingId: uuid("report_building_id").notNull(),
    name: text("name").notNull(),
    level: integer("level").notNull(),
    belowGround: boolean("below_ground").notNull().default(false),
  },
  (table) => [
    uniqueIndex("floors_organization_id_id_idx").on(table.organizationId, table.id),
    index("floors_organization_id_report_building_id_idx").on(
      table.organizationId,
      table.reportBuildingId,
    ),
    // Bygningen må høre til samme organisasjon som etasjen
    foreignKey({
      name: "floors_report_building_fk",
      columns: [table.organizationId, table.reportBuildingId],
      foreignColumns: [reportBuildings.organizationId, reportBuildings.id],
    }),
    check("floors_level_check", sql`${table.level} between -3 and 20`),
  ],
);
export type Floor = typeof floors.$inferSelect;
