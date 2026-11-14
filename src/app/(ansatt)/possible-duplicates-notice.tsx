import Link from "next/link";
import type { ReactNode } from "react";
// Rene kodefiler (ingen database), fordi varselet også brukes i skjemaet i nettleseren.
import {
  duplicateReasonLabel,
  type DuplicateKind,
  type DuplicateReason,
} from "@/core/assignments/booking/codes";
import { assignmentStatusLabel } from "@/core/assignments/codes";
import { orderStatusLabel } from "@/core/orders/codes";

/*
 * Varselet «Mulig dublett» (T3), felles for skjemaet «Nytt oppdrag», oppdragssiden og ordresiden
 * (docs/funksjoner/fase2a-nytt-oppdrag-design.md avsnitt 5). Bare visning: treffene kommer fra
 * kjernen. Varselet er en advarsel, aldri en sperre, og har ingen «Lagre likevel».
 * Ingen «use client»: brukes både fra serversider og fra skjemaet.
 */

/** Teksten under overskriften når treffene kan være både ordre og oppdrag. */
export const BOOKING_DUPLICATES_TEXT =
  "Samme adresse eller matrikkel som et annet oppdrag eller en ordre. Sjekk at boligen ikke blir tatt to ganger.";

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
};

/**
 * Én linje for et treff: «Oppdrag 2026-00042 – Storgata 1A, 8006 Bodø – Under arbeid – samme
 * adresse» eller «Ordre – Storgata 1A, 8006 Bodø – Mottatt – samme matrikkel». Statusordet er det
 * samme som i køen og i ordrelisten.
 */
export function bookingDuplicateLine(item: BookingDuplicateItem): string {
  const what =
    item.kind === "assignment" ? `Oppdrag${item.number ? ` ${item.number}` : ""}` : "Ordre";
  const status =
    item.kind === "assignment" ? assignmentStatusLabel(item.status) : orderStatusLabel(item.status);
  const reasons = item.reasons.map((reason) => duplicateReasonLabel(reason)).join(" og ");
  return [what, item.addressText, status, reasons].filter(Boolean).join(" – ");
}

/** Lenken til treffet etter typen. */
export function bookingDuplicateHref(item: Pick<BookingDuplicateItem, "kind" | "id">): string {
  return item.kind === "assignment" ? `/oppdrag/${item.id}` : `/ordre/${item.id}`;
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

/** Lenken i varselet. */
export function PossibleDuplicateLink({ href, children }: { href: string; children: string }) {
  return (
    <li>
      <Link href={href} className="flex min-h-11 items-center py-1 text-sm font-medium underline">
        {/* Eget element: teksten i en flex-boks brytes ellers ikke, og lange ord gir vannrett rulling. */}
        <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
      </Link>
    </li>
  );
}

/**
 * Varselet med treff fra både ordre og oppdrag (`findPossibleDuplicatesFor` og
 * `findPossibleDuplicatesForAssignment`). Ingen treff gir ingenting.
 */
export function BookingDuplicatesNotice({
  items,
  hasMore,
  headingId = "mulig-dublett-tittel",
  className,
}: {
  items: readonly BookingDuplicateItem[];
  hasMore: boolean;
  headingId?: string;
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <PossibleDuplicatesFrame
      headingId={headingId}
      text={BOOKING_DUPLICATES_TEXT}
      hasMore={hasMore}
      className={className}
    >
      {items.map((item) => (
        <PossibleDuplicateLink key={`${item.kind}-${item.id}`} href={bookingDuplicateHref(item)}>
          {bookingDuplicateLine(item)}
        </PossibleDuplicateLink>
      ))}
    </PossibleDuplicatesFrame>
  );
}
