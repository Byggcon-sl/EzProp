import { and, asc, eq, isNull } from "drizzle-orm";
import {
  AccessDeniedError,
  listOrganizationsForActor,
  requireOrganizationAccess,
  type Actor,
  type EmployeeGrant,
} from "@/core/access";
import { db } from "@/db/client";
import { companies, employees, offices } from "@/db/schema";

type ListEmployeesOptions = {
  /** Ta med ansatte som har sluttet (også de uten innlogging). Standard: nei. */
  includeDeactivated?: boolean;
};

/**
 * Ansatte i organisasjonen som ikke er slettet, med selskaps- og kontornavn.
 * Slettet selskap eller kontor gir tomt navn. Gir aldri e-post eller innloggings-id.
 */
export async function listEmployees(
  actor: Actor,
  organizationId: string,
  options: ListEmployeesOptions = {},
) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  return (
    db
      .select({
        id: employees.id,
        name: employees.name,
        jobTitle: employees.jobTitle,
        companyName: companies.legalName,
        officeName: offices.name,
        deactivatedAt: employees.deactivatedAt,
      })
      .from(employees)
      // De sammensatte fremmednøklene (organization_id, company_id/office_id) sikrer at
      // selskap og kontor hører til samme organisasjon som den ansatte.
      .leftJoin(companies, and(eq(companies.id, employees.companyId), isNull(companies.deletedAt)))
      .leftJoin(offices, and(eq(offices.id, employees.officeId), isNull(offices.deletedAt)))
      .where(
        and(
          eq(employees.organizationId, grant.organizationId),
          isNull(employees.deletedAt),
          options.includeDeactivated ? undefined : isNull(employees.deactivatedAt),
        ),
      )
      .orderBy(asc(employees.name))
  );
}

/**
 * Den første organisasjonen der personen er admin (`organization.manage`), eller `null`.
 * Brukes av adminsidene og menypunktet «Admin». Tilgangen avgjøres av `requireOrganizationAccess`,
 * og hver funksjon i adminområdet sjekker den på nytt.
 */
export async function findAdminOrganizationId(actor: Actor): Promise<string | null> {
  const organizationsForActor = await listOrganizationsForActor(actor);
  for (const organization of organizationsForActor) {
    try {
      const grant = await requireOrganizationAccess(actor, organization.id, "organization.manage");
      return grant.organizationId;
    } catch (error) {
      if (!(error instanceof AccessDeniedError)) throw error;
    }
  }
  return null;
}

export type EmployeeGrantWithOffice = {
  grant: EmployeeGrant;
  /** Kontoret på den ansattes egen rad, eller `null`. Bare til forhåndsvalg på skjermen. */
  officeId: string | null;
};

/**
 * Den første organisasjonen der personen er ansatt og kan se (`organization.read`), med grant og
 * den ansattes kontor, eller `null`. Brukes av ansattsidene (som `/ordre`) for å finne
 * organisasjonen uten en id i adressen. Hver funksjon i kjernen sjekker tilgangen på nytt.
 */
export async function findEmployeeGrant(actor: Actor): Promise<EmployeeGrantWithOffice | null> {
  const organizationsForActor = await listOrganizationsForActor(actor);
  for (const organization of organizationsForActor) {
    let grant: EmployeeGrant;
    try {
      grant = await requireOrganizationAccess(actor, organization.id, "organization.read");
    } catch (error) {
      if (!(error instanceof AccessDeniedError)) throw error;
      continue;
    }
    const [employee] = await db
      .select({ officeId: employees.officeId })
      .from(employees)
      .where(
        and(eq(employees.id, grant.employeeId), eq(employees.organizationId, grant.organizationId)),
      );
    return { grant, officeId: employee?.officeId ?? null };
  }
  return null;
}
