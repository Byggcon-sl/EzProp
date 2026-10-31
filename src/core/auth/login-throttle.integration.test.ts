import { readFileSync } from "node:fs";
import path from "node:path";
import { and, count, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emailTransport, readDevMailbox } from "@/core/email";
import { db } from "@/db/client";
import { loginAttempts, sessions, verifications } from "@/db/schema";
import { getEnv } from "@/shared/config/env";
import { logger } from "@/shared/lib/logger";
import {
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { auth } from "./auth";
import {
  MAX_CODE_REQUESTS,
  MAX_FAILED_CODES,
  THROTTLE_WINDOW_MS,
  hashEmail,
  normalizeEmail,
  type LoginAttemptKind,
} from "./login-throttle";

/*
 * Integrasjonstester for innloggingssperren gjennom Better Auth (auth.handler), så det er vist at
 * krokene i auth.ts er koblet inn. Testplan: docs/funksjoner/fase0b-sperre-innlogging-testplan.md
 * avsnitt 2 (test a–n).
 *
 * Hvorfor ikke expectTenantIsolation: `login_attempts` har ingen organisasjons-ID. Før innlogging
 * vet vi ikke hvilken organisasjon personen hører til, og tabellen leses bare av sperresjekken (per
 * e-postadresse, som HMAC). Det finnes altså ingen spørring som tar `organizationId`. Test g viser
 * at tabellen ikke har `organization_id`, og test l viser at en sperre på én adresse ikke rører en
 * annen, verken i samme eller i en annen organisasjon. Til sammen erstatter de isolasjonstesten.
 *
 * Tid flyttes ved å tilbakedatere `created_at` i `login_attempts`, aldri ved å vente.
 * Testdata er oppdiktet (eksempel.no).
 */

// n) Testene skal aldri sende e-post til ekte mottakere
if (emailTransport() !== "devMailbox") {
  throw new Error("Testene skal bare bruke utviklings-postkassen (DEV_MAILBOX=1).");
}

const BASE = "http://localhost:3000";
const REQUEST_CODE_PATH = "/email-otp/send-verification-otp";
const SIGN_IN_PATH = "/sign-in/email-otp";
const WRONG_CODE = "000000";

const FAILED_MESSAGE = /^For mange feil koder\. Du kan prøve igjen kl\. \d{2}:\d{2}\.$/;
const REQUESTS_MESSAGE = /^For mange koder bestilt\. Du kan be om ny kode kl\. \d{2}:\d{2}\.$/;

function post(authPath: string, body: unknown) {
  return auth.handler(
    new Request(`${BASE}/api/auth${authPath}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify(body),
    }),
  );
}

const requestCode = (email: string) => post(REQUEST_CODE_PATH, { email, type: "sign-in" });
const signIn = (email: string, otp: string) => post(SIGN_IN_PATH, { email, otp });

async function messageOf(response: Response): Promise<string> {
  return ((await response.json()) as { message: string }).message;
}

/** Nyeste kode til adressen fra utviklings-postkassen (nyeste først). */
function latestCode(email: string): string {
  const mail = readDevMailbox().find((m) => m.to === normalizeEmail(email));
  const code = /: (\d{6})$/.exec(mail?.subject ?? "")?.[1];
  if (!code) throw new Error("fant ingen kode i utviklings-postkassen");
  return code;
}

function mailsTo(email: string): number {
  return readDevMailbox().filter((m) => m.to === normalizeEmail(email)).length;
}

function hasSessionCookie(response: Response): boolean {
  return (response.headers.get("set-cookie") ?? "").includes("session_token");
}

async function sessionCount(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(sessions);
  return row!.n;
}

async function verificationCount(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(verifications);
  return row!.n;
}

async function attemptCount(kind?: LoginAttemptKind): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(loginAttempts)
    .where(kind ? eq(loginAttempts.kind, kind) : undefined);
  return row!.n;
}

async function attemptCountFor(email: string, kind?: LoginAttemptKind): Promise<number> {
  const emailHash = hashEmail(email, getEnv().BETTER_AUTH_SECRET);
  const [row] = await db
    .select({ n: count() })
    .from(loginAttempts)
    .where(
      kind
        ? and(eq(loginAttempts.emailHash, emailHash), eq(loginAttempts.kind, kind))
        : eq(loginAttempts.emailHash, emailHash),
    );
  return row!.n;
}

/** Flytter alle forsøk (eller ett slag) bakover i tid, i stedet for å vente. */
async function backdateAttempts(ms: number, kind?: LoginAttemptKind) {
  const seconds = ms / 1000;
  if (kind) {
    await db.execute(
      sql`update login_attempts set created_at = created_at - make_interval(secs => ${seconds}) where kind = ${kind}`,
    );
  } else {
    await db.execute(
      sql`update login_attempts set created_at = created_at - make_interval(secs => ${seconds})`,
    );
  }
}

/** En kjent adresse: bruker og ansatt i organisasjonen (ny organisasjon hvis ingen er gitt). */
async function knownEmployee(
  email: string,
  organizationId?: string,
  roles: Parameters<typeof createEmployee>[2] = ["inspector"],
) {
  const orgId = organizationId ?? (await createOrganization("Oppdiktet takst AS")).id;
  const user = await createUser({ email });
  await createEmployee(user, orgId, roles);
  return orgId;
}

/**
 * 5 feil koder. Better Auth gir 3 forsøk per kode, så det bestilles ny kode før 1. og 4. feil.
 * Hver feil skal gå til Better Auth (ikke 429), også den 5. (presisering 3).
 */
async function failFiveTimes(email: string) {
  for (let i = 0; i < MAX_FAILED_CODES; i++) {
    if (i % 3 === 0) expect((await requestCode(email)).status).not.toBe(429);
    const response = await signIn(email, WRONG_CODE);
    expect(response.status).not.toBe(429);
    expect(response.status).toBeGreaterThanOrEqual(400);
  }
}

beforeEach(async () => {
  await resetDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("innloggingssperre gjennom Better Auth", () => {
  it("a) 5 feil gir 429 med norsk melding, både på innlogging og bestilling", async () => {
    const email = "ola.a@eksempel.no";
    await knownEmployee(email);

    // Bestill, 3 feil, bestill ny, 2 feil
    expect((await requestCode(email)).status).toBe(200);
    for (let i = 0; i < 3; i++) expect((await signIn(email, WRONG_CODE)).status).not.toBe(429);
    expect((await requestCode(email)).status).toBe(200);
    for (let i = 0; i < 2; i++) expect((await signIn(email, WRONG_CODE)).status).not.toBe(429);

    const sixth = await signIn(email, WRONG_CODE);
    expect(sixth.status).toBe(429);
    const message = await messageOf(sixth);
    expect(message).toMatch(FAILED_MESSAGE);

    const request = await requestCode(email);
    expect(request.status).toBe(429);
    expect(await messageOf(request)).toBe(message);
  });

  it("b) riktig kode under sperren gir 429 og ingen innlogging", async () => {
    const email = "ola.b@eksempel.no";
    await knownEmployee(email);
    await failFiveTimes(email);
    // Koden fra 2. bestilling er brukt 2 av 3 ganger, så den er fortsatt gyldig hos Better Auth
    const code = latestCode(email);
    const before = await sessionCount();

    const response = await signIn(email, code);

    expect(response.status).toBe(429);
    expect(await messageOf(response)).toMatch(FAILED_MESSAGE);
    expect(hasSessionCookie(response)).toBe(false);
    expect(await sessionCount()).toBe(before);
    expect(await attemptCount("login_succeeded")).toBe(0);
  });

  it("c) 6. bestilling gir 429, ingen ny kode og ingen e-post", async () => {
    const email = "ola.c@eksempel.no";
    await knownEmployee(email);
    for (let i = 0; i < MAX_CODE_REQUESTS; i++) {
      expect((await requestCode(email)).status).toBe(200);
    }
    const verificationsBefore = await verificationCount();
    const mailsBefore = mailsTo(email);
    const newestMailBefore = readDevMailbox()[0];
    expect(mailsBefore).toBeGreaterThan(0);

    const sixth = await requestCode(email);

    expect(sixth.status).toBe(429);
    expect(await messageOf(sixth)).toMatch(REQUESTS_MESSAGE);
    expect(await verificationCount()).toBe(verificationsBefore);
    expect(mailsTo(email)).toBe(mailsBefore);
    expect(readDevMailbox()[0]).toEqual(newestMailBefore);
  });

  // Regel 11 (admin stenges aldri ute for godt). Denne testen skal aldri fjernes.
  it("d) admin sperres, og kommer inn igjen av seg selv når sperren går ut", async () => {
    const email = "admin.d@eksempel.no";
    await knownEmployee(email, undefined, ["admin"]);
    await failFiveTimes(email);
    expect((await signIn(email, WRONG_CODE)).status).toBe(429);
    expect((await requestCode(email)).status).toBe(429);

    // 15 minutter går (tilbakedatering, ingen venting)
    await backdateAttempts(THROTTLE_WINDOW_MS);

    expect((await requestCode(email)).status).toBe(200);
    const before = await sessionCount();
    const response = await signIn(email, latestCode(email));
    expect(response.status).toBe(200);
    expect(hasSessionCookie(response)).toBe(true);
    expect(await sessionCount()).toBe(before + 1);
  });

  it("e) riktig kode nullstiller feil og bestillinger uten å slette noe", async () => {
    const email = "ola.e@eksempel.no";
    await knownEmployee(email);

    // 4 bestillinger og 4 feil; siste kode er ubrukt
    const fourAndFour = async () => {
      const steps: (() => Promise<Response>)[] = [
        () => requestCode(email),
        () => signIn(email, WRONG_CODE),
        () => signIn(email, WRONG_CODE),
        () => signIn(email, WRONG_CODE),
        () => requestCode(email),
        () => signIn(email, WRONG_CODE),
        () => requestCode(email),
        () => requestCode(email),
      ];
      for (const step of steps) {
        const before = await attemptCount();
        expect((await step()).status).not.toBe(429);
        // Bare økning, ingen rader slettet
        expect(await attemptCount()).toBe(before + 1);
      }
    };

    await fourAndFour();
    const signedIn = await signIn(email, latestCode(email));
    expect(signedIn.status).toBe(200);
    expect(await attemptCount("login_succeeded")).toBe(1);

    const idsBefore = (await db.select({ id: loginAttempts.id }).from(loginAttempts)).map(
      (r) => r.id,
    );

    // Uten nullstilling ville 8 feil og 8 bestillinger på 15 minutter gitt 429
    await fourAndFour();

    const idsAfter = (await db.select({ id: loginAttempts.id }).from(loginAttempts)).map(
      (r) => r.id,
    );
    expect(idsAfter).toEqual(expect.arrayContaining(idsBefore));
    expect(idsAfter).toHaveLength(idsBefore.length + 8);
    expect(await attemptCount("login_succeeded")).toBe(1);
  });

  it("f) kjent og ukjent adresse får likt 429-svar, og ukjent adresse telles også", async () => {
    const known = "kjent.f@eksempel.no";
    const unknown = "ukjent.f@eksempel.no";
    await knownEmployee(known);
    // Fast tidspunkt for forsøkene, så klokkeslettet i meldingen blir likt
    const fixed = new Date(Math.floor(Date.now() / 60_000) * 60_000 - 60_000);

    // Feilsperre
    for (const email of [known, unknown]) await failFiveTimes(email);
    await db.execute(
      sql`update login_attempts set created_at = ${fixed.toISOString()}::timestamptz`,
    );
    const failedResponses = [await signIn(known, WRONG_CODE), await signIn(unknown, WRONG_CODE)];
    const failedRequestResponses = [await requestCode(known), await requestCode(unknown)];
    for (const pair of [failedResponses, failedRequestResponses]) {
      const [k, u] = pair as [Response, Response];
      expect(k.status).toBe(429);
      expect(u.status).toBe(k.status);
      const [kBody, uBody] = [(await k.json()) as object, (await u.json()) as object];
      expect(Object.keys(uBody).sort()).toEqual(Object.keys(kBody).sort());
      expect(uBody).toEqual(kBody);
      expect((kBody as { message: string }).message).toMatch(FAILED_MESSAGE);
    }
    expect(await attemptCountFor(unknown, "code_failed")).toBe(MAX_FAILED_CODES);

    // Bestillingsgrense, med to nye adresser
    const known2 = "kjent2.f@eksempel.no";
    const unknown2 = "ukjent2.f@eksempel.no";
    await knownEmployee(known2);
    for (const email of [known2, unknown2]) {
      for (let i = 0; i < MAX_CODE_REQUESTS; i++) {
        expect((await requestCode(email)).status).toBe(200);
      }
    }
    await db.execute(
      sql`update login_attempts set created_at = ${fixed.toISOString()}::timestamptz where kind = 'code_requested'`,
    );
    const [k, u] = [await requestCode(known2), await requestCode(unknown2)];
    expect(k.status).toBe(429);
    expect(u.status).toBe(k.status);
    const [kBody, uBody] = [(await k.json()) as object, (await u.json()) as object];
    expect(Object.keys(uBody).sort()).toEqual(Object.keys(kBody).sort());
    expect(uBody).toEqual(kBody);
    expect((kBody as { message: string }).message).toMatch(REQUESTS_MESSAGE);
    expect(await attemptCountFor(unknown2, "code_requested")).toBe(MAX_CODE_REQUESTS);
  });

  it("g) ingen adresse i klartekst, og store bokstaver og mellomrom teller som samme adresse", async () => {
    const columns = await db.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'login_attempts' order by column_name`,
    );
    const names = [...columns].map((c) => c.column_name);
    expect(names).toEqual(["created_at", "email_hash", "id", "kind"]);
    expect(names).not.toContain("organization_id");
    expect(names).not.toContain("email");
    expect(names).not.toContain("ip");

    await knownEmployee("ola@eksempel.no");
    // 3 + 3 bestillinger på samme adresse skrevet ulikt: den 6. avvises
    for (let i = 0; i < 3; i++) {
      expect((await requestCode("Ola@Eksempel.no ")).status).not.toBe(429);
    }
    for (let i = 0; i < 2; i++) {
      expect((await requestCode("ola@eksempel.no")).status).toBe(200);
    }
    const sixth = await requestCode("ola@eksempel.no");
    expect(sixth.status).toBe(429);
    expect(await messageOf(sixth)).toMatch(REQUESTS_MESSAGE);

    const hashes = await db
      .selectDistinct({ emailHash: loginAttempts.emailHash })
      .from(loginAttempts);
    expect(hashes).toEqual([
      { emailHash: hashEmail("ola@eksempel.no", getEnv().BETTER_AUTH_SECRET) },
    ]);

    const allCells = JSON.stringify(await db.select().from(loginAttempts)).toLowerCase();
    expect(allCells).not.toContain("ola@eksempel.no");
    expect(allCells).not.toContain("eksempel");
  });

  it("h) sperren virker med Better Auths rateLimit av, og har ingen miljøbryter", () => {
    // Uten dette er test a–e ugyldige: da kunne det vært Better Auths fartsgrense som ga 429
    expect(auth.options.rateLimit?.enabled).toBe(false);

    const authDir = path.join(process.cwd(), "src/core/auth");
    const throttleSource = readFileSync(path.join(authDir, "login-throttle.ts"), "utf8");
    expect(throttleSource).not.toMatch(/DEV_MAILBOX|NODE_ENV/);

    // Krokene i auth.ts (blokken `hooks: { … }`) leser heller ingen miljøbryter
    const authSource = readFileSync(path.join(authDir, "auth.ts"), "utf8");
    const hooks = bracedBlockAfter(authSource, "hooks:");
    expect(hooks).toContain("before");
    expect(hooks).toContain("after");
    expect(hooks).not.toMatch(/DEV_MAILBOX|NODE_ENV/);
  });

  it("i) forsøk under sperren forlenger den ikke", async () => {
    const email = "ola.i@eksempel.no";
    await knownEmployee(email);
    await failFiveTimes(email);
    for (let i = 0; i < 3; i++) expect((await signIn(email, WRONG_CODE)).status).toBe(429);
    expect(await attemptCount("code_failed")).toBe(MAX_FAILED_CODES);

    await backdateAttempts(THROTTLE_WINDOW_MS, "code_failed");

    expect((await signIn(email, WRONG_CODE)).status).not.toBe(429);
  });

  it("j) 10 samtidige feil innlogginger: nøyaktig 5 slipper gjennom", async () => {
    const email = "ola.j@eksempel.no";
    await knownEmployee(email);
    expect((await requestCode(email)).status).toBe(200);

    const statuses = await Promise.all(
      Array.from({ length: 10 }, () => signIn(email, WRONG_CODE).then((r) => r.status)),
    );

    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
    expect(statuses.filter((s) => s !== 429)).toHaveLength(MAX_FAILED_CODES);
    expect(await attemptCount("code_failed")).toBe(MAX_FAILED_CODES);
  });

  it("j) 10 samtidige bestillinger: nøyaktig 5 slipper gjennom, høyst 5 e-poster", async () => {
    const email = "kari.j@eksempel.no";
    await knownEmployee(email);

    const statuses = await Promise.all(
      Array.from({ length: 10 }, () => requestCode(email).then((r) => r.status)),
    );

    expect(statuses.filter((s) => s === 200)).toHaveLength(MAX_CODE_REQUESTS);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
    expect(await attemptCount("code_requested")).toBe(MAX_CODE_REQUESTS);
    expect(mailsTo(email)).toBeLessThanOrEqual(MAX_CODE_REQUESTS);
  });

  describe("k) andre kode-endepunkter er stengt", () => {
    it.each([
      "/email-otp/check-verification-otp",
      "/email-otp/verify-email",
      "/email-otp/reset-password",
      "/email-otp/request-password-reset",
      "/forget-password/email-otp",
      "/email-otp/finnes-ikke",
    ])("%s gir 404, og koden er fortsatt brukbar etterpå", async (closedPath) => {
      const email = "ola.k@eksempel.no";
      await knownEmployee(email);
      expect((await requestCode(email)).status).toBe(200);
      const code = latestCode(email);

      const response = await post(closedPath, {
        email,
        otp: code,
        type: "sign-in",
        password: "oppdiktet-passord-123",
      });
      expect(response.status).toBe(404);

      const signedIn = await signIn(email, code);
      expect(signedIn.status).toBe(200);
      expect(hasSessionCookie(signedIn)).toBe(true);
    });

    it("motprøve: bestilling, innlogging, get-session og sign-out er åpne", async () => {
      const email = "kari.k@eksempel.no";
      await knownEmployee(email);
      const request = await requestCode(email);
      expect(request.status).toBe(200);
      const signedIn = await signIn(email, latestCode(email));
      expect(signedIn.status).toBe(200);

      const session = await auth.handler(new Request(`${BASE}/api/auth/get-session`));
      expect(session.status).not.toBe(404);
      const signOut = await post("/sign-out", {});
      expect(signOut.status).not.toBe(404);
    });
  });

  describe("l) isolasjon mellom adresser og organisasjoner (erstatter expectTenantIsolation)", () => {
    /** Sperrer `blocked` (bestillinger og feil), og viser at `other` fortsatt kommer inn. */
    async function expectOnlyBlocked(blocked: string, other: string) {
      for (let i = 0; i < MAX_CODE_REQUESTS; i++) {
        expect((await requestCode(blocked)).status).toBe(200);
      }
      for (let i = 0; i < MAX_FAILED_CODES; i++) {
        expect((await signIn(blocked, WRONG_CODE)).status).not.toBe(429);
      }
      expect((await requestCode(blocked)).status).toBe(429);
      expect((await signIn(blocked, WRONG_CODE)).status).toBe(429);

      const before = await sessionCount();
      expect((await requestCode(other)).status).toBe(200);
      const response = await signIn(other, latestCode(other));
      expect(response.status).toBe(200);
      expect(await sessionCount()).toBe(before + 1);
    }

    it("A i organisasjon 1 sperres, B i organisasjon 2 kommer inn", async () => {
      const a = "a.l@eksempel.no";
      const b = "b.l@eksempel.no";
      await knownEmployee(a, (await createOrganization("Oppdiktet takst 1")).id);
      await knownEmployee(b, (await createOrganization("Oppdiktet takst 2")).id);
      await expectOnlyBlocked(a, b);
    });

    it("omvendt: B i organisasjon 2 sperres, A i organisasjon 1 kommer inn", async () => {
      const a = "a.l@eksempel.no";
      const b = "b.l@eksempel.no";
      await knownEmployee(a, (await createOrganization("Oppdiktet takst 1")).id);
      await knownEmployee(b, (await createOrganization("Oppdiktet takst 2")).id);
      await expectOnlyBlocked(b, a);
    });

    it("A og B i samme organisasjon: sperre på A rører ikke B", async () => {
      const orgId = (await createOrganization("Oppdiktet takst felles")).id;
      const a = "a.l@eksempel.no";
      const b = "b.l@eksempel.no";
      await knownEmployee(a, orgId);
      await knownEmployee(b, orgId);
      await expectOnlyBlocked(a, b);
    });
  });

  it("m) sperren logges med rute og tidspunkt, uten adresse og hash", async () => {
    const warn = vi.spyOn(logger, "warn");
    const email = "Logg.M@Eksempel.no";
    const emailHash = hashEmail(email, getEnv().BETTER_AUTH_SECRET);

    for (let i = 0; i < MAX_CODE_REQUESTS; i++) {
      expect((await requestCode(email)).status).toBe(200);
    }
    // Ingen logglinje når forsøket slipper gjennom
    expect(warn).not.toHaveBeenCalled();

    expect((await requestCode(email)).status).toBe(429);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = JSON.stringify(warn.mock.calls[0]);
    expect(line).toContain(REQUEST_CODE_PATH);
    expect(line).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);

    const everything = JSON.stringify(warn.mock.calls);
    expect(everything.toLowerCase()).not.toContain("logg.m@eksempel.no");
    expect(everything).not.toContain("Logg.M@Eksempel.no");
    expect(everything).not.toContain(emailHash);
  });

  it("n) e-post går bare til utviklings-postkassen", () => {
    expect(emailTransport()).toBe("devMailbox");
  });
});

/** Teksten i `{ … }` som følger etter `marker` (teller klammer). Tom tekst hvis ikke funnet. */
function bracedBlockAfter(source: string, marker: string): string {
  const start = source.indexOf("{", source.indexOf(marker));
  if (source.indexOf(marker) < 0 || start < 0) return "";
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") depth--;
    if (depth === 0) return source.slice(start, i + 1);
  }
  return "";
}
