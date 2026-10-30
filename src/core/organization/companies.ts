import { and, asc, eq, isNull } from "drizzle-orm";
import { requireOrganizationAccess, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { companies } from "@/db/schema";

/**
 * Selskapene i organisasjonen som ikke er slettet, sortert på navn.
 * Gir aldri sporingsfelt (createdBy/updatedBy/deletedBy), organizationId, rowVersion
 * eller tidsstempler.
 */
export async function listCompanies(actor: Actor, organizationId: string) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  return db
    .select({
      id: companies.id,
      legalName: companies.legalName,
      orgNumber: companies.orgNumber,
      vatRegistered: companies.vatRegistered,
      address: companies.address,
      postalCode: companies.postalCode,
      city: companies.city,
      companyText: companies.companyText,
      liabilityInsurer: companies.liabilityInsurer,
      liabilityPolicyNumber: companies.liabilityPolicyNumber,
      liabilityValidTo: companies.liabilityValidTo,
    })
    .from(companies)
    .where(and(eq(companies.organizationId, grant.organizationId), isNull(companies.deletedAt)))
    .orderBy(asc(companies.legalName));
}
