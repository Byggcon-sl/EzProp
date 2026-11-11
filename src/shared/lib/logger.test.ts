import { readFileSync } from "node:fs";
import { join } from "node:path";
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

// Liten oppgave (r) 5: de elleve ordene er tatt ut som eksakte alternativ i SENSITIVE_KEY.
// «Slutter på»-alternativet skal fortsatt vaske dem, både eksakt og med prefiks.
describe("de elleve ordene vaskes fortsatt etter at de eksakte alternativene er tatt ut", () => {
  const VALUE = "oppdiktet-verdi";

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
  ])("E1. %s vaskes eksakt", (key) => {
    const line = formatLogLine("info", "Test", { [key]: VALUE });
    expect(line[key]).toBe(REDACTED);
    expect(JSON.stringify(line)).not.toContain(VALUE);
  });

  it.each([
    ["userPassword", "USER_PASSWORD"],
    ["userPassord", "USER_PASSORD"],
    ["graphSecret", "GRAPH_SECRET"],
    ["graphClientSecret", "GRAPH_CLIENT_SECRET"],
    ["graphToken", "GRAPH_TOKEN"],
    ["graphAccessToken", "GRAPH_ACCESS_TOKEN"],
    ["graphRefreshToken", "GRAPH_REFRESH_TOKEN"],
    ["userSessionToken", "USER_SESSION_TOKEN"],
    ["mapsApiKey", "MAPS_API_KEY"],
    ["dbConnectionString", "DB_CONNECTION_STRING"],
    ["storageAccountKey", "STORAGE_ACCOUNT_KEY"],
  ])("E2. %s og %s vaskes (prefiks, begge skrivemåter)", (camel, snake) => {
    expect(sanitizeFields({ [camel]: VALUE, [snake]: VALUE })).toEqual({
      [camel]: REDACTED,
      [snake]: REDACTED,
    });
  });

  it.each(["tokens", "secretRef", "secret_ref", "passordHint", "apiKeys"])(
    "E3. %s står urørt (ingen overvasking)",
    (key) => {
      expect(sanitizeFields({ [key]: VALUE })).toEqual({ [key]: VALUE });
    },
  );
});

// Vask før KI (docs/funksjoner/fase2a-vask-for-ki-testplan.md avsnitt 2). Verdiene er oppdiktet.
describe("loggeren bruker de samme mønstrene som vasken før KI", () => {
  it("V2.1 åtte sifre sammen, fødselsnummer og organisasjonsnummer vaskes i feilmelding og felt", () => {
    const error = new Error("Feil for 12345678, fnr 01019912345 og org 123456789");
    const line = formatLogLine("error", "Feil", {
      error,
      extra: { note: "Ring 87654321, fnr 010199 12345, NO 987654321 MVA" },
    });
    const text = JSON.stringify(line);
    for (const value of [
      "12345678",
      "87654321",
      "01019912345",
      "010199 12345",
      "123456789",
      "987654321",
    ]) {
      expect(text).not.toContain(value);
    }
    expect(line.error).toMatchObject({
      message: "Feil for [telefon], fnr [fødselsnummer] og org [organisasjonsnummer]",
    });
    expect(line.extra).toEqual({
      note: "Ring [telefon], fnr [fødselsnummer], [organisasjonsnummer]",
    });
  });

  it("V2.2 UUID, ISO-tid, feilkoder og HTTP-status står urørt", () => {
    const usageId = "3f2b8c1a-9d4e-4b7a-8c2d-1e5f6a7b8c9d";
    const ref = "12345678-1234-4234-8234-123456789012";
    const time = "2026-11-11T10:00:00.000Z";
    const line = formatLogLine("warn", "KI-kall feilet", {
      usageId,
      ref,
      at: time,
      errorCode: "unavailable",
      other: "unknown",
      status: 503,
      msg2: `HTTP 503 kl ${time} for ${usageId}`,
    });
    expect(line).toMatchObject({
      usageId,
      ref,
      at: time,
      errorCode: "unavailable",
      other: "unknown",
      status: 503,
      msg2: `HTTP 503 kl ${time} for ${usageId}`,
    });
  });

  it("V2.3 hemmeligheter vaskes før tallmønstrene", () => {
    expect(scrubText("AccountKey=12345678;EndpointSuffix=x")).toBe(
      `AccountKey=${REDACTED};EndpointSuffix=x`,
    );
    expect(scrubText("client_secret=12345678&x=1")).toBe(`client_secret=${REDACTED}&x=1`);
    expect(scrubText("Authorization: Bearer 12345678")).toBe(`Authorization: Bearer ${REDACTED}`);
    expect(scrubText("https://x.blob/a?sig=1234 5678")).not.toContain("[telefon]");
  });

  it("V2.4 adresse vaskes ikke i loggen", () => {
    expect(scrubText("Storgata 12, 8006 Bodø")).toBe("Storgata 12, 8006 Bodø");
  });

  it("V2.5 statisk: logger.ts importerer mønstrene og har ingen egen e-post- eller telefonregex", () => {
    const source = readFileSync(join(__dirname, "logger.ts"), "utf8");
    expect(source).toMatch(/from "\.\/pii-patterns"/);
    expect(source).not.toMatch(/const (EMAIL|PHONE)\b/);
    expect(source).not.toContain("@[");
    expect(source).not.toMatch(/\(\?:\\\+\|00\)47/);
  });
});

// Vask før KI (docs/funksjoner/fase2a-vask-for-ki-testplan.md avsnitt 2, ad-4, A169). Loggeren
// bruker de samme mønstrene som vasken før KI, men uten adresser. Verdiene er oppdiktet.
describe("loggeren bruker mønstrene fra pii-patterns.ts (V2)", () => {
  it.each([
    { name: "åtte sifre sammen", value: "12345678", placeholder: "[telefon]" },
    { name: "fødselsnummer", value: "01019912345", placeholder: "[fødselsnummer]" },
    { name: "organisasjonsnummer", value: "123456789", placeholder: "[organisasjonsnummer]" },
  ])("V2.1 $name vaskes i feilmelding, melding og felt i extra", ({ value, placeholder }) => {
    expect(scrubText(`Feil for ${value} i oppslaget`)).toBe(`Feil for ${placeholder} i oppslaget`);
    const line = formatLogLine("error", `Melding ${value}`, {
      note: `Feltet har ${value}`,
      nested: { detail: [`i en liste ${value}`] },
      error: new Error(`Kunne ikke lagre ${value}`),
    });
    const text = JSON.stringify(line);
    expect(text).not.toContain(value);
    expect(text).toContain(placeholder);
    expect(line.msg).toBe(`Melding ${placeholder}`);
    expect(line.note).toBe(`Feltet har ${placeholder}`);
  });

  it("V2.2 usageId, ref (UUID), ISO-tid, feilkoder og HTTP-status står urørt", () => {
    const usageId = "018f2b3c-4d5e-7f60-8a9b-0c1d2e3f4a5b";
    const digitsUuid = "12345678-1234-7123-8123-123456789012";
    const time = "2026-11-11T10:00:00.000Z";
    const line = formatLogLine("warn", "KI-kallet ga feil", {
      usageId,
      ref: digitsUuid,
      at: time,
      errorCode: "unavailable",
      fallback: "unknown",
      status: 503,
      statusText: "HTTP 503 etter 30000 ms",
    });
    expect(line.usageId).toBe(usageId);
    expect(line.ref).toBe(digitsUuid);
    expect(line.at).toBe(time);
    expect(line.errorCode).toBe("unavailable");
    expect(line.fallback).toBe("unknown");
    expect(line.status).toBe(503);
    expect(line.statusText).toBe("HTTP 503 etter 30000 ms");
    expect(scrubText(`ref ${usageId} kl ${time}`)).toBe(`ref ${usageId} kl ${time}`);
  });

  it("V2.3 nøkler vaskes før tallmønstrene: en nøkkel med åtte sifre blir nøkkelplassholder", () => {
    const account = scrubText("AccountName=fiktiv;AccountKey=12345678;EndpointSuffix=x");
    expect(account).toContain(`AccountKey=${REDACTED}`);
    expect(account).not.toContain("[telefon]");
    const secret = scrubText("grant_type=x&client_secret=12345678&scope=y");
    expect(secret).toContain(`client_secret=${REDACTED}`);
    expect(secret).not.toContain("[telefon]");
    expect(scrubText("Authorization: Bearer 12345678")).toBe(`Authorization: Bearer ${REDACTED}`);
    const sig = scrubText("https://fiktiv.blob.core.windows.net/c/b?sv=2024&sig=12345678");
    expect(sig).toContain(`sig=${REDACTED}`);
    expect(sig).not.toContain("[telefon]");
  });

  it("V2.4 adresse vaskes ikke i loggen («Storgata 12», «8006 Bodø» står)", () => {
    expect(scrubText("Adresse Storgata 12, 8006 Bodø")).toBe("Adresse Storgata 12, 8006 Bodø");
  });

  it("V2.5 statisk: logger.ts importerer mønstrene og har ingen egen e-post- eller telefonregex", () => {
    const source = readFileSync(join(__dirname, "logger.ts"), "utf8");
    expect(source).toMatch(/from\s+["']\.\/pii-patterns["']/u);
    expect(source).not.toMatch(/const\s+(?:EMAIL|PHONE)\s*=/u);
    // Ingen egen regex med @ (e-post) og ingen egen +47-regex (telefon)
    expect(source).not.toMatch(/=\s*\/[^\n]*@[^\n]*\/[a-z]*;/u);
    expect(source).not.toMatch(/\(\?:\\\+\|00\)47/u);
  });
});
