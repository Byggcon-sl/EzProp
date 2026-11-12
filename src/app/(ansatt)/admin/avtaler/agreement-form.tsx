"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button, buttonVariants } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Field, Input, Textarea } from "@/shared/ui/form";
import { FormErrors, SubmitButton } from "../../form-parts";
import { initialFormState, textValue, type FormState } from "../../form-state";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

export type AgreementFormValues = {
  id: string;
  firmId: string;
  name: string;
  validFrom: string;
  validTo: string | null;
  premiseText: string | null;
  reportProfileCode: string | null;
};

const selectClass =
  "block min-h-11 w-full rounded-lg border border-field bg-white px-3 text-base text-slate-900 focus:border-brand-600 aria-invalid:border-urgent-line";

/**
 * Skjema for ny og eksisterende avtale med oppdragsgiver. Vises bare for admin (siden avgjør
 * det); kjernen sjekker likevel. Firmaet velges fra firmaregisteret.
 */
export function AgreementForm({
  agreement,
  firms,
  action,
}: {
  agreement?: AgreementFormValues;
  firms: { id: string; name: string }[];
  action: Action;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const value = (name: Exclude<keyof AgreementFormValues, "id">) =>
    textValue(state, name, agreement?.[name]);
  const error = (name: string) => state.fieldErrors[name];

  return (
    <form action={formAction} noValidate>
      <Card className="space-y-5">
        <FormErrors state={state} />
        <input type="hidden" name="id" value={agreement?.id ?? ""} />
        <Field
          label="Firma"
          htmlFor="firmId"
          hint={
            firms.length === 0
              ? "Legg inn firmaet under Firma først."
              : "Oppdragsgiveren i firmaregisteret."
          }
          error={error("firmId")}
        >
          <select id="firmId" name="firmId" className={selectClass} defaultValue={value("firmId")}>
            <option value="">Velg firma</option>
            {firms.map((firm) => (
              <option key={firm.id} value={firm.id}>
                {firm.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Navn på avtalen" htmlFor="name" error={error("name")}>
          <Input id="name" name="name" maxLength={120} defaultValue={value("name")} />
        </Field>
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Gyldig fra" htmlFor="validFrom" error={error("validFrom")}>
            <Input id="validFrom" name="validFrom" type="date" defaultValue={value("validFrom")} />
          </Field>
          <Field
            label="Gyldig til (valgfritt)"
            htmlFor="validTo"
            hint="Tomt betyr at avtalen gjelder til den avsluttes."
            error={error("validTo")}
          >
            <Input id="validTo" name="validTo" type="date" defaultValue={value("validTo")} />
          </Field>
        </div>
        <Field
          label="Premissetekst (valgfritt)"
          htmlFor="premiseText"
          hint="Byggcons egen tekst for denne oppdragsgiveren. Kommer i rapporten når PDF-en er klar."
          error={error("premiseText")}
        >
          <Textarea
            id="premiseText"
            name="premiseText"
            rows={10}
            maxLength={10000}
            defaultValue={value("premiseText")}
          />
        </Field>
        <Field
          label="Rapportprofil (valgfritt)"
          htmlFor="reportProfileCode"
          hint="Navn på PDF-profilen. Brukes når PDF-en kommer."
          error={error("reportProfileCode")}
        >
          <Input
            id="reportProfileCode"
            name="reportProfileCode"
            maxLength={60}
            autoComplete="off"
            defaultValue={value("reportProfileCode")}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <SubmitButton>Lagre avtalen</SubmitButton>
          <Link href="/admin/avtaler" className={buttonVariants({ variant: "ghost", size: "md" })}>
            Avbryt
          </Link>
        </div>
      </Card>
    </form>
  );
}

/** «Fjern avtalen» med bekreftelse (myk sletting). Oppdrag som har avtalen, beholder den. */
export function DeleteAgreementForm({
  agreementId,
  action,
}: {
  agreementId: string;
  action: Action;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const [confirming, setConfirming] = useState(false);

  return (
    <Card className="mt-6 space-y-4">
      <FormErrors state={state} />
      {confirming ? (
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="id" value={agreementId} />
          <p className="text-slate-900">
            Vil du fjerne avtalen? Den kan ikke lenger velges på nye oppdrag. Oppdrag som har den,
            beholder den med merket «Slettet».
          </p>
          <div className="flex flex-wrap gap-3">
            <SubmitButton variant="secondary" size="md">
              Ja, fjern avtalen
            </SubmitButton>
            <Button variant="ghost" size="md" onClick={() => setConfirming(false)}>
              Avbryt
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="secondary" size="md" onClick={() => setConfirming(true)}>
          Fjern avtalen
        </Button>
      )}
    </Card>
  );
}
