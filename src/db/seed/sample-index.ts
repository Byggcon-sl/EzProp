import "dotenv/config";
import { pathToFileURL } from "node:url";
import { runSampleSeed } from "./sample-assignments";
import { TestdataNotAllowedError, assertTestdataAllowed } from "./testdata-guard";

/**
 * `pnpm db:seed:testoppdrag`: fire oppdiktede testoppdrag, KI med falsk leverandør og systemmalen
 * med badet i prøveorganisasjonen. Kjøres etter `pnpm db:seed`. Kan kjøres flere ganger uten å
 * lage duplikater.
 *
 * Produksjonsvakten (`testdata-guard.ts`, A302) kjøres før første skriving: bare når
 * `APP_ENVIRONMENT` er `development` eller `test` og databasen er lokal eller testdatabasen i
 * Azure. Stopper vakten, skrives bare den norske meldingen (aldri adresse eller vert), og koden
 * blir 1 slik at utrullingen stopper. Støtter hovedmål: færre reklamasjoner og trygghet for de
 * ansatte, fordi oppdiktede oppdrag aldri kan havne i produksjon.
 */

export type SampleCliDeps = {
  guard: () => void;
  run: () => Promise<unknown>;
  error: (message: string) => void;
};

/** Kjører vakten og deretter testoppdragene. Gir 0 ved suksess og 1 når vakten stopper. */
export async function runSampleCli(
  deps: SampleCliDeps = {
    guard: assertTestdataAllowed,
    run: () => runSampleSeed(),
    error: console.error,
  },
): Promise<number> {
  try {
    deps.guard();
  } catch (caught) {
    if (caught instanceof TestdataNotAllowedError) {
      deps.error(`Testoppdrag ble ikke lagt inn: ${caught.message}`);
      return 1;
    }
    throw caught;
  }
  await deps.run();
  return 0;
}

// Bare når filen kjøres direkte (`tsx src/db/seed/sample-index.ts`), ikke når testene importerer den
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await runSampleCli());
}
