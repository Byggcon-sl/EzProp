import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core";
import { baseColumns } from "./common";
import { orders } from "./orders";
import { offices } from "./organization-structure";
import { properties } from "./properties";

/**
 * Oppdraget (docs/05-domenemodell.md 4.3), minimalt i fase 2a (A54): nummer, kontor, type,
 * status, koblingen til ordren og eiendommen. Selskap, team, ekstern referanse, statusflyt og
 * frister legges til av planpunktene som bruker dem.
 *
 * `number` lages bare på serveren fra nummerserien (`nextAssignmentNumber`, D9) og er unikt per
 * organisasjon, også blant slettede rader. Faste koder står i `@/core/assignments/codes`.
 */
export const assignments = pgTable(
  "assignments",
  {
    ...baseColumns,
    number: text("number").notNull(),
    officeId: uuid("office_id").notNull(),
    /** Ordren oppdraget ble laget fra. Tom når oppdraget lages direkte (senere). */
    orderId: uuid("order_id"),
    /** Eiendommen. Høyst én per oppdrag, og hvert oppdrag har sin egen nå (A65). Tom til den er lagt inn. */
    propertyId: uuid("property_id"),
    assignmentType: text("assignment_type").notNull().default("condition_report"),
    status: text("status").notNull().default("ordered"),
  },
  // Returtypen står fordi tabellene peker på hverandre (ellers klarer ikke TypeScript typene).
  (table): PgTableExtraConfigValue[] => [
    // Mål for sammensatte fremmednøkler fra andre tabeller (samme organisasjon)
    uniqueIndex("assignments_organization_id_id_idx").on(table.organizationId, table.id),
    // Aldri to oppdrag med samme nummer i organisasjonen
    uniqueIndex("assignments_organization_id_number_idx").on(table.organizationId, table.number),
    // Kontor og ordre må høre til samme organisasjon som oppdraget
    foreignKey({
      name: "assignments_office_fk",
      columns: [table.organizationId, table.officeId],
      foreignColumns: [offices.organizationId, offices.id],
    }),
    // `AnyPgColumn` fordi tabellene peker på hverandre (ordre → oppdrag og oppdrag → ordre).
    foreignKey({
      name: "assignments_order_fk",
      columns: [table.organizationId, table.orderId],
      foreignColumns: [orders.organizationId as AnyPgColumn, orders.id as AnyPgColumn],
    }),
    // Eiendommen må høre til samme organisasjon som oppdraget
    foreignKey({
      name: "assignments_property_fk",
      columns: [table.organizationId, table.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }),
    check(
      "assignments_assignment_type_check",
      sql`${table.assignmentType} in ('condition_report')`,
    ),
    check(
      "assignments_status_check",
      sql`${table.status} in ('ordered', 'in_progress', 'completed', 'invoiced')`,
    ),
  ],
);
export type Assignment = typeof assignments.$inferSelect;
