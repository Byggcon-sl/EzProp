import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AccessDeniedError,
  hasActiveEmployment,
  permissions,
  requireOrganizationAccess,
  type Actor,
} from "@/core/access";
import { listConnections } from "@/core/integrations";
import { db } from "@/db/client";
import {
  accounts,
  employees,
  organizations,
  sessions,
  users,
  type EmployeeRole,
} from "@/db/schema";
import { getEnv, resetEnvCache } from "@/shared/config/env";
import {
  createEmployee,
  createIntegrationConnection,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";

/*
 * Testplan for Microsoft-innlogging gjennom Better Auth (`auth.handler`) mot testdatabasen
 * (docs/funksjoner/fase2a-microsoft-innlogging-testplan.md avsnitt 3–8). Utfyller utviklerens
 * `microsoft-callback.integration.test.ts`, med samme falske token-adresse. Ingen nettverk.
 * Alle verdier er oppdiktet (byggcon.example, oppdiktet tenant-id og klient-id).
 *
 * Støtter hovedmål de ansatte (rett inn med Microsoft, og admin stenges aldri ute: koden virker
 * alltid, regel 11) og reklamasjoner (bare aktive ansatte fra egen katalog slipper inn, så vi
 * vet hvem som signerer). KI i bunnen: ingen personopplysninger fra Microsoft i loggen.
 */

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const CLIENT_SECRET = "test-ms-login-secret";
const OID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_OID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACCESS_TOKEN = "falsk-tilgang-xyz";
const REFRESH_TOKEN = "falsk-fornyelse-xyz";
const BASE_URL = getEnv().BETTER_AUTH_URL;
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;

type Auth = typeof import("./auth").auth;
type Logger = typeof import("@/shared/lib/logger").logger;
let auth: Auth;
let logger: Logger;
let readDevMailbox: typeof import("@/core/email").readDevMailbox;
let idTokenClaims: Record<string, unknown> = {};
let tokenStatus = 200;
/** Rå ID-token i stedet for et laget av `idTokenClaims` (for ødelagte token). */
let rawIdToken: string | null = null;
const fetchedUrls: string[] = [];
const issuedIdTokens: string[] = [];

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** Usignert ID-token (signaturen sjekkes ikke; tokenet kommer rett fra token-adressen, ADR 0008). */
function idToken(claims: Record<string, unknown>): string {
  return `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url(claims)}.c2ln`;
}

function claimsFor(email: string | undefined, overrides: Record<string, unknown> = {}) {
  return {
    aud: CLIENT,
    iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
    exp: Math.floor(Date.now() / 1000) + 3600,
    tid: TENANT,
    oid: OID,
    sub: "sub-som-ikke-skal-brukes",
    email,
    name: "Navn Fra Microsoft",
    picture: "https://bilde.byggcon.example/ola.png",
    ...overrides,
  };
}

function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

function post(route: string, body: unknown, cookie?: string): Promise<Response> {
  return auth.handler(
    new Request(`${BASE_URL}/api/auth${route}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: BASE_URL,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

function get(route: string, cookie?: string): Promise<Response> {
  return auth.handler(
    new Request(`${BASE_URL}/api/auth${route}`, {
      headers: { origin: BASE_URL, ...(cookie ? { cookie } : {}) },
    }),
  );
}

/** Starter omdirigeringsflyten og gir `state` og informasjonskapselen. */
async function startMicrosoft(body: Record<string, unknown> = { callbackURL: "/oppdrag" }) {
  const start = await post("/sign-in/social", { provider: "microsoft", ...body });
  expect(start.status).toBe(200);
  const { url } = (await start.json()) as { url: string };
  const state = new URL(url).searchParams.get("state") ?? "";
  return { state, cookie: cookiesOf(start) };
}

/** Hele runden: start, så tilbakekallet med falsk kode. Gir svaret og øktens informasjonskapsel. */
async function signInWithMicrosoft(claims: Record<string, unknown>) {
  idTokenClaims = claims;
  const { state, cookie } = await startMicrosoft();
  const response = await get(`/callback/microsoft?code=kode-1&state=${state}`, cookie);
  return { response, cookie: cookiesOf(response) };
}

/** Brukeren bak økten i informasjonskapselen, som `Actor`. */
async function sessionActor(cookie: string): Promise<Actor> {
  const result = await auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!result) throw new Error("ingen økt i testen");
  return { id: result.user.id, name: result.user.name, email: result.user.email };
}

async function signInWithCode(email: string): Promise<string> {
  const request = await post("/email-otp/send-verification-otp", { email, type: "sign-in" });
  expect(request.status).toBe(200);
  const mail = readDevMailbox().find((entry) => entry.to.toLowerCase() === email.toLowerCase());
  const otp = /: (\d{6})$/.exec(mail?.subject ?? "")?.[1];
  if (!otp) throw new Error("fant ingen kode i utviklings-postkassen");
  const response = await post("/sign-in/email-otp", { email, otp });
  expect(response.status).toBe(200);
  return cookiesOf(response);
}

async function count(table: typeof users | typeof accounts | typeof sessions | typeof employees) {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(table);
  return row?.n ?? 0;
}

async function counts() {
  return {
    users: await count(users),
    accounts: await count(accounts),
    sessions: await count(sessions),
    employees: await count(employees),
  };
}

function expectRejected(response: Response) {
  expect(response.status).toBe(302);
  const location = response.headers.get("location") ?? "";
  expect(location).toMatch(/^\/logg-inn\?error=/);
}

async function employeeWith(email: string, roles: EmployeeRole[] = ["inspector"], orgId?: string) {
  const organizationId = orgId ?? (await createOrganization("Byggcon oppdiktet")).id;
  const user = await createUser({ name: "Ola Testesen", email });
  const employee = await createEmployee(user, organizationId, roles);
  return { user, employee, organizationId };
}

beforeAll(async () => {
  vi.stubEnv("MS_LOGIN_TENANT_ID", TENANT);
  vi.stubEnv("MS_LOGIN_CLIENT_ID", CLIENT);
  vi.stubEnv("MS_LOGIN_CLIENT_SECRET", CLIENT_SECRET);
  resetEnvCache();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    fetchedUrls.push(url);
    if (url !== TOKEN_URL) throw new Error("ukjent adresse i testen");
    if (tokenStatus !== 200) {
      return new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: tokenStatus,
        headers: { "content-type": "application/json" },
      });
    }
    const token = rawIdToken ?? idToken(idTokenClaims);
    issuedIdTokens.push(token);
    return new Response(
      JSON.stringify({
        access_token: ACCESS_TOKEN,
        refresh_token: REFRESH_TOKEN,
        id_token: token,
        token_type: "Bearer",
        expires_in: 3600,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  vi.resetModules();
  auth = (await import("./auth")).auth;
  logger = (await import("@/shared/lib/logger")).logger;
  readDevMailbox = (await import("@/core/email")).readDevMailbox;
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetEnvCache();
  vi.resetModules();
});

beforeEach(async () => {
  await resetDatabase();
  fetchedUrls.length = 0;
  issuedIdTokens.length = 0;
  tokenStatus = 200;
  rawIdToken = null;
  vi.restoreAllMocks();
});

describe("M3 innlogging", () => {
  it("M3.1 godkjent: lastLoginAt oppdateres, navn, e-post og bilde i users er uendret", async () => {
    const { user } = await employeeWith("ola.testesen@byggcon.example");
    await db.update(users).set({ lastLoginAt: null, image: null }).where(eq(users.id, user.id));
    const before = new Date();

    const { response } = await signInWithMicrosoft(claimsFor("ola.testesen@byggcon.example"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/oppdrag");

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row?.lastLoginAt).not.toBeNull();
    expect(row!.lastLoginAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(row?.name).toBe("Ola Testesen");
    expect(row?.email).toBe("ola.testesen@byggcon.example");
    expect(row?.image).toBeNull();
    const [account] = await db.select().from(accounts).where(eq(accounts.userId, user.id));
    expect(account?.accountId).toBe(OID);
    expect(account?.accountId).not.toBe("sub-som-ikke-skal-brukes");
  });

  it("M3.1/M3.2 lastLoginAt oppdateres også ved andre innlogging", async () => {
    const { user } = await employeeWith("ola.testesen@byggcon.example");
    await signInWithMicrosoft(claimsFor("ola.testesen@byggcon.example"));
    const old = new Date("2026-01-01T00:00:00Z");
    await db.update(users).set({ lastLoginAt: old }).where(eq(users.id, user.id));

    const { response } = await signInWithMicrosoft(claimsFor("ola.testesen@byggcon.example"));
    expect(response.status).toBe(302);
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.lastLoginAt!.getTime()).toBeGreaterThan(old.getTime());
  });

  it.each([
    ["store bokstaver og mellomrom", claimsFor("  Ola.Testesen@Byggcon.Example  ")],
    [
      "e-post bare i preferred_username",
      claimsFor(undefined, { preferred_username: "Ola.Testesen@Byggcon.Example" }),
    ],
    [
      "tom email, preferred_username som reserve",
      claimsFor(" ", { preferred_username: "ola.testesen@byggcon.example" }),
    ],
  ])("M3.3 %s: samme bruker, ingen ny rad i users", async (_label, claims) => {
    const { user } = await employeeWith("ola.testesen@byggcon.example");
    const usersBefore = await count(users);

    const { response, cookie } = await signInWithMicrosoft(claims);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/oppdrag");
    expect(await count(users)).toBe(usersBefore);
    const [account] = await db.select().from(accounts);
    expect(account?.userId).toBe(user.id);
    expect((await sessionActor(cookie)).id).toBe(user.id);
  });

  it("M3.3 første gang med email, andre gang bare preferred_username: samme konto og bruker", async () => {
    const { user } = await employeeWith("ola.testesen@byggcon.example");
    await signInWithMicrosoft(claimsFor("ola.testesen@byggcon.example"));
    const { response } = await signInWithMicrosoft(
      claimsFor(undefined, { preferred_username: "OLA.TESTESEN@byggcon.example" }),
    );
    expect(response.headers.get("location")).toBe("/oppdrag");
    expect(await count(accounts)).toBe(1);
    expect(await count(sessions)).toBe(2);
    const all = await db.select().from(sessions);
    expect(all.every((s) => s.userId === user.id)).toBe(true);
  });

  it.each([
    ["begge mangler", claimsFor(undefined)],
    ["begge tomme", claimsFor("", { preferred_username: "" })],
    ["bare mellomrom", claimsFor("   ", { preferred_username: "  " })],
  ])("M3.4 tom e-post (%s): avvist uten krasj og uten rader", async (_label, claims) => {
    await employeeWith("ola.testesen@byggcon.example");
    const before = await counts();
    const { response } = await signInWithMicrosoft(claims);
    expect(response.status).not.toBe(500);
    expectRejected(response);
    expect(await counts()).toEqual(before);
  });

  it("M3.5 ukjent adresse: samme svar som feil tenant", async () => {
    await employeeWith("kari@byggcon.example");
    const unknown = await signInWithMicrosoft(claimsFor("ukjent@byggcon.example"));
    const wrongTenant = await signInWithMicrosoft(
      claimsFor("kari@byggcon.example", { tid: OTHER_TENANT }),
    );
    expectRejected(unknown.response);
    expectRejected(wrongTenant.response);
    // Begge går til innloggingssiden med en feil; siden viser lik tekst (A215)
    expect(new URL(unknown.response.headers.get("location")!, BASE_URL).pathname).toBe(
      new URL(wrongTenant.response.headers.get("location")!, BASE_URL).pathname,
    );
    expect(await count(accounts)).toBe(0);
    expect(await count(sessions)).toBe(0);
  });

  it("M3.7 feil tid for en konto som alt er koblet: ingen ny økt, kontoen står", async () => {
    const { user } = await employeeWith("kari@byggcon.example");
    await signInWithMicrosoft(claimsFor("kari@byggcon.example"));
    expect(await count(sessions)).toBe(1);

    const { response } = await signInWithMicrosoft(
      claimsFor("kari@byggcon.example", { tid: OTHER_TENANT }),
    );
    expectRejected(response);
    expect(await count(sessions)).toBe(1);
    const rows = await db.select().from(accounts);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(user.id);
  });

  it.each([
    [
      "#EXT# i preferred_username",
      { preferred_username: "kari_annen.example#EXT#@byggcon.example" },
    ],
    ["#EXT# i upn", { upn: "kari_annen.example#EXT#@byggcon.example" }],
    ["fremmed idp (sts)", { idp: `https://sts.windows.net/${OTHER_TENANT}/` }],
    ["fremmed idp (live.com)", { idp: "live.com" }],
  ])(
    "M3.8 gjestekonto (%s) med e-post som matcher en ansatt: avvist, ikke koblet",
    async (_l, o) => {
      await employeeWith("kari@byggcon.example");
      const { response } = await signInWithMicrosoft(claimsFor("kari@byggcon.example", o));
      expectRejected(response);
      expect(await count(accounts)).toBe(0);
      expect(await count(sessions)).toBe(0);
    },
  );

  it("M3.8 gjest avvises også når kontoen alt er koblet (samme oid)", async () => {
    await employeeWith("kari@byggcon.example");
    await signInWithMicrosoft(claimsFor("kari@byggcon.example"));
    const { response } = await signInWithMicrosoft(
      claimsFor("kari@byggcon.example", { idp: "live.com" }),
    );
    expectRejected(response);
    expect(await count(sessions)).toBe(1);
  });

  it("M3.9 identiteten følger oid når admin bytter e-post på den ansatte", async () => {
    const { user } = await employeeWith("kari@byggcon.example");
    await signInWithMicrosoft(claimsFor("kari@byggcon.example"));
    await db.update(users).set({ email: "kari.ny@byggcon.example" }).where(eq(users.id, user.id));

    const { response, cookie } = await signInWithMicrosoft(claimsFor("kari@byggcon.example"));
    expect(response.headers.get("location")).toBe("/oppdrag");
    expect((await sessionActor(cookie)).id).toBe(user.id);
    expect(await count(users)).toBe(1);
    expect(await count(accounts)).toBe(1);
  });

  it("M3.9 ny oid med e-posten til en annen ansatt kobles bare til den brukeren e-posten tilhører", async () => {
    const org = await createOrganization("Byggcon oppdiktet");
    const kari = await employeeWith("kari@byggcon.example", ["inspector"], org.id);
    const per = await employeeWith("per@byggcon.example", ["inspector"], org.id);
    await signInWithMicrosoft(claimsFor("kari@byggcon.example"));

    const { cookie } = await signInWithMicrosoft(
      claimsFor("per@byggcon.example", { oid: OTHER_OID }),
    );
    expect((await sessionActor(cookie)).id).toBe(per.user.id);
    const rows = await db.select().from(accounts);
    expect(rows.find((r) => r.accountId === OID)?.userId).toBe(kari.user.id);
    expect(rows.find((r) => r.accountId === OTHER_OID)?.userId).toBe(per.user.id);
  });

  it.each([
    ["feil aud", { aud: "44444444-4444-4444-8444-444444444444" }],
    ["aud-liste uten vår klient", { aud: ["44444444-4444-4444-8444-444444444444"] }],
    ["utløpt", { exp: Math.floor(Date.now() / 1000) - 60 }],
    ["uten exp", { exp: undefined }],
  ])("M3.11/M3.12 %s for en konto som alt er koblet: avvist, ingen ny økt", async (_l, o) => {
    await employeeWith("kari@byggcon.example");
    await signInWithMicrosoft(claimsFor("kari@byggcon.example"));
    const { response } = await signInWithMicrosoft(claimsFor("kari@byggcon.example", o));
    expectRejected(response);
    expect(await count(sessions)).toBe(1);
  });

  it("M3.10 (erstattet, ADR 0008 punkt 17) tokenet hentes bare fra token-adressen for egen tenant", async () => {
    await employeeWith("kari@byggcon.example");
    await signInWithMicrosoft(claimsFor("kari@byggcon.example"));
    expect(fetchedUrls).toEqual([TOKEN_URL]);
  });

  it("M3.10 ødelagt ID-token (ikke en JWT) avvises uten krasj", async () => {
    await employeeWith("kari@byggcon.example");
    rawIdToken = "ikke.en.jwt";
    const { state, cookie } = await startMicrosoft();
    const response = await get(`/callback/microsoft?code=kode-1&state=${state}`, cookie);
    expect(response.status).not.toBe(500);
    expectRejected(response);
    expect(await count(sessions)).toBe(0);
  });

  it("feil fra Microsoft (access_denied) og feil state gir innloggingssiden, ikke 500", async () => {
    await employeeWith("kari@byggcon.example");
    const { state, cookie } = await startMicrosoft();
    const denied = await get(
      `/callback/microsoft?error=access_denied&error_description=nei&state=${state}`,
      cookie,
    );
    expect(denied.status).toBe(302);
    expect(denied.headers.get("location") ?? "").toMatch(/^\/logg-inn\?error=/);

    const badState = await get(`/callback/microsoft?code=kode-1&state=feil-state`, cookie);
    expect(badState.status).toBe(302);
    expect(badState.headers.get("location") ?? "").toMatch(/^\/logg-inn\?error=/);

    tokenStatus = 400;
    idTokenClaims = claimsFor("kari@byggcon.example");
    const again = await startMicrosoft();
    const tokenFailed = await get(
      `/callback/microsoft?code=kode-1&state=${again.state}`,
      again.cookie,
    );
    expect(tokenFailed.status).toBe(302);
    expect(tokenFailed.headers.get("location") ?? "").toMatch(/^\/logg-inn\?error=/);
    expect(await count(sessions)).toBe(0);
  });

  it("M3.14 deaktivert før kobling: avvist, ingen konto og ingen økt", async () => {
    const { employee } = await employeeWith("per@byggcon.example");
    await db
      .update(employees)
      .set({ deactivatedAt: new Date() })
      .where(eq(employees.id, employee.id));
    const { response } = await signInWithMicrosoft(claimsFor("per@byggcon.example"));
    expectRejected(response);
    expect(await count(accounts)).toBe(0);
    expect(await count(sessions)).toBe(0);
  });

  it("M3.15 myk-slettet ansatt før og etter kobling: avvist, kontoen står", async () => {
    const { employee } = await employeeWith("per@byggcon.example");
    await db.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, employee.id));
    expectRejected((await signInWithMicrosoft(claimsFor("per@byggcon.example"))).response);
    expect(await count(accounts)).toBe(0);

    await db.update(employees).set({ deletedAt: null }).where(eq(employees.id, employee.id));
    await signInWithMicrosoft(claimsFor("per@byggcon.example"));
    expect(await count(sessions)).toBe(1);
    await db.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, employee.id));
    expectRejected((await signInWithMicrosoft(claimsFor("per@byggcon.example"))).response);
    expect(await count(sessions)).toBe(1);
    expect(await count(accounts)).toBe(1);
  });

  it("M3.15 organisasjonen myk-slettet etter kobling: ingen ny økt", async () => {
    const { organizationId } = await employeeWith("per@byggcon.example");
    await signInWithMicrosoft(claimsFor("per@byggcon.example"));
    await db
      .update(organizations)
      .set({ deletedAt: new Date() })
      .where(eq(organizations.id, organizationId));
    expectRejected((await signInWithMicrosoft(claimsFor("per@byggcon.example"))).response);
    expect(await count(sessions)).toBe(1);
  });

  it("M3.16 bruker uten employees-rad: avvist, ingen konto og ingen økt", async () => {
    await createUser({ email: "gammel@byggcon.example" });
    const { response } = await signInWithMicrosoft(claimsFor("gammel@byggcon.example"));
    expectRejected(response);
    expect(await count(accounts)).toBe(0);
    expect(await count(sessions)).toBe(0);
  });

  it("M3.17 tokens og utløpstider er tomme etter første og andre innlogging", async () => {
    await employeeWith("ola.testesen@byggcon.example");
    for (let round = 1; round <= 2; round++) {
      await signInWithMicrosoft(claimsFor("ola.testesen@byggcon.example"));
      const rows = await db.select().from(accounts);
      expect(rows).toHaveLength(1);
      const [account] = rows;
      expect(account?.accessToken, `runde ${round}`).toBeNull();
      expect(account?.refreshToken, `runde ${round}`).toBeNull();
      expect(account?.idToken, `runde ${round}`).toBeNull();
      expect(account?.accessTokenExpiresAt, `runde ${round}`).toBeNull();
      expect(account?.refreshTokenExpiresAt, `runde ${round}`).toBeNull();
    }
    // Ingen tokenstreng står noe sted i accounts-tabellen
    const dump = JSON.stringify(await db.select().from(accounts));
    for (const secret of [ACCESS_TOKEN, REFRESH_TOKEN, ...issuedIdTokens]) {
      expect(dump).not.toContain(secret);
    }
  });

  it.each([
    ["callbackURL https://evil.example", { callbackURL: "https://evil.example" }],
    ["callbackURL //evil.example", { callbackURL: "//evil.example" }],
    ["errorCallbackURL https://evil.example", { errorCallbackURL: "https://evil.example" }],
    ["errorCallbackURL //evil.example", { errorCallbackURL: "//evil.example" }],
    ["errorCallbackURL /\\evil.example", { errorCallbackURL: "/\\evil.example" }],
    ["newUserCallbackURL https://evil.example", { newUserCallbackURL: "https://evil.example" }],
  ])("M3.18 %s avvises før Microsoft-runden", async (_label, body) => {
    const response = await post("/sign-in/social", {
      provider: "microsoft",
      callbackURL: "/oppdrag",
      ...body,
    });
    expect(response.status).toBe(403);
    expect(await count(sessions)).toBe(0);
  });

  it("M3.18 avvist innlogging med gyldig errorCallbackURL går til en sti på samme nettsted", async () => {
    await employeeWith("kari@byggcon.example");
    idTokenClaims = claimsFor("ukjent@byggcon.example");
    const { state, cookie } = await startMicrosoft({
      callbackURL: "/oppdrag/abc",
      errorCallbackURL: "/logg-inn",
    });
    const response = await get(`/callback/microsoft?code=kode-1&state=${state}`, cookie);
    const location = response.headers.get("location") ?? "";
    expect(location).toMatch(/^\/logg-inn\?error=/);
    expect(location.startsWith("//")).toBe(false);
  });

  it("M3.18 gyldig callbackURL /oppdrag/… følges", async () => {
    await employeeWith("kari@byggcon.example");
    idTokenClaims = claimsFor("kari@byggcon.example");
    const { state, cookie } = await startMicrosoft({ callbackURL: "/oppdrag/abc" });
    const response = await get(`/callback/microsoft?code=kode-1&state=${state}`, cookie);
    expect(response.headers.get("location")).toBe("/oppdrag/abc");
  });

  it("M3.20 bare token-adressen for egen tenant kalles; aldri common, Graph eller bilde", async () => {
    await employeeWith("kari@byggcon.example");
    await signInWithMicrosoft(claimsFor("kari@byggcon.example"));
    await signInWithMicrosoft(claimsFor("ukjent@byggcon.example"));
    expect(fetchedUrls.length).toBeGreaterThan(0);
    for (const url of fetchedUrls) {
      expect(url).toBe(TOKEN_URL);
      expect(url).not.toMatch(/common|organizations|consumers|graph\.microsoft\.com|photo/);
    }
  });
});

describe("M4 ansattforhold og tilgang", () => {
  it.each<EmployeeRole>(["inspector", "office", "manager", "admin"])(
    "M4.3 %s får samme grant fra requireOrganizationAccess etter Microsoft som etter kode",
    async (role) => {
      const email = `${role}@byggcon.example`;
      const { user, organizationId } = await employeeWith(email, [role]);

      const microsoft = await signInWithMicrosoft(claimsFor(email, { oid: `oid-${role}` }));
      expect(microsoft.response.headers.get("location")).toBe("/oppdrag");
      const viaMicrosoft = await sessionActor(microsoft.cookie);
      const codeCookie = await signInWithCode(email);
      const viaCode = await sessionActor(codeCookie);

      expect(viaMicrosoft.id).toBe(user.id);
      expect(viaCode.id).toBe(user.id);
      const grantMicrosoft = await requireOrganizationAccess(viaMicrosoft, organizationId);
      const grantCode = await requireOrganizationAccess(viaCode, organizationId);
      expect(grantMicrosoft).toEqual(grantCode);
      expect(grantMicrosoft.roles).toEqual([role]);
      expect(grantMicrosoft.organizationId).toBe(organizationId);
    },
  );

  it("M4.4 bare ansatt i en annen organisasjon: kommer inn, men får ingen tilgang til den første", async () => {
    const orgA = await createOrganization("Byggcon oppdiktet A");
    const orgB = await createOrganization("Annet firma oppdiktet B");
    await employeeWith("admin.a@byggcon.example", ["admin"], orgA.id);
    await createIntegrationConnection(orgA.id);
    const { user } = await employeeWith("per@annet.example", ["admin"], orgB.id);

    const { response, cookie } = await signInWithMicrosoft(claimsFor("per@annet.example"));
    expect(response.headers.get("location")).toBe("/oppdrag");
    const actor = await sessionActor(cookie);
    expect(actor.id).toBe(user.id);

    for (const permission of permissions) {
      await expect(
        requireOrganizationAccess(actor, orgA.id, permission),
        permission,
      ).rejects.toBeInstanceOf(AccessDeniedError);
    }
    await expect(listConnections(actor, orgA.id)).rejects.toBeInstanceOf(AccessDeniedError);
    expect((await requireOrganizationAccess(actor, orgB.id)).organizationId).toBe(orgB.id);
  });

  it("M4.4 deaktivert i A og aktiv i B: kommer inn, men får ingen tilgang til A", async () => {
    const orgA = await createOrganization("Byggcon oppdiktet A");
    const orgB = await createOrganization("Annet firma oppdiktet B");
    const { user, employee } = await employeeWith("per@byggcon.example", ["admin"], orgA.id);
    await createEmployee(user, orgB.id, ["inspector"]);
    await db
      .update(employees)
      .set({ deactivatedAt: new Date() })
      .where(and(eq(employees.id, employee.id), eq(employees.organizationId, orgA.id)));

    const { response, cookie } = await signInWithMicrosoft(claimsFor("per@byggcon.example"));
    expect(response.headers.get("location")).toBe("/oppdrag");
    const actor = await sessionActor(cookie);
    for (const permission of permissions) {
      await expect(requireOrganizationAccess(actor, orgA.id, permission)).rejects.toBeInstanceOf(
        AccessDeniedError,
      );
    }
    expect(await hasActiveEmployment(user.id)).toBe(true);
  });

  it("M4.4 tenant-isolasjon gjelder også for brukere som er logget inn med Microsoft", async () => {
    let n = 0;
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createIntegrationConnection(grantA.organizationId);
        const b = await createIntegrationConnection(grantB.organizationId);
        return { a: [a.id], b: [b.id] };
      },
      // Logger inn testens bruker med Microsoft og spør som brukeren bak økten
      query: async (actor, organizationId) => {
        n += 1;
        const { cookie } = await signInWithMicrosoft(
          claimsFor(actor.email, { oid: `oid-isolasjon-${n}` }),
        );
        return listConnections(await sessionActor(cookie), organizationId);
      },
      idOf: (row) => row.id,
    });
  });

  it("M4.5 ansatt deaktivert mellom første og andre innlogging avvises på den andre", async () => {
    const { user, employee } = await employeeWith("per@byggcon.example");
    expect(await hasActiveEmployment(user.id)).toBe(true);
    await signInWithMicrosoft(claimsFor("per@byggcon.example"));
    await db
      .update(employees)
      .set({ deactivatedAt: new Date() })
      .where(eq(employees.id, employee.id));
    expect(await hasActiveEmployment(user.id)).toBe(false);
    expectRejected((await signInWithMicrosoft(claimsFor("per@byggcon.example"))).response);
    expect(await count(sessions)).toBe(1);
  });
});

describe("M5 admin stenges aldri ute (regel 11)", () => {
  it("M5.1/M5.4 admin avvist hos Microsoft (feil tid) logger fortsatt inn med kode", async () => {
    const { user } = await employeeWith("admin@byggcon.example", ["admin"]);
    await signInWithMicrosoft(claimsFor("admin@byggcon.example"));
    expectRejected(
      (await signInWithMicrosoft(claimsFor("admin@byggcon.example", { tid: OTHER_TENANT })))
        .response,
    );
    const cookie = await signInWithCode("admin@byggcon.example");
    expect((await sessionActor(cookie)).id).toBe(user.id);
  });
});

describe("M6.1 stengte endepunkter", () => {
  it.each([
    "/link-social",
    "/unlink-account",
    "/refresh-token",
    "/get-access-token",
    "/account-info",
  ])(
    "%s gir 404 med gyldig økt, både POST og GET, og ingen rad i accounts endres",
    async (route) => {
      await employeeWith("kari@byggcon.example");
      const { cookie } = await signInWithMicrosoft(claimsFor("kari@byggcon.example"));
      const before = JSON.stringify(await db.select().from(accounts));

      const body = { providerId: "microsoft", provider: "microsoft", accountId: OID };
      expect((await post(route, body, cookie)).status).toBe(404);
      expect((await get(`${route}?providerId=microsoft&accountId=${OID}`, cookie)).status).toBe(
        404,
      );
      expect(JSON.stringify(await db.select().from(accounts))).toBe(before);
    },
  );
});

describe("M7.1 logg uten personopplysninger", () => {
  it("ingen logglinje har e-post, oid, tid, klient-id, hemmelighet eller token", async () => {
    const lines: string[] = [];
    for (const level of ["debug", "info", "warn", "error"] as const) {
      vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
        lines.push(JSON.stringify(args));
      });
    }
    const { user } = await employeeWith("kari@byggcon.example");
    // Godkjent, ukjent, feil tenant, gjest, utløpt, deaktivert
    await signInWithMicrosoft(claimsFor("kari@byggcon.example"));
    await signInWithMicrosoft(claimsFor("ukjent@byggcon.example", { oid: OTHER_OID }));
    await signInWithMicrosoft(claimsFor("kari@byggcon.example", { tid: OTHER_TENANT }));
    await signInWithMicrosoft(claimsFor("kari@byggcon.example", { idp: "live.com" }));
    await signInWithMicrosoft(claimsFor("kari@byggcon.example", { exp: 1 }));
    await db
      .update(employees)
      .set({ deactivatedAt: new Date() })
      .where(eq(employees.userId, user.id));
    await signInWithMicrosoft(claimsFor("kari@byggcon.example"));

    const all = lines.join("\n");
    expect(all).toContain("Microsoft-innlogging godkjent");
    expect(all).toContain(user.id);
    for (const reason of [
      "wrong_tenant",
      "guest_account",
      "invalid_token",
      "no_active_employment",
    ]) {
      expect(all).toContain(reason);
    }
    for (const secret of [
      "kari@byggcon.example",
      "ukjent@byggcon.example",
      "byggcon.example",
      OID,
      OTHER_OID,
      TENANT,
      OTHER_TENANT,
      CLIENT,
      CLIENT_SECRET,
      ACCESS_TOKEN,
      REFRESH_TOKEN,
      ...issuedIdTokens,
    ]) {
      expect(all).not.toContain(secret);
    }
  });
});

describe("M8.1 ingenting slettes permanent", () => {
  it("antall rader i users, accounts, sessions og employees bare øker gjennom godkjente og avviste innlogginger", async () => {
    const { employee } = await employeeWith("kari@byggcon.example");
    await createUser({ email: "gammel@byggcon.example" });
    let previous = await counts();
    const steps: (() => Promise<unknown>)[] = [
      () => signInWithMicrosoft(claimsFor("kari@byggcon.example")),
      () => signInWithMicrosoft(claimsFor("kari@byggcon.example")),
      () => signInWithMicrosoft(claimsFor("ukjent@byggcon.example", { oid: "oid-ukjent" })),
      () => signInWithMicrosoft(claimsFor("kari@byggcon.example", { tid: OTHER_TENANT })),
      () => signInWithMicrosoft(claimsFor("kari@byggcon.example", { idp: "live.com" })),
      () => signInWithMicrosoft(claimsFor("gammel@byggcon.example", { oid: OTHER_OID })),
      () =>
        db
          .update(employees)
          .set({ deactivatedAt: new Date() })
          .where(eq(employees.id, employee.id)),
      () => signInWithMicrosoft(claimsFor("kari@byggcon.example")),
    ];
    for (const step of steps) {
      await step();
      const now = await counts();
      expect(now.users).toBeGreaterThanOrEqual(previous.users);
      expect(now.accounts).toBeGreaterThanOrEqual(previous.accounts);
      expect(now.sessions).toBeGreaterThanOrEqual(previous.sessions);
      expect(now.employees).toBe(previous.employees);
      previous = now;
    }
    expect(previous.accounts).toBe(1);
    expect(previous.sessions).toBe(2);
  });
});
