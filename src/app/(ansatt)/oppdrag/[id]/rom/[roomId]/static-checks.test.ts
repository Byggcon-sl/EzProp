import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Statiske kontroller for skjermen for badet (design avsnitt 22, sjekklisten for utvikler):
 * - klientkomponentene importerer bare `@/core/reports/logic` (og typer), aldri rapportkjernen,
 *   databasen eller tilgangen;
 * - ingen nedtrekksmeny (`Select`, `<select>`);
 * - regelforslag er ikke KI: ingen «KI», ingen gnisteikon, ingen `ai-*`-tokens;
 * - ingen faste hex-farger;
 * - ingen rapportdata i localStorage eller IndexedDB (2b).
 * Støtter hovedmål: KI i bunnen (regelforslag og KI holdes adskilt), færre reklamasjoner.
 */

const dir = __dirname;
const files = readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts"));
const read = (file: string) => readFileSync(join(dir, file), "utf8");
/** Filene nettleseren får: alt utenom server actions og selve siden. */
const clientFiles = files.filter((f) => f !== "actions.ts" && f !== "page.tsx");
/** Kildekoden uten kommentarer. */
const code = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/** Importstiene i en fil, med om importen bare er typer. */
function imports(source: string): { from: string; typeOnly: boolean }[] {
  return [...source.matchAll(/import\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/gs)].map((m) => ({
    from: m[2]!,
    typeOnly: Boolean(m[1]),
  }));
}

describe("skjermen for badet", () => {
  it("har klientkomponenter å kontrollere", () => {
    expect(clientFiles).toEqual(
      expect.arrayContaining([
        "room-view.tsx",
        "checkpoint-panel.tsx",
        "rule-suggestion-card.tsx",
        "deviation-card.tsx",
      ]),
    );
  });

  it.each(clientFiles)("%s importerer ikke rapportkjernen, databasen eller tilgangen", (file) => {
    for (const { from, typeOnly } of imports(read(file))) {
      expect(from, `${file}: ${from}`).not.toBe("@/core/reports");
      expect(from.startsWith("@/core/access"), `${file}: ${from}`).toBe(false);
      expect(from.startsWith("@/core/ai"), `${file}: ${from}`).toBe(false);
      if (
        from.startsWith("@/db") ||
        from === "@/core/reports/types" ||
        from === "@/core/templates" ||
        from === "@/core/rules"
      ) {
        expect(typeOnly, `${file}: ${from} skal bare gi typer`).toBe(true);
      }
    }
  });

  it.each(files)("%s har ingen nedtrekksmeny, ingen hex-farger og ingen lokal lagring", (file) => {
    const source = code(file);
    expect(source).not.toMatch(/<select\b|\bSelect\b/);
    expect(source).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    expect(source).not.toMatch(/localStorage|indexedDB|IndexedDB/);
  });

  it("regelforslag er ikke KI", () => {
    const source = code("rule-suggestion-card.tsx");
    expect(source).not.toMatch(/\bKI\b/);
    expect(source).not.toMatch(/AiSparkIcon|ai-text-mark|ai-suggestion|\bai-\d/);
  });
});
