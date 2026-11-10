import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { requireOrganizationAccess, type Actor, type EmployeeGrant } from "@/core/access";
import { AI_FEATURES, type AiSuggestionRequest } from "@/core/ai";
import { db } from "@/db/client";
import { aiUsageLog, auditLog, organizations } from "@/db/schema";
import type { EmployeeRole } from "@/db/schema";
import {
  createEmployee,
  createIntegrationConnection,
  createOrganization,
  createUser,
} from "./factories";

/*
 * Testhjelpere for KI-modulen (docs/funksjoner/fase2a-ki-modul-logg-testplan.md avsnitt 0).
 * Bare i testene. Alle data er oppdiktet.
 */

/** Nøkkelen i `organizations.settings` som slår KI på (kortet, Data). */
export const AI_ENABLED = "ai.enabled";
export const EDIT_ALL = "access.inspectors_edit_all";

/** Oppdiktet tekst til språkvasken. */
export const SAMPLE_TEXT = "taket er gammelt og har noen sprekker";

/** Det ene lovlige målet for `language_polish` (navnene velges av utvikler, kortet Omfang 5). */
export function polishTarget(id: string = randomUUID()) {
  const [allowed] = AI_FEATURES.language_polish.allowedTargets;
  if (!allowed) throw new Error("language_polish har ikke noe lovlig mål");
  return { type: allowed.type, id, fieldKey: allowed.fieldKey };
}

/** Den ene feltkoden på tillatt-listen for `language_polish`. */
export function polishField(): string {
  const [field] = AI_FEATURES.language_polish.allowedFields;
  if (!field) throw new Error("language_polish har tom tillatt-liste");
  return field;
}

/** En gyldig forespørsel om språkvask. Ny `requestId` og nytt mål hvis ikke overstyrt. */
export function polishRequest(overrides: Partial<AiSuggestionRequest> = {}): AiSuggestionRequest {
  return {
    requestId: randomUUID(),
    feature: "language_polish",
    assignmentId: null,
    reportId: null,
    target: polishTarget(),
    fields: { [polishField()]: SAMPLE_TEXT },
    ...overrides,
  };
}

/** Setter én nøkkel i `organizations.settings` og lar de andre stå. */
export async function setOrganizationSetting(organizationId: string, key: string, value: unknown) {
  await db
    .update(organizations)
    .set({
      settings: sql`coalesce(${organizations.settings}, '{}'::jsonb) || ${JSON.stringify({ [key]: value })}::jsonb`,
    })
    .where(eq(organizations.id, organizationId));
}

type EnableAiOptions = {
  /** Verdien i `ai.enabled`. `undefined` lar nøkkelen mangle. Standard `true`. */
  enabled?: unknown;
  /** `null` lager ingen tilkobling. Standard `fake`. */
  provider?: string | null;
  status?: string;
  deletedAt?: Date | null;
};

/** Slår KI på (eller ikke) og lager tilkoblingen på porten `ai` med fabrikken. */
export async function enableAi(organizationId: string, options: EnableAiOptions = {}) {
  const enabled = "enabled" in options ? options.enabled : true;
  if (enabled !== undefined) await setOrganizationSetting(organizationId, AI_ENABLED, enabled);
  const provider = options.provider === undefined ? "fake" : options.provider;
  if (provider === null) return null;
  return createIntegrationConnection(organizationId, {
    port: "ai",
    provider,
    status: options.status ?? "active",
    deletedAt: options.deletedAt ?? null,
  });
}

export type Member = {
  actor: Actor;
  employeeId: string;
  grant: EmployeeGrant;
};

/** En ansatt med rollene i organisasjonen, og grant fra tilgangslaget. */
export async function addMember(
  organizationId: string,
  roles: EmployeeRole[],
  name = "Test Takstmann",
): Promise<Member> {
  const actor = await createUser({ name });
  const employee = await createEmployee(actor, organizationId, roles);
  const grant = await requireOrganizationAccess(actor, organizationId);
  return { actor, employeeId: employee.id, grant };
}

/** Henter grant på nytt (etter at roller, innstillinger eller rettigheter er endret). */
export async function regrant(member: Member, organizationId: string) {
  return requireOrganizationAccess(member.actor, organizationId);
}

/** En organisasjon med KI på (`fake`) og én takstmann. */
export async function aiOrganization(name = "Prøvefirma takst") {
  const organization = await createOrganization(name);
  await enableAi(organization.id);
  const inspector = await addMember(organization.id, ["inspector"]);
  return { organization, inspector };
}

export async function usageRow(id: string) {
  const [row] = await db.select().from(aiUsageLog).where(eq(aiUsageLog.id, id));
  return row ?? null;
}

export async function usageRows(organizationId?: string) {
  return organizationId === undefined
    ? db.select().from(aiUsageLog)
    : db.select().from(aiUsageLog).where(eq(aiUsageLog.organizationId, organizationId));
}

export async function usageCount(): Promise<number> {
  return (await db.select().from(aiUsageLog)).length;
}

export async function auditRows(organizationId?: string) {
  return organizationId === undefined
    ? db.select().from(auditLog)
    : db.select().from(auditLog).where(eq(auditLog.organizationId, organizationId));
}

export async function auditCount(): Promise<number> {
  return (await db.select().from(auditLog)).length;
}

/** Linjene i `audit_log` for én rad i `ai_usage_log`. */
export async function auditFor(usageId: string) {
  return db.select().from(auditLog).where(eq(auditLog.entityId, usageId));
}
