import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runEvalCommand } from "../src/core/ai/evals/run";
import { fakeAiProvider } from "../src/core/ai/providers/fake";

/*
 * `pnpm ai:eval [funksjon]`: kjører evalueringssettet (docs/funksjoner/fase2a-evalueringssett.md).
 * Hovedmål: KI i bunnen. Viser treffprosent per KI-funksjon.
 *
 * Bruker alltid den falske leverandøren. Ingen flagg, miljøvariabel eller innstilling velger
 * leverandør; en ekte leverandør kobles til med Anthropic-adapteren (etter S8). Trenger ikke
 * databasen.
 */

const casesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "core", "ai", "evals");

const { exitCode, lines } = await runEvalCommand(process.argv.slice(2), casesDir, fakeAiProvider);
for (const line of lines) console.log(line);
process.exit(exitCode);
