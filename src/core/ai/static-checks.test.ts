import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { PROVIDERS_BY_PORT } from "@/core/integrations";

/*
 * Statiske kontroller for KI-modulen (docs/funksjoner/fase2a-ki-modul-logg-testplan.md avsnitt
 * 12, kortet Omfang 9, A161). Samme mønster som src/core/integrations/static-checks.test.ts.
 *
 * Støtter hovedmål: KI i bunnen (én vei inn: bare src/core/ai bruker KI-portene) og færre
 * reklamasjoner (ingen ekte leverandør før vasken og S8, ingenting slettes, ingen tall per ansatt).
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

/** Portene `ai` og `speech_to_text` som strengliteral, med enkle, doble eller bakvendte fnutter. */
const PORT_LITERAL = /(["'`])(ai|speech_to_text)\1/;

/** Filene som kan nevne portene (utenom src/core/ai/** og testfiler). */
const PORT_ALLOWED = new Set([
  "src/core/integrations/ports.ts",
  "src/db/seed/sample-assignments.ts",
]);

describe("KI-modulen, statiske kontroller (12)", () => {
  it("12.1 src/core/ai har kildefiler (ellers sier testene under ingenting)", () => {
    expect(productFiles(aiDir).length).toBeGreaterThan(0);
    expect(existsSync(join(aiDir, "index.ts"))).toBe(true);
  });

  it('12.2 portene "ai" og "speech_to_text" står bare i src/core/ai, ports.ts og seed', () => {
    const offenders = productFiles(srcDir)
      .filter((file) => !rel(file).startsWith("src/core/ai/"))
      .filter((file) => !PORT_ALLOWED.has(rel(file)))
      .filter((file) => PORT_LITERAL.test(read(file)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("12.3 mønsteret er ikke hult", () => {
    expect(PORT_LITERAL.test('findActiveConnection(orgId, "ai")')).toBe(true);
    expect(PORT_LITERAL.test("findActiveConnection(orgId, 'ai')")).toBe(true);
    expect(PORT_LITERAL.test("const port = `speech_to_text`;")).toBe(true);
    expect(PORT_LITERAL.test('port: "speech_to_text"')).toBe(true);
    expect(PORT_LITERAL.test('const word = "aim";')).toBe(false);
    expect(PORT_LITERAL.test('const word = "air";')).toBe(false);
    expect(PORT_LITERAL.test('const word = "ai_usage_log";')).toBe(false);
    expect(PORT_LITERAL.test("const text = \"ai' og 'ai\";")).toBe(false);
    // Seed og ports.ts nevner faktisk portene (ellers er unntakene ubrukte)
    expect(PORT_LITERAL.test(read(join(srcDir, "core", "integrations", "ports.ts")))).toBe(true);
    expect(PORT_LITERAL.test(read(join(srcDir, "db", "seed", "sample-assignments.ts")))).toBe(true);
  });

  it("12.4 ingen .delete( på aiUsageLog i src/", () => {
    for (const file of productFiles(srcDir)) {
      expect(read(file), rel(file)).not.toMatch(/\.delete\s*\(\s*aiUsageLog\b/);
      expect(read(file), rel(file)).not.toMatch(/delete\s+from\s+["']?ai_usage_log/i);
    }
  });

  it("12.5 ingen console. og ingen process.env i src/core/ai (utenom testfiler)", () => {
    const offenders = productFiles(aiDir)
      .filter((file) => /\bconsole\.|process\.env/.test(read(file)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('12.6 PROVIDERS_BY_PORT.ai er nøyaktig ["fake"], og speech_to_text er tom', () => {
    const providers = PROVIDERS_BY_PORT as Record<string, readonly string[]>;
    expect([...providers.ai!]).toEqual(["fake"]);
    expect([...providers.speech_to_text!]).toEqual([]);
  });

  it("12.7 index.ts eksporterer ikke noe som lister eller teller rader per ansatt", async () => {
    const ai: Record<string, unknown> = await import("./index");
    const forbidden = /^(list|count)|ByEmployee|Statistics/i;
    expect(Object.keys(ai).filter((name) => forbidden.test(name))).toEqual([]);
    expect(Object.keys(ai)).toEqual(
      expect.arrayContaining(["requestSuggestion", "recordDecision"]),
    );
    // Også det som bare er typer, sjekkes i kildeteksten
    const source = read(join(aiDir, "index.ts"));
    expect(source).not.toMatch(/export[^;]*\b(list\w*|count\w*|\w*ByEmployee|\w*Statistics)\b/);
  });

  it("12.8 ingen SDK-er, ingen readSecret og ingen fetch i src/core/ai (ingen ekte leverandør ennå)", () => {
    const sdk =
      /from\s+["'](openai|@anthropic-ai\/[^"']*|@azure\/openai|@azure\/ai-[^"']*|@google\/[^"']*|@mistralai\/[^"']*|cohere-ai|ai|@ai-sdk\/[^"']*)["']/;
    for (const file of productFiles(aiDir)) {
      const text = read(file);
      expect(text, rel(file)).not.toMatch(sdk);
      expect(text, rel(file)).not.toMatch(/\breadSecret\b/);
      expect(text, rel(file)).not.toMatch(/\bfetch\s*\(/);
    }
  });

  it("12.9 src/app og src/modules importerer ikke leverandørene eller loggen direkte", () => {
    const callers = [...sourceFiles(join(srcDir, "app")), ...sourceFiles(join(srcDir, "modules"))];
    const offenders = callers
      .filter((file) =>
        /["']@\/core\/ai\/(providers|usage-log|features|prompts)[^"']*["']/.test(read(file)),
      )
      .map(rel);
    expect(offenders).toEqual([]);
  });
});
