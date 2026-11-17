import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { AccessDeniedError, requireOrganizationAccess } from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { db, type DbExecutor } from "@/db/client";
import { assignments, reports, templateFamilies, templateVersions } from "@/db/schema";
import { uuidv7 } from "@/shared/lib/uuid";
import { requireUuid } from "./context";
import { ReportTemplateMissingError } from "./errors";
import type { StartReport } from "./types";

/*
 * Start av rapporten (docs/funksjoner/fase2a-badet-pc.md Omfang 1, ADR 0013 punkt 2 og 3). Bare
 * en egen handling med `report.edit` starter rapporten, aldri en lesing. Rapporten låses til den
 * publiserte versjonen av systemmalen for tilstandsrapport og står på den også når en ny versjon
 * publiseres.
 */

/** Rapporttypen badet bruker. */
const REPORT_TYPE = "condition_report";

/** Den publiserte versjonen av systemmalen for tilstandsrapport, nyeste først. */
async function findPublishedSystemTemplate(ex: DbExecutor, orgId: string) {
  const [row] = await ex
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .innerJoin(
      templateFamilies,
      and(
        eq(templateFamilies.id, templateVersions.familyId),
        eq(templateFamilies.organizationId, orgId),
        eq(templateFamilies.kind, "system"),
        eq(templateFamilies.reportType, REPORT_TYPE),
        isNull(templateFamilies.deletedAt),
      ),
    )
    .where(
      and(
        eq(templateVersions.organizationId, orgId),
        eq(templateVersions.status, "published"),
        isNull(templateVersions.deletedAt),
      ),
    )
    .orderBy(desc(templateVersions.publishedAt), desc(templateVersions.versionNumber))
    .limit(1);
  return row ?? null;
}

/**
 * Starter rapporten for oppdraget (`report.edit`). Tåler to samtidige kall: den delvise unike
 * indeksen og `on conflict do nothing` gir én rapport, og begge får samme id tilbake.
 */
export const startReport: StartReport = async (actor, organizationId, assignmentId) => {
  const grant = await requireOrganizationAccess(actor, organizationId, "report.edit");
  requireUuid(assignmentId);
  const orgId = grant.organizationId;

  return db.transaction(async (tx) => {
    const [assignment] = await tx
      .select({ id: assignments.id })
      .from(assignments)
      .where(
        and(
          eq(assignments.id, assignmentId),
          eq(assignments.organizationId, orgId),
          isNull(assignments.deletedAt),
        ),
      );
    if (!assignment) throw new AccessDeniedError();

    const currentWhere = and(
      eq(reports.organizationId, orgId),
      eq(reports.assignmentId, assignment.id),
      isNull(reports.deletedAt),
      ne(reports.status, "superseded"),
    );
    const [existing] = await tx.select({ id: reports.id }).from(reports).where(currentWhere);
    if (existing) return { reportId: existing.id, created: false };

    const template = await findPublishedSystemTemplate(tx, orgId);
    if (!template) throw new ReportTemplateMissingError();

    const [inserted] = await tx
      .insert(reports)
      .values({
        id: uuidv7(),
        organizationId: orgId,
        assignmentId: assignment.id,
        templateVersionId: template.id,
        reportType: REPORT_TYPE,
        status: "draft",
        createdBy: grant.employeeId,
      })
      .onConflictDoNothing()
      .returning({ id: reports.id });
    if (!inserted) {
      // Et samtidig kall startet rapporten først: samme rapport tilbake
      const [winner] = await tx.select({ id: reports.id }).from(reports).where(currentWhere);
      if (!winner) throw new Error("rapporten ble verken laget eller funnet");
      return { reportId: winner.id, created: false };
    }
    // Bare id-er. Ingen adresse, parter eller andre opplysninger fra oppdraget.
    await recordAuditEvent(tx, grant, {
      entityType: "report",
      entityId: inserted.id,
      action: "create",
      changes: { assignmentId: assignment.id, templateVersionId: template.id },
    });
    return { reportId: inserted.id, created: true };
  });
};
