import { getCurrentActor } from "@/core/auth/session";
import { forwardTrialShape } from "@/modules/offline-trial/server/electric-shape";
import { notLoggedIn, trialErrorResponse } from "../../error-response";

/**
 * Prøve fase 1 (kandidat 2, ElectricSQL): leser en shape gjennom serveren.
 * `?organisasjon=<id>&tabell=<trial_forms|trial_answers|trial_photos>` pluss posisjonen i strømmen
 * (`offset`, `handle`, `live`, `cursor`). Tilgang, filter og videresending ligger i
 * `forwardTrialShape`; ruten har ingen tilgangslogikk og leser ingen miljøvariabler.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getCurrentActor();
  if (!actor) return notLoggedIn();
  const searchParams = new URL(request.url).searchParams;
  const organizationId = searchParams.get("organisasjon") ?? "";
  try {
    return await forwardTrialShape(actor, organizationId, searchParams);
  } catch (error) {
    return trialErrorResponse(error, "/api/prove/synk/shape", actor.id);
  }
}
