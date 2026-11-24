import type { Actor } from "@/core/access";
import type { PdfTg, ReportPdfData } from "@/core/pdf";
import type { PublishCheckFinding } from "./logic/publish-check-types";
import type { CheckpointTg } from "./logic/types";
import type { ReportSnapshot } from "./publish-types";

/**
 * Grensesnittet for rapportdataene til PDF-en (ADR 0016, docs/funksjoner/fase2a-pdf-badet.md
 * Omfang 4 og 6b). Utvikleren bygger funksjonene i `pdf-data.ts`, `pdf-data-build.ts`,
 * `release-pdf.ts` og `tg-explanation.ts`. `signals.ts`, `snapshot.ts` og publiseringen endres
 * ikke, bare importeres.
 *
 * - Fra `@/core/pdf` importeres bare typer (`import type`, lint-regelen `reportsToPdfTypeOnly`).
 * - Ingen av filene importerer `@/core/ai`, og ingen leser `claims`.
 * - `ReportPdfData` bygges alltid fra `ReportSnapshot` (F6). Hva som kommer fra hvor, står i
 *   tabellen i ADR 0016 punkt 6.
 */

type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
/**
 * TG-verdiene i PDF-bladet og i rapportkjernen skal være de samme. Endres den ene uten den
 * andre, stopper typesjekken her (`src/core/pdf` kan ikke importere rapportkjernen).
 */
export type PdfTgMatchesCheckpointTg = Assert<MutuallyAssignable<PdfTg, CheckpointTg>>;

/**
 * Det PDF-en trenger fra den låste malversjonen (`snapshot.report.template_version_id`) og som
 * ikke står i snapshotet. Etiketter og valgtekster står alt i snapshotet.
 */
export type PdfTemplateLabels = {
  /** Per `element_key`. Felt som ikke står her, regnes som `showInReport: false`. */
  elements: Readonly<Record<string, { showInReport: boolean; unit: string | null }>>;
};

/**
 * Forsiden, lest ved gjengivelse med `grant.organizationId` og `deleted_at is null`. Snapshotet
 * har med vilje ikke adresse, matrikkel eller oppdragsnummer.
 */
export type PdfCoverRow = {
  assignmentId: string;
  assignmentNumber: string;
  addressLines: string[];
  cadastralText: string | null;
};

/** Selskapet fra `assignments.company_id` (utkast) eller `report_releases.company_id` (utgivelse). */
export type PdfCompanyRow = { legalName: string; orgNumber: string | null };

export type BuildReportPdfDataInput = {
  snapshot: ReportSnapshot;
  template: PdfTemplateLabels;
  cover: PdfCoverRow;
  /** `null`, eller uten `orgNumber`, gir `company: null` i dataene (A538). */
  company: PdfCompanyRow | null;
  /** Funnene fra `computePublishCheck` (utkast), eller `null` (utgivelse). */
  findings: readonly PublishCheckFinding[] | null;
  /** Versjonsnummeret til utgivelsen. `null` i utkast. */
  versionNumber: number | null;
  options: { draft: boolean };
};

/**
 * Ren funksjon, samme for utkast og utgivelse (F6). Med `draft: false` tas `findings`, `missing`,
 * merknadene og `editPath` aldri med, uansett hva som sendes inn. Lager ingen egne regler for hva
 * som mangler: hvert funn plasseres ved målet sitt med teksten fra `publish-check-texts.ts`.
 */
export type BuildReportPdfData = (input: BuildReportPdfDataInput) => ReportPdfData;

/**
 * Utkastet (`organization.read`, samme sjekk som `getRoomView`). Kaller selv
 * `requireOrganizationAccess` og `requireUuid`, finner oppdragets gjeldende rapport (ikke
 * `superseded`, ikke slettet) med `grant.organizationId` og leser med `loadPublishSource`. Én
 * egen spørring: forsiden og selskapet. Fremmed, slettet, erstattet og ugyldig id gir samme 404
 * (`NotFoundError`). Slår aldri opp i `claims`. `employeeId` er nøkkelen til telleren.
 */
export type GetReportDraftPdfData = (
  actor: Actor,
  organizationId: string,
  assignmentId: string,
) => Promise<{ data: ReportPdfData; reportId: string; employeeId: string; generatedAt: Date }>;

/**
 * PDF-dataene for én utgivelse (`organization.read`, F7). Utgivelsen hentes med
 * `grant.organizationId` og må høre til oppdragets rapport; ellers 404. Bygges fra det lagrede
 * snapshotet med `draft: false`, etikettene fra snapshotets malversjon og selskapet fra
 * utgivelsens `company_id`. `generatedAt` er `released_at`.
 */
export type GetReleasePdfData = (
  actor: Actor,
  organizationId: string,
  assignmentId: string,
  releaseId: string,
) => Promise<{
  data: ReportPdfData;
  reportId: string;
  employeeId: string;
  versionNumber: number;
  generatedAt: Date;
}>;
