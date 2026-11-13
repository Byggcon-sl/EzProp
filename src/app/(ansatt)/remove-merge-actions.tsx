"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, buttonVariants } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { cn } from "@/shared/lib/cn";
import { FormErrors } from "./form-parts";
import { initialFormState, type FormState } from "./form-state";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/** Rød bekreftknapp, slik at den ikke forveksles med «Lagre». */
function RemoveSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      className="bg-urgent-line text-white hover:bg-urgent-text"
      disabled={pending}
    >
      {pending ? "Fjerner …" : "Fjern"}
    </Button>
  );
}

/**
 * «Slå sammen med …» og «Fjern» nederst på kontakt- og firmasiden. «Fjern» viser bekreftelsen på
 * siden (2 trykk). Siden viser komponenten bare med `canManageContacts`; selve sjekken skjer i
 * kjernen. `idField` er navnet på det skjulte feltet med id-en (`contactId` eller `firmId`).
 */
export function RemoveMergeActions({
  idField,
  id,
  mergeHref,
  confirmLines,
  action,
}: {
  idField: "contactId" | "firmId";
  id: string;
  mergeHref: string;
  /** Første linje er spørsmålet («Fjerne <navn>?»), resten forklarer følgene. */
  confirmLines: readonly string[];
  action: Action;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(action, initialFormState);
  const questionRef = useRef<HTMLHeadingElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Fokus til spørsmålet når bekreftelsen åpnes, og tilbake til «Fjern» ved «Avbryt».
  useEffect(() => {
    if (open) questionRef.current?.focus();
    else if (wasOpen.current) removeRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  const [question, ...details] = confirmLines;
  const questionId = `remove-${id}-question`;

  return (
    <section aria-label="Fjern eller slå sammen" className="mt-8">
      {!open ? (
        <div className="flex flex-wrap items-center gap-3">
          <Link href={mergeHref} className={buttonVariants({ variant: "secondary", size: "md" })}>
            Slå sammen med …
          </Link>
          <Button
            ref={removeRef}
            variant="secondary"
            className="text-urgent-text"
            onClick={() => setOpen(true)}
          >
            Fjern
          </Button>
        </div>
      ) : (
        <Card role="region" aria-labelledby={questionId} className="border-urgent-line">
          <h2
            id={questionId}
            ref={questionRef}
            tabIndex={-1}
            className="text-lg font-semibold break-words text-slate-900"
          >
            {question}
          </h2>
          {details.map((line) => (
            <p key={line} className="mt-2 text-slate-700">
              {line}
            </p>
          ))}
          <form action={formAction} className="mt-4 space-y-3">
            <FormErrors state={state} />
            <input type="hidden" name={idField} value={id} />
            <div className="flex flex-wrap items-center gap-3">
              <RemoveSubmit />
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Avbryt
              </Button>
            </div>
          </form>
        </Card>
      )}
    </section>
  );
}

/** Én av de to i sammenslåingen: id, navn og opplysningene som vises på kortet. */
export type MergeCandidate = {
  id: string;
  name: string;
  details: readonly { label: string; value: string }[];
};

function MergeSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending} aria-describedby="merge-summary">
      {pending ? "Slår sammen …" : "Slå sammen"}
    </Button>
  );
}

/**
 * De to kortene side om side (under hverandre på smal skjerm) med valget «Behold denne» og
 * knappen «Slå sammen». Standard er den åpne (første). Teksten over knappen viser hvem som
 * fjernes og hvem som beholdes, og følger valget.
 */
export function MergeForm({
  candidates,
  action,
  cancelHref,
}: {
  candidates: readonly [MergeCandidate, MergeCandidate];
  action: Action;
  cancelHref: string;
}) {
  const [keepId, setKeepId] = useState(candidates[0].id);
  const [state, formAction] = useActionState(action, initialFormState);
  const keep = candidates.find((candidate) => candidate.id === keepId) ?? candidates[0];
  const remove = candidates.find((candidate) => candidate.id !== keep.id) ?? candidates[1];

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <FormErrors state={state} />
      <input type="hidden" name="keepId" value={keep.id} />
      <input type="hidden" name="removeId" value={remove.id} />
      <fieldset>
        <legend className="mb-3 text-lg font-semibold text-slate-900">Hvem skal beholdes?</legend>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {candidates.map((candidate) => {
            const selected = candidate.id === keep.id;
            return (
              <Card
                key={candidate.id}
                role="group"
                aria-labelledby={`merge-${candidate.id}-name`}
                className={cn("min-w-0", selected && "ring-2 ring-brand-600")}
              >
                <h3
                  id={`merge-${candidate.id}-name`}
                  className="text-lg font-semibold break-words text-slate-900"
                >
                  {candidate.name}
                </h3>
                <dl className="mt-3 space-y-2">
                  {candidate.details.map((detail) => (
                    <div key={detail.label}>
                      <dt className="text-sm text-slate-600">{detail.label}</dt>
                      <dd className="break-words text-slate-900">{detail.value}</dd>
                    </div>
                  ))}
                </dl>
                <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-3 font-medium text-slate-900">
                  {/* Ny nøkkel etter hvert forsøk: React tilbakestiller skjemaet, og valget
                      følger ellers ikke tilstanden. */}
                  <input
                    key={state.attempt}
                    type="radio"
                    name="keepChoice"
                    value={candidate.id}
                    checked={selected}
                    onChange={() => setKeepId(candidate.id)}
                    className="size-5 accent-brand-600"
                  />
                  Behold denne
                </label>
              </Card>
            );
          })}
        </div>
      </fieldset>
      <p id="merge-summary" className="break-words text-slate-700">
        {remove.name} fjernes. Oppdrag og ordrer flyttes til {keep.name}.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <MergeSubmit />
        <Link href={cancelHref} className={buttonVariants({ variant: "ghost", size: "md" })}>
          Avbryt
        </Link>
      </div>
    </form>
  );
}
