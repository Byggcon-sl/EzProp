import { getCurrentActor } from "@/core/auth/session";
import { readTrialPhotoBody, storeTrialPhoto } from "@/modules/offline-trial/server/photo-storage";
import { notLoggedIn, trialErrorResponse } from "../../error-response";

/**
 * Prøve fase 1: tar imot én bildefil. Kroppen er filen; `Content-Type` er bildets type.
 * Spørrestrengen: `organisasjon`, `skjema` (trial_form_id), `felt` (field_key), `navn`, `bytes`.
 * Svar `{ sha256 }`, som enheten sammenligner med sitt eget før den sletter filen lokalt.
 */
export const dynamic = "force-dynamic";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentActor();
  if (!actor) return notLoggedIn();
  try {
    const { id } = await context.params;
    const query = new URL(request.url).searchParams;
    // Stopper før hele filen er lest inn når den er for stor (413)
    const bytes = await readTrialPhotoBody(request);
    const result = await storeTrialPhoto(
      actor,
      query.get("organisasjon") ?? "",
      id,
      {
        trialFormId: query.get("skjema") ?? "",
        fieldKey: query.get("felt") ?? "",
        name: query.get("navn") ?? "",
        sizeBytes: Number(query.get("bytes") ?? bytes.byteLength),
        contentType: request.headers.get("content-type") ?? "",
      },
      bytes,
    );
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return trialErrorResponse(error, "/api/prove/bilder/[id]", actor.id);
  }
}
