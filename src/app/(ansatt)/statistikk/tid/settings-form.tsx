"use client";

import { useActionState } from "react";
import { Card } from "@/shared/ui/card";
import { Checkbox, Field, Input } from "@/shared/ui/form";
import { FormErrors, SubmitButton } from "../../form-parts";
import { initialFormState, textValue, type FormState } from "../../form-state";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

export type TimeTrackingFormValues = {
  enabled: boolean;
  source: string;
  phases: { phase: string; label: string; minutes: string }[];
};

/**
 * Nullpunktet fra IVIT og bryteren «Mål tid». Vises bare for admin (siden avgjør det); kjernen
 * sjekker likevel (`organization.manage`).
 */
export function TimeTrackingSettingsForm({
  initial,
  action,
}: {
  initial: TimeTrackingFormValues;
  action: Action;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const error = (name: string) => state.fieldErrors[name];
  const enabled = state.attempt > 0 ? state.values.enabled === "on" : initial.enabled;

  return (
    <form action={formAction} noValidate>
      <Card className="space-y-5">
        <h2 className="text-lg font-semibold text-slate-900">Nullpunkt og måling</h2>
        <FormErrors state={state} />
        <Checkbox
          // Ny nøkkel etter et mislykket forsøk, så boksen viser det som ble sendt.
          key={`enabled-${state.attempt}`}
          name="enabled"
          label="Mål tid"
          description="Slå av hvis de ansatte ikke ønsker måling (arbeidsmiljøloven kapittel 9)."
          defaultChecked={enabled}
        />
        <fieldset className="min-w-0 space-y-3">
          <legend className="text-sm font-medium text-slate-700">
            Nullpunkt fra IVIT, minutter per oppdrag
          </legend>
          <div className="grid gap-5 sm:grid-cols-2">
            {initial.phases.map(({ phase, label, minutes }) => (
              <Field key={phase} label={label} htmlFor={`baseline-${phase}`} error={error(phase)}>
                <Input
                  id={`baseline-${phase}`}
                  name={phase}
                  inputMode="numeric"
                  autoComplete="off"
                  defaultValue={textValue(state, phase, minutes)}
                />
              </Field>
            ))}
          </div>
        </fieldset>
        <Field
          label="Kilde"
          htmlFor="baseline-source"
          hint="For eksempel «Måling i IVIT, 10 oppdrag». Høyst 200 tegn."
          error={error("source")}
        >
          <Input
            id="baseline-source"
            name="source"
            maxLength={200}
            autoComplete="off"
            defaultValue={textValue(state, "source", initial.source)}
          />
        </Field>
        <div className="pt-2">
          <SubmitButton>Lagre</SubmitButton>
        </div>
      </Card>
    </form>
  );
}
