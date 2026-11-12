import { eq } from "drizzle-orm";
import type { EmployeeGrant } from "@/core/access";
import { anthropicSettingsSchema, findActiveConnection } from "@/core/integrations/connections";
import { readSecret } from "@/core/integrations/secrets";
import { db } from "@/db/client";
import { organizations } from "@/db/schema";
import {
  ANTHROPIC_PROVIDER_CODE,
  ANTHROPIC_SECRET_REF,
  createAnthropicProvider,
} from "./providers/anthropic";
import { fakeAiProvider } from "./providers/fake";
import type { AiProvider } from "./providers/types";

/*
 * Valg av leverandør: én vei (docs/funksjoner/fase2a-ki-modul-logg.md Omfang 7, A160, og
 * docs/funksjoner/fase2a-ki-leverandor.md Omfang 5). KI er på bare når `ai.enabled` er boolsk
 * `true` i `organizations.settings` OG organisasjonen har en aktiv tilkobling på porten `ai` med
 * en leverandør vi har adapter for. Miljøvariabler og `NODE_ENV` velger aldri leverandør, så en
 * feil innstilling i miljøet kan ikke sende data ut.
 *
 * `anthropic` er på bare når alle låsene er på plass: `settings` består skjemaet, `secret_ref` er
 * nøyaktig `ANTHROPIC_API_KEY`, og nøkkelen finnes og er ikke tom. Mangler noe, er KI av. Ingen
 * feil slipper ut herfra, og navnet eller verdien på nøkkelen står aldri i det som returneres
 * eller i loggen. Dette er det eneste stedet i `src/core/ai` som leser en hemmelighet, og bare
 * med konstanten.
 */

/** Nøkkelen for KI av/på i `organizations.settings`. Standard av. */
export const AI_ENABLED_SETTING_KEY = "ai.enabled";

export type ResolvedAiProvider =
  | {
      kind: "enabled";
      provider: AiProvider;
      model: string;
      /**
       * Funksjonene som er slått på for denne leverandøren (`settings.features`, A194).
       * `null` betyr alle og gjelder bare `fake`. Tom liste betyr at alt er av.
       */
      features: readonly string[] | null;
    }
  | { kind: "disabled" };

const DISABLED: ResolvedAiProvider = { kind: "disabled" };

type ConnectionRow = NonNullable<Awaited<ReturnType<typeof findActiveConnection>>>;

/** Om `ai.enabled` er boolsk `true`. Alt annet (mangler, tekst, tall) er av. */
export function readAiEnabled(settings: unknown): boolean {
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) return false;
  if (!Object.prototype.hasOwnProperty.call(settings, AI_ENABLED_SETTING_KEY)) return false;
  return (settings as Record<string, unknown>)[AI_ENABLED_SETTING_KEY] === true;
}

/** Nøkkelen til Anthropic, eller `null`. Leser bare konstanten, og kaster aldri. */
function readAnthropicKey(): string | null {
  try {
    const value = readSecret(ANTHROPIC_SECRET_REF);
    return value.trim() === "" ? null : value;
  } catch {
    // InvalidSecretRefError, SecretNotFoundError og alt annet: KI er av. Feilen har navnet, så
    // den sendes ikke videre og logges ikke.
    return null;
  }
}

/** Adapteren for Anthropic, når alle låsene er på plass. */
function resolveAnthropic(connection: ConnectionRow): ResolvedAiProvider {
  if (connection.secretRef !== ANTHROPIC_SECRET_REF) return DISABLED;
  const parsed = anthropicSettingsSchema.safeParse(connection.settings);
  if (!parsed.success) return DISABLED;
  const apiKey = readAnthropicKey();
  if (apiKey === null) return DISABLED;
  try {
    const { model, features, pricing } = parsed.data;
    const provider = createAnthropicProvider({ model, apiKey, pricing });
    return { kind: "enabled", provider, model, features };
  } catch {
    return DISABLED;
  }
}

/** Fabrikken: adapteren for leverandørkoden på tilkoblingen, eller `disabled`. */
function providerFor(connection: ConnectionRow): ResolvedAiProvider {
  switch (connection.provider) {
    case fakeAiProvider.code:
      return {
        kind: "enabled",
        provider: fakeAiProvider,
        model: fakeAiProvider.model,
        features: null,
      };
    case ANTHROPIC_PROVIDER_CODE:
      return resolveAnthropic(connection);
    default:
      return DISABLED;
  }
}

/** Leverandøren for organisasjonen i `grant`, eller `disabled`. */
export async function resolveAiProvider(grant: EmployeeGrant): Promise<ResolvedAiProvider> {
  const [organization] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, grant.organizationId));
  if (!organization || !readAiEnabled(organization.settings)) return DISABLED;

  const connection = await findActiveConnection(grant.organizationId, "ai");
  if (!connection) return DISABLED;
  return providerFor(connection);
}
