import { sql } from "drizzle-orm";
import { jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { baseColumns } from "./common";

/**
 * Tilkoblinger til andre systemer (docs/05-domenemodell.md 4.10, `src/core/integrations`).
 * `port` og `provider` er faste koder fra `@/core/integrations` (regel 6). `secret_ref` er bare
 * NAVNET på hemmeligheten; verdien leses med `readSecret` og lagres aldri her.
 *
 * Én tilkobling per organisasjon og port blant rader som ikke er slettet, uansett status.
 * `last_ok_at`, `last_error` og `status = error` settes av laget selv ved bruk.
 */
export const integrationConnections = pgTable(
  "integration_connections",
  {
    ...baseColumns,
    /** Fast kode fra `INTEGRATION_PORTS`. */
    port: text("port").notNull(),
    /** Fast kode fra `PROVIDERS_BY_PORT[port]`. */
    provider: text("provider").notNull(),
    /** `active`, `disabled` eller `error`. */
    status: text("status").notNull().default("active"),
    /** Navnet på hemmeligheten, aldri verdien. */
    secretRef: text("secret_ref"),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
    lastError: text("last_error"),
  },
  (table) => [
    // Starter med organization_id, så den dekker også oppslag på bare organisasjonen
    uniqueIndex("integration_connections_organization_id_port_unique")
      .on(table.organizationId, table.port)
      .where(sql`${table.deletedAt} is null`),
  ],
);
export type IntegrationConnectionRecord = typeof integrationConnections.$inferSelect;
