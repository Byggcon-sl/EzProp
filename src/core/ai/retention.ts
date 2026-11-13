import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requireOrganizationAccess, type Actor } from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { db, type DbExecutor } from "@/db/client";
import { organizations, type AiSuggestionStatus } from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import { AI_RETENTION_YEARS_ERROR, AiRetentionValidationError } from "./errors";
import { AI_USAGE_RETENTION_YEARS, addYears } from "./usage-log";

/*
 * Oppbevaringstid for KI-loggen (K7, A272–A275, endrer A157). Avviste forslag står så mange år
 * som innstillingen `ai.rejected_retention_years` sier (1–10, standard 10). Alt annet (forslag,
 * godtatt, endret, sperret, feil) står alltid 10 år. Datoen regnes bare her (`retainUntilFor`),
 * fra radens egen `created_at`, og bare fremover: en endring av innstillingen rører ikke rader som
 * allerede har fått dato (A273). Ingenting slettes.
 */

export const AI_REJECTED_RETENTION_KEY = "ai.rejected_retention_years";
export const AI_REJECTED_RETENTION_MIN = 1;
export const AI_REJECTED_RETENTION_MAX = 10;

function settingsRecord(settings: unknown): Record<string, unknown> | null {
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) return null;
  return settings as Record<string, unknown>;
}

/**
 * Leser antall år for avviste forslag. Mangler nøkkelen, gir det 10 uten advarsel. Er verdien
 * ugyldig (ikke et heltall fra 1 til 10, eller `settings` er ikke et objekt), gir det 10 og en
 * advarsel med bare organisasjon og nøkkel, aldri verdien.
 */
export function readRejectedRetentionYears(organizationId: string, settings: unknown): number {
  const record = settingsRecord(settings);
  if (record && !Object.prototype.hasOwnProperty.call(record, AI_REJECTED_RETENTION_KEY)) {
    return AI_USAGE_RETENTION_YEARS;
  }
  const value = record?.[AI_REJECTED_RETENTION_KEY];
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < AI_REJECTED_RETENTION_MIN ||
    value > AI_REJECTED_RETENTION_MAX
  ) {
    logger.warn("Ugyldig verdi i innstillingen, bruker standard (10 år)", {
      organizationId,
      key: AI_REJECTED_RETENTION_KEY,
    });
    return AI_USAGE_RETENTION_YEARS;
  }
  return value;
}

/**
 * Når raden tidligst kan fjernes. `rejected` bruker innstillingen; alle andre statuser (og
 * `null` for sperret eller feil) gir 10 år. Regnes alltid fra `createdAt`.
 */
export function retainUntilFor(
  status: AiSuggestionStatus | null,
  createdAt: Date,
  rejectedYears: number,
): Date {
  return addYears(createdAt, status === "rejected" ? rejectedYears : AI_USAGE_RETENTION_YEARS);
}

/**
 * Leser innstillingen inne i en transaksjon. Kalles bare med `grant.organizationId`, aldri med en
 * id fra raden eller skjemaet.
 */
export async function loadRejectedRetentionYears(
  executor: DbExecutor,
  organizationId: string,
): Promise<number> {
  const [organization] = await executor
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  return readRejectedRetentionYears(organizationId, organization?.settings ?? {});
}

/** Leser innstillingen for adminsiden. Bare admin (`organization.manage`). */
export async function getAiRetentionSettings(
  actor: Actor,
  organizationId: string,
): Promise<{ rejectedRetentionYears: number }> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  return {
    rejectedRetentionYears: await loadRejectedRetentionYears(db, grant.organizationId),
  };
}

/** Skjemaet for lagring. Tekst fra skjemaet trimmes og må være bare sifre. */
export const aiRetentionSettingsSchema = z.object({
  rejectedRetentionYears: z
    .union([
      z
        .string()
        .trim()
        .regex(/^\d+$/, AI_RETENTION_YEARS_ERROR)
        .transform((value) => Number(value)),
      z.number(),
    ])
    .pipe(
      z
        .number()
        .int(AI_RETENTION_YEARS_ERROR)
        .min(AI_REJECTED_RETENTION_MIN, AI_RETENTION_YEARS_ERROR)
        .max(AI_REJECTED_RETENTION_MAX, AI_RETENTION_YEARS_ERROR),
    ),
});

/**
 * Lagrer antall år for avviste forslag. Bare admin (`organization.manage`). Tallet slås sammen
 * med de andre nøklene (`settings || …`) under radlås, så ingen nøkkel går tapt. Er tallet det
 * samme som før (ugyldig eller manglende verdi teller som 10), skrives ingenting og revisjonsloggen
 * får ingen rad (A275). Ellers får revisjonsloggen nøkkelen og gammel og ny verdi, bare tall.
 */
export async function saveAiRetentionSettings(
  actor: Actor,
  organizationId: string,
  input: unknown,
): Promise<{ rejectedRetentionYears: number; changed: boolean }> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  const parsed = aiRetentionSettingsSchema.safeParse(input);
  if (!parsed.success) {
    throw new AiRetentionValidationError({ rejectedRetentionYears: AI_RETENTION_YEARS_ERROR });
  }
  const next = parsed.data.rejectedRetentionYears;

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, grant.organizationId))
      .for("update");
    if (!row) throw new Error("Fant ikke organisasjonen.");
    const old = readRejectedRetentionYears(grant.organizationId, row.settings);
    if (old === next) return { rejectedRetentionYears: next, changed: false };

    const patch = { [AI_REJECTED_RETENTION_KEY]: next };
    await tx
      .update(organizations)
      .set({ settings: sql`${organizations.settings} || ${JSON.stringify(patch)}::jsonb` })
      .where(eq(organizations.id, grant.organizationId));
    await recordAuditEvent(tx, grant, {
      entityType: "organization",
      entityId: grant.organizationId,
      action: "update",
      changes: { key: AI_REJECTED_RETENTION_KEY, old, new: next },
    });
    return { rejectedRetentionYears: next, changed: true };
  });
}
