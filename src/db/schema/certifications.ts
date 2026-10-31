import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { baseColumns } from "./common";
import { employees } from "./employees";

/**
 * Personlig sertifisering for en ansatt (docs/05-domenemodell.md 4.1). Uten minst én gyldig
 * sertifisering tas `report.publish` bort i `src/core/access` (A29). Fornyelse er en ny rad;
 * den gamle står som historikk. Datoene er rene datoer (ÅÅÅÅ-MM-DD) i norsk tid, og
 * utløpsdagen (`valid_to`) er siste gyldige dag.
 */
export const certifications = pgTable(
  "certifications",
  {
    ...baseColumns,
    employeeId: uuid("employee_id").notNull(),
    /** Fast kode for området, se `CERTIFICATION_AREAS` i `src/core/organization`. */
    area: text("area").notNull(),
    issuer: text("issuer"),
    certificateNumber: text("certificate_number"),
    validFrom: date("valid_from", { mode: "string" }),
    validTo: date("valid_to", { mode: "string" }).notNull(),
  },
  (table) => [
    index("certifications_organization_id_idx").on(table.organizationId),
    index("certifications_organization_id_employee_id_idx").on(
      table.organizationId,
      table.employeeId,
    ),
    // Den ansatte må høre til samme organisasjon som raden
    foreignKey({
      name: "certifications_employee_fk",
      columns: [table.organizationId, table.employeeId],
      foreignColumns: [employees.organizationId, employees.id],
    }),
    check(
      "certifications_valid_range_check",
      sql`${table.validFrom} is null or ${table.validFrom} <= ${table.validTo}`,
    ),
  ],
);
export type Certification = typeof certifications.$inferSelect;
