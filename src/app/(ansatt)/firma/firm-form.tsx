"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Card } from "@/shared/ui/card";
import { Field, Input, Select, Textarea } from "@/shared/ui/form";
import { FormActions, FormErrors } from "../form-parts";
import { initialFormState, textValue, type FormState } from "../form-state";

export type FirmFormValues = {
  name: string;
  orgNumber: string;
  firmType: string;
  notes: string;
};

/**
 * Skjemaet for nytt og endret firma. Én kolonne (PC og iPad). Typene kommer fra siden (kodene i
 * kjernen), så klienten ikke henter kjernen. Dublett på organisasjonsnummeret vises ved feltet med
 * lenke til firmaet som finnes.
 */
export function FirmForm({
  action,
  firmId,
  initial,
  firmTypes,
  cancelHref,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  /** Med id: endre firmaet. Uten: nytt firma. */
  firmId?: string;
  initial: FirmFormValues;
  firmTypes: readonly { value: string; label: string }[];
  cancelHref: string;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const error = (name: string) => state.fieldErrors[name];

  return (
    <form action={formAction} noValidate>
      <Card className="space-y-5">
        <FormErrors state={state} />
        {firmId && <input type="hidden" name="firmId" value={firmId} />}
        <Field label="Navn" htmlFor="name" error={error("name")}>
          <Input
            id="name"
            name="name"
            required
            maxLength={200}
            autoComplete="organization"
            defaultValue={textValue(state, "name", initial.name)}
          />
        </Field>
        <div className="space-y-1.5">
          <Field
            label="Organisasjonsnummer (valgfritt)"
            htmlFor="orgNumber"
            hint="9 sifre."
            error={error("orgNumber")}
          >
            <Input
              id="orgNumber"
              name="orgNumber"
              inputMode="numeric"
              maxLength={20}
              autoComplete="off"
              defaultValue={textValue(state, "orgNumber", initial.orgNumber)}
            />
          </Field>
          {state.link && (
            <Link
              href={state.link.href}
              className="inline-flex min-h-11 items-center font-medium break-words text-brand-700 underline"
            >
              {state.link.text}
            </Link>
          )}
        </div>
        {/* Ny nøkkel på nedtrekkslisten etter hvert forsøk: React tilbakestiller skjemaet, og
            listen tar ellers ikke valget fra forrige forsøk. */}
        <Field label="Type" htmlFor="firmType" error={error("firmType")}>
          <Select
            key={state.attempt}
            id="firmType"
            name="firmType"
            defaultValue={textValue(state, "firmType", initial.firmType)}
          >
            {firmTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Notat (valgfritt)"
          htmlFor="notes"
          hint="Kort og saklig. Ikke skriv helseopplysninger eller fødselsnummer."
          error={error("notes")}
        >
          <Textarea
            id="notes"
            name="notes"
            maxLength={1000}
            defaultValue={textValue(state, "notes", initial.notes)}
          />
        </Field>
        <FormActions cancelHref={cancelHref} />
      </Card>
    </form>
  );
}
