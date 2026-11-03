import { describe, expect, it } from "vitest";
import { createLogger, formatLogLine, REDACTED, sanitizeFields, scrubText } from "./logger";

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

  it("1b. Client_Secret= vaskes uansett store og små bokstaver, skrivemåten beholdes", () => {
    expect(scrubText("Client_Secret=abc")).toBe(`Client_Secret=${REDACTED}`);
  });

  it("1c. CLIENT_SECRET= vaskes, resten av strengen står", () => {
    expect(scrubText("CLIENT_SECRET=abc&x=1")).toBe(`CLIENT_SECRET=${REDACTED}&x=1`);
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

// Småfunn (o) og (p) (docs/agenter/oppgaver/fase0b-smafunn-filtjeneste-tilkobling-testplan.md
// avsnitt 1). Feltnavn som SLUTTER på et følsomt ord fjernes, også med prefiks. Oppdiktede verdier.
describe("logger vasker feltnavn med prefiks", () => {
  const VALUE = "oppdiktet-verdi";

  it("P1. FILE_STORAGE_AZURE_CONNECTION_STRING fjernes", () => {
    expect(sanitizeFields({ FILE_STORAGE_AZURE_CONNECTION_STRING: VALUE })).toEqual({
      FILE_STORAGE_AZURE_CONNECTION_STRING: REDACTED,
    });
  });

  it("P2. fileStorageAzureConnectionString (camelCase) fjernes", () => {
    expect(sanitizeFields({ fileStorageAzureConnectionString: VALUE })).toEqual({
      fileStorageAzureConnectionString: REDACTED,
    });
  });

  it("P3. MS_GRAPH_CLIENT_SECRET fjernes", () => {
    expect(sanitizeFields({ MS_GRAPH_CLIENT_SECRET: VALUE })).toEqual({
      MS_GRAPH_CLIENT_SECRET: REDACTED,
    });
  });

  it("P4. MS_GRAPH_ACCESS_TOKEN fjernes", () => {
    expect(sanitizeFields({ MS_GRAPH_ACCESS_TOKEN: VALUE })).toEqual({
      MS_GRAPH_ACCESS_TOKEN: REDACTED,
    });
  });

  it.each(["secretRef", "secret_ref", "clientId", "client_id"])(
    "P5. %s står urørt (mønsteret er «slutter på», ikke «inneholder»)",
    (key) => {
      expect(sanitizeFields({ [key]: "MS_GRAPH_CLIENT_SECRET" })).toEqual({
        [key]: "MS_GRAPH_CLIENT_SECRET",
      });
    },
  );

  it("P6. nøkkel dypt i et objekt fjernes", () => {
    const line = formatLogLine("info", "Test", {
      config: { storage: { FILE_STORAGE_AZURE_CONNECTION_STRING: VALUE, container: "filer" } },
    });
    expect(line.config).toEqual({
      storage: { FILE_STORAGE_AZURE_CONNECTION_STRING: REDACTED, container: "filer" },
    });
    expect(JSON.stringify(line)).not.toContain(VALUE);
  });
});

// Småfunn (r) 5 (docs/agenter/oppgaver/fase0b-smafunn-r-s-testplan.md avsnitt 1). De elleve
// ordene som tas ut som eksakte alternativer i SENSITIVE_KEY, skal fortsatt vaskes av
// «slutter på»-alternativet, både eksakt og med prefiks. Oppdiktede verdier.
describe("de elleve ordene vaskes fortsatt etter at de eksakte alternativene er tatt ut", () => {
  it.each([
    "password",
    "passord",
    "secret",
    "clientSecret",
    "token",
    "accessToken",
    "refreshToken",
    "sessionToken",
    "apiKey",
    "connectionString",
    "accountKey",
  ])("E1. %s fjernes", (key) => {
    expect(formatLogLine("info", "Test", { [key]: "x" })[key]).toBe(REDACTED);
  });

  it.each([
    ["userPassword", "USER_PASSWORD"],
    ["userPassord", "USER_PASSORD"],
    ["appSecret", "APP_SECRET"],
    ["msClientSecret", "MS_CLIENT_SECRET"],
    ["myToken", "MY_TOKEN"],
    ["graphAccessToken", "GRAPH_ACCESS_TOKEN"],
    ["graphRefreshToken", "GRAPH_REFRESH_TOKEN"],
    ["userSessionToken", "USER_SESSION_TOKEN"],
    ["xApiKey", "X_API_KEY"],
    ["dbConnectionString", "DB_CONNECTION_STRING"],
    ["storageAccountKey", "STORAGE_ACCOUNT_KEY"],
  ])("E2. %s og %s fjernes", (camel, snake) => {
    const line = formatLogLine("info", "Test", { [camel]: "x", [snake]: "x" });
    expect(line[camel]).toBe(REDACTED);
    expect(line[snake]).toBe(REDACTED);
  });

  it.each(["tokens", "secretRef", "secret_ref", "passordHint", "apiKeys"])(
    "E3. %s står urørt (ingen overvasking)",
    (key) => {
      expect(formatLogLine("info", "Test", { [key]: "x" })[key]).toBe("x");
    },
  );
});
