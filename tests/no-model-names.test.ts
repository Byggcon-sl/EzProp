import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * S1: ingen modellnavn eller modell-id i koden, testene, e2e eller notatet
 * (docs/funksjoner/fase2a-ki-leverandor-testplan.md 4.1, kortet Omfang 10). Modell-id står bare i
 * tilkoblingens `settings.model`. Søkeordene bygges av biter, så denne filen ikke treffer seg selv,
 * og søket treffer ikke filnavnet for prosjektinstruksene eller agentmappen.
 *
 * Støtter hovedmål: KI i bunnen (leverandøren og modellen kan byttes i konfigurasjonen uten
 * kodeendring) og CLAUDE.md («aldri modellnavn i kode»).
 */

const repoRoot = join(__dirname, "..");

const VENDOR = ["cla", "ude"].join("");
const FAMILIES = [
  ["op", "us"],
  ["son", "net"],
  ["hai", "ku"],
].map((parts) => parts.join(""));

/** Prefikset til modell-id-ene (navnet og bindestrek) og navnene på modellfamiliene som egne ord. */
const MODEL_NAME = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${VENDOR}-|(?:${FAMILIES.join("|")})(?![\\p{L}\\p{N}]))`,
  "iu",
);

const TEXT_FILE = /\.(ts|tsx|js|mjs|cjs|json|md|css|html|yml|yaml|txt|sql)$/;

function filesUnder(dir: string): string[] {
  const full = join(repoRoot, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && TEXT_FILE.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) => !file.split(sep).includes("node_modules"));
}

const rel = (file: string) => relative(repoRoot, file).split(sep).join("/");

function docsFiles(): string[] {
  const docs = [join(repoRoot, "docs", "beslutningsnotat-ki-leverandor.md")];
  const funksjoner = join(repoRoot, "docs", "funksjoner");
  for (const name of readdirSync(funksjoner)) {
    if (/^fase2a-ki-leverandor.*\.md$/.test(name)) docs.push(join(funksjoner, name));
  }
  return docs;
}

/** Linjene med treff, som «fil:linje». Verdien vises, så den kan rettes. */
function offenders(files: string[]): string[] {
  return files.flatMap((file) => {
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line, index) => (MODEL_NAME.test(line) ? [`${rel(file)}:${index + 1}`] : []));
  });
}

describe("ingen modellnavn (S1)", () => {
  it("S1 kontroll: et oppdiktet treff gir rødt", () => {
    expect(MODEL_NAME.test(`model: "${VENDOR}-merke-k7q"`)).toBe(true);
    expect(MODEL_NAME.test(`${VENDOR.toUpperCase()}-MERKE`)).toBe(true);
    for (const family of FAMILIES) {
      expect(MODEL_NAME.test(`bruk ${family} til språkvask`), family).toBe(true);
      expect(MODEL_NAME.test(`${family[0]!.toUpperCase()}${family.slice(1)} 4`), family).toBe(true);
    }
  });

  it("S1 kontroll: filnavnet for prosjektinstruksene og agentmappen gir grønt", () => {
    expect(MODEL_NAME.test(`Les ${VENDOR.toUpperCase()}.md først`)).toBe(false);
    expect(MODEL_NAME.test(`.${VENDOR}/agents/testskriver.md`)).toBe(false);
    expect(MODEL_NAME.test(`.${VENDOR}/worktrees`)).toBe(false);
    expect(MODEL_NAME.test("MERKE-MODELL-K7Q")).toBe(false);
  });

  it("S1 src/, tests/ og e2e/ har ingen modellnavn eller modell-id", () => {
    const files = [...filesUnder("src"), ...filesUnder("tests"), ...filesUnder("e2e")];
    expect(files.length).toBeGreaterThan(100);
    expect(offenders(files)).toEqual([]);
  });

  it("S1 beslutningsnotatet og oppgavekortet med testplan har ingen modellnavn eller modell-id", () => {
    const files = docsFiles();
    expect(files.map(rel)).toContain("docs/funksjoner/fase2a-ki-leverandor.md");
    expect(offenders(files)).toEqual([]);
  });
});
