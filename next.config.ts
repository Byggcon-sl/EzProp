import type { NextConfig } from "next";
import { securityHeaders } from "./src/shared/config/security-headers";

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
