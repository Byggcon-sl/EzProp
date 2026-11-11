import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { evalCases, evalFile, makeCasesDir, removeDir } from "../../../../tests/evals";
import {
  fakeAnthropic,
  okReply,
  TEST_ANTHROPIC_KEY,
  TEST_MODEL,
} from "../../../../tests/fake-anthropic-http";
import { fakeAiProvider } from "../providers/fake";
import { createAnthropicProvider } from "../providers/anthropic";
import { runEvals } from "./run";

/*
 * S4: evalueringssettet kjører bare mot den falske leverandøren (docs/funksjoner/fase2a-ki-
 * leverandor-testplan.md 4.4, kortet Omfang 7), og 3.4.3: lekkasjesjekken er felles med den ekte
 * veien (kortet Omfang 6, A195). Ingen database, ingen nettkall.
 *
 * Støtter hovedmål: KI i bunnen (settet koster ingenting og sender aldri data ut før Ståle har
 * lagt inn nøkkelen) og færre reklamasjoner (samme lekkasjesjekk i settet og i ekte bruk).
 */

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) removeDir(dir);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function casesDir() {
  const dir = makeCasesDir({
    "language_polish.cases.json": evalFile(evalCases()),
  });
  dirs.push(dir);
  return dir;
}

const evalsDir = __dirname;
const read = (file: string) => readFileSync(join(evalsDir, file), "utf8");

describe("runEvals bare mot fake (S4)", () => {
  it("S4 en anthropic-adapter (falsk HTTP) gir unntak før noe kall", async () => {
    const http = fakeAnthropic(okReply());
    // Kopi av adapteren (den er frosset), så `complete` kan overvåkes
    const provider = {
      ...createAnthropicProvider({
        model: TEST_MODEL,
        apiKey: TEST_ANTHROPIC_KEY,
        pricing: { inputPerMillion: 30, outputPerMillion: 150, currency: "NOK" },
        fetch: http.fetchFn,
      }),
    };
    vi.stubGlobal("fetch", http.fetchFn);
    const complete = vi.spyOn(provider, "complete");

    await expect(runEvals({ provider, casesDir: casesDir() })).rejects.toThrow();
    expect(complete).not.toHaveBeenCalled();
    expect(http.calls).toHaveLength(0);
  });

  it.each(["anthropic", "FAKE", "unknown_vendor"])(
    "S4 en adapter med code %s gir unntak før noe kall, også med fake sin complete",
    async (code) => {
      const complete = vi.fn(fakeAiProvider.complete);
      const provider = { code, model: "fake-v1", complete };
      await expect(runEvals({ provider, casesDir: casesDir() })).rejects.toThrow();
      expect(complete).not.toHaveBeenCalled();
    },
  );

  it("S4 kontroll: fake kjører som før", async () => {
    const result = await runEvals({ provider: fakeAiProvider, casesDir: casesDir() });
    expect(result.errors).toEqual([]);
    expect(result.features).toHaveLength(1);
  });

  it("S4 evals/ importerer ikke database, valget av leverandør eller Anthropic-adapteren", () => {
    for (const file of ["run.ts", "schema.ts"]) {
      const source = read(file);
      expect(source, file).not.toMatch(/from\s+["']@\/db(\/[^"']*)?["']/);
      expect(source, file).not.toMatch(/from\s+["'][^"']*provider-resolution["']/);
      expect(source, file).not.toMatch(/from\s+["'][^"']*providers\/anthropic["']/);
    }
  });
});

describe("lekkasjesjekken er felles (3.4.3)", () => {
  it("3.4.3 evals/run.ts importerer lekkasjesjekken fra src/core/ai, ikke fra egen kopi", () => {
    const source = read("run.ts");
    // Ingen egen definisjon av lekkasjesjekken i kjøreren
    expect(source).not.toMatch(/function\s+find\w*Leak\w*\s*\(/);
    // Et import av en funksjon med «Leak» i navnet fra en fil i src/core/ai utenfor evals/
    const imports = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)];
    const leakImport = imports.find(
      ([, names, from]) =>
        /\b\w*Leak\w*\b/.test(names ?? "") &&
        (/^\.\.\/[^/]+$/.test(from ?? "") || /^@\/core\/ai\/[^/]+$/.test(from ?? "")),
    );
    expect(leakImport, "fant ikke import av lekkasjesjekken fra src/core/ai").toBeDefined();
  });
});
