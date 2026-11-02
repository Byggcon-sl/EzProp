import { describe, expect, it } from "vitest";
import { createLogger, formatLogLine, REDACTED, scrubText } from "./logger";

describe("logger", () => {
  it("skriver én JSON-linje med nivå, tid, melding, rute, bruker-id og referanse", () => {
    const lines: [string, string][] = [];
    const log = createLogger((level, line) => lines.push([level, line]));
    log.error("Uventet feil", {
      route: "/styre/[organizationId]",
      userId: "user-1",
      ref: "K7QF3M",
      error: new Error("Boom"),
    });
    expect(lines).toHaveLength(1);
    const [level, line] = lines[0]!;
    expect(level).toBe("error");
    expect(line).not.toContain("\n");
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({
      level: "error",
      msg: "Uventet feil",
      route: "/styre/[organizationId]",
      userId: "user-1",
      ref: "K7QF3M",
      error: { name: "Error", message: "Boom" },
    });
    expect(new Date(parsed.time).toString()).not.toBe("Invalid Date");
  });

  it("fjerner følsomme felt (e-post, navn, telefon, passord, token, cookie)", () => {
    const line = formatLogLine("info", "Test", {
      userId: "user-1",
      email: "kari@example.com",
      name: "Kari Nordmann",
      phone: "+47 912 34 567",
      password: "hemmelig",
      accessToken: "abc",
      headers: { cookie: "session=abc" },
      nested: { epost: "ola@example.com", Authorization: "Bearer xyz", count: 3 },
    });
    expect(line).toMatchObject({
      userId: "user-1",
      email: REDACTED,
      name: REDACTED,
      phone: REDACTED,
      password: REDACTED,
      accessToken: REDACTED,
      headers: REDACTED,
      nested: { epost: REDACTED, Authorization: REDACTED, count: 3 },
    });
    const text = JSON.stringify(line);
    for (const secret of ["kari@example.com", "Kari Nordmann", "hemmelig", "session=abc", "xyz"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("vasker e-post, telefon, tokener og databaseparametre ut av tekst og feilmeldinger", () => {
    expect(scrubText("Kunne ikke sende til kari@example.com")).toBe(
      "Kunne ikke sende til [e-post]",
    );
    expect(scrubText("Ring +47 91234567 eller 12 34 56 78")).toBe("Ring [telefon] eller [telefon]");
    expect(scrubText("Authorization: Bearer abc.def-123")).toBe(
      `Authorization: Bearer ${REDACTED}`,
    );
    const dbError = new Error(
      'Failed query: insert into "users" ("email") values ($1)\nparams: kari@example.com,Kari',
    );
    const line = formatLogLine("error", "Feil", { error: dbError });
    const text = JSON.stringify(line);
    expect(text).not.toContain("kari@example.com");
    expect(text).not.toContain("Kari");
    expect(text).toContain("Failed query");
  });

  it("korter ned lange tekster", () => {
    expect(scrubText("x".repeat(2000)).length).toBeLessThan(510);
  });

  // Testplan: docs/funksjoner/fase0b-filtjeneste-testplan.md, avsnitt 5 (Azure-hemmeligheter).
  // Verdiene er oppdiktet.
  it("vasker nøkkelen ut av en Azure-tilkoblingsstreng", () => {
    const text = scrubText(
      "DefaultEndpointsProtocol=https;AccountName=fiktiv;AccountKey=fiktivNokkel==;EndpointSuffix=core.windows.net",
    );
    expect(text).not.toContain("fiktivNokkel");
    expect(text).toContain("AccountName=fiktiv");
    expect(text).toContain("EndpointSuffix=core.windows.net");
  });

  it("vasker SAS i tekst og i adresser, resten av adressen kan stå", () => {
    const sasText = scrubText("SharedAccessSignature=sv=2024&sig=abc;BlobEndpoint=x");
    expect(sasText).not.toContain("abc");

    const url = scrubText(
      "https://fiktiv.blob.core.windows.net/c/b?sv=2024&sig=abc%2B123&se=2026 feilet",
    );
    expect(url).not.toContain("abc%2B123");
    expect(url).not.toContain("abc");
    expect(url).toContain("https://fiktiv.blob.core.windows.net/c/b?");
  });

  it("fjerner Azure-nøkler i objekter", () => {
    const line = formatLogLine("error", "Test", {
      connectionString: "AccountKey=fiktivNokkel==",
      CONNECTION_STRING: "fiktiv-tilkobling",
      nested: { accountKey: "fiktivNokkel==", "account-key": "fiktivNokkel2==", sas: "sv=1" },
    });
    expect(line).toMatchObject({
      connectionString: REDACTED,
      CONNECTION_STRING: REDACTED,
      nested: { accountKey: REDACTED, "account-key": REDACTED, sas: REDACTED },
    });
    const text = JSON.stringify(line);
    for (const secret of ["fiktivNokkel", "fiktiv-tilkobling", "sv=1"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("vasker ikke for mye: nøkkelen sasquatch og teksten signatur står urørt", () => {
    const line = formatLogLine("info", "Mangler signatur", {
      sasquatch: "stor fot",
      note: "signatur",
    });
    expect(line).toMatchObject({
      msg: "Mangler signatur",
      sasquatch: "stor fot",
      note: "signatur",
    });
    expect(scrubText("Rapporten mangler signatur")).toBe("Rapporten mangler signatur");
  });

  it("velter aldri det den logger fra", () => {
    const log = createLogger(() => {
      throw new Error("disken er full");
    });
    expect(() => log.error("Feil")).not.toThrow();
  });
});

// Filtjenesten (docs/funksjoner/fase0b-filtjeneste-testplan.md avsnitt 5). Verdiene er oppdiktet.
describe("logger vasker Azure-hemmeligheter", () => {
  it("1. tilkoblingsstreng: AccountKey fjernes", () => {
    const text = scrubText(
      "DefaultEndpointsProtocol=https;AccountName=fiktiv;AccountKey=fiktivNokkel==;EndpointSuffix=core.windows.net",
    );
    expect(text).not.toContain("fiktivNokkel");
  });

  it("2. SAS: SharedAccessSignature og sig= i adresser fjernes", () => {
    const sas = scrubText("SharedAccessSignature=sv=2024&sig=abc;");
    expect(sas).not.toContain("abc");
    const url = scrubText("https://fiktiv.blob.core.windows.net/c/b?sv=2024&sig=abc%2B123&se=2026");
    expect(url).not.toContain("abc%2B123");
    expect(url).not.toContain("abc");
  });

  it("3. nøkler i objekter: connectionString, CONNECTION_STRING, accountKey, account-key og sas", () => {
    const line = formatLogLine("info", "Test", {
      connectionString: "a",
      CONNECTION_STRING: "b",
      accountKey: "c",
      "account-key": "d",
      sas: "e",
    });
    expect(line.connectionString).toBe(REDACTED);
    expect(line.CONNECTION_STRING).toBe(REDACTED);
    expect(line.accountKey).toBe(REDACTED);
    expect(line["account-key"]).toBe(REDACTED);
    expect(line.sas).toBe(REDACTED);
  });

  it("4. ingen overvasking: sasquatch og signatur står urørt", () => {
    const line = formatLogLine("info", "Test", { sasquatch: "stor fot" });
    expect(line.sasquatch).toBe("stor fot");
    expect(scrubText("signatur")).toBe("signatur");
  });
});
