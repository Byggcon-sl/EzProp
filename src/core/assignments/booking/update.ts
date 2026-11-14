import { and, eq, isNull } from "drizzle-orm";
import { AccessDeniedError, requireOrganizationAccess } from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import {
  ContactNotFoundError,
  findContactForLink,
  lookupContactAndFirmNames,
} from "@/core/contacts";
import { recordEvent } from "@/core/events";
import { db, type DbExecutor } from "@/db/client";
import { assignments } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { AssignmentChangedError } from "../errors";
import { BOOKING_EDITABLE_FIELDS, type BookingEditableField, type BookingSource } from "./codes";
import type {
  AssignmentBooking,
  BookingInput,
  UpdateAssignmentBooking,
  UpdateAssignmentBookingResult,
} from "./contract";
import { bookingInputSchema, type BookingValues } from "./schemas";

/*
 * Endring av bestillingen etter lagring, felles for ordre og oppdrag (ADR 0011, A252). Den
 * felles funksjonen `diffBooking` lager `{ fields, values: { felt: { from, to } } }` til
 * revisjonsloggen for både ordren (`updateOrder`) og oppdraget (`updateAssignmentBooking`), slik
 * at Ståles svar på spørsmål 79 (verdier i revisjonsloggen) rettes ett sted.
 *
 * Personvern: input, raden, endringene og Zod-feilen sendes aldri til `logger`, og ingen feil som
 * kastes her har verdier i meldingen. Hendelsen får bare id og feltkoder. Gamle og nye verdier
 * står bare i revisjonsloggen under `values` (A252, spørsmål 79). Bestilleren står som id.
 */

/** Verdien til ett bestillingsfelt. */
export type BookingFieldValue = Date | string | boolean | null;

/** Alle bestillingsfeltene som kan endres, slik de er lagret (samme kolonner på ordre og oppdrag). */
export type BookingSnapshot = {
  receivedAt: Date;
  externalRef: string | null;
  orderedByText: string | null;
  orderedByContactId: string | null;
  orderedByFirmId: string | null;
  addressText: string;
  gnr: string | null;
  bnr: string | null;
  snr: string | null;
  housingAssociationName: string | null;
  sellerDeclarationReceived: boolean;
};

/** Typen har nøyaktig feltene i `BOOKING_EDITABLE_FIELDS` (sjekkes av TypeScript). */
type SameKeys<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : false
  : false;
const snapshotMatchesFieldList: SameKeys<
  BookingSnapshot,
  Record<BookingEditableField, unknown>
> = true;
void snapshotMatchesFieldList;

type LoggedValue = string | boolean | null;

/** Endringene slik de står i revisjonsloggen (`changes`). Bare endrede felt er med. */
export type BookingChanges = {
  fields: BookingEditableField[];
  values: Partial<Record<BookingEditableField, { from: LoggedValue; to: LoggedValue }>>;
};

/** Verdien slik den sammenlignes og lagres i loggen: datoer som ISO-tekst. */
function comparable(value: BookingFieldValue): LoggedValue {
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Sammenligner gammel og ny bestilling og gir feltkodene som er endret og verdiene før og etter,
 * i fast rekkefølge (`BOOKING_EDITABLE_FIELDS`). Tom `fields` betyr ingen endring.
 */
export function diffBooking(before: BookingSnapshot, next: BookingSnapshot): BookingChanges {
  const fields: BookingEditableField[] = [];
  const values: BookingChanges["values"] = {};
  for (const field of BOOKING_EDITABLE_FIELDS) {
    const from = comparable(before[field]);
    const to = comparable(next[field]);
    if (from === to) continue;
    fields.push(field);
    values[field] = { from, to };
  }
  return { fields, values };
}

/**
 * Skjemaet viser «Mottatt» med hele minutter. Har raden sekunder (satt til «nå» ved oppretting,
 * eller fra e-post), skal en lagring med samme minutt ikke telle som endring.
 */
function sameMinute(stored: Date, submitted: Date): boolean {
  return (
    submitted.getTime() % 60_000 === 0 &&
    Math.floor(stored.getTime() / 60_000) === submitted.getTime() / 60_000
  );
}

/** Tom «Mottatt» ved endring betyr uendret (ved oppretting betyr den «nå»). */
export function isEmptyReceivedAt(input: Pick<BookingInput, "receivedAt">): boolean {
  const value = input.receivedAt;
  return value === null || value === undefined || value === "";
}

/**
 * De nye verdiene etter skjemaet. Tom «Mottatt» og samme minutt som lagret gir den lagrede
 * verdien. Firmaet kommer fra kontakten (`orderedByFirmId`), aldri fra skjemaet.
 */
export function nextBooking(
  before: BookingSnapshot,
  parsed: BookingValues,
  options: { keepReceivedAt: boolean; orderedByFirmId: string | null },
): BookingSnapshot {
  return {
    receivedAt:
      options.keepReceivedAt || sameMinute(before.receivedAt, parsed.receivedAt)
        ? before.receivedAt
        : parsed.receivedAt,
    externalRef: parsed.externalRef,
    orderedByText: parsed.orderedByText,
    orderedByContactId: parsed.orderedByContactId,
    orderedByFirmId: options.orderedByFirmId,
    addressText: parsed.addressText,
    gnr: parsed.gnr,
    bnr: parsed.bnr,
    snr: parsed.snr,
    housingAssociationName: parsed.housingAssociationName,
    sellerDeclarationReceived: parsed.sellerDeclarationReceived,
  };
}

/**
 * Firmaet til bestilleren, slått opp i transaksjonen med `organizationId` fra tilgangssjekken.
 * Ingen kontakt gir `null`. Fremmed, ukjent eller slettet kontakt gir `ContactNotFoundError`.
 */
export async function firmForContact(
  tx: DbExecutor,
  organizationId: string,
  contactId: string | null,
): Promise<string | null> {
  if (contactId === null) return null;
  const contact = await findContactForLink(tx, organizationId, contactId);
  if (!contact) throw new ContactNotFoundError();
  return contact.firmId;
}

/** Kolonnene i bestillingen på oppdraget, i samme form som `BookingSnapshot`. */
const assignmentBookingColumns = {
  receivedAt: assignments.receivedAt,
  externalRef: assignments.externalRef,
  orderedByText: assignments.orderedByText,
  orderedByContactId: assignments.orderedByContactId,
  orderedByFirmId: assignments.orderedByFirmId,
  addressText: assignments.addressText,
  gnr: assignments.gnr,
  bnr: assignments.bnr,
  snr: assignments.snr,
  housingAssociationName: assignments.housingAssociationName,
  sellerDeclarationReceived: assignments.sellerDeclarationReceived,
};

/**
 * Endrer bestillingen på et oppdrag. Kontrakten står i `./contract.ts`. Virker i alle statuser.
 * Kilde, nummer, status, kontor og ordren endres aldri her, og ordren røres ikke.
 */
export const updateAssignmentBooking: UpdateAssignmentBooking = async (
  actor,
  organizationId,
  assignmentId,
  input,
  expectedRowVersion,
  now = new Date(),
) => {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  if (!isUuid(assignmentId)) throw new AccessDeniedError();
  const parsed = bookingInputSchema(now).parse(input);
  const keepReceivedAt = isEmptyReceivedAt(input);

  const result = await db.transaction(async (tx) => {
    const where = and(
      eq(assignments.id, assignmentId),
      eq(assignments.organizationId, grant.organizationId),
      isNull(assignments.deletedAt),
    );
    const [before] = await tx
      .select({
        ...assignmentBookingColumns,
        rowVersion: assignments.rowVersion,
        source: assignments.source,
      })
      .from(assignments)
      .where(where)
      .for("update");
    if (!before) throw new AccessDeniedError();
    if (before.rowVersion !== expectedRowVersion) throw new AssignmentChangedError();

    const orderedByFirmId = await firmForContact(
      tx,
      grant.organizationId,
      parsed.orderedByContactId,
    );
    const next = nextBooking(before, parsed, { keepReceivedAt, orderedByFirmId });
    const { fields, values } = diffBooking(before, next);

    if (fields.length === 0) {
      return { rowVersion: before.rowVersion, source: before.source, booking: before, fields };
    }

    const [row] = await tx
      .update(assignments)
      .set({ ...next, updatedBy: grant.employeeId })
      .where(where)
      .returning({ rowVersion: assignments.rowVersion, source: assignments.source });
    if (!row) throw new AccessDeniedError();

    await recordAuditEvent(tx, grant, {
      entityType: "assignment",
      entityId: assignmentId,
      action: "update",
      // Bestilleren som id-er, aldri navn. Verdiene samlet under `values` (A252).
      changes: { fields, values },
    });
    await recordEvent(tx, grant, {
      type: "assignment.booking_updated",
      assignmentId,
      data: { assignmentId, fields },
    });
    return { rowVersion: row.rowVersion, source: row.source, booking: next, fields };
  });

  const { contacts: contactNames, firms: firmNames } = await lookupContactAndFirmNames(grant, {
    contactIds:
      result.booking.orderedByContactId === null ? [] : [result.booking.orderedByContactId],
    firmIds: result.booking.orderedByFirmId === null ? [] : [result.booking.orderedByFirmId],
  });
  const booking = toAssignmentBooking(result.booking, result.source, contactNames, firmNames);
  return {
    id: assignmentId,
    rowVersion: result.rowVersion,
    booking,
    fields: result.fields,
  } satisfies UpdateAssignmentBookingResult;
};

/** Bestillingen i formen skjermen viser (`AssignmentBooking`), med navn i stedet for id-er. */
function toAssignmentBooking(
  booking: BookingSnapshot,
  source: string,
  contactNames: Map<string, string>,
  firmNames: Map<string, string>,
): AssignmentBooking {
  const contactId = booking.orderedByContactId;
  const firmId = booking.orderedByFirmId;
  return {
    ...booking,
    source: source as BookingSource,
    orderedByContactName: contactId === null ? null : (contactNames.get(contactId) ?? null),
    orderedByFirmName: firmId === null ? null : (firmNames.get(firmId) ?? null),
  };
}
