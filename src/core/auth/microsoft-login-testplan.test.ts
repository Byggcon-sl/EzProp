import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getEnv, resetEnvCache } from "@/shared/config/env";
import { logger } from "@/shared/lib/logger";
import {
  checkMicrosoftProfile,
  getMicrosoftLoginConfig,
  isMicrosoftLoginEnabled,
  MICROSOFT_REJECTION_REASONS,
  MS_LOGIN_ENV_NAMES,
} from "./microsoft-login";

/*
 * Testplan for Microsoft-innlogging, rene enhetstester (docs/funksjoner/
 * fase2a-microsoft-innlogging-testplan.md avsnitt 1, 2, 5.5, 7 og 8.2). Utfyller utviklerens
 * `microsoft-login-core.test.ts`. Alle verdier er oppdiktet; ingen nettverk og ingen database
 * (auth-modulen lastes, men ingen spørring kjøres).
 *
 * Støtter hovedmål de ansatte (feil i oppsettet slår bare av Microsoft-knappen, koden virker
 * alltid, regel 11) og reklamasjoner (bare egne ansatte fra egen katalog slipper inn, så vi vet
 * hvem som signerer). KI i bunnen: ingenting fra Microsoft går til KI (kildesjekk M7.4).
 */

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const SECRET = "test-ms-login-secret";
const NOW = 1_800_000_000;
const OID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const expected = { tenantId: TENANT, clientId: CLIENT, nowSeconds: NOW };
const good = {
  aud: CLIENT,
  iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
  exp: NOW + 600,
  tid: TENANT,
  oid: OID,
  sub: "sub-er-ulik-per-app",
  email: "ola.testesen@byggcon.example",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetEnvCache();
});

type Values = { tenant?: boolean; client?: boolean; secret?: boolean };

/** Kaller `getMicrosoftLoginConfig` med de valgte verdiene satt, og fanger advarslene. */
function configWith(values: Values, tenantId = TENANT) {
  vi.stubEnv("MS_LOGIN_CLIENT_SECRET", values.secret ? SECRET : "");
  const warn = vi.spyOn(logger, "warn");
  const config = getMicrosoftLoginConfig({
    MS_LOGIN_TENANT_ID: values.tenant ? tenantId : undefined,
    MS_LOGIN_CLIENT_ID: values.client ? CLIENT : undefined,
  });
  const warnings = warn.mock.calls.map((call) => JSON.stringify(call));
  return { config, warnings };
}

describe("M1 oppsett: alle eller ingen", () => {
  it("M1.1 ingen av de tre satt: null og ingen advarsel (Microsoft er bare ikke satt opp)", () => {
    const { config, warnings } = configWith({});
    expect(config).toBeNull();
    expect(warnings).toEqual([]);
  });

  const partial: [string, Values, string[]][] = [
    ["bare tenant-id", { tenant: true }, ["MS_LOGIN_CLIENT_ID", "MS_LOGIN_CLIENT_SECRET"]],
    ["bare klient-id", { client: true }, ["MS_LOGIN_TENANT_ID", "MS_LOGIN_CLIENT_SECRET"]],
    ["bare hemmelighet", { secret: true }, ["MS_LOGIN_TENANT_ID", "MS_LOGIN_CLIENT_ID"]],
    ["tenant og klient", { tenant: true, client: true }, ["MS_LOGIN_CLIENT_SECRET"]],
    ["tenant og hemmelighet", { tenant: true, secret: true }, ["MS_LOGIN_CLIENT_ID"]],
    ["klient og hemmelighet", { client: true, secret: true }, ["MS_LOGIN_TENANT_ID"]],
  ];

  it.each(partial)(
    "M1.1 delvis oppsett (%s): null, nøyaktig én advarsel med bare navnene, aldri verdiene",
    (_label, values, missing) => {
      const { config, warnings } = configWith(values);
      expect(config).toBeNull();
      expect(warnings).toHaveLength(1);
      for (const name of missing) expect(warnings[0]).toContain(name);
      for (const value of [TENANT, CLIENT, SECRET]) expect(warnings[0]).not.toContain(value);
    },
  );

  it("M1.2 alle tre gyldige: oppsettet med de tre verdiene og ingen advarsel", () => {
    const { config, warnings } = configWith({ tenant: true, client: true, secret: true });
    expect(config).toEqual({ tenantId: TENANT, clientId: CLIENT, clientSecret: SECRET });
    expect(warnings).toEqual([]);
  });

  it.each([
    ["common"],
    ["organizations"],
    ["consumers"],
    ["byggcon.example"],
    ["   "],
    ["11111111-1111-4111-8111 111111111111"],
    ["11111111-1111-4111-8111-11111111111"],
    [`${TENANT}x`],
  ])("M1.3 tenant-id %j som ikke er GUID: null og én advarsel uten verdien", (tenantId) => {
    const { config, warnings } = configWith({ tenant: true, client: true, secret: true }, tenantId);
    expect(config).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(MS_LOGIN_ENV_NAMES.tenantId);
    expect(warnings[0]).not.toContain(SECRET);
    expect(warnings[0]).not.toContain(CLIENT);
    if (tenantId.trim() !== "") expect(warnings[0]).not.toContain(tenantId.trim());
  });

  it("M1.3 valget er låst: GUID med store bokstaver og mellomrom rundt godtas og gis med små bokstaver", () => {
    const { config, warnings } = configWith(
      { tenant: true, client: true, secret: true },
      `  ${TENANT.toUpperCase()}  `,
    );
    expect(config?.tenantId).toBe(TENANT);
    expect(warnings).toEqual([]);
  });

  it("M1.4 uløst nøkkelboks-referanse i hemmeligheten: null og én advarsel", () => {
    vi.stubEnv(
      "MS_LOGIN_CLIENT_SECRET",
      "@Microsoft.KeyVault(SecretUri=https://kv-oppdiktet.vault.azure.net/secrets/x/)",
    );
    const warn = vi.spyOn(logger, "warn");
    expect(
      getMicrosoftLoginConfig({ MS_LOGIN_TENANT_ID: TENANT, MS_LOGIN_CLIENT_ID: CLIENT }),
    ).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).toContain("MS_LOGIN_CLIENT_SECRET");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("KeyVault");
  });

  it("M1.5 env.ts kaster ikke på ugyldig MS_LOGIN_*, og knappen er av", () => {
    vi.stubEnv("MS_LOGIN_TENANT_ID", "common");
    vi.stubEnv("MS_LOGIN_CLIENT_ID", CLIENT);
    vi.stubEnv("MS_LOGIN_CLIENT_SECRET", SECRET);
    resetEnvCache();
    expect(() => getEnv()).not.toThrow();
    expect(isMicrosoftLoginEnabled()).toBe(false);
  });

  it("M1.5 isMicrosoftLoginEnabled er sann bare med fullt oppsett, og logger ikke", () => {
    const warn = vi.spyOn(logger, "warn");
    vi.stubEnv("MS_LOGIN_TENANT_ID", TENANT);
    vi.stubEnv("MS_LOGIN_CLIENT_ID", CLIENT);
    vi.stubEnv("MS_LOGIN_CLIENT_SECRET", SECRET);
    resetEnvCache();
    expect(isMicrosoftLoginEnabled()).toBe(true);
    vi.stubEnv("MS_LOGIN_CLIENT_ID", "");
    resetEnvCache();
    expect(isMicrosoftLoginEnabled()).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});

type AuthModule = typeof import("./auth");

/** Laster auth-modulen på nytt med de valgte miljøverdiene. */
async function loadAuth(values: Record<string, string>): Promise<AuthModule["auth"]> {
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
  resetEnvCache();
  vi.resetModules();
  return (await import("./auth")).auth;
}

describe("M1.6–M1.8 leverandøren i Better Auth", () => {
  afterEach(() => vi.resetModules());

  it("M1.6 med oppsett: én tenant, ingen ny bruker, bare openid profile email, ingen prompt", async () => {
    const auth = await loadAuth({
      MS_LOGIN_TENANT_ID: TENANT,
      MS_LOGIN_CLIENT_ID: CLIENT,
      MS_LOGIN_CLIENT_SECRET: SECRET,
    });
    const providers = auth.options.socialProviders as Record<string, Record<string, unknown>>;
    expect(Object.keys(providers)).toEqual(["microsoft"]);
    const ms = providers.microsoft!;
    expect(ms.tenantId).toBe(TENANT);
    expect(ms.clientId).toBe(CLIENT);
    expect(ms.disableSignUp).toBe(true);
    expect(ms.disableImplicitSignUp).toBeUndefined();
    expect(ms.disableDefaultScope).toBe(true);
    expect(ms.scope).toEqual(["openid", "profile", "email"]);
    expect(ms.disableProfilePhoto).toBe(true);
    expect(ms.prompt).toBeUndefined();
    expect(ms.authority).toBeUndefined();
    expect(typeof ms.getUserInfo).toBe("function");
  });

  it.each([
    ["uten oppsett", {}],
    ["delvis oppsett", { MS_LOGIN_TENANT_ID: TENANT, MS_LOGIN_CLIENT_ID: CLIENT }],
    [
      "tenant-id common",
      { MS_LOGIN_TENANT_ID: "common", MS_LOGIN_CLIENT_ID: CLIENT, MS_LOGIN_CLIENT_SECRET: SECRET },
    ],
  ])(
    "M1.7 %s: ingen Microsoft-leverandør, appen starter, og kodeinnloggingen er med",
    async (_label, values: Record<string, string>) => {
      vi.stubEnv("MS_LOGIN_TENANT_ID", "");
      vi.stubEnv("MS_LOGIN_CLIENT_ID", "");
      vi.stubEnv("MS_LOGIN_CLIENT_SECRET", "");
      const auth = await loadAuth(values);
      expect(auth.options.socialProviders ?? {}).toEqual({});
      expect(auth.options.plugins?.some((plugin) => plugin.id === "email-otp")).toBe(true);
    },
  );

  it("M1.7 med oppsett er kodeinnloggingen fortsatt med (regel 11)", async () => {
    const auth = await loadAuth({
      MS_LOGIN_TENANT_ID: TENANT,
      MS_LOGIN_CLIENT_ID: CLIENT,
      MS_LOGIN_CLIENT_SECRET: SECRET,
    });
    expect(auth.options.plugins?.some((plugin) => plugin.id === "email-otp")).toBe(true);
  });

  it("M1.8 kobling: bare microsoft er klarert, ingen andre e-poster, navn overskrives ikke", async () => {
    const auth = await loadAuth({
      MS_LOGIN_TENANT_ID: TENANT,
      MS_LOGIN_CLIENT_ID: CLIENT,
      MS_LOGIN_CLIENT_SECRET: SECRET,
    });
    const linking = auth.options.account?.accountLinking as Record<string, unknown>;
    expect(linking.trustedProviders).toEqual(["microsoft"]);
    expect(linking.requireLocalEmailVerified).toBe(false);
    expect(linking.allowDifferentEmails).toBeUndefined();
    expect(linking.updateUserInfoOnLink).not.toBe(true);
    const ms = (auth.options.socialProviders as Record<string, Record<string, unknown>>).microsoft!;
    expect(ms.overrideUserInfoOnSignIn).not.toBe(true);
  });
});

type Claims = Record<string, unknown>;

/** Regeltabell for profilsjekken: testsaker som data (M2). */
const PROFILE_CASES: [string, Claims, { ok: true; email: string } | { reason: string }][] = [
  ["M2.1 riktig tid og e-post", {}, { ok: true, email: "ola.testesen@byggcon.example" }],
  [
    "M2.2 store bokstaver og mellomrom",
    { email: "  Ola.Testesen@Byggcon.Example  " },
    { ok: true, email: "ola.testesen@byggcon.example" },
  ],
  [
    "M2.3 e-post bare i preferred_username",
    { email: undefined, preferred_username: " Ola.Testesen@BYGGCON.example " },
    { ok: true, email: "ola.testesen@byggcon.example" },
  ],
  [
    "M2.3 tom email, preferred_username som reserve",
    { email: "   ", preferred_username: "ola.testesen@byggcon.example" },
    { ok: true, email: "ola.testesen@byggcon.example" },
  ],
  ["M2.4 begge mangler", { email: undefined }, { reason: "missing_email" }],
  ["M2.4 begge tomme", { email: "", preferred_username: "" }, { reason: "missing_email" }],
  ["M2.4 bare mellomrom", { email: "  ", preferred_username: "\t " }, { reason: "missing_email" }],
  ["M2.4 e-post er ikke tekst", { email: 42 }, { reason: "missing_email" }],
  ["M2.4 uten @", { email: "ola.testesen" }, { reason: "missing_email" }],
  ["M2.5 fremmed tid", { tid: OTHER_TENANT }, { reason: "wrong_tenant" }],
  ["M2.5 tid mangler", { tid: undefined }, { reason: "wrong_tenant" }],
  ["M2.5 tid er ikke tekst", { tid: 11111111 }, { reason: "wrong_tenant" }],
  ["M2.5 tid common", { tid: "common" }, { reason: "wrong_tenant" }],
  [
    "M2.6 fremmed idp (sts)",
    { idp: `https://sts.windows.net/${OTHER_TENANT}/` },
    { reason: "guest_account" },
  ],
  ["M2.6 fremmed idp (live.com)", { idp: "live.com" }, { reason: "guest_account" }],
  ["M2.6 fremmed idp (gmail)", { idp: "google.com" }, { reason: "guest_account" }],
  [
    "M2.6 #EXT# i preferred_username",
    { preferred_username: "ola_annen.example#EXT#@byggcon.example" },
    { reason: "guest_account" },
  ],
  [
    "M2.6 #ext# med små bokstaver i upn",
    { upn: "ola_annen.example#ext#@byggcon.example" },
    { reason: "guest_account" },
  ],
  [
    "M2.6 gjest selv om e-posten matcher en ansatt",
    { idp: "live.com", email: "ola.testesen@byggcon.example" },
    { reason: "guest_account" },
  ],
  [
    "M2.7 egen idp (sts)",
    { idp: `https://sts.windows.net/${TENANT}/` },
    { ok: true, email: "ola.testesen@byggcon.example" },
  ],
  ["M2.7 egen idp (tid)", { idp: TENANT }, { ok: true, email: "ola.testesen@byggcon.example" }],
  ["M2.7 tom idp", { idp: "" }, { ok: true, email: "ola.testesen@byggcon.example" }],
  ["M2.8 oid mangler", { oid: undefined }, { reason: "missing_oid" }],
  ["M2.8 oid tom", { oid: "" }, { reason: "missing_oid" }],
  ["M2.8 oid er ikke tekst", { oid: 123 }, { reason: "missing_oid" }],
  ["M3.11 feil aud", { aud: "44444444-4444-4444-8444-444444444444" }, { reason: "invalid_token" }],
  ["M3.11 aud mangler", { aud: undefined }, { reason: "invalid_token" }],
  ["M3.11 aud-liste uten vår klient", { aud: ["x", "y"] }, { reason: "invalid_token" }],
  ["M3.12 utløpt", { exp: NOW - 1 }, { reason: "invalid_token" }],
  ["M3.12 utløper akkurat nå", { exp: NOW }, { reason: "invalid_token" }],
  ["M3.12 exp mangler", { exp: undefined }, { reason: "invalid_token" }],
  ["M3.12 exp som tekst", { exp: String(NOW + 600) }, { reason: "invalid_token" }],
  [
    "M3.13 fremmed tenant i iss selv om tid er riktig",
    { iss: `https://login.microsoftonline.com/${OTHER_TENANT}/v2.0` },
    { reason: "invalid_token" },
  ],
  ["M3.13 v1-utsteder", { iss: `https://sts.windows.net/${TENANT}/` }, { reason: "invalid_token" }],
  [
    "M3.13 common i iss",
    { iss: "https://login.microsoftonline.com/common/v2.0" },
    { reason: "invalid_token" },
  ],
];

describe("M2 profilsjekken som regeltabell", () => {
  it.each(PROFILE_CASES)("%s", (_label, overrides, outcome) => {
    const result = checkMicrosoftProfile({ ...good, ...overrides }, expected);
    if ("ok" in outcome) {
      expect(result).toEqual({ ok: true, oid: OID, email: outcome.email });
    } else {
      expect(result).toEqual({ ok: false, reason: outcome.reason });
    }
  });

  it("M2.1 konto-id er oid, aldri sub", () => {
    const result = checkMicrosoftProfile(good, expected);
    expect(result.ok && result.oid).toBe(OID);
    expect(checkMicrosoftProfile({ ...good, oid: undefined }, expected)).toEqual({
      ok: false,
      reason: "missing_oid",
    });
  });

  it.each([[null], [undefined], ["tekst"], [42]])(
    "M2.4 kaster aldri, heller ikke for %j som tokeninnhold",
    (claims) => {
      expect(() => checkMicrosoftProfile(claims as never, expected)).not.toThrow();
      expect(checkMicrosoftProfile(claims as never, expected).ok).toBe(false);
    },
  );

  it("M2.4 kaster ikke når et felt kaster ved lesing", () => {
    const claims = new Proxy(
      {},
      {
        get() {
          throw new Error("ødelagt token");
        },
      },
    );
    expect(checkMicrosoftProfile(claims, expected)).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("M2.9 årsakskoden er alltid fra den faste listen og har aldri e-post, oid eller tenant-id", () => {
    const secretish = [OID, TENANT, OTHER_TENANT, CLIENT, "@", "byggcon"];
    for (const [, overrides] of PROFILE_CASES) {
      const result = checkMicrosoftProfile({ ...good, ...overrides }, expected);
      if (result.ok) continue;
      expect(MICROSOFT_REJECTION_REASONS).toContain(result.reason);
      for (const value of secretish) expect(result.reason).not.toContain(value);
    }
  });
});

const ROOT = join(__dirname, "..", "..", "..");
const SRC = join(ROOT, "src");
const AUTH_DIR = join(SRC, "core", "auth");

function filesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return filesIn(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

const productAuthFiles = filesIn(AUTH_DIR).filter((file) => !/\.test\.tsx?$/.test(file));
const read = (file: string) => readFileSync(file, "utf8");
const rel = (file: string) => relative(ROOT, file);

describe("M5.5, M7 og M8.2 kildesjekker", () => {
  it("M7.3 ingen fetch og ingen Graph i src/core/auth; Microsoft-adressen bare som utsteder", () => {
    expect(productAuthFiles.length).toBeGreaterThan(0);
    for (const file of productAuthFiles) {
      const text = read(file);
      expect(text, rel(file)).not.toMatch(/\bfetch\s*\(/);
      expect(text, rel(file)).not.toContain("graph.microsoft.com");
      for (const line of text.split("\n").filter((l) => l.includes("login.microsoftonline.com"))) {
        // Bare utstederen (`iss`) til sammenligning er lov, ingen kall
        expect(line, rel(file)).toMatch(
          /https:\/\/login\.microsoftonline\.com\/(\$\{[^}]+\}|<tenant(Id)?>)\/v2\.0/,
        );
      }
    }
  });

  it("M7.3 MS_LOGIN_CLIENT_SECRET leses bare via readSecret, og fra bladfilen", () => {
    const offenders = filesIn(SRC)
      .filter((file) => !/\.test\.tsx?$/.test(file))
      .filter((file) =>
        /process\.env\s*(\.\s*MS_LOGIN_CLIENT_SECRET|\[\s*["'`]MS_LOGIN_)/.test(read(file)),
      )
      .map(rel);
    expect(offenders).toEqual([]);
    const login = read(join(AUTH_DIR, "microsoft-login.ts"));
    expect(login).toMatch(/from "@\/core\/integrations\/secrets"/);
    expect(login).not.toMatch(/from "@\/core\/integrations"/);
    expect(login).toMatch(/readSecret\(MS_LOGIN_ENV_NAMES\.clientSecret\)/);
    expect(MS_LOGIN_ENV_NAMES.clientSecret).toBe("MS_LOGIN_CLIENT_SECRET");
  });

  it("M7.2 Better Auth sin logger går via vår logger", () => {
    const authSource = read(join(AUTH_DIR, "auth.ts"));
    expect(authSource).toMatch(/from "@\/shared\/lib\/logger"/);
    expect(authSource).toMatch(/logger:\s*\{\s*log:/);
  });

  it("M7.4 ingen import fra src/core/ai i src/core/auth", () => {
    for (const file of productAuthFiles) {
      expect(read(file), rel(file)).not.toMatch(/["']@\/core\/ai(\/|["'])/);
      expect(read(file), rel(file)).not.toContain("ai_usage_log");
      expect(read(file), rel(file)).not.toContain("aiUsageLog");
    }
  });

  it("M8.2 ingen sletting i src/core/auth (myk sletting, regel 3)", () => {
    for (const file of productAuthFiles) {
      expect(read(file), rel(file)).not.toMatch(/\.delete\s*\(/);
      expect(read(file), rel(file)).not.toMatch(/\bdelete\s+from\b/i);
    }
  });

  it("M5.5 hasActiveEmployment kalles bare etter sjekken for Microsoft (koden får ingen ny sjekk)", () => {
    const authSource = read(join(AUTH_DIR, "auth.ts"));
    const session = authSource.slice(authSource.indexOf("session: {\n      create: {"));
    const before = session.slice(0, session.indexOf("async after"));
    expect(before).toMatch(/if \(!isMicrosoftCallback\(ctx\)\) return;[\s\S]*hasActiveEmployment/);
    expect(before.indexOf("isMicrosoftCallback")).toBeLessThan(
      before.indexOf("hasActiveEmployment"),
    );
    const accountCreate = authSource.slice(
      authSource.indexOf("account: {\n      create:"),
      authSource.indexOf("update: {"),
    );
    expect(accountCreate).toMatch(
      /if \(account\.providerId !== MICROSOFT_PROVIDER_ID\) return;[\s\S]*hasActiveEmployment/,
    );
    expect(authSource.match(/hasActiveEmployment\(/g)).toHaveLength(2);
  });
});
