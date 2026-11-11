import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeAnthropicFetch, TEST_ANTHROPIC_KEY, TEST_MODEL } from "../../../tests/fake-anthropic";
import { runEvals } from "./evals/run";
import { createAnthropicProvider } from "./providers/anthropic";

/*
 * Statiske kontroller for Anthropic-adapteren (docs/funksjoner/fase2a-ki-leverandor-testplan.md
 * avsnitt 4: S3, S4, S5 og 3.4.3). 12.8 og E7.5 i static-checks.test.ts er snevret inn til
 * tillatt-liste; her står reglene som tekstprøver med egen kontroll, så de ikke blir hule.
 *
 * Støtter hovedmål: KI i bunnen (bare én fil kan nå leverandøren, bare én fil leser nøkkelen, og
 * evalueringssettet kan aldri koste penger ved et uhell).
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

const FETCH_CALL = /\bfetch\s*\(/;
const READ_SECRET = /\breadSecret\b/;
const FETCH_ALLOWED = ["src/core/ai/providers/anthropic.ts"];
const READ_SECRET_ALLOWED = ["src/core/ai/provider-resolution.ts"];

/** Filene (relative stier) der mønsteret står, utenom tillatt-listen. */
function offenders(files: { path: string; text: string }[], pattern: RegExp, allowed: string[]) {
  return files.filter((f) => pattern.test(f.text) && !allowed.includes(f.path)).map((f) => f.path);
}

function aiFiles() {
  return productFiles(aiDir).map((file) => ({ path: rel(file), text: read(file) }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("S5 tillatt-listen og importretningen", () => {
  it("fetch( står bare i providers/anthropic.ts, og den filen bruker det", () => {
    const files = aiFiles();
    expect(offenders(files, FETCH_CALL, FETCH_ALLOWED)).toEqual([]);
    expect(files.find((f) => f.path === FETCH_ALLOWED[0])?.text).toMatch(FETCH_CALL);
  });

  it("readSecret står bare i provider-resolution.ts, og den filen bruker det", () => {
    const files = aiFiles();
    expect(offenders(files, READ_SECRET, READ_SECRET_ALLOWED)).toEqual([]);
    expect(files.find((f) => f.path === READ_SECRET_ALLOWED[0])?.text).toMatch(READ_SECRET);
  });

  it("client/ og evals/ har verken fetch( eller readSecret", () => {
    for (const dir of [join(aiDir, "client"), join(aiDir, "evals")]) {
      for (const file of productFiles(dir)) {
        expect(read(file), rel(file)).not.toMatch(FETCH_CALL);
        expect(read(file), rel(file)).not.toMatch(READ_SECRET);
      }
    }
  });

  it("ingen process.env i src/core/ai (nøkkelen leses bare gjennom readSecret)", () => {
    expect(
      aiFiles()
        .filter((f) => /process\.env/.test(f.text))
        .map((f) => f.path),
    ).toEqual([]);
  });

  it("connections.ts importerer ikke fra @/core/ai (avhengigheten går bare core/ai → core/integrations)", () => {
    const text = read(join(srcDir, "core", "integrations", "connections.ts"));
    expect(text).not.toMatch(/from\s+["']@\/core\/ai(\/[^"']*)?["']/);
    expect(text).not.toMatch(/from\s+["']\.\.\/ai(\/[^"']*)?["']/);
    expect(text).not.toMatch(/import\s*\(\s*["']@\/core\/ai/);
  });

  it("kontroll: testen blir rød hvis fetch( legges i en annen fil (tekstprøve)", () => {
    const sample = [
      { path: "src/core/ai/providers/anthropic.ts", text: "await fetch(url, init)" },
      { path: "src/core/ai/request-suggestion.ts", text: "const r = await fetch (x);" },
      { path: "src/core/ai/prompt.ts", text: "// prefetch er et annet ord: prefetch(x)" },
    ];
    expect(offenders(sample, FETCH_CALL, FETCH_ALLOWED)).toEqual([
      "src/core/ai/request-suggestion.ts",
    ]);
    const secretSample = [
      { path: "src/core/ai/provider-resolution.ts", text: "readSecret(name)" },
      {
        path: "src/core/ai/usage-log.ts",
        text: "import { readSecret } from '@/core/integrations';",
      },
    ];
    expect(offenders(secretSample, READ_SECRET, READ_SECRET_ALLOWED)).toEqual([
      "src/core/ai/usage-log.ts",
    ]);
  });
});

describe("S3 ingen ny avhengighet og ingen SDK", () => {
  it("package.json har ingen pakke for KI-leverandører", () => {
    const pkg = JSON.parse(read(join(repoRoot, "package.json"))) as Record<string, unknown>;
    const names = Object.keys({
      ...(pkg.dependencies as object),
      ...(pkg.devDependencies as object),
      ...(pkg.optionalDependencies as object | undefined),
    });
    const forbidden =
      /^(openai|@anthropic-ai\/|@azure\/openai|@azure\/ai-|@google\/genai|@google\/generative-ai|@mistralai\/|cohere-ai|ai|@ai-sdk\/)/;
    expect(names.filter((name) => forbidden.test(name))).toEqual([]);
  });
});

describe("S4 runEvals bare mot fake", () => {
  it("runEvals med en anthropic-adapter kaster før noe kall", async () => {
    const fake = fakeAnthropicFetch({ kind: "ok" });
    const provider = createAnthropicProvider({
      model: TEST_MODEL,
      apiKey: TEST_ANTHROPIC_KEY,
      pricing: { inputPerMillion: 30, outputPerMillion: 150, currency: "NOK" },
      fetch: fake.fetchFn,
    });
    const complete = vi.spyOn(provider, "complete");
    let thrown: unknown;
    try {
      await runEvals({
        provider,
        casesDir: join(aiDir, "evals"),
        feature: "language_polish",
      } as unknown as Parameters<typeof runEvals>[0]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(complete).not.toHaveBeenCalled();
    expect(fake.calls).toHaveLength(0);
  });

  it("runEvals med en annen kode enn fake (laget for hånd) kaster før noe kall", async () => {
    const complete = vi.fn(async () => ({
      outcome: "error" as const,
      errorCode: "unknown" as const,
    }));
    const provider = { code: "unknown_vendor", model: TEST_MODEL, complete };
    let thrown: unknown;
    try {
      await runEvals({
        provider,
        casesDir: join(aiDir, "evals"),
        feature: "language_polish",
      } as unknown as Parameters<typeof runEvals>[0]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(complete).not.toHaveBeenCalled();
  });

  it("evals/ importerer ikke databasen, valget av leverandør eller adapteren", () => {
    for (const file of productFiles(join(aiDir, "evals"))) {
      const text = read(file);
      expect(text, rel(file)).not.toMatch(/["']@\/db(\/[^"']*)?["']/);
      expect(text, rel(file)).not.toMatch(/provider-resolution/);
      expect(text, rel(file)).not.toMatch(/providers\/anthropic/);
    }
  });
});

describe("3.4.3 lekkasjesjekken er felles", () => {
  const runPath = join(aiDir, "evals", "run.ts");

  it("evals/run.ts definerer ikke sin egen lekkasjesjekk, men importerer den fra src/core/ai", () => {
    const text = read(runPath);
    expect(text).not.toMatch(/function\s+find\w*Leak\w*\s*\(/);
    expect(text).toMatch(
      /import\s*\{[^}]*\b\w*Leak\w*\b[^}]*\}\s*from\s+["'](\.\.\/(?!evals)[^"']+|@\/core\/ai\/(?!evals)[^"']+)["']/,
    );
  });

  it("requestSuggestion bruker den samme lekkasjesjekken", () => {
    const run = read(runPath);
    const match =
      /import\s*\{([^}]*\b\w*Leak\w*\b[^}]*)\}\s*from\s+["'](?:\.\.\/|@\/core\/ai\/)([^"']+)["']/.exec(
        run,
      );
    expect(match, "importen i run.ts").not.toBeNull();
    const name = /\b(\w*Leak\w*)\b/.exec(match![1]!)![1]!;
    // Den ekte veien: requestSuggestion selv, eller den felles ledeteksten den kaller
    const users = ["request-suggestion.ts", "prompt.ts"].filter((file) =>
      new RegExp(`\\b${name}\\s*\\(`).test(read(join(aiDir, file))),
    );
    expect(users.length, `${name} brukes i den ekte veien`).toBeGreaterThan(0);
  });
});
