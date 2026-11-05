import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns } from "./common";
import { floors } from "./floors";

/**
 * Rommet i en etasje (docs/05-domenemodell.md 4.4): romtype (fast kode, A79), navn (tomt betyr at
 * romtypens navn vises), arealtype og «under terreng» (forslag fra romtype og etasje, A81).
 * `geometry` kommer med plantegning (K7).
 *
 * Faste koder står i `@/core/buildings/codes`. CHECK-reglene under må ha de samme kodene.
 */
export const rooms = pgTable(
  "rooms",
  {
    ...baseColumns,
    floorId: uuid("floor_id").notNull(),
    roomType: text("room_type").notNull(),
    name: text("name"),
    areaType: text("area_type").notNull(),
    belowGround: boolean("below_ground").notNull(),
  },
  (table) => [
    uniqueIndex("rooms_organization_id_id_idx").on(table.organizationId, table.id),
    index("rooms_organization_id_floor_id_idx").on(table.organizationId, table.floorId),
    // Etasjen må høre til samme organisasjon som rommet
    foreignKey({
      name: "rooms_floor_fk",
      columns: [table.organizationId, table.floorId],
      foreignColumns: [floors.organizationId, floors.id],
    }),
    check(
      "rooms_room_type_check",
      sql`${table.roomType} in ('bathroom', 'laundry', 'bathroom_laundry', 'room_with_drain', 'other_wet_room', 'kitchen', 'living_kitchen', 'toilet', 'sauna', 'boiler_room', 'technical_room', 'cold_room', 'swimming_pool', 'living_room', 'bedroom', 'office', 'family_room', 'dining_room', 'entrance', 'hallway', 'stairwell', 'wardrobe', 'storage', 'external_storage', 'basement_living_room', 'basement_room', 'crawl_space', 'attic_living_room', 'unfinished_attic', 'garage', 'glazed_balcony', 'workshop', 'other')`,
    ),
    check("rooms_area_type_check", sql`${table.areaType} in ('bra_i', 'bra_e', 'bra_b')`),
  ],
);
export type Room = typeof rooms.$inferSelect;
