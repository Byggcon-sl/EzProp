"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { Button, buttonVariants } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Field, Input, Select, Textarea } from "@/shared/ui/form";
import { FormErrors, SubmitButton } from "../../../form-parts";
import { initialFormState, textValue, type FormState } from "../../../form-state";

export type Action = (state: FormState, formData: FormData) => Promise<FormState>;

export type Option = { value: string; label: string };

/** Verdiene i skjemaet som tekst, slik feltene viser dem. */
export type ClaimFormValues = {
  claimType: string;
  receivedAt: string;
  claimantPartyId: string;
  claimantText: string;
  description: string;
  buildingPartText: string;
  outcome: string;
  amount: string;
};

/** Utfallene der beløp er lov (samme regel som i kjernen, `amount_only_upheld_or_settled`). */
const OUTCOMES_WITH_AMOUNT: readonly string[] = ["upheld", "settled"];

export const DESCRIPTION_HINT =
  "Skriv kort hva som påstås. Ikke skriv fødselsnummer eller helseopplysninger.";

/**
 * Skjemaet for en reklamasjonssak: type, mottatt dato, klager (part på oppdraget eller fritekst),
 * beskrivelse og bygningsdel. På endresiden (`edit`) også utfall og beløp. Beløpsfeltet vises bare
 * ved «Medhold» og «Forlik», og tømmes når et annet utfall velges. Med `readOnly` er feltene låst
 * og knappene borte (den som bare kan se sakene). Etter et mislykket forsøk får første felt med
 * feil fokus; uten feltfeil får meldingen øverst fokus.
 */
export function ClaimForm({
  hidden,
  initial,
  claimTypes,
  outcomes,
  parties,
  edit,
  readOnly = false,
  cancelHref,
  action,
}: {
  hidden: { name: "assignmentId" | "claimId"; value: string };
  initial: ClaimFormValues;
  claimTypes: Option[];
  outcomes: Option[];
  parties: Option[];
  edit: boolean;
  readOnly?: boolean;
  cancelHref: string;
  action: Action;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const formRef = useRef<HTMLFormElement>(null);
  const [outcome, setOutcome] = useState(() => textValue(state, "outcome", initial.outcome));
  const [amount, setAmount] = useState(() => textValue(state, "amount", initial.amount));
  const [lastAttempt, setLastAttempt] = useState(state.attempt);

  // Etter et mislykket forsøk: utfall og beløp som ble sendt.
  if (state.attempt !== lastAttempt) {
    setLastAttempt(state.attempt);
    setOutcome(textValue(state, "outcome", outcome));
    setAmount(textValue(state, "amount", amount));
  }

  // Fokus til første felt med feil. Kjører etter fokuset i `FormErrors` (barnet), så feltet vinner.
  useEffect(() => {
    if (state.attempt === 0) return;
    const first = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    first?.focus();
  }, [state.attempt]);

  const showAmount = OUTCOMES_WITH_AMOUNT.includes(outcome);
  const error = (name: string) => state.fieldErrors[name];
  const value = (name: keyof ClaimFormValues) => textValue(state, name, initial[name]);

  function onOutcomeChange(next: string) {
    setOutcome(next);
    if (!OUTCOMES_WITH_AMOUNT.includes(next)) setAmount("");
  }

  return (
    <form ref={formRef} action={formAction} noValidate>
      <Card className="space-y-5">
        <FormErrors state={state} />
        <input type="hidden" name={hidden.name} value={hidden.value} />
        <fieldset disabled={readOnly} className="min-w-0 space-y-5">
          {/* Ny nøkkel på listene etter hvert forsøk: React tilbakestiller skjemaet, og listene
              tar ellers ikke valget fra forrige forsøk. */}
          <Field label="Type" htmlFor="claim-type" error={error("claimType")}>
            <Select
              key={state.attempt}
              id="claim-type"
              name="claimType"
              defaultValue={value("claimType")}
            >
              {claimTypes.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Mottatt" htmlFor="claim-receivedAt" error={error("receivedAt")}>
            <Input
              id="claim-receivedAt"
              name="receivedAt"
              type="date"
              className="max-w-xs"
              defaultValue={value("receivedAt")}
            />
          </Field>
          {parties.length > 0 && (
            <Field
              label="Part som klaget"
              htmlFor="claim-claimantPartyId"
              error={error("claimantPartyId")}
            >
              <Select
                key={state.attempt}
                id="claim-claimantPartyId"
                name="claimantPartyId"
                defaultValue={value("claimantPartyId")}
              >
                <option value="">Ikke en part på oppdraget</option>
                {parties.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field
            label="Hvem klaget"
            htmlFor="claim-claimantText"
            hint={
              parties.length > 0
                ? "Fyll ut hvis klageren ikke er en part på oppdraget."
                : "For eksempel kjøper eller kjøpers advokat."
            }
            error={error("claimantText")}
          >
            <Input
              id="claim-claimantText"
              name="claimantText"
              maxLength={200}
              autoComplete="off"
              defaultValue={value("claimantText")}
            />
          </Field>
          <Field
            label="Beskrivelse"
            htmlFor="claim-description"
            hint={DESCRIPTION_HINT}
            error={error("description")}
          >
            <Textarea
              id="claim-description"
              name="description"
              maxLength={2000}
              defaultValue={value("description")}
            />
          </Field>
          <Field
            label="Bygningsdel eller kontrollpunkt"
            htmlFor="claim-buildingPartText"
            error={error("buildingPartText")}
          >
            <Input
              id="claim-buildingPartText"
              name="buildingPartText"
              maxLength={200}
              autoComplete="off"
              defaultValue={value("buildingPartText")}
            />
          </Field>
          {edit && (
            <Field label="Utfall" htmlFor="claim-outcome" error={error("outcome")}>
              <Select
                key={state.attempt}
                id="claim-outcome"
                name="outcome"
                value={outcome}
                onChange={(event) => onOutcomeChange(event.target.value)}
              >
                {outcomes.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {edit && showAmount && (
            <Field
              label="Beløp (kroner)"
              htmlFor="claim-amount"
              hint="Hele kroner. La feltet stå tomt hvis beløpet ikke er kjent."
              error={error("amount")}
            >
              <Input
                id="claim-amount"
                name="amount"
                inputMode="numeric"
                autoComplete="off"
                className="max-w-xs"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </Field>
          )}
        </fieldset>
        {readOnly ? (
          <Link href={cancelHref} className={buttonVariants({ variant: "secondary", size: "md" })}>
            Tilbake til oppdraget
          </Link>
        ) : (
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <SubmitButton>Lagre</SubmitButton>
            <Link href={cancelHref} className={buttonVariants({ variant: "ghost", size: "md" })}>
              Avbryt
            </Link>
          </div>
        )}
      </Card>
    </form>
  );
}

/** «Fjern» med bekreftelse (myk sletting). «Avbryt» lukker bekreftelsen uten å fjerne noe. */
export function RemoveClaimForm({ claimId, action }: { claimId: string; action: Action }) {
  const [state, formAction] = useActionState(action, initialFormState);
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  return (
    <Card className="mt-6 space-y-4">
      <FormErrors state={state} />
      {confirming ? (
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="claimId" value={claimId} />
          <p ref={confirmRef} tabIndex={-1} className="text-slate-900">
            Vil du fjerne reklamasjonssaken? Den vises ikke lenger på oppdraget.
          </p>
          <div className="flex flex-wrap gap-3">
            <SubmitButton variant="secondary" size="md">
              Ja, fjern saken
            </SubmitButton>
            <Button variant="ghost" size="md" onClick={() => setConfirming(false)}>
              Avbryt
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="secondary" size="md" onClick={() => setConfirming(true)}>
          Fjern
        </Button>
      )}
    </Card>
  );
}
