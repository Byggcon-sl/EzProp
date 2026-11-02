import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger, REDACTED } from "@/shared/lib/logger";
import { InvalidSecretRefError, readSecret, SecretNotFoundError } from "./index";

/*
 * Testplan docs/funksjoner/fase0b-tilkoblingslag-testplan.md avsnitt 2. Støtter hovedmål:
 * reklamasjoner og KI først (hemmeligheter går én vei og lekker aldri). Verdiene er oppdiktet og
 * settes bare med `vi.stubEnv`.
 */

const SECRET = "hemmelig-test-verdi";
const NAME = "MS_GRAPH_CLIENT_SECRET";

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * Kjører funksjonen og gir feilen den kastet eller avviste med (eller `undefined`). Virker både
 * om `readSecret` er synkron (miljøvariabler nå) eller asynkron (nøkkelboksen senere).
 */
async function caught(fn: () => unknown): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("readSecret", () => {
  it("1. leser verdien fra miljøet", async () => {
    vi.stubEnv(NAME, SECRET);
    expect(await readSecret(NAME)).toBe(SECRET);
  });

  it("2. mangler verdien: SecretNotFoundError med navnet i meldingen", async () => {
    vi.stubEnv(NAME, undefined);
    const error = await caught(() => readSecret(NAME));
    expect(error).toBeInstanceOf(SecretNotFoundError);
    expect((error as Error).message).toContain(NAME);
  });

  it("3. tom streng regnes som mangler", async () => {
    vi.stubEnv(NAME, "");
    expect(await caught(() => readSecret(NAME))).toBeInstanceOf(SecretNotFoundError);
  });

  it("4. meldingen har aldri noen verdi", async () => {
    vi.stubEnv("ANNEN_HEMMELIGHET", SECRET);
    vi.stubEnv(NAME, undefined);
    const error = await caught(() => readSecret(NAME));
    expect(error).toBeInstanceOf(SecretNotFoundError);
    expect((error as Error).message).not.toContain(SECRET);
    expect(String(error)).not.toContain(SECRET);
  });

  it.each([
    ["ms graph"],
    ["a=b"],
    ["lowercase"],
    [""],
    ["A"],
    ["1ABC"],
    ["ABC-DEF"],
    ["A".repeat(129)],
    ["MS_GRAPH_CLIENT_SECRET\n"],
  ])("5. ugyldig navn %j gir InvalidSecretRefError uten å lese miljøet", async (name) => {
    // Navnet settes i miljøet med en verdi (der miljøet tillater det); den skal likevel ikke ut
    vi.stubEnv(name, SECRET);
    let value: unknown;
    const error = await caught(async () => {
      value = await readSecret(name);
    });
    expect(error).toBeInstanceOf(InvalidSecretRefError);
    expect(value).toBeUndefined();
    expect((error as Error).message).not.toContain(SECRET);
  });

  it.each([["AB"], ["MS_GRAPH_CLIENT_SECRET"], ["A_1"], ["A".repeat(128)]])(
    "6. gyldig navn %j leses",
    async (name) => {
      vi.stubEnv(name, SECRET);
      expect(await readSecret(name)).toBe(SECRET);
    },
  );

  it("7. loggeren fjerner clientSecret, men viser secretRef-navnet", async () => {
    const lines: string[] = [];
    const log = createLogger((_level, line) => lines.push(line));
    log.error("x", { clientSecret: SECRET, secretRef: NAME });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.clientSecret).toBe(REDACTED);
    expect(parsed.secretRef).toBe(NAME);
    expect(lines[0]).not.toContain(SECRET);
  });

  it.each([
    ["BETTER_AUTH_SECRET"],
    ["DATABASE_URL"],
    ["TEST_DATABASE_URL"],
    ["POWERSYNC_JWT_SECRET"],
    ["FILE_STORAGE_AZURE_CONNECTION_STRING"],
  ])("8. nektlisten: %s gir InvalidSecretRefError selv når verdien finnes", async (name) => {
    vi.stubEnv(name, SECRET);
    let value: unknown;
    const error = await caught(async () => {
      value = await readSecret(name);
    });
    expect(error).toBeInstanceOf(InvalidSecretRefError);
    expect(value).toBeUndefined();
    expect((error as Error).message).not.toContain(SECRET);
    expect(String(error)).not.toContain(SECRET);
  });
});
