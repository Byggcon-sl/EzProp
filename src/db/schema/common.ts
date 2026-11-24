import { sql } from "drizzle-orm";
import { integer, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

/**
 * Formatet på en fast kode (`key`, regel 6) som regulært uttrykk i PostgreSQL: små bokstaver, tall
 * og `_`, delt med punktum. Samme mønster som `TEMPLATE_KEY_PATTERN` i `templates.ts`. Står ett
 * sted, slik at CHECK-reglene i alle tabeller som lagrer en fast kode, er like.
 */
export const KEY_PATTERN_SQL = "^[a-z0-9_]+(\\.[a-z0-9_]+)*$";

/**
 * Felles kolonner på alle tabeller (docs/05-domenemodell.md avsnitt 3):
 * - `id` lages på enheten (UUID v7, `@/shared/lib/uuid`). Databasen setter en tilfeldig id bare
 *   når enheten ikke har sendt en.
 * - `organization_id`: alle spørringer filtreres på denne.
 * - laget/endret av og når, myk sletting, og `row_version` til synkronisering.
 *
 * `created_by` og co. er bruker-id fra innloggingen (tekst, Better Auth), ikke en fremmednøkkel,
 * slik at rader fra enheter kan tas imot uten nett og uten oppslag.
 */
export const baseColumns = {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  updatedBy: text("updated_by"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: text("deleted_by"),
  rowVersion: integer("row_version")
    .notNull()
    .default(1)
    .$onUpdate(() => sql`row_version + 1`),
};
