import { duplicateReasonLabel, orderStatusLabel, type PossibleDuplicateOrder } from "@/core/orders";
import {
  POSSIBLE_DUPLICATES_MORE_TEXT,
  PossibleDuplicateLink,
  PossibleDuplicatesFrame,
} from "../../possible-duplicates-notice";
import { formatOsloDate } from "../received-at";

/** Teksten under overskriften «Mulig dublett». */
export const POSSIBLE_DUPLICATES_TEXT =
  "Samme adresse eller matrikkel som en annen ordre. Sjekk at boligen ikke blir bestilt eller tatt to ganger.";

export { POSSIBLE_DUPLICATES_MORE_TEXT };

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
    <PossibleDuplicatesFrame
      headingId="mulig-dublett-tittel"
      text={POSSIBLE_DUPLICATES_TEXT}
      hasMore={hasMore}
    >
      {items.map((item) => (
        <PossibleDuplicateLink key={item.id} href={`/ordre/${item.id}`}>
          {possibleDuplicateLine(item)}
        </PossibleDuplicateLink>
      ))}
    </PossibleDuplicatesFrame>
  );
}
