import { describe, expect, it } from "vitest";
import { assertLocalOrTestDatabase } from "../e2e/database-guard";

// Testplan docs/agenter/oppgaver/fase1-smafunn-synkstatus-testplan.md avsnitt 2 (G1–G7).
// Alle adresser og passord er oppdiktet.

/** Feilen fra vakten, så meldingen kan sjekkes. Feiler testen hvis vakten ikke kaster. */
function guardError(url: string, testUrl: string | undefined): Error {
  try {
    assertLocalOrTestDatabase(url, testUrl);
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }
  throw new Error("vakten kastet ikke");
}

const TEST_URL = "postgres://testbruker:test-pw@testdb.eksempel.no:5432/ezprop_test";

describe("assertLocalOrTestDatabase", () => {
  it.each([
    "postgres://u:p@localhost:5432/x",
    "postgres://u:p@127.0.0.1:5432/x",
    "postgres://u:p@[::1]:5432/x",
  ])("G1: godtar localhost, 127.0.0.1 og [::1] (%s)", (url) => {
    expect(() => assertLocalOrTestDatabase(url, undefined)).not.toThrow();
    expect(() => assertLocalOrTestDatabase(url, TEST_URL)).not.toThrow();
  });

  it("G2: godtar nøyaktig TEST_DATABASE_URL", () => {
    expect(() => assertLocalOrTestDatabase(TEST_URL, TEST_URL)).not.toThrow();
  });

  it("G3: annen vert kaster uten å vise vert eller passord", () => {
    const url = "postgres://u:hemmelig-pw@db.eksempel.no/x";
    const { message } = guardError(url, TEST_URL);
    expect(message).not.toContain("hemmelig-pw");
    expect(message).not.toContain("db.eksempel.no");
    expect(message).not.toContain(url);
  });

  it("G4: adresse som ikke kan leses kaster uten å vise adressen", () => {
    const { message } = guardError("ikke-en-adresse-hemmelig", TEST_URL);
    expect(message).not.toContain("ikke-en-adresse-hemmelig");
    expect(message).not.toContain("hemmelig");
  });

  it("G5: localhost.eksempel.no kaster", () => {
    const { message } = guardError("postgres://u:p@localhost.eksempel.no:5432/x", TEST_URL);
    expect(message).not.toContain("localhost.eksempel.no");
  });

  it.each([
    ["annet databasenavn", "postgres://testbruker:test-pw@testdb.eksempel.no:5432/ezprop"],
    ["annet passord", "postgres://testbruker:annet-pw@testdb.eksempel.no:5432/ezprop_test"],
  ])("G6: nesten lik TEST_DATABASE_URL kaster (%s)", (_name, url) => {
    const { message } = guardError(url, TEST_URL);
    expect(message).not.toContain("testdb.eksempel.no");
    expect(message).not.toContain("test-pw");
    expect(message).not.toContain("annet-pw");
  });

  it.each([undefined, ""])("G7: tom testUrl godtar ikke ekstern vert (%s)", (testUrl) => {
    guardError("postgres://u:p@db.eksempel.no/x", testUrl);
  });
});
