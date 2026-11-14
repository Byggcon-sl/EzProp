"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { buttonVariants } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { ChoiceGroup, Field, Input, Radio } from "@/shared/ui/form";
import { FormErrors, SubmitButton } from "../../form-parts";
import { initialFormState, textValue, type FormState } from "../../form-state";
import {
  OrderedByFields,
  OrderMoreFields,
  OrderPropertyFields,
  type BookingFieldDefaults,
} from "../../ordre/order-fields";
import { BookingDuplicatesNotice } from "../../possible-duplicates-notice";
import type { DraftDuplicatesResult } from "./actions";
import {
  ASSIGNMENT_OFFLINE_MESSAGE,
  readAssignmentValues,
  type DraftDuplicateFields,
} from "./assignment-values";
import { InspectorChoice } from "./inspector-choice";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;
type DuplicatesAction = (fields: DraftDuplicateFields) => Promise<DraftDuplicatesResult>;

export type AssignmentFormOptions = {
  offices: { id: string; name: string }[];
  /** Kontoret som er valgt fra start, eller `null`. */
  defaultOfficeId: string | null;
  /** Teksten når organisasjonen ikke har kontorer, ellers `null`. */
  officesEmptyMessage: string | null;
  inspectors: { id: string; name: string }[];
  /** Den innloggede når hen er takstmann (valgt fra start), ellers `null`. */
  currentInspectorId: string | null;
};

const EMPTY_DEFAULTS: Omit<BookingFieldDefaults, "receivedAt"> = {
  addressText: "",
  externalRef: "",
  orderedByText: "",
  orderedByContact: null,
  gnr: "",
  bnr: "",
  snr: "",
  housingAssociationName: "",
};

/** Nettleseren sier at den er uten nett. */
function isOffline(): boolean {
  return typeof navigator !== "undefined" && !navigator.onLine;
}

/** Et mislykket forsøk uten nett. Alt som er skrevet står igjen; ingenting lagres lokalt. */
function offlineState(previous: FormState, formData: FormData): FormState {
  return {
    fieldErrors: {},
    message: ASSIGNMENT_OFFLINE_MESSAGE,
    values: readAssignmentValues(formData),
    attempt: previous.attempt + 1,
  };
}

function SectionCard({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Card>
      <section aria-labelledby={id} className="space-y-5">
        <h2 id={id} className="text-lg font-semibold text-slate-900">
          {title}
        </h2>
        {children}
      </section>
    </Card>
  );
}

/**
 * Skjemaet «Nytt oppdrag» (docs/funksjoner/fase2a-nytt-oppdrag-design.md avsnitt 4). Fire kort i
 * fast rekkefølge: eiendom, bestiller, befaring og ansvar, og «Mer om bestillingen». Kontor og
 * ansvarlig er radioknapper med forhåndsvalg. «Lagre» låses mens lagringen pågår, og
 * engangsnøkkelen `creationKey` gjør at et nytt trykk gir det samme oppdraget. Oppretting krever
 * nett: uten nett sendes ingenting, og ingenting lagres i nettleseren.
 */
export function AssignmentForm({
  action,
  duplicatesAction,
  options,
  creationKey,
  receivedAtDefault,
}: {
  action: Action;
  duplicatesAction: DuplicatesAction;
  options: AssignmentFormOptions;
  /** Uuid laget på serveren én gang per skjema. */
  creationKey: string;
  /** Nå i norsk tid, «ÅÅÅÅ-MM-DDTtt:mm». */
  receivedAtDefault: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const duplicatesHeadingId = useId();
  const [duplicates, setDuplicates] = useState<DraftDuplicatesResult>({
    items: [],
    hasMore: false,
  });
  const latestLookup = useRef(0);

  const [state, formAction] = useActionState(
    async (previous: FormState, formData: FormData): Promise<FormState> => {
      if (isOffline()) return offlineState(previous, formData);
      try {
        return await action(previous, formData);
      } catch (error) {
        // Nettet falt under sending (fetch gir TypeError). Videresending etter lagring og andre
        // feil kastes videre til Next.
        if (isOffline() || error instanceof TypeError) return offlineState(previous, formData);
        throw error;
      }
    },
    initialFormState,
  );

  // Fokus til første felt med feil i skjermrekkefølge. Kjører etter fokuset i `FormErrors`
  // (barnet), så feltet vinner når det finnes feil ved feltene.
  useEffect(() => {
    if (state.attempt === 0 || Object.keys(state.fieldErrors).length === 0) return;
    const first = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (first instanceof HTMLFieldSetElement) {
      const radio =
        first.querySelector<HTMLInputElement>("input:checked") ??
        first.querySelector<HTMLInputElement>("input:not([type=hidden])");
      radio?.focus();
    } else {
      first?.focus();
    }
  }, [state.attempt, state.fieldErrors]);

  /** Dublettoppslaget når adressefeltet eller matrikkelgruppen forlates. Bare med nett. */
  function lookupDuplicates() {
    const form = formRef.current;
    if (!form || isOffline()) return;
    const data = new FormData(form);
    const fields: DraftDuplicateFields = {
      addressText: String(data.get("addressText") ?? ""),
      gnr: String(data.get("gnr") ?? ""),
      bnr: String(data.get("bnr") ?? ""),
      snr: String(data.get("snr") ?? ""),
      receivedAt: String(data.get("receivedAt") ?? ""),
    };
    const request = ++latestLookup.current;
    duplicatesAction(fields)
      .then((result) => {
        if (request === latestLookup.current) setDuplicates(result);
      })
      .catch(() => {
        // Uten nett eller ved feil vises ingenting; varselet stopper aldri lagringen.
        if (request === latestLookup.current) setDuplicates({ items: [], hasMore: false });
      });
  }

  const defaults: BookingFieldDefaults = { ...EMPTY_DEFAULTS, receivedAt: receivedAtDefault };
  const error = (name: string) => state.fieldErrors[name];
  const officeId = textValue(state, "officeId", options.defaultOfficeId);
  const responsibleId = textValue(state, "responsibleEmployeeId", options.currentInspectorId);
  const cannotSave = options.offices.length === 0 || options.inspectors.length === 0;

  return (
    <form ref={formRef} action={formAction} noValidate className="space-y-6">
      <input type="hidden" name="creationKey" value={creationKey} />

      <SectionCard id="new-assignment-property" title="Eiendom">
        <OrderPropertyFields
          state={state}
          defaults={defaults}
          onAddressBlur={lookupDuplicates}
          onCadastreBlur={lookupDuplicates}
        />
      </SectionCard>

      <SectionCard id="new-assignment-ordered-by" title="Bestiller">
        <OrderedByFields state={state} defaults={defaults} />
      </SectionCard>

      <SectionCard id="new-assignment-inspection" title="Befaring og ansvar">
        <Field
          label="Avtalt befaring (valgfritt)"
          htmlFor="inspectionAt"
          hint="La stå tom hvis befaringen ikke er avtalt."
          error={error("inspectionAt")}
        >
          <Input
            id="inspectionAt"
            name="inspectionAt"
            type="datetime-local"
            defaultValue={textValue(state, "inspectionAt", "")}
          />
        </Field>
        {options.officesEmptyMessage ? (
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-slate-700">Kontor</p>
            <p className="text-slate-600">{options.officesEmptyMessage}</p>
          </div>
        ) : (
          // Ny nøkkel etter hvert forsøk: React tilbakestiller skjemaet, og gruppen tar ellers
          // ikke valget fra forrige forsøk.
          <ChoiceGroup
            key={`office-${state.attempt}`}
            id="officeId"
            legend="Kontor"
            columns
            error={error("officeId")}
          >
            {options.offices.map((office) => (
              <Radio
                key={office.id}
                name="officeId"
                value={office.id}
                label={office.name}
                defaultChecked={office.id === officeId}
              />
            ))}
          </ChoiceGroup>
        )}
        <InspectorChoice
          key={`responsible-${state.attempt}`}
          candidates={options.inspectors}
          currentEmployeeId={options.currentInspectorId}
          defaultId={responsibleId === "" ? null : responsibleId}
          error={error("responsibleEmployeeId")}
        />
      </SectionCard>

      <SectionCard id="new-assignment-more" title="Mer om bestillingen">
        <OrderMoreFields state={state} defaults={defaults} />
      </SectionCard>

      <BookingDuplicatesNotice
        items={duplicates.items}
        hasMore={duplicates.hasMore}
        headingId={duplicatesHeadingId}
        className=""
      />
      <FormErrors state={state} />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton disabled={cannotSave}>Lagre</SubmitButton>
        <Link href="/arbeidskoe" className={buttonVariants({ variant: "ghost", size: "md" })}>
          Avbryt
        </Link>
      </div>
    </form>
  );
}
