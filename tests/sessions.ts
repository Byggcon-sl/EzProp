import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Actor } from "@/core/access";
import { auth } from "@/core/auth/auth";
import { readDevMailbox } from "@/core/email";
import { db } from "@/db/client";
import { sessions } from "@/db/schema";
import { getEnv } from "@/shared/config/env";

/*
 * Testhjelpere for «Mine innlogginger» (docs/funksjoner/fase2a-mine-innlogginger-testplan.md).
 * Økter settes rett inn i `sessions` med oppdiktet user-agent (merket `SESSION_UA_MARK`) og IP fra
 * dokumentasjonsadressene (192.0.2.x), eller lages gjennom ekte innlogging i Better Auth med kode
 * fra utviklings-postkassen. Ingen ekte enheter, adresser eller personer.
 */

/** Merke i alle oppdiktede user-agenter, så testene kan søke etter rå user-agent i svarene. */
export const SESSION_UA_MARK = "Oppdiktet/9.9";
/** Dokumentasjonsadresse (RFC 5737), aldri en ekte IP. */
export const SESSION_IP = "192.0.2.10";

export const FAKE_UA = {
  iPadSafari: `Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1 ${SESSION_UA_MARK}`,
  windowsEdge: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0 ${SESSION_UA_MARK}`,
  macChrome: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 ${SESSION_UA_MARK}`,
} as const;

export type SessionRow = typeof sessions.$inferSelect;

/** En økt for brukeren, satt rett inn i `sessions`. Standard: aktiv i 7 dager, brukt nå. */
export async function createSession(
  userId: string,
  overrides: Partial<Omit<typeof sessions.$inferInsert, "userId">> = {},
): Promise<SessionRow> {
  const now = new Date();
  const [row] = await db
    .insert(sessions)
    .values({
      id: randomUUID(),
      token: `oppdiktet-token-${randomUUID()}`,
      userAgent: FAKE_UA.iPadSafari,
      ipAddress: SESSION_IP,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + 7 * 86_400_000),
      ...overrides,
      userId,
    })
    .returning();
  if (!row) throw new Error("kunne ikke opprette økt");
  return row;
}

/** Id-ene til øktene som står for brukeren (også utløpte), sortert. */
export async function sessionIdsOf(userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.userId, userId));
  return rows.map((row) => row.id).sort();
}

export async function sessionExists(id: string): Promise<boolean> {
  const rows = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, id));
  return rows.length === 1;
}

export async function allSessionIds(): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`select id from sessions order by id`);
  return Array.from(rows).map((row) => row.id);
}

/** Aktøren med nåværende økt, slik `getCurrentActor` fyller den (avklart punkt 7). */
export function withSession(actor: Actor, sessionId: string): Actor {
  return { ...actor, sessionId } as Actor;
}

// --- Ekte innlogging gjennom Better Auth (som i login-throttle.integration.test.ts) ---

type AuthInit = {
  body?: unknown;
  cookie?: string;
  userAgent?: string;
  method?: "GET" | "POST";
};

/** Kall mot Better Auth over «HTTP» (`auth.handler`). POST uten innhold sender `{}`. */
export async function callAuth(route: string, init: AuthInit = {}): Promise<Response> {
  const baseUrl = getEnv().BETTER_AUTH_URL;
  const method = init.method ?? (init.body === undefined ? "GET" : "POST");
  const headers: Record<string, string> = { origin: baseUrl };
  if (method === "POST") headers["content-type"] = "application/json";
  if (init.cookie) headers.cookie = init.cookie;
  if (init.userAgent) headers["user-agent"] = init.userAgent;
  return auth.handler(
    new Request(`${baseUrl}/api/auth${route}`, {
      method,
      headers,
      body: method === "POST" ? JSON.stringify(init.body ?? {}) : undefined,
    }),
  );
}

function latestCode(email: string): string {
  const to = email.trim().toLowerCase();
  const mail = readDevMailbox().find((entry) => entry.to.toLowerCase() === to);
  const code = /: (\d{6})$/.exec(mail?.subject ?? "")?.[1];
  if (!code) throw new Error("Fant ingen kode i utviklings-postkassen");
  return code;
}

export type LoggedIn = { cookie: string; sessionId: string; token: string };

/**
 * Logger inn med kode gjennom `auth.handler` og gir kapselen («navn=verdi»), økt-id-en og tokenet.
 * Brukeren må finnes og være ansatt.
 */
export async function signInThroughAuth(
  email: string,
  userAgent: string = FAKE_UA.windowsEdge,
): Promise<LoggedIn> {
  const requested = await callAuth("/email-otp/send-verification-otp", {
    body: { email, type: "sign-in" },
    userAgent,
  });
  if (requested.status !== 200) throw new Error(`Bestilling av kode feilet (${requested.status})`);
  const response = await callAuth("/sign-in/email-otp", {
    body: { email, otp: latestCode(email) },
    userAgent,
  });
  if (response.status !== 200) throw new Error(`Innlogging feilet (${response.status})`);
  const cookie = response.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0] ?? "")
    .find((entry) => entry.split("=")[0]?.endsWith("session_token"));
  if (!cookie) throw new Error("Fant ingen innloggingskapsel i svaret");
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error("Innloggingen ga ingen økt");
  return { cookie, sessionId: session.session.id, token: session.session.token };
}

/** Økten for kapselen, eller `null` (ingen cache: slås opp i databasen hver gang). */
export async function sessionForCookie(cookie: string) {
  return auth.api.getSession({ headers: new Headers({ cookie }) });
}

export function clearDevMailbox() {
  (globalThis as unknown as { ezpropDevMailbox?: unknown[] }).ezpropDevMailbox = [];
}
