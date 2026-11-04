import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

/**
 * Nummerserier (docs/05-domenemodell.md 4.3): én teller per organisasjon, formål og prefiks,
 * for eksempel oppdragsnumrene for 2026 (`scope = assignment`, `prefix = 2026-`).
 *
 * Numre lages bare på serveren (D9). Tabellen skrives bare fra `nextAssignmentNumber` i
 * `src/core/assignments/number-sequence.ts`, med lås i databasen. Ingen myk sletting: raden er
 * en teller, ikke et dokument.
 */
export const numberSequences = pgTable(
  "number_sequences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    /** Fast kode fra `NUMBER_SEQUENCE_SCOPES` i `@/core/assignments/codes`. */
    scope: text("scope").notNull(),
    prefix: text("prefix").notNull(),
    /** Neste nummer som deles ut. */
    nextValue: integer("next_value").notNull().default(1),
    /** Minste antall sifre (fylles med nuller foran). Større tall får flere sifre. */
    padding: integer("padding").notNull().default(5),
  },
  (table) => [
    uniqueIndex("number_sequences_organization_id_scope_prefix_idx").on(
      table.organizationId,
      table.scope,
      table.prefix,
    ),
    check("number_sequences_scope_check", sql`${table.scope} in ('assignment')`),
    check("number_sequences_next_value_check", sql`${table.nextValue} >= 1`),
  ],
);
export type NumberSequence = typeof numberSequences.$inferSelect;
