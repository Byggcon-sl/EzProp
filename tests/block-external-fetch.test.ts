import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { integrationConnections } from "@/db/schema";
import { runSeed } from "@/db/seed/run";
import { BLOCKED_FETCH_MESSAGE, isBlockedHost } from "./block-external-fetch";
import { resetDatabase } from "./factories";

/*
 * S2, ingen ekte nettkall (docs/funksjoner/fase2a-ki-leverandor-testplan.md avsnitt 4,
 * kortet Omfang 11). Den globale sperren, seed uten tilkoblingen `anthropic`, og ingen nøkkel med
 * verdi i CI eller .env.example.
 *
 * Støtter hovedmål: KI i bunnen, trygt. Ingen test kan bruke nøkkelen eller koste penger.
 */

const repoRoot = join(__dirname, "..");
const PROVIDER = "anthropic";

describe("S2 global sperre mot ekte KI-kall", () => {
  afterEach(() => vi.restoreAllMocks());

  it("fetch mot leverandørens API i en test uten stub kaster en tydelig feil", async () => {
    await expect(
      fetch("https://api.anthropic.com/v1/messages", { method: "POST" }),
    ).rejects.toThrow(BLOCKED_FETCH_MESSAGE);
    await expect(fetch(new URL("https://API.Anthropic.com./v1/messages"))).rejects.toThrow(
      BLOCKED_FETCH_MESSAGE,
    );
    await expect(fetch(new Request("https://anthropic.com/"))).rejects.toThrow(
      BLOCKED_FETCH_MESSAGE,
    );
  });

  it("andre vertsnavn sperres ikke", () => {
    expect(isBlockedHost("https://graph.microsoft.com/v1.0/users/x")).toBe(false);
    expect(isBlockedHost("http://localhost:3000/api/helse")).toBe(false);
    expect(isBlockedHost("https://anthropic.com.example.org/")).toBe(false);
    expect(isBlockedHost("https://notanthropic.com/")).toBe(false);
    expect(isBlockedHost("/relativ/sti")).toBe(false);
  });

  it("sperren ligger under en spion: spionen ser kallet, og sperren kaster fortsatt", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(fetch("https://api.anthropic.com/v1/messages")).rejects.toThrow(
      BLOCKED_FETCH_MESSAGE,
    );
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("S2 seed lager ingen tilkobling til leverandøren", () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("pnpm db:seed gir 0 rader med provider = anthropic", async () => {
    await runSeed({ SEED_ADMIN_EMAIL: "admin@example.com", SEED_ADMIN_NAME: "Test Admin" });
    const rows = await db
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.provider, PROVIDER));
    expect(rows).toEqual([]);
  });

  it("seed-filene nevner ikke leverandørkoden", () => {
    const seedDir = join(repoRoot, "src", "db", "seed");
    const files = readdirSync(seedDir).filter(
      (name) => /\.ts$/.test(name) && !/\.test\.ts$/.test(name),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      expect(readFileSync(join(seedDir, name), "utf8"), name).not.toMatch(/["'`]anthropic["'`]/i);
    }
  });
});

describe("S2 ingen nøkkel med verdi i CI eller .env.example", () => {
  it("arbeidsflytene henter ANTHROPIC_API_KEY bare fra secrets", () => {
    const dir = join(repoRoot, ".github", "workflows");
    for (const name of readdirSync(dir).filter((file) => /\.ya?ml$/.test(file))) {
      const lines = readFileSync(join(dir, name), "utf8").split("\n");
      for (const line of lines.filter((l) => /^\s*ANTHROPIC_API_KEY\s*:/.test(l))) {
        expect(line.trim(), name).toBe("ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}");
      }
    }
  });

  it(".env.example har ANTHROPIC_API_KEY bare med tom verdi", () => {
    const file = join(repoRoot, ".env.example");
    expect(existsSync(file)).toBe(true);
    const lines = readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => /^\s*ANTHROPIC_API_KEY\s*=/.test(line));
    for (const line of lines) expect(line.trim()).toBe("ANTHROPIC_API_KEY=");
  });
});
