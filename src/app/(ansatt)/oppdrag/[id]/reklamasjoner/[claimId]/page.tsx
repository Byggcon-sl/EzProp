import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDeniedError } from "@/core/access";
import { getAssignment } from "@/core/assignments";
import { getClaim } from "@/core/claims";
import { isUuid } from "@/shared/lib/uuid";
import { getEmployeeContext } from "../../../../employee-context";
import { NoAccess } from "../../../../no-access";
import { removeClaimAction, updateClaimAction } from "../actions";
import { ClaimForm, RemoveClaimForm } from "../claim-form";
import { CLAIM_OUTCOME_OPTIONS, CLAIM_TYPE_OPTIONS, partyOptions } from "../options";

export const metadata: Metadata = { title: "Reklamasjon" };

/**
 * Én reklamasjonssak: endre, lukke med utfall og beløp, åpne igjen eller fjerne. Den som bare kan
 * se sakene, ser skjemaet låst. Uten rettighet, med ugyldig id, en sak på et annet oppdrag, eller
 * når kjernen sier nei, er svaret «Fant ikke siden», samme som for en tilfeldig id.
 */
export default async function ClaimPage({
  params,
}: {
  params: Promise<{ id: string; claimId: string }>;
}) {
  const { id, claimId } = await params;
  const context = await getEmployeeContext();
  if (!context) return <NoAccess />;
  if (!context.canReadClaims || !isUuid(id) || !isUuid(claimId)) notFound();

  let claim: Awaited<ReturnType<typeof getClaim>>;
  let assignment: Awaited<ReturnType<typeof getAssignment>>;
  try {
    [claim, assignment] = await Promise.all([
      getClaim(context.actor, context.organizationId, claimId),
      getAssignment(context.actor, context.organizationId, id),
    ]);
  } catch (error) {
    if (error instanceof AccessDeniedError) notFound();
    throw error;
  }
  if (claim.assignmentId !== assignment.id) notFound();

  const canManage = context.canManageClaims;

  return (
    <main className="max-w-2xl">
      <Link
        href={`/oppdrag/${id}`}
        className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700"
      >
        <span aria-hidden="true">‹&nbsp;</span>
        Oppdrag&nbsp;<span className="tabular-nums">{assignment.number}</span>
      </Link>
      <h1 className="mt-2 mb-6 text-2xl font-semibold text-slate-900">Reklamasjon</h1>
      <ClaimForm
        hidden={{ name: "claimId", value: claim.id }}
        initial={{
          claimType: claim.claimType,
          receivedAt: claim.receivedAt,
          claimantPartyId: claim.claimantPartyId ?? "",
          claimantText: claim.claimantText ?? "",
          description: claim.description,
          buildingPartText: claim.buildingPartText ?? "",
          outcome: claim.outcome,
          amount: claim.amount === null ? "" : String(claim.amount),
        }}
        claimTypes={CLAIM_TYPE_OPTIONS}
        outcomes={CLAIM_OUTCOME_OPTIONS}
        parties={partyOptions(assignment.parties)}
        edit
        readOnly={!canManage}
        cancelHref={`/oppdrag/${id}`}
        action={updateClaimAction}
      />
      {canManage && <RemoveClaimForm claimId={claim.id} action={removeClaimAction} />}
    </main>
  );
}
