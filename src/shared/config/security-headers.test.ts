import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";
import { securityHeaders } from "./security-headers";

describe("sikkerhetshoder (gjennomgang 2026-10-20)", () => {
  it("settes på alle adresser", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toEqual([{ source: "/:path*", headers: securityHeaders }]);
  });

  it("har HSTS, rammeforbud, referrer, nosniff og tillatelser", () => {
    const byKey = Object.fromEntries(securityHeaders.map((h) => [h.key, h.value]));
    expect(byKey["Strict-Transport-Security"]).toMatch(/max-age=31536000/);
    expect(byKey["X-Frame-Options"]).toBe("DENY");
    expect(byKey["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(byKey["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(byKey["X-Content-Type-Options"]).toBe("nosniff");
    expect(byKey["Permissions-Policy"]).toContain("camera=(self)");
    // Ingen skriptregler ennå: de kan stoppe Next.js og PDF-ene (se docs/funksjoner/sikkerhet.md)
    expect(byKey["Content-Security-Policy"]).not.toContain("script-src");
  });
});
