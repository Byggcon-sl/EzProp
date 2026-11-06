import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { assignmentParties } from "./assignment-parties";
import { assignments } from "./assignments";
import { baseColumns } from "./common";

/**
 * Reklamasjonssak (docs/05-domenemodell.md 4.13), enkel utgave i fase 2a
 * (docs/funksjoner/fase2a-reklamasjoner.md). Knyttet til oppdraget til rapportene finnes (A125).
 * Status «åpen/lukket» leses av utfallet (A127). Bygningsdelen er fritekst foreløpig (A128).
 * Bare leder og admin ser sakene (`claims.read`, Ståle 27.10.2026).
 *
 * Friteksten (`claimant_text`, `description`, `building_part_text`) kan inneholde
 * personopplysninger og logges aldri i revisjonsloggen eller hendelsene.
 *
 * `claimant_party_id` har en enkel fremmednøkkel fordi `assignment_parties` ikke har unik
 * (organization_id, id). At parten hører til samme organisasjon og oppdrag, sjekkes i
 * `@/core/claims`. Faste koder står i `@/core/claims/codes`; CHECK-reglene må ha de samme.
 */
export const claims = pgTable(
  "claims",
  {
    ...baseColumns,
    /** Den ansatte som registrerte saken. Påkrevd her, i motsetning til de andre tabellene. */
    createdBy: uuid("created_by").notNull(),
    assignmentId: uuid("assignment_id").notNull(),
    claimType: text("claim_type").notNull(),
    receivedAt: date("received_at", { mode: "string" }).notNull(),
    claimantPartyId: uuid("claimant_party_id"),
    claimantText: text("claimant_text"),
    description: text("description").notNull(),
    buildingPartText: text("building_part_text"),
    outcome: text("outcome").notNull().default("open"),
    /** Hele kroner. Bare ved medhold eller forlik (sjekkes i skjemaet). */
    amount: integer("amount"),
    /** Settes av serveren når utfallet går fra «åpen», nullstilles ved gjenåpning. */
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (table) => [
    // Mål for sammensatte fremmednøkler fra andre tabeller (samme organisasjon)
    uniqueIndex("claims_organization_id_id_idx").on(table.organizationId, table.id),
    index("claims_organization_id_assignment_id_idx").on(table.organizationId, table.assignmentId),
    // Oppdraget må høre til samme organisasjon som saken
    foreignKey({
      name: "claims_assignment_fk",
      columns: [table.organizationId, table.assignmentId],
      foreignColumns: [assignments.organizationId, assignments.id],
    }),
    foreignKey({
      name: "claims_claimant_party_fk",
      columns: [table.claimantPartyId],
      foreignColumns: [assignmentParties.id],
    }),
    check(
      "claims_claim_type_check",
      sql`${table.claimType} in ('complaint', 'insurance_claim', 'other')`,
    ),
    check(
      "claims_outcome_check",
      sql`${table.outcome} in ('open', 'rejected', 'upheld', 'settled', 'withdrawn')`,
    ),
    check("claims_amount_check", sql`${table.amount} is null or ${table.amount} >= 0`),
  ],
);
export type ClaimRow = typeof claims.$inferSelect;
