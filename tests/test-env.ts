import "dotenv/config";

/** Testene kjører alltid mot en egen database, aldri mot utviklingsdatabasen. */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL mangler (se .env.example)");
  if (url === process.env.DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL må være en annen database enn DATABASE_URL");
  }
  return url;
}
