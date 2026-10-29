import { getCurrentActor } from "@/core/auth/session";
import { issueSyncToken } from "@/modules/offline-trial/server/sync-token";
import { notLoggedIn, trialErrorResponse } from "../../error-response";

/** Prøve fase 1: token til synktjenesten for innlogget ansatt. `?organisasjon=<id>`. */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getCurrentActor();
  if (!actor) return notLoggedIn();
  const organizationId = new URL(request.url).searchParams.get("organisasjon") ?? "";
  try {
    const result = await issueSyncToken(actor, organizationId);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return trialErrorResponse(error, "/api/prove/synk/token", actor.id);
  }
}
