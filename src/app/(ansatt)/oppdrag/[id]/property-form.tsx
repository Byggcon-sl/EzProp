"use client";

import { useActionState, type ReactNode } from "react";
import { Field, Input } from "@/shared/ui/form";
import { FormErrors, SubmitButton } from "../../form-parts";
import { initialFormState, textValue, type FormState } from "../../form-state";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/** En fast kode med norsk etikett, i fast rekkefølge. */
export type CodeOption = { value: string; label: string };

/** Feltene i skjemaet, med samme navn som i kjernen. Tom tekst = ikke oppgitt. */
export type PropertyFormValues = {
  address: string;
  postalCode: string;
  city: string;
  municipalityNumber: string;
  municipalityName: string;
  housingType: string;
  ownershipForm: string;
  gnr: string;
  bnr: string;
  fnr: string;
  snr: string;
  associationName: string;
  associationOrgNumber: string;
  shareNumber: string;
};

type TextField = Exclude<keyof PropertyFormValues, "housingType" | "ownershipForm">;

const selectClass =
  "block min-h-11 w-full rounded-xl border border-field bg-white px-3 text-base text-slate-900 focus:border-brand-600 aria-invalid:border-red-700";

/** Tekstfeltene i rekkefølgen fra oppgavekortet, delt rundt de to nedtrekkslistene. */
const ADDRESS_FIELDS: { name: TextField; label: string; maxLength: number; numeric?: boolean }[] = [
  { name: "address", label: "Adresse", maxLength: 200 },
  { name: "postalCode", label: "Postnummer", maxLength: 4, numeric: true },
  { name: "city", label: "Poststed", maxLength: 100 },
  { name: "municipalityNumber", label: "Kommunenummer", maxLength: 4, numeric: true },
  { name: "municipalityName", label: "Kommune", maxLength: 100 },
];

const CADASTRAL_FIELDS: { name: TextField; label: string; maxLength: number; numeric?: boolean }[] =
  [
    { name: "gnr", label: "Gårdsnummer (gnr)", maxLength: 5, numeric: true },
    { name: "bnr", label: "Bruksnummer (bnr)", maxLength: 5, numeric: true },
    { name: "fnr", label: "Festenummer (fnr)", maxLength: 5, numeric: true },
    { name: "snr", label: "Seksjonsnummer (snr)", maxLength: 5, numeric: true },
    {
      name: "associationName",
      label: "Borettslag, sameie eller boligaksjeselskap",
      maxLength: 200,
    },
    { name: "associationOrgNumber", label: "Organisasjonsnummer", maxLength: 9, numeric: true },
    { name: "shareNumber", label: "Andelsnummer eller aksjenummer", maxLength: 20 },
  ];

/**
 * Eiendomsskjemaet (én kolonne, også i iPad-størrelse). Uten lagret eiendom er feltene fylt ut
 * fra ordren og `fromOrder` viser linjen om at de må kontrolleres. Boligtype og eierform har
 * ikke noe forhåndsvalg. Siden gir skjemaet ny `key` når de lagrede verdiene endres.
 */
export function PropertyForm({
  assignmentId,
  initial,
  fromOrder,
  housingTypes,
  ownershipForms,
  action,
}: {
  assignmentId: string;
  initial: PropertyFormValues;
  fromOrder: boolean;
  housingTypes: CodeOption[];
  ownershipForms: CodeOption[];
  action: Action;
}) {
  const [state, formAction] = useActionState(action, initialFormState);

  function textInput(field: {
    name: TextField;
    label: string;
    maxLength: number;
    numeric?: boolean;
  }) {
    const id = `property-${field.name}`;
    return (
      <Field
        key={field.name}
        label={field.label}
        htmlFor={id}
        error={state.fieldErrors[field.name]}
      >
        <Input
          id={id}
          name={field.name}
          maxLength={field.maxLength}
          inputMode={field.numeric ? "numeric" : undefined}
          autoComplete="off"
          defaultValue={textValue(state, field.name, initial[field.name])}
        />
      </Field>
    );
  }

  function codeSelect(
    name: "housingType" | "ownershipForm",
    label: string,
    placeholder: string,
    options: CodeOption[],
  ) {
    const id = `property-${name}`;
    return (
      <Field label={label} htmlFor={id} error={state.fieldErrors[name]}>
        <select
          id={id}
          name={name}
          className={selectClass}
          defaultValue={textValue(state, name, initial[name])}
        >
          <option value="">{placeholder}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>
    );
  }

  return (
    <form action={formAction} noValidate className="space-y-5">
      {fromOrder && <p className="text-slate-700">Fylt ut fra ordren. Kontroller før du lagrer.</p>}
      <FormErrors state={state} />
      <input type="hidden" name="assignmentId" value={assignmentId} />
      {ADDRESS_FIELDS.map(textInput)}
      {codeSelect("housingType", "Boligtype", "Velg boligtype", housingTypes)}
      {codeSelect("ownershipForm", "Eierform", "Velg eierform", ownershipForms)}
      {CADASTRAL_FIELDS.map(textInput)}
      <SubmitButton>Lagre eiendom</SubmitButton>
    </form>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-t border-slate-200 py-2 first:border-t-0 first:pt-0">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="mt-0.5 break-words text-slate-900">{children}</dd>
    </div>
  );
}

const EMPTY = <span className="text-slate-500">Ikke oppgitt</span>;

/** Eiendommen som tekst, for den som ikke kan endre. Samme rekkefølge som skjemaet. */
export function PropertyDetails({
  values,
  housingTypeText,
  ownershipFormText,
}: {
  values: PropertyFormValues;
  housingTypeText: string;
  ownershipFormText: string;
}) {
  return (
    <dl>
      {ADDRESS_FIELDS.map((field) => (
        <Detail key={field.name} label={field.label}>
          {values[field.name] || EMPTY}
        </Detail>
      ))}
      <Detail label="Boligtype">{housingTypeText}</Detail>
      <Detail label="Eierform">{ownershipFormText}</Detail>
      {CADASTRAL_FIELDS.map((field) => (
        <Detail key={field.name} label={field.label}>
          {values[field.name] || EMPTY}
        </Detail>
      ))}
    </dl>
  );
}
