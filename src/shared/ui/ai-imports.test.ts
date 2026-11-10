import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Statiske kontroller for forslagskortet, KI-merket og prøvesiden
 * (docs/funksjoner/fase2a-forslagsmonster-testplan.md avsnitt 8.1 og 8.2).
 * Kortet og merket vet ingenting om tilgang, lagring eller KI-modulen, heller ikke via relative
 * stier eller via filene de selv importerer. Prøvesiden går bare via `@/core/ai`.
 * Støtter hovedmål: KI i bunnen (én vei inn til KI) og reklamasjoner (tilgang sjekkes bare i kjernen).
 */

const repoRoot = join(__dirname, "..", "..", "..");
const srcDir = join(repoRoot, "src");
const rel = (file: string) => relative(repoRoot, file).split(sep).join("/");
const read = (file: string) => readFileSync(file, "utf8");

const COMPONENTS = ["src/shared/ui/ai-suggestion.tsx", "src/shared/ui/ai-text-mark.tsx"];
const TRIAL_DIR = join(srcDir, "app", "(ansatt)", "prove", "ki");

/** Mappene kortet og merket aldri skal nå (relativt til `src/`). */
const FORBIDDEN = ["core/access", "db", "core/ai"];

/** Alle importstier i en fil (`import … from`, `export … from`, `import()` og `require()`). */
function importSpecifiers(source: string): string[] {
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  return patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1]!));
}

/** Stien en import peker til, relativt til `src/` (uten filendelse), eller `null` for pakker. */
function resolveInSrc(fromFile: string, specifier: string): string | null {
  let absolute: string;
  if (specifier.startsWith("@/")) absolute = join(srcDir, specifier.slice(2));
  else if (specifier.startsWith(".")) absolute = resolve(dirname(fromFile), specifier);
  else return null;
  return relative(srcDir, absolute).split(sep).join("/");
}

function isForbidden(srcPath: string): boolean {
  return FORBIDDEN.some((dir) => srcPath === dir || srcPath.startsWith(`${dir}/`));
}

/** Filen bak en sti i `src/` (med .ts, .tsx eller index), eller `null`. */
function sourceFileFor(srcPath: string): string | null {
  const base = join(srcDir, srcPath);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && /\.(ts|tsx)$/.test(candidate)) return candidate;
  }
  return null;
}

/** Alle importer fra filen og filene den importerer i `src/`, som stier i `src/`. */
function transitiveImports(start: string): { from: string; to: string }[] {
  const seen = new Set<string>();
  const found: { from: string; to: string }[] = [];
  const queue = [start];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of importSpecifiers(read(file))) {
      const target = resolveInSrc(file, specifier);
      if (target === null) continue;
      found.push({ from: rel(file), to: target });
      const next = sourceFileFor(target);
      // Serverhandlinger kjører på serveren; klienten får bare en referanse til dem
      if (next && !isForbidden(target) && !read(next).startsWith('"use server"')) queue.push(next);
    }
  }
  return found;
}

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) => !/\.test\.tsx?$/.test(file));
}

describe("8.1 forslagskortet og KI-merket", () => {
  it.each(COMPONENTS)("%s finnes og importerer ikke tilgang, database eller KI-modulen", (file) => {
    const path = join(repoRoot, file);
    expect(existsSync(path)).toBe(true);
    const offenders = transitiveImports(path).filter((entry) => isForbidden(entry.to));
    expect(offenders).toEqual([]);
  });

  it("sjekken er ikke hul: både @/-stier og relative stier fanges", () => {
    const from = join(srcDir, "shared", "ui", "ai-suggestion.tsx");
    expect(isForbidden(resolveInSrc(from, "@/core/access")!)).toBe(true);
    expect(isForbidden(resolveInSrc(from, "@/db/schema")!)).toBe(true);
    expect(isForbidden(resolveInSrc(from, "@/core/ai")!)).toBe(true);
    expect(isForbidden(resolveInSrc(from, "../../core/access")!)).toBe(true);
    expect(isForbidden(resolveInSrc(from, "../../db/client")!)).toBe(true);
    expect(isForbidden(resolveInSrc(from, "../../core/ai/index")!)).toBe(true);
    expect(isForbidden(resolveInSrc(from, "./button")!)).toBe(false);
    expect(isForbidden(resolveInSrc(from, "@/core/aim")!)).toBe(false);
    expect(resolveInSrc(from, "react")).toBeNull();
    expect(
      importSpecifiers('import { x } from "@/db";\nexport { y } from "../../core/ai";\n'),
    ).toEqual(["@/db", "../../core/ai"]);
  });

  it("kortet bruker aldri dangerouslySetInnerHTML", () => {
    for (const file of COMPONENTS) {
      expect(read(join(repoRoot, file))).not.toContain("dangerouslySetInnerHTML");
    }
  });
});

describe("8.2 prøvesiden /prove/ki", () => {
  const files = sourceFiles(TRIAL_DIR);

  it("har kildefiler (ellers sier testene under ingenting)", () => {
    expect(files.map(rel).sort()).toEqual(
      expect.arrayContaining([
        "src/app/(ansatt)/prove/ki/actions.ts",
        "src/app/(ansatt)/prove/ki/page.tsx",
      ]),
    );
  });

  it("importerer aldri leverandørene direkte, bare @/core/ai", () => {
    for (const file of files) {
      for (const specifier of importSpecifiers(read(file))) {
        const target = resolveInSrc(file, specifier);
        if (target === null) continue;
        expect(target, rel(file)).not.toMatch(/^core\/ai\/providers(\/|$)/);
        expect(target, rel(file)).not.toMatch(/^core\/integrations(\/|$)/);
        if (target.startsWith("core/ai")) expect(target, rel(file)).toBe("core/ai");
      }
    }
  });

  it("nevner ikke portene som strengliteral", () => {
    for (const file of files) {
      expect(read(file), rel(file)).not.toMatch(/(["'`])(ai|speech_to_text)\1/);
    }
  });

  it("klientdelen importerer ikke tilgang, database eller KI-modulen", () => {
    for (const file of files.filter((entry) => read(entry).startsWith('"use client"'))) {
      const offenders = transitiveImports(file).filter((entry) => isForbidden(entry.to));
      expect(offenders, rel(file)).toEqual([]);
    }
  });
});
