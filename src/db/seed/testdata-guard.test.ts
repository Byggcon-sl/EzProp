import { describe, expect, it } from "vitest";
import { TestdataGuardError, assertTestdataAllowed } from "./testdata-guard";

/*
 * Produksjonsvakten for `pnpm db:seed:testdata` (A302). Testplan:
 * docs/funksjoner/fase2a-testdata-arbeidshverdag-testplan.md avsnitt 2. Ren funksjon, ingen database.
 *
 * Støtter hovedmål: de ansatte (ekte data i produksjon blandes aldri med oppdiktede) og færre
 * reklamasjoner (en rapport i drift kan aldri få testdata ved en feil).
 */

const LOCAL_URL = "postgres://ezprop:ezprop@localhost:5432/ezprop";
const AZURE_TEST_URL =
  "postgres://ezprop:hemmelig@psql-ezprop-test.postgres.database.azure.com:5432/ezprop?sslmode=require";
const SECRET_URL =
  "postgres://hemmeligbruker:hemmeligpassord@psql-ezprop-prod.postgres.database.azure.com:5432/ezprop";
const SECRET_PARTS = [
  "hemmeligbruker",
  "hemmeligpassord",
  "psql-ezprop-prod",
  "postgres.database.azure.com",
  SECRET_URL,
];

function urlWithHost(host: string): string {
  return `postgres://ezprop:ezprop@${host}:5432/ezprop`;
}

function guardError(env: Record<string, string | undefined>): TestdataGuardError {
  try {
    assertTestdataAllowed(env);
  } catch (error) {
    expect(error).toBeInstanceOf(TestdataGuardError);
    return error as TestdataGuardError;
  }
  throw new Error("Vakten stoppet ikke");
}

/** Alt i feilobjektet som kan havne i en logg: melding, stack, cause og egne felt. */
function everythingIn(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const own = Object.getOwnPropertyNames(error).map((key) => {
    const value = (error as unknown as Record<string, unknown>)[key];
    return key === "cause" ? everythingIn(value) : String(value);
  });
  return [error.message, error.stack ?? "", ...own].join("\n");
}

describe("assertTestdataAllowed", () => {
  describe("2.1 godtar development og test med lokal vert eller testserveren i Azure", () => {
    const hosts = [
      "localhost",
      "127.0.0.1",
      "[::1]",
      "psql-ezprop-test.postgres.database.azure.com",
    ];
    const cases = ["development", "test"].flatMap((environment) =>
      hosts.map((host) => [environment, host] as const),
    );
    it.each(cases)("APP_ENVIRONMENT=%s, vert %s", (environment, host) => {
      expect(() =>
        assertTestdataAllowed({ APP_ENVIRONMENT: environment, DATABASE_URL: urlWithHost(host) }),
      ).not.toThrow();
    });

    it("godtar adressen til testserveren slik utrullingen setter den (med sslmode)", () => {
      expect(() =>
        assertTestdataAllowed({ APP_ENVIRONMENT: "test", DATABASE_URL: AZURE_TEST_URL }),
      ).not.toThrow();
    });
  });

  describe("2.2 stopper på miljøet (lokal vert, så det er miljøet som stopper)", () => {
    const values: [string, string | undefined][] = [
      ["production", "production"],
      ["Production", "Production"],
      ["PRODUCTION", "PRODUCTION"],
      ["prod", "prod"],
      ["' test ' (mellomrom)", " test "],
      ["test med linjeskift", "test\n"],
      ["tom", ""],
      ["mangler", undefined],
      ["staging", "staging"],
      ["development,test", "development,test"],
      ["Test", "Test"],
      ["DEVELOPMENT", "DEVELOPMENT"],
    ];
    it.each(values)("APP_ENVIRONMENT %s", (_label, value) => {
      const error = guardError({ APP_ENVIRONMENT: value, DATABASE_URL: LOCAL_URL });
      expect(error.message).toContain("APP_ENVIRONMENT");
    });
  });

  describe("2.3 stopper på verten med APP_ENVIRONMENT=test", () => {
    const urls: [string, string | undefined][] = [
      ["psql-ezprop-prod", urlWithHost("psql-ezprop-prod.postgres.database.azure.com")],
      ["psql-ezprop (uten miljø)", urlWithHost("psql-ezprop.postgres.database.azure.com")],
      ["ezprop-test.example", urlWithHost("ezprop-test.example")],
      [
        "psql-ezprop-testprod (funn F3)",
        urlWithHost("psql-ezprop-testprod.postgres.database.azure.com"),
      ],
      ["localhost.evil.example", urlWithHost("localhost.evil.example")],
      ["10.0.0.5", urlWithHost("10.0.0.5")],
      ["ugyldig URL", "ikke en adresse"],
      ["tom", ""],
      ["mangler", undefined],
    ];
    it.each(urls)("vert %s", (_label, url) => {
      guardError({ APP_ENVIRONMENT: "test", DATABASE_URL: url });
    });
  });

  describe("2.4 NODE_ENV teller ikke", () => {
    it("NODE_ENV=production med APP_ENVIRONMENT=test og lokal vert godtas (testmiljøet i Azure)", () => {
      expect(() =>
        assertTestdataAllowed({
          NODE_ENV: "production",
          APP_ENVIRONMENT: "test",
          DATABASE_URL: LOCAL_URL,
        }),
      ).not.toThrow();
    });

    it("NODE_ENV=development med APP_ENVIRONMENT=production stopper", () => {
      guardError({
        NODE_ENV: "development",
        APP_ENVIRONMENT: "production",
        DATABASE_URL: LOCAL_URL,
      });
    });

    it("NODE_ENV=test uten APP_ENVIRONMENT stopper", () => {
      guardError({ NODE_ENV: "test", DATABASE_URL: LOCAL_URL });
    });
  });

  describe("2.5 meldingen", () => {
    it.each([
      ["miljøet", { APP_ENVIRONMENT: "production", DATABASE_URL: SECRET_URL }],
      ["verten", { APP_ENVIRONMENT: "test", DATABASE_URL: SECRET_URL }],
      [
        "ugyldig adresse",
        { APP_ENVIRONMENT: "test", DATABASE_URL: "hemmeligbruker:hemmeligpassord@" },
      ],
    ])("er norsk og lekker aldri adresse, vert, bruker eller passord (%s)", (_label, env) => {
      const error = guardError(env);
      expect(error.message).toMatch(/APP_ENVIRONMENT|database/i);
      // Norsk: minst ett vanlig norsk ord, og ikke en engelsk standardmelding
      expect(error.message).toMatch(/\b(bare|ikke|stoppet|testdata|ingenting)\b/i);
      expect(error.message).not.toMatch(/\b(only|not allowed|refusing|invalid)\b/i);
      const all = everythingIn(error);
      for (const part of SECRET_PARTS) expect(all).not.toContain(part);
    });

    it("feilen har navnet TestdataGuardError", () => {
      const error = guardError({ APP_ENVIRONMENT: "production", DATABASE_URL: LOCAL_URL });
      expect(error.name).toBe("TestdataGuardError");
    });
  });
});
