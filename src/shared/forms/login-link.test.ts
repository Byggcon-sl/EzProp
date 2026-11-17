import { describe, expect, it } from "vitest";
import { loginHref } from "./login-link";

/*
 * Lenken «Logg inn» fra et skjema (testplan 1b, T-0070). `neste` tas bare med når stien er
 * godkjent, og aldri med spørrestreng, så lenken aldri bærer søketekst eller navn.
 * Støtter hovedmål: de ansatte (tilbake til samme side), og ingen persondata i adressen.
 */

const ID = "3f2b8c1e-5a4d-4e7f-9b1c-2d3e4f5a6b7c";

describe("loginHref", () => {
  it("tar med en godkjent sti, kodet", () => {
    expect(loginHref(`/oppdrag/${ID}/bygninger`)).toBe(
      `/logg-inn?neste=%2Foppdrag%2F${ID}%2Fbygninger`,
    );
    expect(loginHref(`/oppdrag/${ID}`)).toBe(`/logg-inn?neste=%2Foppdrag%2F${ID}`);
  });

  it.each(["//evil.example", "/logg-inn", "/api/auth/get-session", "", "/", "/Arbeidskoe"])(
    "gir /logg-inn uten neste for %j",
    (path) => {
      expect(loginHref(path)).toBe("/logg-inn");
    },
  );

  it("tar aldri med spørrestreng eller navn", () => {
    const href = loginHref("/arbeidskoe?q=Oppdiktet%20Navn");
    expect(href).toBe("/logg-inn");
    expect(href).not.toContain("q=");
    expect(href).not.toContain("Oppdiktet");
  });
});
