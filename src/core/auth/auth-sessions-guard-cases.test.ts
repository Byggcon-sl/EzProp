import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as authModule from "./auth";

/*
 * Vakttester for auth-oppsettet i «Mine innlogginger» (docs/funksjoner/fase2a-mine-innlogginger.md
 * Omfang 1, testplan avsnitt 3). Tilbakekalling er direkte sletting i `sessions`; det virker bare
 * så lenge Better Auth slår opp økten i databasen ved hver forespørsel. Better Auths egne
 * økt-endepunkter er stengt, så klienten aldri får token, IP eller rå user-agent, og all utlogging
 * går gjennom kjernen og loggen.
 *
 * Støtter hovedmål: de ansatte (en mistet iPad er logget ut med en gang, ikke etter en buffer)
 * og KI i bunnen (øktdata når aldri KI-porten).
 */

const SESSION_PATHS = [
  "/list-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
] as const;

const exported = authModule as unknown as {
  CLOSED_PATHS?: readonly string[];
  isClosedAuthPath?: (path: string, body?: unknown) => boolean;
};

function isClosed(route: string): boolean {
  if (typeof exported.isClosedAuthPath === "function") return exported.isClosedAuthPath(route);
  if (Array.isArray(exported.CLOSED_PATHS)) return exported.CLOSED_PATHS.includes(route);
  throw new Error(
    "auth.ts eksporterer verken CLOSED_PATHS eller isClosedAuthPath (testplanen, avtale om signaturer)",
  );
}

type SessionOptions = {
  expiresIn?: number;
  updateAge?: number;
  cookieCache?: { enabled?: boolean };
};

const options = authModule.auth.options as unknown as {
  session?: SessionOptions;
  secondaryStorage?: unknown;
};

describe("3.1 Better Auths økt-endepunkter er stengt", () => {
  it.each(SESSION_PATHS)("%s står blant de stengte stiene", (route) => {
    expect(isClosed(route)).toBe(true);
  });

  it("de stiene appen bruker, er fortsatt åpne", () => {
    for (const route of ["/get-session", "/sign-out", "/sign-in/email-otp"]) {
      expect(isClosed(route), route).toBe(false);
    }
  });
});

describe("3.2 ingen økt-cache", () => {
  it("cookieCache er ikke slått på", () => {
    expect(
      options.session?.cookieCache?.enabled === true,
      "session.cookieCache er slått på: en tilbakekalt økt ville da levd videre i kapselen",
    ).toBe(false);
  });

  it("secondaryStorage er ikke satt", () => {
    expect(
      options.secondaryStorage,
      "secondaryStorage er satt: en tilbakekalt økt ville da levd videre i lageret",
    ).toBeUndefined();
  });
});

describe("3.3 levetidene er uendret", () => {
  it("updateAge er 24 timer og expiresIn 30 dager", () => {
    expect(options.session?.updateAge).toBe(60 * 60 * 24);
    expect(options.session?.expiresIn).toBe(60 * 60 * 24 * 30);
  });
});

describe("3.4 ingen KI i funksjonen", () => {
  const root = process.cwd();

  function sourceFiles(dir: string): string[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return sourceFiles(full);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
    });
  }

  it("kjernefilene og profilsidene importerer ikke @/core/ai", () => {
    const files = [
      path.join(root, "src/core/auth/sessions-list.ts"),
      path.join(root, "src/core/auth/user-agent.ts"),
      ...sourceFiles(path.join(root, "src/app/(ansatt)/profil")),
    ];
    expect(existsSync(files[0]!), "src/core/auth/sessions-list.ts finnes").toBe(true);
    expect(existsSync(files[1]!), "src/core/auth/user-agent.ts finnes").toBe(true);
    expect(files.length, "profilsiden finnes").toBeGreaterThan(2);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, path.relative(root, file)).not.toMatch(/["']@\/core\/ai(\/[^"']*)?["']/);
    }
  });
});
