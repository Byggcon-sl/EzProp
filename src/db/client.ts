import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/shared/config/env";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;
/** Databasen eller en pågående transaksjon. */
export type DbExecutor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

const globalForDb = globalThis as unknown as { ezpropDb?: Database };

/**
 * Tidsgrenser på hver kobling (funn fra nattløkken 24.11.2026): en spørring eller en ventende lås
 * stopper med feil i stedet for å holde koblingen for alltid, og en transaksjon som står uten å
 * gjøre noe, avbrytes. Grensene er romslige, så vanlig bruk aldri merker dem.
 */
export const DB_CONNECTION_TIMEOUTS = {
  /** Lengste tid for én spørring (ms). */
  statement_timeout: 60_000,
  /** Lengste ventetid på en radlås (ms), for eksempel rapportraden i skriverammen. */
  lock_timeout: 15_000,
  /** Transaksjon som står uten spørring så lenge, avbrytes (ms). */
  idle_in_transaction_session_timeout: 60_000,
} as const;

function createDb(): Database {
  const client = postgres(getEnv().DATABASE_URL, {
    max: 10,
    connection: { ...DB_CONNECTION_TIMEOUTS },
  });
  return drizzle(client, { schema, casing: "snake_case" });
}

/** Felles databaseforbindelse. Gjenbrukes ved hot reload i utvikling. */
export const db: Database = globalForDb.ezpropDb ?? createDb();
if (process.env.NODE_ENV !== "production") globalForDb.ezpropDb = db;
