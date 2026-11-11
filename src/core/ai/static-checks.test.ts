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

  it("12.9 src/app og src/modules importerer ikke leverandørene, loggen eller evalueringssettet direkte", () => {
    const callers = [...sourceFiles(join(srcDir, "app")), ...sourceFiles(join(srcDir, "modules"))];
    const offenders = callers
      .filter((file) =>
        /["']@\/core\/ai\/(providers|usage-log|features|prompts|evals)[^"']*["']/.test(read(file)),
      )
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

/*
 * Forslagsmønsteret (docs/funksjoner/fase2a-forslagsmonster-testplan.md avsnitt 8.3–8.5). 8.1 og
 * 8.2 (kortet, merket og prøvesiden) ligger i src/shared/ui/ai-imports.test.ts.
 */
describe("forslagsmønsteret, statiske kontroller (8)", () => {
  it("8.3 statusoppslaget og sperren nevner ikke outputText eller output_text", () => {
    for (const name of ["suggestion-status.ts", "approval-check.ts"]) {
      const file = join(aiDir, name);
      expect(existsSync(file), name).toBe(true);
      expect(read(file), name).not.toMatch(/outputText|output_text/);
    }
  });

  it("8.4 @/core/ai eksporterer statusoppslaget og sperren, men ingen list*/count*", async () => {
    const ai: Record<string, unknown> = await import("./index");
    expect(Object.keys(ai)).toEqual(
      expect.arrayContaining([
        "getSuggestionStatus",
        "checkAiTextApproved",
        "AI_APPROVAL_CHECK_MAX",
      ]),
    );
    expect(Object.keys(ai).filter((name) => /^(list|count)/i.test(name))).toEqual([]);
  });

  it("8.5 ai_trial står bare i features.ts, prøvesiden og testene", () => {
    const allowed = (path: string) =>
      path === "src/core/ai/features.ts" || path.startsWith("src/app/(ansatt)/prove/ki/");
    const offenders = productFiles(srcDir)
      .filter((file) => !allowed(rel(file)))
      .filter((file) => /\bai_trial\b/.test(read(file)))
      .map(rel);
    expect(offenders).toEqual([]);
    // Ikke hul: features.ts har faktisk koden
    expect(read(join(aiDir, "features.ts"))).toMatch(/\bai_trial\b/);
  });
});

/*
 * Vask før KI, statiske kontroller (docs/funksjoner/fase2a-vask-for-ki-testplan.md V8.5–V8.7,
 * V10.1). Vasken ligger i den eneste veien til leverandøren, og antall vaskede treff og sperrede
 * forespørsler kan ikke leses per ansatt (spørsmål 57).
 */
describe("vask før KI, statiske kontroller (V8.5–V8.7)", () => {
  const requestFile = join(aiDir, "request-suggestion.ts");

  /*
   * Justert med vilje for evalueringssettet (docs/funksjoner/fase2a-evalueringssett-testplan.md
   * E7.1–E7.3): vasken og ledeteksten er flyttet til den rene `preparePrompt`, og kjøreren for
   * settet er det andre (og eneste andre) stedet leverandøren kalles. Kravet er det samme: vask
   * før kall, og ingen egen kopi av vask eller ledetekst.
   */
  it("V8.5/E7.1 .complete( kalles bare i request-suggestion.ts og evals/run.ts", () => {
    const offenders = productFiles(srcDir)
      .filter((file) => /\.complete\s*\(/.test(read(file)))
      .map(rel)
      .sort();
    expect(offenders).toEqual(["src/core/ai/evals/run.ts", "src/core/ai/request-suggestion.ts"]);
  });

  it("V8.5/E7.2 i begge filene står preparePrompt (som vasker) før leverandørkallet", () => {
    for (const file of [requestFile, join(aiDir, "evals", "run.ts")]) {
      expect(existsSync(file), rel(file)).toBe(true);
      const source = read(file);
      const complete = source.search(/\.complete\s*\(/);
      const prepare = source.search(/\bpreparePrompt\s*\(/);
      expect(complete, `${rel(file)}: leverandørkallet mangler`).toBeGreaterThan(-1);
      expect(prepare, `${rel(file)}: preparePrompt mangler`).toBeGreaterThan(-1);
      expect(prepare, rel(file)).toBeLessThan(complete);
      // Ingen egen kopi: ledeteksten bygges ikke her, og preparePrompt hentes fra prompt-modulen
      expect(source, rel(file)).not.toMatch(/\bbuildPrompt\s*\(/);
      expect(source, rel(file)).toMatch(
        /import\s*\{[^}]*\bpreparePrompt\b[^}]*\}\s*from\s+["'][^"']*prompt["']/,
      );
    }
  });

  it("V8.5/E7.2 i request-suggestion.ts slås de kjente verdiene opp før preparePrompt", () => {
    const source = read(requestFile);
    const load = source.search(/\bloadKnownValues\s*\(/);
    const prepare = source.search(/\bpreparePrompt\s*\(/);
    expect(load, "oppslaget av kjente verdier mangler").toBeGreaterThan(-1);
    expect(prepare, "preparePrompt mangler").toBeGreaterThan(-1);
    expect(load).toBeLessThan(prepare);
    // Oppslaget hentes fra ./redaction, ikke fra en kopi
    expect(source).toMatch(/from\s+["']\.\/redaction["']/);
    expect(source).not.toMatch(/\bredactFields\b/);
  });

  it("E7.3 preparePrompt vasker før buildPrompt, og buildPrompt kalles bare der", () => {
    const promptFile = join(aiDir, "prompt.ts");
    expect(existsSync(promptFile), "src/core/ai/prompt.ts").toBe(true);
    const source = read(promptFile);
    const body = source.slice(source.search(/function\s+preparePrompt\b/));
    const redact = body.search(/\b(redactFieldValues|redactText|applyRedaction)\s*\(/);
    const build = body.search(/\bbuildPrompt\s*\(/);
    expect(redact, "vasken mangler i preparePrompt").toBeGreaterThan(-1);
    expect(build, "buildPrompt mangler i preparePrompt").toBeGreaterThan(-1);
    expect(redact).toBeLessThan(build);
    const callSites = productFiles(srcDir).flatMap((file) =>
      [...read(file).matchAll(/(?<!function\s)\bbuildPrompt\s*\(/g)].map(() => rel(file)),
    );
    expect(callSites).toEqual(["src/core/ai/prompt.ts"]);
  });

  it("V8.6 ingen mellomlagring: redaction.ts har ingen Map, Set eller cache på toppnivå", () => {
    const source = read(join(aiDir, "redaction.ts"));
    const topLevel = source
      .split("\n")
      .filter((line) => /^(?:export\s+)?(?:const|let|var)\s/u.test(line));
    for (const line of topLevel) {
      expect(line, line).not.toMatch(/new\s+(?:Map|Set|WeakMap|WeakSet)\b|cache/iu);
    }
    expect(source).not.toMatch(/^(?:export\s+)?let\s/mu);
  });

  it("V8.6 redactedCount står ikke i returtypen til requestSuggestion", () => {
    const types = read(join(aiDir, "types.ts"));
    const start = types.indexOf("export type AiSuggestionResult");
    expect(start).toBeGreaterThan(-1);
    const end = types.indexOf(";", start);
    expect(types.slice(start, end)).not.toMatch(/redact/i);
  });

  it("V8.7 index.ts eksporterer ingen visning, liste eller telling av redacted_count eller blocked", async () => {
    const ai: Record<string, unknown> = await import("./index");
    const forbidden =
      /(list|count|stat|summary|per|show|view)\w*(redact|blocked)|(redact|blocked)\w*(list|count|stat|summary|employee|per)/i;
    expect(Object.keys(ai).filter((name) => forbidden.test(name))).toEqual([]);
    const exported = [...read(join(aiDir, "index.ts")).matchAll(/\b\w+\b/g)].map((m) => m[0]);
    expect(exported.filter((name) => forbidden.test(name))).toEqual([]);
    // Mønsteret er ikke hult
    expect(forbidden.test("countBlockedByEmployee")).toBe(true);
    expect(forbidden.test("listRedactedCounts")).toBe(true);
    expect(forbidden.test("redactedCountPerEmployee")).toBe(true);
  });
});

/*
 * Evalueringssettet, statiske kontroller (docs/funksjoner/fase2a-evalueringssett-testplan.md
 * E6.9 og E7.4–E7.7). Kjøreren kan ikke nås fra appen eller modulene, og den og den rene vasken
 * laster aldri databasen.
 */
describe("evalueringssett, statiske kontroller (E7)", () => {
  const evalsDir = join(aiDir, "evals");

  it("E7.4 index.ts eksporterer ikke noe fra evals", async () => {
    const source = read(join(aiDir, "index.ts"));
    expect(source).not.toMatch(/["']\.\/evals/);
    const ai: Record<string, unknown> = await import("./index");
    for (const name of ["runEvals", "runEvalCommand", "parseCasesFile"]) {
      expect(Object.keys(ai), name).not.toContain(name);
    }
  });

  it("E7.5/E7.7 evals/ er med i kontrollene for src/core/ai (12.5 og 12.8 dekker undermappen)", () => {
    const files = productFiles(aiDir).map(rel);
    expect(files).toContain("src/core/ai/evals/run.ts");
    expect(files).toContain("src/core/ai/evals/schema.ts");
    for (const file of productFiles(evalsDir)) {
      expect(read(file), rel(file)).not.toMatch(/\bconsole\.|process\.env/);
      expect(read(file), rel(file)).not.toMatch(/\breadSecret\b|\bfetch\s*\(/);
    }
  });

  it("E6.9 kjøreren bruker PII_PLACEHOLDERS fra pii-patterns", () => {
    const source = read(join(evalsDir, "run.ts"));
    expect(source).toMatch(
      /import\s*\{[^}]*\bPII_PLACEHOLDERS\b[^}]*\}\s*from\s+["']@\/shared\/lib\/pii-patterns["']/,
    );
    expect(source.match(/\bPII_PLACEHOLDERS\b/g)?.length ?? 0).toBeGreaterThan(1);
  });

  /** Importene i en fil: kilde og om den bare gjelder typer. */
  function importsOf(source: string): { from: string; typeOnly: boolean }[] {
    const out: { from: string; typeOnly: boolean }[] = [];
    const statement = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^;]*?)\s*from\s+["']([^"']+)["']/g;
    for (const match of source.matchAll(statement)) {
      const clause = (match[3] ?? "").trim();
      const named = /^\{([\s\S]*)\}$/.exec(clause);
      const allNamedTypes =
        named !== null &&
        named[1]!
          .split(",")
          .map((part) => part.trim())
          .filter((part) => part !== "")
          .every((part) => part.startsWith("type "));
      out.push({ from: match[4]!, typeOnly: Boolean(match[2]) || allNamedTypes });
    }
    for (const match of source.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g)) {
      out.push({ from: match[1]!, typeOnly: false });
    }
    for (const match of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
      out.push({ from: match[1]!, typeOnly: false });
    }
    return out;
  }

  function resolveFile(fromFile: string, specifier: string): string | null {
    let base: string;
    if (specifier.startsWith("@/")) base = join(srcDir, specifier.slice(2));
    else if (specifier.startsWith(".")) base = join(fromFile, "..", specifier);
    else return null;
    for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), base]) {
      if (existsSync(candidate) && /\.tsx?$/.test(candidate)) return candidate;
    }
    return null;
  }

  it("E7.6 ingen database: evals, redact-text.ts, prompt.ts og alt de importerer har bare typer fra @/db og @/core/access, og ingen drizzle-orm", () => {
    const roots = [
      ...productFiles(evalsDir),
      join(aiDir, "redact-text.ts"),
      join(aiDir, "prompt.ts"),
    ];
    for (const root of roots) expect(existsSync(root), rel(root)).toBe(true);
    expect(productFiles(evalsDir).length).toBeGreaterThan(0);
    const seen = new Set<string>();
    const queue = [...roots];
    const offenders: string[] = [];
    while (queue.length > 0) {
      const file = queue.shift()!;
      if (seen.has(file) || !existsSync(file)) continue;
      seen.add(file);
      for (const { from, typeOnly } of importsOf(read(file))) {
        if (/^(drizzle-orm|postgres)(\/|$)/.test(from)) offenders.push(`${rel(file)}: ${from}`);
        if (/^@\/(db|core\/access)(\/|$)/.test(from)) {
          if (!typeOnly) offenders.push(`${rel(file)}: ${from}`);
          continue;
        }
        if (typeOnly) continue;
        const target = resolveFile(file, from);
        if (target !== null && !isTest(target)) queue.push(target);
      }
    }
    expect(offenders).toEqual([]);
    // Ikke hult: mengden har vasken, mønstrene og funksjonsdefinisjonene
    const reached = [...seen].map(rel);
    expect(reached).toContain("src/core/ai/redact-text.ts");
    expect(reached).toContain("src/shared/lib/pii-patterns.ts");
    expect(reached).toContain("src/core/ai/features.ts");
  });

  it("E7.6 kontrollen er ikke hul: en vanlig import fra @/db og drizzle-orm blir fanget", () => {
    const sample = [
      'import { db } from "@/db/client";',
      'import type { AiErrorCode } from "@/db/schema";',
      'import { type EmployeeGrant } from "@/core/access";',
      'import { and } from "drizzle-orm";',
      'export { loadKnownValues } from "./redaction";',
    ].join("\n");
    expect(importsOf(sample)).toEqual([
      { from: "@/db/client", typeOnly: false },
      { from: "@/db/schema", typeOnly: true },
      { from: "@/core/access", typeOnly: true },
      { from: "drizzle-orm", typeOnly: false },
      { from: "./redaction", typeOnly: false },
    ]);
  });
});
