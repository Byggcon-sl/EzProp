import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

/*
 * Videresendingen fra de gamle ordreadressene (docs/funksjoner/fase2a-tilbud-testplan.md 1.7).
 * «Ordre» heter «Tilbud» (ADR 0012); bokmerker og lenker i e-post virker fortsatt. Videresendingen
 * slår ikke opp i databasen, så den røper ikke om et tilbud finnes i en annen organisasjon.
 * Støtter hovedmål: de ansatte (gamle lenker virker).
 */

describe("1.7 videresending /ordre → /tilbud", () => {
  it("1.7.1 tre varige videresendinger (308)", async () => {
    const redirects = await nextConfig.redirects!();
    expect(redirects).toEqual(
      expect.arrayContaining([
        { source: "/ordre", destination: "/tilbud", permanent: true },
        { source: "/ordre/ny", destination: "/tilbud/ny", permanent: true },
        { source: "/ordre/:id", destination: "/tilbud/:id", permanent: true },
      ]),
    );
    // «/ordre/ny» står før «/ordre/:id», ellers ville «ny» bli lest som en id.
    const sources = redirects.map((redirect) => redirect.source);
    expect(sources.indexOf("/ordre/ny")).toBeLessThan(sources.indexOf("/ordre/:id"));
    for (const redirect of redirects.filter((entry) => entry.source.startsWith("/ordre"))) {
      expect(redirect.permanent).toBe(true);
    }
  });

  it("1.7.2 next.config.ts importerer ikke databasen eller kjernen", () => {
    const source = readFileSync(path.join(__dirname, "..", "next.config.ts"), "utf8");
    expect(source).not.toMatch(/from ["']@\/db|from ["']\.\/src\/db|from ["']@\/core|drizzle/);
  });
});
