import { and, eq, isNull } from "drizzle-orm";
import { requireOrganizationAccess, type Actor } from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { recordEvent } from "@/core/events";
import { db } from "@/db/client";
import { assignments, clientAgreements } from "@/db/schema";
import { todayInOslo } from "@/shared/lib/dates";
import { isUuid } from "@/shared/lib/uuid";
import { isAgreementActive } from "./active";
import {
  AGREEMENT_DELETED_MESSAGE,
  AGREEMENT_EXPIRED_MESSAGE,
  AgreementNotUsableError,
  NotFoundError,
} from "./errors";

const ASSIGNMENT_NOT_FOUND = "Fant ikke oppdraget.";
const AGREEMENT_NOT_FOUND = "Fant ikke avtalen.";

export type SetAssignmentAgreementResult = {
  id: string;
  organizationId: string;
  clientAgreementId: string | null;
  changed: boolean;
};

/**
 * Velger, bytter eller fjerner avtalen på oppdraget (`assignment.edit`; takstmann bare når
 * `access.inspectors_edit_all` er på). Oppdragsraden låses (`FOR UPDATE`), så samtidige valg
 * går etter hverandre. Avtalen hentes med organisasjonen fra tilgangssjekken; fjernet, utløpt
 * eller ikke påbegynt avtale avvises med `AgreementNotUsableError` (A111). `null` er alltid
 * lov. Hendelse og revisjonslogg bare når verdien faktisk endres.
 */
export async function setAssignmentAgreement(
  actor: Actor,
  organizationId: string,
  assignmentId: string,
  agreementId: string | null,
  now: Date = new Date(),
): Promise<SetAssignmentAgreementResult> {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  if (!isUuid(assignmentId)) throw new NotFoundError(ASSIGNMENT_NOT_FOUND);
  if (agreementId !== null && !isUuid(agreementId)) throw new NotFoundError(AGREEMENT_NOT_FOUND);
  const orgId = grant.organizationId;

  return db.transaction(async (tx) => {
    // (1) Lås oppdraget (organisasjonen og ikke slettet)
    const [current] = await tx
      .select({ id: assignments.id, clientAgreementId: assignments.clientAgreementId })
      .from(assignments)
      .where(
        and(
          eq(assignments.id, assignmentId),
          eq(assignments.organizationId, orgId),
          isNull(assignments.deletedAt),
        ),
      )
      .for("update");
    if (!current) throw new NotFoundError(ASSIGNMENT_NOT_FOUND);

    // (2) Avtalen må finnes i organisasjonen, ikke være fjernet og gjelde i dag
    if (agreementId !== null) {
      const [agreement] = await tx
        .select({
          id: clientAgreements.id,
          validFrom: clientAgreements.validFrom,
          validTo: clientAgreements.validTo,
          deletedAt: clientAgreements.deletedAt,
        })
        .from(clientAgreements)
        .where(
          and(eq(clientAgreements.id, agreementId), eq(clientAgreements.organizationId, orgId)),
        );
      if (!agreement) throw new NotFoundError(AGREEMENT_NOT_FOUND);
      if (agreement.deletedAt) throw new AgreementNotUsableError(AGREEMENT_DELETED_MESSAGE);
      if (!isAgreementActive(agreement, todayInOslo(now))) {
        throw new AgreementNotUsableError(AGREEMENT_EXPIRED_MESSAGE);
      }
    }

    const fromAgreementId = current.clientAgreementId;
    if (fromAgreementId === agreementId) {
      return {
        id: current.id,
        organizationId: orgId,
        clientAgreementId: fromAgreementId,
        changed: false,
      };
    }

    // (3) Lagre, hendelse og revisjonslogg (bare id-er)
    const [updated] = await tx
      .update(assignments)
      .set({ clientAgreementId: agreementId, updatedBy: grant.employeeId })
      .where(and(eq(assignments.id, current.id), eq(assignments.organizationId, orgId)))
      .returning({ id: assignments.id, clientAgreementId: assignments.clientAgreementId });
    if (!updated) throw new NotFoundError(ASSIGNMENT_NOT_FOUND);

    await recordEvent(tx, grant, {
      type: "assignment.agreement_changed",
      assignmentId: current.id,
      data: { fromAgreementId, toAgreementId: agreementId },
    });
    await recordAuditEvent(tx, grant, {
      entityType: "assignment",
      entityId: current.id,
      action: "update",
      changes: { fields: ["clientAgreementId"], fromAgreementId, toAgreementId: agreementId },
    });
    return { ...updated, organizationId: orgId, changed: true };
  });
}
