"use client";

import { useRef } from "react";
import { Checkbox, Field, Input } from "@/shared/ui/form";
import { ContactPicker, type ContactHit, type LinkedContact } from "../kontakter/contact-picker";
import { textValue, type FormState } from "../form-state";

/** Startverdiene i ordreskjemaet. Tomme felt er tom tekst. */
export type OrderFieldDefaults = {
  addressText: string;
  /** Norsk tid, «ÅÅÅÅ-MM-DDTtt:mm». */
  receivedAt: string;
  externalRef: string;
  orderedByText: string;
  /** Kontakten ordren er koblet til, med navnet fra «Hvem bestilte». */
  orderedByContact: LinkedContact | null;
  gnr: string;
  bnr: string;
  snr: string;
  housingAssociationName: string;
  sellerDeclarationReceived: boolean;
};

/**
 * Feltene i ordren, felles for «Ny ordre» og «Endre ordren»: samme `name`, samme kontaktvelger og
 * samme feilvisning. Én kolonne (PC og iPad). Ingen felt for kilde eller rapporttype; kjernen
 * setter dem. Velges bestilleren i kontaktregisteret, fylles «Hvem bestilte» med «Navn, Firma», og
 * ordren kobles til kontakten. Etter et mislykket forsøk vises det som ble sendt.
 */
export function OrderFields({
  state,
  defaults,
}: {
  state: FormState;
  defaults: OrderFieldDefaults;
}) {
  const error = (name: string) => state.fieldErrors[name];
  const sellerDeclarationChecked =
    state.attempt > 0
      ? state.values.sellerDeclarationReceived === "on"
      : defaults.sellerDeclarationReceived;
  const orderedByRef = useRef<HTMLInputElement>(null);

  function onContactSelect(contact: ContactHit) {
    if (orderedByRef.current) {
      orderedByRef.current.value = contact.firmName
        ? `${contact.name}, ${contact.firmName}`
        : contact.name;
    }
  }

  return (
    <>
      <Field label="Adresse" htmlFor="addressText" error={error("addressText")}>
        <Input
          id="addressText"
          name="addressText"
          required
          maxLength={300}
          defaultValue={textValue(state, "addressText", defaults.addressText)}
        />
      </Field>
      <Field label="Mottatt" htmlFor="receivedAt" error={error("receivedAt")}>
        <Input
          id="receivedAt"
          name="receivedAt"
          type="datetime-local"
          defaultValue={textValue(state, "receivedAt", defaults.receivedAt)}
        />
      </Field>
      <ContactPicker
        idPrefix="orderedBy"
        name="orderedByContactId"
        initial={defaults.orderedByContact}
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
          defaultValue={textValue(state, "orderedByText", defaults.orderedByText)}
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
          defaultValue={textValue(state, "externalRef", defaults.externalRef)}
        />
      </Field>
      <Field label="Gårdsnummer (valgfritt)" htmlFor="gnr" error={error("gnr")}>
        <Input
          id="gnr"
          name="gnr"
          inputMode="numeric"
          maxLength={10}
          defaultValue={textValue(state, "gnr", defaults.gnr)}
        />
      </Field>
      <Field label="Bruksnummer (valgfritt)" htmlFor="bnr" error={error("bnr")}>
        <Input
          id="bnr"
          name="bnr"
          inputMode="numeric"
          maxLength={10}
          defaultValue={textValue(state, "bnr", defaults.bnr)}
        />
      </Field>
      <Field label="Seksjonsnummer (valgfritt)" htmlFor="snr" error={error("snr")}>
        <Input
          id="snr"
          name="snr"
          inputMode="numeric"
          maxLength={10}
          defaultValue={textValue(state, "snr", defaults.snr)}
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
          defaultValue={textValue(state, "housingAssociationName", defaults.housingAssociationName)}
        />
      </Field>
      {/* Ny nøkkel på avkrysningen etter hvert forsøk: React tilbakestiller skjemaet, og den tar
          ellers ikke valget fra forrige forsøk. */}
      <Checkbox
        key={state.attempt}
        name="sellerDeclarationReceived"
        label="Egenerklæring mottatt"
        defaultChecked={sellerDeclarationChecked}
      />
    </>
  );
}
