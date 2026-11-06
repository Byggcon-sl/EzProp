"use client";

import { useActionState } from "react";
import { Card } from "@/shared/ui/card";
import { Field, Input, Select, Textarea } from "@/shared/ui/form";
import { FormActions, FormErrors } from "../form-parts";
import { initialFormState, textValue, type FormState } from "../form-state";

export type ContactFormValues = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  /** Tom streng betyr «Ingen». */
  firmId: string;
  notes: string;
};

const NOTES_HINT = "Kort og saklig. Ikke skriv helseopplysninger eller fødselsnummer.";

/**
 * Skjemaet for ny og endret kontakt. Én kolonne (PC og iPad). Kilden er ikke et felt: kjernen
 * setter den, og skjemaet viser den som tekst. Firmaene kommer fra siden.
 */
export function ContactForm({
  action,
  contactId,
  initial,
  firms,
  sourceLabel,
  cancelHref,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  /** Med id: endre kontakten. Uten: ny kontakt. */
  contactId?: string;
  initial: ContactFormValues;
  firms: readonly { id: string; name: string }[];
  sourceLabel: string;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const error = (name: string) => state.fieldErrors[name];

  return (
    <form action={formAction} noValidate>
      <Card className="space-y-5">
        <FormErrors state={state} />
        {contactId && <input type="hidden" name="contactId" value={contactId} />}
        <Field label="Fornavn" htmlFor="firstName" error={error("firstName")}>
          <Input
            id="firstName"
            name="firstName"
            required
            maxLength={100}
            autoComplete="off"
            defaultValue={textValue(state, "firstName", initial.firstName)}
          />
        </Field>
        <Field label="Etternavn (valgfritt)" htmlFor="lastName" error={error("lastName")}>
          <Input
            id="lastName"
            name="lastName"
            maxLength={100}
            autoComplete="off"
            defaultValue={textValue(state, "lastName", initial.lastName)}
          />
        </Field>
        <Field label="E-post (valgfritt)" htmlFor="email" error={error("email")}>
          <Input
            id="email"
            name="email"
            type="email"
            maxLength={254}
            autoComplete="off"
            defaultValue={textValue(state, "email", initial.email)}
          />
        </Field>
        <Field label="Telefon (valgfritt)" htmlFor="phone" error={error("phone")}>
          <Input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            maxLength={20}
            autoComplete="off"
            defaultValue={textValue(state, "phone", initial.phone)}
          />
        </Field>
        {/* Ny nøkkel på nedtrekkslisten etter hvert forsøk: React tilbakestiller skjemaet, og
            listen tar ellers ikke valget fra forrige forsøk. */}
        <Field label="Firma" htmlFor="firmId" error={error("firmId")}>
          <Select
            key={state.attempt}
            id="firmId"
            name="firmId"
            defaultValue={textValue(state, "firmId", initial.firmId)}
          >
            <option value="">Ingen</option>
            {firms.map((firm) => (
              <option key={firm.id} value={firm.id}>
                {firm.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notat (valgfritt)" htmlFor="notes" hint={NOTES_HINT} error={error("notes")}>
          <Textarea
            id="notes"
            name="notes"
            maxLength={1000}
            defaultValue={textValue(state, "notes", initial.notes)}
          />
        </Field>
        <p className="text-sm text-slate-600">Kilde: {sourceLabel}</p>
        <FormActions cancelHref={cancelHref} />
      </Card>
    </form>
  );
}
