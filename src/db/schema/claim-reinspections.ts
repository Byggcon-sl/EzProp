import { sql } from "drizzle-orm";
import { foreignKey, index, pgTable, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { assignments } from "./assignments";
import { claims } from "./claims";
import { baseColumns } from "./common";

/**
 * Kobling mellom en sak (`claims`) og oppdraget for ny befaring (docs/05-domenemodell.md 4.13,
 * ADR 0013, A420, docs/funksjoner/fase2a-reklamasjonskobling.md).
 *
 * Kjeden leses slik: opprinnelig oppdrag = `claims.assignment_id` → sak (`claims`) → ny befaring
 * = `claim_reinspections.assignment_id`.
 *
 * - En sak kan ha flere nye befaringer. Et oppdrag hører til høyst én aktiv kobling (den unike
 *   delindeksen). Indeksen gjelder også når oppdraget ligger i papirkurven (A425).
 * - At `assignment_id` ikke er sakens opprinnelige oppdrag, sjekkes i `@/core/claims` (regelen
 *   `reinspection_not_original`); databasen kan ikke sjekke det uten å lese `claims`.
 * - Myk sletting, ingen `ON DELETE CASCADE` (regel 3). `removeClaim` fjerner sakens koblinger
 *   mykt med samme `deleted_at` (A424).
 * - Ingen fritekst. Bare leder og admin leser tabellen (`claims.read`). Den sendes aldri til KI
 *   og er aldri med i synk til iPad (A430).
 */
export const claimReinspections = pgTable(
  "claim_reinspections",
  {
    ...baseColumns,
    /** Den ansatte som laget koblingen (som i `claims`), aldri en verdi fra skjemaet. */
    createdBy: uuid("created_by").notNull(),
    claimId: uuid("claim_id").notNull(),
    /** Oppdraget for ny befaring. Aldri sakens opprinnelige oppdrag. */
    assignmentId: uuid("assignment_id").notNull(),
  },
  (table) => [
    // Et oppdrag er ny befaring for høyst én aktiv kobling. Dekker også «samme oppdrag to
    // ganger på samme sak», så det finnes ingen egen indeks for det (F5).
    uniqueIndex("claim_reinspections_organization_id_assignment_id_idx")
      .on(table.organizationId, table.assignmentId)
      .where(sql`${table.deletedAt} is null`),
    index("claim_reinspections_organization_id_claim_id_idx").on(
      table.organizationId,
      table.claimId,
    ),
    // Saken og oppdraget må høre til samme organisasjon som koblingen
    foreignKey({
      name: "claim_reinspections_claim_fk",
      columns: [table.organizationId, table.claimId],
      foreignColumns: [claims.organizationId, claims.id],
    }),
    foreignKey({
      name: "claim_reinspections_assignment_fk",
      columns: [table.organizationId, table.assignmentId],
      foreignColumns: [assignments.organizationId, assignments.id],
    }),
  ],
);
export type ClaimReinspectionRow = typeof claimReinspections.$inferSelect;
