import { and, asc, eq, isNull } from "drizzle-orm";
import { requireOrganizationAccess, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { companies } from "@/db/schema";

/** Selskapene i organisasjonen som ikke er slettet, sortert på navn. */
export async function listCompanies(actor: Actor, organizationId: string) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  return db
    .select()
    .from(companies)
    .where(and(eq(companies.organizationId, grant.organizationId), isNull(companies.deletedAt)))
    .orderBy(asc(companies.legalName));
}
