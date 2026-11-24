import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auth, CLOSED_PATHS, isClosedAuthPath } from "./auth";

/*
 * Vakttester for auth-oppsettet (docs/funksjoner/fase2a-mine-innlogginger-testplan.md avsnitt 3).
 * Utlogging i «Mine innlogginger» sletter økten i `sessions`. Det virker bare så lenge Better Auth
 * slår opp økten der ved hver forespørsel. Støtter hovedmål: de ansatte (en mistet iPad er
 * logget ut med en gang).
 */

const SESSION_PATHS = [
  "/list-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
];

describe("auth-oppsettet for økter", () => {
  it.each(SESSION_PATHS)("%s er stengt", (p) => {
    expect(CLOSED_PATHS).toContain(p);
    expect(isClosedAuthPath(p)).toBe(true);
  });

  it("/get-session og /sign-out er ikke stengt", () => {
    expect(isClosedAuthPath("/get-session")).toBe(false);
    expect(isClosedAuthPath("/sign-out")).toBe(false);
  });

  it("ingen økt-cache: ellers ville en tilbakekalt økt levd videre", () => {
    const options = auth.options as {
      session?: { cookieCache?: { enabled?: boolean } };
      secondaryStorage?: unknown;
    };
    expect(
      options.session?.cookieCache?.enabled,
      "session.cookieCache er slått på: en utlogget økt ville levd videre til cachen går ut",
    ).not.toBe(true);
    expect(
      options.secondaryStorage,
      "secondaryStorage er lagt til: en utlogget økt ville levd videre der",
    ).toBeUndefined();
  });

  it("updateAge er 24 timer og expiresIn 30 dager (uendret)", () => {
    expect(auth.options.session?.updateAge).toBe(60 * 60 * 24);
    expect(auth.options.session?.expiresIn).toBe(60 * 60 * 24 * 30);
  });

  it("serverkall til en stengt sti avvises også (hooks.before gjelder auth.api.*)", async () => {
    await expect(auth.api.listSessions({ headers: new Headers() })).rejects.toMatchObject({
      status: "NOT_FOUND",
    });
  });

  it.each(["sessions-list.ts", "user-agent.ts"])("%s importerer ikke KI-modulen", (file) => {
    const source = readFileSync(path.join(__dirname, file), "utf8");
    expect(source).not.toMatch(/from "@\/core\/ai/);
    expect(source).not.toMatch(/from "\.\/auth"/);
  });
});
