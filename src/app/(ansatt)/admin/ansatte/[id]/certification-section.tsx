"use client";

import { useActionState, useState } from "react";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Field, Input } from "@/shared/ui/form";
import { FormErrors, SubmitButton } from "../../form-parts";
import { initialFormState, textValue, type FormState } from "../../form-state";
import { EmployeeCard } from "../employee-forms";

type CreateAction = (state: FormState, formData: FormData) => Promise<FormState>;
type DeleteAction = (state: FormState) => Promise<FormState>;

/** Én sertifisering slik den vises. Tekstene er ferdig formatert på serveren. */
export type CertificationRow = {
  id: string;
  areaLabel: string;
  certificateNumber: string | null;
  issuer: string | null;
  /** «31.12.2027». */
  validTo: string;
  /** «Utgått», «Går ut snart» eller `null`. */
  statusLabel: string | null;
  expired: boolean;
  remove: DeleteAction;
};

/**
 * Seksjonen «Sertifiseringer» på siden til en ansatt: listen, «Fjern» med bekreftelse og skjemaet
 * «Legg til sertifisering». Har personen sluttet, vises bare listen.
 */
export function CertificationSection({
  rows,
  area,
  areaLabel,
  create,
  locked,
}: {
  rows: CertificationRow[];
  /** Den forhåndsvalgte koden (bare én nå). */
  area: string;
  areaLabel: string;
  create: CreateAction;
  locked: boolean;
}) {
  return (
    <EmployeeCard title="Sertifiseringer">
      <p className="text-sm text-slate-600">
        Bare den som har gyldig sertifisering, kan publisere rapporter. Ved fornyelse legger du til
        en ny; den gamle blir stående.
      </p>
      {rows.length === 0 ? (
        <p className="text-slate-600">Ingen sertifiseringer registrert.</p>
      ) : (
        <ul aria-label="Sertifiseringer" className="divide-y divide-slate-200">
          {rows.map((row) => (
            <CertificationItem key={row.id} row={row} locked={locked} />
          ))}
        </ul>
      )}
      {locked ? (
        <p className="text-sm text-slate-600">Angre sluttet for å legge til sertifisering.</p>
      ) : (
        <AddCertificationForm area={area} areaLabel={areaLabel} action={create} />
      )}
    </EmployeeCard>
  );
}

function CertificationItem({ row, locked }: { row: CertificationRow; locked: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction] = useActionState(row.remove, initialFormState);
  const details = [
    row.certificateNumber ? `Nr. ${row.certificateNumber}` : null,
    row.issuer,
  ].filter(Boolean);

  return (
    <li className="space-y-3 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 break-words">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-900">{row.areaLabel}</span>
            {row.statusLabel && (
              <Badge tone={row.expired ? "warning" : "brand"}>{row.statusLabel}</Badge>
            )}
          </p>
          <p className="text-sm text-slate-700">Gyldig til {row.validTo}</p>
          {details.length > 0 && <p className="text-sm text-slate-600">{details.join(" · ")}</p>}
        </div>
        {!locked && !confirming && (
          <Button variant="secondary" size="md" onClick={() => setConfirming(true)}>
            Fjern<span className="sr-only"> sertifisering med gyldig til {row.validTo}</span>
          </Button>
        )}
      </div>
      {!locked && confirming && (
        <form action={formAction} className="space-y-3 rounded-xl bg-slate-50 p-3">
          <FormErrors state={state} />
          <p className="text-slate-900">
            Fjerne sertifiseringen med gyldig til {row.validTo}? Den står fortsatt i historikken.
          </p>
          <div className="flex flex-wrap gap-3">
            <SubmitButton variant="primary" size="md">
              Ja, fjern
            </SubmitButton>
            <Button variant="ghost" size="md" onClick={() => setConfirming(false)}>
              Avbryt
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}

function AddCertificationForm({
  area,
  areaLabel,
  action,
}: {
  area: string;
  areaLabel: string;
  action: CreateAction;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const [open, setOpen] = useState(false);
  // Forsøket da skjemaet sist ble lukket med «Avbryt».
  const [closedAt, setClosedAt] = useState(0);
  const error = (name: string) => state.fieldErrors[name];

  // Etter et mislykket forsøk står skjemaet åpent med verdiene og feilene.
  if (!open && state.attempt <= closedAt) {
    return (
      <div>
        <Button variant="secondary" size="md" onClick={() => setOpen(true)}>
          Legg til sertifisering
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} noValidate className="space-y-5 border-t border-slate-200 pt-5">
      <h3 className="text-base font-semibold text-slate-900">Legg til sertifisering</h3>
      <FormErrors state={state} />
      <input type="hidden" name="area" value={area} />
      <div className="space-y-1">
        <p className="text-sm font-medium text-slate-700">Område</p>
        <p className="text-slate-900">{areaLabel}</p>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Gyldig til" htmlFor="validTo" error={error("validTo")}>
          <Input
            id="validTo"
            name="validTo"
            type="date"
            required
            defaultValue={textValue(state, "validTo", "")}
          />
        </Field>
        <Field label="Gyldig fra (valgfritt)" htmlFor="validFrom" error={error("validFrom")}>
          <Input
            id="validFrom"
            name="validFrom"
            type="date"
            defaultValue={textValue(state, "validFrom", "")}
          />
        </Field>
        <Field
          label="Sertifikatnummer (valgfritt)"
          htmlFor="certificateNumber"
          error={error("certificateNumber")}
        >
          <Input
            id="certificateNumber"
            name="certificateNumber"
            autoComplete="off"
            defaultValue={textValue(state, "certificateNumber", "")}
          />
        </Field>
        <Field label="Utsteder (valgfritt)" htmlFor="issuer" error={error("issuer")}>
          <Input
            id="issuer"
            name="issuer"
            autoComplete="off"
            defaultValue={textValue(state, "issuer", "")}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="primary" size="md">
          Lagre sertifisering
        </SubmitButton>
        <Button
          variant="ghost"
          size="md"
          onClick={() => {
            setOpen(false);
            setClosedAt(state.attempt);
          }}
        >
          Avbryt
        </Button>
      </div>
    </form>
  );
}
