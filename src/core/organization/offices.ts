import { and, asc, eq, isNull } from "drizzle-orm";
import { requireOrganizationAccess, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { offices } from "@/db/schema";

/** Kontorene i organisasjonen som ikke er slettet, sortert på rekkefølge og så navn. */
export async function listOffices(actor: Actor, organizationId: string) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  return db
    .select()
    .from(offices)
    .where(and(eq(offices.organizationId, grant.organizationId), isNull(offices.deletedAt)))
    .orderBy(asc(offices.sortOrder), asc(offices.name));
}
