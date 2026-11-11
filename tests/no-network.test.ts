import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSeed } from "@/db/seed/run";
import { db } from "@/db/client";
import { integrationConnections } from "@/db/schema";
import { resetDatabase } from "./factories";
import { BLOCKED_HOST_MESSAGE } from "./setup-env";

/*
 * S2 og S3: ingen nettkall til Anthropic fra tester, CI eller e2e, ingen `anthropic`-tilkobling i
 * seed, og ingen KI-SDK (docs/funksjoner/fase2a-ki-leverandor-testplan.md 4.2, 4.3 og avsnitt 6,
 * kortet Omfang 11). Ingen kostnad og ingen data ut.
 *
 * Støtter hovedmål: KI i bunnen (alt prøves mot falsk leverandør og falsk HTTP; ekte KI slås bare
 * på av Ståle).
 */

const repoRoot = join(__dirname, "..");
const read = (path: string) => readFileSync(join(repoRoot, path), "utf8");
const KEY_NAME = "ANTHROPIC_API_KEY";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("global sperre mot Anthropic i testene (S2)", () => {
  it.each([
    "https://api.anthropic.com/v1/messages",
    "https://API.ANTHROPIC.COM/v1/messages",
    "https://anthropic.com/",
    "https://console.anthropic.com/",
  ])("S2 fetch mot %s uten stub kaster en tydelig feil", async (url) => {
    await expect(fetch(url, { method: "POST", body: "{}" })).rejects.toThrow(BLOCKED_HOST_MESSAGE);
  });

  it("S2 fetch med Request-objekt og URL-objekt sperres også", async () => {
    await expect(fetch(new Request("https://api.anthropic.com/v1/messages"))).rejects.toThrow(
      BLOCKED_HOST_MESSAGE,
    );
    await expect(fetch(new URL("https://api.anthropic.com/v1/messages"))).rejects.toThrow(
      BLOCKED_HOST_MESSAGE,
    );
  });

  it("S2 nøkkelen er ikke satt i testmiljøet", () => {
    expect(process.env[KEY_NAME]).toBeUndefined();
  });

  it("S2 oppsettfilen er med i Vitest", () => {
    expect(read("vitest.config.ts")).toMatch(
      /setupFiles:\s*\[[^\]]*["']\.\/tests\/setup-env\.ts["']/,
    );
  });
});

describe("seed har ingen anthropic-tilkobling (S2)", () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("S2 seed mot testdatabasen gir null rader med provider = anthropic", async () => {
    vi.stubEnv(KEY_NAME, "sk-ant-api03-OPPDIKTET-TESTNOKKEL-K7Q");
    await runSeed({ SEED_ADMIN_EMAIL: "admin@example.com", SEED_ADMIN_NAME: "Test Admin" });
    const rows = await db
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.provider, "anthropic"));
    expect(rows).toEqual([]);
  });

  it("S2 seed-filene nevner ikke anthropic", () => {
    const dir = join(repoRoot, "src", "db", "seed");
    for (const name of readdirSync(dir).filter(
      (file) => /\.ts$/.test(file) && !/\.test\.ts$/.test(file),
    )) {
      expect(readFileSync(join(dir, name), "utf8"), name).not.toMatch(/anthropic/i);
    }
  });
});

describe("CI, e2e og .env.example (S2, avsnitt 6)", () => {
  it("S2 ci.yml har ingen ANTHROPIC_API_KEY med verdi og ingen secret for den", () => {
    const ci = read(".github/workflows/ci.yml");
    for (const line of ci.split("\n")) {
      if (!line.includes(KEY_NAME)) continue;
      expect(line, line).toMatch(new RegExp(`${KEY_NAME}\\s*:\\s*(""|'')?\\s*$`));
    }
    expect(ci).not.toMatch(/secrets\.ANTHROPIC/);
  });

  it("S2 deploy-azure.yml gir aldri nøkkelen en fast verdi", () => {
    const workflow = read(".github/workflows/deploy-azure.yml");
    for (const line of workflow.split("\n")) {
      const match = new RegExp(`^\\s*${KEY_NAME}\\s*:\\s*(.*)$`).exec(line);
      if (match) expect(match[1], line).toMatch(/^\$\{\{\s*secrets\.ANTHROPIC_API_KEY\s*\}\}$/);
    }
  });

  it(".env.example har bare en tom linje for nøkkelen", () => {
    const lines = read(".env.example")
      .split("\n")
      .filter((line) => line.trim().startsWith(KEY_NAME));
    expect(lines).toEqual([`${KEY_NAME}=`]);
  });

  it("e2e-serveren får aldri nøkkelen (playwright.config.ts)", () => {
    const config = read("playwright.config.ts");
    expect(config).not.toContain(KEY_NAME);
    expect(config).not.toMatch(/anthropic/i);
  });

  it("e2e-filene setter ikke nøkkelen og lager ingen anthropic-tilkobling", () => {
    const dir = join(repoRoot, "e2e");
    const files = readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
      .map((entry) => join(entry.parentPath, entry.name));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toContain(KEY_NAME);
      expect(text, file).not.toMatch(/provider:\s*["']anthropic["']/);
    }
  });
});

describe("ingen KI-SDK og ingen ny avhengighet for KI (S3)", () => {
  it("S3 package.json har ingen SDK for KI-leverandører", () => {
    const pkg = JSON.parse(read("package.json")) as Record<
      string,
      Record<string, string> | undefined
    >;
    const names = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
      ...Object.keys(pkg.optionalDependencies ?? {}),
    ];
    const forbidden =
      /^(@anthropic-ai\/.*|anthropic|openai|@azure\/openai|@ai-sdk\/.*|ai|@aws-sdk\/client-bedrock.*|@google-cloud\/vertexai|@google\/.*|@mistralai\/.*|cohere-ai|undici|node-fetch|axios|got)$/;
    expect(names.filter((name) => forbidden.test(name))).toEqual([]);
  });
});
