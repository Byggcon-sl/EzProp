import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";
import { securityHeaders } from "./src/shared/config/security-headers";

/**
 * Prøve fase 1 (PowerSync): worker og wasm-filene til den lokale databasen i nettleseren kopieres
 * fra SDK-en til `public/@powersync/` når Next starter eller bygger, og lastes fra
 * `/@powersync/worker.js` (src/modules/offline-trial/sync/powersync/database.ts). Mappen ligger i
 * .gitignore, så ca. 7 MB wasm ikke havner i git-historikken, og den følger alltid versjonen som
 * er installert. Kopieres bare når versjonen er ny (configen lastes flere ganger under bygg).
 */
function copyPowerSyncAssets() {
  const sdk = path.join(process.cwd(), "node_modules", "@powersync", "web");
  const source = path.join(sdk, "dist", "worker");
  const target = path.join(process.cwd(), "public", "@powersync");
  const stamp = path.join(target, ".version");
  if (!existsSync(source)) return;
  const version = (
    JSON.parse(readFileSync(path.join(sdk, "package.json"), "utf8")) as {
      version: string;
    }
  ).version;
  if (existsSync(stamp) && readFileSync(stamp, "utf8") === version) return;
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true, filter: (file) => !file.endsWith(".map") });
  writeFileSync(stamp, version);
}
copyPowerSyncAssets();

const nextConfig: NextConfig = {
  typedRoutes: false,
  // Vi har egne instruksjoner i CLAUDE.md; ikke la Next.js lage AGENTS.md
  agentRules: false,
  // Selvstendig pakke med bare det serveren trenger (drift senere). `pnpm start` virker som før.
  output: "standalone",
  // Sikkerhetshoder på alle svar (src/shared/config/security-headers.ts)
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
