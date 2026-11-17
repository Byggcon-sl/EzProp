import { and, asc, desc, eq, gte, isNull, lt, lte, or } from "drizzle-orm";
import {
  AccessDeniedError,
  requireOrganizationAccess,
  type Actor,
  type EmployeeGrant,
} from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { db, type DbExecutor } from "@/db/client";
import { certifications, employees } from "@/db/schema";
import { addDays, todayInOslo } from "@/shared/lib/dates";
import { isUuid } from "@/shared/lib/uuid";
import { EXPIRING_SOON_DAYS, certificationStatus } from "./certification-rules";
import { addCertificationSchema, type AddCertificationInput } from "./schemas";

/*
 * Sertifiseringer i adminområdet (docs/funksjoner/fase0b-sertifisering.md, Omfang 5 og 7).
 * Alt krever `organization.manage` og filtrerer på `grant.organizationId`. «I dag» regnes i
 * norsk tid i TypeScript og sendes som parameter; SQL bruker aldri databasens klokke.
 */

/**
 * Den ansatte i organisasjonen fra tilgangssjekken, ikke slettet. En ansatt som har sluttet,
 * er med (historikk). Fremmed, ukjent, slettet og ugyldig id gir `AccessDeniedError`.
 */
async function requireEmployee(executor: DbExecutor, grant: EmployeeGrant, employeeId: string) {
  if (!isUuid(employeeId)) throw new AccessDeniedError();
  const [employee] = await executor
    .select({ id: employees.id })
    .from(employees)
    .where(
      and(
        eq(employees.id, employeeId),
        eq(employees.organizationId, grant.organizationId),
        isNull(employees.deletedAt),
      ),
    );
  if (!employee) throw new AccessDeniedError();
  return employee;
}

/**
 * Sertifiseringene til én ansatt som ikke er fjernet, senest `validTo` først, med status for i
 * dag i norsk tid. Ingen `organizationId`, sporingsfelt eller tidsstempler i svaret.
 */
export async function listCertificationsForEmployee(
  actor: Actor,
  organizationId: string,
  employeeId: string,
  now: Date = new Date(),
) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  await requireEmployee(db, grant, employeeId);
  const today = todayInOslo(now);

  const rows = await db
    .select({
      id: certifications.id,
      area: certifications.area,
      issuer: certifications.issuer,
      certificateNumber: certifications.certificateNumber,
      validFrom: certifications.validFrom,
      validTo: certifications.validTo,
    })
    .from(certifications)
    .where(
      and(
        eq(certifications.organizationId, grant.organizationId),
        eq(certifications.employeeId, employeeId),
        isNull(certifications.deletedAt),
      ),
    )
    .orderBy(desc(certifications.validTo), desc(certifications.createdAt), asc(certifications.id));

  return rows.map((row) => ({ ...row, status: certificationStatus(row, today) }));
}

/**
 * Registrerer en sertifisering på en ansatt. Bare admin. Fornyelse er en ny rad; den gamle står
 * som historikk. Revisjonslogg i samme transaksjon.
 */
export async function addCertification(
  actor: Actor,
  organizationId: string,
  input: AddCertificationInput,
) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  const values = addCertificationSchema.parse(input);

  return db.transaction(async (tx) => {
    await requireEmployee(tx, grant, values.employeeId);
    const [row] = await tx
      .insert(certifications)
      .values({ ...values, organizationId: grant.organizationId, createdBy: grant.employeeId })
      .returning();
    if (!row) throw new Error("Fant ikke sertifiseringen etter at den ble lagret. Prøv igjen.");
    await recordAuditEvent(tx, grant, {
      entityType: "certification",
      entityId: row.id,
      action: "create",
      // Bare id, område og datoer; nummer og utsteder holdes utenfor loggen.
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
 * Fjerner en sertifisering (myk sletting). Bare admin. Fremmed, ukjent, ugyldig og allerede
 * fjernet id gir `AccessDeniedError` og endrer ingenting.
 */
export async function removeCertification(
  actor: Actor,
  organizationId: string,
  certificationId: string,
) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  if (!isUuid(certificationId)) throw new AccessDeniedError();

  return db.transaction(async (tx) => {
    const where = and(
      eq(certifications.id, certificationId),
      eq(certifications.organizationId, grant.organizationId),
      isNull(certifications.deletedAt),
    );
    const [before] = await tx
      .select({ id: certifications.id })
      .from(certifications)
      .where(where)
      .for("update");
    if (!before) throw new AccessDeniedError();

    const [row] = await tx
      .update(certifications)
      .set({ deletedAt: new Date(), deletedBy: grant.employeeId, updatedBy: grant.employeeId })
      .where(where)
      .returning();
    if (!row) throw new AccessDeniedError();
    await recordAuditEvent(tx, grant, {
      entityType: "certification",
      entityId: row.id,
      action: "delete",
      changes: { employeeId: row.employeeId, area: row.area },
    });
    return row;
  });
}

/**
 * Sertifiseringen som er gyldig for den ansatte på dagen `today` (ÅÅÅÅ-MM-DD i norsk tid), til
 * publisering (A29, ADR 0015): ikke slettet, `valid_from` tom eller senest `today`, og `valid_to`
 * `today` eller senere (utløpsdagen er siste gyldige dag). Flere gyldige: lengst `valid_to`, så
 * `id`. Kjernefunksjon uten egen tilgangssjekk: kalles bak en handling som alt er sjekket, med
 * `grant.organizationId` og `grant.employeeId`. Uten gyldig: `null`.
 */
export async function findValidCertification(
  executor: DbExecutor,
  organizationId: string,
  employeeId: string,
  today: string,
): Promise<{ id: string; validTo: string } | null> {
  const [row] = await executor
    .select({ id: certifications.id, validTo: certifications.validTo })
    .from(certifications)
    .where(
      and(
        eq(certifications.organizationId, organizationId),
        eq(certifications.employeeId, employeeId),
        isNull(certifications.deletedAt),
        or(isNull(certifications.validFrom), lte(certifications.validFrom, today)),
        gte(certifications.validTo, today),
      ),
    )
    .orderBy(desc(certifications.validTo), asc(certifications.id))
    .limit(1);
  return row ?? null;
}

/**
 * Siste gyldige dag for den nyeste sertifiseringen som har gått ut før `today`, til meldingen
 * «sertifiseringen din gikk ut 01.11.». `null` når den ansatte ingen har. Samme kjøring som
 * `findValidCertification`: uten egen tilgangssjekk.
 */
export async function findLatestExpiredCertificationDate(
  executor: DbExecutor,
  organizationId: string,
  employeeId: string,
  today: string,
): Promise<string | null> {
  const [row] = await executor
    .select({ validTo: certifications.validTo })
    .from(certifications)
    .where(
      and(
        eq(certifications.organizationId, organizationId),
        eq(certifications.employeeId, employeeId),
        isNull(certifications.deletedAt),
        lt(certifications.validTo, today),
      ),
    )
    .orderBy(desc(certifications.validTo))
    .limit(1);
  return row?.validTo ?? null;
}

/**
 * Listen «går ut snart»: per aktiv ansatt og område den ikke-fjernede raden med senest
 * `validTo`, når den har gått ut eller går ut innen `EXPIRING_SOON_DAYS` dager. Tidligst først.
 * Ansatte som har sluttet eller er slettet, er ikke med. En fornyelse (også med `validFrom`
 * frem i tid) har senest `validTo` og tar personen ut av listen.
 */
export async function listExpiringCertifications(
  actor: Actor,
  organizationId: string,
  now: Date = new Date(),
) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  const today = todayInOslo(now);
  const lastIncludedDay = addDays(today, EXPIRING_SOON_DAYS);

  const latest = db
    .selectDistinctOn([certifications.employeeId, certifications.area], {
      certificationId: certifications.id,
      employeeId: certifications.employeeId,
      employeeName: employees.name,
      area: certifications.area,
      validTo: certifications.validTo,
    })
    .from(certifications)
    .innerJoin(
      employees,
      and(
        eq(employees.id, certifications.employeeId),
        eq(employees.organizationId, grant.organizationId),
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
      certifications.employeeId,
      certifications.area,
      desc(certifications.validTo),
      desc(certifications.createdAt),
    )
    .as("latest");

  const rows = await db
    .select()
    .from(latest)
    .where(lte(latest.validTo, lastIncludedDay))
    .orderBy(asc(latest.validTo), asc(latest.employeeName), asc(latest.certificationId));

  return rows.map((row) => ({
    ...row,
    status: row.validTo < today ? ("expired" as const) : ("expiring" as const),
  }));
}
