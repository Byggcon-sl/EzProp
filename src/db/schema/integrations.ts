import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { baseColumns } from "./common";

/**
 * Tilkoblinger til andre systemer (docs/05-domenemodell.md 4.10, `src/core/integrations`).
 * `port` og `provider` er faste koder fra `ports.ts`. `secret_ref` er bare **navnet** på
 * hemmeligheten (leses med `readSecret`), aldri verdien.
 *
 * Én tilkobling per organisasjon og port blant rader som ikke er slettet, uansett status. Raden
 * slettes aldri: «slette» er `deleted_at`/`deleted_by` (regel 3).
 */
export const integrationConnections = pgTable(
  "integration_connections",
  {
    ...baseColumns,
    /** Fast kode fra `INTEGRATION_PORTS`. */
    port: text("port").notNull(),
    /** Fast kode fra `PROVIDERS_BY_PORT`. */
    provider: text("provider").notNull(),
    /** `active`, `disabled` eller `error` (`CONNECTION_STATUSES`). */
    status: text("status").notNull().default("active"),
    /** Navnet på hemmeligheten, aldri verdien. */
    secretRef: text("secret_ref"),
    /** Innstillinger per leverandør (sjekkes i `connections.ts`). Aldri hemmeligheter. */
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    /** Siste vellykkede bruk (settes av laget selv). */
    lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
    /** Siste feil, vasket og kortet ned (settes av laget selv). */
    lastError: text("last_error"),
  },
  (table) => [
    // Dekker også oppslag på bare organisasjonen (første kolonne)
    index("integration_connections_organization_id_idx").on(table.organizationId),
    uniqueIndex("integration_connections_organization_id_port_unique")
      .on(table.organizationId, table.port)
      .where(sql`${table.deletedAt} is null`),
  ],
);
export type IntegrationConnection = typeof integrationConnections.$inferSelect;
