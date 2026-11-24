import { and, desc, eq, gt, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import {
  AccessDeniedError,
  grantHasPermission,
  requireOrganizationAccess,
  type Actor,
  type EmployeeGrant,
} from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { db, type DbExecutor } from "@/db/client";
import { employees, sessions } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { logger } from "@/shared/lib/logger";
import { describeUserAgent, type BrowserLabel, type DeviceLabel } from "./user-agent";

/*
 * Mine innlogginger (docs/funksjoner/fase2a-mine-innlogginger.md, Omfang 1, 7 og 8).
 *
 * Utlogging er direkte sletting i `sessions` (Better Auths tekniske tabell, unntak fra myk
 * sletting etter ADR 0014 og A429). Better Auths egne økt-endepunkter er stengt i `auth.ts`.
 * Fordi `session.cookieCache` og `secondaryStorage` er av, er en slettet økt ugyldig med en gang.
 *
 * Filen importerer aldri `./auth` (Better Auth skal ikke startes for dette, og kjernen
 * `organization` bruker filen ved deaktivering) og aldri `@/core/ai`: IP og user-agent er
 * persondata. `token` og `ip_address` leses aldri inn; user-agenten gjøres om til faste verdier
 * med `describeUserAgent` før noe forlater filen.
 */

/** Årsak i revisjonsloggen for «Logg ut av alle enheter». Faste koder (regel 6). */
export const SESSION_REVOKE_REASONS = ["manual", "deactivated"] as const;
export type SessionRevokeReason = (typeof SESSION_REVOKE_REASONS)[number];

/** Handlingen i revisjonsloggen når en ansatt logges ut av alle enheter. */
export const SESSIONS_REVOKED_ALL_ACTION = "employee.sessions_revoked_all";

/** Lengdegrense for en økt-id fra skjemaet. */
const SESSION_ID_MAX_LENGTH = 255;
const sessionIdSchema = z.string().min(1).max(SESSION_ID_MAX_LENGTH);

const revokeAllOptionsSchema = z.object({
  confirmSelf: z.literal(true).optional(),
  reason: z.enum(SESSION_REVOKE_REASONS),
});

/** Én egen økt slik profilsiden ser den. Nøyaktig disse feltene. */
export type OwnSession = {
  id: string;
  device: DeviceLabel;
  browser: BrowserLabel;
  lastUsed: Date;
  createdAt: Date;
  isCurrent: boolean;
};

/** Én økt slik admin ser den: bare enhet og nettleser (spørsmål 89, A428). */
export type EmployeeSession = { device: DeviceLabel; browser: BrowserLabel };

export type RevokeOwnSessionResult =
  { ok: true; count: 1 } | { ok: false; reason: "not_found" | "current_session" };

export type ListEmployeeSessionsResult =
  { ok: true; sessions: EmployeeSession[]; count: number } | { ok: false; reason: "not_found" };

export type RevokeAllEmployeeSessionsResult =
  { ok: true; count: number } | { ok: false; reason: "not_found" | "confirm_self_required" };

export type RevokeAllEmployeeSessionsOptions = {
  confirmSelf?: true;
  reason: SessionRevokeReason;
};

/** Vilkår for aktive økter: `expires_at` etter nå (samme klokke som Better Auth bruker). */
function isActive() {
  return gt(sessions.expiresAt, new Date());
}

/**
 * Den innloggedes aktive økter. «Denne enheten» (`actor.sessionId`) først, deretter sist brukt
 * først. Uten `actor.sessionId` får ingen rad `isCurrent`.
 */
export async function listOwnSessions(actor: Actor): Promise<OwnSession[]> {
  const rows = await db
    .select({
      id: sessions.id,
      userAgent: sessions.userAgent,
      updatedAt: sessions.updatedAt,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .where(and(eq(sessions.userId, actor.id), isActive()))
    .orderBy(desc(sessions.updatedAt), desc(sessions.createdAt), sessions.id);

  const result = rows.map((row): OwnSession => {
    const { device, browser } = describeUserAgent(row.userAgent);
    return {
      id: row.id,
      device,
      browser,
      lastUsed: row.updatedAt,
      createdAt: row.createdAt,
      isCurrent: actor.sessionId !== undefined && row.id === actor.sessionId,
    };
  });
  // Stabil sortering: bare «denne enheten» flyttes først
  return result.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
}

/** Én linje i driftsloggen for egen utlogging. Bare handling og antall, ingen persondata. */
function logOwnRevoke(action: "revoke_own_session" | "revoke_other_own_sessions", count: number) {
  logger.info("Egen utlogging av enheter", { action, count });
}

/**
 * Logger ut én av den innloggedes egne økter. Den nåværende avvises (`current_session`); den
 * logges ut med vanlig utlogging. En annens økt, ukjent id og utløpt økt gir samme svar
 * (`not_found`). Ugyldig id (ikke tekst, tom eller for lang) kaster `ZodError` før spørringen.
 */
export async function revokeOwnSession(
  actor: Actor,
  sessionId: unknown,
): Promise<RevokeOwnSessionResult> {
  const id = sessionIdSchema.parse(sessionId);
  if (actor.sessionId !== undefined && id === actor.sessionId) {
    return { ok: false, reason: "current_session" };
  }
  const deleted = await db
    .delete(sessions)
    .where(and(eq(sessions.id, id), eq(sessions.userId, actor.id), isActive()))
    .returning({ id: sessions.id });
  if (deleted.length === 0) return { ok: false, reason: "not_found" };
  logOwnRevoke("revoke_own_session", 1);
  return { ok: true, count: 1 };
}

/**
 * Logger ut alle den innloggedes aktive økter unntatt den nåværende. Utløpte står til ryddingen
 * (`auth-cleanup.ts`). Uten `actor.sessionId` kan den nåværende ikke avgjøres, og da slettes
 * ingenting (feiler lukket, så brukeren aldri logger ut seg selv ved et uhell).
 */
export async function revokeOtherOwnSessions(actor: Actor): Promise<{ ok: true; count: number }> {
  if (actor.sessionId === undefined) return { ok: true, count: 0 };
  const deleted = await db
    .delete(sessions)
    .where(and(eq(sessions.userId, actor.id), isActive(), ne(sessions.id, actor.sessionId)))
    .returning({ id: sessions.id });
  logOwnRevoke("revoke_other_own_sessions", deleted.length);
  return { ok: true, count: deleted.length };
}

/**
 * Den ansatte i organisasjonen fra tilgangssjekken. Ikke slettet, men kan ha sluttet: en som har
 * sluttet, skal fortsatt kunne listes og logges ut. Ugyldig, ukjent og fremmed id gir `null`.
 */
async function findEmployee(executor: DbExecutor, organizationId: string, employeeId: string) {
  if (!isUuid(employeeId)) return null;
  const [employee] = await executor
    .select({ id: employees.id, userId: employees.userId })
    .from(employees)
    .where(
      and(
        eq(employees.id, employeeId),
        eq(employees.organizationId, organizationId),
        isNull(employees.deletedAt),
      ),
    );
  return employee ?? null;
}

/**
 * Aktive økter for en ansatt i egen organisasjon, bare enhet og nettleser (ikke «sist brukt»
 * før Ståle har svart på spørsmål 89). Bare admin (`organization.manage`, A423). Ansatt uten
 * innlogging gir tom liste.
 */
export async function listEmployeeSessions(
  actor: Actor,
  organizationId: string,
  employeeId: string,
): Promise<ListEmployeeSessionsResult> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  const employee = await findEmployee(db, grant.organizationId, employeeId);
  if (!employee) return { ok: false, reason: "not_found" };
  if (!employee.userId) return { ok: true, sessions: [], count: 0 };

  const rows = await db
    .select({ userAgent: sessions.userAgent })
    .from(sessions)
    .where(and(eq(sessions.userId, employee.userId), isActive()))
    .orderBy(desc(sessions.updatedAt), desc(sessions.createdAt), sessions.id);
  const list = rows.map((row): EmployeeSession => {
    const { device, browser } = describeUserAgent(row.userAgent);
    return { device, browser };
  });
  return { ok: true, sessions: list, count: list.length };
}

/**
 * «Logg ut av alle enheter» for en ansatt i egen organisasjon. Bare admin (`organization.manage`).
 * Velger admin seg selv, kreves `confirmSelf: true` (regel 11: ingen logger seg ut ved et uhell).
 * Sletting og revisjonsrad skjer i samme transaksjon (ved deaktivering:
 * `revokeAllEmployeeSessionsIn` i deaktiveringens transaksjon). Revisjonsraden skrives også når antallet er 0, og har bare antall og årsak.
 *
 * Kjent begrensning (A426): `sessions` har ingen organisasjon, så alle brukerens økter slettes,
 * også økter som brukes mot en annen organisasjon. Må vurderes før organisasjon nummer to.
 */
export async function revokeAllEmployeeSessions(
  actor: Actor,
  organizationId: string,
  employeeId: string,
  options: RevokeAllEmployeeSessionsOptions,
): Promise<RevokeAllEmployeeSessionsResult> {
  const parsed = revokeAllOptionsSchema.parse(options);
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  return db.transaction((tx) => revokeAll(tx, actor, grant, employeeId, parsed));
}

/**
 * Som `revokeAllEmployeeSessions`, i transaksjonen til den som kaller (deaktivering). Bruker
 * tilgangen som alt er sjekket (`organization.manage`), og gjør ingen ny sjekk på en annen kobling,
 * så transaksjonen aldri venter på en kobling til fra puljen (funn fra nattløkken 24.11.2026).
 */
export async function revokeAllEmployeeSessionsIn(
  tx: DbExecutor,
  actor: Actor,
  grant: EmployeeGrant,
  employeeId: string,
  options: RevokeAllEmployeeSessionsOptions,
): Promise<RevokeAllEmployeeSessionsResult> {
  if (!grantHasPermission(grant, "organization.manage")) throw new AccessDeniedError();
  return revokeAll(tx, actor, grant, employeeId, revokeAllOptionsSchema.parse(options));
}

async function revokeAll(
  tx: DbExecutor,
  actor: Actor,
  grant: EmployeeGrant,
  employeeId: string,
  { confirmSelf, reason }: RevokeAllEmployeeSessionsOptions,
): Promise<RevokeAllEmployeeSessionsResult> {
  const employee = await findEmployee(tx, grant.organizationId, employeeId);
  if (!employee) return { ok: false, reason: "not_found" };
  if (employee.userId === actor.id && confirmSelf !== true) {
    return { ok: false, reason: "confirm_self_required" };
  }

  let sessionCount = 0;
  if (employee.userId) {
    const deleted = await tx
      .delete(sessions)
      .where(eq(sessions.userId, employee.userId))
      .returning({ expiresAt: sessions.expiresAt });
    // Antallet er aktive økter; utløpte som ryddes samtidig, telles ikke
    const now = Date.now();
    sessionCount = deleted.filter((row) => row.expiresAt.getTime() > now).length;
  }

  await recordAuditEvent(tx, grant, {
    entityType: "employee",
    entityId: employee.id,
    action: SESSIONS_REVOKED_ALL_ACTION,
    changes: { sessionCount, reason },
  });
  return { ok: true, count: sessionCount };
}
