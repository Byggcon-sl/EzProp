import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Sperren ved innlogging (docs/funksjoner/fase0b-sperre-innlogging.md, A36). Systemtabell for
 * innloggingen, som `sessions` og `verifications`:
 * - ingen `organization_id`: før innlogging vet vi ikke hvilken organisasjon personen hører til;
 * - ingen e-postadresse i klartekst, bare en HMAC (`email_hash`), og ingen IP-adresse;
 * - ingen myk sletting: radene endres aldri. Riktig kode nullstiller med en egen rad
 *   (`login_succeeded`), og bare rader etter den telles.
 */
export const LOGIN_ATTEMPT_KINDS = ["code_requested", "code_failed", "login_succeeded"] as const;

export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    emailHash: text("email_hash").notNull(),
    kind: text("kind", { enum: LOGIN_ATTEMPT_KINDS }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("login_attempts_email_hash_kind_created_at_idx").on(
      table.emailHash,
      table.kind,
      table.createdAt,
    ),
    check(
      "login_attempts_kind_check",
      sql`${table.kind} in ('code_requested', 'code_failed', 'login_succeeded')`,
    ),
  ],
);
