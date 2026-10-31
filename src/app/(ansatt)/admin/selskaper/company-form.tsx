"use client";

import { useActionState } from "react";
import { Card } from "@/shared/ui/card";
import { Checkbox, Field, Input, Textarea } from "@/shared/ui/form";
import { FormActions, FormErrors } from "../form-parts";
import { initialFormState, textValue, type FormState } from "../form-state";

export type CompanyValues = {
  legalName: string;
  orgNumber: string | null;
  vatRegistered: boolean;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  companyText: string | null;
  liabilityInsurer: string | null;
  liabilityPolicyNumber: string | null;
  liabilityValidTo: string | null;
};

/** Skjema for nytt og eksisterende selskap (skisse avsnitt 4, «Selskap»). */
export function CompanyForm({
  company,
  action,
}: {
  company?: CompanyValues;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const value = (name: keyof CompanyValues) =>
    textValue(state, name, company?.[name] as string | null | undefined);
  const error = (name: string) => state.fieldErrors[name];
  const vatRegistered =
    typeof state.values.vatRegistered === "string"
      ? state.values.vatRegistered === "on"
      : (company?.vatRegistered ?? true);

  return (
    <form action={formAction} noValidate>
      <Card className="space-y-5">
        <FormErrors state={state} />
        <Field label="Juridisk navn" htmlFor="legalName" error={error("legalName")}>
          <Input id="legalName" name="legalName" required defaultValue={value("legalName")} />
        </Field>
        <div className="grid gap-5 md:grid-cols-2">
          <Field
            label="Org.nr. (valgfritt)"
            htmlFor="orgNumber"
            hint="9 siffer"
            error={error("orgNumber")}
          >
            <Input
              id="orgNumber"
              name="orgNumber"
              inputMode="numeric"
              autoComplete="off"
              defaultValue={value("orgNumber")}
            />
          </Field>
        </div>
        <Checkbox
          name="vatRegistered"
          label="Registrert i MVA-registeret"
          defaultChecked={vatRegistered}
        />
        <Field label="Adresse (valgfritt)" htmlFor="address" error={error("address")}>
          <Input
            id="address"
            name="address"
            autoComplete="street-address"
            defaultValue={value("address")}
          />
        </Field>
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Postnummer (valgfritt)" htmlFor="postalCode" error={error("postalCode")}>
            <Input
              id="postalCode"
              name="postalCode"
              inputMode="numeric"
              autoComplete="postal-code"
              defaultValue={value("postalCode")}
            />
          </Field>
          <Field label="Sted (valgfritt)" htmlFor="city" error={error("city")}>
            <Input id="city" name="city" defaultValue={value("city")} />
          </Field>
        </div>
        <Field
          label="Firmatekst (valgfritt)"
          htmlFor="companyText"
          hint="Står i rapporten."
          error={error("companyText")}
        >
          <Textarea
            id="companyText"
            name="companyText"
            rows={6}
            defaultValue={value("companyText")}
          />
        </Field>
        <fieldset className="min-w-0 space-y-5 border-t border-slate-200 pt-4">
          <legend className="sr-only">Ansvarsforsikring</legend>
          <p aria-hidden="true" className="text-base font-medium text-slate-900">
            Ansvarsforsikring
          </p>
          <Field
            label="Forsikringsselskap (valgfritt)"
            htmlFor="liabilityInsurer"
            error={error("liabilityInsurer")}
          >
            <Input
              id="liabilityInsurer"
              name="liabilityInsurer"
              defaultValue={value("liabilityInsurer")}
            />
          </Field>
          <div className="grid gap-5 md:grid-cols-2">
            <Field
              label="Polisenummer (valgfritt)"
              htmlFor="liabilityPolicyNumber"
              error={error("liabilityPolicyNumber")}
            >
              <Input
                id="liabilityPolicyNumber"
                name="liabilityPolicyNumber"
                autoComplete="off"
                defaultValue={value("liabilityPolicyNumber")}
              />
            </Field>
            <Field
              label="Gyldig til (valgfritt)"
              htmlFor="liabilityValidTo"
              error={error("liabilityValidTo")}
            >
              <Input
                id="liabilityValidTo"
                name="liabilityValidTo"
                type="date"
                defaultValue={value("liabilityValidTo")}
              />
            </Field>
          </div>
        </fieldset>
        <FormActions cancelHref="/admin/selskaper" />
      </Card>
    </form>
  );
}
