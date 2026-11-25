import { getReleasePdfData } from "@/core/reports";
import { methodNotAllowed, respondWithReportPdf } from "../../../pdf/pdf-response";

/**
 * PDF av én utgivelse (docs/funksjoner/fase2a-pdf-badet.md Omfang 6b, F7): teksten og TG slik de
 * ble publisert, uten «UTKAST», med datoene fra publiseringen. Forsiden og selskapets navn følger
 * dagens opplysninger til endelig PDF lagres i 2a-3. Bare `GET`; `HEAD` svarer 405. Ingenting lagres.
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; releaseId: string }> },
) {
  const { id, releaseId } = await context.params;
  return respondWithReportPdf(request, {
    route: "/oppdrag/[id]/utgivelser/[releaseId]/pdf",
    kind: "release",
    load: (actor, organizationId) => getReleasePdfData(actor, organizationId, id, releaseId),
  });
}

export function HEAD() {
  return methodNotAllowed();
}
