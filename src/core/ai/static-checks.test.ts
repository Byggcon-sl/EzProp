import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { PROVIDERS_BY_PORT } from "@/core/integrations";

/*
 * Testplan docs/funksjoner/fase2a-ki-modul-logg-testplan.md avsnitt 12 (mønster fra
 * src/core/integrations/static-checks.test.ts, A161). Støtter hovedmål: KI i bunnen (bare
 * src/core/ai bruker KI-portene, og bare den falske leverandøren finnes før S8) og færre
 * reklamasjoner (loggen slettes aldri, og ingenting telles per ansatt).
 */

const repoRoot = join(__dirname, "..", "..", "..");
const srcDir = join(repoRoot, "src");
const aiDir = join(srcDir, "core", "ai");

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

const isTest = (file: string) => /\.test\.tsx?$/.test(file);
const rel = (file: string) => relative(repoRoot, file).split(sep).join("/");
const read = (file: string) => readFileSync(file, "utf8");
const productFiles = (dir: string) => sourceFiles(dir).filter((file) => !isTest(file));

/** Portene `ai` og `speech_to_text` som strengliteral, med enkle eller doble anførselstegn. */
const AI_PORT_LITERAL = /(["'])(?:ai|speech_to_text)\1/;

const PORT_ALLOWED_FILES = new Set([
  "src/core/integrations/ports.ts",
  "src/db/seed/sample-assignments.ts",
]);

function mayUseAiPorts(file: string): boolean {
  const path = rel(file);
  return isTest(file) || path.startsWith("src/core/ai/") || PORT_ALLOWED_FILES.has(path);
}

describe("KI-modulen, statiske kontroller", () => {
  it("1. src/core/ai har kildefiler (ellers sier testene under ingenting)", () => {
    expect(productFiles(aiDir).length).toBeGreaterThan(0);
    expect(existsSync(join(aiDir, "index.ts"))).toBe(true);
  });

  it("2. portene ai og speech_to_text står bare i src/core/ai, ports.ts, seed og testfiler", () => {
    const offenders = sourceFiles(srcDir)
      .filter((file) => !mayUseAiPorts(file))
      .filter((file) => AI_PORT_LITERAL.test(read(file)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("3. mønsteret for portene er ikke hult", () => {
    expect(AI_PORT_LITERAL.test('findActiveConnection(orgId, "ai")')).toBe(true);
    expect(AI_PORT_LITERAL.test("findActiveConnection(orgId, 'ai')")).toBe(true);
    expect(AI_PORT_LITERAL.test('const port = "speech_to_text";')).toBe(true);
    expect(AI_PORT_LITERAL.test('"aim"')).toBe(false);
    expect(AI_PORT_LITERAL.test('"air"')).toBe(false);
    expect(AI_PORT_LITERAL.test("\"ai'")).toBe(false);
    expect(AI_PORT_LITERAL.test("ai")).toBe(false);
  });

  it("4. ingen sletting: ingen .delete( på aiUsageLog i src/", () => {
    for (const file of productFiles(srcDir)) {
      expect(read(file), rel(file)).not.toMatch(/\.delete\s*\(\s*aiUsageLog\b/);
    }
  });

  it("5. ingen console. og ingen process.env i src/core/ai", () => {
    const offenders = productFiles(aiDir)
      .filter((file) => /\bconsole\.|process\.env/.test(read(file)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("6. PROVIDERS_BY_PORT.ai er nøyaktig fake, og speech_to_text er tom (S8)", () => {
    expect([...PROVIDERS_BY_PORT.ai]).toEqual(["fake"]);
    expect([...PROVIDERS_BY_PORT.speech_to_text]).toEqual([]);
  });

  it("7. index.ts eksporterer ikke noe som lister eller teller rader per ansatt", async () => {
    const perEmployee = /^(list|count)|ByEmployee|Statistics/i;
    const exported: Record<string, unknown> = await import("./index");
    expect(Object.keys(exported).filter((name) => perEmployee.test(name))).toEqual([]);

    const text = read(join(aiDir, "index.ts"));
    const names = [...text.matchAll(/\b(?:type\s+)?([A-Za-z_$][\w$]*)\s*(?:,|\n\s*\})/g)].map(
      (match) => match[1]!,
    );
    expect(names.filter((name) => perEmployee.test(name))).toEqual([]);
  });

  it("8. ingen SDK og ingen readSecret i src/core/ai", () => {
    const allowedImport = /^(?:@\/|\.|drizzle-orm$|drizzle-orm\/|zod$)/;
    for (const file of productFiles(aiDir)) {
      const text = read(file);
      expect(text, rel(file)).not.toMatch(/readSecret/);
      const imports = [...text.matchAll(/\bfrom\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']/g)]
        .map((match) => match[1] ?? match[2]!)
        .filter((source) => !allowedImport.test(source));
      expect(imports, rel(file)).toEqual([]);
    }
  });
});
