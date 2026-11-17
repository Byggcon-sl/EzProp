import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Statiske kontroller for publiser-siden (docs/funksjoner/fase2a-publisering-badet-design.md
 * avsnitt 19, sjekklisten for utvikler):
 * - klientfilene importerer bare `@/core/reports/logic` (og typer), aldri rapportkjernen,
 *   databasen, tilgangen eller KI-modulen;
 * - ingen dialog, ingen nedtrekksmeny (`Select`, `<select>`) og ingen avkrysningsboks for
 *   «Publiser likevel»;
 * - sperrer bruker ikke TG3-tonen (`urgent`, `tg3`);
 * - ingen faste hex-farger og ingen lokal lagring av kladder;
 * - ingen TG er forhåndsvalgt i «Rett nå».
 * Støtter hovedmål: færre reklamasjoner (aktiv bryter og grunn) og KI i bunnen (KI setter aldri
 * TG og publiserer aldri; ingen KI-kall herfra).
 */

const dir = __dirname;
const files = readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts"));
const read = (file: string) => readFileSync(join(dir, file), "utf8");
/** Filene nettleseren får: alt utenom serverhandlingene, siden og hjelperne bare for serveren. */
const serverFiles = new Set(["actions.ts", "page.tsx", "ai-fields.ts"]);
const clientFiles = files.filter((f) => !serverFiles.has(f));
const code = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

function imports(source: string): { from: string; typeOnly: boolean }[] {
  return [...source.matchAll(/import\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/gs)].map((m) => ({
    from: m[2]!,
    typeOnly: Boolean(m[1]),
  }));
}

describe("publiser-siden", () => {
  it("har klientfiler å kontrollere", () => {
    expect(clientFiles).toEqual(
      expect.arrayContaining([
        "publish-view.tsx",
        "blocker-item.tsx",
        "override-reasons.tsx",
        "quick-fix.tsx",
        "publish-bar.tsx",
        "finding-list.tsx",
      ]),
    );
  });

  it.each(clientFiles)(
    "%s importerer ikke rapportkjernen, databasen, tilgangen eller KI",
    (file) => {
      for (const { from, typeOnly } of imports(read(file))) {
        expect(from, `${file}: ${from}`).not.toBe("@/core/reports");
        expect(from.startsWith("@/core/access"), `${file}: ${from}`).toBe(false);
        expect(from.startsWith("@/core/ai"), `${file}: ${from}`).toBe(false);
        if (from.startsWith("@/db") || from.startsWith("@/core/reports/")) {
          if (from !== "@/core/reports/logic") {
            expect(typeOnly, `${file}: ${from} skal bare gi typer`).toBe(true);
          }
        }
      }
    },
  );

  it("ai-fields.ts er bare for serveren", () => {
    expect(read("ai-fields.ts")).toMatch(/^import "server-only";/);
  });

  it.each(files)("%s har ingen dialog, nedtrekk, hex-farger eller lokal lagring", (file) => {
    const source = code(file);
    expect(source).not.toMatch(/<dialog\b|showModal|role="dialog"|window\.confirm/);
    expect(source).not.toMatch(/<select\b|\bSelect\b/);
    expect(source).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|IndexedDB/);
  });

  it("sperrekortet bruker ikke TG3-tonen, og bryteren er ikke en avkrysningsboks", () => {
    const source = code("blocker-item.tsx");
    expect(source).not.toMatch(/\b(bg|text|border|ring)-(urgent|tg3)/);
    expect(source).toContain("border-l-night");
    expect(source).toContain("<Switch");
    expect(source).not.toMatch(/type="checkbox"|\bCheckbox\b/);
  });

  it("«Rett nå» har ingen forhåndsvalgt TG", () => {
    const source = code("quick-fix.tsx");
    expect(source).not.toMatch(/useState<string \| null>\(\s*["']/);
    expect(source.match(/useState<string \| null>\(null\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("KI blir aldri kalt fra siden (bare avgjørelser på forslag som finnes)", () => {
    const source = code("actions.ts");
    expect(source).not.toMatch(/requestSuggestion/);
    for (const file of clientFiles) expect(code(file)).not.toMatch(/requestSuggestion/);
  });
});
