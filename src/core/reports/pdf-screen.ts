import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { assignments, checkpoints, reports } from "@/db/schema";
import { requireUuid } from "./context";
import { guardReportErrors } from "./errors";

/*
 * Det skjermene trenger for PDF-knappene (docs/funksjoner/fase2a-pdf-badet.md, Skjermer og F4).
 * Ren lesing med samme tilgang som å se badet (`organization.read`). Spørringene filtrerer på
 * `grant.organizationId`, aldri på en id fra adressen alene.
 * Støtter hovedmål: de ansatte (knappen vises bare når det finnes en rapport, og lenken fra
 * utkastet fører rett til punktet).
 */

/** Ett kontrollpunkt i rapportens låste malversjon: id-en lenken i utkastet bruker, og koden. */
export type CheckpointAnchor = { checkpointId: string; checkpointKey: string };

async function currentReport(organizationId: string, assignmentId: string) {
  const [assignment] = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(
      and(
        eq(assignments.id, assignmentId),
        eq(assignments.organizationId, organizationId),
        isNull(assignments.deletedAt),
      ),
    );
  if (!assignment) throw new AccessDeniedError();
  const [report] = await db
    .select({ id: reports.id, templateVersionId: reports.templateVersionId })
    .from(reports)
    .where(
      and(
        eq(reports.organizationId, organizationId),
        eq(reports.assignmentId, assignment.id),
        isNull(reports.deletedAt),
        ne(reports.status, "superseded"),
      ),
    );
  return report ?? null;
}

/**
 * Om oppdraget har en rapport det kan lages PDF av (utkast eller publisert, ikke erstattet eller
 * slettet). Fremmed, slettet eller ugyldig oppdrag gir `AccessDeniedError`.
 */
export async function hasReportForPdf(
  actor: Actor,
  organizationId: string,
  assignmentId: string,
): Promise<boolean> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  requireUuid(assignmentId);
  return guardReportErrors("pdf_availability", async () => {
    return (await currentReport(grant.organizationId, assignmentId)) !== null;
  });
}

/**
 * Kontrollpunktene i malversjonen rapporten er låst til, med id-ene lenkene i utkastet bruker
 * (`#punkt-<checkpointId>`). Uten rapport: tom liste. Fremmed, slettet eller ugyldig oppdrag gir
 * `AccessDeniedError`.
 */
export async function listCheckpointAnchors(
  actor: Actor,
  organizationId: string,
  assignmentId: string,
): Promise<CheckpointAnchor[]> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  requireUuid(assignmentId);
  const orgId = grant.organizationId;
  return guardReportErrors("checkpoint_anchors", async () => {
    const report = await currentReport(orgId, assignmentId);
    if (!report) return [];
    return db
      .select({ checkpointId: checkpoints.id, checkpointKey: checkpoints.key })
      .from(checkpoints)
      .where(
        and(
          eq(checkpoints.organizationId, orgId),
          eq(checkpoints.versionId, report.templateVersionId),
          isNull(checkpoints.deletedAt),
        ),
      )
      .orderBy(asc(checkpoints.sortOrder));
  });
}
