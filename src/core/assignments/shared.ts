import { and, eq, isNull } from "drizzle-orm";
import { AccessDeniedError, type EmployeeGrant } from "@/core/access";
import type { DbExecutor } from "@/db/client";
import { assignments } from "@/db/schema";

/**
 * Henter og låser oppdraget (`FOR UPDATE`) i transaksjonen, filtrert på organisasjonen fra
 * tilgangssjekken og ikke slettet. Låsen gjør at samtidige endringer på samme oppdrag går etter
 * hverandre. Ukjent, fremmed eller slettet oppdrag gir `AccessDeniedError`. Id-en må alt være
 * sjekket med `isUuid`.
 */
export async function lockAssignment(tx: DbExecutor, grant: EmployeeGrant, assignmentId: string) {
  const [row] = await tx
    .select({ id: assignments.id })
    .from(assignments)
    .where(
      and(
        eq(assignments.id, assignmentId),
        eq(assignments.organizationId, grant.organizationId),
        isNull(assignments.deletedAt),
      ),
    )
    .for("update");
  if (!row) throw new AccessDeniedError();
  return row;
}
