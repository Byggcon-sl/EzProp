"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { FormErrors, SubmitButton } from "../../form-parts";
import { initialFormState, type FormState } from "../../form-state";
import { OrderFields, type BookingFieldDefaults } from "../../ordre/order-fields";
import { ORDER_OFFLINE_MESSAGE, readOrderValues } from "../../ordre/order-values";
import { ASSIGNMENT_CHANGED_MESSAGE } from "./booking-values";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/** `stale`: oppdraget er endret av andre siden siden ble lastet (settes aldri tilbake). */
type EditState = FormState & { stale?: boolean };

/**
 * Kortet «Bestilling» på oppdragssiden (docs/funksjoner/fase2a-nytt-oppdrag-design.md 6.2).
 * Visningen (`children`) kommer fra siden. Med `canEdit` står «Endre bestillingen» under, i alle
 * statuser; skjemaet åpnes i samme kort med fokus på overskriften, og «Avbryt» setter fokus
 * tilbake til knappen. Siden gir komponenten ny nøkkel etter lagring (versjonen øker), så
 * skjemaet lukkes og viser den nye bestillingen.
 */
export function BookingCard({
  assignmentId,
  rowVersion,
  defaults,
  sellerDeclarationReceived,
  canEdit,
  action,
  children,
}: {
  assignmentId: string;
  rowVersion: number;
  defaults: BookingFieldDefaults;
  /** Står ikke i skjemaet, men sendes uendret med (følger med fra ordren). */
  sellerDeclarationReceived: boolean;
  canEdit: boolean;
  action: Action;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const focusAfterChange = useRef<"heading" | "button" | null>(null);

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

  return (
    <section aria-labelledby="booking-heading" className="mb-8">
      <h2 id="booking-heading" className="mb-3 text-xl font-semibold text-slate-900">
        Bestilling
      </h2>
      <Card>
        {open ? (
          <BookingEditForm
            assignmentId={assignmentId}
            rowVersion={rowVersion}
            defaults={defaults}
            sellerDeclarationReceived={sellerDeclarationReceived}
            action={action}
            headingRef={headingRef}
            onCancel={hide}
          />
        ) : (
          <>
            {children}
            {canEdit && (
              <div className="mt-6">
                <Button ref={buttonRef} variant="secondary" onClick={show}>
                  Endre bestillingen
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </section>
  );
}

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

function BookingEditForm({
  assignmentId,
  rowVersion,
  defaults,
  sellerDeclarationReceived,
  action,
  headingRef,
  onCancel,
}: {
  assignmentId: string;
  rowVersion: number;
  defaults: BookingFieldDefaults;
  sellerDeclarationReceived: boolean;
  action: Action;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onCancel: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(
    async (previous: EditState, formData: FormData): Promise<EditState> => {
      // Endring krever nett. Uten nett sendes ingenting, og det som er skrevet står igjen.
      if (isOffline()) return offlineState(previous, formData);
      try {
        const result = await action(previous, formData);
        return {
          ...result,
          stale: previous.stale === true || result.message === ASSIGNMENT_CHANGED_MESSAGE,
        };
      } catch (error) {
        // Nettet falt under sending (fetch gir TypeError). Videresending etter lagring og andre
        // feil kastes videre til Next.
        if (isOffline() || error instanceof TypeError) return offlineState(previous, formData);
        throw error;
      }
    },
    initialFormState as EditState,
  );

  // Fokus til første felt med feil. Kjører etter fokuset i `FormErrors` (barnet), så feltet vinner.
  useEffect(() => {
    if (state.attempt === 0 || Object.keys(state.fieldErrors).length === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [state.attempt, state.fieldErrors]);

  return (
    <form ref={formRef} action={formAction} noValidate className="space-y-5">
      <h3 ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-slate-900">
        Endre bestillingen
      </h3>
      <FormErrors state={state} />
      {state.stale && (
        // Står så lenge skjemaet har en utdatert versjon. En iPad-app på hjemskjermen har ingen
        // annen synlig knapp for å laste siden på nytt.
        <Button variant="secondary" onClick={() => window.location.reload()}>
          Last siden på nytt
        </Button>
      )}
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <input type="hidden" name="rowVersion" value={rowVersion} />
      {sellerDeclarationReceived && (
        <input type="hidden" name="sellerDeclarationReceived" value="on" />
      )}
      <OrderFields state={state} defaults={defaults} layout="assignment" />
      <div className="flex flex-wrap items-center gap-3 pt-2">
        {/* Skjult tekst: oppdragssiden har flere «Lagre» og «Avbryt». */}
        <SubmitButton>
          Lagre<span className="sr-only"> bestillingen</span>
        </SubmitButton>
        <Button variant="secondary" onClick={onCancel}>
          Avbryt<span className="sr-only"> endring av bestillingen</span>
        </Button>
      </div>
    </form>
  );
}
