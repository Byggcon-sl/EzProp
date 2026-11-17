import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as access from "@/core/access";
import { resetEnvCache } from "@/shared/config/env";
import { logger, type LogFields } from "@/shared/lib/logger";
import { OPERATIONS_SECRET_MIN_LENGTH, verifyOperationsSecret } from "./operations-secret";

/*
 * Testplan docs/agenter/oppgaver/rydd-innloggingsdata-testplan.md, avsnitt 3 (S1–S12).
 * Driftshemmeligheten settes bare med `vi.stubEnv`. Alle verdier er oppdiktet.
 *
 * Støtter hovedmål: de ansatte (bare den planlagte driftsjobben kommer inn, og feil oppsett slår
 * av endepunktet uten å stoppe appen). KI i bunnen: ikke berørt.
 */

const NAME = "AUTH_CLEANUP_SECRET";
const SECRET = "oppdiktet-driftshemmelighet-for-tester-0123456789";
const REFERENCE =
  "@Microsoft.KeyVault(SecretUri=https://kv-oppdiktet.vault.azure.net/secrets/auth-cleanup-secret/)";

function setSecret(value: string) {
  vi.stubEnv(NAME, value);
  resetEnvCache();
}

type Warning = { msg: string; fields: LogFields | undefined };

function captureWarnings(): Warning[] {
  const warnings: Warning[] = [];
  vi.spyOn(logger, "warn").mockImplementation((msg: string, fields?: LogFields) => {
    warnings.push({ msg, fields });
  });
  vi.spyOn(logger, "error").mockImplementation((msg: string, fields?: LogFields) => {
    warnings.push({ msg, fields });
  });
  return warnings;
}

beforeEach(() => {
  resetEnvCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetEnvCache();
});

describe("verifyOperationsSecret", () => {
  it("minimum length is 32", () => {
    expect(OPERATIONS_SECRET_MIN_LENGTH).toBe(32);
    expect(SECRET.length).toBeGreaterThanOrEqual(32);
  });

  it("S1 false when secret is not set", () => {
    captureWarnings();
    setSecret("");
    expect(verifyOperationsSecret(`Bearer ${SECRET}`)).toBe(false);
    expect(verifyOperationsSecret("Bearer ")).toBe(false);
    expect(verifyOperationsSecret("Bearer")).toBe(false);
    expect(verifyOperationsSecret("")).toBe(false);
    expect(verifyOperationsSecret(null)).toBe(false);
  });

  it("S2 false when secret is shorter than 32 chars", () => {
    captureWarnings();
    const short = "a".repeat(31);
    setSecret(short);
    expect(verifyOperationsSecret(`Bearer ${short}`)).toBe(false);
  });

  it("S3 true when secret is exactly 32 chars and header matches", () => {
    const exact = "b".repeat(32);
    setSecret(exact);
    expect(verifyOperationsSecret(`Bearer ${exact}`)).toBe(true);
  });

  it("S4 false when secret is an unresolved key vault reference", () => {
    captureWarnings();
    setSecret(REFERENCE);
    expect(REFERENCE.length).toBeGreaterThan(32);
    expect(verifyOperationsSecret(`Bearer ${REFERENCE}`)).toBe(false);
    expect(verifyOperationsSecret(REFERENCE)).toBe(false);
  });

  it("S5 false without header", () => {
    setSecret(SECRET);
    expect(verifyOperationsSecret(null)).toBe(false);
    expect(verifyOperationsSecret("")).toBe(false);
  });

  it("S6 false with wrong secret", () => {
    setSecret(SECRET);
    const wrong = SECRET.replace(/0/, "1");
    expect(wrong).not.toBe(SECRET);
    expect(wrong.length).toBe(SECRET.length);
    expect(verifyOperationsSecret(`Bearer ${wrong}`)).toBe(false);
    expect(verifyOperationsSecret(`Bearer ${"x".repeat(SECRET.length)}`)).toBe(false);
  });

  it.each([
    ["one char longer", `${SECRET}x`],
    ["one char shorter", SECRET.slice(0, -1)],
    ["prefix only", SECRET.slice(0, 32)],
    ["doubled", `${SECRET}${SECRET}`],
    ["empty", ""],
  ])("S7 false with wrong length (%s)", (_label, value) => {
    setSecret(SECRET);
    expect(verifyOperationsSecret(`Bearer ${value}`)).toBe(false);
  });

  it.each([
    ["Basic scheme", `Basic ${SECRET}`],
    ["value only", SECRET],
    ["Token scheme", `Token ${SECRET}`],
    ["colon instead of space", `Bearer:${SECRET}`],
    ["no space", `Bearer${SECRET}`],
    ["secret before scheme", `${SECRET} Bearer`],
    ["two values", `Bearer ${SECRET}, Bearer ${SECRET}`],
  ])("S8 false without Bearer prefix or with other scheme (%s)", (_label, header) => {
    setSecret(SECRET);
    expect(verifyOperationsSecret(header)).toBe(false);
  });

  it("S9 true with correct Bearer header", () => {
    setSecret(SECRET);
    expect(verifyOperationsSecret(`Bearer ${SECRET}`)).toBe(true);
  });

  it.each([
    ["too short", "c".repeat(20)],
    ["unresolved reference", REFERENCE],
  ])("S10 warns with name only on bad setup (%s)", (_label, value) => {
    const warnings = captureWarnings();
    setSecret(value);
    expect(verifyOperationsSecret(`Bearer ${value}`)).toBe(false);
    expect(warnings).toHaveLength(1);
    const text = JSON.stringify(warnings[0]);
    expect(text).toContain(NAME);
    expect(text).not.toContain(value);
    for (const part of ["vault.azure.net", "kv-oppdiktet", "@Microsoft.KeyVault"]) {
      expect(text, part).not.toContain(part);
    }
  });

  it("S10 no warning and no value in the log when the call is checked with a correct setup", () => {
    const warnings = captureWarnings();
    setSecret(SECRET);
    verifyOperationsSecret(`Bearer ${SECRET}`);
    verifyOperationsSecret("Bearer feil-verdi");
    for (const warning of warnings) expect(JSON.stringify(warning)).not.toContain(SECRET);
  });

  it("S11 does not use readSecret, no database import, uses timingSafeEqual", () => {
    const source = readFileSync(path.join(__dirname, "operations-secret.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const imports = [...code.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(
      (match) => match[1]!,
    );
    for (const name of imports) {
      expect(name.startsWith("@/db"), name).toBe(false);
      expect(name.startsWith("@/core/integrations"), name).toBe(false);
      expect(name.startsWith("@/core/auth"), name).toBe(false);
    }
    expect(code).not.toContain("readSecret");
    expect(code).not.toContain("process.env");
    expect(code).toContain("getEnv");
    expect(code).toMatch(/createHash\(\s*["']sha256["']\s*\)/);
    expect(code).toContain("timingSafeEqual");
    expect(code).toContain("isUnresolvedSecretReference");
    expect(code).not.toContain("BETTER_AUTH_SECRET");
  });

  it("S12 exported from @/core/access", () => {
    expect(typeof access.verifyOperationsSecret).toBe("function");
    expect(access.verifyOperationsSecret).toBe(verifyOperationsSecret);
  });
});
