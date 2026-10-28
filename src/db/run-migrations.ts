import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** Standardmappen for migreringene (fra prosjektmappen). */
export const MIGRATIONS_FOLDER = "src/db/migrations";

/**
 * Kjører alle migreringer som mangler. Brukes av `pnpm db:migrate` og av oppstarten i drift
 * (og senere av oppstarten i drift).
 */
export async function runMigrations(url: string, migrationsFolder = MIGRATIONS_FOLDER) {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}
