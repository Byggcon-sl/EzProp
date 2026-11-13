"use client";

import { useActionState, useState } from "react";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Field } from "@/shared/ui/form";
import { FormErrors, SubmitButton } from "../../form-parts";
import { initialFormState, textValue, type FormState } from "../../form-state";
import {
  agreementBadge,
  agreementPeriodText,
  selectableAgreements,
  suggestionText,
} from "./agreement-view";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

export type AgreementCardAgreement = {
  id: string;
  name: string;
  validFrom: string;
  validTo: string | null;
  deletedAt: Date | string | null;
};

export type AgreementCardSuggestion = {
  agreementId: string;
  agreementName: string;
  firmName: string;
};

const selectClass =
  "block min-h-11 w-full rounded-lg border border-field bg-white px-3 text-base text-slate-900 focus:border-brand-600 aria-invalid:border-urgent-line";

/**
 * Kortet «Avtale» på oppdragssiden (A116, A117). Viser avtalen med periode og merke, forslaget
 * med «Bruk avtalen», og en velger med bare gyldige avtaler. Knappene vises bare med `canEdit`
 * (siden avgjør det fra tilgangen); kjernen sjekker likevel. `today` er `todayInOslo()`.
 */
export function AgreementCard({
  assignmentId,
  agreement,
  suggestion,
  agreements,
  today,
  canEdit,
  action,
}: {
  assignmentId: string;
  agreement: AgreementCardAgreement | null;
  suggestion: AgreementCardSuggestion | null;
  agreements: AgreementCardAgreement[];
  today: string;
  canEdit: boolean;
  action: Action;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const [choosing, setChoosing] = useState(false);
  const options = selectableAgreements(agreements, today);
  const badge = agreement ? agreementBadge(agreement, today) : null;
  const showSelect = canEdit && (agreement === null || choosing);

  return (
    <section aria-labelledby="agreement-heading" className="mb-8">
      <Card>
        <h2 id="agreement-heading" className="text-xl font-semibold text-slate-900">
          Avtale
        </h2>
        <div className="mt-3 space-y-4">
          <FormErrors state={state} />

          {agreement ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <p className="min-w-0 break-words font-medium text-slate-900">{agreement.name}</p>
              <p className="text-slate-600">{agreementPeriodText(agreement)}</p>
              {badge && <Badge tone="warning">{badge}</Badge>}
            </div>
          ) : (
            <p className="text-slate-600">Ingen avtale</p>
          )}

          {canEdit && agreement && (
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" size="md" onClick={() => setChoosing((open) => !open)}>
                Bytt
              </Button>
              <form action={formAction}>
                <input type="hidden" name="assignmentId" value={assignmentId} />
                <input type="hidden" name="agreementId" value="" />
                <SubmitButton variant="secondary" size="md">
                  Fjern
                </SubmitButton>
              </form>
            </div>
          )}

          {canEdit && !agreement && suggestion && (
            <form action={formAction} className="space-y-3">
              <p className="break-words text-slate-900">{suggestionText(suggestion)}</p>
              <input type="hidden" name="assignmentId" value={assignmentId} />
              <input type="hidden" name="agreementId" value={suggestion.agreementId} />
              <SubmitButton size="md">Bruk avtalen</SubmitButton>
            </form>
          )}

          {showSelect && (
            <form action={formAction} noValidate className="space-y-3">
              <input type="hidden" name="assignmentId" value={assignmentId} />
              {/* Ny nøkkel på listen etter hvert forsøk: React tilbakestiller skjemaet, og
                  listen tar ellers ikke valget fra forrige forsøk. */}
              <Field label="Avtale" htmlFor="agreement-select">
                <select
                  key={state.attempt}
                  id="agreement-select"
                  name="agreementId"
                  className={selectClass}
                  defaultValue={textValue(
                    state,
                    "agreementId",
                    agreement && options.some((o) => o.id === agreement.id) ? agreement.id : "",
                  )}
                >
                  <option value="">Ingen avtale</option>
                  {options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </Field>
              <SubmitButton variant="secondary" size="md">
                Lagre
              </SubmitButton>
            </form>
          )}
        </div>
      </Card>
    </section>
  );
}
