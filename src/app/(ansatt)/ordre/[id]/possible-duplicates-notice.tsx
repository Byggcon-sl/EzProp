import Link from "next/link";
import { duplicateReasonLabel, orderStatusLabel, type PossibleDuplicateOrder } from "@/core/orders";
import { formatOsloDate } from "../received-at";

/** Teksten under overskriften «Mulig dublett». */
export const POSSIBLE_DUPLICATES_TEXT =
  "Samme adresse eller matrikkel som en annen ordre. Sjekk at boligen ikke blir bestilt eller tatt to ganger.";

/** Står under listen når kjernen har flere treff enn den gir tilbake. */
export const POSSIBLE_DUPLICATES_MORE_TEXT = "Viser de 10 nyeste.";

/**
 * Én linje for et treff: «Storgata 1A, 8006 Bodø – mottatt 12.11.2026 – Gjort om til oppdrag
 * A-2026-0042 – samme adresse». Statusordet er det samme som i `OrderStatusBadge`.
 */
export function possibleDuplicateLine(item: PossibleDuplicateOrder): string {
  const status =
    item.status === "converted" && item.assignmentNumber
      ? `${orderStatusLabel(item.status)} ${item.assignmentNumber}`
      : orderStatusLabel(item.status);
  const reasons = item.reasons.map((reason) => duplicateReasonLabel(reason)).join(" og ");
  return [item.addressText, `mottatt ${formatOsloDate(item.receivedAt)}`, status, reasons]
    .filter(Boolean)
    .join(" – ");
}

/**
 * Varselet «Mulig dublett» på ordresiden (T3). Bare visning: treffene kommer fra
 * `findPossibleDuplicateOrders` i kjernen. Ingen treff gir ingenting. Varselet stopper ingenting;
 * det er en advarsel med lenker til de andre ordrene.
 */
export function PossibleDuplicatesNotice({
  items,
  hasMore,
}: {
  items: readonly PossibleDuplicateOrder[];
  hasMore: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <section
      role="status"
      aria-labelledby="mulig-dublett-tittel"
      className="mb-6 min-w-0 rounded-xl border border-watch-line bg-watch-fill px-4 py-3 text-watch-text"
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
          <h2 id="mulig-dublett-tittel" className="text-base font-semibold">
            Mulig dublett
          </h2>
          <p className="mt-1 text-sm break-words">{POSSIBLE_DUPLICATES_TEXT}</p>
          <ul className="mt-2">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/ordre/${item.id}`}
                  className="flex min-h-11 items-center py-1 text-sm font-medium underline"
                >
                  {/* Eget element: teksten i en flex-boks brytes ellers ikke, og lange ord gir vannrett rulling. */}
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {possibleDuplicateLine(item)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {hasMore && <p className="mt-1 text-sm">{POSSIBLE_DUPLICATES_MORE_TEXT}</p>}
        </div>
      </div>
    </section>
  );
}
