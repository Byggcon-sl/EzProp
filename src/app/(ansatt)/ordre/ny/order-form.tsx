"use client";

import { useActionState, useRef } from "react";
import { Card } from "@/shared/ui/card";
import { Checkbox, Field, Input } from "@/shared/ui/form";
import { FormActions, FormErrors } from "../../form-parts";
import { ContactPicker, type ContactHit } from "../../kontakter/contact-picker";
import { initialFormState, textValue, type FormState } from "../../form-state";

/**
 * Skjemaet for ny ordre fra e-posten. Én kolonne (PC og iPad). Ingen felt for kilde eller
 * rapporttype; kjernen setter dem. Bestilleren kan velges i kontaktregisteret; da fylles «Hvem
 * bestilte» med «Navn, Firma», og ordren kobles til kontakten.
 */
export function OrderForm({
  action,
  receivedAtDefault,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  /** Nå i norsk tid, «ÅÅÅÅ-MM-DDTtt:mm». */
  receivedAtDefault: string;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const error = (name: string) => state.fieldErrors[name];
  const sellerDeclarationChecked =
    state.attempt > 0 ? state.values.sellerDeclarationReceived === "on" : false;
  const orderedByRef = useRef<HTMLInputElement>(null);

  function onContactSelect(contact: ContactHit) {
    if (orderedByRef.current) {
      orderedByRef.current.value = contact.firmName
        ? `${contact.name}, ${contact.firmName}`
        : contact.name;
    }
  }

  return (
    <form action={formAction} noValidate>
      <Card className="space-y-5">
        <FormErrors state={state} />
        <Field label="Adresse" htmlFor="addressText" error={error("addressText")}>
          <Input
            id="addressText"
            name="addressText"
            required
            maxLength={300}
            defaultValue={textValue(state, "addressText", "")}
          />
        </Field>
        <Field label="Mottatt" htmlFor="receivedAt" error={error("receivedAt")}>
          <Input
            id="receivedAt"
            name="receivedAt"
            type="datetime-local"
            defaultValue={textValue(state, "receivedAt", receivedAtDefault)}
          />
        </Field>
        <ContactPicker
          idPrefix="orderedBy"
          name="orderedByContactId"
          initial={null}
          error={error("orderedByContactId")}
          onSelect={onContactSelect}
        />
        <Field
          label="Hvem bestilte (valgfritt)"
          htmlFor="orderedByText"
          hint="Navn og firma, slik det sto i e-posten. Velg kontakten i søket over, så fylles feltet ut."
          error={error("orderedByText")}
        >
          <Input
            ref={orderedByRef}
            id="orderedByText"
            name="orderedByText"
            maxLength={200}
            defaultValue={textValue(state, "orderedByText", "")}
          />
        </Field>
        <Field
          label="Ekstern referanse (valgfritt)"
          htmlFor="externalRef"
          hint="Ordrenummeret fra megleren."
          error={error("externalRef")}
        >
          <Input
            id="externalRef"
            name="externalRef"
            maxLength={200}
            defaultValue={textValue(state, "externalRef", "")}
          />
        </Field>
        <Field label="Gårdsnummer (valgfritt)" htmlFor="gnr" error={error("gnr")}>
          <Input
            id="gnr"
            name="gnr"
            inputMode="numeric"
            maxLength={10}
            defaultValue={textValue(state, "gnr", "")}
          />
        </Field>
        <Field label="Bruksnummer (valgfritt)" htmlFor="bnr" error={error("bnr")}>
          <Input
            id="bnr"
            name="bnr"
            inputMode="numeric"
            maxLength={10}
            defaultValue={textValue(state, "bnr", "")}
          />
        </Field>
        <Field label="Seksjonsnummer (valgfritt)" htmlFor="snr" error={error("snr")}>
          <Input
            id="snr"
            name="snr"
            inputMode="numeric"
            maxLength={10}
            defaultValue={textValue(state, "snr", "")}
          />
        </Field>
        <Field
          label="Borettslag eller sameie (valgfritt)"
          htmlFor="housingAssociationName"
          error={error("housingAssociationName")}
        >
          <Input
            id="housingAssociationName"
            name="housingAssociationName"
            maxLength={200}
            defaultValue={textValue(state, "housingAssociationName", "")}
          />
        </Field>
        <Checkbox
          name="sellerDeclarationReceived"
          label="Egenerklæring mottatt"
          defaultChecked={sellerDeclarationChecked}
        />
        <FormActions cancelHref="/ordre" />
      </Card>
    </form>
  );
}
