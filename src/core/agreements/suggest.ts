import { and, eq, isNull } from "drizzle-orm";
import { requireOrganizationAccess, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { assignments, clientAgreements, firms, orders } from "@/db/schema";
import { todayInOslo } from "@/shared/lib/dates";
import { isUuid } from "@/shared/lib/uuid";
import { isAgreementActive } from "./active";
import { NotFoundError } from "./errors";

export type AgreementSuggestion = {
  agreementId: string;
  agreementName: string;
  firmId: string;
  firmName: string;
};

/**
 * Forslag om avtale på oppdraget (A110). Firmaet hentes bare fra ordrens bestillerfirma
 * (`assignments.order_id` → `orders.ordered_by_firm_id`), aldri fra megler-parten. Forslag gis
 * bare når oppdraget ikke har avtale og firmaet (ikke slettet) har nøyaktig én avtale som ikke
 * er fjernet og gjelder i dag (`todayInOslo(now)`). Skriver ingenting; takstmannen godkjenner.
 */
export async function suggestAgreementForAssignment(
  actor: Actor,
  organizationId: string,
  assignmentId: string,
  now: Date = new Date(),
): Promise<AgreementSuggestion | null> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  if (!isUuid(assignmentId)) throw new NotFoundError("Fant ikke oppdraget.");
  const orgId = grant.organizationId;

  const [assignment] = await db
    .select({
      id: assignments.id,
      clientAgreementId: assignments.clientAgreementId,
      firmId: firms.id,
      firmName: firms.name,
    })
    .from(assignments)
    .leftJoin(
      orders,
      and(
        eq(orders.id, assignments.orderId),
        eq(orders.organizationId, orgId),
        isNull(orders.deletedAt),
      ),
    )
    .leftJoin(
      firms,
      and(
        eq(firms.id, orders.orderedByFirmId),
        eq(firms.organizationId, orgId),
        isNull(firms.deletedAt),
      ),
    )
    .where(
      and(
        eq(assignments.id, assignmentId),
        eq(assignments.organizationId, orgId),
        isNull(assignments.deletedAt),
      ),
    );
  if (!assignment) throw new NotFoundError("Fant ikke oppdraget.");
  if (assignment.clientAgreementId !== null) return null;
  if (assignment.firmId === null || assignment.firmName === null) return null;

  const candidates = await db
    .select({
      id: clientAgreements.id,
      name: clientAgreements.name,
      validFrom: clientAgreements.validFrom,
      validTo: clientAgreements.validTo,
    })
    .from(clientAgreements)
    .where(
      and(
        eq(clientAgreements.organizationId, orgId),
        eq(clientAgreements.firmId, assignment.firmId),
        isNull(clientAgreements.deletedAt),
      ),
    );
  const today = todayInOslo(now);
  const active = candidates.filter((candidate) => isAgreementActive(candidate, today));
  if (active.length !== 1) return null;
  const [only] = active;
  if (!only) return null;

  return {
    agreementId: only.id,
    agreementName: only.name,
    firmId: assignment.firmId,
    firmName: assignment.firmName,
  };
}
