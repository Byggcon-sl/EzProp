import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, DB_CONNECTION_TIMEOUTS } from "./client";

/*
 * Funn fra nattløkken 24.11.2026: koblingene har tidsgrenser, så en hengende spørring eller lås
 * aldri holder en kobling i puljen for alltid. Støtter hovedmål: best for de ansatte.
 */
describe("tidsgrenser på databasekoblingen", () => {
  it("statement_timeout, lock_timeout og idle_in_transaction_session_timeout er satt", async () => {
    const rows = await db.execute<{ name: string; setting: string }>(
      sql`select name, setting from pg_settings where name in ('statement_timeout', 'lock_timeout', 'idle_in_transaction_session_timeout') order by name`,
    );
    const byName = Object.fromEntries(
      [...rows].map((row) => [row.name, Number(row.setting)] as const),
    );
    expect(byName).toEqual({
      idle_in_transaction_session_timeout:
        DB_CONNECTION_TIMEOUTS.idle_in_transaction_session_timeout,
      lock_timeout: DB_CONNECTION_TIMEOUTS.lock_timeout,
      statement_timeout: DB_CONNECTION_TIMEOUTS.statement_timeout,
    });
  });
});
