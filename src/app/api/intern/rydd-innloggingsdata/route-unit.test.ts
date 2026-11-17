import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "@/shared/lib/logger";

/*
 * Ruten for rydding av innloggingsdata (ADR 0014), testplan
 * docs/agenter/oppgaver/rydd-innloggingsdata-testplan.md avsnitt 4. Her prøves bare rutens egen
 * oppførsel, med tilgangssjekken og ryddefunksjonen stubbet. Hemmelighetssjekken (S-testene) og
 * slettingen mot databasen (R-testene og E-testene med rader) prøves for seg.
 * Støtter hovedmål: best for de ansatte (trygg innlogging, dataminimering).
 */

const lines: string[] = [];
const testLogger = createLogger((_level, line) => lines.push(line));

const verifyOperationsSecret = vi.fn<(header: string | null) => boolean>();
const purgeExpiredAuthData = vi.fn();

vi.mock("@/core/access", () => ({
  verifyOperationsSecret: (header: string | null) => verifyOperationsSecret(header),
  logRejectedOperationsCall: (route: string) =>
    testLogger.warn("Avvist kall til driftsendepunkt", { route }),
}));
vi.mock("@/core/auth/auth-cleanup", () => ({
  purgeExpiredAuthData: (...args: unknown[]) => purgeExpiredAuthData(...args),
}));

const route = await import("./route");

const URL_BASE = "http://localhost/api/intern/rydd-innloggingsdata";
const FAKE_SECRET = "oppdiktet-driftshemmelighet-bare-for-test-0123456789";

function post(init: { headers?: Record<string, string>; body?: string; query?: string } = {}) {
  return new Request(`${URL_BASE}${init.query ?? ""}`, {
    method: "POST",
    headers: init.headers,
    body: init.body,
  });
}

beforeEach(() => {
  lines.length = 0;
  verifyOperationsSecret.mockReset();
  purgeExpiredAuthData.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/intern/rydd-innloggingsdata", () => {
  it("E2/E3. avvist kall gir 404 uten innhold og no-store, og ryddingen kjøres ikke", async () => {
    verifyOperationsSecret.mockReturnValue(false);
    const without = await route.POST(post());
    const wrong = await route.POST(post({ headers: { authorization: "Bearer feil" } }));
    for (const response of [without, wrong]) {
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toBe("");
    }
    expect(verifyOperationsSecret).toHaveBeenNthCalledWith(1, null);
    expect(verifyOperationsSecret).toHaveBeenNthCalledWith(2, "Bearer feil");
    expect(purgeExpiredAuthData).not.toHaveBeenCalled();
  });

  it("E5. riktig hemmelighet gir 200 med bare antall og tidsbruk", async () => {
    verifyOperationsSecret.mockReturnValue(true);
    purgeExpiredAuthData.mockResolvedValue({
      loginAttempts: 3,
      verifications: 2,
      sessions: 1,
      durationMs: 7,
      extra: "skal ikke ut",
    });
    const response = await route.POST(
      post({ headers: { authorization: `Bearer ${FAKE_SECRET}` } }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ["durationMs", "loginAttempts", "sessions", "verifications"].sort(),
    );
    expect(body).toEqual({ loginAttempts: 3, verifications: 2, sessions: 1, durationMs: 7 });
  });

  it("E6. body og adresseparametre leses ikke, og ryddingen får ingen tid utenfra", async () => {
    verifyOperationsSecret.mockReturnValue(true);
    purgeExpiredAuthData.mockResolvedValue({
      loginAttempts: 0,
      verifications: 0,
      sessions: 0,
      durationMs: 1,
    });
    const request = post({
      headers: { authorization: `Bearer ${FAKE_SECRET}`, "content-type": "application/json" },
      body: JSON.stringify({ now: "2100-01-01", retentionMs: 0 }),
      query: "?now=2100-01-01",
    });
    const response = await route.POST(request);
    expect(response.status).toBe(200);
    expect(purgeExpiredAuthData).toHaveBeenCalledTimes(1);
    expect(purgeExpiredAuthData.mock.calls[0]).toEqual([]);
    expect(request.bodyUsed).toBe(false);
  });

  it("E7. bare POST eksporteres, og ruten er dynamisk", () => {
    expect(typeof route.POST).toBe("function");
    for (const method of ["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      expect(route, method).not.toHaveProperty(method);
    }
    expect(route.dynamic).toBe("force-dynamic");
  });

  it("E8. feil i ryddingen gir 500 uten detaljer", async () => {
    verifyOperationsSecret.mockReturnValue(true);
    purgeExpiredAuthData.mockRejectedValue(new Error("hemmelig databasedetalj"));
    const response = await route.POST(
      post({ headers: { authorization: `Bearer ${FAKE_SECRET}` } }),
    );
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
  });

  it("E9. avvist kall logges som advarsel uten headere og uten IP", async () => {
    verifyOperationsSecret.mockReturnValue(false);
    await route.POST(
      post({
        headers: {
          authorization: `Bearer ${FAKE_SECRET}`,
          "x-forwarded-for": "203.0.113.7",
          cookie: "oppdiktet=1",
        },
      }),
    );
    expect(lines).toHaveLength(1);
    const line = lines[0] ?? "";
    expect(JSON.parse(line)).toMatchObject({ level: "warn" });
    for (const forbidden of [
      FAKE_SECRET,
      "Bearer",
      "authorization",
      "x-forwarded-for",
      "203.0.113.7",
      "cookie",
      "oppdiktet=1",
    ]) {
      expect(line.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });
});

describe("rutens importer", () => {
  it("E11. ruten importerer bare tilgangen og ryddefunksjonen", () => {
    const source = readFileSync(path.join(import.meta.dirname, "route.ts"), "utf8");
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
    expect(imports.sort()).toEqual(["@/core/access", "@/core/auth/auth-cleanup"]);
    expect(source).not.toMatch(/@\/db/);
    expect(source).not.toMatch(/\.json\(\)|\.text\(\)|formData\(|searchParams|nextUrl/);
  });
});
