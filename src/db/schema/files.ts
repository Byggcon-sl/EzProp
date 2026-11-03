import { integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { baseColumns } from "./common";

/**
 * Metadata for filer i den felles filtjenesten (docs/05-domenemodell.md, `src/core/files`).
 * Selve innholdet ligger i fillagringen (lokal mappe eller Azure Blob Storage) under
 * `storage_key` = `<organization_id>/<kind>/<id>`, aldri et filnavn fra brukeren.
 *
 * Raden slettes aldri: «slette» er `deleted_at`/`deleted_by`, og filinnholdet blir liggende
 * (regel 3, A39). Så lenge `retain_until` er i fremtiden kan raden ikke merkes som slettet,
 * heller ikke av admin.
 */
export const files = pgTable(
  "files",
  {
    ...baseColumns,
    /** Nøkkelen i fillagringen, `<organization_id>/<kind>/<id>`. */
    storageKey: text("storage_key").notNull(),
    /** Fast kode fra `FILE_KINDS` i `@/core/files`. */
    kind: text("kind").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /** SHA-256 av innholdet (hex), kontrolleres ved hver henting. */
    sha256: text("sha256").notNull(),
    /** Filen kan ikke merkes som slettet før dette tidspunktet. Tom = ingen frist ennå. */
    retainUntil: timestamp("retain_until", { withTimezone: true }),
  },
  (table) => [
    // Dekker også oppslag på bare organisasjonen (første kolonne)
    uniqueIndex("files_organization_id_storage_key_unique").on(
      table.organizationId,
      table.storageKey,
    ),
  ],
);
