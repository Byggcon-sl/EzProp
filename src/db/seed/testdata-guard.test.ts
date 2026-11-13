import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LOCAL_DATABASE_HOSTS, TEST_DATABASE_HOST } from "@/shared/config/database-hosts";
import { resetEnvCache } from "@/shared/config/env";
import { LOCAL_HOSTS } from "../../../e2e/database-guard";
import { TestdataNotAllowedError, assertTestdataAllowed } from "./testdata-guard";

/*
 * Produksjonsvakten for testdata (A302). Testplan
 * docs/funksjoner/fase2a-testdata-arbeidshverdag-testplan.md, seksjon 3. Ren: ingen databasekall.
 * Alle adresser, brukernavn og passord er oppdiktet.
 */

const env = process.env as Record<string, string | undefined>;
const USER = "oppdiktetbruker";
const PASSWORD = "hemmelig-pw-123";
const DATABASE = "oppdiktetdb";

function urlWithHost(host: string, query = ""): string {
  return `postgres://${USER}:${PASSWORD}@${host}:5432/${DATABASE}${query}`;
}

let saved: { app?: string; url?: string };

beforeEach(() => {
  saved = { app: env.APP_ENVIRONMENT, url: env.DATABASE_URL };
  env.APP_ENVIRONMENT = "test";
  resetEnvCache();
});

afterEach(() => {
  if (saved.app === undefined) delete env.APP_ENVIRONMENT;
  else env.APP_ENVIRONMENT = saved.app;
  if (saved.url === undefined) delete env.DATABASE_URL;
  else env.DATABASE_URL = saved.url;
  resetEnvCache();
});

function setUrl(url: string | undefined) {
  if (url === undefined) delete env.DATABASE_URL;
  else env.DATABASE_URL = url;
  resetEnvCache();
}

/** Feilen fra vakten. Feiler testen hvis vakten ikke kaster. */
function guardError(): TestdataNotAllowedError {
  try {
    assertTestdataAllowed();
  } catch (error) {
    expect(error).toBeInstanceOf(TestdataNotAllowedError);
    return error as TestdataNotAllowedError;
  }
  throw new Error("vakten kastet ikke");
}

/** Meldingen er norsk og viser ingen del av adressen. */
function expectSafeMessage(error: Error, url: string | undefined, host?: string) {
  expect(error.message).toMatch(/^Testdata kan /);
  expect(error.message).not.toContain(USER);
  expect(error.message).not.toContain(PASSWORD);
  expect(error.message).not.toContain(DATABASE);
  if (url) expect(error.message).not.toContain(url);
  if (host) {
    expect(error.message.toLowerCase()).not.toContain(host.toLowerCase());
    expect(error.message).not.toContain("postgres.database.azure.com");
  }
}

describe("assertTestdataAllowed: APP_ENVIRONMENT (3.1)", () => {
  beforeEach(() => setUrl(urlWithHost("localhost")));

  it.each(["development", "test"])("3.1.1 godtar %j", (value) => {
    env.APP_ENVIRONMENT = value;
    expect(() => assertTestdataAllowed()).not.toThrow();
  });

  it.each([
    ["production", "production"],
    ["tom", ""],
    ["manglende", undefined],
    ["Production", "Production"],
    ["TEST", "TEST"],
    ["mellomrom rundt", " test "],
    ["linjeskift til slutt", "test\n"],
    ["staging", "staging"],
    ["dev", "dev"],
  ])("3.1.2 stopper %s", (_name, value) => {
    if (value === undefined) delete env.APP_ENVIRONMENT;
    else env.APP_ENVIRONMENT = value;
    const error = guardError();
    expect(error.message).toContain("APP_ENVIRONMENT");
    expectSafeMessage(error, urlWithHost("localhost"), "localhost");
  });

  it("sjekker miljøet før adressen (produksjon med lokal vert stopper)", () => {
    env.APP_ENVIRONMENT = "production";
    setUrl(urlWithHost("localhost"));
    expect(guardError().message).toContain("APP_ENVIRONMENT");
  });
});

describe("assertTestdataAllowed: verten i DATABASE_URL (3.2)", () => {
  it.each(["localhost", "127.0.0.1", "[::1]", TEST_DATABASE_HOST])("3.2.3 godtar %s", (host) => {
    setUrl(urlWithHost(host, "?sslmode=verify-full"));
    expect(() => assertTestdataAllowed()).not.toThrow();
  });

  it("3.2.8 godtar testverten med store bokstaver (samme server)", () => {
    setUrl(urlWithHost("PSQL-EZPROP-TEST.postgres.database.azure.com"));
    expect(() => assertTestdataAllowed()).not.toThrow();
  });

  it.each([
    ["3.2.4 test-prod", "psql-ezprop-test-prod.postgres.database.azure.com"],
    ["3.2.5 feil domene", "psql-ezprop-test.example.com"],
    ["3.2.6 produksjon", "psql-ezprop-prod.postgres.database.azure.com"],
    ["3.2.7 produksjon med store bokstaver", "PSQL-EZPROP-PROD.postgres.database.azure.com"],
    ["3.2.12 testverten med tillegg", "psql-ezprop-test.postgres.database.azure.com.evil.no"],
    ["3.2.12 testverten med punktum til slutt", "psql-ezprop-test.postgres.database.azure.com."],
    ["3.2.12 localhost med punktum til slutt", "localhost."],
    ["annen vert", "db.eksempel.no"],
  ])("%s stopper", (_name, host) => {
    const url = urlWithHost(host);
    setUrl(url);
    const error = guardError();
    expectSafeMessage(error, url, host);
    expect(error.message).not.toContain("psql-ezprop");
  });

  it.each([
    ["komma", "localhost,psql-ezprop-prod.postgres.database.azure.com"],
    ["prosentkodet komma", "localhost%2Cpsql-ezprop-prod.postgres.database.azure.com"],
    [
      "komma etter testverten",
      `${TEST_DATABASE_HOST},psql-ezprop-prod.postgres.database.azure.com`,
    ],
  ])("3.2.9 stopper flere verter (%s)", (_name, host) => {
    const url = urlWithHost(host);
    setUrl(url);
    const error = guardError();
    expectSafeMessage(error, url, "psql-ezprop-prod.postgres.database.azure.com");
  });

  it.each([
    ["kan ikke tolkes", "ikke en adresse"],
    ["uten vert", `postgres://${USER}:${PASSWORD}@/${DATABASE}`],
    ["ugyldig prosentkoding", `postgres://${USER}:${PASSWORD}@local%ZZhost/${DATABASE}`],
  ])("3.2.10 stopper adresse som %s", (_name, url) => {
    setUrl(url);
    expectSafeMessage(guardError(), url);
  });

  it.each([
    ["tom", ""],
    ["manglende", undefined],
  ])("3.2.10 stopper %s DATABASE_URL med egen melding", (_name, url) => {
    setUrl(url);
    const error = guardError();
    expect(error.message).toMatch(/^Testdata kan ikke legges inn fordi miljøvariablene/);
  });

  it.each([
    ["?host=", "?host=psql-ezprop-prod.postgres.database.azure.com"],
    ["?PGHOST=", "?PGHOST=psql-ezprop-prod.postgres.database.azure.com"],
    ["?Host= blant andre", "?sslmode=require&Host=psql-ezprop-prod.postgres.database.azure.com"],
    ["?pghost=", "?pghost=psql-ezprop-prod.postgres.database.azure.com"],
  ])("3.2.11 stopper %s i spørredelen, også med lokal vert foran", (_name, query) => {
    for (const host of ["localhost", TEST_DATABASE_HOST]) {
      const url = urlWithHost(host, query);
      setUrl(url);
      expectSafeMessage(guardError(), url, "psql-ezprop-prod.postgres.database.azure.com");
    }
  });

  it("3.2.13 leser samme verdi som klienten (getEnv().DATABASE_URL)", () => {
    const source = readFileSync(join(process.cwd(), "src/db/seed/testdata-guard.ts"), "utf8");
    const client = readFileSync(join(process.cwd(), "src/db/client.ts"), "utf8");
    expect(client).toContain("getEnv().DATABASE_URL");
    expect(source).toContain("getEnv().DATABASE_URL");
    expect(source).not.toMatch(/process\.env\.DATABASE_URL|process\.env\[["']DATABASE_URL/);
    // Ugyldig verdi i miljøet gir stopp, selv om en gyldig verdi var lest før.
    setUrl(urlWithHost("localhost"));
    expect(() => assertTestdataAllowed()).not.toThrow();
    setUrl("ikke en adresse");
    expect(() => assertTestdataAllowed()).toThrow(TestdataNotAllowedError);
  });

  it("3.2.13 stopper med egen melding når getEnv kaster, uten verdiene", () => {
    const secret = env.BETTER_AUTH_SECRET;
    env.BETTER_AUTH_SECRET = "for-kort";
    setUrl(urlWithHost("localhost"));
    try {
      const error = guardError();
      expect(error.message).toMatch(/^Testdata kan ikke legges inn fordi miljøvariablene/);
      expect(error.message).not.toContain("for-kort");
      expectSafeMessage(error, urlWithHost("localhost"), "localhost");
    } finally {
      env.BETTER_AUTH_SECRET = secret;
      resetEnvCache();
    }
  });

  it("3.2.14 LOCAL_HOSTS er felles med e2e-vakten", () => {
    expect(LOCAL_HOSTS).toBe(LOCAL_DATABASE_HOSTS);
    expect([...LOCAL_DATABASE_HOSTS].sort()).toEqual(["127.0.0.1", "[::1]", "localhost"]);
    const e2eGuard = readFileSync(join(process.cwd(), "e2e/database-guard.ts"), "utf8");
    const guard = readFileSync(join(process.cwd(), "src/db/seed/testdata-guard.ts"), "utf8");
    expect(e2eGuard).toMatch(
      /import \{ LOCAL_DATABASE_HOSTS \} from "[^"]*shared\/config\/database-hosts"/,
    );
    expect(e2eGuard).not.toMatch(/new Set\(\[/);
    expect(guard).toMatch(/LOCAL_DATABASE_HOSTS[^"]*from "@\/shared\/config\/database-hosts"/s);
    expect(guard).not.toMatch(/new Set\(\["localhost"/);
  });

  it("testverten er den samme som Bicep gir for environmentName test", () => {
    const bicep = readFileSync(join(process.cwd(), "infra/azure/main.bicep"), "utf8");
    expect(bicep).toContain("var postgresServerName = 'psql-ezprop-${environmentName}'");
    expect(TEST_DATABASE_HOST).toBe("psql-ezprop-test.postgres.database.azure.com");
  });
});
