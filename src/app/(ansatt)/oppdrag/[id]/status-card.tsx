"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Field, Input } from "@/shared/ui/form";
import { FormErrors, SubmitButton } from "../../form-parts";
import { initialFormState, textValue, type FormState } from "../../form-state";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/** En status med fast kode og norsk navn. Siden regner ut neste og forrige i kjernen. */
export type StatusOption = { value: string; label: string };

const REASON_MAX = 500;

/** Felles skjulte felt: oppdraget og statusen siden viste (konfliktsjekk i kjernen). */
function HiddenFields({
  assignmentId,
  expectedStatus,
  toStatus,
}: {
  assignmentId: string;
  expectedStatus: string;
  toStatus?: string;
}) {
  return (
    <>
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <input type="hidden" name="expectedStatus" value={expectedStatus} />
      {toStatus && <input type="hidden" name="toStatus" value={toStatus} />}
    </>
  );
}

/** Hovedknappen: ett trykk flytter oppdraget ett steg fram. */
function ForwardForm({
  assignmentId,
  status,
  next,
  action,
}: {
  assignmentId: string;
  status: string;
  next: StatusOption;
  action: Action;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  return (
    <form action={formAction} className="space-y-3">
      <FormErrors state={state} />
      <HiddenFields assignmentId={assignmentId} expectedStatus={status} toStatus={next.value} />
      <SubmitButton size="lg">Sett til {next.label}</SubmitButton>
    </form>
  );
}

/** Grunnfelt og bekreftknapp under «Tilbake til …» og «Kanseller oppdraget». */
function ReasonForm({
  id,
  assignmentId,
  status,
  toStatus,
  hint,
  submitLabel,
  danger = false,
  action,
  onCancel,
}: {
  id: string;
  assignmentId: string;
  status: string;
  toStatus?: string;
  hint: string;
  submitLabel: string;
  danger?: boolean;
  action: Action;
  onCancel: () => void;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  return (
    <form action={formAction} noValidate className="mt-4 space-y-4">
      <FormErrors state={state} />
      <HiddenFields assignmentId={assignmentId} expectedStatus={status} toStatus={toStatus} />
      <Field label="Grunn" htmlFor={`${id}-reason`} hint={hint} error={state.fieldErrors.reason}>
        <Input
          id={`${id}-reason`}
          name="reason"
          maxLength={REASON_MAX}
          autoFocus
          defaultValue={textValue(state, "reason", "")}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        {danger ? (
          <DangerSubmit>{submitLabel}</DangerSubmit>
        ) : (
          <SubmitButton variant="secondary" size="md">
            {submitLabel}
          </SubmitButton>
        )}
        <Button variant="ghost" onClick={onCancel}>
          Avbryt
        </Button>
      </div>
    </form>
  );
}

/** «Kanseller»: tydelig rød bekreftelse, slik at den ikke forveksles med «Lagre». */
function DangerSubmit({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="bg-urgent-line text-white hover:bg-urgent-text" disabled={pending}>
      {pending ? "Lagrer …" : children}
    </Button>
  );
}

/**
 * Kortet «Status» øverst på oppdragssiden. Merket viser statusen, og «Rettet» ved siden av når
 * rapporten er rettet og sendt på nytt. Med `canEdit`: hovedknapp for neste status (ett trykk),
 * «Tilbake til …» med grunn og «Kanseller oppdraget» med grunn. Knappene vises ut fra
 * `canEdit`; selve sjekken skjer i kjernen. Siden gir kortet ny `key` når statusen er endret.
 */
export function StatusCard({
  assignmentId,
  status,
  statusLabel,
  corrected,
  canEdit,
  next,
  previous,
  cancellable,
  changeAction,
  cancelAction,
}: {
  assignmentId: string;
  status: string;
  statusLabel: string;
  corrected: boolean;
  canEdit: boolean;
  next: StatusOption | null;
  previous: StatusOption | null;
  cancellable: boolean;
  changeAction: Action;
  cancelAction: Action;
}) {
  const [open, setOpen] = useState<"back" | "cancel" | null>(null);
  const close = () => setOpen(null);

  return (
    <section aria-labelledby="status-heading" className="mb-6">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="status-heading" className="text-xl font-semibold text-slate-900">
            Status
          </h2>
          <Badge tone="brand">{statusLabel}</Badge>
          {corrected && <Badge tone="warning">Rettet</Badge>}
        </div>

        {canEdit && (
          <div className="mt-4">
            {next && (
              <ForwardForm
                assignmentId={assignmentId}
                status={status}
                next={next}
                action={changeAction}
              />
            )}

            {open === null && (previous || cancellable) && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {previous && (
                  <Button variant="secondary" onClick={() => setOpen("back")}>
                    Tilbake til {previous.label}
                  </Button>
                )}
                {cancellable && (
                  <Button
                    variant="ghost"
                    className="text-urgent-text"
                    onClick={() => setOpen("cancel")}
                  >
                    Kanseller oppdraget
                  </Button>
                )}
              </div>
            )}

            {open === "back" && previous && (
              <ReasonForm
                id="status-back"
                assignmentId={assignmentId}
                status={status}
                toStatus={previous.value}
                hint={`Hvorfor skal oppdraget tilbake til ${previous.label}? Ikke skriv personopplysninger.`}
                submitLabel="Lagre"
                action={changeAction}
                onCancel={close}
              />
            )}

            {open === "cancel" && cancellable && (
              <ReasonForm
                id="status-cancel"
                assignmentId={assignmentId}
                status={status}
                hint="Oppdraget forsvinner fra arbeidet, men ingenting slettes. Ikke skriv personopplysninger."
                submitLabel="Kanseller"
                danger
                action={cancelAction}
                onCancel={close}
              />
            )}
          </div>
        )}
      </Card>
    </section>
  );
}
