import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEnv, resetEnvCache } from "./env";

beforeEach(() => {
  resetEnvCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("miljøvariabler", () => {
  it("delvis Microsoft 365-oppsett stopper oppstarten", () => {
    vi.stubEnv("MS_GRAPH_TENANT_ID", "t");
    vi.stubEnv("MS_GRAPH_CLIENT_ID", "");
    vi.stubEnv("MS_GRAPH_CLIENT_SECRET", "");
    vi.stubEnv("MAIL_FROM", "");
    expect(() => getEnv()).toThrow(/bare delvis satt opp/);
  });

  it("alle fire Microsoft 365-verdier sammen godtas", () => {
    vi.stubEnv("MS_GRAPH_TENANT_ID", "t");
    vi.stubEnv("MS_GRAPH_CLIENT_ID", "c");
    vi.stubEnv("MS_GRAPH_CLIENT_SECRET", "s");
    vi.stubEnv("MAIL_FROM", "noreply@example.com");
    expect(() => getEnv()).not.toThrow();
    expect(getEnv()).toMatchObject({ MS_GRAPH_TENANT_ID: "t", MAIL_FROM: "noreply@example.com" });
    // DEV_MAILBOX=1 i tester. At postkassen da vinner over Microsoft 365, vises i
    // src/core/email/email.test.ts («postkassen vinner lokalt …»); shared kan ikke importere core.
    expect(getEnv().DEV_MAILBOX).toBe(true);
  });

  it("SEED_ADMIN_EMAIL leveres med små bokstaver", () => {
    vi.stubEnv("SEED_ADMIN_EMAIL", " Admin@Example.com ");
    expect(getEnv().SEED_ADMIN_EMAIL).toBe("admin@example.com");
  });
});
