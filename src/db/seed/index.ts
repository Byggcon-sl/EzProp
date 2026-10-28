import "dotenv/config";
import { runSeed } from "./run";

/** `pnpm db:seed`: grunndata. Kan kjøres flere ganger uten å lage duplikater. */
await runSeed();
process.exit(0);
