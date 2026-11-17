import { describe, expect, it } from "vitest";
import { loginHref } from "./login-link";

/*
 * Rett T-0070: lenken «Logg inn» fra et skjema (testplan
 * docs/agenter/oppgaver/rett-t0070-t0071-testplan.md avsnitt 1b). `neste` tas bare med når
 * `isSafeNextPath` godtar stien, og spørrestreng tas aldri med.
 *
 * Støtter hovedmål: de ansatte (tilbake til skjemaet uten JavaScript) og personvern (lenken bærer
 * aldri søketekst eller navn).
 */

const UUID = "0192f0c4-5d6e-7a8b-9c0d-1e2f3a4b5c6d";

describe("1b loginHref", () => {
  it("en trygg sti gir /logg-inn med kodet neste", () => {
    expect(loginHref(`/oppdrag/${UUID}/bygninger`)).toBe(
      `/logg-inn?neste=%2Foppdrag%2F${UUID}%2Fbygninger`,
    );
  });

  it("neste leses tilbake som den samme stien", () => {
    const href = loginHref(`/oppdrag/${UUID}`);
    const next = new URL(href, "https://ezprop.invalid").searchParams.get("neste");
    expect(next).toBe(`/oppdrag/${UUID}`);
  });

  it.each(["//evil.example", "/logg-inn", "/api/auth/get-session", "", "/"])(
    "%s gir /logg-inn uten neste",
    (path) => {
      expect(loginHref(path)).toBe("/logg-inn");
    },
  );

  it("en sti med søketekst gir /logg-inn uten neste, uten q= og uten navnet", () => {
    const href = loginHref("/arbeidskoe?q=Oppdiktet%20Navn");
    expect(href).toBe("/logg-inn");
    expect(href).not.toContain("q=");
    expect(href).not.toContain("Oppdiktet");
    expect(href).not.toContain("Navn");
  });
});
