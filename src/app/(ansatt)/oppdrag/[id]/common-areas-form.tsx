"use client";

import { useActionState, type ReactNode } from "react";
import { Field, Input, Select, Textarea } from "@/shared/ui/form";
import { FormErrors, SubmitButton } from "../../form-parts";
import { initialFormState, textValue, type FormState } from "../../form-state";
import type { CodeOption } from "./property-form";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/** Feltene i skjemaet, med samme navn som i kjernen. */
export type CommonAreasFormValues = {
  managingAgent: string;
  conditionReportStatus: string;
  maintenancePlanStatus: string;
  notes: string;
};

const MANAGING_AGENT = "Forretningsfører";
const CONDITION_REPORT = "Finnes tilstandsrapport for fellesdelene?";
const MAINTENANCE_PLAN = "Finnes vedlikeholdsplan?";
const NOTES = "Hva er sett av fellesdelene, og hvordan";

/**
 * Fellesdelene for leilighet: forretningsfører, to ja/nei/vet ikke-spørsmål og hva som er sett.
 * Vises bare når eiendommen har fellesdeler (siden avgjør med `hasCommonAreas`).
 */
export function CommonAreasForm({
  assignmentId,
  initial,
  answers,
  action,
}: {
  assignmentId: string;
  initial: CommonAreasFormValues;
  /** Ja, Nei og Vet ikke i fast rekkefølge. */
  answers: CodeOption[];
  action: Action;
}) {
  const [state, formAction] = useActionState(action, initialFormState);

  function answerSelect(name: "conditionReportStatus" | "maintenancePlanStatus", label: string) {
    const id = `common-areas-${name}`;
    return (
      <Field label={label} htmlFor={id} error={state.fieldErrors[name]}>
        <Select id={id} name={name} defaultValue={textValue(state, name, initial[name])}>
          {answers.map((answer) => (
            <option key={answer.value} value={answer.value}>
              {answer.label}
            </option>
          ))}
        </Select>
      </Field>
    );
  }

  return (
    <form action={formAction} noValidate className="space-y-5">
      <FormErrors state={state} />
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <Field
        label={MANAGING_AGENT}
        htmlFor="common-areas-managingAgent"
        error={state.fieldErrors.managingAgent}
      >
        <Input
          id="common-areas-managingAgent"
          name="managingAgent"
          maxLength={200}
          autoComplete="off"
          defaultValue={textValue(state, "managingAgent", initial.managingAgent)}
        />
      </Field>
      {answerSelect("conditionReportStatus", CONDITION_REPORT)}
      {answerSelect("maintenancePlanStatus", MAINTENANCE_PLAN)}
      <Field label={NOTES} htmlFor="common-areas-notes" error={state.fieldErrors.notes}>
        <Textarea
          id="common-areas-notes"
          name="notes"
          maxLength={2000}
          defaultValue={textValue(state, "notes", initial.notes)}
        />
      </Field>
      <SubmitButton>Lagre fellesdeler</SubmitButton>
    </form>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-t border-slate-200 py-2 first:border-t-0 first:pt-0">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="mt-0.5 break-words whitespace-pre-line text-slate-900">{children}</dd>
    </div>
  );
}

const EMPTY = <span className="text-slate-500">Ikke oppgitt</span>;

/** Fellesdelene som tekst, for den som ikke kan endre. */
export function CommonAreasDetails({
  values,
  conditionReportText,
  maintenancePlanText,
}: {
  values: CommonAreasFormValues;
  conditionReportText: string;
  maintenancePlanText: string;
}) {
  return (
    <dl>
      <Detail label={MANAGING_AGENT}>{values.managingAgent || EMPTY}</Detail>
      <Detail label={CONDITION_REPORT}>{conditionReportText}</Detail>
      <Detail label={MAINTENANCE_PLAN}>{maintenancePlanText}</Detail>
      <Detail label={NOTES}>{values.notes || EMPTY}</Detail>
    </dl>
  );
}
