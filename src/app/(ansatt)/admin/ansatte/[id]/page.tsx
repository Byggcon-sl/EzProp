import type { Metadata } from "next";
import Link from "next/link";
import { AccessDeniedError, grantablePermissions } from "@/core/access";
import { isUuid } from "@/shared/lib/uuid";
import { Badge } from "@/shared/ui/badge";
import { Notice } from "@/shared/ui/notice";
import { getAdminContext } from "../../admin-context";
import { formatDate, formatIsoDate, noticeText, roleBadgeOrder, roleLabels } from "../../labels";
import { NoAccess } from "../../no-access";
import {
  CERTIFICATION_AREAS,
  getEmployeeForAdmin,
  listCertificationsForEmployee,
  listCompanies,
  listOffices,
} from "@/core/organization";
import {
  deactivateEmployeeAction,
  reactivateEmployeeAction,
  setPermissionsAction,
  setRolesAction,
  updateEmployeeAction,
} from "../actions";
import { EmployeeDetailsForm, PermissionsForm, RolesForm, StatusForm } from "../employee-forms";
import { addCertificationAction, removeCertificationAction } from "./certification-actions";
import { CertificationSection, type CertificationRow } from "./certification-section";

export const metadata: Metadata = { title: "Endre ansatt" };

/** Kvitteringene for sertifiseringer. Bare faste nøkler; resten tolkes av `noticeText`. */
const certificationNotices: Readonly<Record<string, string>> = {
  sertifisering: "Sertifiseringen er lagret.",
  "sertifisering-fjernet": "Sertifiseringen er fjernet.",
};

function pageNotice(value: string | string[] | undefined): string | null {
  if (typeof value === "string" && Object.hasOwn(certificationNotices, value)) {
    return certificationNotices[value] ?? null;
  }
  return noticeText(value);
}

function areaLabel(key: string): string {
  return CERTIFICATION_AREAS.find((area) => area.key === key)?.label ?? key;
}

/** Henter den ansatte. Ugyldig, ukjent og fremmed id gir `null` (samme svar som ingen tilgang). */
async function findEmployee(
  actor: Parameters<typeof getEmployeeForAdmin>[0],
  orgId: string,
  id: string,
) {
  if (!isUuid(id)) return null;
  try {
    return await getEmployeeForAdmin(actor, orgId, id);
  } catch (error) {
    if (error instanceof AccessDeniedError) return null;
    throw error;
  }
}

/**
 * Opplysninger, roller, enkeltrettigheter, sertifiseringer og sluttet, i kort som lagres hver
 * for seg.
 */
export default async function EmployeePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const context = await getAdminContext();
  if (!context) return <NoAccess />;
  const employee = await findEmployee(context.actor, context.organizationId, id);
  if (!employee) return <NoAccess />;

  const [companies, offices, certifications] = await Promise.all([
    listCompanies(context.actor, context.organizationId),
    listOffices(context.actor, context.organizationId),
    listCertificationsForEmployee(context.actor, context.organizationId, employee.id),
  ]);
  const notice = pageNotice((await searchParams).lagret);
  const certificationRows: CertificationRow[] = certifications.map((row) => ({
    id: row.id,
    areaLabel: areaLabel(row.area),
    certificateNumber: row.certificateNumber,
    issuer: row.issuer,
    validTo: formatIsoDate(row.validTo),
    validFrom: row.validFrom ? formatIsoDate(row.validFrom) : null,
    status: row.status,
  }));
  const locked = employee.deactivatedAt !== null;
  const roles = roleBadgeOrder.filter((role) => employee.roles.includes(role));
  // Uten innlogging finnes ingen e-post, og «Angre sluttet» er ikke mulig (kortet, Omfang 6).
  const canReactivate = employee.email !== null;

  return (
    <main className="max-w-2xl">
      <Link
        href="/admin/ansatte"
        className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700"
      >
        <span aria-hidden="true">‹&nbsp;</span>
        Tilbake til ansatte
      </Link>
      {notice && (
        <div className="mt-2">
          <Notice message={notice} />
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-2xl font-semibold break-words text-slate-900">{employee.name}</h1>
        <span className="flex flex-wrap gap-1.5">
          {locked ? (
            <Badge>Sluttet</Badge>
          ) : (
            roles.map((role) => (
              <Badge key={role} tone={role === "admin" ? "brand" : "neutral"}>
                {roleLabels[role]}
              </Badge>
            ))
          )}
        </span>
      </div>
      {employee.email && <p className="mt-1 break-all text-slate-600">{employee.email}</p>}

      <div className="mt-6 space-y-6">
        <EmployeeDetailsForm
          employee={{
            name: employee.name,
            email: employee.email,
            jobTitle: employee.jobTitle,
            companyId: employee.companyId,
            officeId: employee.officeId,
          }}
          companies={companies.map((company) => ({ id: company.id, name: company.legalName }))}
          offices={offices.map((office) => ({ id: office.id, name: office.name }))}
          action={updateEmployeeAction.bind(null, employee.id)}
          locked={locked}
        />
        <RolesForm
          roles={employee.roles}
          action={setRolesAction.bind(null, employee.id)}
          locked={locked}
        />
        <PermissionsForm
          permissions={employee.permissions}
          grantable={grantablePermissions}
          action={setPermissionsAction.bind(null, employee.id)}
          locked={locked}
        />
        <CertificationSection
          certifications={certificationRows}
          areas={CERTIFICATION_AREAS.map((area) => ({ key: area.key, label: area.label }))}
          addAction={addCertificationAction.bind(null, employee.id)}
          removeActions={Object.fromEntries(
            certifications.map((row) => [
              row.id,
              removeCertificationAction.bind(null, employee.id, row.id),
            ]),
          )}
        />
        <StatusForm
          deactivatedOn={employee.deactivatedAt ? formatDate(employee.deactivatedAt) : null}
          canReactivate={canReactivate}
          action={
            locked
              ? reactivateEmployeeAction.bind(null, employee.id)
              : deactivateEmployeeAction.bind(null, employee.id)
          }
        />
      </div>
    </main>
  );
}
