import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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
import { assignments } from "./assignments";
import { baseColumns } from "./common";
import { contacts, firms } from "./contacts";

/**
 * Ordren: bestillingen slik den kom inn (docs/05-domenemodell.md 4.3). Lagt inn for hånd fra
 * e-posten nå (`source = manual`); `email` er kroken for e-post-til-ordre senere (KI først).
 * Adresse, matrikkel, borettslag og bestiller er tekst til eiendom og kontakter får egne
 * tabeller (A51). En avvist ordre blir stående med grunn (A55); den slettes ikke.
 *
 * Faste koder står i `@/core/orders/codes`. CHECK-reglene under må ha de samme kodene.
 */
export const orders = pgTable(
  "orders",
  {
    ...baseColumns,
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    source: text("source").notNull().default("manual"),
    /** Ordrenummer eller referanse fra megleren. */
    externalRef: text("external_ref"),
    /** Hvem som bestilte (navn og firma slik det sto i e-posten). */
    orderedByText: text("ordered_by_text"),
    /** Bestilleren i kontaktregisteret (valgfritt). Firmaet følger kontakten. */
    orderedByContactId: uuid("ordered_by_contact_id"),
    orderedByFirmId: uuid("ordered_by_firm_id"),
    addressText: text("address_text").notNull(),
    requestedReportType: text("requested_report_type").notNull().default("condition_report"),
    gnr: text("gnr"),
    bnr: text("bnr"),
    /** Seksjonsnummer. */
    snr: text("snr"),
    /** Borettslag eller sameie. */
    housingAssociationName: text("housing_association_name"),
    sellerDeclarationReceived: boolean("seller_declaration_received").notNull().default(false),
    status: text("status").notNull().default("received"),
    rejectedReason: text("rejected_reason"),
    assignmentId: uuid("assignment_id"),
  },
  // Returtypen står fordi tabellene peker på hverandre (ellers klarer ikke TypeScript typene).
  (table): PgTableExtraConfigValue[] => [
    // Mål for sammensatte fremmednøkler fra andre tabeller (samme organisasjon)
    uniqueIndex("orders_organization_id_id_idx").on(table.organizationId, table.id),
    index("orders_organization_id_received_at_idx").on(table.organizationId, table.receivedAt),
    // Oppslag fra oppdraget til ordren (arbeidskøen, oppdraget, eiendommen). Nattløkken 12.11.2026.
    index("orders_organization_id_assignment_id_idx").on(table.organizationId, table.assignmentId),
    // Oppdraget må høre til samme organisasjon som ordren. `AnyPgColumn` fordi tabellene peker
    // på hverandre (ordre → oppdrag og oppdrag → ordre).
    foreignKey({
      name: "orders_assignment_fk",
      columns: [table.organizationId, table.assignmentId],
      foreignColumns: [assignments.organizationId as AnyPgColumn, assignments.id as AnyPgColumn],
    }),
    index("orders_organization_id_ordered_by_contact_id_idx").on(
      table.organizationId,
      table.orderedByContactId,
    ),
    // Ordrene bestilt av et firma (slå sammen firma). Nattløkken 13.11.2026.
    index("orders_organization_id_ordered_by_firm_id_idx").on(
      table.organizationId,
      table.orderedByFirmId,
    ),
    // Bestilleren og firmaet må høre til samme organisasjon som ordren
    foreignKey({
      name: "orders_ordered_by_contact_fk",
      columns: [table.organizationId, table.orderedByContactId],
      foreignColumns: [contacts.organizationId, contacts.id],
    }),
    foreignKey({
      name: "orders_ordered_by_firm_fk",
      columns: [table.organizationId, table.orderedByFirmId],
      foreignColumns: [firms.organizationId, firms.id],
    }),
    check("orders_source_check", sql`${table.source} in ('manual', 'email')`),
    check(
      "orders_requested_report_type_check",
      sql`${table.requestedReportType} in ('condition_report')`,
    ),
    check("orders_status_check", sql`${table.status} in ('received', 'converted', 'rejected')`),
    // Avvist krever grunn
    check(
      "orders_rejected_reason_check",
      sql`${table.status} <> 'rejected' or length(trim(coalesce(${table.rejectedReason}, ''))) > 0`,
    ),
    // Gjort om krever oppdrag, og bare en ordre som er gjort om, peker på et oppdrag
    check(
      "orders_assignment_id_check",
      sql`(${table.status} = 'converted') = (${table.assignmentId} is not null)`,
    ),
  ],
);
export type Order = typeof orders.$inferSelect;
