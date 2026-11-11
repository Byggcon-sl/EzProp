import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Ingen modellnavn i koden, testene eller notatet (docs/funksjoner/fase2a-ki-leverandor-testplan.md
 * S1, kortet Omfang 10). Modell-id står bare i tilkoblingens `settings.model`.
 *
 * Søkeordene bygges av biter her, så denne filen selv ikke inneholder dem. Søket treffer ikke
 * filnavnet for prosjektinstruksjonene eller mappen for agentene (ingen bindestrek etter ordet).
 *
 * Støtter hovedmål: KI i bunnen. Modellen kan byttes i innstillingene uten kodeendring.
 */

const repoRoot = join(__dirname, "..");
const rel = (file: string) => relative(repoRoot, file).split(sep).join("/");

/** Prefikset til modell-id-ene. */
const MODEL_PREFIX = ["cla", "ude-"].join("");
/** Navnene på modellfamiliene. */
const FAMILY_NAMES = [["ha", "iku"].join(""), ["son", "net"].join(""), ["op", "us"].join("")];

const MODEL_NAME = new RegExp(`${MODEL_PREFIX}|\\b(${FAMILY_NAMES.join("|")})\\b`, "i");

const TEXT_FILE = /\.(ts|tsx|js|mjs|cjs|json|sql|css|md)$/;

function textFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && TEXT_FILE.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

/** Notatet og kortene for KI-leverandøren. Notatet eies av tests/decision-note.test.ts. */
function docFiles(): string[] {
  const funksjoner = join(repoRoot, "docs", "funksjoner");
  const cards = readdirSync(funksjoner)
    .filter((name) => /^fase2a-ki-leverandor.*\.md$/.test(name))
    .map((name) => join(funksjoner, name));
  const note = join(repoRoot, "docs", "beslutningsnotat-ki-leverandor.md");
  return [...cards, ...(existsSync(note) ? [note] : [])];
}

function findModelNames(text: string): string[] {
  return text
    .split("\n")
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => MODEL_NAME.test(line))
    .map(({ index }) => `linje ${index + 1}`);
}

describe("S1 ingen modellnavn", () => {
  it("kontroll: et oppdiktet treff gir rødt", () => {
    expect(findModelNames(`model: "${MODEL_PREFIX}oppdiktet-1"`)).toEqual(["linje 1"]);
    for (const family of FAMILY_NAMES) {
      expect(findModelNames(`Vi bruker ${family} til språkvask.`), family).toEqual(["linje 1"]);
      const upper = family[0]!.toUpperCase() + family.slice(1);
      expect(findModelNames(`Modellen ${upper} er valgt.`), upper).toEqual(["linje 1"]);
    }
  });

  it("kontroll: filnavnet og agentmappen gir grønt", () => {
    const instructions = ["CLA", "UDE.md"].join("");
    const agents = [".cla", "ude/agents/utvikler.md"].join("");
    expect(findModelNames(`Les ${instructions} og ${agents}.`)).toEqual([]);
    expect(
      findModelNames("Ord som inneholder bitene, for eksempel «opusculum», gir grønt."),
    ).toEqual([]);
  });

  it("src/, tests/ og e2e/ har ingen modellnavn", () => {
    const files = ["src", "tests", "e2e"].flatMap((dir) => textFiles(join(repoRoot, dir)));
    expect(files.length).toBeGreaterThan(100);
    expect(files.map(rel)).toContain("tests/no-model-names.test.ts");
    const offenders = files.flatMap((file) =>
      findModelNames(readFileSync(file, "utf8")).map((line) => `${rel(file)}: ${line}`),
    );
    expect(offenders).toEqual([]);
  });

  it("notatet og kortene for KI-leverandøren har ingen modellnavn", () => {
    const files = docFiles();
    expect(files.map(rel)).toContain("docs/funksjoner/fase2a-ki-leverandor.md");
    expect(files.map(rel)).toContain("docs/funksjoner/fase2a-ki-leverandor-testplan.md");
    const offenders = files.flatMap((file) =>
      findModelNames(readFileSync(file, "utf8")).map((line) => `${rel(file)}: ${line}`),
    );
    expect(offenders).toEqual([]);
  });
});
