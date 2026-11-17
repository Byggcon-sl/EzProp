import Link from "next/link";
import type { ReactNode } from "react";
// Rene kodefiler (ingen database), fordi varselet også brukes i skjemaet i nettleseren.
import {
  duplicateReasonLabel,
  type DuplicateKind,
  type DuplicateReason,
} from "@/core/assignments/booking/codes";
import { assignmentStatusLabel } from "@/core/assignments/codes";
import {
  offerDisplayStatusLabel,
  orderStatusLabel,
  type OfferDisplayStatus,
} from "@/core/orders/codes";
import { buttonVariants } from "@/shared/ui/button";

/*
 * Varselet «Mulig dublett» (T3), felles for skjemaet «Nytt oppdrag», oppdragssiden og tilbudssiden
 * (docs/funksjoner/fase2a-nytt-oppdrag-design.md avsnitt 5, docs/funksjoner/fase2a-tilbud-design.md
 * avsnitt 7.2). Bare visning: treffene kommer fra kjernen. Varselet er en advarsel, aldri en
 * sperre, og har ingen «Lagre likevel». I «Nytt oppdrag» får åpne og utløpte tilbud knappen
 * «Gjør om tilbudet» (F2 b), så samme jobb ikke blir registrert to ganger.
 * Ingen «use client»: brukes både fra serversider og fra skjemaet.
 */

/** Teksten under overskriften når treffene kan være både tilbud og oppdrag. */
export const BOOKING_DUPLICATES_TEXT =
  "Samme adresse eller matrikkel som et annet oppdrag eller et tilbud. Sjekk at boligen ikke blir tatt to ganger.";

/** Knappen ved et åpent eller utløpt tilbud i «Nytt oppdrag» (F2 b, A364). */
export const CONVERT_OFFER_LABEL = "Gjør om tilbudet";

/** Står under listen når kjernen har flere treff enn den gir tilbake. */
export const POSSIBLE_DUPLICATES_MORE_TEXT = "Viser de 10 nyeste.";

/** Ett treff slik varselet viser det. Aldri matrikkel, bestiller eller dato. */
export type BookingDuplicateItem = {
  kind: DuplicateKind;
  id: string;
  number: string | null;
  status: string;
  addressText: string;
  reasons: readonly DuplicateReason[];
  /**
   * Visningsstatusen for et tilbud (`kind: "order"`), regnet i kjernen med samme dag som
   * spørringen: `open` eller `expired`. `null` eller utelatt for oppdrag.
   */
  displayStatus?: OfferDisplayStatus | null;
};

/**
 * Én linje for et treff: «Oppdrag 2026-00042 – Storgata 1A, 8006 Bodø – Under arbeid – samme
 * adresse» eller «Tilbud – Storgata 1A, 8006 Bodø – Utløpt – samme matrikkel». Statusordet er det
 * samme som i køen og i tilbudslisten («Åpent», «Utløpt»).
 */
export function bookingDuplicateLine(item: BookingDuplicateItem): string {
  const what =
    item.kind === "assignment" ? `Oppdrag${item.number ? ` ${item.number}` : ""}` : "Tilbud";
  const status =
    item.kind === "assignment"
      ? assignmentStatusLabel(item.status)
      : item.displayStatus
        ? offerDisplayStatusLabel(item.displayStatus)
        : orderStatusLabel(item.status);
  const reasons = item.reasons.map((reason) => duplicateReasonLabel(reason)).join(" og ");
  return [what, item.addressText, status, reasons].filter(Boolean).join(" – ");
}

/** Lenken til treffet etter typen. */
export function bookingDuplicateHref(item: Pick<BookingDuplicateItem, "kind" | "id">): string {
  return item.kind === "assignment" ? `/oppdrag/${item.id}` : `/tilbud/${item.id}`;
}

/**
 * Får treffet «Gjør om tilbudet»? Bare et tilbud som fortsatt kan gjøres om: åpent eller utløpt
 * (lagret status `received`). Avslåtte og gjort-om tilbud gir aldri knappen.
 */
export function canConvertDuplicate(item: BookingDuplicateItem): boolean {
  return (
    item.kind === "order" &&
    item.status === "received" &&
    (item.displayStatus === "open" || item.displayStatus === "expired")
  );
}

/** Lenken «Gjør om tilbudet»: tilbudssiden med «Gjør om til oppdrag» i fokus (`#gjor-om`). */
export function convertOfferHref(item: Pick<BookingDuplicateItem, "id">): string {
  return `/tilbud/${item.id}#gjor-om`;
}

/**
 * Rammen rundt varselet: `watch`-tonene, varseltrekant, overskrift «Mulig dublett», teksten og
 * én lenke per treff (minst 44 px høy, teksten brytes). `role="status"`, så skjermleseren leser
 * det uten å flytte fokus.
 */
export function PossibleDuplicatesFrame({
  headingId,
  text,
  hasMore,
  className = "mb-6",
  children,
}: {
  headingId: string;
  text: string;
  hasMore: boolean;
  className?: string;
  /** `<li>`-elementene. */
  children: ReactNode;
}) {
  return (
    <section
      role="status"
      aria-labelledby={headingId}
      className={`${className} min-w-0 rounded-xl border border-watch-line bg-watch-fill px-4 py-3 text-watch-text`}
    >
      <div className="flex items-start gap-2">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
          className="mt-0.5 shrink-0"
        >
          <path d="M12 3.5 2.5 20h19L12 3.5Z" />
          <path d="M12 10v4.5" />
          <path d="M12 17.5h.01" />
        </svg>
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="text-base font-semibold">
            Mulig dublett
          </h2>
          <p className="mt-1 text-sm break-words">{text}</p>
          <ul className="mt-2">{children}</ul>
          {hasMore && <p className="mt-1 text-sm">{POSSIBLE_DUPLICATES_MORE_TEXT}</p>}
        </div>
      </div>
    </section>
  );
}

/**
 * Lenken i varselet. `textId` gir teksten en id, så en knapp under kan vise til den
 * (`aria-describedby`). `action` står under lenken i samme punkt.
 */
export function PossibleDuplicateLink({
  href,
  children,
  textId,
  action,
}: {
  href: string;
  children: string;
  textId?: string;
  action?: ReactNode;
}) {
  return (
    <li>
      <Link href={href} className="flex min-h-11 items-center py-1 text-sm font-medium underline">
        {/* Eget element: teksten i en flex-boks brytes ellers ikke, og lange ord gir vannrett rulling. */}
        <span id={textId} className="min-w-0 [overflow-wrap:anywhere]">
          {children}
        </span>
      </Link>
      {action && <div className="mt-1 mb-2">{action}</div>}
    </li>
  );
}

/**
 * Varselet med treff fra både tilbud og oppdrag (`findPossibleDuplicatesFor` og
 * `findPossibleDuplicatesForAssignment`). Ingen treff gir ingenting. `offerAction` settes bare i
 * skjemaet «Nytt oppdrag»: da får åpne og utløpte tilbud lenken «Gjør om tilbudet» (F2 b). På
 * oppdragssiden er varselet bare lenker.
 */
export function BookingDuplicatesNotice({
  items,
  hasMore,
  headingId = "mulig-dublett-tittel",
  className,
  offerAction = false,
}: {
  items: readonly BookingDuplicateItem[];
  hasMore: boolean;
  headingId?: string;
  className?: string;
  offerAction?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <PossibleDuplicatesFrame
      headingId={headingId}
      text={BOOKING_DUPLICATES_TEXT}
      hasMore={hasMore}
      className={className}
    >
      {items.map((item) => {
        const textId = `${headingId}-${item.kind}-${item.id}`;
        const convert = offerAction && canConvertDuplicate(item);
        return (
          <PossibleDuplicateLink
            key={`${item.kind}-${item.id}`}
            href={bookingDuplicateHref(item)}
            textId={convert ? textId : undefined}
            action={
              convert ? (
                <Link
                  href={convertOfferHref(item)}
                  aria-describedby={textId}
                  className={buttonVariants({ variant: "secondary", size: "md" })}
                >
                  {CONVERT_OFFER_LABEL}
                </Link>
              ) : undefined
            }
          >
            {bookingDuplicateLine(item)}
          </PossibleDuplicateLink>
        );
      })}
    </PossibleDuplicatesFrame>
  );
}
