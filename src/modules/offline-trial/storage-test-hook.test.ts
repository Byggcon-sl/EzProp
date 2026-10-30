import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetPersistRequestForTests } from "./storage-health";
import { readStorageHealthForScreen, throwIfStorageFailHook } from "./storage-test-hook";

const MB = 1024 * 1024;

function stubStorage(persisted = false) {
  const persist = vi.fn(async () => true);
  vi.stubGlobal("navigator", {
    storage: {
      estimate: vi.fn(async () => ({ usage: 10 * MB, quota: 4096 * MB })),
      persisted: vi.fn(async () => persisted),
      persist,
    },
  });
  return persist;
}

describe("testkroken for lagring", () => {
  beforeEach(() => {
    resetPersistRequestForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("gjør ingenting uten miljøvariabelen", async () => {
    vi.stubEnv("NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS", "");
    stubStorage();
    vi.stubGlobal("window", {
      __offlineTrialStorage: { estimate: { usage: 1948 * MB, quota: 2048 * MB }, fail: "both" },
    });
    expect(() => throwIfStorageFailHook("answer")).not.toThrow();
    expect(() => throwIfStorageFailHook("photo")).not.toThrow();
    const health = await readStorageHealthForScreen();
    expect(health).toMatchObject({ level: "ok", usage: 10 * MB, quota: 4096 * MB });
  });

  it("bruker tallene fra kroken og ekte persisted(), og leser kroken hver gang", async () => {
    vi.stubEnv("NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS", "1");
    stubStorage(true);
    const hook: { estimate?: { usage: number; quota: number } } = {
      estimate: { usage: 1948 * MB, quota: 2048 * MB },
    };
    vi.stubGlobal("window", { __offlineTrialStorage: hook });
    expect(await readStorageHealthForScreen()).toEqual({
      usage: 1948 * MB,
      quota: 2048 * MB,
      level: "low",
      persisted: "yes",
    });
    hook.estimate = { usage: 100 * MB, quota: 2148 * MB };
    expect((await readStorageHealthForScreen()).level).toBe("ok");
  });

  it("feiler med full plass for riktig art til den slås av", () => {
    vi.stubEnv("NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS", "1");
    const hook: { fail?: "answer" | "photo" | "both" | null } = { fail: "answer" };
    vi.stubGlobal("window", { __offlineTrialStorage: hook });
    expect(() => throwIfStorageFailHook("answer")).toThrow(DOMException);
    expect(() => throwIfStorageFailHook("answer")).toThrow(
      expect.objectContaining({ name: "QuotaExceededError" }),
    );
    expect(() => throwIfStorageFailHook("photo")).not.toThrow();
    hook.fail = "both";
    expect(() => throwIfStorageFailHook("photo")).toThrow(DOMException);
    hook.fail = null;
    expect(() => throwIfStorageFailHook("answer")).not.toThrow();
  });
});
