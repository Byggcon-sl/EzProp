"use client";

import Link from "next/link";
import { useActionState, useCallback, useState, type ReactNode } from "react";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { FormErrors, SubmitButton } from "../../form-parts";
import { initialFormState } from "../../form-state";
import { PartyForm, type Action, type PartyRoleOption, type PartyValues } from "./party-form";

export type PartyView = PartyValues & { id: string; roleLabel: string };

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-t border-slate-200 py-2 first:border-t-0 first:pt-0">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="mt-0.5 break-words text-slate-900">{children}</dd>
    </div>
  );
}

const EMPTY = <span className="text-slate-500">Ikke oppgitt</span>;

function receivesText(party: PartyValues) {
  const items = [
    party.receivesReport && "Rapport",
    party.receivesInvoice && "Faktura",
    party.receivesMessages && "Kopi av meldinger",
  ].filter(Boolean);
  return items.length > 0 ? items.join(", ") : <span className="text-slate-500">Ingenting</span>;
}

/** «Fjern»: myk sletting uten egen dialog. Parten kan legges inn igjen. */
function RemovePartyForm({ partyId, action }: { partyId: string; action: Action }) {
  const [state, formAction] = useActionState(action, initialFormState);
  return (
    <form action={formAction} className="space-y-3">
      <FormErrors state={state} />
      <input type="hidden" name="partyId" value={partyId} />
      <SubmitButton variant="secondary" size="md">
        Fjern
      </SubmitButton>
    </form>
  );
}

/**
 * Ett kort per part (samme visning i alle størrelser): rolle, navn, firma, e-post, telefon og hva
 * parten mottar. Er parten koblet til en kontakt, lenker kortet til kontakten i registeret (bare
 * id-en brukes, navnet er friteksten på parten). Med `canEdit` får kortet «Endre» (samme skjema som «Legg til part») og «Fjern».
 */
export function PartyCard({
  party,
  canEdit,
  roles,
  updateAction,
  removeAction,
}: {
  party: PartyView;
  canEdit: boolean;
  roles: PartyRoleOption[];
  updateAction: Action;
  removeAction: Action;
}) {
  const [editing, setEditing] = useState(false);
  const close = useCallback(() => setEditing(false), []);

  if (editing) {
    return (
      <Card>
        <h3 className="mb-4 text-lg font-medium text-slate-900">
          Endre {party.roleLabel.toLowerCase()}
        </h3>
        <PartyForm
          idPrefix={`party-${party.id}`}
          hidden={{ name: "partyId", value: party.id }}
          initial={party}
          roles={roles}
          action={updateAction}
          onSaved={close}
          onCancel={close}
        />
      </Card>
    );
  }

  return (
    <Card>
      <p className="text-sm font-medium text-brand-700">{party.roleLabel}</p>
      <h3 className="mt-0.5 text-lg font-medium break-words text-slate-900">{party.name}</h3>
      <dl className="mt-3">
        <Detail label="Firma">{party.firmName || EMPTY}</Detail>
        <Detail label="E-post">{party.email || EMPTY}</Detail>
        <Detail label="Telefon">{party.phone || EMPTY}</Detail>
        <Detail label="Mottar">{receivesText(party)}</Detail>
      </dl>
      {party.contactId && (
        <Link
          href={`/kontakter/${party.contactId}`}
          className="mt-2 inline-flex min-h-11 items-center font-medium text-brand-700 underline"
        >
          Kontakt i registeret
        </Link>
      )}
      {canEdit && (
        <div className="mt-4 flex flex-wrap items-start gap-3">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Endre
          </Button>
          <RemovePartyForm partyId={party.id} action={removeAction} />
        </div>
      )}
    </Card>
  );
}
