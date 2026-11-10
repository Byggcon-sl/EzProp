import { eq } from "drizzle-orm";
import type { EmployeeGrant } from "@/core/access";
import { findActiveConnection } from "@/core/integrations/connections";
import { db } from "@/db/client";
import { organizations } from "@/db/schema";
import { fakeAiProvider } from "./providers/fake";
import type { AiProvider } from "./providers/types";

/*
 * Valg av leverandør: én vei (docs/funksjoner/fase2a-ki-modul-logg.md Omfang 7, A160). KI er på
 * bare når `ai.enabled` er boolsk `true` i `organizations.settings` OG organisasjonen har en
 * aktiv tilkobling på porten `ai` med en leverandør vi har adapter for. Miljøvariabler og
 * `NODE_ENV` leses aldri, så en feil innstilling i miljøet kan ikke sende data ut.
 */

/** Nøkkelen for KI av/på i `organizations.settings`. Standard av. */
export const AI_ENABLED_SETTING_KEY = "ai.enabled";

/** Adapterne koden har. Bare `fake` før S8. */
const ADAPTERS: Readonly<Record<string, AiProvider>> = {
  fake: fakeAiProvider,
};

export type ResolvedAiProvider =
  { kind: "enabled"; provider: AiProvider; model: string } | { kind: "disabled" };

/** Om `ai.enabled` er boolsk `true`. Alt annet (mangler, tekst, tall) er av. */
export function readAiEnabled(settings: unknown): boolean {
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) return false;
  if (!Object.prototype.hasOwnProperty.call(settings, AI_ENABLED_SETTING_KEY)) return false;
  return (settings as Record<string, unknown>)[AI_ENABLED_SETTING_KEY] === true;
}

/** Leverandøren for organisasjonen i `grant`, eller `disabled`. */
export async function resolveAiProvider(grant: EmployeeGrant): Promise<ResolvedAiProvider> {
  const [organization] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, grant.organizationId));
  if (!organization || !readAiEnabled(organization.settings)) return { kind: "disabled" };

  const connection = await findActiveConnection(grant.organizationId, "ai");
  if (!connection) return { kind: "disabled" };
  const provider = Object.prototype.hasOwnProperty.call(ADAPTERS, connection.provider)
    ? ADAPTERS[connection.provider]
    : undefined;
  if (!provider) return { kind: "disabled" };
  return { kind: "enabled", provider, model: provider.model };
}
