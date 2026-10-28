import { runMigrations } from "../src/db/migrate";
import { testDatabaseUrl } from "./test-env";

export default async function globalSetup() {
  await runMigrations(testDatabaseUrl());
}
