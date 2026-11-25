import type { NextConfig } from "next";
import { securityHeaders } from "./src/shared/config/security-headers";

const nextConfig: NextConfig = {
  typedRoutes: false,
  // Vi har egne instruksjoner i CLAUDE.md; ikke la Next.js lage AGENTS.md
  agentRules: false,
  // Selvstendig pakke med bare det serveren trenger (drift senere). `pnpm start` virker som før.
  output: "standalone",
  // PDF-motoren (ADR 0016) og rendereren for sidene i forhåndsvisningen (tillegget til ADR 0016)
  // lastes bare i arbeidstråden `src/core/pdf/typst-worker.mjs`, som startes med filsti og derfor
  // ikke pakkes av Next. Pakkene holdes utenfor serverpakken, og arbeidstråden, motoren,
  // rendereren og WASM-filene tas med i `.next/standalone` for alle ruter.
  // `scripts/pdf-engine-trial.mjs` og steget «Prøv PDF-motoren i pakken» i deploy-azure.yml
  // viser at filene er med.
  serverExternalPackages: [
    "@myriaddreamin/typst.ts",
    "@myriaddreamin/typst-ts-web-compiler",
    "@myriaddreamin/typst-ts-renderer",
  ],
  outputFileTracingIncludes: {
    "/*": [
      "./src/core/pdf/typst-worker.mjs",
      "./node_modules/@myriaddreamin/typst.ts/package.json",
      "./node_modules/@myriaddreamin/typst.ts/dist/cjs/**/*.cjs",
      "./node_modules/@myriaddreamin/typst-ts-web-compiler/package.json",
      "./node_modules/@myriaddreamin/typst-ts-web-compiler/pkg/*.mjs",
      "./node_modules/@myriaddreamin/typst-ts-web-compiler/pkg/*.wasm",
      "./node_modules/@myriaddreamin/typst-ts-renderer/package.json",
      "./node_modules/@myriaddreamin/typst-ts-renderer/pkg/*.mjs",
      "./node_modules/@myriaddreamin/typst-ts-renderer/pkg/*.wasm",
    ],
  },
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
