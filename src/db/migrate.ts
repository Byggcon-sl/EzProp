import "dotenv/config";
import { runMigrations } from "./run-migrations";

export { runMigrations } from "./run-migrations";

/** `pnpm db:migrate`: kjører alle migreringer mot DATABASE_URL (eller URL gitt som argument). */
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.argv[2] ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL mangler");
  await runMigrations(url);
  console.log("Migreringer kjørt.");
}
