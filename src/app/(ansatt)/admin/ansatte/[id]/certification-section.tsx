"use client";

import { useActionState, useEffect, useRef, useState, type Ref } from "react";
import { useFormStatus } from "react-dom";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { ChoiceGroup, Field, Input, Radio } from "@/shared/ui/form";
import { FormErrors, SubmitButton } from "../../form-parts";
import { initialFormState, textValue, type FormState } from "../../form-state";
import { EmployeeCard } from "../employee-forms";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

export type CertificationStatus = "valid" | "expiring" | "expired" | "not_started";

/** Én sertifisering slik den vises: tekstene er ferdig formatert på serveren. */
export type CertificationRow = {
  id: string;
  areaLabel: string;
  certificateNumber: string | null;
  issuer: string | null;
  /** «31.12.2027». */
  validTo: string;
  /** «01.01.2026», eller `null` når den ikke er fylt ut. */
  validFrom: string | null;
  status: CertificationStatus;
};

export type AreaChoice = { key: string; label: string };

/** Merket på raden. Teksten bærer meningen, ikke fargen. Gyldig får ikke merke. */
export function CertificationStatusBadge({ status }: { status: CertificationStatus }) {
  if (status === "expired") return <Badge tone="warning">Utgått</Badge>;
  if (status === "expiring") return <Badge tone="warning">Går ut snart</Badge>;
  if (status === "not_started") return <Badge>Ikke startet</Badge>;
  return null;
}

/**
 * Seksjonen «Sertifiseringer» på siden til den ansatte (oppgavekortet, Omfang 6): listen, «Fjern»
 * med bekreftelse per rad og skjemaet «Legg til sertifisering». Retting gjøres med «Fjern» og ny
 * registrering; fornyelse er en ny rad (A32).
 */
export function CertificationSection({
  certifications,
  areas,
  addAction,
  removeActions,
}: {
  certifications: readonly CertificationRow[];
  areas: readonly AreaChoice[];
  addAction: Action;
  /** «Fjern» per sertifisering, bundet til id-en på serveren. */
  removeActions: Readonly<Record<string, Action>>;
}) {
  return (
    <EmployeeCard title="Sertifiseringer">
      <p className="text-sm text-slate-600">
        Bare den som har gyldig sertifisering, kan publisere rapporter. Fornyelse legges inn som en
        ny sertifisering; den gamle blir stående som historikk.
      </p>
      {certifications.length === 0 ? (
        <p className="text-slate-600">Ingen sertifiseringer registrert.</p>
      ) : (
        <ul aria-label="Sertifiseringer" className="divide-y divide-slate-200">
          {certifications.map((certification) => (
            <CertificationItem
              key={certification.id}
              certification={certification}
              removeAction={removeActions[certification.id]}
            />
          ))}
        </ul>
      )}
      <AddCertificationForm areas={areas} action={addAction} />
    </EmployeeCard>
  );
}

function CertificationItem({
  certification,
  removeAction,
}: {
  certification: CertificationRow;
  removeAction: Action | undefined;
}) {
  const details = [
    certification.certificateNumber ? `Nr. ${certification.certificateNumber}` : null,
    certification.issuer,
    certification.validFrom ? `Gyldig fra ${certification.validFrom}` : null,
  ].filter(Boolean);
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0">
      <div className="min-w-0 flex-1 break-words">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-slate-900">{certification.areaLabel}</span>
          <CertificationStatusBadge status={certification.status} />
        </p>
        <p className="text-slate-700">Gyldig til {certification.validTo}</p>
        {details.length > 0 && <p className="text-sm text-slate-600">{details.join(" · ")}</p>}
      </div>
      {removeAction && <RemoveCertification action={removeAction} />}
    </li>
  );
}

/** «Bekreft» i bekreftelsen. Låst mens den sendes. */
function ConfirmButton({ buttonRef }: { buttonRef: Ref<HTMLButtonElement> }) {
  const { pending } = useFormStatus();
  return (
    <Button ref={buttonRef} type="submit" variant="primary" disabled={pending}>
      {pending ? "Fjerner …" : "Bekreft"}
    </Button>
  );
}

/** «Fjern» → «Bekreft» eller «Avbryt». Fokus flyttes slik at det går med tastatur alene. */
function RemoveCertification({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, initialFormState);
  // Bekreftelsen gjelder forsøket den ble åpnet i; et mislykket forsøk lukker den.
  const [confirmingAttempt, setConfirmingAttempt] = useState<number | null>(null);
  const confirming = confirmingAttempt === state.attempt;
  const removeRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
    else if (wasConfirming.current) removeRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  if (!confirming) {
    return (
      <div className="w-full space-y-2 sm:w-auto">
        <FormErrors state={state} />
        <Button
          ref={removeRef}
          variant="secondary"
          onClick={() => setConfirmingAttempt(state.attempt)}
        >
          Fjern
        </Button>
      </div>
    );
  }
  return (
    <form action={formAction} className="w-full space-y-2 sm:w-auto">
      <p className="text-sm text-slate-700">Fjerne sertifiseringen?</p>
      <div className="flex flex-wrap gap-2">
        <ConfirmButton buttonRef={confirmRef} />
        <Button variant="ghost" onClick={() => setConfirmingAttempt(null)}>
          Avbryt
        </Button>
      </div>
    </form>
  );
}

/**
 * «Legg til sertifisering». Området er forhåndsvalgt og skjult når det bare finnes én kode, så
 * admin fyller bare «Gyldig til» (og eventuelt resten) og trykker «Lagre».
 */
function AddCertificationForm({ areas, action }: { areas: readonly AreaChoice[]; action: Action }) {
  const [state, formAction] = useActionState(action, initialFormState);
  const [open, setOpen] = useState(false);
  // Forsøket som ble lukket med «Avbryt»; et nytt mislykket forsøk åpner skjemaet igjen.
  const [closedAttempt, setClosedAttempt] = useState(-1);
  const validToRef = useRef<HTMLInputElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  // Etter et mislykket forsøk står skjemaet åpent med feilene.
  const visible = open || (state.attempt > 0 && closedAttempt !== state.attempt);
  const error = (name: string) => state.fieldErrors[name];
  const onlyArea = areas.length === 1 ? areas[0] : undefined;

  useEffect(() => {
    if (visible && !wasOpen.current && state.attempt === 0) validToRef.current?.focus();
    if (!visible && wasOpen.current) openRef.current?.focus();
    wasOpen.current = visible;
  }, [visible, state.attempt]);

  if (!visible) {
    return (
      <div className="pt-1">
        <Button
          ref={openRef}
          variant="primary"
          aria-expanded={false}
          aria-controls="add-certification"
          onClick={() => setOpen(true)}
        >
          Legg til sertifisering
        </Button>
      </div>
    );
  }

  return (
    <form
      id="add-certification"
      action={formAction}
      noValidate
      aria-labelledby="add-certification-heading"
      className="space-y-5 border-t border-slate-200 pt-5"
    >
      <h3 id="add-certification-heading" className="text-base font-semibold text-slate-900">
        Legg til sertifisering
      </h3>
      <FormErrors state={state} />
      {onlyArea ? (
        <div className="space-y-1">
          <input type="hidden" name="area" value={onlyArea.key} />
          <p className="text-sm font-medium text-slate-700">Område</p>
          <p className="text-slate-900">{onlyArea.label}</p>
        </div>
      ) : (
        <ChoiceGroup id="area" legend="Område" error={error("area")}>
          {areas.map((area) => (
            <Radio
              key={area.key}
              name="area"
              value={area.key}
              label={area.label}
              defaultChecked={textValue(state, "area", areas[0]?.key) === area.key}
            />
          ))}
        </ChoiceGroup>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Gyldig til" htmlFor="validTo" error={error("validTo")}>
          <Input
            ref={validToRef}
            id="validTo"
            name="validTo"
            type="date"
            required
            defaultValue={textValue(state, "validTo", "")}
          />
        </Field>
        <Field label="Gyldig fra" htmlFor="validFrom" hint="Valgfritt." error={error("validFrom")}>
          <Input
            id="validFrom"
            name="validFrom"
            type="date"
            defaultValue={textValue(state, "validFrom", "")}
          />
        </Field>
        <Field
          label="Sertifikatnummer"
          htmlFor="certificateNumber"
          hint="Valgfritt."
          error={error("certificateNumber")}
        >
          <Input
            id="certificateNumber"
            name="certificateNumber"
            autoComplete="off"
            defaultValue={textValue(state, "certificateNumber", "")}
          />
        </Field>
        <Field label="Utsteder" htmlFor="issuer" hint="Valgfritt." error={error("issuer")}>
          <Input
            id="issuer"
            name="issuer"
            autoComplete="off"
            defaultValue={textValue(state, "issuer", "")}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton size="md">Lagre</SubmitButton>
        <Button
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setClosedAttempt(state.attempt);
          }}
        >
          Avbryt
        </Button>
      </div>
    </form>
  );
}
