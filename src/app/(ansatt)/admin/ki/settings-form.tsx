"use client";

import { useActionState } from "react";
import { Card } from "@/shared/ui/card";
import { Field, Input } from "@/shared/ui/form";
import { FormErrors, SubmitButton } from "../../form-parts";
import { initialFormState, textValue, type FormState } from "../../form-state";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/** Fast hjelpetekst (oppgavekortet, Omfang 4). Lover aldri sletting. */
const RETENTION_HINT =
  "Tallet er hvor lenge et avvist forslag minst oppbevares. Ingenting fjernes automatisk ennå. Godtatte og endrede forslag oppbevares alltid i minst 10 år. Endringen gjelder bare forslag som avvises etter at du har lagret.";

/**
 * Ett tallfelt for hvor lenge avviste KI-forslag minst oppbevares. Siden vises bare for admin
 * (siden og kjernen avgjør det); komponenten har ingen tilgangslogikk.
 */
export function AiRetentionSettingsForm({
  initialYears,
  min,
  max,
  action,
}: {
  initialYears: number;
  min: number;
  max: number;
  action: Action;
}) {
  const [state, formAction] = useActionState(action, initialFormState);

  return (
    <form action={formAction} noValidate>
      <Card className="space-y-5">
        <h2 className="text-lg font-semibold text-slate-900">Avviste forslag</h2>
        <FormErrors state={state} />
        <Field
          label="Oppbevar avviste KI-forslag minst (år)"
          htmlFor="rejected-retention-years"
          hint={RETENTION_HINT}
          error={state.fieldErrors.rejectedRetentionYears}
        >
          <Input
            // Ny nøkkel etter et mislykket forsøk, så feltet viser det som ble sendt.
            key={`years-${state.attempt}`}
            id="rejected-retention-years"
            name="rejectedRetentionYears"
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            step={1}
            autoComplete="off"
            className="max-w-32"
            defaultValue={textValue(state, "rejectedRetentionYears", String(initialYears))}
          />
        </Field>
        <div className="pt-2">
          <SubmitButton>Lagre</SubmitButton>
        </div>
      </Card>
    </form>
  );
}
