"use client";

import { usePathname, useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { ChoiceGroup, Field, Radio, Textarea } from "@/shared/ui/form";
import { Notice } from "@/shared/ui/notice";
import { FormErrors } from "../../form-parts";
import { initialFormState, textValue } from "../../form-state";
import type { OfferActionState } from "../actions";
import { withOfflineMessage } from "../offline-action";

/*
 * Handlingsblokken på tilbudssiden (docs/funksjoner/fase2a-tilbud-design.md 5.1–5.4): «Gjør om til
 * oppdrag» (ett trykk, kontoret forhåndsvalgt), «Forleng 30 dager» (F1) og «Avslå tilbud» med
 * kortet «Avslå tilbudet» (F4). Bare visning og skjemaer; tilgangen sjekkes i kjernen. Alle
 * kvitteringer kommer fra svaret på handlingen (T-0089).
 */

type Action = (state: OfferActionState, formData: FormData) => Promise<OfferActionState>;

/** Kontoret ved «Gjør om til oppdrag», regnet ut på serveren med `officeChoice`. */
export type ConvertOffice =
  /** Den ansattes kontor er valgt. `others` er alle kontorene når det finnes flere enn ett. */
  | { kind: "preselected"; officeId: string; officeName: string; others: Office[] }
  /** Den ansatte har ikke kontor (for eksempel admin): kontoret må velges over knappen. */
  | { kind: "choose"; offices: Office[] }
  /** Organisasjonen har ingen kontorer: beskjeden står i stedet for knappen. */
  | { kind: "none"; message: string };

type Office = { id: string; name: string };

/** En fast avslagsgrunn med etikett (fra `OFFER_REJECTION_REASON_KEYS` i kjernen). */
export type ReasonOption = { key: string; label: string };

const REJECT_CARD_ID = "avsla-tilbud";

/** Avslaget som nettopp ble lagret. Kortet «Avslått: …» tar fokus én gang (kvitteringen). */
let rejectedJustNow: string | null = null;

function PendingButton({
  children,
  pendingText,
  variant,
  size,
  className,
  buttonRef,
}: {
  children: ReactNode;
  pendingText: string;
  variant: "primary" | "secondary";
  size: "md" | "lg";
  className?: string;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      ref={buttonRef}
      type="submit"
      variant={variant}
      size={size}
      disabled={pending}
      className={className}
    >
      {pending ? pendingText : children}
    </Button>
  );
}

function WarningIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="mt-0.5 shrink-0"
    >
      <path d="M12 3 2 20h20L12 3z" />
      <path d="M12 10v4M12 17h.01" />
    </svg>
  );
}

function OfficeRadios({
  offices,
  selected,
  error,
  firstRef,
}: {
  offices: Office[];
  selected: string | null;
  error?: string;
  firstRef?: Ref<HTMLInputElement>;
}) {
  return (
    <ChoiceGroup id="officeId" legend="Kontor" columns error={error}>
      {offices.map((office, index) => (
        <Radio
          key={office.id}
          ref={index === 0 ? firstRef : undefined}
          name="officeId"
          value={office.id}
          label={office.name}
          defaultChecked={office.id === selected}
        />
      ))}
    </ChoiceGroup>
  );
}

/**
 * Handlingsblokken (`id="gjor-om"`) og kortet «Avslå tilbudet». Åpnes siden med `#gjor-om`
 * (fra «Gjør om tilbudet» i dublettvarselet), får «Gjør om til oppdrag» fokus, eller første
 * kontorvalg når kontoret må velges.
 */
export function OfferActions({
  orderId,
  rowVersion,
  office,
  canExtend,
  hasDuplicates,
  reasons,
  convertAction,
  extendAction,
  rejectAction,
}: {
  orderId: string;
  rowVersion: number;
  office: ConvertOffice;
  canExtend: boolean;
  hasDuplicates: boolean;
  reasons: ReasonOption[];
  convertAction: Action;
  extendAction: Action;
  rejectAction: Action;
}) {
  const [convertState, convert] = useActionState(
    withOfflineMessage(convertAction, (formData) => ({
      officeId: String(formData.get("officeId") ?? ""),
    })),
    initialFormState as OfferActionState,
  );
  const [extendState, extend] = useActionState(
    withOfflineMessage(extendAction, () => ({})),
    initialFormState as OfferActionState,
  );
  const [rejectOpen, setRejectOpen] = useState(false);
  const convertButtonRef = useRef<HTMLButtonElement>(null);
  const firstOfficeRef = useRef<HTMLInputElement>(null);
  const rejectToggleRef = useRef<HTMLButtonElement>(null);
  const extendNoticeRef = useRef<HTMLDivElement>(null);

  // F2 b: fra dublettvarselet på «Nytt oppdrag» kommer man hit med `#gjor-om`.
  useEffect(() => {
    if (window.location.hash !== "#gjor-om") return;
    if (office.kind === "choose") firstOfficeRef.current?.focus();
    else convertButtonRef.current?.focus();
    // Bare når siden åpnes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Knappen «Forleng» kan forsvinne etter lagring (mer enn 7 dager igjen), så kvitteringen får fokus.
  useEffect(() => {
    if (extendState.notice || extendState.message) extendNoticeRef.current?.focus();
  }, [extendState.notice, extendState.message, extendState.attempt]);

  return (
    <>
      <Card id="gjor-om" aria-labelledby="gjor-om-tittel" className="mb-6 space-y-4">
        <h2 id="gjor-om-tittel" className="sr-only">
          Gjør om eller avslå
        </h2>
        <div ref={extendNoticeRef} tabIndex={-1} className="rounded-xl empty:hidden">
          {extendState.notice ? (
            <Notice message={extendState.notice} />
          ) : extendState.message ? (
            <FormErrors state={extendState} />
          ) : null}
        </div>

        {office.kind === "none" ? (
          <p className="text-slate-600">{office.message}</p>
        ) : (
          <form action={convert} noValidate className="space-y-3">
            <FormErrors state={convertState} />
            <input type="hidden" name="orderId" value={orderId} />
            {office.kind === "choose" && (
              <OfficeRadios
                key={convertState.attempt}
                offices={office.offices}
                selected={textValue(convertState, "officeId", "") || null}
                error={convertState.fieldErrors.officeId}
                firstRef={firstOfficeRef}
              />
            )}
            {hasDuplicates && (
              // A369: varselet står under blokken, så knappen synes uten rulling. Linjen peker dit.
              <p className="flex items-start gap-2 text-sm text-watch-text">
                <WarningIcon />
                <span>
                  Mulig dublett.{" "}
                  <a href="#mulig-dublett-tittel" className="font-medium underline">
                    Se varselet under
                  </a>{" "}
                  før du gjør om.
                </span>
              </p>
            )}
            <PendingButton
              buttonRef={convertButtonRef}
              variant="primary"
              size="lg"
              pendingText="Lager oppdraget …"
              className="w-full sm:w-auto sm:px-8"
            >
              Gjør om til oppdrag
            </PendingButton>
            <p className="text-sm text-slate-600">
              Alt fra tilbudet fylles inn. Oppdraget får nummer nå.
            </p>
            {office.kind === "preselected" && (
              <>
                {office.others.length === 0 && (
                  <input type="hidden" name="officeId" value={office.officeId} />
                )}
                <p className="text-sm text-slate-700">Kontor: {office.officeName}</p>
                {office.others.length > 0 && (
                  <details>
                    <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-fjord-dark underline">
                      Velg et annet kontor
                    </summary>
                    <div className="mt-2">
                      <OfficeRadios
                        key={convertState.attempt}
                        offices={office.others}
                        selected={textValue(convertState, "officeId", office.officeId)}
                        error={convertState.fieldErrors.officeId}
                      />
                    </div>
                  </details>
                )}
              </>
            )}
            {office.kind === "preselected" &&
              office.others.length === 0 &&
              convertState.fieldErrors.officeId && (
                <p className="text-sm text-urgent-text">{convertState.fieldErrors.officeId}</p>
              )}
          </form>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {canExtend && (
            <form action={extend}>
              <input type="hidden" name="orderId" value={orderId} />
              <input type="hidden" name="rowVersion" value={rowVersion} />
              <PendingButton variant="secondary" size="md" pendingText="Lagrer …">
                Forleng 30 dager
              </PendingButton>
            </form>
          )}
          <Button
            ref={rejectToggleRef}
            variant="secondary"
            aria-expanded={rejectOpen}
            aria-controls={REJECT_CARD_ID}
            onClick={() => setRejectOpen(true)}
          >
            Avslå tilbud
          </Button>
        </div>
      </Card>

      {rejectOpen && (
        <RejectOfferCard
          orderId={orderId}
          reasons={reasons}
          action={rejectAction}
          onCancel={() => {
            setRejectOpen(false);
            // Etter at kortet er borte.
            setTimeout(() => rejectToggleRef.current?.focus(), 0);
          }}
        />
      )}
    </>
  );
}

/** Kortet «Avslå tilbudet» med fem faste grunner (F4) og «Mer om grunnen». */
function RejectOfferCard({
  orderId,
  reasons,
  action,
  onCancel,
}: {
  orderId: string;
  reasons: ReasonOption[];
  action: Action;
  onCancel: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [state, formAction] = useActionState(
    async (previous: OfferActionState, formData: FormData) => {
      const result = await withOfflineMessage(action, (data) => ({
        reasonKey: String(data.get("reasonKey") ?? ""),
        reasonText: String(data.get("reasonText") ?? ""),
      }))(previous, formData);
      if (result.done) rejectedJustNow = orderId;
      return result;
    },
    initialFormState as OfferActionState,
  );
  const reasonRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // Fokus til første felt med feil.
  useEffect(() => {
    if (state.fieldErrors.reasonKey) reasonRef.current?.focus();
    else if (state.fieldErrors.reasonText) textRef.current?.focus();
  }, [state.attempt, state.fieldErrors.reasonKey, state.fieldErrors.reasonText]);

  const selected = textValue(state, "reasonKey", "");

  return (
    <Card id={REJECT_CARD_ID} className="mb-6">
      <h2 ref={headingRef} tabIndex={-1} className="mb-4 text-lg font-medium text-slate-900">
        Avslå tilbudet
      </h2>
      <form action={formAction} noValidate className="space-y-5">
        {!state.fieldErrors.reasonKey && !state.fieldErrors.reasonText && (
          <FormErrors state={state} />
        )}
        <input type="hidden" name="orderId" value={orderId} />
        <ChoiceGroup
          key={`reason-${state.attempt}`}
          id="reasonKey"
          legend="Grunn"
          columns
          error={state.fieldErrors.reasonKey}
        >
          {reasons.map((reason, index) => (
            <Radio
              key={reason.key}
              ref={index === 0 ? reasonRef : undefined}
              name="reasonKey"
              value={reason.key}
              label={reason.label}
              defaultChecked={reason.key === selected}
            />
          ))}
        </ChoiceGroup>
        <Field
          label="Mer om grunnen"
          htmlFor="reasonText"
          hint="Må fylles ut når du velger Annet. Ingen fødselsnummer eller helseopplysninger."
          error={state.fieldErrors.reasonText}
        >
          <Textarea
            ref={textRef}
            key={`text-${state.attempt}`}
            id="reasonText"
            name="reasonText"
            maxLength={500}
            className="min-h-24"
            defaultValue={textValue(state, "reasonText", "")}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <PendingButton variant="secondary" size="md" pendingText="Avslår …">
            Avslå tilbudet
          </PendingButton>
          <Button variant="ghost" onClick={onCancel}>
            Avbryt
          </Button>
        </div>
      </form>
    </Card>
  );
}

/**
 * Kortet «Avslått: Pris» på et avslått tilbud. Rett etter avslaget er det kvitteringen og får
 * fokus (handlingsblokken er borte, så en egen melding ville forsvunnet med den).
 */
export function RejectedCard({ orderId, children }: { orderId: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (rejectedJustNow === orderId) {
      rejectedJustNow = null;
      ref.current?.focus();
    }
  }, [orderId]);
  return (
    <div ref={ref} tabIndex={-1} className="mb-6 rounded-xl">
      <Card>{children}</Card>
    </div>
  );
}

/**
 * «Tilbudet er laget. Gyldig til [dato].» etter «Nytt tilbud» og «Lagre som tilbud i stedet»
 * (A373). Står bare når siden åpnes med `?ny=1`; parameteren tas bort når kvitteringen er vist, så
 * den ikke kommer tilbake ved omlasting (T-0089). Komponenten står alltid på samme sted, så
 * kvitteringen blir stående til man går fra siden.
 */
export function CreatedNotice({ show, message }: { show: boolean; message: string }) {
  const [visible] = useState(show);
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (show) router.replace(pathname, { scroll: false });
  }, [show, router, pathname]);
  if (!visible) return null;
  return (
    <div className="mb-6">
      <Notice message={message} />
    </div>
  );
}
