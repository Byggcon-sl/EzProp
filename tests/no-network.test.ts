import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { integrationConnections } from "@/db/schema";
import { runSeed } from "@/db/seed/run";
import { runSampleSeed } from "@/db/seed/sample-assignments";
import { resetDatabase, TEST_NOW } from "./factories";
import { ANTHROPIC_HOST, TEST_ANTHROPIC_KEY } from "./fake-anthropic";
import { BLOCKED_AI_FETCH_MESSAGE, isBlockedAiHost } from "./setup-env";

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
  vi.unstubAllGlobals();
});

describe("global sperre mot Anthropic i testene (S2)", () => {
  it.each([
    "https://api.anthropic.com/v1/messages",
    "https://API.ANTHROPIC.COM/v1/messages",
    "https://anthropic.com/",
    "https://console.anthropic.com/",
  ])("S2 fetch mot %s uten stub kaster en tydelig feil", async (url) => {
    await expect(fetch(url, { method: "POST", body: "{}" })).rejects.toThrow(
      BLOCKED_AI_FETCH_MESSAGE,
    );
  });

  it("S2 fetch med Request-objekt og URL-objekt sperres også", async () => {
    const url = `https://${ANTHROPIC_HOST}/v1/messages`;
    await expect(fetch(new Request(url))).rejects.toThrow(BLOCKED_AI_FETCH_MESSAGE);
    await expect(fetch(new URL(url))).rejects.toThrow(BLOCKED_AI_FETCH_MESSAGE);
  });

  it("S2 vertsnavnet sjekkes nøyaktig, ikke som delstreng", () => {
    expect(isBlockedAiHost(ANTHROPIC_HOST)).toBe(true);
    expect(isBlockedAiHost(`${ANTHROPIC_HOST}.`)).toBe(true);
    expect(isBlockedAiHost("anthropic.com")).toBe(true);
    expect(isBlockedAiHost("notanthropic.com")).toBe(false);
    expect(isBlockedAiHost("anthropic.com.example.no")).toBe(false);
    expect(isBlockedAiHost("localhost")).toBe(false);
  });

  it("S2 andre adresser går til den opprinnelige fetch (vanlig feil, ikke sperren)", async () => {
    const error = await fetch("http://127.0.0.1:1/").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(BLOCKED_AI_FETCH_MESSAGE);
  });

  it("S2 vi.stubGlobal overstyrer fortsatt sperren", async () => {
    const fake = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fake);
    const response = await fetch(`https://${ANTHROPIC_HOST}/v1/messages`);
    expect(response.status).toBe(200);
    expect(fake).toHaveBeenCalledTimes(1);
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

  it("S2 seed og testoppdragene gir null rader med provider = anthropic, også med nøkkel satt", async () => {
    vi.stubEnv(KEY_NAME, TEST_ANTHROPIC_KEY);
    const env = { SEED_ADMIN_EMAIL: "admin@example.com", SEED_ADMIN_NAME: "Test Admin" };
    await runSeed(env);
    await runSampleSeed(env, TEST_NOW);
    const rows = await db
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.provider, "anthropic"));
    expect(rows).toEqual([]);
    // Ikke hult: prøveorganisasjonen har den falske leverandøren
    const fake = await db
      .select({ id: integrationConnections.id })
      .from(integrationConnections)
      .where(eq(integrationConnections.provider, "fake"));
    expect(fake.length).toBeGreaterThan(0);
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

  it("S2 .env.example har bare en tom linje for nøkkelen", () => {
    const lines = read(".env.example")
      .split("\n")
      .filter((line) => line.trim().startsWith(KEY_NAME));
    expect(lines).toEqual([`${KEY_NAME}=`]);
  });

  it("S2 e2e-serveren får aldri nøkkelen (playwright.config.ts)", () => {
    const config = read("playwright.config.ts");
    expect(config).not.toContain(KEY_NAME);
    expect(config).not.toMatch(/anthropic/i);
  });

  it("S2 e2e-filene setter ikke nøkkelen og lager ingen anthropic-tilkobling", () => {
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
