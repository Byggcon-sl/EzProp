import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { baseColumns } from "./common";
import { employeeRoleEnum } from "./organizations";

/**
 * Den ansatte i EzProp (docs/05-domenemodell.md 4.1). Selskap, kontor, sertifisering og
 * enkeltrettigheter kommer i fase 0b. `user_id` kan være tom for ansatte som har sluttet.
 */
export const employees = pgTable(
  "employees",
  {
    ...baseColumns,
    userId: text("user_id").references(() => users.id),
    name: text("name").notNull(),
    jobTitle: text("job_title"),
    /** Sluttet: kan ikke logge inn, men står fortsatt på gamle rapporter. */
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  },
  (table) => [
    index("employees_organization_id_idx").on(table.organizationId),
    // Én ansatt per innlogging per organisasjon
    uniqueIndex("employees_user_id_organization_id_idx").on(table.userId, table.organizationId),
  ],
);
export type Employee = typeof employees.$inferSelect;

/** Hvilke roller den ansatte har (`employee_roles` i datamodellen). */
export const employeeRoleAssignments = pgTable(
  "employee_roles",
  {
    ...baseColumns,
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    role: employeeRoleEnum("role").notNull(),
  },
  (table) => [
    index("employee_roles_organization_id_idx").on(table.organizationId),
    uniqueIndex("employee_roles_employee_id_role_idx").on(table.employeeId, table.role),
  ],
);
