"use client";

import { useActionState } from "react";
import { Card } from "@/shared/ui/card";
import { FormActions, FormErrors } from "../../form-parts";
import { initialFormState, type FormState } from "../../form-state";
import { readOfferValues } from "../../order-values";
import { OrderFields, ValidUntilField } from "../offer-fields";
import { withOfflineMessage } from "../offline-action";

/**
 * Skjemaet for nytt tilbud. Feltene er de samme som i «Endre tilbudet» (`OrderFields`), og
 * «Gyldig til» står sist, fordi det sjelden endres. Uten nett står det som er skrevet igjen (A360).
 */
export function OfferForm({
  action,
  receivedAtDefault,
  validUntil,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  /** Nå i norsk tid, «ÅÅÅÅ-MM-DDTtt:mm». */
  receivedAtDefault: string;
  /** I dag + 30 som forslag, og grensene i dag til i dag + 365 («ÅÅÅÅ-MM-DD»). */
  validUntil: { defaultValue: string; min: string; max: string };
}) {
  const [state, formAction] = useActionState(
    withOfflineMessage(action, readOfferValues),
    initialFormState,
  );

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
        <ValidUntilField
          state={state}
          defaultValue={validUntil.defaultValue}
          min={validUntil.min}
          max={validUntil.max}
          hint="30 dager fra i dag er foreslått. Høyst ett år fram."
        />
        <FormActions cancelHref="/tilbud" />
      </Card>
    </form>
  );
}
