import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { integrationConnections } from "@/db/schema";
import { runSeed } from "@/db/seed/run";
import { runSampleSeed } from "@/db/seed/sample-assignments";
import { resetDatabase, TEST_NOW } from "./factories";
import { BLOCKED_AI_FETCH_MESSAGE, isBlockedAiHost } from "./setup-env";

/*
 * Ingen nettkall til KI-leverandøren fra testene, seed, CI eller e2e
 * (docs/funksjoner/fase2a-ki-leverandor-testplan.md S2 og del 6, kortet Omfang 11).
 *
 * Støtter hovedmål: KI i bunnen uten kostnad og uten risiko. Ingen test kan bruke penger eller
 * sende tekst til leverandøren, og seed lager aldri en ekte tilkobling.
 */

const repoRoot = join(__dirname, "..");
const read = (path: string) => readFileSync(join(repoRoot, path), "utf8");
const KEY = "ANTHROPIC_API_KEY";

describe("S2 global sperre for nettkall i testene", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("nøkkelen er fjernet fra miljøet", () => {
    expect(process.env[KEY]).toBeUndefined();
  });

  it.each([
    "https://api.anthropic.com/v1/messages",
    "https://API.Anthropic.com/v1/messages",
    "https://console.anthropic.com/",
    "https://anthropic.com/",
  ])("fetch mot %s uten stub gir en tydelig feil", async (url) => {
    await expect(fetch(url, { method: "POST" })).rejects.toThrow(BLOCKED_AI_FETCH_MESSAGE);
    await expect(fetch(new URL(url))).rejects.toThrow(BLOCKED_AI_FETCH_MESSAGE);
    await expect(fetch(new Request(url))).rejects.toThrow(BLOCKED_AI_FETCH_MESSAGE);
  });

  it("vertsnavnet sjekkes nøyaktig, ikke som delstreng", () => {
    expect(isBlockedAiHost("api.anthropic.com")).toBe(true);
    expect(isBlockedAiHost("api.anthropic.com.")).toBe(true);
    expect(isBlockedAiHost("anthropic.com")).toBe(true);
    expect(isBlockedAiHost("notanthropic.com")).toBe(false);
    expect(isBlockedAiHost("anthropic.com.example.no")).toBe(false);
    expect(isBlockedAiHost("localhost")).toBe(false);
  });

  it("andre adresser går til den opprinnelige fetch (ugyldig adresse gir vanlig feil, ikke sperren)", async () => {
    const error = await fetch("http://127.0.0.1:1/").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(BLOCKED_AI_FETCH_MESSAGE);
  });

  it("vi.stubGlobal overstyrer fortsatt sperren", async () => {
    const fake = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fake);
    const response = await fetch("https://api.anthropic.com/v1/messages");
    expect(response.status).toBe(200);
    expect(fake).toHaveBeenCalledTimes(1);
  });
});

describe("S2 seed lager ingen anthropic-tilkobling", () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("pnpm db:seed og pnpm db:seed:testoppdrag gir 0 rader med provider = anthropic", async () => {
    const env = { SEED_ADMIN_EMAIL: "admin@example.com", SEED_ADMIN_NAME: "Test Admin" };
    await runSeed(env);
    await runSampleSeed(env, TEST_NOW);
    const anthropic = await db
      .select({ id: integrationConnections.id })
      .from(integrationConnections)
      .where(eq(integrationConnections.provider, "anthropic"));
    expect(anthropic).toEqual([]);
    // Ikke hult: prøveorganisasjonen har den falske leverandøren
    const fake = await db
      .select({ id: integrationConnections.id })
      .from(integrationConnections)
      .where(eq(integrationConnections.provider, "fake"));
    expect(fake.length).toBeGreaterThan(0);
  });
});

describe("S2 CI, e2e og .env.example har ingen nøkkel", () => {
  const workflows = readdirSync(join(repoRoot, ".github", "workflows")).filter((name) =>
    /\.ya?ml$/.test(name),
  );

  it("ci.yml og de andre arbeidsflytene nevner ikke nøkkelen (bare utrullingen)", () => {
    expect(workflows).toContain("ci.yml");
    const mentioning = workflows.filter((name) => read(`.github/workflows/${name}`).includes(KEY));
    expect(mentioning).toEqual(["deploy-azure.yml"]);
  });

  it("utrullingen henter nøkkelen bare fra GitHub-secrets, aldri som fast verdi", () => {
    const lines = read(".github/workflows/deploy-azure.yml")
      .split("\n")
      .filter((line) => line.includes(KEY));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.trim(), line).toMatch(
        /^(ANTHROPIC_API_KEY:\s*\$\{\{\s*secrets\.ANTHROPIC_API_KEY\s*\}\}|"anthropicApiKey=\$ANTHROPIC_API_KEY"|#.*)$/,
      );
    }
  });

  it(".env.example har bare den tomme linjen ANTHROPIC_API_KEY=", () => {
    const lines = read(".env.example")
      .split("\n")
      .filter((line) => !line.trim().startsWith("#") && line.includes(KEY));
    expect(lines).toEqual([`${KEY}=`]);
  });

  it("playwright.config.ts setter aldri nøkkelen for e2e-serveren", () => {
    expect(read("playwright.config.ts")).not.toContain(KEY);
  });
});
