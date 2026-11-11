import { eq } from "drizzle-orm";
import type { EmployeeGrant } from "@/core/access";
import {
  findActiveConnection,
  REQUIRED_SECRET_REF_BY_PROVIDER,
  settingsSchemaFor,
} from "@/core/integrations/connections";
import { readSecret } from "@/core/integrations/secrets";
import { db } from "@/db/client";
import { organizations } from "@/db/schema";
import { ANTHROPIC_PROVIDER_CODE, createAnthropicProvider } from "./providers/anthropic";
import { fakeAiProvider } from "./providers/fake";
import type { AiProvider } from "./providers/types";

/*
 * Valg av leverandør: én vei (docs/funksjoner/fase2a-ki-modul-logg.md Omfang 7, A160). KI er på
 * bare når `ai.enabled` er boolsk `true` i `organizations.settings` OG organisasjonen har en
 * aktiv tilkobling på porten `ai` med en leverandør vi har adapter for. Miljøvariabler og
 * `NODE_ENV` velger aldri leverandør, så en feil innstilling i miljøet kan ikke sende data ut.
 *
 * `anthropic` (docs/funksjoner/fase2a-ki-leverandor.md Omfang 5) bygges fra tilkoblingen, og
 * bare når alle låsene er på plass: `settings` består det strenge skjemaet, `secret_ref` er
 * nøyaktig `ANTHROPIC_API_KEY` (A193), og nøkkelen finnes og er ikke tom. Mangler noe, er KI av,
 * uten at navn eller verdi lekker. Dette er det eneste stedet `readSecret` kalles i KI-modulen.
 */

/** Nøkkelen for KI av/på i `organizations.settings`. Standard av. */
export const AI_ENABLED_SETTING_KEY = "ai.enabled";

type ActiveConnection = NonNullable<Awaited<ReturnType<typeof findActiveConnection>>>;

type BuiltProvider = { provider: AiProvider; features: readonly string[] | null };

/** Nøkkelen fra hemmeligheten, eller `null`. Feilene fanges, så verken navn eller verdi lekker. */
function readApiKey(secretRef: string): string | null {
  try {
    const value = readSecret(secretRef);
    return value.trim() === "" ? null : value;
  } catch {
    return null;
  }
}

/** Anthropic-adapteren fra tilkoblingen, eller `null` når en lås mangler. */
function buildAnthropicProvider(connection: ActiveConnection): BuiltProvider | null {
  const parsed = settingsSchemaFor(ANTHROPIC_PROVIDER_CODE).safeParse(connection.settings);
  if (!parsed.success) return null;
  const secretRef = REQUIRED_SECRET_REF_BY_PROVIDER[ANTHROPIC_PROVIDER_CODE];
  if (connection.secretRef !== secretRef) return null;
  const apiKey = readApiKey(secretRef);
  if (apiKey === null) return null;
  const settings = parsed.data;
  try {
    const provider = createAnthropicProvider({
      model: settings.model,
      apiKey,
      pricing: settings.pricing,
    });
    return { provider, features: [...settings.features] };
  } catch {
    return null;
  }
}

/** Fabrikken: adapteren for leverandøren på tilkoblingen, eller `null` for en ukjent kode. */
function buildProvider(connection: ActiveConnection): BuiltProvider | null {
  switch (connection.provider) {
    case "fake":
      // Samme faste objekt hver gang; `null` betyr alle funksjoner og gjelder bare `fake`
      return { provider: fakeAiProvider, features: null };
    case ANTHROPIC_PROVIDER_CODE:
      return buildAnthropicProvider(connection);
    default:
      return null;
  }
}

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
  const built = buildProvider(connection);
  if (!built) return { kind: "disabled" };
  const { provider } = built;
  // `null` (alle funksjoner) bare for `fake`; alle andre har en liste, tom betyr alt av
  const features = provider.code === "fake" ? built.features : (built.features ?? []);
  return { kind: "enabled", provider, model: provider.model, features };
}
