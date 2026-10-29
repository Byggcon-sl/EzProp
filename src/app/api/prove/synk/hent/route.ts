/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Kandidat 3 (egenbygd): «endringer siden sist» til enheten.
 * `?organisasjon=<id>&siden=<markør>`; `siden` utelates ved første henting. Tilgang, filter og
 * markør ligger i `listTrialChangesSince`; ruten har ingen tilgangslogikk. Alle svar har
 * `Cache-Control: private, no-store`. Loggen får bare rute, bruker-id, antall rader og status,
 * aldri radene eller markøren.
 */
import { getCurrentActor } from "@/core/auth/session";
import { listTrialChangesSince } from "@/modules/offline-trial/server/changes-since";
import { InvalidTrialCursorError } from "@/modules/offline-trial/server/errors";
import { TRIAL_PULL_CACHE_CONTROL } from "@/modules/offline-trial/server/types";
import { logger } from "@/shared/lib/logger";
import { notLoggedIn, trialErrorResponse } from "../../error-response";

export const dynamic = "force-dynamic";

const ROUTE = "/api/prove/synk/hent";

export async function GET(request: Request) {
  const actor = await getCurrentActor();
  if (!actor) return notLoggedIn();
  const searchParams = new URL(request.url).searchParams;
  const organizationId = searchParams.get("organisasjon") ?? "";
  try {
    const result = await listTrialChangesSince(actor, organizationId, searchParams.get("siden"));
    const rows =
      result.endringer.trial_forms.length +
      result.endringer.trial_answers.length +
      result.endringer.trial_photos.length;
    logger.info("Endringer hentet til testskjemaet", {
      route: ROUTE,
      userId: actor.id,
      rows,
      status: 200,
    });
    return Response.json(result, { headers: { "Cache-Control": TRIAL_PULL_CACHE_CONTROL } });
  } catch (error) {
    if (error instanceof InvalidTrialCursorError) {
      logger.info("Ugyldig hentemarkør", { route: ROUTE, userId: actor.id, status: 400 });
      return Response.json(
        { feil: "Hentingen kunne ikke leses. Den starter på nytt fra begynnelsen." },
        { status: 400, headers: { "Cache-Control": TRIAL_PULL_CACHE_CONTROL } },
      );
    }
    return trialErrorResponse(error, ROUTE, actor.id);
  }
}
