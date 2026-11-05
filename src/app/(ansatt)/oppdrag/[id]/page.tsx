import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDeniedError } from "@/core/access";
import {
  assignmentStatusLabel,
  defaultReceives,
  getAssignment,
  PARTY_ROLES,
  partyRoleLabel,
  TEAM_ROLES,
  teamRoleLabel,
} from "@/core/assignments";
import { isUuid } from "@/shared/lib/uuid";
import { Badge } from "@/shared/ui/badge";
import { Card } from "@/shared/ui/card";
import { getEmployeeContext } from "../../employee-context";
import { NoAccess } from "../../no-access";
import {
  addPartyAction,
  removePartyAction,
  setTeamMemberAction,
  updatePartyAction,
} from "./actions";
import { PartyCard } from "./party-card";
import { AddPartySection, type PartyRoleOption } from "./party-form";
import { TeamMemberForm } from "./team-form";

export const metadata: Metadata = { title: "Oppdrag" };

/**
 * Oppdraget med team (fem roller) og parter. Skjemaene vises bare med `canEditOrders`; selve
 * sjekken skjer i kjernen. Ugyldig, ukjent, slettet og fremmed id gir «Fant ikke siden».
 */
export default async function AssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getEmployeeContext();
  if (!context) return <NoAccess />;
  if (!isUuid(id)) notFound();

  let assignment: Awaited<ReturnType<typeof getAssignment>>;
  try {
    assignment = await getAssignment(context.actor, context.organizationId, id);
  } catch (error) {
    if (error instanceof AccessDeniedError) notFound();
    throw error;
  }

  const canEdit = context.canEditOrders;
  const roles: PartyRoleOption[] = PARTY_ROLES.map((role) => ({
    value: role,
    label: partyRoleLabel(role),
    receives: defaultReceives(role),
  }));

  return (
    <main className="max-w-2xl">
      {assignment.orderId && (
        <Link
          href={`/ordre/${assignment.orderId}`}
          className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700"
        >
          <span aria-hidden="true">‹&nbsp;</span>
          Ordren
        </Link>
      )}
      <div className="mt-2 mb-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">
          Oppdrag <span className="tabular-nums">{assignment.number}</span>
        </h1>
        <Badge tone="brand">{assignmentStatusLabel(assignment.status)}</Badge>
      </div>
      <p className="text-slate-600">Kontor: {assignment.officeName}</p>
      <div className="mb-6">
        <p className="break-words text-slate-600">
          Utstedende selskap: {assignment.companyName ?? "Ikke satt"}
        </p>
        {!assignment.companyName && (
          <p className="text-sm text-slate-500">
            Settes fra ansvarlig takstmann. Har den ansvarlige ikke selskap, legger admin det inn
            under Ansatte.
          </p>
        )}
      </div>

      <section aria-labelledby="team-heading" className="mb-8">
        <h2 id="team-heading" className="mb-3 text-xl font-semibold text-slate-900">
          Team
        </h2>
        <Card className="p-0">
          <ul>
            {TEAM_ROLES.map((teamRole) => {
              const member = assignment.team.find((row) => row.teamRole === teamRole);
              const label = teamRoleLabel(teamRole);
              return (
                <li
                  key={teamRole}
                  className="border-t border-slate-200 p-6 first:border-t-0"
                  aria-label={label}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <h3 className="font-medium text-slate-900">{label}</h3>
                    <p className="break-words text-slate-900">
                      {member ? (
                        member.employeeName
                      ) : (
                        <span className="text-slate-500">Ikke satt</span>
                      )}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="mt-4">
                      <TeamMemberForm
                        key={member?.employeeId ?? "none"}
                        assignmentId={assignment.id}
                        teamRole={teamRole}
                        roleLabel={label}
                        currentEmployeeId={member?.employeeId ?? null}
                        candidates={assignment.teamCandidates}
                        action={setTeamMemberAction}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      </section>

      <section aria-labelledby="parties-heading">
        <h2 id="parties-heading" className="mb-3 text-xl font-semibold text-slate-900">
          Parter
        </h2>
        {assignment.parties.length === 0 ? (
          <p className="mb-4 text-slate-600">Ingen parter er lagt inn ennå.</p>
        ) : (
          <ul className="mb-4 space-y-4">
            {assignment.parties.map((party) => (
              <li key={party.id}>
                <PartyCard
                  party={{
                    id: party.id,
                    role: party.role,
                    roleLabel: partyRoleLabel(party.role),
                    name: party.name,
                    firmName: party.firmName ?? "",
                    email: party.email ?? "",
                    phone: party.phone ?? "",
                    receivesReport: party.receivesReport,
                    receivesInvoice: party.receivesInvoice,
                    receivesMessages: party.receivesMessages,
                  }}
                  canEdit={canEdit}
                  roles={roles}
                  updateAction={updatePartyAction}
                  removeAction={removePartyAction}
                />
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <AddPartySection assignmentId={assignment.id} roles={roles} action={addPartyAction} />
        )}
      </section>
    </main>
  );
}
