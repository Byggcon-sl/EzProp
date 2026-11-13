"use client";

import { useActionState } from "react";
import { Card } from "@/shared/ui/card";
import { FormActions, FormErrors } from "../../form-parts";
import { initialFormState, type FormState } from "../../form-state";
import { OrderFields } from "../order-fields";

/**
 * Skjemaet for ny ordre fra e-posten. Feltene er de samme som i «Endre ordren» (`OrderFields`).
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

  return (
    <form action={formAction} noValidate>
      <Card className="space-y-5">
        <FormErrors state={state} />
        <OrderFields
          state={state}
          defaults={{
            addressText: "",
            receivedAt: receivedAtDefault,
            externalRef: "",
            orderedByText: "",
            orderedByContact: null,
            gnr: "",
            bnr: "",
            snr: "",
            housingAssociationName: "",
            sellerDeclarationReceived: false,
          }}
        />
        <FormActions cancelHref="/ordre" />
      </Card>
    </form>
  );
}
