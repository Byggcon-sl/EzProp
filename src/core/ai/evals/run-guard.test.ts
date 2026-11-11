import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fakeAiProvider } from "../providers/fake";
import { EvalProviderNotAllowedError, runEvals } from "./run";

/*
 * Vakten i `runEvals` (docs/funksjoner/fase2a-ki-leverandor-testplan.md 4.4, S4, og 3.4.3).
 * Evalueringssettet kjøres bare mot den falske leverandøren; en ekte koster penger og venter på
 * Ståle. Lekkasjesjekken er felles med `requestSuggestion` (A195).
 *
 * Støtter hovedmål: KI i bunnen, trygt: ingen kjøring mot ekte leverandør ved et uhell.
 */

const evalsDir = __dirname;

describe("runEvals bare mot fake (S4)", () => {
  it.each(["anthropic", "unknown_vendor", "FAKE", ""])(
    "leverandøren %j avvises før noe kall",
    async (code) => {
      const complete = vi.fn();
      const provider = { code, model: "MERKE-MODELL-K7Q", complete };

      await expect(runEvals({ provider, casesDir: evalsDir })).rejects.toBeInstanceOf(
        EvalProviderNotAllowedError,
      );
      expect(complete).not.toHaveBeenCalled();
    },
  );

  it("fake kjøres som før", async () => {
    const result = await runEvals({ provider: fakeAiProvider, casesDir: evalsDir });
    expect(result.features.length).toBeGreaterThan(0);
  });

  it("evals/ importerer ikke databasen, valget av leverandør eller adapteren", () => {
    const files = readdirSync(evalsDir).filter(
      (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
    );
    for (const name of files) {
      const text = readFileSync(join(evalsDir, name), "utf8");
      expect(text, name).not.toMatch(/from\s+["']@\/db/);
      expect(text, name).not.toMatch(/provider-resolution/);
      expect(text, name).not.toMatch(/providers\/anthropic/);
    }
  });

  it("lekkasjesjekken er felles: run.ts bruker leak-check.ts", () => {
    const text = readFileSync(join(evalsDir, "run.ts"), "utf8");
    expect(text).toMatch(/from\s+["']\.\.\/leak-check["']/);
    expect(text).not.toMatch(/function\s+findLeakedKnownValues/);
  });
});
