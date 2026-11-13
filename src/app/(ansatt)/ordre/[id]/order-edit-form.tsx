"use client";

import { unstable_rethrow } from "next/navigation";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { FormErrors, SubmitButton } from "../../form-parts";
import { initialFormState, UNKNOWN_ERROR, type FormState } from "../../form-state";
import { OrderFields, type OrderFieldDefaults } from "../ny/order-form";
import { OFFLINE_NOT_SAVED, ORDER_CHANGED } from "../order-messages";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/** Svar uten kall til serveren: meldingen øverst, og feltene beholder det som er skrevet. */
function keepWritten(previous: FormState, formData: FormData, message: string): FormState {
  const values: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    if (typeof value === "string") values[name] = value;
  }
  return { fieldErrors: {}, message, values, attempt: previous.attempt + 1 };
}

/**
 * Skjemaet «Endre ordren», forhåndsutfylt med ordren. «Lagre» og «Avbryt» står nederst i
 * skjemaet, ikke i en fast bunnlinje (tastaturet på iPad dekker den). Ingenting går tapt: ved
 * konflikt og uten nett står meldingen øverst og feltene beholder det som er skrevet.
 */
function OrderEditForm({
  orderId,
  rowVersion,
  receivedAtIso,
  defaults,
  converted,
  action,
  onCancel,
}: {
  orderId: string;
  rowVersion: number;
  receivedAtIso: string;
  defaults: OrderFieldDefaults;
  converted: boolean;
  action: Action;
  onCancel: () => void;
}) {
  const [state, formAction] = useActionState(async (previous: FormState, formData: FormData) => {
    if (!navigator.onLine) return keepWritten(previous, formData, OFFLINE_NOT_SAVED);
    try {
      return await action(previous, formData);
    } catch (error) {
      // Videresending til ordresiden etter lagring er ingen feil.
      unstable_rethrow(error);
      const offline = !navigator.onLine || error instanceof TypeError;
      return keepWritten(previous, formData, offline ? OFFLINE_NOT_SAVED : UNKNOWN_ERROR);
    }
  }, initialFormState);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <form action={formAction} noValidate className="mt-6">
      <Card className="space-y-5">
        <h2
          ref={headingRef}
          tabIndex={-1}
          id="order-edit-heading"
          className="text-lg font-medium text-slate-900"
        >
          Endre ordren
        </h2>
        {converted && (
          <p className="rounded-xl bg-brand-50 px-4 py-3 break-words text-slate-900">
            Oppdraget endres ikke. Eiendom og bestiller på oppdraget endres på oppdraget.
          </p>
        )}
        <FormErrors state={state} />
        {state.message === ORDER_CHANGED && (
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Last siden på nytt
          </Button>
        )}
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="rowVersion" value={String(rowVersion)} />
        <input type="hidden" name="receivedAtOriginal" value={receivedAtIso} />
        <OrderFields state={state} defaults={defaults} />
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <SubmitButton>Lagre</SubmitButton>
          <Button variant="secondary" onClick={onCancel}>
            Avbryt
          </Button>
        </div>
      </Card>
    </form>
  );
}

/**
 * «Endre ordren» rett under ordrekortet, i alle statuser. Vises bare når den ansatte kan endre;
 * selve sjekken skjer i kjernen. Mens skjemaet er åpent, skjules «Gjør om» og «Avvis»
 * (`children`), så det bare er én lagreknapp på siden. «Avbryt» lukker uten å lagre og gir
 * fokus tilbake til knappen.
 */
export function OrderEditor({
  orderId,
  rowVersion,
  receivedAtIso,
  defaults,
  converted,
  action,
  children,
}: {
  orderId: string;
  rowVersion: number;
  /** Lagret «Mottatt» (ISO), slik at et uendret felt ikke blir en endring. */
  receivedAtIso: string;
  defaults: OrderFieldDefaults;
  /** Ordren er gjort om til oppdrag: beskjeden om at oppdraget ikke endres, vises. */
  converted: boolean;
  action: Action;
  children?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const focusButton = useRef(false);

  useEffect(() => {
    if (!editing && focusButton.current) buttonRef.current?.focus();
    focusButton.current = false;
  }, [editing]);

  if (editing) {
    return (
      <OrderEditForm
        orderId={orderId}
        rowVersion={rowVersion}
        receivedAtIso={receivedAtIso}
        defaults={defaults}
        converted={converted}
        action={action}
        onCancel={() => {
          focusButton.current = true;
          setEditing(false);
        }}
      />
    );
  }

  return (
    <>
      <div className="mt-4">
        <Button ref={buttonRef} variant="secondary" onClick={() => setEditing(true)}>
          Endre ordren
        </Button>
      </div>
      {children}
    </>
  );
}
