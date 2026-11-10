import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Statiske kontroller for forslagsmønsteret (docs/funksjoner/fase2a-forslagsmonster-testplan.md
 * avsnitt 8). Leser kildefilene; ingen database.
 *
 * Støtter hovedmål: KI i bunnen (én vei inn til KI, kortet og merket er rene visninger) og færre
 * reklamasjoner (statusoppslaget og sperren leser aldri teksten, og ingenting teller forslag per
 * ansatt).
 */

const repoRoot = join(__dirname, "..", "..", "..");
const srcDir = join(repoRoot, "src");
const aiDir = join(srcDir, "core", "ai");
const uiDir = join(srcDir, "shared", "ui");
const trialDir = join(srcDir, "app", "(ansatt)", "prove", "ki");

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

/** Alle importstiene i en fil (`import … from`, `export … from`, `import()` og `require()`). */
function importsOf(source: string): string[] {
  const out: string[] = [];
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) out.push(match[1]!);
  }
  return out;
}

/** Importstien gjort om til sti fra src (`core/ai/...`), også for relative stier. */
function targetInSrc(file: string, specifier: string): string | null {
  if (specifier.startsWith("@/")) return specifier.slice(2);
  if (specifier.startsWith(".")) {
    return relative(srcDir, resolve(dirname(file), specifier))
      .split(sep)
      .join("/");
  }
  return null;
}

const FORBIDDEN_FOR_UI = [/^core\/access(\/|$)/, /^db(\/|$)/, /^core\/ai(\/|$)/];

/** Filen i src/core/ai (ikke test) som definerer funksjonen. */
function fileDefining(name: string): string | undefined {
  const pattern = new RegExp(
    `export\\s+(async\\s+)?function\\s+${name}\\b|export\\s+const\\s+${name}\\b`,
  );
  return productFiles(aiDir).find((file) => pattern.test(read(file)));
}

describe("forslagsmønsteret, statiske kontroller (8)", () => {
  it.each(["ai-suggestion.tsx", "ai-text-mark.tsx"])(
    "8.1 src/shared/ui/%s finnes og importerer ikke @/core/access, @/db eller @/core/ai",
    (name) => {
      const file = join(uiDir, name);
      expect(existsSync(file), rel(file)).toBe(true);
      const offenders = importsOf(read(file))
        .map((specifier) => targetInSrc(file, specifier))
        .filter((target): target is string => target !== null)
        .filter((target) => FORBIDDEN_FOR_UI.some((pattern) => pattern.test(target)));
      expect(offenders).toEqual([]);
    },
  );

  it("8.1 sjekken er ikke hul: relative stier til kjernen og databasen fanges", () => {
    const file = join(uiDir, "ai-suggestion.tsx");
    const sample = [
      'import { db } from "../../db/client";',
      'import { requireOrganizationAccess } from "../../core/access";',
      'import { requestSuggestion } from "@/core/ai";',
      'const lazy = await import("../../core/ai/index");',
    ].join("\n");
    const found = importsOf(sample)
      .map((specifier) => targetInSrc(file, specifier))
      .filter((target): target is string => target !== null)
      .filter((target) => FORBIDDEN_FOR_UI.some((pattern) => pattern.test(target)));
    expect(found).toHaveLength(4);
    expect(targetInSrc(file, "./card")).toBe("shared/ui/card");
  });

  it('8.2 ingen fil i prove/ki importerer src/core/ai/providers eller nevner portene "ai"/"speech_to_text"', () => {
    const files = productFiles(trialDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = read(file);
      const aiImports = importsOf(source)
        .map((specifier) => targetInSrc(file, specifier))
        .filter((target): target is string => target !== null && target.startsWith("core/ai"));
      expect(
        aiImports.filter((target) => target !== "core/ai"),
        rel(file),
      ).toEqual([]);
      expect(source, rel(file)).not.toMatch(/(["'`])(ai|speech_to_text)\1/);
    }
  });

  it.each(["getSuggestionStatus", "checkAiTextApproved"])(
    "8.3 filen med %s nevner ikke outputText eller output_text",
    (name) => {
      const file = fileDefining(name);
      expect(file, `fant ikke ${name} i src/core/ai`).toBeDefined();
      expect(read(file!), rel(file!)).not.toMatch(/outputText|output_text/);
    },
  );

  it("8.4 @/core/ai eksporterer ingen funksjon som lister eller teller forslag per ansatt", async () => {
    const ai: Record<string, unknown> = await import("./index");
    const forbidden = /^(list|count)|ByEmployee|PerEmployee|Statistics/i;
    expect(Object.keys(ai).filter((name) => forbidden.test(name))).toEqual([]);
    expect(Object.keys(ai)).toEqual(
      expect.arrayContaining(["getSuggestionStatus", "checkAiTextApproved"]),
    );
    const source = read(join(aiDir, "index.ts"));
    expect(source).not.toMatch(/export[^;]*\b(list\w*|count\w*|\w*ByEmployee|\w*PerEmployee)\b/);
  });

  it('8.5 "ai_trial" står bare i features.ts, prøvesiden og testene', () => {
    const allowed = (file: string) =>
      rel(file) === "src/core/ai/features.ts" || rel(file).startsWith("src/app/(ansatt)/prove/ki/");
    const offenders = productFiles(srcDir)
      .filter((file) => !allowed(file))
      .filter((file) => /ai_trial/.test(read(file)))
      .map(rel);
    expect(offenders).toEqual([]);
    // Og den står faktisk i features.ts (ellers er testen hul)
    expect(read(join(aiDir, "features.ts"))).toMatch(/["']ai_trial["']/);
  });
});
