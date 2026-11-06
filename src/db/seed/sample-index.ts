import "dotenv/config";
import { runSampleSeed } from "./sample-assignments";

/**
 * `pnpm db:seed:testoppdrag`: fire oppdiktede testoppdrag i prøveorganisasjonen. Kjøres etter
 * `pnpm db:seed`. Kan kjøres flere ganger uten å lage duplikater.
 */
await runSampleSeed();
process.exit(0);
