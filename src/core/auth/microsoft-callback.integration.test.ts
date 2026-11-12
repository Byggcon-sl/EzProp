import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { accounts, employees, organizations, sessions, users } from "@/db/schema";
import { getEnv, resetEnvCache } from "@/shared/config/env";
import {
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";

/*
 * Utviklerens røyktest for Microsoft-innloggingen gjennom Better Auth (`auth.handler`), med falsk
 * token-adresse. Viser at leverandøren, profilsjekken og ansattsjekken er koblet inn, og at
 * tokens ikke lagres. Den fulle testplanen (M1–M8) ligger i testskriverens filer.
 * Oppdiktede verdier; ingen nettverk.
 *
 * Støtter hovedmål de ansatte (rett inn uten kode) og regel 11 (koden er uendret).
 */

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const BASE_URL = getEnv().BETTER_AUTH_URL;
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;

type Auth = typeof import("./auth").auth;
let auth: Auth;
let idTokenClaims: Record<string, unknown> = {};
const fetchedUrls: string[] = [];

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** Usignert ID-token (signaturen sjekkes ikke; tokenet kommer rett fra token-adressen). */
function idToken(claims: Record<string, unknown>): string {
  return `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url(claims)}.c2ln`;
}

function claimsFor(email: string, overrides: Record<string, unknown> = {}) {
  return {
    aud: CLIENT,
    iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
    exp: Math.floor(Date.now() / 1000) + 3600,
    tid: TENANT,
    oid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email,
    name: "Navn Fra Microsoft",
    ...overrides,
  };
}

async function signInWithMicrosoft(): Promise<Response> {
  const start = await auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL },
      body: JSON.stringify({ provider: "microsoft", callbackURL: "/oppdrag" }),
    }),
  );
  expect(start.status).toBe(200);
  const { url } = (await start.json()) as { url: string };
  const authorize = new URL(url);
  expect(authorize.origin + authorize.pathname).toBe(
    `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`,
  );
  expect(authorize.searchParams.get("scope")).toBe("openid profile email");
  expect(authorize.searchParams.get("prompt")).toBeNull();
  const state = authorize.searchParams.get("state") ?? "";
  const cookie = start.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return auth.handler(
    new Request(`${BASE_URL}/api/auth/callback/microsoft?code=kode-1&state=${state}`, {
      headers: { cookie, origin: BASE_URL },
    }),
  );
}

async function count(table: typeof users | typeof accounts | typeof sessions) {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(table);
  return row?.n ?? 0;
}

beforeAll(async () => {
  vi.stubEnv("MS_LOGIN_TENANT_ID", TENANT);
  vi.stubEnv("MS_LOGIN_CLIENT_ID", CLIENT);
  vi.stubEnv("MS_LOGIN_CLIENT_SECRET", "test-ms-login-secret");
  resetEnvCache();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    fetchedUrls.push(url);
    if (url !== TOKEN_URL) throw new Error("ukjent adresse i testen");
    return new Response(
      JSON.stringify({
        access_token: "falsk-tilgang",
        refresh_token: "falsk-fornyelse",
        id_token: idToken(idTokenClaims),
        token_type: "Bearer",
        expires_in: 3600,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  vi.resetModules();
  auth = (await import("./auth")).auth;
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
});

describe("Microsoft-innlogging gjennom Better Auth", () => {
  it("aktiv ansatt kommer inn; konto-id er oid, navn er uendret og tokens lagres ikke", async () => {
    const org = await createOrganization();
    const user = await createUser({ name: "Ola Testesen", email: "ola@byggcon.example" });
    await createEmployee(user, org.id, ["inspector"]);
    idTokenClaims = claimsFor("  Ola@Byggcon.Example ");

    const response = await signInWithMicrosoft();
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/oppdrag");

    const [account] = await db.select().from(accounts).where(eq(accounts.userId, user.id));
    expect(account?.providerId).toBe("microsoft");
    expect(account?.accountId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(account?.accessToken).toBeNull();
    expect(account?.refreshToken).toBeNull();
    expect(account?.idToken).toBeNull();
    expect(await count(sessions)).toBe(1);
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row?.name).toBe("Ola Testesen");
    expect(row?.lastLoginAt).not.toBeNull();

    // Andre gang: samme konto, ny økt, fortsatt ingen tokens
    const again = await signInWithMicrosoft();
    expect(again.status).toBe(302);
    expect(await count(accounts)).toBe(1);
    expect(await count(sessions)).toBe(2);
    const [after] = await db.select().from(accounts).where(eq(accounts.userId, user.id));
    expect(after?.accessToken).toBeNull();
    expect(after?.idToken).toBeNull();
    expect(fetchedUrls.every((url) => url === TOKEN_URL)).toBe(true);
  });

  it.each([
    ["feil tid", { tid: OTHER_TENANT }],
    ["feil aud", { aud: "44444444-4444-4444-8444-444444444444" }],
    ["feil iss", { iss: `https://login.microsoftonline.com/${OTHER_TENANT}/v2.0` }],
    ["utløpt", { exp: Math.floor(Date.now() / 1000) - 10 }],
    ["gjest", { preferred_username: "ola_byggcon.example#EXT#@byggcon.example" }],
  ])("%s avvises uten kobling og økt", async (_label, overrides) => {
    const org = await createOrganization();
    const user = await createUser({ email: "kari@byggcon.example" });
    await createEmployee(user, org.id, ["inspector"]);
    idTokenClaims = claimsFor("kari@byggcon.example", overrides);

    const response = await signInWithMicrosoft();
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toMatch(/^\/logg-inn\?error=/);
    expect(await count(accounts)).toBe(0);
    expect(await count(sessions)).toBe(0);
  });

  it("ukjent adresse avvises og lager ingen bruker", async () => {
    idTokenClaims = claimsFor("ukjent@byggcon.example");
    const before = await count(users);
    const response = await signInWithMicrosoft();
    expect(response.headers.get("location")).toMatch(/^\/logg-inn\?error=/);
    expect(await count(users)).toBe(before);
    expect(await count(accounts)).toBe(0);
    expect(await count(sessions)).toBe(0);
  });

  it("deaktivert etter kobling: ingen ny økt, kontoen står", async () => {
    const org = await createOrganization();
    const user = await createUser({ email: "per@byggcon.example" });
    const employee = await createEmployee(user, org.id, ["inspector"]);
    idTokenClaims = claimsFor("per@byggcon.example");
    await signInWithMicrosoft();
    expect(await count(sessions)).toBe(1);

    await db
      .update(employees)
      .set({ deactivatedAt: new Date() })
      .where(eq(employees.id, employee.id));
    const response = await signInWithMicrosoft();
    expect(response.headers.get("location")).toMatch(/^\/logg-inn\?error=/);
    expect(await count(sessions)).toBe(1);
    expect(await count(accounts)).toBe(1);
  });

  it("ansatt bare i slettet organisasjon kobles ikke", async () => {
    const org = await createOrganization();
    const user = await createUser({ email: "lise@byggcon.example" });
    await createEmployee(user, org.id, ["admin"]);
    await db
      .update(organizations)
      .set({ deletedAt: new Date() })
      .where(eq(organizations.id, org.id));
    idTokenClaims = claimsFor("lise@byggcon.example");
    const response = await signInWithMicrosoft();
    expect(response.headers.get("location")).toMatch(/^\/logg-inn\?error=/);
    expect(await count(accounts)).toBe(0);
    expect(await count(sessions)).toBe(0);
  });

  it.each(["/link-social", "/unlink-account", "/refresh-token", "/get-access-token"])(
    "%s er stengt",
    async (route) => {
      const response = await auth.handler(
        new Request(`${BASE_URL}/api/auth${route}`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: BASE_URL },
          body: JSON.stringify({ providerId: "microsoft", provider: "microsoft" }),
        }),
      );
      expect(response.status).toBe(404);
    },
  );

  it("sign-in/social med idToken eller annen leverandør er stengt", async () => {
    for (const body of [
      { provider: "microsoft", idToken: { token: idToken(claimsFor("a@byggcon.example")) } },
      { provider: "google" },
    ]) {
      const response = await auth.handler(
        new Request(`${BASE_URL}/api/auth/sign-in/social`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: BASE_URL },
          body: JSON.stringify(body),
        }),
      );
      expect(response.status).toBe(404);
    }
  });

  it("ekstern callbackURL avvises", async () => {
    for (const callbackURL of ["https://evil.example", "//evil.example", "/\\evil.example"]) {
      const response = await auth.handler(
        new Request(`${BASE_URL}/api/auth/sign-in/social`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: BASE_URL },
          body: JSON.stringify({ provider: "microsoft", callbackURL }),
        }),
      );
      expect(response.status).toBe(403);
    }
  });
});
