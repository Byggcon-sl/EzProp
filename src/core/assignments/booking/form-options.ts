import { and, asc, eq, isNull } from "drizzle-orm";
import { requireOrganizationAccess } from "@/core/access";
import { db } from "@/db/client";
import { employeeRoleAssignments, employees, offices } from "@/db/schema";
import type { GetNewAssignmentFormOptions } from "./contract";

/*
 * Valgene i skjemaet «Nytt oppdrag»: kontorene og de aktive takstmennene, og hva som er valgt fra
 * start (A295). Bare id og navn, filtrert på `grant.organizationId`. Kontaktvelgeren bruker
 * kontaktsøket som i dag.
 */

/** Valglistene i skjemaet «Nytt oppdrag». Kontrakten står i `./contract.ts`. */
export const getNewAssignmentFormOptions: GetNewAssignmentFormOptions = async (
  actor,
  organizationId,
) => {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  const organization = grant.organizationId;

  const [officeRows, inspectorRows, [self]] = await Promise.all([
    db
      .select({ id: offices.id, name: offices.name })
      .from(offices)
      .where(and(eq(offices.organizationId, organization), isNull(offices.deletedAt)))
      .orderBy(asc(offices.sortOrder), asc(offices.name), asc(offices.id)),
    db
      .selectDistinct({ id: employees.id, name: employees.name })
      .from(employees)
      .innerJoin(
        employeeRoleAssignments,
        and(
          eq(employeeRoleAssignments.employeeId, employees.id),
          eq(employeeRoleAssignments.organizationId, organization),
          eq(employeeRoleAssignments.role, "inspector"),
          isNull(employeeRoleAssignments.deletedAt),
        ),
      )
      .where(
        and(
          eq(employees.organizationId, organization),
          isNull(employees.deletedAt),
          isNull(employees.deactivatedAt),
        ),
      )
      .orderBy(asc(employees.name), asc(employees.id)),
    db
      .select({ officeId: employees.officeId })
      .from(employees)
      .where(and(eq(employees.id, grant.employeeId), eq(employees.organizationId, organization))),
  ]);

  const ownOfficeId = self?.officeId ?? null;
  return {
    offices: officeRows,
    inspectors: inspectorRows,
    defaultOfficeId: officeRows.some((office) => office.id === ownOfficeId) ? ownOfficeId : null,
    defaultResponsibleEmployeeId: inspectorRows.some((row) => row.id === grant.employeeId)
      ? grant.employeeId
      : null,
  };
};
