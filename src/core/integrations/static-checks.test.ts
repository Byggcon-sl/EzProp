import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Testplan docs/funksjoner/fase0b-tilkoblingslag-testplan.md avsnitt 5 (mønster fra
 * src/core/files/static-checks.test.ts). Støtter hovedmål: reklamasjoner og KI først
 * (hemmeligheter leses ett sted, de interne funksjonene uten tilgangssjekk holdes inne i laget,
 * og ingenting slettes).
 */

const repoRoot = join(__dirname, "..", "..", "..");
const srcDir = join(repoRoot, "src");
const integrationsDir = join(srcDir, "core", "integrations");
const emailDir = join(srcDir, "core", "email");

/** Interne funksjoner uten tilgangssjekk. Bare laget selv kaller dem. */
const INTERNAL = ["findActiveConnection", "recordConnectionResult", "resolveEmailSender"];

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

describe("tilkoblingslaget, statiske kontroller", () => {
  it("1. src/core/integrations har kildefiler (ellers sier testene under ingenting)", () => {
    expect(productFiles(integrationsDir).length).toBeGreaterThan(0);
  });

  it("2. ingen sletting: ingen .delete( på integrationConnections i src/", () => {
    for (const file of productFiles(srcDir)) {
      expect(read(file), rel(file)).not.toMatch(/\.delete\s*\(\s*integrationConnections\b/);
    }
  });

  it("3. MS_GRAPH_CLIENT_SECRET leses som verdi bare i env.ts og secrets.ts", () => {
    const allowed = new Set(["src/shared/config/env.ts", "src/core/integrations/secrets.ts"]);
    const pattern = /(env|getEnv\(\)|process\.env)\s*[.[]\s*["']?MS_GRAPH_CLIENT_SECRET/;
    const offenders = productFiles(srcDir)
      .filter((file) => !allowed.has(rel(file)))
      .filter((file) => pattern.test(read(file)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("4. process.env leses ikke i src/core/email eller src/core/integrations utenom secrets.ts", () => {
    const offenders = [...productFiles(emailDir), ...productFiles(integrationsDir)]
      .filter((file) => rel(file) !== "src/core/integrations/secrets.ts")
      .filter((file) => /process\.env/.test(read(file)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("5. findActiveConnection, recordConnectionResult og resolveEmailSender holdes inne i laget", async () => {
    // index.ts kan bruke dem selv (sendEmail kaller dem), men aldri eksportere dem
    const exported =
      /export\s*(?:type\s*)?\{[^}]*\b(findActiveConnection|recordConnectionResult|resolveEmailSender)\b[^}]*\}|export\s+(?:async\s+)?(?:function|const|let)\s+(findActiveConnection|recordConnectionResult|resolveEmailSender)\b|export\s*\*\s*from\s*["']\.\/(connections|resolve)["']/;
    for (const index of [join(integrationsDir, "index.ts"), join(emailDir, "index.ts")]) {
      expect(existsSync(index), rel(index)).toBe(true);
      expect(read(index), rel(index)).not.toMatch(exported);
    }
    const integrations: Record<string, unknown> = await import("./index");
    const email: Record<string, unknown> = await import("../email/index");
    for (const name of INTERNAL) {
      expect(Object.keys(integrations)).not.toContain(name);
      expect(Object.keys(email)).not.toContain(name);
    }

    const callers = [...sourceFiles(join(srcDir, "app")), ...sourceFiles(join(srcDir, "modules"))];
    expect(callers.length).toBeGreaterThan(0);
    const offenders = callers
      .filter((file) => {
        const text = read(file);
        return (
          /["'][^"']*core\/integrations\/connections["']/.test(text) ||
          /["'][^"']*core\/email\/resolve["']/.test(text) ||
          INTERNAL.some((name) => text.includes(name))
        );
      })
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("6. Graph-adressene står bare i src/core/email/graph.ts", () => {
    const graph = join(emailDir, "graph.ts");
    expect(existsSync(graph)).toBe(true);
    expect(read(graph)).toContain("login.microsoftonline.com");
    expect(read(graph)).toContain("graph.microsoft.com/v1.0");

    const users = productFiles(srcDir)
      .filter((file) => {
        const text = read(file);
        return (
          text.includes("login.microsoftonline.com") || text.includes("graph.microsoft.com/v1.0")
        );
      })
      .map(rel);
    expect(users).toEqual(["src/core/email/graph.ts"]);
  });
});
