import { getCurrentActor } from "@/core/auth/session";
import { TrialPhotoNotFoundError } from "@/modules/offline-trial/server/errors";
import {
  readTrialDisplayCopy,
  readTrialPhotoBody,
  storeTrialDisplayCopy,
} from "@/modules/offline-trial/server/photo-storage";
import { notLoggedIn, trialErrorResponse } from "../../../error-response";

/**
 * Prøve fase 1: visningskopien av ett bilde (JPEG uten metadata, laget på iPaden).
 * PUT tar imot kopien (kroppen er filen, `Content-Type: image/jpeg`) og svarer `{ sha256 }`.
 * GET gir kopien. Spørrestrengen: `organisasjon`. Tilgangen sjekkes i serverfunksjonene.
 */
export const dynamic = "force-dynamic";

const ROUTE = "/api/prove/bilder/[id]/visning";
const NOT_UPLOADED = "Bildet er ikke lastet opp ennå.";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentActor();
  if (!actor) return notLoggedIn();
  try {
    const { id } = await context.params;
    const query = new URL(request.url).searchParams;
    // Stopper før hele filen er lest inn når den er for stor (413)
    const bytes = await readTrialPhotoBody(request);
    const result = await storeTrialDisplayCopy(
      actor,
      query.get("organisasjon") ?? "",
      id,
      request.headers.get("content-type") ?? "",
      bytes,
    );
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return trialErrorResponse(error, ROUTE, actor.id);
  }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentActor();
  if (!actor) return notLoggedIn();
  try {
    const { id } = await context.params;
    const query = new URL(request.url).searchParams;
    const bytes = await readTrialDisplayCopy(actor, query.get("organisasjon") ?? "", id);
    return new Response(bytes, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, no-store",
        "Content-Disposition": "inline",
      },
    });
  } catch (error) {
    // Ukjent, ugyldig, fremmed og slettet bilde, og bilde uten kopi, gir samme svar
    if (error instanceof TrialPhotoNotFoundError) {
      return Response.json(
        { feil: NOT_UPLOADED },
        { status: 404, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    return trialErrorResponse(error, ROUTE, actor.id);
  }
}
