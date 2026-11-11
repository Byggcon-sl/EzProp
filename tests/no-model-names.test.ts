import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * S1, ingen modellnavn (docs/funksjoner/fase2a-ki-leverandor-testplan.md avsnitt 4, kortet
 * Omfang 10). Modell-id står bare i tilkoblingens `settings.model`, aldri i kode, tester eller
 * notatet. Søkeordene bygges av biter, så denne filen ikke inneholder navnene selv. Søket treffer
 * prefikset til modell-id-ene (med bindestrek) og navnene på modellfamiliene, ikke selskapsnavnet
 * alene, filnavnet for prosjektinstruksjonene eller mappen for agentene.
 *
 * Støtter hovedmål: KI i bunnen (modellen byttes i tilkoblingen, uten kodeendring).
 */

const repoRoot = join(__dirname, "..");

const ID_PREFIX = ["cla", "ude-"].join("");
const FAMILIES = [
  ["op", "us"],
  ["son", "net"],
  ["hai", "ku"],
].map((parts) => parts.join(""));

const MODEL_NAME = new RegExp(`${ID_PREFIX}|\\b(?:${FAMILIES.join("|")})\\b`, "iu");

/** Mappene og enkeltfilene som skal være uten modellnavn. Notatet hoppes over til det finnes. */
const DIRS = ["src", "tests", "e2e"];
const FILES = ["docs/beslutningsnotat-ki-leverandor.md"];
const CARD_PATTERN = /^fase2a-ki-leverandor.*\.md$/u;

const TEXT_FILE = /\.(ts|tsx|js|mjs|cjs|json|md|css|sql|ya?ml|txt|html|svg)$/u;

function filesIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && TEXT_FILE.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

function filesToScan(): string[] {
  const cards = readdirSync(join(repoRoot, "docs", "funksjoner"))
    .filter((name) => CARD_PATTERN.test(name))
    .map((name) => join(repoRoot, "docs", "funksjoner", name));
  const single = FILES.map((file) => join(repoRoot, file)).filter(
    (file) => existsSync(file) && statSync(file).isFile(),
  );
  return [...DIRS.flatMap((dir) => filesIn(join(repoRoot, dir))), ...single, ...cards];
}

const rel = (file: string) => relative(repoRoot, file).split(sep).join("/");

/** Linjene med treff, som «fil:linje». */
function hits(path: string, text: string): string[] {
  return text
    .split("\n")
    .flatMap((line, index) => (MODEL_NAME.test(line) ? [`${path}:${index + 1}`] : []));
}

describe("S1 ingen modellnavn i koden, testene og notatet", () => {
  it("ingen treff i src/, tests/, e2e/, notatet og oppgavekortet", () => {
    const files = filesToScan();
    expect(files.length).toBeGreaterThan(100);
    expect(files.map(rel)).toContain("tests/no-model-names.test.ts");
    const offenders = files.flatMap((file) => hits(rel(file), readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("kontroll: et oppdiktet treff gir rødt, og filnavnet for prosjektinstruksjonene gir grønt", () => {
    const fakeId = [ID_PREFIX, "oppdiktet-9"].join("");
    expect(hits("x.ts", `const model = "${fakeId}";`)).toEqual(["x.ts:1"]);
    expect(hits("x.md", `Bruk ${ID_PREFIX.toUpperCase()}OPPDIKTET.`)).toEqual(["x.md:1"]);
    for (const family of FAMILIES) {
      const capitalized = family[0]!.toUpperCase() + family.slice(1);
      expect(hits("x.md", `Modellen ${capitalized} 9 brukes.`), family).toEqual(["x.md:1"]);
    }
    const instructions = ["CLAU", "DE.md"].join("");
    const agentsDir = [".cla", "ude/agents/utvikler.md"].join("");
    expect(hits("x.md", `Les ${instructions} og ${agentsDir}.`)).toEqual([]);
    expect(hits("x.md", "Leverandøren er Anthropic.")).toEqual([]);
  });
});
