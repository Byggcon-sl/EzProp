import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * Rett T-0070: proxyen setter `x-request-path` (testplan
 * docs/agenter/oppgaver/rett-t0070-t0071-testplan.md avsnitt 1e). Bare `pathname`, et hode fra
 * klienten overskrives, ingen innloggingssjekk, ingen videresending og ingen logging.
 *
 * Støtter hovedmål: de ansatte (tilbake til samme side etter innlogging) og personvern
 * (spørrestrengen med søketekst eller navn kommer aldri med).
 */

const mocks = vi.hoisted(() => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/shared/lib/logger", () => ({ logger: mocks.log }));

const { proxy, config } = await import("./proxy");

const UUID = "0192f0c4-5d6e-7a8b-9c0d-1e2f3a4b5c6d";
const BASE = "http://localhost:3100";

/** Hodet proxyen sender videre til siden (Next legger det på svaret med dette prefikset). */
function forwardedPath(response: Response): string | null {
  return response.headers.get("x-middleware-request-x-request-path");
}

async function run(url: string, headers: Record<string, string> = {}) {
  const request = new NextRequest(new URL(url, BASE), { headers });
  return proxy(request);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("1e proxyen setter x-request-path", () => {
  it("hodet er nøyaktig pathname", async () => {
    const response = await run(`/oppdrag/${UUID}/bygninger`);
    expect(forwardedPath(response)).toBe(`/oppdrag/${UUID}/bygninger`);
  });

  it("/arbeidskoe?q=Oppdiktet gir /arbeidskoe (ingen spørrestreng)", async () => {
    const response = await run("/arbeidskoe?q=Oppdiktet%20Navn#x");
    expect(forwardedPath(response)).toBe("/arbeidskoe");
    const all = JSON.stringify([...response.headers.entries()]);
    expect(all).not.toContain("Oppdiktet");
    expect(all).not.toContain("q=");
  });

  it("et hode klienten selv har satt (//evil.example) blir overskrevet med proxyens verdi", async () => {
    const response = await run(`/oppdrag/${UUID}`, { "x-request-path": "//evil.example" });
    expect(forwardedPath(response)).toBe(`/oppdrag/${UUID}`);
    expect(JSON.stringify([...response.headers.entries()])).not.toContain("evil.example");
  });

  it("gjør ingen innloggingssjekk eller videresending, og logger ingenting", async () => {
    const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation(() => {}),
    );
    // Ingen informasjonskapsel: likevel slipper proxyen forespørselen videre
    const response = await run(`/oppdrag/${UUID}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    for (const fn of Object.values(mocks.log)) expect(fn).not.toHaveBeenCalled();
  });

  it("kildefilen har ingen innloggings- eller tilgangssjekk og ingen logging", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // Kommentarer tas bort; de kan nevne requireActor
    const source = readFileSync(path.join(here, "proxy.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(source).not.toMatch(/@\/core\/access|getSession|requireActor|getCurrentActor/);
    expect(source).not.toMatch(/console\.|logger/);
    expect(source).not.toMatch(/NextResponse\.redirect|NextResponse\.rewrite/);
  });
});

describe("1e matcher", () => {
  const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });

  it.each([
    "/arbeidskoe",
    `/oppdrag/${UUID}`,
    `/oppdrag/${UUID}/bygninger`,
    "/firma",
    "/statistikk/tid",
  ])("tar med %s", (url) => {
    expect(matches(url)).toBe(true);
  });

  it.each([
    "/api/auth/get-session",
    "/api/helse",
    "/api",
    "/_next/static/chunks/app.js",
    "/_next/image",
    "/logg-inn",
    "/logg-inn/x",
    "/favicon.ico",
    "/sw.js",
    "/manifest.webmanifest",
  ])("tar ikke med %s", (url) => {
    expect(matches(url)).toBe(false);
  });
});
