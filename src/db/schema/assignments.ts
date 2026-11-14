import { sql } from "drizzle-orm";
import {
  boolean,
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
import { contacts, firms } from "./contacts";
import { orders } from "./orders";
import { companies, offices } from "./organization-structure";
import { properties } from "./properties";

/**
 * Oppdraget (docs/05-domenemodell.md 4.3), minimalt i fase 2a (A54): nummer, kontor, type,
 * status, koblingen til ordren, utstedende selskap og eiendommen. Arbeidskøen la til befaring,
 * frist og internt notat.
 *
 * Oppdraget eier bestillingsopplysningene (ADR 0011, A292): mottatt, kilde, meglerens
 * ordrenummer, bestiller, adresse, matrikkel og borettslag. Kolonnene har samme navn og regler
 * som på ordren. Alt som viser eller bruker dem, leser herfra, også for oppdrag som kom fra en
 * ordre (da kopieres de i `convertOrderToAssignment`). Ordren beholder sin kopi som «slik
 * bestillingen kom». Kolonnene sendes aldri til KI (`@/core/ai/never-fields`).
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
    /** Ordren oppdraget ble laget fra. Tom når oppdraget er laget direkte («Nytt oppdrag»). */
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
    /** Når bestillingen kom inn. Ved direkte oppretting: «nå» hvis skjemaet ikke sier noe annet. */
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    /** Hvor bestillingen kom fra. Samme koder som `orders.source`. Settes av kjernen, aldri fra skjemaet. */
    source: text("source").notNull().default("manual"),
    /** Ordrenummer eller referanse fra megleren. */
    externalRef: text("external_ref"),
    /** Hvem som bestilte (navn og firma som fritekst). */
    orderedByText: text("ordered_by_text"),
    /** Bestilleren i kontaktregisteret (valgfritt). Firmaet følger kontakten. */
    orderedByContactId: uuid("ordered_by_contact_id"),
    orderedByFirmId: uuid("ordered_by_firm_id"),
    addressText: text("address_text").notNull(),
    gnr: text("gnr"),
    bnr: text("bnr"),
    /** Seksjonsnummer. */
    snr: text("snr"),
    /** Borettslag eller sameie. */
    housingAssociationName: text("housing_association_name"),
    /** Følger med fra ordren. Ikke i skjemaet «Nytt oppdrag». */
    sellerDeclarationReceived: boolean("seller_declaration_received").notNull().default(false),
    /**
     * Engangsnøkkel fra skjemaet «Nytt oppdrag» (A298): samme nøkkel to ganger gir det første
     * oppdraget tilbake, aldri et nytt nummer. Tom for oppdrag fra ordre.
     */
    creationKey: uuid("creation_key"),
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
    // Vern mot dobbel lagring: én nøkkel gir ett oppdrag per organisasjon (tomme er aldri like)
    uniqueIndex("assignments_organization_id_creation_key_idx").on(
      table.organizationId,
      table.creationKey,
    ),
    // Oppdragene til en bestiller eller et firma (slå sammen kontakter og firma, avtaleforslag)
    index("assignments_organization_id_ordered_by_contact_id_idx").on(
      table.organizationId,
      table.orderedByContactId,
    ),
    index("assignments_organization_id_ordered_by_firm_id_idx").on(
      table.organizationId,
      table.orderedByFirmId,
    ),
    // Mulig dublett: to uttrykksindekser på normalisert adresse og gnr/bnr står bare i
    // migreringen 0034, ikke her, av samme grunn som for `orders` (uttrykkene står ett sted i
    // kjernen, og `src/db` importerer ikke derfra).
    // Bestilleren og firmaet må høre til samme organisasjon som oppdraget
    foreignKey({
      name: "assignments_ordered_by_contact_fk",
      columns: [table.organizationId, table.orderedByContactId],
      foreignColumns: [contacts.organizationId, contacts.id],
    }),
    foreignKey({
      name: "assignments_ordered_by_firm_fk",
      columns: [table.organizationId, table.orderedByFirmId],
      foreignColumns: [firms.organizationId, firms.id],
    }),
    check("assignments_source_check", sql`${table.source} in ('manual', 'email')`),
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
