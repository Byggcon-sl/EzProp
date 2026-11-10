import { and, eq, isNull } from "drizzle-orm";
import type { EmployeeGrant } from "@/core/access";
import { findActiveConnection } from "@/core/integrations/connections";
import { db } from "@/db/client";
import { organizations } from "@/db/schema";
import { FAKE_MODEL, fakeAiProvider } from "./providers/fake";
import type { AiProvider } from "./types";

/*
 * Valg av leverandør, én vei (A160): bare en aktiv tilkobling med porten `ai` i organisasjonen
 * til den innloggede, og bare når `ai.enabled` er `true`. Status `error` regnes som aktiv, som i
 * `findActiveConnection` (bare siste kall feilet). Miljøvariabler og `NODE_ENV` leses aldri.
 */

/** Flat nøkkel i `organizations.settings`, samme form som `access.inspectors_edit_all`. */
export const AI_ENABLED_KEY = "ai.enabled";

export type ResolvedAiProvider = { provider: AiProvider; model: string };

/** Adapterne koden kjenner. Bare `fake` før S8. */
const ADAPTERS: Readonly<Record<string, ResolvedAiProvider>> = {
  fake: { provider: fakeAiProvider, model: FAKE_MODEL },
};

/** Bare boolsk `true` slår KI på. Mangler nøkkelen, eller er verdien noe annet, er KI av. */
function readAiEnabled(settings: unknown): boolean {
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) return false;
  return (settings as Record<string, unknown>)[AI_ENABLED_KEY] === true;
}

/** Leverandøren for organisasjonen, eller `null` når KI er av. */
export async function resolveAiProvider(grant: EmployeeGrant): Promise<ResolvedAiProvider | null> {
  const [organization] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(and(eq(organizations.id, grant.organizationId), isNull(organizations.deletedAt)));
  if (!organization || !readAiEnabled(organization.settings)) return null;

  const connection = await findActiveConnection(grant.organizationId, "ai");
  if (!connection) return null;
  return Object.prototype.hasOwnProperty.call(ADAPTERS, connection.provider)
    ? (ADAPTERS[connection.provider] ?? null)
    : null;
}
