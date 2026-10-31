import { and, asc, desc, eq, isNull } from "drizzle-orm";
import {
  AccessDeniedError,
  addDaysToIsoDate,
  CERTIFICATION_EXPIRY_WARNING_DAYS,
  requireOrganizationAccess,
  todayInOslo,
  type Actor,
  type EmployeeGrant,
} from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { db, type DbExecutor } from "@/db/client";
import { certifications, employees } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { certificationCreateSchema, type CertificationCreateInput } from "./schemas";

/*
 * Sertifiseringer per ansatt (docs/funksjoner/fase0b-sertifisering.md). Bare admin
 * (`organization.manage`). Alt filtrerer på `grant.organizationId`. Revisjonsloggen får id-er,
 * område og datoer, aldri navn.
 */

/** Sertifiseringen slik admin ser den. Ingen sporingsfelt utover `createdAt`. */
export type AdminCertification = {
  id: string;
  organizationId: string;
  employeeId: string;
  area: string;
  issuer: string | null;
  certificateNumber: string | null;
  validFrom: string | null;
  validTo: string;
  createdAt: Date;
};

/** En linje i listen «går ut snart». */
export type ExpiringCertification = {
  certificationId: string;
  employeeId: string;
  employeeName: string;
  area: string;
  certificateNumber: string | null;
  validTo: string;
  /** `validTo` er før i dag. */
  expired: boolean;
};

const certificationColumns = {
  id: certifications.id,
  organizationId: certifications.organizationId,
  employeeId: certifications.employeeId,
  area: certifications.area,
  issuer: certifications.issuer,
  certificateNumber: certifications.certificateNumber,
  validFrom: certifications.validFrom,
  validTo: certifications.validTo,
  createdAt: certifications.createdAt,
};

/**
 * Den ansatte i organisasjonen fra tilgangssjekken, ikke slettet. Med `active` må hun heller ikke
 * ha sluttet. Fremmed, ukjent og ugyldig id gir `AccessDeniedError`.
 */
async function requireEmployeeInOrganization(
  executor: DbExecutor,
  grant: EmployeeGrant,
  employeeId: string,
  options: { active: boolean },
) {
  if (!isUuid(employeeId)) throw new AccessDeniedError();
  const [employee] = await executor
    .select({ id: employees.id })
    .from(employees)
    .where(
      and(
        eq(employees.id, employeeId),
        eq(employees.organizationId, grant.organizationId),
        isNull(employees.deletedAt),
        options.active ? isNull(employees.deactivatedAt) : undefined,
      ),
    );
  if (!employee) throw new AccessDeniedError();
}

/**
 * Sertifiseringene til én ansatt (ikke slettede), nyeste `validTo` først, deretter nyeste
 * registrering. Ansatt som har sluttet kan listes; slettet ansatt gir `AccessDeniedError`.
 */
export async function listCertificationsForEmployee(
  actor: Actor,
  organizationId: string,
  employeeId: string,
): Promise<AdminCertification[]> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  await requireEmployeeInOrganization(db, grant, employeeId, { active: false });
  return db
    .select(certificationColumns)
    .from(certifications)
    .where(
      and(
        eq(certifications.organizationId, grant.organizationId),
        eq(certifications.employeeId, employeeId),
        isNull(certifications.deletedAt),
      ),
    )
    .orderBy(desc(certifications.validTo), desc(certifications.createdAt));
}

/**
 * Registrerer en sertifisering på en aktiv ansatt (ikke slettet, ikke sluttet). Fornyelse er en
 * ny rad. Ugyldig skjema gir `ZodError`; fremmed id eller ansatt som har sluttet gir
 * `AccessDeniedError`.
 */
export async function createCertification(
  actor: Actor,
  organizationId: string,
  input: CertificationCreateInput,
): Promise<AdminCertification> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  const values = certificationCreateSchema.parse(input);

  return db.transaction(async (tx) => {
    await requireEmployeeInOrganization(tx, grant, values.employeeId, { active: true });
    const [row] = await tx
      .insert(certifications)
      .values({
        organizationId: grant.organizationId,
        employeeId: values.employeeId,
        area: values.area,
        issuer: values.issuer,
        certificateNumber: values.certificateNumber,
        validFrom: values.validFrom,
        validTo: values.validTo,
        createdBy: grant.employeeId,
      })
      .returning(certificationColumns);
    if (!row) throw new Error("Kunne ikke lagre sertifiseringen. Prøv igjen.");
    await recordAuditEvent(tx, grant, {
      entityType: "certification",
      entityId: row.id,
      action: "certification.created",
      changes: {
        employeeId: row.employeeId,
        area: row.area,
        validFrom: row.validFrom,
        validTo: row.validTo,
      },
    });
    return row;
  });
}

/**
 * Fjerner en sertifisering med myk sletting (`deleted_at`). Ukjent, fremmed eller allerede
 * slettet id gir `AccessDeniedError`.
 */
export async function deleteCertification(
  actor: Actor,
  organizationId: string,
  certificationId: string,
): Promise<AdminCertification> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  if (!isUuid(certificationId)) throw new AccessDeniedError();

  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(certifications)
      .set({ deletedAt: new Date(), deletedBy: grant.employeeId, updatedBy: grant.employeeId })
      .where(
        and(
          eq(certifications.id, certificationId),
          eq(certifications.organizationId, grant.organizationId),
          isNull(certifications.deletedAt),
        ),
      )
      .returning(certificationColumns);
    if (!row) throw new AccessDeniedError();
    await recordAuditEvent(tx, grant, {
      entityType: "certification",
      entityId: row.id,
      action: "certification.deleted",
      changes: { employeeId: row.employeeId, area: row.area },
    });
    return row;
  });
}

/**
 * Aktive ansatte der den nyeste sertifiseringen per område (etter `validTo`) har gått ut eller går
 * ut innen `CERTIFICATION_EXPIRY_WARNING_DAYS` dager (A31). Den som har fornyet, vises ikke.
 * Sortert på `validTo` (tidligst først), så navn.
 */
export async function listExpiringCertifications(
  actor: Actor,
  organizationId: string,
  options: { today?: string } = {},
): Promise<ExpiringCertification[]> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  const today = options.today ?? todayInOslo();
  const limit = addDaysToIsoDate(today, CERTIFICATION_EXPIRY_WARNING_DAYS);

  const rows = await db
    .select({
      certificationId: certifications.id,
      employeeId: certifications.employeeId,
      employeeName: employees.name,
      area: certifications.area,
      certificateNumber: certifications.certificateNumber,
      validTo: certifications.validTo,
    })
    .from(certifications)
    .innerJoin(
      employees,
      and(
        eq(employees.id, certifications.employeeId),
        eq(employees.organizationId, certifications.organizationId),
      ),
    )
    .where(
      and(
        eq(certifications.organizationId, grant.organizationId),
        isNull(certifications.deletedAt),
        isNull(employees.deletedAt),
        isNull(employees.deactivatedAt),
      ),
    )
    .orderBy(
      asc(certifications.employeeId),
      asc(certifications.area),
      desc(certifications.validTo),
      desc(certifications.createdAt),
    );

  // Første rad per (ansatt, område) er den nyeste
  const newest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.employeeId}:${row.area}`;
    if (!newest.has(key)) newest.set(key, row);
  }

  return [...newest.values()]
    .filter((row) => row.validTo <= limit)
    .map((row) => ({ ...row, expired: row.validTo < today }))
    .sort(
      (a, b) =>
        a.validTo.localeCompare(b.validTo) ||
        a.employeeName.localeCompare(b.employeeName, "nb") ||
        a.employeeId.localeCompare(b.employeeId),
    );
}
