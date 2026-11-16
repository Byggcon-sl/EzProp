import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { AccessDeniedError } from "@/core/access";
import { getNewAssignmentFormOptions, type NewAssignmentFormOptions } from "@/core/assignments";
import { Card } from "@/shared/ui/card";
import { BackLink } from "../../detail";
import { getEmployeeContext } from "../../employee-context";
import { NoAccess } from "../../no-access";
import { NO_OFFICES_MESSAGE } from "../../ordre/office-choice";
import { osloDateTimeLocal } from "../../ordre/received-at";
import { createAssignmentAction, findDraftDuplicatesAction } from "./actions";
import { AssignmentForm } from "./assignment-form";

export const metadata: Metadata = { title: "Nytt oppdrag" };

/** Takstmann med `access.inspectors_edit_all` av: tydelig avvisning, ingen skjemafelt. */
function CannotCreate() {
  return (
    <main className="max-w-2xl">
      <BackLink href="/arbeidskoe">Arbeidskø</BackLink>
      <h1 className="mt-2 mb-6 text-2xl font-semibold text-slate-900">Nytt oppdrag</h1>
      <Card>
        <h2 className="text-lg font-semibold text-slate-900">
          Du har ikke tilgang til å lage oppdrag
        </h2>
        <p className="mt-2 text-slate-600">Spør kontoret eller en leder.</p>
      </Card>
    </main>
  );
}

/**
 * «Nytt oppdrag» (docs/funksjoner/fase2a-nytt-oppdrag.md, Omfang 6–8): ett skjema og ett trykk
 * på «Lagre» gir et oppdrag med status «Bestilt», uten ordre. Valglistene og forhåndsvalgene
 * kommer fra kjernen (`getNewAssignmentFormOptions`, som krever `assignment.edit`). Uten ansattrad:
 * samme svar som andre sider uten tilgang.
 */
export default async function NewAssignmentPage() {
  const context = await getEmployeeContext();
  if (!context) return <NoAccess />;
  if (!context.canCreateAssignments) return <CannotCreate />;

  let options: NewAssignmentFormOptions;
  try {
    options = await getNewAssignmentFormOptions(context.actor, context.organizationId);
  } catch (error) {
    if (error instanceof AccessDeniedError) return <CannotCreate />;
    throw error;
  }

  // Har organisasjonen bare ett kontor, er det valgt fra start, så det synes hva oppdraget får.
  const onlyOffice = options.offices.length === 1 ? (options.offices[0]?.id ?? null) : null;

  return (
    <main className="max-w-2xl">
      <BackLink href="/arbeidskoe">Arbeidskø</BackLink>
      <h1 className="mt-2 text-2xl font-semibold text-slate-900">Nytt oppdrag</h1>
      <p className="mt-1 mb-6 text-slate-600">Rapporttype: Tilstandsrapport</p>
      <AssignmentForm
        action={createAssignmentAction}
        duplicatesAction={findDraftDuplicatesAction}
        creationKey={randomUUID()}
        receivedAtDefault={osloDateTimeLocal(new Date())}
        options={{
          offices: options.offices,
          defaultOfficeId: options.defaultOfficeId ?? onlyOffice,
          officesEmptyMessage: options.offices.length === 0 ? NO_OFFICES_MESSAGE : null,
          inspectors: options.inspectors,
          currentInspectorId: options.defaultResponsibleEmployeeId,
        }}
      />
    </main>
  );
}
