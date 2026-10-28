import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/shared/config/env";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;
/** Databasen eller en pågående transaksjon. */
export type DbExecutor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

const globalForDb = globalThis as unknown as { ezpropDb?: Database };

function createDb(): Database {
  const client = postgres(getEnv().DATABASE_URL, { max: 10 });
  return drizzle(client, { schema, casing: "snake_case" });
}

/** Felles databaseforbindelse. Gjenbrukes ved hot reload i utvikling. */
export const db: Database = globalForDb.ezpropDb ?? createDb();
if (process.env.NODE_ENV !== "production") globalForDb.ezpropDb = db;
