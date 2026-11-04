"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Checkbox, ChoiceGroup, Field, Input } from "@/shared/ui/form";
import { FormErrors, SubmitButton } from "../../form-parts";
import { initialFormState, textValue, type FormState } from "../../form-state";

export type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/** Hva parten mottar. Samme navn som i kjernen. */
export type Receives = {
  receivesReport: boolean;
  receivesInvoice: boolean;
  receivesMessages: boolean;
};

/** Rollene i fast rekkefølge med norsk etikett og forhåndsvalgene for hva parten mottar. */
export type PartyRoleOption = { value: string; label: string; receives: Receives };

export type PartyValues = {
  role: string;
  name: string;
  firmName: string;
  email: string;
  phone: string;
} & Receives;

export const EMPTY_PARTY: PartyValues = {
  role: "",
  name: "",
  firmName: "",
  email: "",
  phone: "",
  receivesReport: false,
  receivesInvoice: false,
  receivesMessages: false,
};

const RECEIVES: { name: keyof Receives; label: string }[] = [
  { name: "receivesReport", label: "Rapport" },
  { name: "receivesInvoice", label: "Faktura" },
  { name: "receivesMessages", label: "Kopi av meldinger" },
];

const selectClass =
  "block min-h-11 w-full rounded-xl border border-field bg-white px-3 text-base text-slate-900 focus:border-brand-600 aria-invalid:border-red-700";

/** Avkrysningene fra forrige mislykkede forsøk, ellers `fallback`. */
function receivesFrom(state: FormState, fallback: Receives): Receives {
  if (state.attempt === 0 || Object.keys(state.values).length === 0) return fallback;
  return {
    receivesReport: state.values.receivesReport === "on",
    receivesInvoice: state.values.receivesInvoice === "on",
    receivesMessages: state.values.receivesMessages === "on",
  };
}

/**
 * Skjemaet for en part: rolle først, så navn, firma, e-post og telefon, og hva parten mottar.
 * Når rollen velges, forhåndsutfylles avkrysningene etter rollen; de kan endres etterpå.
 * Brukes både til «Legg til part» og «Endre». `onSaved` kalles når lagringen gikk bra.
 */
export function PartyForm({
  idPrefix,
  hidden,
  initial,
  roles,
  action,
  onSaved,
  onCancel,
}: {
  idPrefix: string;
  hidden: { name: "assignmentId" | "partyId"; value: string };
  initial: PartyValues;
  roles: PartyRoleOption[];
  action: Action;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const [receives, setReceives] = useState<Receives>(() => receivesFrom(state, initial));
  const [lastAttempt, setLastAttempt] = useState(state.attempt);

  // Etter hvert forsøk: lagret gir `onSaved`; feil gir avkrysningene som ble sendt.
  if (state.attempt !== lastAttempt) {
    setLastAttempt(state.attempt);
    if (state.message !== null) setReceives(receivesFrom(state, receives));
  }
  const savedAttempt = state.attempt > 0 && state.message === null ? state.attempt : 0;
  useEffect(() => {
    if (savedAttempt > 0) onSaved();
  }, [savedAttempt, onSaved]);

  function onRoleChange(value: string) {
    const option = roles.find((role) => role.value === value);
    if (option) setReceives(option.receives);
  }

  return (
    <form action={formAction} noValidate className="space-y-5">
      <FormErrors state={state} />
      <input type="hidden" name={hidden.name} value={hidden.value} />
      <Field label="Rolle" htmlFor={`${idPrefix}-role`} error={state.fieldErrors.role}>
        <select
          id={`${idPrefix}-role`}
          name="role"
          className={selectClass}
          defaultValue={textValue(state, "role", initial.role)}
          onChange={(event) => onRoleChange(event.target.value)}
        >
          <option value="">Velg rolle</option>
          {roles.map((role) => (
            <option key={role.value} value={role.value}>
              {role.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Navn" htmlFor={`${idPrefix}-name`} error={state.fieldErrors.name}>
        <Input
          id={`${idPrefix}-name`}
          name="name"
          maxLength={200}
          autoComplete="off"
          defaultValue={textValue(state, "name", initial.name)}
        />
      </Field>
      <Field label="Firma" htmlFor={`${idPrefix}-firmName`} error={state.fieldErrors.firmName}>
        <Input
          id={`${idPrefix}-firmName`}
          name="firmName"
          maxLength={200}
          autoComplete="off"
          defaultValue={textValue(state, "firmName", initial.firmName)}
        />
      </Field>
      <Field label="E-post" htmlFor={`${idPrefix}-email`} error={state.fieldErrors.email}>
        <Input
          id={`${idPrefix}-email`}
          name="email"
          type="email"
          maxLength={254}
          autoComplete="off"
          defaultValue={textValue(state, "email", initial.email)}
        />
      </Field>
      <Field label="Telefon" htmlFor={`${idPrefix}-phone`} error={state.fieldErrors.phone}>
        <Input
          id={`${idPrefix}-phone`}
          name="phone"
          type="tel"
          maxLength={20}
          autoComplete="off"
          defaultValue={textValue(state, "phone", initial.phone)}
        />
      </Field>
      <ChoiceGroup id={`${idPrefix}-receives`} legend="Mottar">
        {RECEIVES.map((item) => (
          <Checkbox
            key={item.name}
            name={item.name}
            label={item.label}
            checked={receives[item.name]}
            onChange={(event) => {
              const checked = event.target.checked;
              setReceives((current) => ({ ...current, [item.name]: checked }));
            }}
          />
        ))}
      </ChoiceGroup>
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <SubmitButton>Lagre</SubmitButton>
        <Button variant="ghost" onClick={onCancel}>
          Avbryt
        </Button>
      </div>
    </form>
  );
}

/**
 * «Legg til part»: knappen åpner skjemaet. Etter lagring lukkes det, og neste åpning starter
 * med tomme felt (navnet fylles aldri ut).
 */
export function AddPartySection({
  assignmentId,
  roles,
  action,
}: {
  assignmentId: string;
  roles: PartyRoleOption[];
  action: Action;
}) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);

  const close = useCallback(() => {
    setOpen(false);
    setFormKey((key) => key + 1);
  }, []);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Legg til part
      </Button>
    );
  }

  return (
    <Card>
      <h3 className="mb-4 text-lg font-medium text-slate-900">Ny part</h3>
      <PartyForm
        key={formKey}
        idPrefix="party-new"
        hidden={{ name: "assignmentId", value: assignmentId }}
        initial={EMPTY_PARTY}
        roles={roles}
        action={action}
        onSaved={close}
        onCancel={close}
      />
    </Card>
  );
}
