import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "./proxy";

/*
 * Rett T-0070 (docs/agenter/oppgaver/rett-t0070-t0071.md punkt 2, testplan 1e): proxyen setter
 * `x-request-path` = `pathname`, overskriver et hode klienten har sendt, gjør ingen
 * innloggingssjekk og logger ingenting. Testdata er oppdiktet. Støtter hovedmål: de ansatte
 * (tilbake til samme side etter innlogging).
 */

const BASE = "https://ezprop.invalid";

/** Hodene proxyen sender videre til siden (Next legger dem i `x-middleware-request-*`). */
function forwardedPath(response: Response): string | null {
  return response.headers.get("x-middleware-request-x-request-path");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("proxy", () => {
  it("setter hodet til nøyaktig pathname, uten spørrestreng", () => {
    const response = proxy(new NextRequest(`${BASE}/arbeidskoe?q=Oppdiktet`));
    expect(forwardedPath(response)).toBe("/arbeidskoe");
  });

  it("overskriver et hode klienten har sendt selv", () => {
    const request = new NextRequest(`${BASE}/oppdrag/x`, {
      headers: { "x-request-path": "//evil.example" },
    });
    expect(forwardedPath(proxy(request))).toBe("/oppdrag/x");
  });

  it("videresender ikke og logger ingenting", () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation(() => {}),
    );
    const response = proxy(new NextRequest(`${BASE}/oppdrag/x`));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("matcher", () => {
  const matcher = new RegExp(`^${config.matcher[0]}$`);

  it.each(["/", "/arbeidskoe", "/oppdrag/abc/bygninger", "/apiary", "/logg-innX"])(
    "tar med %s",
    (path) => {
      expect(matcher.test(path)).toBe(true);
    },
  );

  it.each([
    "/api",
    "/api/auth/get-session",
    "/_next/static/x.js",
    "/_next/image",
    "/logg-inn",
    "/logg-inn/x",
    "/favicon.ico",
    "/sw.js",
  ])("hopper over %s", (path) => {
    expect(matcher.test(path)).toBe(false);
  });
});
