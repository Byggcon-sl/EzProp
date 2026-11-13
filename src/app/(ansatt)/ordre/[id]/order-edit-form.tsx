"use client";

import { useActionState, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Checkbox, Field, FormMessage, Input } from "@/shared/ui/form";
import { FormErrors, SubmitButton } from "../../form-parts";
import { textValue } from "../../form-state";
import { ContactPicker, type ContactHit } from "../../kontakter/contact-picker";
import {
  initialOrderEditState,
  OFFLINE_MESSAGE,
  ORDER_SAVED_MESSAGE,
  orderFormError,
  type OrderEditState,
} from "../order-form-error";

type Action = (state: OrderEditState, formData: FormData) => Promise<OrderEditState>;

/** Ordren slik den står lagret, til forhåndsutfylling. Tom verdi er `null`. */
export type EditableOrder = {
  id: string;
  rowVersion: number;
  /** Mottatt i norsk tid, «ÅÅÅÅ-MM-DDTtt:mm». */
  receivedAtLocal: string;
  addressText: string;
  externalRef: string | null;
  orderedByText: string | null;
  orderedByContactId: string | null;
  gnr: string | null;
  bnr: string | null;
  snr: string | null;
  housingAssociationName: string | null;
  sellerDeclarationReceived: boolean;
};

/**
 * «Endre ordren» på ordresiden. Knappen åpner skjemaet på samme side. Mens skjemaet er åpent,
 * skjules `children` (skjemaene for «Gjør om» og «Avvis»), så det bare er én lagreknapp på
 * siden. Etter lagring lukkes skjemaet og «Endringene er lagret.» vises. Om knappen vises,
 * avgjør siden (`canEditOrders`); selve sjekken skjer i kjernen.
 */
export function OrderEditor({
  order,
  converted,
  action,
  children,
}: {
  order: EditableOrder;
  converted: boolean;
  action: Action;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const noticeRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (saved && !open) noticeRef.current?.focus();
  }, [saved, open]);

  if (open) {
    return (
      <OrderEditForm
        order={order}
        converted={converted}
        action={action}
        onCancel={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          setSaved(true);
        }}
      />
    );
  }

  return (
    <>
      <div className="mt-4 space-y-4">
        {saved && (
          <p
            ref={noticeRef}
            tabIndex={-1}
            role="status"
            className="rounded-xl bg-brand-50 px-3 py-2 text-slate-900"
          >
            {ORDER_SAVED_MESSAGE}
          </p>
        )}
        <Button
          variant="secondary"
          size="md"
          onClick={() => {
            setSaved(false);
            setOpen(true);
          }}
        >
          Endre ordren
        </Button>
      </div>
      {children}
    </>
  );
}

/**
 * Skjemaet med de samme feltene og den samme kontaktvelgeren som «Ny ordre». Ved feil, konflikt
 * og tapt nett står det som er skrevet igjen: verdiene finnes bare i skjemaet og i tilstanden
 * fra handlingen, aldri i adressen eller lagret i nettleseren.
 */
function OrderEditForm({
  order,
  converted,
  action,
  onCancel,
  onSaved,
}: {
  order: EditableOrder;
  converted: boolean;
  action: Action;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [state, formAction] = useActionState(action, initialOrderEditState);
  const [offline, setOffline] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const offlineRef = useRef<HTMLDivElement>(null);
  const orderedByRef = useRef<HTMLInputElement>(null);
  const error = (name: string) => state.fieldErrors[name];
  const reload = state.code !== null && orderFormError(state.code).reload;
  const sellerDeclarationChecked =
    state.attempt > 0
      ? state.values.sellerDeclarationReceived === "on"
      : order.sellerDeclarationReceived;

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (state.saved) onSaved();
  }, [state.saved, onSaved]);

  useEffect(() => {
    if (offline) offlineRef.current?.focus();
  }, [offline]);

  // Uten nett sendes ingenting, og feltene beholder det som er skrevet.
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (!navigator.onLine) {
      event.preventDefault();
      setOffline(true);
      return;
    }
    setOffline(false);
  }

  function onContactSelect(contact: ContactHit) {
    if (orderedByRef.current) {
      orderedByRef.current.value = contact.firmName
        ? `${contact.name}, ${contact.firmName}`
        : contact.name;
    }
  }

  return (
    <form action={formAction} onSubmit={onSubmit} noValidate className="mt-6">
      <Card className="space-y-5">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-lg font-medium text-slate-900 focus:outline-none"
        >
          Endre ordren
        </h2>
        {converted && (
          <p className="text-slate-700">
            Oppdraget endres ikke. Eiendom og bestiller på oppdraget endres på oppdraget.
          </p>
        )}
        {offline ? (
          <div ref={offlineRef} tabIndex={-1}>
            <FormMessage message={OFFLINE_MESSAGE} />
          </div>
        ) : (
          <FormErrors state={state} />
        )}
        {reload && !offline && (
          <Button variant="secondary" size="md" onClick={() => window.location.reload()}>
            Last siden på nytt
          </Button>
        )}
        <input type="hidden" name="orderId" value={order.id} />
        <input type="hidden" name="rowVersion" value={order.rowVersion} />
        <input type="hidden" name="receivedAtInitial" value={order.receivedAtLocal} />
        <Field label="Adresse" htmlFor="addressText" error={error("addressText")}>
          <Input
            id="addressText"
            name="addressText"
            required
            maxLength={300}
            defaultValue={textValue(state, "addressText", order.addressText)}
          />
        </Field>
        <Field label="Mottatt" htmlFor="receivedAt" error={error("receivedAt")}>
          <Input
            id="receivedAt"
            name="receivedAt"
            type="datetime-local"
            defaultValue={textValue(state, "receivedAt", order.receivedAtLocal)}
          />
        </Field>
        <ContactPicker
          idPrefix="orderedBy"
          name="orderedByContactId"
          initial={
            order.orderedByContactId
              ? {
                  id: order.orderedByContactId,
                  name: order.orderedByText ?? "Kontakt i registeret",
                }
              : null
          }
          error={error("orderedByContactId")}
          onSelect={onContactSelect}
        />
        <Field
          label="Hvem bestilte (valgfritt)"
          htmlFor="orderedByText"
          hint="Navn og firma, slik det sto i e-posten. Velg kontakten i søket over, så fylles feltet ut."
          error={error("orderedByText")}
        >
          <Input
            ref={orderedByRef}
            id="orderedByText"
            name="orderedByText"
            maxLength={200}
            defaultValue={textValue(state, "orderedByText", order.orderedByText)}
          />
        </Field>
        <Field
          label="Ekstern referanse (valgfritt)"
          htmlFor="externalRef"
          hint="Ordrenummeret fra megleren."
          error={error("externalRef")}
        >
          <Input
            id="externalRef"
            name="externalRef"
            maxLength={200}
            defaultValue={textValue(state, "externalRef", order.externalRef)}
          />
        </Field>
        <Field label="Gårdsnummer (valgfritt)" htmlFor="gnr" error={error("gnr")}>
          <Input
            id="gnr"
            name="gnr"
            inputMode="numeric"
            maxLength={10}
            defaultValue={textValue(state, "gnr", order.gnr)}
          />
        </Field>
        <Field label="Bruksnummer (valgfritt)" htmlFor="bnr" error={error("bnr")}>
          <Input
            id="bnr"
            name="bnr"
            inputMode="numeric"
            maxLength={10}
            defaultValue={textValue(state, "bnr", order.bnr)}
          />
        </Field>
        <Field label="Seksjonsnummer (valgfritt)" htmlFor="snr" error={error("snr")}>
          <Input
            id="snr"
            name="snr"
            inputMode="numeric"
            maxLength={10}
            defaultValue={textValue(state, "snr", order.snr)}
          />
        </Field>
        <Field
          label="Borettslag eller sameie (valgfritt)"
          htmlFor="housingAssociationName"
          error={error("housingAssociationName")}
        >
          <Input
            id="housingAssociationName"
            name="housingAssociationName"
            maxLength={200}
            defaultValue={textValue(state, "housingAssociationName", order.housingAssociationName)}
          />
        </Field>
        <Checkbox
          name="sellerDeclarationReceived"
          label="Egenerklæring mottatt"
          defaultChecked={sellerDeclarationChecked}
        />
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <SubmitButton>Lagre</SubmitButton>
          <Button variant="secondary" size="md" onClick={onCancel}>
            Avbryt
          </Button>
        </div>
      </Card>
    </form>
  );
}
