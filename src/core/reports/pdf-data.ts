import { and, eq, isNull, ne } from "drizzle-orm";
import { AccessDeniedError, requireOrganizationAccess } from "@/core/access";
import { db } from "@/db/client";
import { assignments, companies, reports } from "@/db/schema";
import { requireUuid } from "./context";
import { guardReportErrors } from "./errors";
import { computePublishCheck } from "./logic/publish-check";
import { buildReportPdfData, pdfTemplateLabelsOf } from "./pdf-data-build";
import type { GetReportDraftPdfData, PdfCompanyRow, PdfCoverRow } from "./pdf-types";
import { buildPublishCheckInput, loadPublishSource } from "./signals";
import { buildReportSnapshot } from "./snapshot";

/*
 * Utkastet til PDF-en (docs/funksjoner/fase2a-pdf-badet.md Omfang 4, 5 og 7, A531, A541, F6, F8).
 *
 * - Tilgang som badet på skjermen: `organization.read`. Ingen reklamasjonsdata, og samme svar med
 *   og uten reklamasjon på oppdraget. Slår aldri opp i `claims`, og importerer ikke `@/core/ai`.
 * - Oppslaget fra oppdrag til rapport gjøres her, med `grant.organizationId`, aldri i ruten.
 *   Fremmed, slettet, erstattet og ugyldig id gir samme 404 (`AccessDeniedError`).
 * - Rapporten leses med `loadPublishSource`, som publiseringen. Snapshotet og funnene fra
 *   publiseringssjekken bygges av de samme funksjonene, så utkastet og sperren sier det samme.
 * - Uventede feil logges bare med handlingen og feilkoden (`guardReportErrors`), aldri meldingen,
 *   som kan sitere adresse eller rapporttekst.
 */

/** «Gnr. 12, bnr. 34, snr. 5», eller `null` når alle tre mangler. */
export function cadastralTextOf(row: {
  gnr: string | null;
  bnr: string | null;
  snr: string | null;
}): string | null {
  const parts = [
    row.gnr?.trim() ? `Gnr. ${row.gnr.trim()}` : null,
    row.bnr?.trim() ? `bnr. ${row.bnr.trim()}` : null,
    row.snr?.trim() ? `snr. ${row.snr.trim()}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Adressen som linjer til forsiden: én linje per linje i teksten, uten tomme linjer. */
export function addressLinesOf(addressText: string): string[] {
  return addressText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** Forsiden fra oppdragsraden. */
export function coverRowOf(row: {
  assignmentId: string;
  number: string;
  addressText: string;
  gnr: string | null;
  bnr: string | null;
  snr: string | null;
}): PdfCoverRow {
  return {
    assignmentId: row.assignmentId,
    assignmentNumber: row.number,
    addressLines: addressLinesOf(row.addressText),
    cadastralText: cadastralTextOf(row),
  };
}

/** Selskapet fra en venstre-kobling: `null` når det ikke finnes. */
export function companyRowOf(row: {
  companyLegalName: string | null;
  companyOrgNumber: string | null;
}): PdfCompanyRow | null {
  if (row.companyLegalName === null) return null;
  return { legalName: row.companyLegalName, orgNumber: row.companyOrgNumber };
}

/**
 * PDF-utkastet for oppdragets gjeldende rapport. `draft` og `published` gir utkast (published fra
 * de låste radene, A541); `superseded`, slettet og fremmed gir 404.
 */
export const getReportDraftPdfData: GetReportDraftPdfData = async (
  actor,
  organizationId,
  assignmentId,
) => {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  requireUuid(assignmentId);
  const orgId = grant.organizationId;
  return guardReportErrors("draft_pdf", async () => {
    // Den ene egne spørringen: oppdraget, den gjeldende rapporten og selskapet, alt i organisasjonen
    const [row] = await db
      .select({
        assignmentId: assignments.id,
        number: assignments.number,
        addressText: assignments.addressText,
        gnr: assignments.gnr,
        bnr: assignments.bnr,
        snr: assignments.snr,
        inspectionAt: assignments.inspectionAt,
        reportId: reports.id,
        reportStatus: reports.status,
        templateVersionId: reports.templateVersionId,
        reportType: reports.reportType,
        companyLegalName: companies.legalName,
        companyOrgNumber: companies.orgNumber,
      })
      .from(assignments)
      .innerJoin(
        reports,
        and(
          eq(reports.assignmentId, assignments.id),
          eq(reports.organizationId, orgId),
          isNull(reports.deletedAt),
          ne(reports.status, "superseded"),
        ),
      )
      .leftJoin(
        companies,
        and(
          eq(companies.id, assignments.companyId),
          eq(companies.organizationId, orgId),
          isNull(companies.deletedAt),
        ),
      )
      .where(
        and(
          eq(assignments.id, assignmentId),
          eq(assignments.organizationId, orgId),
          isNull(assignments.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new AccessDeniedError();

    const generatedAt = new Date();
    const source = await loadPublishSource(
      db,
      actor,
      grant,
      {
        assignmentId: row.assignmentId,
        inspectionAt: row.inspectionAt,
        report: {
          id: row.reportId,
          status: row.reportStatus,
          templateVersionId: row.templateVersionId,
          reportType: row.reportType,
        },
      },
      generatedAt,
    );
    const data = buildReportPdfData({
      snapshot: buildReportSnapshot(source),
      template: pdfTemplateLabelsOf(source.template.document),
      cover: coverRowOf(row),
      company: companyRowOf(row),
      findings: computePublishCheck(buildPublishCheckInput(source)),
      versionNumber: null,
      options: { draft: true },
    });
    return { data, reportId: row.reportId, employeeId: grant.employeeId, generatedAt };
  });
};
