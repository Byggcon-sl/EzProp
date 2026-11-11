import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { integrationConnections } from "@/db/schema";
import { runSeed } from "@/db/seed/run";
import { BLOCKED_AI_NETWORK_MESSAGE, isAnthropicHost } from "./ai-network-guard";
import { resetDatabase } from "./factories";

/*
 * S2: ingen test, e2e eller CI-jobb gjør nettkall til KI-leverandøren
 * (docs/funksjoner/fase2a-ki-leverandor-testplan.md 4.2 og avsnitt 6). Den globale sperren ligger
 * i `tests/setup-env.ts` (via `tests/ai-network-guard.ts`). Seed lager aldri en `anthropic`-
 * tilkobling, og nøkkelen står aldri med verdi i CI, `.env.example` eller Playwright-oppsettet.
 *
 * Støtter hovedmål: KI i bunnen (ingenting sendes ut og ingenting koster penger før Ståle har slått
 * det på).
 */

const repoRoot = join(__dirname, "..");
const read = (path: string) => readFileSync(join(repoRoot, path), "utf8");
const SECRET_NAME = "ANTHROPIC_API_KEY";

beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());

describe("S2 global sperre for nettkall", () => {
  it.each([
    "https://api.anthropic.com/v1/messages",
    "https://API.ANTHROPIC.COM/v1/messages",
    "https://anthropic.com/",
    "https://api.anthropic.com./v1/messages",
  ])("fetch mot %s uten stub avvises med en tydelig feil", async (url) => {
    let error: unknown;
    try {
      await fetch(url, { method: "POST", body: "{}" });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(BLOCKED_AI_NETWORK_MESSAGE);
  });

  it("også med Request og URL som inndata", async () => {
    for (const input of [
      new URL("https://api.anthropic.com/v1/messages"),
      new Request("https://api.anthropic.com/v1/messages", { method: "POST", body: "{}" }),
    ]) {
      await expect(fetch(input)).rejects.toThrow(BLOCKED_AI_NETWORK_MESSAGE);
    }
  });

  it("sperren treffer ikke andre vertsnavn", () => {
    expect(isAnthropicHost("https://example.com/anthropic.com")).toBe(false);
    expect(isAnthropicHost("https://notanthropic.com/")).toBe(false);
    expect(isAnthropicHost("ikke en adresse")).toBe(false);
  });

  it("nøkkelen er fjernet fra miljøet i testene", () => {
    expect(process.env[SECRET_NAME]).toBeUndefined();
  });
});

describe("S2 seed lager ingen anthropic-tilkobling", () => {
  it("runSeed to ganger gir null rader med provider = anthropic", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const env = { SEED_ADMIN_EMAIL: "admin@example.com", SEED_ADMIN_NAME: "Test Admin" };
    await runSeed(env);
    await runSeed(env);
    const rows = await db
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.provider, "anthropic"));
    expect(rows).toEqual([]);
  });

  it("ingen seed-fil nevner anthropic eller nøkkelen", () => {
    const dir = join(repoRoot, "src", "db", "seed");
    const files = readdirSync(dir).filter(
      (name) => /\.ts$/.test(name) && !/\.test\.ts$/.test(name),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const text = readFileSync(join(dir, name), "utf8");
      expect(text, name).not.toMatch(/anthropic/i);
      expect(text, name).not.toContain(SECRET_NAME);
    }
  });
});

describe("S2 CI, .env.example og e2e får aldri nøkkelen", () => {
  it("CI-arbeidsflyten har ikke nøkkelen med verdi", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).not.toContain(SECRET_NAME);
  });

  it("ingen arbeidsflyt har nøkkelen som fast verdi (bare fra secrets)", () => {
    const dir = join(repoRoot, ".github", "workflows");
    for (const name of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
      const lines = readFileSync(join(dir, name), "utf8").split("\n");
      for (const line of lines.filter((l) => l.includes(SECRET_NAME) && !/^\s*#/.test(l))) {
        const match = new RegExp(`^\\s*${SECRET_NAME}\\s*:\\s*(.*)$`).exec(line);
        if (match) expect(match[1]!.trim(), `${name}: ${line}`).toMatch(/^\$\{\{\s*secrets\./);
      }
    }
  });

  it(".env.example har bare en tom linje for nøkkelen", () => {
    const lines = read(".env.example")
      .split("\n")
      .filter((line) => line.includes(SECRET_NAME) && !/^\s*#/.test(line));
    expect(lines).toEqual([`${SECRET_NAME}=`]);
  });

  it("Playwright-oppsettet setter aldri nøkkelen", () => {
    const config = read("playwright.config.ts");
    expect(config).not.toMatch(new RegExp(`${SECRET_NAME}\\s*:\\s*["'\`][^"'\`]+`));
    for (const file of ["e2e/helpers.ts", "e2e/global-setup.ts"].filter((f) =>
      existsSync(join(repoRoot, f)),
    )) {
      expect(read(file), file).not.toMatch(new RegExp(`${SECRET_NAME}\\s*[:=]\\s*["'\`][^"'\`]+`));
    }
  });
});
