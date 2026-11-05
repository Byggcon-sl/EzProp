"use client";

import { useActionState } from "react";
import { Card } from "@/shared/ui/card";
import { Field, Input } from "@/shared/ui/form";
import { Notice } from "@/shared/ui/notice";
import { FormErrors, SubmitButton } from "../../form-parts";
import { initialFormState, textValue, type FormState } from "../../form-state";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

const HINT = "La feltet stå tomt hvis befaringen ikke er avtalt eller fristen ikke er satt.";

/** Lagret når siste forsøk ikke ga feil (handlingen svarer uten melding og uten feltfeil). */
function isSaved(state: FormState): boolean {
  return state.attempt > 0 && state.message === null && Object.keys(state.fieldErrors).length === 0;
}

/**
 * Kortet «Befaring og frist» på oppdragssiden (A100): avtalt befaring (dato og klokkeslett i norsk
 * tid) og frist for levering. Begge kan tømmes. Med `canEdit` er det et skjema; ellers står
 * verdiene som tekst. Siden gir kortet ny `key` når de lagrede verdiene endres.
 */
export function ScheduleCard({
  assignmentId,
  inspectionAt,
  dueDate,
  inspectionText,
  dueDateText,
  canEdit,
  action,
}: {
  assignmentId: string;
  /** `datetime-local`-verdi i norsk tid («ÅÅÅÅ-MM-DDTTT:MM»), eller tom. */
  inspectionAt: string;
  /** «ÅÅÅÅ-MM-DD», eller tom. */
  dueDate: string;
  /** Verdiene som tekst for den som ikke kan endre. */
  inspectionText: string;
  dueDateText: string;
  canEdit: boolean;
  action: Action;
}) {
  const [state, formAction] = useActionState(action, initialFormState);

  return (
    <section aria-labelledby="schedule-heading" className="mb-6">
      <Card>
        <h2 id="schedule-heading" className="text-xl font-semibold text-slate-900">
          Befaring og frist
        </h2>
        {canEdit ? (
          <form action={formAction} noValidate className="mt-4 space-y-5">
            {isSaved(state) && <Notice message="Befaring og frist er lagret." />}
            <FormErrors state={state} />
            <input type="hidden" name="assignmentId" value={assignmentId} />
            <div className="grid gap-5 md:grid-cols-2">
              <Field
                label="Avtalt befaring"
                htmlFor="schedule-inspectionAt"
                error={state.fieldErrors.inspectionAt}
              >
                <Input
                  id="schedule-inspectionAt"
                  name="inspectionAt"
                  type="datetime-local"
                  defaultValue={textValue(state, "inspectionAt", inspectionAt)}
                />
              </Field>
              <Field
                label="Frist for levering"
                htmlFor="schedule-dueDate"
                error={state.fieldErrors.dueDate}
              >
                <Input
                  id="schedule-dueDate"
                  name="dueDate"
                  type="date"
                  defaultValue={textValue(state, "dueDate", dueDate)}
                />
              </Field>
            </div>
            <p className="text-sm text-slate-600">{HINT}</p>
            <SubmitButton size="md">Lagre</SubmitButton>
          </form>
        ) : (
          <dl className="mt-4 grid gap-5 md:grid-cols-2">
            <div>
              <dt className="text-sm text-slate-600">Avtalt befaring</dt>
              <dd className="mt-0.5 text-slate-900">{inspectionText}</dd>
            </div>
            <div>
              <dt className="text-sm text-slate-600">Frist for levering</dt>
              <dd className="mt-0.5 text-slate-900">{dueDateText}</dd>
            </div>
          </dl>
        )}
      </Card>
    </section>
  );
}
