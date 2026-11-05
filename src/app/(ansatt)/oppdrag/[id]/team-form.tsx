"use client";

import { useActionState } from "react";
import { Field, Input } from "@/shared/ui/form";
import { FormErrors, SubmitButton } from "../../form-parts";
import { initialFormState, textValue, type FormState } from "../../form-state";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

const selectClass =
  "block min-h-11 w-full rounded-xl border border-field bg-white px-3 text-base text-slate-900 focus:border-brand-600 aria-invalid:border-red-700";

/**
 * Én linje i teamet med nedtrekksliste, valgfri grunn og «Lagre» (to trykk per rolle). «Ingen»
 * fjerner personen fra rollen. Siden gir skjemaet ny `key` når personen er byttet, slik at
 * feltene starter på nytt med den lagrede verdien.
 */
export function TeamMemberForm({
  assignmentId,
  teamRole,
  roleLabel,
  currentEmployeeId,
  candidates,
  action,
}: {
  assignmentId: string;
  teamRole: string;
  roleLabel: string;
  currentEmployeeId: string | null;
  candidates: { id: string; name: string }[];
  action: Action;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const id = `team-${teamRole}`;

  return (
    <form action={formAction} noValidate className="space-y-4">
      <FormErrors state={state} />
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <input type="hidden" name="teamRole" value={teamRole} />
      <Field
        label={`Velg ${roleLabel.toLowerCase()}`}
        htmlFor={`${id}-employee`}
        error={state.fieldErrors.employeeId}
      >
        <select
          id={`${id}-employee`}
          name="employeeId"
          className={selectClass}
          defaultValue={textValue(state, "employeeId", currentEmployeeId)}
        >
          <option value="">Ingen</option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Grunn ved bytte"
        htmlFor={`${id}-reason`}
        hint="For eksempel ferie, fravær eller kapasitet. Ikke skriv helseopplysninger."
        error={state.fieldErrors.reason}
      >
        <Input
          id={`${id}-reason`}
          name="reason"
          maxLength={300}
          defaultValue={textValue(state, "reason", "")}
        />
      </Field>
      <SubmitButton variant="secondary" size="md">
        Lagre
      </SubmitButton>
    </form>
  );
}
