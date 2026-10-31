import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { baseColumns } from "./common";
import { companies, offices } from "./organization-structure";
import { employeeRoleEnum } from "./organizations";

/**
 * Den ansatte (docs/05-domenemodell.md 4.1). Hører til ett selskap og ett kontor i samme
 * organisasjon (sammensatte fremmednøkler). Begge kan være tomme til admin har fylt dem ut.
 * `user_id` kan bare være tom for ansatte som har sluttet (innspill D18).
 */
export const employees = pgTable(
  "employees",
  {
    ...baseColumns,
    userId: text("user_id").references(() => users.id),
    name: text("name").notNull(),
    jobTitle: text("job_title"),
    companyId: uuid("company_id"),
    officeId: uuid("office_id"),
    /** Sluttet: kan ikke logge inn, men står fortsatt på gamle rapporter. */
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  },
  (table) => [
    index("employees_organization_id_idx").on(table.organizationId),
    // Mål for sammensatte fremmednøkler fra andre tabeller (samme organisasjon)
    uniqueIndex("employees_organization_id_id_idx").on(table.organizationId, table.id),
    // Én ansatt per innlogging per organisasjon
    uniqueIndex("employees_user_id_organization_id_idx").on(table.userId, table.organizationId),
    // Selskap og kontor må høre til samme organisasjon som den ansatte
    foreignKey({
      name: "employees_company_fk",
      columns: [table.organizationId, table.companyId],
      foreignColumns: [companies.organizationId, companies.id],
    }),
    foreignKey({
      name: "employees_office_fk",
      columns: [table.organizationId, table.officeId],
      foreignColumns: [offices.organizationId, offices.id],
    }),
    // Uten innlogging bare når den ansatte har sluttet
    check(
      "employees_user_or_deactivated_check",
      sql`${table.userId} is not null or ${table.deactivatedAt} is not null`,
    ),
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
    // Samme rolle bare én gang per ansatt blant aktive rader. En rolle som er tatt bort
    // (myk sletting), kan gis på nytt som en ny rad (A27).
    uniqueIndex("employee_roles_employee_id_role_idx")
      .on(table.employeeId, table.role)
      .where(sql`${table.deletedAt} is null`),
  ],
);

/**
 * Enkeltrettigheter som admin har gitt en ansatt i tillegg til rollene (for eksempel maltilgang).
 * Navnet på rettigheten er fri tekst her; ukjente navn gir ingen tilgang (håndteres i
 * `src/core/access`). Fjernes med myk sletting, og kan gis på nytt etterpå.
 */
export const employeePermissions = pgTable(
  "employee_permissions",
  {
    ...baseColumns,
    employeeId: uuid("employee_id").notNull(),
    permission: text("permission").notNull(),
  },
  (table) => [
    // Den ansatte må høre til samme organisasjon som raden
    foreignKey({
      name: "employee_permissions_employee_fk",
      columns: [table.organizationId, table.employeeId],
      foreignColumns: [employees.organizationId, employees.id],
    }),
    // Samme rettighet bare én gang per ansatt blant aktive rader
    uniqueIndex("employee_permissions_employee_id_permission_idx")
      .on(table.employeeId, table.permission)
      .where(sql`${table.deletedAt} is null`),
  ],
);
export type EmployeePermission = typeof employeePermissions.$inferSelect;
