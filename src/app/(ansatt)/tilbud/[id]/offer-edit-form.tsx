"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Notice } from "@/shared/ui/notice";
import { FormErrors, SubmitButton } from "../../form-parts";
import { initialFormState } from "../../form-state";
import { ORDER_CHANGED_MESSAGE, readOfferValues } from "../../order-values";
import type { OfferActionState } from "../actions";
import { OrderFields, ValidUntilField, type OrderFieldDefaults } from "../offer-fields";
import { withOfflineMessage } from "../offline-action";

type Action = (state: OfferActionState, formData: FormData) => Promise<OfferActionState>;

/** Skjemaets tilstand. `stale`: tilbudet er endret av andre siden siden ble lastet. */
type EditState = OfferActionState & { stale?: boolean };

/** Linjen over feltene når tilbudet er gjort om til oppdrag (T-0075, ADR 0011). */
export const CONVERTED_COPY_TEXT =
  "Tilbudet og oppdraget har hver sin kopi av opplysningene. Endringer her endrer ikke oppdraget. Rett adresse, matrikkel og bestiller på oppdraget, under Bestilling.";

/** Står i stedet for datofeltet på avslåtte og gjort-om tilbud (A327). */
export const VALID_UNTIL_LOCKED_TEXT = "Gyldig til kan bare endres på åpne og utløpte tilbud.";

/** «Gyldig til» i skjemaet: datoen og grensene når den kan endres, ellers `null`. */
export type ValidUntilEdit = { defaultValue: string; min: string; max: string } | null;

/**
 * «Endre tilbudet» på tilbudssiden (T1). Knappen står under detaljkortet for alle statuser; kjernen
 * sjekker tilgangen. Skjemaet åpnes på samme side med fokus på overskriften, og mens det er åpent
 * skjules handlingsblokken (`actions`), så det bare er én «Lagre» på siden.
 *
 * Kvitteringen «Endringene er lagret.» kommer fra svaret på handlingen (T-0089), ikke fra
 * adressen: den vises bare når noe ble endret, forsvinner ved neste forsøk og kommer ikke tilbake
 * ved omlasting. Ingenting endret: skjemaet lukkes uten kvittering. Tilstanden ligger her, utenfor
 * skjemaet, så kvitteringen står når skjemaet lukkes. Siden gir nye verdier etter lagring, og
 * skjemaet får dem neste gang det åpnes.
 */
export function OfferEditSection({
  orderId,
  rowVersion,
  defaults,
  validUntil,
  converted,
  assignmentLink = null,
  action,
  actions,
  children,
}: {
  orderId: string;
  rowVersion: number;
  defaults: OrderFieldDefaults;
  validUntil: ValidUntilEdit;
  /** Tilbudet er gjort om til oppdrag: linjen om at tilbud og oppdrag har hver sin kopi vises. */
  converted: boolean;
  /** Oppdraget tilbudet ble gjort om til, når det ikke er kansellert. Gir «Gå til oppdrag». */
  assignmentLink?: { id: string; number: string } | null;
  action: Action;
  /** Handlingsblokken («Gjør om», «Forleng», «Avslå»). Skjules mens skjemaet er åpent. */
  actions?: ReactNode;
  /** Det som står mellom handlingsblokken og knappen (dublettvarselet og detaljkortet). */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const focusAfterChange = useRef<"heading" | "button" | "notice" | null>(null);

  const [state, formAction] = useActionState(
    async (previous: EditState, formData: FormData): Promise<EditState> => {
      const result = await withOfflineMessage(action, readOfferValues)(previous, formData);
      const stale = previous.stale === true || result.message === ORDER_CHANGED_MESSAGE;
      if (result.done) {
        // Lagret (eller ingenting å lagre): skjemaet lukkes, kvitteringen står under knappen.
        focusAfterChange.current = result.notice ? "notice" : "button";
        setOpen(false);
      }
      return { ...result, stale };
    },
    initialFormState as EditState,
  );

  // Fokus til skjemaets overskrift når det åpnes, tilbake til knappen ved «Avbryt», og til
  // kvitteringen etter lagring.
  useEffect(() => {
    if (focusAfterChange.current === "heading") headingRef.current?.focus();
    if (focusAfterChange.current === "button") buttonRef.current?.focus();
    if (focusAfterChange.current === "notice") noticeRef.current?.focus();
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
    <>
      {!open && actions}
      {children}
      {open ? (
        <div className="mt-6">
          <OfferEditForm
            state={state}
            formAction={formAction}
            orderId={orderId}
            rowVersion={rowVersion}
            defaults={defaults}
            validUntil={validUntil}
            converted={converted}
            assignmentLink={assignmentLink}
            headingRef={headingRef}
            onCancel={hide}
          />
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <Button ref={buttonRef} variant="secondary" onClick={show}>
            Endre tilbudet
          </Button>
          {state.done && state.notice && (
            <div ref={noticeRef} tabIndex={-1} className="rounded-xl">
              <Notice message={state.notice} />
            </div>
          )}
        </div>
      )}
    </>
  );
}

function OfferEditForm({
  state,
  formAction,
  orderId,
  rowVersion,
  defaults,
  validUntil,
  converted,
  assignmentLink,
  headingRef,
  onCancel,
}: {
  state: EditState;
  formAction: (formData: FormData) => void;
  orderId: string;
  rowVersion: number;
  defaults: OrderFieldDefaults;
  validUntil: ValidUntilEdit;
  converted: boolean;
  assignmentLink: { id: string; number: string } | null;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onCancel: () => void;
}) {
  // Et skjema som åpnes etter en lagring, skal ikke vise feil eller verdier fra forrige gang.
  const shown: EditState = state.done ? { ...state, ...initialFormState } : state;

  return (
    <Card>
      <form action={formAction} noValidate className="space-y-5">
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-medium text-slate-900">
          Endre tilbudet
        </h2>
        {converted && (
          <div>
            <p className="text-slate-700">{CONVERTED_COPY_TEXT}</p>
            {assignmentLink && (
              <Link
                href={`/oppdrag/${assignmentLink.id}`}
                className="inline-flex min-h-11 items-center font-medium text-fjord-dark underline"
              >
                Gå til oppdrag&nbsp;<span className="tabular-nums">{assignmentLink.number}</span>
              </Link>
            )}
          </div>
        )}
        <FormErrors state={shown} />
        {shown.stale && (
          // Knappen står så lenge skjemaet har en utdatert versjon: nye lagreforsøk gir konflikt
          // igjen. En iPad-app på hjemskjermen har ingen annen synlig knapp for å laste på nytt.
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Last siden på nytt
          </Button>
        )}
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="rowVersion" value={rowVersion} />
        {/* «Gyldig til» står først: det er det som oftest endres på et tilbud. */}
        {validUntil ? (
          <ValidUntilField
            state={shown}
            defaultValue={validUntil.defaultValue}
            min={validUntil.min}
            max={validUntil.max}
            hint="Høyst ett år fram."
          />
        ) : (
          <p className="text-sm text-slate-600">{VALID_UNTIL_LOCKED_TEXT}</p>
        )}
        <OrderFields state={shown} defaults={defaults} />
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
