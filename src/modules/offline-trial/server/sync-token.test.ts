import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/core/access";
import type { EmployeeRole } from "@/db/schema";
import { createEmployee, createUser, resetDatabase } from "../../../../tests/factories";
import {
  ALL_ROLES,
  createDeactivatedEmployee,
  setupOrganization,
} from "../../../../tests/offline-trial";
import { issueSyncToken, PUBLIC_SYNC_SECRETS } from "./sync-token";

// Token til synktjenesten (docs/funksjoner/fase1-kandidat-powersync.md pkt. 11). Testplan avsnitt 3.3.
// organization_id i tokenet er det PowerSync filtrerer bøtta på, så den må alltid være grant-ens.

const SECRET = "oppdiktet-testhemmelighet-som-er-lang-nok-0123456789";
const ENDPOINT = "http://localhost:8080";

beforeEach(async () => {
  await resetDatabase();
  vi.stubEnv("POWERSYNC_JWT_SECRET", SECRET);
  vi.stubEnv("POWERSYNC_URL", ENDPOINT);
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

function decodePart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

function split(token: string) {
  const parts = token.split(".");
  expect(parts).toHaveLength(3);
  const [header, payload, signature] = parts as [string, string, string];
  return { header, payload, signature };
}

function devSecretFromEnvExample(): string {
  const text = readFileSync(path.resolve(process.cwd(), ".env.example"), "utf8");
  const line = text.split("\n").find((l) => l.startsWith("POWERSYNC_JWT_SECRET="));
  const value = line?.slice("POWERSYNC_JWT_SECRET=".length).trim();
  if (!value) throw new Error("POWERSYNC_JWT_SECRET mangler i .env.example");
  return value;
}

describe("issueSyncToken", () => {
  it("tokenet har organization_id lik grant.organizationId og aud powersync", async () => {
    const { actor, organizationId, grant } = await setupOrganization("inspector");
    const result = await issueSyncToken(actor, organizationId);

    expect(result.endpoint).toBe(ENDPOINT);
    const payload = decodePart(split(result.token).payload);
    expect(payload.organization_id).toBe(grant.organizationId);
    expect(payload.aud).toBe("powersync");
    expect(payload.sub).toBe(actor.id);
  });

  it("tokenet har bare sub, organization_id, aud, iat og exp", async () => {
    const { organizationId } = await setupOrganization("admin");
    const kari = await createUser({ name: "Kari Nordmann", email: "kari.nordmann@example.com" });
    await createEmployee(kari, organizationId, ["inspector"]);

    const { token } = await issueSyncToken(kari, organizationId);
    const { payload } = split(token);
    const decoded = decodePart(payload);
    expect(Object.keys(decoded).sort()).toEqual(["aud", "exp", "iat", "organization_id", "sub"]);
    const json = Buffer.from(payload, "base64url").toString("utf8");
    expect(json).not.toContain("Kari");
    expect(json).not.toContain("Nordmann");
    expect(json).not.toContain("kari.nordmann@example.com");
    expect(json).not.toContain("@");
  });

  it("exp er høyst én time etter iat", async () => {
    const { actor, organizationId } = await setupOrganization();
    const { token } = await issueSyncToken(actor, organizationId);
    const { iat, exp } = decodePart(split(token).payload) as { iat: number; exp: number };
    expect(Number.isInteger(iat)).toBe(true);
    expect(Number.isInteger(exp)).toBe(true);
    expect(exp - iat).toBeGreaterThan(0);
    expect(exp - iat).toBeLessThanOrEqual(3600);
    expect(Math.abs(iat - Math.floor(Date.now() / 1000))).toBeLessThan(60);
  });

  it("signaturen er HS256 og kan verifiseres med node:crypto", async () => {
    const { actor, organizationId } = await setupOrganization();
    const { token } = await issueSyncToken(actor, organizationId);
    const { header, payload, signature } = split(token);

    const decodedHeader = decodePart(header);
    expect(decodedHeader.alg).toBe("HS256");
    if (decodedHeader.kid !== undefined) expect(decodedHeader.kid).toBe("trial");

    const expected = createHmac("sha256", SECRET)
      .update(`${header}.${payload}`)
      .digest("base64url");
    expect(signature).toBe(expected);
    const wrong = createHmac("sha256", `${SECRET}-feil`)
      .update(`${header}.${payload}`)
      .digest("base64url");
    expect(signature).not.toBe(wrong);
  });

  it("uten POWERSYNC_JWT_SECRET kastes en tydelig feil", async () => {
    const { actor, organizationId } = await setupOrganization();
    vi.stubEnv("POWERSYNC_JWT_SECRET", "");
    await expect(issueSyncToken(actor, organizationId)).rejects.toThrow(/POWERSYNC_JWT_SECRET/);
    vi.stubEnv("POWERSYNC_JWT_SECRET", undefined);
    await expect(issueSyncToken(actor, organizationId)).rejects.toThrow(/POWERSYNC_JWT_SECRET/);
  });

  it("for kort hemmelighet (under 32 byte) kastes feil", async () => {
    const { actor, organizationId } = await setupOrganization();
    vi.stubEnv("POWERSYNC_JWT_SECRET", "x".repeat(31));
    await expect(issueSyncToken(actor, organizationId)).rejects.toThrow(Error);
    vi.stubEnv("POWERSYNC_JWT_SECRET", "x".repeat(32));
    await expect(issueSyncToken(actor, organizationId)).resolves.toHaveProperty("token");
  });

  it("utviklingsverdien fra .env.example nektes når BETTER_AUTH_URL ikke er localhost", async () => {
    const { actor, organizationId } = await setupOrganization();
    const devSecret = devSecretFromEnvExample();
    expect(Buffer.byteLength(devSecret)).toBeGreaterThanOrEqual(32);
    vi.stubEnv("POWERSYNC_JWT_SECRET", devSecret);

    vi.stubEnv("BETTER_AUTH_URL", "https://test.example.com");
    await expect(issueSyncToken(actor, organizationId)).rejects.toThrow(Error);

    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    await expect(issueSyncToken(actor, organizationId)).resolves.toHaveProperty("token");
  });

  it("nøklene fra CI, e2e og utvikling i repoet nektes når BETTER_AUTH_URL ikke er localhost (småfunn 10)", async () => {
    const { actor, organizationId } = await setupOrganization();
    // Alle steder i repoet der en synknøkkel står åpent
    const files = [".env.example", "start.sh", ".github/workflows/ci.yml", "playwright.config.ts"];
    const found = new Set<string>();
    for (const file of files) {
      const text = readFileSync(path.resolve(process.cwd(), file), "utf8");
      for (const match of text.matchAll(
        /POWERSYNC_JWT_SECRET["']?\s*[:=]\s*["']?([A-Za-z0-9_-]{32,})/g,
      )) {
        found.add(match[1]!);
      }
    }
    expect(found.size, "fant ingen synknøkler i filene").toBeGreaterThanOrEqual(3);
    for (const secret of found) {
      expect(PUBLIC_SYNC_SECRETS, secret).toContain(secret);
      vi.stubEnv("POWERSYNC_JWT_SECRET", secret);
      vi.stubEnv("BETTER_AUTH_URL", "https://test.example.com");
      await expect(issueSyncToken(actor, organizationId), secret).rejects.toThrow(
        /står åpent i repoet/,
      );
      vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
      await expect(issueSyncToken(actor, organizationId), secret).resolves.toHaveProperty("token");
    }
  });

  it("POWERSYNC_JWT_SECRET lik BETTER_AUTH_SECRET gir feil (småfunn 14)", async () => {
    const { actor, organizationId } = await setupOrganization();
    vi.stubEnv("BETTER_AUTH_SECRET", SECRET);
    await expect(issueSyncToken(actor, organizationId)).rejects.toThrow(
      /kan ikke være lik BETTER_AUTH_SECRET/,
    );
    vi.stubEnv("BETTER_AUTH_SECRET", `${SECRET}-annen`);
    await expect(issueSyncToken(actor, organizationId)).resolves.toHaveProperty("token");
  });

  it("fremmed organisasjon gir AccessDeniedError", async () => {
    const a = await setupOrganization("admin", "Organisasjon A");
    const b = await setupOrganization("admin", "Organisasjon B");
    await expect(issueSyncToken(a.actor, b.organizationId)).rejects.toThrow(AccessDeniedError);
    await expect(issueSyncToken(b.actor, a.organizationId)).rejects.toThrow(AccessDeniedError);
  });

  describe("alle fire roller får token, deaktivert ansatt nektes", () => {
    it.each(ALL_ROLES)(
      "alle fire roller får token, deaktivert ansatt nektes (%s)",
      async (role: EmployeeRole) => {
        const { actor, organizationId } = await setupOrganization(role);
        const { token } = await issueSyncToken(actor, organizationId);
        expect(decodePart(split(token).payload).organization_id).toBe(organizationId);
      },
    );

    it("alle fire roller får token, deaktivert ansatt nektes (deaktivert)", async () => {
      const { organizationId } = await setupOrganization("admin");
      const gone = await createDeactivatedEmployee(organizationId);
      await expect(issueSyncToken(gone, organizationId)).rejects.toThrow(AccessDeniedError);
    });
  });
});
