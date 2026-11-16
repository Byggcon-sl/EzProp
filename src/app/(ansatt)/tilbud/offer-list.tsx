"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { OfferDisplayStatus } from "@/core/orders/codes";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { FormMessage } from "@/shared/ui/form";
import { Notice } from "@/shared/ui/notice";
import { initialFormState } from "../form-state";
import type { OfferActionState } from "./actions";
import { withOfflineMessage } from "./offline-action";
import { OfferStatusBadge } from "./offer-status-badge";

/** Én rad slik listen viser den. Alt er regnet ut på serveren. */
export type OfferRow = {
  id: string;
  addressText: string;
  /** «02.11.2026». */
  receivedText: string;
  orderedByText: string | null;
  externalRef: string | null;
  displayStatus: OfferDisplayStatus;
  /** «ÅÅÅÅ-MM-DD». */
  validUntil: string;
  /** «Gyldig til 19.11.2026» for åpne og utløpte, ellers `null`. */
  validUntilText: string | null;
  /** «Går ut om 3 dager» eller `null`. */
  expiryText: string | null;
  assignmentNumber: string | null;
  /** Oppdraget er kansellert: «2026-0042 (kansellert)» (T-0031). */
  assignmentCancelled: boolean;
  /** «Forleng 30 dager» vises (F1). */
  canExtend: boolean;
};

type Action = (state: OfferActionState, formData: FormData) => Promise<OfferActionState>;

function ExtendButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" size="md" disabled={pending}>
      {pending ? "Lagrer …" : "Forleng 30 dager"}
    </Button>
  );
}

/**
 * Listen over tilbud (docs/funksjoner/fase2a-tilbud-design.md 3.4 og 3.7). Hver rad er en lenke til
 * tilbudet, og «Forleng 30 dager» står ved siden av som eget skjema, aldri inne i lenken. Raden kan
 * forsvinne fra «Utløpt» etter forleng, så kvitteringen («[adresse] er gyldig til [dato].», A372)
 * står over listen og får fokus. Kvitteringen kommer fra svaret på handlingen, ikke fra adressen.
 */
export function OfferList({
  rows,
  emptyText,
  extendAction,
}: {
  rows: OfferRow[];
  /** Teksten når listen er tom (filteret og søket). */
  emptyText: string;
  extendAction: Action;
}) {
  const [state, formAction] = useActionState(
    withOfflineMessage(extendAction, () => ({})),
    initialFormState as OfferActionState,
  );
  const statusRef = useRef<HTMLDivElement>(null);
  const shown = state.notice ?? state.message;

  useEffect(() => {
    if (shown) statusRef.current?.focus();
  }, [shown, state.attempt]);

  return (
    <>
      <div ref={statusRef} tabIndex={-1} className="mt-4 rounded-xl empty:hidden">
        {state.notice ? (
          <Notice message={state.notice} />
        ) : state.message ? (
          <FormMessage message={state.message} />
        ) : null}
      </div>
      {rows.length === 0 ? (
        <Card className="mt-6">
          <p className="text-slate-600">{emptyText}</p>
        </Card>
      ) : (
        <Card className="mt-6 overflow-hidden p-0">
          <ul>
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center border-t border-slate-200 first:border-t-0"
              >
                <Link
                  href={`/tilbud/${row.id}`}
                  className="flex min-h-14 min-w-0 flex-1 basis-72 flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 hover:bg-brand-50 focus-visible:-outline-offset-2"
                >
                  <span className="min-w-0 flex-1 basis-48 break-words">
                    <span className="block font-medium text-slate-900 [overflow-wrap:anywhere]">
                      {row.addressText}
                    </span>
                    <span className="block text-sm text-slate-600">
                      Mottatt {row.receivedText}
                      {row.orderedByText && <> · {row.orderedByText}</>}
                      {row.externalRef && <> · Meglerens ordrenr. {row.externalRef}</>}
                      {row.validUntilText && <> · {row.validUntilText}</>}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-wrap items-center gap-2">
                    {row.assignmentNumber && (
                      <span className="text-sm font-medium text-slate-900 tabular-nums">
                        {row.assignmentNumber}
                        {row.assignmentCancelled && " (kansellert)"}
                      </span>
                    )}
                    <OfferStatusBadge
                      displayStatus={row.displayStatus}
                      validUntil={row.validUntil}
                      expiryText={row.expiryText}
                    />
                  </span>
                </Link>
                {row.canExtend && (
                  <form action={formAction} className="mb-3 ml-5 shrink-0 sm:mr-5 sm:mb-0 sm:ml-0">
                    <input type="hidden" name="orderId" value={row.id} />
                    <input type="hidden" name="withAddress" value="1" />
                    <ExtendButton />
                  </form>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
