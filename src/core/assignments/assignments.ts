import { and, asc, eq, isNull } from "drizzle-orm";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import { db } from "@/db/client";
import {
  assignmentParties,
  assignmentTeamMembers,
  assignments,
  companies,
  employees,
  offices,
  orders,
} from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { PARTY_ROLES, TEAM_ROLES } from "./codes";

/*
 * Oppdragssiden (docs/05-domenemodell.md 4.3): oppdraget med aktivt team, parter og hvem som kan
 * velges i teamet. Lesing med `organization.read` (alle takstmenn ser alt, 27.10.2026). All
 * filtrering bruker `grant.organizationId`, aldri parameteren. Faste feltlister, ingen
 * sporingsfelt, én spørring per liste.
 */

export type AssignmentTeamEntry = {
  teamRole: string;
  employeeId: string;
  employeeName: string;
  fromAt: Date;
};

export type AssignmentPartyEntry = {
  id: string;
  role: string;
  name: string;
  firmName: string | null;
  email: string | null;
  phone: string | null;
  receivesReport: boolean;
  receivesInvoice: boolean;
  receivesMessages: boolean;
};

export type AssignmentDetail = {
  id: string;
  number: string;
  status: string;
  officeName: string | null;
  orderId: string | null;
  /**
   * Utstedende selskap (`companies.legal_name`), satt fra ansvarlig takstmann. Også et slettet
   * selskap vises, fordi det var det som gjaldt. Tomt når oppdraget ikke har selskap.
   */
  companyName: string | null;
  /** Aktive rader, i rekkefølgen i `TEAM_ROLES`. */
  team: AssignmentTeamEntry[];
  /** Parter som ikke er fjernet, i rekkefølgen i `PARTY_ROLES` og så eldste først. */
  parties: AssignmentPartyEntry[];
  /** Ansatte som kan velges i teamet: ikke slettet, ikke sluttet, sortert på navn. */
  teamCandidates: { id: string; name: string }[];
};

function orderIndex(list: readonly string[], code: string): number {
  const index = list.indexOf(code);
  return index === -1 ? list.length : index;
}

/**
 * Ett oppdrag med team, parter og kandidater til teamet. Ukjent, fremmed, slettet eller ugyldig
 * oppdrags-id gir `AccessDeniedError`.
 */
export async function getAssignment(
  actor: Actor,
  organizationId: string,
  assignmentId: string,
): Promise<AssignmentDetail> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  if (!isUuid(assignmentId)) throw new AccessDeniedError();
  const orgId = grant.organizationId;

  const [assignment] = await db
    .select({
      id: assignments.id,
      number: assignments.number,
      status: assignments.status,
      officeName: offices.name,
      orderId: orders.id,
      companyName: companies.legalName,
    })
    .from(assignments)
    .leftJoin(offices, and(eq(offices.id, assignments.officeId), eq(offices.organizationId, orgId)))
    .leftJoin(
      companies,
      and(eq(companies.id, assignments.companyId), eq(companies.organizationId, orgId)),
    )
    .leftJoin(
      orders,
      and(
        eq(orders.id, assignments.orderId),
        eq(orders.organizationId, orgId),
        isNull(orders.deletedAt),
      ),
    )
    .where(
      and(
        eq(assignments.id, assignmentId),
        eq(assignments.organizationId, orgId),
        isNull(assignments.deletedAt),
      ),
    )
    .limit(1);
  if (!assignment) throw new AccessDeniedError();

  const [teamRows, partyRows, teamCandidates] = await Promise.all([
    db
      .select({
        teamRole: assignmentTeamMembers.teamRole,
        employeeId: assignmentTeamMembers.employeeId,
        employeeName: employees.name,
        fromAt: assignmentTeamMembers.fromAt,
      })
      .from(assignmentTeamMembers)
      .innerJoin(
        employees,
        and(
          eq(employees.id, assignmentTeamMembers.employeeId),
          eq(employees.organizationId, orgId),
        ),
      )
      .where(
        and(
          eq(assignmentTeamMembers.organizationId, orgId),
          eq(assignmentTeamMembers.assignmentId, assignment.id),
          isNull(assignmentTeamMembers.toAt),
          isNull(assignmentTeamMembers.deletedAt),
        ),
      ),
    db
      .select({
        id: assignmentParties.id,
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
      .where(
        and(
          eq(assignmentParties.organizationId, orgId),
          eq(assignmentParties.assignmentId, assignment.id),
          isNull(assignmentParties.deletedAt),
        ),
      )
      .orderBy(asc(assignmentParties.createdAt), asc(assignmentParties.id)),
    db
      .select({ id: employees.id, name: employees.name })
      .from(employees)
      .where(
        and(
          eq(employees.organizationId, orgId),
          isNull(employees.deletedAt),
          isNull(employees.deactivatedAt),
        ),
      )
      .orderBy(asc(employees.name), asc(employees.id)),
  ]);

  const team = [...teamRows].sort(
    (a, b) => orderIndex(TEAM_ROLES, a.teamRole) - orderIndex(TEAM_ROLES, b.teamRole),
  );
  // Stabil sortering: innen samme rolle står den eldste først (rekkefølgen fra spørringen).
  const parties = [...partyRows].sort(
    (a, b) => orderIndex(PARTY_ROLES, a.role) - orderIndex(PARTY_ROLES, b.role),
  );

  return { ...assignment, team, parties, teamCandidates };
}
