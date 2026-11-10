import { afterEach, describe, expect, it, vi } from "vitest";
import { getEnv, resetEnvCache } from "./env";

// tests/setup-env.ts gir DEV_MAILBOX=1 og gyldige grunnverdier for alle tester.
function stubGraph(values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
  resetEnvCache();
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("miljøvariabler", () => {
  it("delvis Microsoft 365-oppsett stopper oppstarten", () => {
    stubGraph({
      MS_GRAPH_TENANT_ID: "t",
      MS_GRAPH_CLIENT_ID: "",
      MS_GRAPH_CLIENT_SECRET: "",
      MAIL_FROM: "",
    });
    expect(() => getEnv()).toThrow(/bare delvis satt opp/);
  });

  it("alle fire Microsoft 365-verdier sammen godtas", () => {
    stubGraph({
      MS_GRAPH_TENANT_ID: "t",
      MS_GRAPH_CLIENT_ID: "c",
      MS_GRAPH_CLIENT_SECRET: "s",
      MAIL_FROM: "noreply@example.com",
    });
    expect(() => getEnv()).not.toThrow();
    const env = getEnv();
    expect(env.MS_GRAPH_TENANT_ID).toBe("t");
    expect(env.MS_GRAPH_CLIENT_ID).toBe("c");
    expect(env.MS_GRAPH_CLIENT_SECRET).toBe("s");
    expect(env.MAIL_FROM).toBe("noreply@example.com");
    // Postkassen vinner lokalt. emailTransport kan ikke importeres herfra (shared importerer
    // aldri fra core); at devMailbox velges selv med Graph satt, vises i src/core/email/email.test.ts.
    expect(env.DEV_MAILBOX).toBe(true);
  });

  it("SEED_ADMIN_EMAIL leveres med små bokstaver", () => {
    vi.stubEnv("SEED_ADMIN_EMAIL", " Admin@Example.com ");
    resetEnvCache();
    expect(getEnv().SEED_ADMIN_EMAIL).toBe("admin@example.com");
  });
});

/*
 * Nøkkelboksen: testplan docs/funksjoner/fase0b-nokkelboks-testplan.md avsnitt 6. Begge
 * referanseformene er lengre enn 32 tegn, så uten vakten ville de blitt godtatt som nøkkel.
 * Adressene er oppdiktet.
 */
const REFERENCE_URI =
  "@Microsoft.KeyVault(SecretUri=https://kv-oppdiktet.vault.azure.net/secrets/oppdiktet/)";
const REFERENCE_NAME = "@Microsoft.KeyVault(VaultName=kv-oppdiktet;SecretName=oppdiktet)";
const REFERENCE_PARTS = ["vault.azure.net", "kv-oppdiktet", "https://", "@Microsoft.KeyVault"];

/** Feilmeldingen fra getEnv(), eller «» hvis den ikke kastet. */
function envError(): string {
  try {
    getEnv();
  } catch (error) {
    return (error as Error).message;
  }
  return "";
}

describe("uløste referanser til nøkkelboksen", () => {
  it.each([[REFERENCE_URI], [REFERENCE_NAME]])(
    "1. BETTER_AUTH_SECRET som uløst referanse %j stopper oppstarten",
    (reference) => {
      expect(reference.length).toBeGreaterThan(32);
      vi.stubEnv("BETTER_AUTH_SECRET", reference);
      resetEnvCache();
      const message = envError();
      expect(message).not.toBe("");
      expect(message).toContain("BETTER_AUTH_SECRET");
      expect(message).toContain("referanse til nøkkelboksen");
      for (const part of REFERENCE_PARTS) expect(message, part).not.toContain(part);
    },
  );

  it.each([[REFERENCE_URI], [REFERENCE_NAME]])(
    "2. DATABASE_URL som uløst referanse %j stopper oppstarten",
    (reference) => {
      vi.stubEnv("DATABASE_URL", reference);
      resetEnvCache();
      const message = envError();
      expect(message).not.toBe("");
      expect(message).toContain("DATABASE_URL");
      expect(message).toContain("referanse til nøkkelboksen");
      for (const part of REFERENCE_PARTS) expect(message, part).not.toContain(part);
    },
  );

  it("3. begge uløst gir én melding som nevner begge", () => {
    vi.stubEnv("BETTER_AUTH_SECRET", REFERENCE_URI);
    vi.stubEnv("DATABASE_URL", REFERENCE_NAME);
    resetEnvCache();
    const message = envError();
    expect(message).toContain("BETTER_AUTH_SECRET");
    expect(message).toContain("DATABASE_URL");
    for (const part of REFERENCE_PARTS) expect(message, part).not.toContain(part);
  });

  it("4. gyldige verdier godtas som før", () => {
    const original = process.env.BETTER_AUTH_SECRET;
    vi.stubEnv("BETTER_AUTH_SECRET", REFERENCE_URI);
    resetEnvCache();
    expect(() => getEnv()).toThrow();

    vi.unstubAllEnvs();
    resetEnvCache();
    expect(() => getEnv()).not.toThrow();
    expect(getEnv().BETTER_AUTH_SECRET).toBe(original);

    const withKeyVaultInside = "oppdiktet-KeyVault-nokkel-0123456789abcd";
    expect(withKeyVaultInside).toHaveLength(40);
    vi.stubEnv("BETTER_AUTH_SECRET", withKeyVaultInside);
    resetEnvCache();
    expect(() => getEnv()).not.toThrow();
    expect(getEnv().BETTER_AUTH_SECRET).toBe(withKeyVaultInside);
  });

  it("5. MS_GRAPH_CLIENT_SECRET som referanse stopper ikke oppstarten (vakten er i readSecret)", () => {
    stubGraph({
      MS_GRAPH_TENANT_ID: "t",
      MS_GRAPH_CLIENT_ID: "c",
      MS_GRAPH_CLIENT_SECRET: REFERENCE_URI,
      MAIL_FROM: "noreply@example.com",
    });
    expect(() => getEnv()).not.toThrow();
  });
});
