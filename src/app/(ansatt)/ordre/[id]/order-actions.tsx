"use client";

import { useActionState } from "react";
import { Card } from "@/shared/ui/card";
import { Field, Select, Textarea } from "@/shared/ui/form";
import { FormErrors, SubmitButton } from "../../form-parts";
import { initialFormState, textValue, type FormState } from "../../form-state";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/**
 * «Gjør om til oppdrag»: velg kontor og trykk knappen, ingen dialog oppå. Uten kontorer i
 * organisasjonen vises beskjeden i stedet for knappen.
 */
export function ConvertOrderForm({
  orderId,
  offices,
  defaultOfficeId,
  emptyMessage,
  action,
}: {
  orderId: string;
  offices: { id: string; name: string }[];
  defaultOfficeId: string | null;
  emptyMessage: string | null;
  action: Action;
}) {
  const [state, formAction] = useActionState(action, initialFormState);

  return (
    <Card>
      <h2 className="mb-4 text-lg font-medium text-slate-900">Nytt oppdrag</h2>
      {emptyMessage ? (
        <p className="text-slate-600">{emptyMessage}</p>
      ) : (
        <form action={formAction} noValidate className="space-y-5">
          <FormErrors state={state} />
          <input type="hidden" name="orderId" value={orderId} />
          <Field
            label="Kontor"
            htmlFor="officeId"
            hint="Oppdraget får nummer når du trykker på knappen."
            error={state.fieldErrors.officeId}
          >
            <Select
              id="officeId"
              name="officeId"
              defaultValue={textValue(state, "officeId", defaultOfficeId)}
            >
              {defaultOfficeId === null && <option value="">Velg kontor</option>}
              {offices.map((office) => (
                <option key={office.id} value={office.id}>
                  {office.name}
                </option>
              ))}
            </Select>
          </Field>
          <SubmitButton>Gjør om til oppdrag</SubmitButton>
        </form>
      )}
    </Card>
  );
}

/** «Avvis»: grunnen som må fylles ut, er bekreftelsen. Ingen dialog oppå. */
export function RejectOrderForm({ orderId, action }: { orderId: string; action: Action }) {
  const [state, formAction] = useActionState(action, initialFormState);

  return (
    <Card>
      <h2 className="mb-4 text-lg font-medium text-slate-900">Avvis ordren</h2>
      <form action={formAction} noValidate className="space-y-5">
        <FormErrors state={state} />
        <input type="hidden" name="orderId" value={orderId} />
        <Field
          label="Grunn"
          htmlFor="reason"
          hint="Ingen fødselsnummer eller helseopplysninger."
          error={state.fieldErrors.reason}
        >
          <Textarea
            id="reason"
            name="reason"
            maxLength={500}
            className="min-h-24"
            defaultValue={textValue(state, "reason", "")}
          />
        </Field>
        <SubmitButton variant="secondary">Avvis</SubmitButton>
      </form>
    </Card>
  );
}
