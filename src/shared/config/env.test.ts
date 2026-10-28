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
