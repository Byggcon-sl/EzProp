import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { assignments } from "./assignments";
import { baseColumns } from "./common";

/**
 * Partene på oppdraget (docs/05-domenemodell.md 4.2), enkel utgave i fase 2a (A60): navn, firma,
 * e-post og telefon som fritekst, rollen og hva parten mottar. `contact_id`, `firm_id`,
 * `receives_survey` og `is_primary` kommer med kontaktregisteret og rutinene. En person med to
 * roller er to rader. Fjerning er myk sletting.
 *
 * Faste koder står i `@/core/assignments/codes`. CHECK-regelen under må ha de samme kodene.
 */
export const assignmentParties = pgTable(
  "assignment_parties",
  {
    ...baseColumns,
    assignmentId: uuid("assignment_id").notNull(),
    role: text("role").notNull(),
    name: text("name").notNull(),
    firmName: text("firm_name"),
    email: text("email"),
    phone: text("phone"),
    receivesReport: boolean("receives_report").notNull().default(false),
    receivesInvoice: boolean("receives_invoice").notNull().default(false),
    receivesMessages: boolean("receives_messages").notNull().default(false),
  },
  (table) => [
    index("assignment_parties_organization_id_assignment_id_idx").on(
      table.organizationId,
      table.assignmentId,
    ),
    // Oppdraget må høre til samme organisasjon som parten
    foreignKey({
      name: "assignment_parties_assignment_fk",
      columns: [table.organizationId, table.assignmentId],
      foreignColumns: [assignments.organizationId, assignments.id],
    }),
    check(
      "assignment_parties_role_check",
      sql`${table.role} in ('broker', 'seller', 'buyer', 'seller_representative', 'invoice_recipient')`,
    ),
  ],
);
export type AssignmentParty = typeof assignmentParties.$inferSelect;
