import { and, eq, isNull } from "drizzle-orm";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import { lookupContactAndFirmNames } from "@/core/contacts";
import { db } from "@/db/client";
import { assignments } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import type { AssignmentBooking } from "./contract";
import { assignmentBookingColumns, toAssignmentBooking } from "./update";

/*
 * Kortet «Bestilling» på oppdragssiden (docs/funksjoner/fase2a-nytt-oppdrag.md, Omfang 10).
 * Bare lesing med `organization.read`, filtrert på `grant.organizationId`. Bestilleren og firmaet
 * gis som navn; ingenting logges og ingenting sendes til KI.
 */

export type AssignmentBookingView = {
  id: string;
  /** Versjonen skjemaet «Endre bestillingen» sender tilbake (konfliktkontroll). */
  rowVersion: number;
  booking: AssignmentBooking;
};

/**
 * Bestillingen på oppdraget slik kortet «Bestilling» viser den. Fremmed, ukjent, slettet
 * (kansellert) og ugyldig id gir `AccessDeniedError`.
 */
export async function getAssignmentBooking(
  actor: Actor,
  organizationId: string,
  assignmentId: string,
): Promise<AssignmentBookingView> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  if (!isUuid(assignmentId)) throw new AccessDeniedError();
  const [row] = await db
    .select({
      ...assignmentBookingColumns,
      rowVersion: assignments.rowVersion,
      source: assignments.source,
    })
    .from(assignments)
    .where(
      and(
        eq(assignments.id, assignmentId),
        eq(assignments.organizationId, grant.organizationId),
        isNull(assignments.deletedAt),
      ),
    );
  if (!row) throw new AccessDeniedError();

  const { rowVersion, source, ...snapshot } = row;
  const { contacts, firms } = await lookupContactAndFirmNames(grant, {
    contactIds: snapshot.orderedByContactId === null ? [] : [snapshot.orderedByContactId],
    firmIds: snapshot.orderedByFirmId === null ? [] : [snapshot.orderedByFirmId],
  });
  return {
    id: assignmentId,
    rowVersion,
    booking: toAssignmentBooking(snapshot, source, contacts, firms),
  };
}
