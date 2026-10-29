/**
 * Vakten i e2e: `ensureInspector` skriver bare til lokal database eller testdatabasen
 * (docs/agenter/oppgaver/fase1-smafunn-synkstatus.md pkt. 2a, testplanen avsnitt 2).
 * Oppdiktede adresser og passord.
 */
import { describe, expect, it } from "vitest";
import { assertLocalOrTestDatabase } from "../e2e/database-guard";

const TEST_URL = "postgres://testbruker:test-pw-oppdiktet@ci-db.eksempel.no:5432/ezprop_test";

/** Kaster `Error`, og meldingen inneholder ingen av de hemmelige delene. */
function expectThrowsWithout(url: string, testUrl: string | undefined, secrets: string[]) {
  let caught: unknown;
  try {
    assertLocalOrTestDatabase(url, testUrl);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  const message = (caught as Error).message;
  expect(message.length).toBeGreaterThan(0);
  for (const secret of [url, ...secrets]) expect(message).not.toContain(secret);
}

describe("assertLocalOrTestDatabase", () => {
  it.each([
    "postgres://u:p@localhost:5432/x",
    "postgres://u:p@127.0.0.1:5432/x",
    "postgres://u:p@[::1]:5432/x",
  ])("godtar localhost, 127.0.0.1 og [::1] (%s)", (url) => {
    expect(() => assertLocalOrTestDatabase(url, undefined)).not.toThrow();
    expect(() => assertLocalOrTestDatabase(url, TEST_URL)).not.toThrow();
  });

  it("godtar nøyaktig TEST_DATABASE_URL", () => {
    expect(() => assertLocalOrTestDatabase(TEST_URL, TEST_URL)).not.toThrow();
  });

  it("annen vert kaster uten å vise vert eller passord", () => {
    expectThrowsWithout("postgres://u:hemmelig-pw@db.eksempel.no/x", TEST_URL, [
      "hemmelig-pw",
      "db.eksempel.no",
    ]);
  });

  it("adresse som ikke kan leses kaster uten å vise adressen", () => {
    expectThrowsWithout("ikke-en-adresse-hemmelig", TEST_URL, ["hemmelig"]);
  });

  it("localhost.eksempel.no kaster", () => {
    expectThrowsWithout("postgres://u:hemmelig-pw@localhost.eksempel.no:5432/x", TEST_URL, [
      "hemmelig-pw",
      "localhost.eksempel.no",
    ]);
  });

  it("nesten lik TEST_DATABASE_URL kaster", () => {
    // Samme vert, annet databasenavn
    expectThrowsWithout(
      "postgres://testbruker:test-pw-oppdiktet@ci-db.eksempel.no:5432/ezprop",
      TEST_URL,
      ["test-pw-oppdiktet", "ci-db.eksempel.no"],
    );
    // Samme vert og database, annet passord
    expectThrowsWithout(
      "postgres://testbruker:annet-pw@ci-db.eksempel.no:5432/ezprop_test",
      TEST_URL,
      ["annet-pw", "ci-db.eksempel.no"],
    );
  });

  it.each([undefined, ""])("tom testUrl godtar ikke ekstern vert (%s)", (testUrl) => {
    expectThrowsWithout("postgres://u:hemmelig-pw@db.eksempel.no/x", testUrl, [
      "hemmelig-pw",
      "db.eksempel.no",
    ]);
  });
});
