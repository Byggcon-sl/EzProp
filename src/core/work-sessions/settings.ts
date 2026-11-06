import { eq, sql } from "drizzle-orm";
import { requireOrganizationAccess, type Actor } from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { db } from "@/db/client";
import { organizations } from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import { TimeTrackingValidationError } from "./errors";
import {
  timeTrackingBaselineSchema,
  timeTrackingSettingsSchema,
  type TimeTrackingBaseline,
} from "./schemas";

/*
 * Innstillingene for tidsmåling i `organizations.settings` (A121, A123). Lagringen slår sammen
 * med de andre nøklene og overskriver dem aldri, slik at for eksempel
 * `access.inspectors_edit_all` aldri endres i det stille.
 */

export const TIME_TRACKING_ENABLED_KEY = "time_tracking.enabled";
export const TIME_TRACKING_BASELINE_KEY = "time_tracking.baseline";

function settingsRecord(settings: unknown): Record<string, unknown> | null {
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) return null;
  return settings as Record<string, unknown>;
}

/**
 * Leser `time_tracking.enabled`. Standard på: bare boolean `false` slår målingen av. Er verdien
 * noe annet enn boolean, logges en advarsel (bare organisasjon og nøkkel).
 */
export function readTimeTrackingEnabled(organizationId: string, settings: unknown): boolean {
  const record = settingsRecord(settings);
  if (!record || !Object.prototype.hasOwnProperty.call(record, TIME_TRACKING_ENABLED_KEY)) {
    return true;
  }
  const value = record[TIME_TRACKING_ENABLED_KEY];
  if (typeof value !== "boolean") {
    logger.warn("Ugyldig verdi i innstillingen, bruker standard (på)", {
      organizationId,
      key: TIME_TRACKING_ENABLED_KEY,
    });
    return true;
  }
  return value;
}

/** Leser nullpunktet fra IVIT. Mangler det eller er det ugyldig, gir det `null`. */
export function readTimeTrackingBaseline(settings: unknown): TimeTrackingBaseline | null {
  const record = settingsRecord(settings);
  if (!record) return null;
  const parsed = timeTrackingBaselineSchema.safeParse(record[TIME_TRACKING_BASELINE_KEY]);
  return parsed.success ? parsed.data : null;
}

/**
 * Lagrer bryteren «Mål tid» og/eller nullpunktet. Bare admin (`organization.manage`). Én
 * spørring slår de nye nøklene sammen med de som står (`settings || …`), så samtidige lagringer
 * ikke mister hverandres nøkler. Revisjonsloggen får bare nøkkelnavnene. Gir den oppdaterte
 * organisasjonsraden.
 */
export async function saveTimeTrackingSettings(
  actor: Actor,
  organizationId: string,
  input: unknown,
): Promise<typeof organizations.$inferSelect> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  const parsed = timeTrackingSettingsSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".") || "form";
      fieldErrors[path] ??= issue.message;
    }
    throw new TimeTrackingValidationError(fieldErrors);
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.enabled !== undefined) patch[TIME_TRACKING_ENABLED_KEY] = parsed.data.enabled;
  if (parsed.data.baseline !== undefined) patch[TIME_TRACKING_BASELINE_KEY] = parsed.data.baseline;
  const changedKeys = Object.keys(patch).sort();

  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(organizations)
      .set({ settings: sql`${organizations.settings} || ${JSON.stringify(patch)}::jsonb` })
      .where(eq(organizations.id, grant.organizationId))
      .returning();
    if (!row) throw new Error("Fant ikke organisasjonen.");
    await recordAuditEvent(tx, grant, {
      entityType: "organization",
      entityId: grant.organizationId,
      action: "update",
      changes: { settings: changedKeys },
    });
    return row;
  });
}
