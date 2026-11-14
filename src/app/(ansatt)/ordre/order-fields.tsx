"use client";

import { useRef, type FocusEvent } from "react";
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

/** Startverdiene for bestillingen på oppdraget. Egenerklæringen står ikke i skjemaet. */
export type BookingFieldDefaults = Omit<OrderFieldDefaults, "sellerDeclarationReceived">;

type PartProps = { state: FormState; defaults: BookingFieldDefaults };

function fieldError(state: FormState, name: string) {
  return state.fieldErrors[name];
}

function AddressField({
  state,
  defaults,
  hint,
  onBlur,
}: PartProps & { hint?: string; onBlur?: () => void }) {
  // Bare i oppdragsskjemaet (med hjelpetekst): ordreskjemaet er uendret.
  return (
    <Field
      label="Adresse"
      htmlFor="addressText"
      hint={hint}
      error={fieldError(state, "addressText")}
    >
      <Input
        id="addressText"
        name="addressText"
        required
        maxLength={300}
        autoComplete={hint ? "off" : undefined}
        onBlur={onBlur}
        defaultValue={textValue(state, "addressText", defaults.addressText)}
      />
    </Field>
  );
}

function ReceivedAtField({ state, defaults }: PartProps) {
  return (
    <Field label="Mottatt" htmlFor="receivedAt" error={fieldError(state, "receivedAt")}>
      <Input
        id="receivedAt"
        name="receivedAt"
        type="datetime-local"
        defaultValue={textValue(state, "receivedAt", defaults.receivedAt)}
      />
    </Field>
  );
}

function ExternalRefField({ state, defaults, label }: PartProps & { label: string }) {
  return (
    <Field
      label={label}
      htmlFor="externalRef"
      hint="Ordrenummeret fra megleren."
      error={fieldError(state, "externalRef")}
    >
      <Input
        id="externalRef"
        name="externalRef"
        maxLength={200}
        defaultValue={textValue(state, "externalRef", defaults.externalRef)}
      />
    </Field>
  );
}

function HousingAssociationField({ state, defaults }: PartProps) {
  return (
    <Field
      label="Borettslag eller sameie (valgfritt)"
      htmlFor="housingAssociationName"
      error={fieldError(state, "housingAssociationName")}
    >
      <Input
        id="housingAssociationName"
        name="housingAssociationName"
        maxLength={200}
        defaultValue={textValue(state, "housingAssociationName", defaults.housingAssociationName)}
      />
    </Field>
  );
}

const CADASTRE_FIELDS = [
  { name: "gnr", label: "Gårdsnummer" },
  { name: "bnr", label: "Bruksnummer" },
  { name: "snr", label: "Seksjonsnummer" },
] as const;

function CadastreField({
  state,
  defaults,
  name,
  label,
}: PartProps & { name: "gnr" | "bnr" | "snr"; label: string }) {
  return (
    <Field label={label} htmlFor={name} error={fieldError(state, name)}>
      <Input
        id={name}
        name={name}
        inputMode="numeric"
        maxLength={10}
        defaultValue={textValue(state, name, defaults[name])}
      />
    </Field>
  );
}

/** Kontaktvelgeren og «Hvem bestilte». Velges kontakten, fylles feltet med «Navn, Firma». */
export function OrderedByFields({ state, defaults }: PartProps) {
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
      <ContactPicker
        idPrefix="orderedBy"
        name="orderedByContactId"
        initial={defaults.orderedByContact}
        error={fieldError(state, "orderedByContactId")}
        onSelect={onContactSelect}
      />
      <Field
        label="Hvem bestilte (valgfritt)"
        htmlFor="orderedByText"
        hint="Navn og firma, slik det sto i e-posten. Velg kontakten i søket over, så fylles feltet ut."
        error={fieldError(state, "orderedByText")}
      >
        <Input
          ref={orderedByRef}
          id="orderedByText"
          name="orderedByText"
          maxLength={200}
          defaultValue={textValue(state, "orderedByText", defaults.orderedByText)}
        />
      </Field>
    </>
  );
}

/**
 * Adresse og matrikkel for oppdraget. Matrikkelen står i én gruppe med tre felt (tre kolonner fra
 * `md`). `onAddressBlur` kalles når adressefeltet forlates, `onCadastreBlur` når fokus forlater
 * hele matrikkelgruppen (dublettvarselet).
 */
export function OrderPropertyFields({
  state,
  defaults,
  onAddressBlur,
  onCadastreBlur,
}: PartProps & { onAddressBlur?: () => void; onCadastreBlur?: () => void }) {
  function onGroupBlur(event: FocusEvent<HTMLFieldSetElement>) {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    onCadastreBlur?.();
  }

  return (
    <>
      <AddressField
        state={state}
        defaults={defaults}
        hint="Gate, nummer, postnummer og sted."
        onBlur={onAddressBlur}
      />
      <fieldset onBlur={onGroupBlur} className="min-w-0 space-y-1.5">
        <legend className="text-sm font-medium text-slate-700">Matrikkel (valgfritt)</legend>
        <div className="grid gap-5 md:grid-cols-3">
          {CADASTRE_FIELDS.map((field) => (
            <CadastreField
              key={field.name}
              state={state}
              defaults={defaults}
              name={field.name}
              label={field.label}
            />
          ))}
        </div>
      </fieldset>
    </>
  );
}

/** «Mer om bestillingen»: mottatt, meglerens ordrenummer og borettslag eller sameie. */
export function OrderMoreFields({ state, defaults }: PartProps) {
  return (
    <>
      <ReceivedAtField state={state} defaults={defaults} />
      <ExternalRefField
        state={state}
        defaults={defaults}
        label="Meglerens ordrenummer (valgfritt)"
      />
      <HousingAssociationField state={state} defaults={defaults} />
    </>
  );
}

/**
 * Feltene i bestillingen, felles for «Ny ordre», «Endre ordren» og «Endre bestillingen» på
 * oppdraget: samme `name`, samme grenser, samme kontaktvelger og samme feilvisning. Én kolonne (PC
 * og iPad). Ingen felt for kilde eller rapporttype; kjernen setter dem. Etter et mislykket forsøk
 * vises det som ble sendt.
 *
 * - `layout="order"` (standard): rekkefølgen og etikettene i ordreskjemaet, med egenerklæringen.
 * - `layout="assignment"`: eiendom, bestiller og «Mer om bestillingen» etter hverandre, uten
 *   egenerklæring. «Nytt oppdrag» bruker delene (`OrderPropertyFields`, `OrderedByFields`,
 *   `OrderMoreFields`) hver for seg i egne kort.
 */
export function OrderFields({
  state,
  defaults,
  layout = "order",
}: {
  state: FormState;
  defaults: OrderFieldDefaults | BookingFieldDefaults;
  layout?: "order" | "assignment";
}) {
  if (layout === "assignment") {
    return (
      <>
        <OrderPropertyFields state={state} defaults={defaults} />
        <OrderedByFields state={state} defaults={defaults} />
        <OrderMoreFields state={state} defaults={defaults} />
      </>
    );
  }

  const declarationDefault =
    "sellerDeclarationReceived" in defaults ? defaults.sellerDeclarationReceived : false;
  const sellerDeclarationChecked =
    state.attempt > 0 ? state.values.sellerDeclarationReceived === "on" : declarationDefault;

  return (
    <>
      <AddressField state={state} defaults={defaults} />
      <ReceivedAtField state={state} defaults={defaults} />
      <OrderedByFields state={state} defaults={defaults} />
      <ExternalRefField state={state} defaults={defaults} label="Ekstern referanse (valgfritt)" />
      {CADASTRE_FIELDS.map((field) => (
        <CadastreField
          key={field.name}
          state={state}
          defaults={defaults}
          name={field.name}
          label={`${field.label} (valgfritt)`}
        />
      ))}
      <HousingAssociationField state={state} defaults={defaults} />
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
