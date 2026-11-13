import { and, eq, isNull } from "drizzle-orm";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { ContactNotFoundError, findContactForLink } from "@/core/contacts";
import { recordEvent } from "@/core/events";
import { db } from "@/db/client";
import { orders } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { ORDER_EDITABLE_FIELDS, type OrderEditableField } from "./codes";
import { OrderChangedError } from "./errors";
import { selectOrder } from "./orders";
import { orderInputSchema, type OrderInput } from "./schemas";

/*
 * Endre en lagret ordre (T1, Ståle 12.11.2026: «full redigeringstilgang. alltid»; endrer A55 og
 * A87). Virker i alle statuser (A250). Status, avvisningsgrunn, oppdrag, kilde og ønsket rapport
 * endres aldri her, og oppdraget endres ikke (A251).
 *
 * Personvern: input, raden, endringene og Zod-feilen sendes aldri til `logger`, og ingen feil som
 * kastes her har verdier i meldingen. Hendelsen får bare feltkodene. Gamle og nye verdier står bare
 * i revisjonsloggen under `values` (A252, spørsmål 79).
 */

type FieldValue = string | boolean | null;

/** Verdien slik den sammenlignes og lagres i loggen: datoer som ISO-tekst. */
function comparable(value: Date | string | boolean | null): FieldValue {
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Skjemaet viser «Mottatt» med hele minutter. Har ordren sekunder (satt til «nå» ved oppretting,
 * eller fra e-post), skal en lagring med samme minutt ikke telle som endring.
 */
function sameMinute(stored: Date, submitted: Date): boolean {
  return (
    submitted.getTime() % 60_000 === 0 &&
    Math.floor(stored.getTime() / 60_000) === submitted.getTime() / 60_000
  );
}

function isEmptyReceivedAt(input: OrderInput): boolean {
  const value = input.receivedAt;
  return value === null || value === undefined || value === "";
}

/**
 * Endrer feltene i `ORDER_EDITABLE_FIELDS` på en lagret ordre og gir ordren tilbake i samme form
 * som `getOrder` (med ny `rowVersion`).
 *
 * - Tilgang: `assignment.edit` (A249), som ved oppretting; følger `access.inspectors_edit_all`.
 * - Fremmed, ukjent, slettet eller ugyldig ordre-id gir `AccessDeniedError`.
 * - `expectedRowVersion` er versjonen skjemaet ble åpnet med. Er den ulik raden, gir det
 *   `OrderChangedError` og ingenting endres (A253). Raden låses med `FOR UPDATE`.
 * - Bestilleren kobles som ved oppretting: firmaet følger kontakten. Fremmed, ukjent eller slettet
 *   kontakt gir `ContactNotFoundError`.
 * - Tom «Mottatt» betyr uendret (ved oppretting betyr den «nå»). Samme minutt som lagret betyr
 *   også uendret, fordi skjemaet viser hele minutter.
 * - Ingen endring: ingen oppdatering, ingen loggrad, ingen hendelse, `row_version` uendret.
 */
export async function updateOrder(
  actor: Actor,
  organizationId: string,
  orderId: string,
  input: OrderInput,
  expectedRowVersion: number,
  now: Date = new Date(),
) {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  if (!isUuid(orderId)) throw new AccessDeniedError();
  const parsed = orderInputSchema(now).parse(input);
  const keepReceivedAt = isEmptyReceivedAt(input);

  return db.transaction(async (tx) => {
    const where = and(
      eq(orders.id, orderId),
      eq(orders.organizationId, grant.organizationId),
      isNull(orders.deletedAt),
    );
    const [before] = await tx
      .select({
        rowVersion: orders.rowVersion,
        receivedAt: orders.receivedAt,
        externalRef: orders.externalRef,
        orderedByText: orders.orderedByText,
        orderedByContactId: orders.orderedByContactId,
        orderedByFirmId: orders.orderedByFirmId,
        addressText: orders.addressText,
        gnr: orders.gnr,
        bnr: orders.bnr,
        snr: orders.snr,
        housingAssociationName: orders.housingAssociationName,
        sellerDeclarationReceived: orders.sellerDeclarationReceived,
      })
      .from(orders)
      .where(where)
      .for("update");
    if (!before) throw new AccessDeniedError();
    if (before.rowVersion !== expectedRowVersion) throw new OrderChangedError();

    let orderedByFirmId: string | null = null;
    if (parsed.orderedByContactId !== null) {
      const contact = await findContactForLink(tx, grant.organizationId, parsed.orderedByContactId);
      if (!contact) throw new ContactNotFoundError();
      orderedByFirmId = contact.firmId;
    }

    const next = {
      receivedAt:
        keepReceivedAt || sameMinute(before.receivedAt, parsed.receivedAt)
          ? before.receivedAt
          : parsed.receivedAt,
      externalRef: parsed.externalRef,
      orderedByText: parsed.orderedByText,
      orderedByContactId: parsed.orderedByContactId,
      orderedByFirmId,
      addressText: parsed.addressText,
      gnr: parsed.gnr,
      bnr: parsed.bnr,
      snr: parsed.snr,
      housingAssociationName: parsed.housingAssociationName,
      sellerDeclarationReceived: parsed.sellerDeclarationReceived,
    } satisfies Record<OrderEditableField, Date | string | boolean | null>;

    const fields: OrderEditableField[] = [];
    const values: Partial<Record<OrderEditableField, { from: FieldValue; to: FieldValue }>> = {};
    const fromValues = before satisfies Record<OrderEditableField, unknown>;
    for (const field of ORDER_EDITABLE_FIELDS) {
      const from = comparable(fromValues[field]);
      const to = comparable(next[field]);
      if (from === to) continue;
      fields.push(field);
      values[field] = { from, to };
    }

    if (fields.length > 0) {
      const [row] = await tx
        .update(orders)
        .set({ ...next, updatedBy: grant.employeeId })
        .where(where)
        .returning({ id: orders.id });
      if (!row) throw new AccessDeniedError();

      await recordAuditEvent(tx, grant, {
        entityType: "order",
        entityId: orderId,
        action: "update",
        // Bestilleren som id-er, aldri navn. Verdiene samlet under `values` (A252).
        changes: { fields, values },
      });
      await recordEvent(tx, grant, { type: "order.updated", data: { orderId, fields } });
    }

    const order = await selectOrder(tx, grant.organizationId, orderId);
    if (!order) throw new AccessDeniedError();
    return order;
  });
}
