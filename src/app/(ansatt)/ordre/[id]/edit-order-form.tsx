"use client";

import { useActionState } from "react";
import { Card } from "@/shared/ui/card";
import { FormActions, FormErrors } from "../../form-parts";
import { initialFormState, type FormState } from "../../form-state";
import { OrderFields, type OrderFieldDefaults } from "../ny/order-form";

/**
 * «Rett ordren» på ordresiden (T1): de samme feltene som «Ny ordre», forhåndsutfylt med det som er
 * lagret. `rowVersion` er versjonen da siden ble åpnet; har en annen lagret siden, stopper kjernen
 * lagringen. «Avbryt» er en lenke tilbake til ordren, uten lagring.
 */
export function EditOrderForm({
  action,
  orderId,
  rowVersion,
  defaults,
  converted,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  orderId: string;
  rowVersion: number;
  defaults: OrderFieldDefaults;
  /** Ordren er gjort om til oppdrag: oppdraget endres ikke (A251). */
  converted: boolean;
}) {
  const [state, formAction] = useActionState(action, initialFormState);

  return (
    <form action={formAction} noValidate>
      <Card className="space-y-5">
        <h2 className="text-lg font-medium text-slate-900">Rett ordren</h2>
        {converted && (
          <p className="text-slate-700">
            Oppdraget endres ikke. Eiendom og bestiller på oppdraget rettes på oppdraget.
          </p>
        )}
        <FormErrors state={state} />
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="rowVersion" value={rowVersion} />
        <OrderFields state={state} defaults={defaults} />
        <FormActions cancelHref={`/ordre/${orderId}`} />
      </Card>
    </form>
  );
}
