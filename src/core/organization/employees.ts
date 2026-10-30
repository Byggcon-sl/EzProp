import { and, asc, eq, isNull } from "drizzle-orm";
import { requireOrganizationAccess, type Actor } from "@/core/access";
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
