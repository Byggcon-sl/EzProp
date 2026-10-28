import { jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Organisasjonen er den ytterste grensen for data (tenant). I dag én rad: Byggcon.
 * Har ikke `organization_id` selv; ellers de samme felles kolonnene som alle andre.
 */
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /** Navnet som vises utad i rapport og e-post. */
  brandName: text("brand_name").notNull(),
  /** Innstillinger for hele organisasjonen (docs/05-domenemodell.md 4.12). */
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/** Rollene en ansatt kan ha (rettighetsmatrisen i docs/05-domenemodell.md avsnitt 5). */
export const employeeRoles = ["inspector", "office", "manager", "admin"] as const;
export type EmployeeRole = (typeof employeeRoles)[number];
export const employeeRoleEnum = pgEnum("employee_role", employeeRoles);
