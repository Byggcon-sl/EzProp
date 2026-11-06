import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDeniedError } from "@/core/access";
import { getAssignment } from "@/core/assignments";
import { listClaimsForAssignment } from "@/core/claims";
import { todayInOslo } from "@/shared/lib/dates";
import { isUuid } from "@/shared/lib/uuid";
import { getEmployeeContext } from "../../../../employee-context";
import { NoAccess } from "../../../../no-access";
import { createClaimAction } from "../actions";
import { ClaimForm } from "../claim-form";
import { CLAIM_OUTCOME_OPTIONS, CLAIM_TYPE_OPTIONS, partyOptions } from "../options";

export const metadata: Metadata = { title: "Registrer reklamasjon" };

/**
 * Registrer en reklamasjonssak på oppdraget. Uten rettighetene (flaggene fra kjernen), med ugyldig
 * id, eller når kjernen sier nei (annen organisasjon, fjernet oppdrag), er svaret «Fant ikke
 * siden», samme som for en tilfeldig id.
 */
export default async function NewClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getEmployeeContext();
  if (!context) return <NoAccess />;
  if (!context.canReadClaims || !context.canManageClaims || !isUuid(id)) notFound();

  let assignment: Awaited<ReturnType<typeof getAssignment>>;
  try {
    // Listen hentes bare for at kjernen skal sjekke tilgangen og oppdraget (fjernet gir nei).
    [assignment] = await Promise.all([
      getAssignment(context.actor, context.organizationId, id),
      listClaimsForAssignment(context.actor, context.organizationId, id),
    ]);
  } catch (error) {
    if (error instanceof AccessDeniedError) notFound();
    throw error;
  }

  return (
    <main className="max-w-2xl">
      <Link
        href={`/oppdrag/${id}`}
        className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700"
      >
        <span aria-hidden="true">‹&nbsp;</span>
        Oppdrag&nbsp;<span className="tabular-nums">{assignment.number}</span>
      </Link>
      <h1 className="mt-2 mb-6 text-2xl font-semibold text-slate-900">Registrer reklamasjon</h1>
      <ClaimForm
        hidden={{ name: "assignmentId", value: id }}
        initial={{
          claimType: "complaint",
          receivedAt: todayInOslo(),
          claimantPartyId: "",
          claimantText: "",
          description: "",
          buildingPartText: "",
          outcome: "open",
          amount: "",
        }}
        claimTypes={CLAIM_TYPE_OPTIONS}
        outcomes={CLAIM_OUTCOME_OPTIONS}
        parties={partyOptions(assignment.parties)}
        edit={false}
        cancelHref={`/oppdrag/${id}`}
        action={createClaimAction}
      />
    </main>
  );
}
