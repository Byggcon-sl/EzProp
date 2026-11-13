"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { FormErrors, SubmitButton } from "../../form-parts";
import { initialFormState, type FormState } from "../../form-state";
import { OrderFields, type OrderFieldDefaults } from "../order-fields";
import { ORDER_CHANGED_MESSAGE, ORDER_OFFLINE_MESSAGE, readOrderValues } from "../order-values";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/** Skjemaets tilstand. `stale`: ordren er endret av andre siden siden ble lastet (settes aldri tilbake). */
type EditState = FormState & { stale?: boolean };

/**
 * «Endre ordren» på ordresiden (T1). Knappen står rett under ordrekortet for alle statuser; kjernen
 * sjekker tilgangen. Skjemaet åpnes på samme side, og mens det er åpent skjules «Gjør om» og «Avvis»
 * (`children`), så det bare er én «Lagre» på siden. Siden gir komponenten ny nøkkel etter lagring,
 * så skjemaet lukkes når ordren har fått ny versjon.
 */
export function OrderEditSection({
  orderId,
  rowVersion,
  defaults,
  converted,
  action,
  children,
}: {
  orderId: string;
  rowVersion: number;
  defaults: OrderFieldDefaults;
  /** Ordren er gjort om til oppdrag: linjen om at oppdraget ikke endres, vises. */
  converted: boolean;
  action: Action;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const focusAfterChange = useRef<"heading" | "button" | null>(null);

  // Fokus til skjemaets overskrift når det åpnes, og tilbake til knappen ved «Avbryt».
  useEffect(() => {
    if (focusAfterChange.current === "heading") headingRef.current?.focus();
    if (focusAfterChange.current === "button") buttonRef.current?.focus();
    focusAfterChange.current = null;
  }, [open]);

  function show() {
    focusAfterChange.current = "heading";
    setOpen(true);
  }

  function hide() {
    focusAfterChange.current = "button";
    setOpen(false);
  }

  if (open) {
    return (
      <div className="mt-6">
        <OrderEditForm
          orderId={orderId}
          rowVersion={rowVersion}
          defaults={defaults}
          converted={converted}
          action={action}
          headingRef={headingRef}
          onCancel={hide}
        />
      </div>
    );
  }

  return (
    <>
      <div className="mt-4">
        <Button ref={buttonRef} variant="secondary" onClick={show}>
          Endre ordren
        </Button>
      </div>
      {children}
    </>
  );
}

/** Nettleseren sier at den er uten nett. */
function isOffline(): boolean {
  return !navigator.onLine;
}

/** Et mislykket forsøk uten nett. Verdiene står igjen i feltene. */
function offlineState(previous: EditState, formData: FormData): EditState {
  return {
    fieldErrors: {},
    message: ORDER_OFFLINE_MESSAGE,
    values: readOrderValues(formData),
    attempt: previous.attempt + 1,
    stale: previous.stale === true,
  };
}

function OrderEditForm({
  orderId,
  rowVersion,
  defaults,
  converted,
  action,
  headingRef,
  onCancel,
}: {
  orderId: string;
  rowVersion: number;
  defaults: OrderFieldDefaults;
  converted: boolean;
  action: Action;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onCancel: () => void;
}) {
  const [state, formAction] = useActionState(async (previous: EditState, formData: FormData): Promise<EditState> => {
    // Endring krever nett. Uten nett sendes ingenting, og det som er skrevet står igjen.
    if (isOffline()) return offlineState(previous, formData);
    try {
      const result = await action(previous, formData);
      return {
        ...result,
        stale: previous.stale === true || result.message === ORDER_CHANGED_MESSAGE,
      };
    } catch (error) {
      // Nettet falt under sending (fetch gir TypeError). Videresending etter lagring og andre
      // feil kastes videre til Next.
      if (isOffline() || error instanceof TypeError) {
        return offlineState(previous, formData);
      }
      throw error;
    }
  }, initialFormState as EditState);

  return (
    <Card>
      <form action={formAction} noValidate className="space-y-5">
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-medium text-slate-900">
          Endre ordren
        </h2>
        {converted && (
          <p className="text-slate-700">
            Oppdraget endres ikke. Eiendom og bestiller på oppdraget endres på oppdraget.
          </p>
        )}
        <FormErrors state={state} />
        {state.stale && (
          // Knappen står så lenge skjemaet har en utdatert versjon, også etter et forsøk uten nett:
          // nye lagreforsøk gir konflikt igjen. En iPad-app på hjemskjermen har ingen annen synlig
          // knapp for å laste siden på nytt.
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Last siden på nytt
          </Button>
        )}
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="rowVersion" value={rowVersion} />
        <OrderFields state={state} defaults={defaults} />
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <SubmitButton>Lagre</SubmitButton>
          <Button variant="secondary" onClick={onCancel}>
            Avbryt
          </Button>
        </div>
      </form>
    </Card>
  );
}
