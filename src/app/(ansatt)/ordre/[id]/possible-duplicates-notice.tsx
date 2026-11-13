import Link from "next/link";
import {
  DUPLICATE_REASONS,
  duplicateReasonLabel,
  orderStatusLabel,
  type PossibleDuplicateOrder,
} from "@/core/orders";
import { formatOsloDate } from "../received-at";

function WarningIcon() {
  return (
    <svg
      width="20"
      height="20"
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
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/** Metalinjen: «mottatt dd.mm.åååå – status – grunner», grunnene i fast rekkefølge. */
function Meta({ item }: { item: PossibleDuplicateOrder }) {
  const reasons = DUPLICATE_REASONS.filter((reason) => item.reasons.includes(reason))
    .map(duplicateReasonLabel)
    .join(", ");
  return (
    <span className="text-sm">
      mottatt {formatOsloDate(item.receivedAt)}
      {" – "}
      {item.status === "converted" && item.assignmentNumber ? (
        <>
          Gjort om til oppdrag <span className="tabular-nums">{item.assignmentNumber}</span>
        </>
      ) : (
        orderStatusLabel(item.status)
      )}
      {reasons && ` – ${reasons}`}
    </span>
  );
}

/**
 * Varselet «Mulig dublett» på ordresiden (T3): andre ordre med samme adresse eller matrikkel, med
 * én lenke per treff. Stopper ingenting. Treffene og tilgangen kommer fra kjernen; ingen treff gir
 * ingenting.
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
    <div
      role="status"
      aria-labelledby="possible-duplicates-title"
      className="mb-6 rounded-xl bg-watch-fill px-4 py-3 text-watch-text"
    >
      <div className="flex items-start gap-3">
        <WarningIcon />
        <div className="min-w-0 flex-1">
          <h2 id="possible-duplicates-title" className="text-lg font-semibold">
            Mulig dublett
          </h2>
          <p className="mt-1 text-sm">
            Samme adresse eller matrikkel som en annen ordre. Sjekk at boligen ikke blir bestilt
            eller tatt to ganger.
          </p>
          <ul className="mt-2 divide-y divide-watch-line/40 border-t border-watch-line/40">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/ordre/${item.id}`}
                  className="flex min-h-11 min-w-0 flex-col justify-center py-2 underline underline-offset-2 [overflow-wrap:anywhere]"
                >
                  <span className="font-medium">{item.addressText}</span>
                  <Meta item={item} />
                </Link>
              </li>
            ))}
          </ul>
          {hasMore && <p className="mt-2 text-sm">Viser de 10 nyeste.</p>}
        </div>
      </div>
    </div>
  );
}
