import { and, eq, isNull } from "drizzle-orm";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import {
  BOOKING_HISTORY_LIMIT,
  type BookingHistoryEntry,
  type BookingHistoryValue,
} from "@/core/assignments/booking/contract";
import { bookingHistoryActionLabel, readBookingHistory } from "@/core/assignments/booking/history";
import { db } from "@/db/client";
import { orders } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { ORDER_EDITABLE_FIELDS, type OrderEditableField } from "./codes";

/*
 * Endringene på ett tilbud («Endringer» på tilbudssiden, T1). Lesingen av revisjonsloggen er
 * felles for ordre og oppdrag og står i `@/core/assignments/booking/history` (ADR 0011). Tilbudet
 * viser alle handlingene (`create`, `update`, `reject`, `convert`) og feltkodene i
 * `ORDER_EDITABLE_FIELDS`, også `validUntil` (ADR 0012).
 */

export { REMOVED_CONTACT_LABEL, REMOVED_FIRM_LABEL } from "@/core/assignments/booking/history";

/** Høyst så mange rader vises, de nyeste. */
export const ORDER_HISTORY_LIMIT = BOOKING_HISTORY_LIMIT;

/**
 * Norsk etikett for en handling på tilbudet. `reject` heter «Avslått» på tilbudet (ADR 0012);
 * ellers som for bestillingen. Ukjent kode gir koden tilbake.
 */
export function orderHistoryActionLabel(action: string): string {
  return action === "reject" ? "Avslått" : bookingHistoryActionLabel(action);
}

export type OrderHistoryValue = BookingHistoryValue<OrderEditableField>;
export type OrderHistoryEntry = BookingHistoryEntry<OrderEditableField>;

/**
 * Endringene på én ordre, nyeste først, høyst `ORDER_HISTORY_LIMIT` rader. Krever
 * `organization.read`. Fremmed, ukjent, slettet eller ugyldig ordre-id gir `AccessDeniedError`.
 * Den ansattes navn vises også når den ansatte er myk-slettet.
 */
export async function listOrderHistory(
  actor: Actor,
  organizationId: string,
  orderId: string,
): Promise<OrderHistoryEntry[]> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  if (!isUuid(orderId)) throw new AccessDeniedError();

  const [order] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.id, orderId),
        eq(orders.organizationId, grant.organizationId),
        isNull(orders.deletedAt),
      ),
    );
  if (!order) throw new AccessDeniedError();

  return readBookingHistory(
    grant,
    { entityType: "order", entityId: order.id },
    ORDER_EDITABLE_FIELDS,
  );
}
