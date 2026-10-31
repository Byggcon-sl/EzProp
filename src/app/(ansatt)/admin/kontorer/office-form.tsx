"use client";

import { useActionState } from "react";
import { Card } from "@/shared/ui/card";
import { Field, Input } from "@/shared/ui/form";
import { FormActions, FormErrors } from "../form-parts";
import { initialFormState, textValue, type FormState } from "../form-state";

export type OfficeValues = { name: string; address: string | null; sortOrder: number };

/** Skjema for nytt og eksisterende kontor (skisse avsnitt 4, «Kontor»). */
export function OfficeForm({
  office,
  action,
}: {
  office?: OfficeValues;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const error = (name: string) => state.fieldErrors[name];

  return (
    <form action={formAction} noValidate>
      <Card className="space-y-5">
        <FormErrors state={state} />
        <Field label="Navn" htmlFor="name" error={error("name")}>
          <Input
            id="name"
            name="name"
            required
            defaultValue={textValue(state, "name", office?.name)}
          />
        </Field>
        <Field label="Adresse (valgfritt)" htmlFor="address" error={error("address")}>
          <Input
            id="address"
            name="address"
            autoComplete="street-address"
            defaultValue={textValue(state, "address", office?.address)}
          />
        </Field>
        <div className="grid gap-5 md:grid-cols-2">
          <Field
            label="Rekkefølge"
            htmlFor="sortOrder"
            hint="Lavest står først i lister."
            error={error("sortOrder")}
          >
            <Input
              id="sortOrder"
              name="sortOrder"
              inputMode="numeric"
              defaultValue={textValue(state, "sortOrder", String(office?.sortOrder ?? 0))}
            />
          </Field>
        </div>
        <FormActions cancelHref="/admin/kontorer" />
      </Card>
    </form>
  );
}
