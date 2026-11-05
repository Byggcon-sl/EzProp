import { and, eq, isNull } from "drizzle-orm";
import {
  AccessDeniedError,
  requireOrganizationAccess,
  type Actor,
  type EmployeeGrant,
} from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { recordEvent } from "@/core/events";
import { db, type DbExecutor } from "@/db/client";
import { assignmentParties, assignments } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { partyInputSchema, type PartyInput, type PartyValues } from "./schemas";
import { lockAssignment } from "./shared";

/*
 * Partene på oppdraget (A60): megler, selger, kjøper, selgers representant og fakturamottaker,
 * med navn og kontakt som fritekst og hva parten mottar. Endring med `assignment.edit`. Fjerning
 * er myk sletting. Hendelse og revisjonslogg har bare id-er, rollekoden, mottar-valgene og
 * navnene på feltene som er endret, aldri navn, firma, e-post eller telefon. Raden er kilden.
 */

/** Feltene som sammenlignes ved endring. Navnene (ikke verdiene) står i revisjonsloggen. */
const PARTY_FIELDS = [
  "role",
  "name",
  "firmName",
  "email",
  "phone",
  "receivesReport",
  "receivesInvoice",
  "receivesMessages",
] as const satisfies readonly (keyof PartyValues)[];

/** Felt der verdien kan stå i revisjonsloggen (koder og ja/nei, ingen personopplysninger). */
const LOGGABLE_FIELDS = new Set<string>([
  "role",
  "receivesReport",
  "receivesInvoice",
  "receivesMessages",
]);

/**
 * Henter og låser en part som ikke er fjernet, på et oppdrag som ikke er slettet, i
 * organisasjonen fra tilgangssjekken. Ellers `AccessDeniedError`.
 */
async function lockParty(tx: DbExecutor, grant: EmployeeGrant, partyId: string) {
  const [row] = await tx
    .select({
      id: assignmentParties.id,
      assignmentId: assignmentParties.assignmentId,
      role: assignmentParties.role,
      name: assignmentParties.name,
      firmName: assignmentParties.firmName,
      email: assignmentParties.email,
      phone: assignmentParties.phone,
      receivesReport: assignmentParties.receivesReport,
      receivesInvoice: assignmentParties.receivesInvoice,
      receivesMessages: assignmentParties.receivesMessages,
    })
    .from(assignmentParties)
    .innerJoin(
      assignments,
      and(
        eq(assignments.id, assignmentParties.assignmentId),
        eq(assignments.organizationId, grant.organizationId),
        isNull(assignments.deletedAt),
      ),
    )
    .where(
      and(
        eq(assignmentParties.id, partyId),
        eq(assignmentParties.organizationId, grant.organizationId),
        isNull(assignmentParties.deletedAt),
      ),
    )
    .for("update");
  if (!row) throw new AccessDeniedError();
  return row;
}

/** Legger en part til på oppdraget. Mottar-valgene lagres slik de sendes. */
export async function addParty(
  actor: Actor,
  organizationId: string,
  assignmentId: string,
  input: PartyInput,
): Promise<{ id: string }> {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  const values = partyInputSchema.parse(input);
  if (!isUuid(assignmentId)) throw new AccessDeniedError();

  return db.transaction(async (tx) => {
    const assignment = await lockAssignment(tx, grant, assignmentId);

    const [row] = await tx
      .insert(assignmentParties)
      .values({
        ...values,
        organizationId: grant.organizationId,
        assignmentId: assignment.id,
        createdBy: grant.employeeId,
      })
      .returning({ id: assignmentParties.id, role: assignmentParties.role });
    if (!row) throw new Error("Fant ikke parten etter at den ble lagret. Prøv igjen.");

    await recordEvent(tx, grant, {
      type: "assignment.party_added",
      assignmentId: assignment.id,
      data: { partyId: row.id, role: row.role },
    });
    await recordAuditEvent(tx, grant, {
      entityType: "assignment_party",
      entityId: row.id,
      action: "create",
      changes: {
        assignmentId: assignment.id,
        role: values.role,
        receivesReport: values.receivesReport,
        receivesInvoice: values.receivesInvoice,
        receivesMessages: values.receivesMessages,
      },
    });
    return { id: row.id };
  });
}

/**
 * Endrer en part. Uten endringer skrives ingenting (ingen hendelse). Revisjonsloggen får
 * navnene på feltene som er endret, og fra/til bare for rollen og mottar-valgene.
 */
export async function updateParty(
  actor: Actor,
  organizationId: string,
  partyId: string,
  input: PartyInput,
): Promise<{ id: string; changed: boolean }> {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  const values = partyInputSchema.parse(input);
  if (!isUuid(partyId)) throw new AccessDeniedError();

  return db.transaction(async (tx) => {
    const before = await lockParty(tx, grant, partyId);

    const fields = PARTY_FIELDS.filter((field) => before[field] !== values[field]);
    if (fields.length === 0) return { id: before.id, changed: false };

    await tx
      .update(assignmentParties)
      .set({ ...values, updatedBy: grant.employeeId })
      .where(
        and(
          eq(assignmentParties.id, before.id),
          eq(assignmentParties.organizationId, grant.organizationId),
        ),
      );

    const changes: Record<string, unknown> = { assignmentId: before.assignmentId, fields };
    for (const field of fields) {
      if (LOGGABLE_FIELDS.has(field)) changes[field] = { from: before[field], to: values[field] };
    }

    await recordEvent(tx, grant, {
      type: "assignment.party_updated",
      assignmentId: before.assignmentId,
      data: { partyId: before.id, role: values.role },
    });
    await recordAuditEvent(tx, grant, {
      entityType: "assignment_party",
      entityId: before.id,
      action: "update",
      changes,
    });
    return { id: before.id, changed: true };
  });
}

/** Fjerner en part (myk sletting). Parten kan legges inn igjen som en ny rad. */
export async function removeParty(
  actor: Actor,
  organizationId: string,
  partyId: string,
): Promise<{ id: string }> {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  if (!isUuid(partyId)) throw new AccessDeniedError();

  return db.transaction(async (tx) => {
    const before = await lockParty(tx, grant, partyId);

    await tx
      .update(assignmentParties)
      .set({ deletedAt: new Date(), deletedBy: grant.employeeId, updatedBy: grant.employeeId })
      .where(
        and(
          eq(assignmentParties.id, before.id),
          eq(assignmentParties.organizationId, grant.organizationId),
        ),
      );

    await recordEvent(tx, grant, {
      type: "assignment.party_removed",
      assignmentId: before.assignmentId,
      data: { partyId: before.id, role: before.role },
    });
    await recordAuditEvent(tx, grant, {
      entityType: "assignment_party",
      entityId: before.id,
      action: "delete",
      changes: { assignmentId: before.assignmentId, role: before.role },
    });
    return { id: before.id };
  });
}
