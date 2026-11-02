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

// Tilkoblingslaget (docs/funksjoner/fase0b-tilkoblingslag-testplan.md avsnitt 9). Oppdiktede verdier.
describe("logger vasker Microsoft 365-hemmeligheter", () => {
  const SECRET = "hemmelig-test-verdi";

  it("1. client_secret= i tekst fjernes, resten av skjemaet står", () => {
    const text = scrubText(
      `grant_type=client_credentials&client_id=c&client_secret=${SECRET}&scope=x`,
    );
    expect(text).toContain(`client_secret=${REDACTED}`);
    expect(text).toContain("client_id=c");
    expect(text).toContain("scope=x");
    expect(text).not.toContain(SECRET);
  });

  it("2. client_secret= i en feilmelding fjernes fra logglinjen", () => {
    const lines: string[] = [];
    const log = createLogger((_level, line) => lines.push(line));
    log.error("x", { error: new Error(`token feilet: client_secret=${SECRET} avvist`) });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(SECRET);
  });

  it("3. nøklene clientSecret, client_secret og CLIENT_SECRET fjernes; secretRef og clientId står", () => {
    const line = formatLogLine("info", "Test", {
      clientSecret: SECRET,
      client_secret: SECRET,
      CLIENT_SECRET: SECRET,
      secretRef: "MS_GRAPH_CLIENT_SECRET",
      clientId: "c-oppdiktet",
    });
    expect(line.clientSecret).toBe(REDACTED);
    expect(line.client_secret).toBe(REDACTED);
    expect(line.CLIENT_SECRET).toBe(REDACTED);
    expect(line.secretRef).toBe("MS_GRAPH_CLIENT_SECRET");
    expect(line.clientId).toBe("c-oppdiktet");
    expect(JSON.stringify(line)).not.toContain(SECRET);
  });

  it("4. ingen overvasking: client_secret_name=… står urørt", () => {
    expect(scrubText("client_secret_name=MS_GRAPH_CLIENT_SECRET")).toBe(
      "client_secret_name=MS_GRAPH_CLIENT_SECRET",
    );
  });

  it("5. scrubText stopper ved mellomrom og ved &", () => {
    expect(scrubText("client_secret=abc def")).toBe(`client_secret=${REDACTED} def`);
    expect(scrubText("client_secret=abc&x=1")).toBe(`client_secret=${REDACTED}&x=1`);
  });
});
