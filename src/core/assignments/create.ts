import { and, eq, isNull } from "drizzle-orm";
import { requireOrganizationAccess, type EmployeeGrant } from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { recordEvent } from "@/core/events";
import { db, type DbExecutor } from "@/db/client";
import {
  assignmentTeamMembers,
  assignments,
  employeeRoleAssignments,
  employees,
  offices,
} from "@/db/schema";
import { todayInOslo } from "@/shared/lib/dates";
import { BOOKING_EDITABLE_FIELDS, type BookingEditableField } from "./booking/codes";
import type { CreateAssignment, CreateAssignmentResult } from "./booking/contract";
import { createAssignmentInputSchema } from "./booking/schemas";
import { firmForContact } from "./booking/update";
import type { AssignmentStatus } from "./codes";
import { EmployeeNotFoundError, OfficeNotFoundError, ResponsibleNotInspectorError } from "./errors";
import { nextAssignmentNumber } from "./number-sequence";

/*
 * «Nytt oppdrag» (ADR 0011): oppdraget lages direkte med status «Bestilt», uten ordre. Kontrakten
 * står i `./booking/contract.ts`.
 *
 * Personvern: input, raden og Zod-feilen sendes aldri til `logger`, og ingen feil som kastes her
 * har verdier i meldingen. Hendelsen og revisjonsloggen har bare id-er, nummer og feltkoder,
 * aldri adresse, matrikkel, bestiller eller referanse.
 */

/** Den unike indeksen som stopper to oppdrag med samme engangsnøkkel (A298). */
const CREATION_KEY_INDEX = "assignments_organization_id_creation_key_idx";

/** Er feilen et brudd på den unike indeksen `constraint` (PostgreSQL `23505`)? */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const candidate = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (candidate.code === "23505" && candidate.constraint_name === constraint) return true;
    current = candidate.cause;
  }
  return false;
}

/**
 * Oppdraget som allerede har engangsnøkkelen i organisasjonen, også et kansellert (mykt slettet)
 * oppdrag. `null` når nøkkelen ikke er brukt.
 */
async function findByCreationKey(
  executor: DbExecutor,
  grant: EmployeeGrant,
  creationKey: string,
): Promise<CreateAssignmentResult | null> {
  const [row] = await executor
    .select({
      id: assignments.id,
      number: assignments.number,
      status: assignments.status,
      rowVersion: assignments.rowVersion,
    })
    .from(assignments)
    .where(
      and(
        eq(assignments.organizationId, grant.organizationId),
        eq(assignments.creationKey, creationKey),
      ),
    );
  if (!row) return null;
  return { ...row, status: row.status as AssignmentStatus, created: false };
}

/**
 * Ansvarlig takstmann: ansatt i organisasjonen, ikke slettet og ikke deaktivert (ellers
 * `EmployeeNotFoundError`), med rollen `inspector` (ellers `ResponsibleNotInspectorError`).
 * Gir selskapet til den ansatte (utstedende selskap, A65–A68).
 */
async function findResponsible(
  tx: DbExecutor,
  grant: EmployeeGrant,
  employeeId: string,
): Promise<{ id: string; companyId: string | null }> {
  const [employee] = await tx
    .select({ id: employees.id, companyId: employees.companyId })
    .from(employees)
    .where(
      and(
        eq(employees.id, employeeId),
        eq(employees.organizationId, grant.organizationId),
        isNull(employees.deletedAt),
        isNull(employees.deactivatedAt),
      ),
    );
  if (!employee) throw new EmployeeNotFoundError();

  const [role] = await tx
    .select({ id: employeeRoleAssignments.id })
    .from(employeeRoleAssignments)
    .where(
      and(
        eq(employeeRoleAssignments.employeeId, employee.id),
        eq(employeeRoleAssignments.organizationId, grant.organizationId),
        eq(employeeRoleAssignments.role, "inspector"),
        isNull(employeeRoleAssignments.deletedAt),
      ),
    );
  if (!role) throw new ResponsibleNotInspectorError();
  return employee;
}

/** Lager et oppdrag direkte («Nytt oppdrag»). Kontrakten står i `./booking/contract.ts`. */
export const createAssignment: CreateAssignment = async (
  actor,
  organizationId,
  input,
  options = {},
) => {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  const now = options.now ?? new Date();
  const values = createAssignmentInputSchema(now).parse(input);
  const creationKey = values.creationKey;

  try {
    return await db.transaction(async (tx) => {
      // (1) Samme engangsnøkkel gir det første oppdraget tilbake, uten nytt nummer
      if (creationKey !== null) {
        const existing = await findByCreationKey(tx, grant, creationKey);
        if (existing) return existing;
      }

      // (2) Kontor, ansvarlig og bestiller, alle i organisasjonen fra tilgangssjekken
      const [office] = await tx
        .select({ id: offices.id })
        .from(offices)
        .where(
          and(
            eq(offices.id, values.officeId),
            eq(offices.organizationId, grant.organizationId),
            isNull(offices.deletedAt),
          ),
        );
      if (!office) throw new OfficeNotFoundError();
      const responsible = await findResponsible(tx, grant, values.responsibleEmployeeId);
      const orderedByFirmId = await firmForContact(
        tx,
        grant.organizationId,
        values.orderedByContactId,
      );

      // (3) Neste nummer, med lås i databasen
      const number = await nextAssignmentNumber(tx, grant, todayInOslo(now));

      // (4) Oppdraget, uten ordre
      const [assignment] = await tx
        .insert(assignments)
        .values({
          organizationId: grant.organizationId,
          number,
          officeId: office.id,
          orderId: null,
          assignmentType: values.reportType,
          status: "ordered",
          companyId: responsible.companyId,
          inspectionAt: values.inspectionAt,
          receivedAt: values.receivedAt,
          source: "manual",
          externalRef: values.externalRef,
          orderedByText: values.orderedByText,
          orderedByContactId: values.orderedByContactId,
          orderedByFirmId,
          addressText: values.addressText,
          gnr: values.gnr,
          bnr: values.bnr,
          snr: values.snr,
          housingAssociationName: values.housingAssociationName,
          creationKey,
          createdBy: grant.employeeId,
        })
        .returning({
          id: assignments.id,
          number: assignments.number,
          status: assignments.status,
          rowVersion: assignments.rowVersion,
        });
      if (!assignment) throw new Error("Fant ikke oppdraget etter at det ble lagret. Prøv igjen.");

      // (5) Ansvarlig takstmann i teamet
      await tx.insert(assignmentTeamMembers).values({
        organizationId: grant.organizationId,
        assignmentId: assignment.id,
        employeeId: responsible.id,
        teamRole: "responsible",
        fromAt: now,
        createdBy: grant.employeeId,
      });

      // (6) Hendelse og revisjonslogg: bare id-er, nummer og feltkoder
      await recordEvent(tx, grant, {
        type: "assignment.created",
        assignmentId: assignment.id,
        data: { number, orderId: null },
      });
      const filled = {
        receivedAt: values.receivedAt,
        externalRef: values.externalRef,
        orderedByText: values.orderedByText,
        orderedByContactId: values.orderedByContactId,
        orderedByFirmId,
        addressText: values.addressText,
        gnr: values.gnr,
        bnr: values.bnr,
        snr: values.snr,
        housingAssociationName: values.housingAssociationName,
        sellerDeclarationReceived: false,
      } satisfies Record<BookingEditableField, unknown>;
      const fields = BOOKING_EDITABLE_FIELDS.filter(
        (field) => filled[field] !== null && filled[field] !== false,
      );
      await recordAuditEvent(tx, grant, {
        entityType: "assignment",
        entityId: assignment.id,
        action: "create",
        changes: {
          number,
          status: assignment.status,
          officeId: office.id,
          orderId: null,
          source: "manual",
          responsibleEmployeeId: responsible.id,
          companyId: responsible.companyId,
          fields,
        },
      });

      return {
        id: assignment.id,
        number: assignment.number,
        status: assignment.status as AssignmentStatus,
        rowVersion: assignment.rowVersion,
        created: true,
      };
    });
  } catch (error) {
    // To samtidige kall med samme nøkkel: den unike indeksen stopper det andre, som gir det
    // første oppdraget tilbake. Transaksjonen er rullet tilbake, så nummeret er ikke brukt.
    if (creationKey !== null && isUniqueViolation(error, CREATION_KEY_INDEX)) {
      const existing = await findByCreationKey(db, grant, creationKey);
      if (existing) return existing;
    }
    throw error;
  }
};
