import { getReportDraftPdfData } from "@/core/reports";
import { methodNotAllowed, respondWithReportPdf } from "./pdf-response";

/**
 * PDF-utkast av rapporten på oppdraget (docs/funksjoner/fase2a-pdf-badet.md Omfang 6). Tar
 * oppdragets id; den gjeldende rapporten finnes i `core/reports`. Bare `GET`. `HEAD` svarer 405,
 * ellers ville Next svart den med GET og laget en PDF. Ingenting lagres.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return respondWithReportPdf(request, {
    route: "/oppdrag/[id]/pdf",
    kind: "draft",
    load: async (actor, organizationId) => {
      const loaded = await getReportDraftPdfData(actor, organizationId, id);
      return { ...loaded, versionNumber: null };
    },
  });
}

export function HEAD() {
  return methodNotAllowed();
}
