import { and, eq, isNull, ne } from "drizzle-orm";
import { AccessDeniedError, requireOrganizationAccess } from "@/core/access";
import { readTemplateVersionIn } from "@/core/templates";
import { db } from "@/db/client";
import { assignments, companies, reportReleases, reports } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { requireUuid } from "./context";
import { guardReportErrors } from "./errors";
import { buildReportPdfData, pdfTemplateLabelsOf } from "./pdf-data-build";
import { companyRowOf, coverRowOf } from "./pdf-data";
import type { GetReleasePdfData, PdfTemplateLabels } from "./pdf-types";
import type { ReportSnapshot } from "./publish-types";

/*
 * PDF av én utgivelse (docs/funksjoner/fase2a-pdf-badet.md Omfang 6b, F7, A541). Bygges fra det
 * lagrede snapshotet med `draft: false`: teksten og TG slik de ble publisert, uten UTKAST, funn,
 * lenker eller siden «Ikke med i PDF-en». `generatedAt` er `released_at`, så filen blir lik hver
 * gang. Forsiden og selskapets navn følger dagens rader til endelig PDF lagres i 2a-3.
 *
 * Tilgang som utkastet (`organization.read`). Utgivelsen må høre til oppdragets gjeldende rapport
 * i organisasjonen; fremmed, slettet, ugyldig og utgivelse på et annet oppdrag gir samme 404.
 * Slår aldri opp i `claims`, og importerer ikke `@/core/ai`. Ingenting lagres.
 */

const NO_LABELS: PdfTemplateLabels = { elements: {} };

export const getReleasePdfData: GetReleasePdfData = async (
  actor,
  organizationId,
  assignmentId,
  releaseId,
) => {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  requireUuid(assignmentId, releaseId);
  const orgId = grant.organizationId;
  return guardReportErrors("release_pdf", async () => {
    const [row] = await db
      .select({
        releaseId: reportReleases.id,
        versionNumber: reportReleases.versionNumber,
        releasedAt: reportReleases.releasedAt,
        snapshot: reportReleases.snapshot,
        reportId: reports.id,
        assignmentId: assignments.id,
        number: assignments.number,
        addressText: assignments.addressText,
        gnr: assignments.gnr,
        bnr: assignments.bnr,
        snr: assignments.snr,
        companyLegalName: companies.legalName,
        companyOrgNumber: companies.orgNumber,
      })
      .from(reportReleases)
      .innerJoin(
        reports,
        and(
          eq(reports.id, reportReleases.reportId),
          eq(reports.organizationId, orgId),
          isNull(reports.deletedAt),
          ne(reports.status, "superseded"),
        ),
      )
      .innerJoin(
        assignments,
        and(
          eq(assignments.id, reports.assignmentId),
          eq(assignments.organizationId, orgId),
          isNull(assignments.deletedAt),
        ),
      )
      // Selskapet som utstedte utgivelsen (`report_releases.company_id`), også om det senere er
      // byttet på oppdraget. Er selskapet slettet, finnes det ikke: da sier bunnteksten at
      // selskap mangler (testplanen 11.5.2, A538)
      .leftJoin(
        companies,
        and(
          eq(companies.id, reportReleases.companyId),
          eq(companies.organizationId, orgId),
          isNull(companies.deletedAt),
        ),
      )
      .where(
        and(
          eq(reportReleases.id, releaseId),
          eq(reportReleases.organizationId, orgId),
          isNull(reportReleases.deletedAt),
          eq(assignments.id, assignmentId),
        ),
      )
      .limit(1);
    if (!row) throw new AccessDeniedError();

    const snapshot = row.snapshot as unknown as ReportSnapshot;
    const templateVersionId = snapshot.report?.template_version_id;
    const template =
      typeof templateVersionId === "string" && isUuid(templateVersionId)
        ? pdfTemplateLabelsOf((await readTemplateVersionIn(db, grant, templateVersionId)).document)
        : NO_LABELS;
    const data = buildReportPdfData({
      snapshot: {
        ...snapshot,
        report: { ...snapshot.report, report_id: row.reportId },
      },
      template,
      cover: coverRowOf(row),
      company: companyRowOf(row),
      findings: null,
      versionNumber: row.versionNumber,
      options: { draft: false },
    });
    return {
      data,
      reportId: row.reportId,
      employeeId: grant.employeeId,
      versionNumber: row.versionNumber,
      generatedAt: row.releasedAt,
    };
  });
};
