import { getCurrentActor } from "@/core/auth/session";
import { applyTrialChanges } from "@/modules/offline-trial/server/apply-changes";
import type { TrialChangeOperation } from "@/modules/offline-trial/server/types";
import { notLoggedIn, trialErrorResponse } from "../../error-response";

/**
 * Prøve fase 1: tar imot endringsbunten fra enheten (`{ organizationId, operations }`).
 * `applyTrialChanges` sjekker tilgangen før operasjonene valideres, så fremmed organisasjon gir
 * alltid 403 og ugyldig innhold 400. Kroppen logges aldri.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const actor = await getCurrentActor();
  if (!actor) return notLoggedIn();
  try {
    const body: unknown = await request.json().catch(() => null);
    const { organizationId, operations } =
      body !== null && typeof body === "object"
        ? (body as { organizationId?: unknown; operations?: unknown })
        : {};
    const result = await applyTrialChanges(
      actor,
      typeof organizationId === "string" ? organizationId : "",
      operations as TrialChangeOperation[],
    );
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return trialErrorResponse(error, "/api/prove/synk/endringer", actor.id);
  }
}
