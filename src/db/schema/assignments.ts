import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core";
import { clientAgreements } from "./client-agreements";
import { baseColumns } from "./common";
import { orders } from "./orders";
import { companies, offices } from "./organization-structure";
import { properties } from "./properties";

/**
 * Oppdraget (docs/05-domenemodell.md 4.3), minimalt i fase 2a (A54): nummer, kontor, type,
 * status, koblingen til ordren, utstedende selskap og eiendommen. Arbeidskøen la til befaring,
 * frist og internt notat. Ekstern referanse legges til av planpunktet som bruker den.
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
    /** Eiendommen. Høyst én per oppdrag, og hvert oppdrag har sin egen nå (A70). Tom til den er lagt inn. */
    propertyId: uuid("property_id"),
    assignmentType: text("assignment_type").notNull().default("condition_report"),
    status: text("status").notNull().default("ordered"),
    /**
     * Utstedende selskap: selskapet til ansvarlig takstmann, satt automatisk når ansvarlig settes
     * eller byttes (`setTeamMember`, A65–A68). Tomt når ingen ansvarlig har selskap.
     */
    companyId: uuid("company_id"),
    /**
     * Avtalt befaring (dato og klokkeslett). Settes for hånd til befaringene finnes (A100). Tom
     * gir «Befaring ikke avtalt» i arbeidskøen.
     */
    inspectionAt: timestamp("inspection_at", { withTimezone: true }),
    /** Frist for levering (dato, `YYYY-MM-DD`). Tom når ingen frist er satt. */
    dueDate: date("due_date", { mode: "string" }),
    /** Kort intern merknad i arbeidskøen, høyst 200 tegn (A101). Aldri i rapport eller PDF. */
    internalNote: text("internal_note"),
    /**
     * Avtalen med oppdragsgiver. Velges for hånd eller fra forslaget på oppdragssiden, aldri
     * automatisk (A116). Blir stående når avtalen utløper eller fjernes (A117).
     */
    clientAgreementId: uuid("client_agreement_id"),
  },
  // Returtypen står fordi tabellene peker på hverandre (ellers klarer ikke TypeScript typene).
  (table): PgTableExtraConfigValue[] => [
    // Mål for sammensatte fremmednøkler fra andre tabeller (samme organisasjon)
    uniqueIndex("assignments_organization_id_id_idx").on(table.organizationId, table.id),
    // Aldri to oppdrag med samme nummer i organisasjonen
    uniqueIndex("assignments_organization_id_number_idx").on(table.organizationId, table.number),
    // Arbeidskøen filtrerer og teller per status. Nattløkken 13.11.2026.
    index("assignments_organization_id_status_idx")
      .on(table.organizationId, table.status)
      .where(sql`${table.deletedAt} is null`),
    // Kontor og ordre må høre til samme organisasjon som oppdraget
    foreignKey({
      name: "assignments_office_fk",
      columns: [table.organizationId, table.officeId],
      foreignColumns: [offices.organizationId, offices.id],
    }),
    // Utstedende selskap må høre til samme organisasjon som oppdraget
    foreignKey({
      name: "assignments_company_fk",
      columns: [table.organizationId, table.companyId],
      foreignColumns: [companies.organizationId, companies.id],
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
    // Avtalen må høre til samme organisasjon som oppdraget
    foreignKey({
      name: "assignments_client_agreement_fk",
      columns: [table.organizationId, table.clientAgreementId],
      foreignColumns: [clientAgreements.organizationId, clientAgreements.id],
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
