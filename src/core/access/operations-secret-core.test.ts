import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/shared/config/env";
import { logger } from "@/shared/lib/logger";
import { OPERATIONS_SECRET_MIN_LENGTH, verifyOperationsSecret } from "./operations-secret";

/*
 * Utviklerens egne tester for driftshemmeligheten (ADR 0014). Testskriverens fulle sett (S1–S12)
 * ligger i `operations-secret.test.ts`. Oppdiktet verdi.
 * Støtter hovedmål: best for de ansatte (bare den planlagte jobben kan rydde innloggingsdata).
 */

const SECRET = "oppdiktet-driftshemmelighet-0123456789";

function setSecret(value: string | undefined) {
  vi.stubEnv("AUTH_CLEANUP_SECRET", value);
  resetEnvCache();
}

describe("verifyOperationsSecret", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
    vi.restoreAllMocks();
  });

  it("accepts only the exact Bearer header", () => {
    setSecret(SECRET);
    expect(verifyOperationsSecret(`Bearer ${SECRET}`)).toBe(true);
    expect(verifyOperationsSecret(null)).toBe(false);
    expect(verifyOperationsSecret(SECRET)).toBe(false);
    expect(verifyOperationsSecret(`bearer ${SECRET}`)).toBe(false);
    expect(verifyOperationsSecret(`Basic ${SECRET}`)).toBe(false);
    expect(verifyOperationsSecret(`Bearer  ${SECRET}`)).toBe(false);
    expect(verifyOperationsSecret(`Bearer ${SECRET}x`)).toBe(false);
    expect(verifyOperationsSecret(`Bearer ${SECRET.slice(1)}`)).toBe(false);
    expect(verifyOperationsSecret("Bearer ")).toBe(false);
  });

  it("is closed without a secret, and warns with the name only on bad setup", () => {
    const warn = vi.spyOn(logger, "warn");
    setSecret(undefined);
    expect(verifyOperationsSecret("Bearer ")).toBe(false);
    expect(warn).not.toHaveBeenCalled();

    const short = "a".repeat(OPERATIONS_SECRET_MIN_LENGTH - 1);
    setSecret(short);
    expect(verifyOperationsSecret(`Bearer ${short}`)).toBe(false);

    const reference = "@Microsoft.KeyVault(SecretUri=https://oppdiktet.vault.azure.net/secrets/x)";
    setSecret(reference);
    expect(verifyOperationsSecret(`Bearer ${reference}`)).toBe(false);

    expect(warn).toHaveBeenCalledTimes(2);
    const text = JSON.stringify(warn.mock.calls);
    expect(text).toContain("AUTH_CLEANUP_SECRET");
    expect(text).not.toContain(short);
    expect(text).not.toContain("oppdiktet.vault");
  });

  it("accepts a secret of exactly the minimum length", () => {
    const exact = "b".repeat(OPERATIONS_SECRET_MIN_LENGTH);
    setSecret(exact);
    expect(verifyOperationsSecret(`Bearer ${exact}`)).toBe(true);
  });
});
