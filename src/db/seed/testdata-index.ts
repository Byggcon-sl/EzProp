import "dotenv/config";
import { TestdataGuardError, assertTestdataAllowed } from "./testdata-guard";

/**
 * `pnpm db:seed:testdata`: oppdiktede testdata som ligner en ekte arbeidshverdag, i organisasjonen
 * fra `pnpm db:seed`. Kjøres etter `pnpm db:seed`. Kan kjøres flere ganger uten å lage duplikater.
 *
 * Produksjonsvakten kjøres før databasen åpnes: databaseklienten og seed-steget importeres først
 * når vakten har sluppet gjennom. Loggen viser bare antall og TD-nøkler, aldri adresser eller navn.
 */
try {
  assertTestdataAllowed(process.env);
} catch (error) {
  process.stderr.write(
    error instanceof TestdataGuardError
      ? `${error.message}\n`
      : "Produksjonsvakten for testdata feilet uventet. Ingenting er skrevet.\n",
  );
  process.exit(1);
}

const { runTestdataSeed } = await import("./testdata");
const { db } = await import("@/db/client");

let exitCode = 0;
try {
  const summary = await runTestdataSeed(process.env);
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  exitCode = 1;
  if (error instanceof TestdataGuardError) {
    process.stderr.write(`${error.message}\n`);
  } else {
    // Bare feiltype og SQLSTATE, ikke meldingen: den kan inneholde verdier fra radene.
    const code =
      typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    const kind = error instanceof Error ? error.name : "ukjent";
    process.stderr.write(
      `Innlegging av testdata feilet (${kind}${code ? `, kode ${code}` : ""}). Det som ble lagt inn, beholdes; kjør skriptet på nytt for å fylle ut resten.\n`,
    );
  }
} finally {
  // Typen `Database` viser ikke klienten under; drizzle legger den på som `$client`.
  const client = (
    db as unknown as { $client: { end(options: { timeout: number }): Promise<void> } }
  ).$client;
  await client.end({ timeout: 5 });
}
process.exit(exitCode);
