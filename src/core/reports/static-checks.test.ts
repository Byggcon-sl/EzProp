import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Statiske sjekker for «KI i veien» i rapportkjernen (docs/funksjoner/fase2a-ki-i-veien-testplan.md
 * K5.7, K5.16 og K5.18). Leser kildefilene; kjører ingen kode.
 */

const DIR = path.resolve(process.cwd(), "src/core/reports");

/** Filene «KI i veien» la til eller endret for fraseforslag, språkvask og sammendrag. */
const NEW_FILES = [
  "phrase-source.ts",
  "phrase-suggest.ts",
  "polish.ts",
  "summary.ts",
  "write.ts",
  "save-field.ts",
  "logic/phrase-candidates.ts",
  "logic/summary.ts",
];

function read(file: string): string {
  return readFileSync(path.join(DIR, file), "utf8");
}

/** Koden uten kommentarer, så forklaringer ikke gir treff. */
function code(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("statiske sjekker for KI i veien", () => {
  it.each(NEW_FILES)("K5.16 %s filtrerer aldri på en organisasjons-id fra inndata", (file) => {
    const text = code(file);
    // Organisasjonen i spørringer kommer fra tilgangssjekken (`grant.organizationId`, `orgId`)
    expect(text).not.toMatch(/\b(?:input|values|room|change|options)\??\.organizationId\b/);
    expect(text).not.toMatch(/organizationId,\s*organizationId\)/);
    // `organizationId` fra kalleren brukes bare i tilgangssjekken
    const direct = [...text.matchAll(/eq\([^,]+\.organizationId,\s*organizationId\)/g)];
    expect(direct).toEqual([]);
  });

  it.each(NEW_FILES)("K5.18 %s sletter aldri permanent", (file) => {
    const text = code(file);
    expect(text).not.toMatch(/\.delete\(/);
    expect(text).not.toMatch(/\bdelete\s+from\b/i);
    expect(text).not.toMatch(/\btruncate\b/i);
  });

  it.each(NEW_FILES)(
    "K5.7 %s har ingen egen rollesjekk: tilgang bare via @/core/access",
    (file) => {
      const text = code(file);
      expect(text).not.toMatch(/roles\.includes|\.roles\b|role\s*===|isAdmin\(/);
    },
  );

  it("K5.18 sammendraget tømmes ved å skrive tom tekst, ikke ved å slette raden", () => {
    const text = code("summary.ts");
    expect(text).toMatch(/summaryText:\s*text/);
    expect(text).not.toMatch(/deletedAt:\s*(?:scope\.)?now/);
  });

  it("K2.8 rapportkjernen bygger aldri ledetekst og kaller aldri en leverandør direkte", () => {
    for (const file of NEW_FILES) {
      const text = code(file);
      expect(text, file).not.toMatch(/from\s+["']@\/core\/ai\/(?!index)[^"']+["']/);
      expect(text, file).not.toMatch(/\bbuildPrompt\b|\bcomplete\(|providers\//);
    }
  });

  it("K2.8 ingen fil som kaller KI, skriver TG eller lager avvik", () => {
    for (const file of ["phrase-suggest.ts", "polish.ts", "summary.ts"]) {
      const text = code(file);
      // Lesing av TG (`tg: deviations.tg`) er lov; skriving i `.set({…})` eller `.values({…})` er ikke
      expect(text, file).not.toMatch(/\.(?:set|values)\(\s*\{[^}]*\b(?:tg|tgDirect)\s*:/s);
      expect(text, file).not.toMatch(/insert\(deviations\)/);
      expect(text, file).not.toMatch(/createDeviationFromOutcome|writeTgDirect/);
    }
  });
});
