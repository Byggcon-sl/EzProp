import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { baseColumns } from "./common";

/**
 * Revisjonslogg (docs/05-domenemodell.md 4.12): hvem endret hva, og når. Viktig når alle
 * takstmenn kan endre alt (27.10.2026). `occurred_at` er tiden på enheten, `received_at` når
 * serveren fikk den. `device_id` fylles når enheter kommer (fase 1).
 */
export const auditLog = pgTable(
  "audit_log",
  {
    ...baseColumns,
    actorEmployeeId: uuid("actor_employee_id"),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    /** `create`, `update`, `delete`, `restore`, `permission_change` … */
    action: text("action").notNull(),
    /** Gammel og ny verdi per felt. Aldri passord eller nøkler. */
    changes: jsonb("changes").$type<Record<string, unknown>>().notNull().default({}),
    deviceId: uuid("device_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_log_organization_id_idx").on(table.organizationId, table.occurredAt),
    index("audit_log_entity_idx").on(table.entityType, table.entityId),
  ],
);
