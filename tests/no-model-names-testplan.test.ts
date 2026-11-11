import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * S1: ingen modellnavn eller modell-id i koden, testene, e2e eller notatet
 * (docs/funksjoner/fase2a-ki-leverandor-testplan.md 4.1, kortet Omfang 10). Modell-id står bare
 * i tilkoblingens `settings.model`. Søkeordene bygges av biter, så denne filen ikke treffer seg
 * selv. Søket treffer ikke filnavnet «CLAUDE.md» eller mappen «.claude/».
 *
 * Støtter hovedmål: KI i bunnen (leverandør og modell kan byttes i tilkoblingen uten kodeendring)
 * og regelen om ingen modellnavn i filer.
 */

const repoRoot = join(__dirname, "..");

const VENDOR = ["cl", "au", "de"].join("");
const FAMILIES = [
  ["op", "us"],
  ["son", "net"],
  ["hai", "ku"],
].map((parts) => parts.join(""));

/** Prefikset til modell-id-ene («<leverandør>-») og navnene på modellfamiliene, som hele ord. */
const MODEL_NAME_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${VENDOR}-|(?:${FAMILIES.join("|")})(?![\\p{L}\\p{N}]))`,
  "iu",
);

const TEXT_FILE = /\.(ts|tsx|js|mjs|cjs|json|md|css|html|txt|yml|yaml)$/;

function filesUnder(dir: string): string[] {
  const full = join(repoRoot, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && TEXT_FILE.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) => !file.split(sep).includes("node_modules"));
}

const rel = (file: string) => relative(repoRoot, file).split(sep).join("/");

function scannedFiles(): string[] {
  const docs = [
    "docs/beslutningsnotat-ki-leverandor.md",
    "docs/funksjoner/fase2a-ki-leverandor.md",
    "docs/funksjoner/fase2a-ki-leverandor-testplan.md",
  ].map((path) => join(repoRoot, path));
  return [...filesUnder("src"), ...filesUnder("tests"), ...filesUnder("e2e"), ...docs];
}

/** Linjene med treff, som «sti:linje». */
function hits(path: string, text: string): string[] {
  return text
    .split("\n")
    .map((line, index) => (MODEL_NAME_PATTERN.test(line) ? `${path}:${index + 1}` : null))
    .filter((hit): hit is string => hit !== null);
}

describe("S1 ingen modellnavn eller modell-id", () => {
  it("beslutningsnotatet finnes (ellers sier testen ingenting om det)", () => {
    expect(existsSync(join(repoRoot, "docs/beslutningsnotat-ki-leverandor.md"))).toBe(true);
  });

  it("src/, tests/, e2e/, notatet og kortet har ingen treff", () => {
    const files = scannedFiles().filter((file) => existsSync(file));
    expect(files.length).toBeGreaterThan(100);
    const found = files.flatMap((file) => hits(rel(file), readFileSync(file, "utf8")));
    expect(found).toEqual([]);
  });

  it("kontroll: et oppdiktet treff gir rødt", () => {
    const fakeId = `${VENDOR}-${FAMILIES[0]}-0-0`;
    expect(hits("x.ts", `const model = "${fakeId}";`)).toEqual(["x.ts:1"]);
    expect(
      hits("x.md", `Bruk ${FAMILIES[1]![0]!.toUpperCase()}${FAMILIES[1]!.slice(1)} til dette.`),
    ).toEqual(["x.md:1"]);
    expect(hits("x.md", `${FAMILIES[2]!.toUpperCase()}`)).toEqual(["x.md:1"]);
  });

  it("kontroll: CLAUDE.md, .claude/ og vanlige ord gir grønt", () => {
    for (const text of [
      `Les ${VENDOR.toUpperCase()}.md først.`,
      `Agentene ligger i .${VENDOR}/agents/.`,
      "Opusvegg og sonnetter er ikke modellnavn; heller ikke haikudikt.",
    ]) {
      expect(hits("x.md", text), text).toEqual([]);
    }
  });
});
