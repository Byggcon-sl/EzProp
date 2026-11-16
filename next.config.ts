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
  // «Ordre» heter «Tilbud» (ADR 0012). Gamle adresser og bokmerker sendes varig videre (308).
  // Ingen databaseoppslag: siden på den nye adressen sjekker tilgangen som før, så
  // videresendingen røper ikke om et tilbud finnes i en annen organisasjon.
  async redirects() {
    return [
      { source: "/ordre", destination: "/tilbud", permanent: true },
      { source: "/ordre/ny", destination: "/tilbud/ny", permanent: true },
      { source: "/ordre/:id", destination: "/tilbud/:id", permanent: true },
    ];
  },
};

export default nextConfig;
