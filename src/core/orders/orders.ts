import { and, desc, eq, isNull } from "drizzle-orm";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import { nextAssignmentNumber } from "@/core/assignments";
import { recordAuditEvent } from "@/core/audit";
import { ContactNotFoundError, findContactForLink } from "@/core/contacts";
import { recordEvent } from "@/core/events";
import { db, type DbExecutor } from "@/db/client";
import { assignments, offices, orders } from "@/db/schema";
import { todayInOslo } from "@/shared/lib/dates";
import { isUuid } from "@/shared/lib/uuid";
import { ORDER_EDITABLE_FIELDS, type OrderEditableField, type OrderSource } from "./codes";
import { OfficeNotFoundError, OrderAlreadyHandledError, OrderChangedError } from "./errors";
import {
  orderInputSchema,
  orderUpdateSchema,
  rejectReasonSchema,
  type OrderInput,
  type OrderUpdateInput,
} from "./schemas";

/*
 * Ordre (docs/05-domenemodell.md 4.3). Se med `organization.read`, legge inn, avvise og gjøre om
 * med `assignment.edit` (A53). All filtrering bruker `grant.organizationId` fra tilgangssjekken,
 * aldri parameteren. Fremmed, ukjent, slettet eller ugyldig ordre-id gir `AccessDeniedError`.
 *
 * Hendelser og revisjonslogg skrives i samme transaksjon som endringen. Hendelsene og
 * applikasjonsloggen får aldri adresse, bestiller, matrikkel, borettslag eller ekstern referanse;
 * bare id-er og feltkoder. Revisjonsloggen får heller ikke verdiene ved oppretting, avvisning og
 * gjøre om. Unntaket er endring (`update`, T1): der står gammel og ny verdi for hvert endret felt
 * under `values` (A252, spørsmål 78 til Ståle før ekte data). Raden er kilden.
 */

const MANUAL_SOURCE: OrderSource = "manual";
const REQUESTED_REPORT_TYPE = "condition_report";

/**
 * Oppdragsnummeret hentes med én left join. Joinen filtrerer på organisasjonen fra
 * tilgangssjekken; den sammensatte fremmednøkkelen sikrer i tillegg at en ordre aldri peker på
 * et oppdrag i en annen organisasjon. Et slettet oppdrag viser fortsatt nummeret, fordi ordren
 * står som gjort om.
 */
function assignmentJoin(organizationId: string) {
  return and(
    eq(assignments.id, orders.assignmentId),
    eq(assignments.organizationId, organizationId),
  );
}

/**
 * Ordrene i organisasjonen som ikke er slettet, nyeste mottatt først. Fast feltliste, ingen
 * sporingsfelt.
 */
export async function listOrders(actor: Actor, organizationId: string) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  const rows = await db
    .select({
      id: orders.id,
      receivedAt: orders.receivedAt,
      source: orders.source,
      externalRef: orders.externalRef,
      orderedByText: orders.orderedByText,
      addressText: orders.addressText,
      status: orders.status,
      assignmentId: orders.assignmentId,
      assignmentNumber: assignments.number,
      assignmentDeletedAt: assignments.deletedAt,
    })
    .from(orders)
    .leftJoin(assignments, assignmentJoin(grant.organizationId))
    .where(and(eq(orders.organizationId, grant.organizationId), isNull(orders.deletedAt)))
    .orderBy(desc(orders.receivedAt), desc(orders.id));
  // T-0031: kansellert oppdrag vises som på ordresiden. Uten oppdrag: false.
  return rows.map(({ assignmentDeletedAt, ...order }) => ({
    ...order,
    assignmentCancelled: assignmentDeletedAt !== null,
  }));
}

/**
 * Én ordre med alle feltene, oppdragsnummeret og `rowVersion` (skjemaet for endring sender den
 * tilbake, A253). Ingen andre sporingsfelt. `null` når ordren ikke finnes i organisasjonen.
 */
async function selectOrder(executor: DbExecutor, organizationId: string, orderId: string) {
  const [row] = await executor
    .select({
      id: orders.id,
      receivedAt: orders.receivedAt,
      source: orders.source,
      externalRef: orders.externalRef,
      orderedByText: orders.orderedByText,
      orderedByContactId: orders.orderedByContactId,
      orderedByFirmId: orders.orderedByFirmId,
      addressText: orders.addressText,
      requestedReportType: orders.requestedReportType,
      gnr: orders.gnr,
      bnr: orders.bnr,
      snr: orders.snr,
      housingAssociationName: orders.housingAssociationName,
      sellerDeclarationReceived: orders.sellerDeclarationReceived,
      status: orders.status,
      rejectedReason: orders.rejectedReason,
      assignmentId: orders.assignmentId,
      assignmentNumber: assignments.number,
      assignmentDeletedAt: assignments.deletedAt,
      rowVersion: orders.rowVersion,
    })
    .from(orders)
    .leftJoin(assignments, assignmentJoin(organizationId))
    .where(
      and(
        eq(orders.id, orderId),
        eq(orders.organizationId, organizationId),
        isNull(orders.deletedAt),
      ),
    );
  if (!row) return null;
  // Kansellert oppdrag (myk sletting, A76): nummeret vises fortsatt, uten lenke. Uten oppdrag: false.
  const { assignmentDeletedAt, ...order } = row;
  return { ...order, assignmentCancelled: assignmentDeletedAt !== null };
}

/** Én ordre med alle feltene, oppdragsnummeret og `rowVersion`. */
export async function getOrder(actor: Actor, organizationId: string, orderId: string) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  if (!isUuid(orderId)) throw new AccessDeniedError();
  const order = await selectOrder(db, grant.organizationId, orderId);
  if (!order) throw new AccessDeniedError();
  return order;
}

/** Verdien slik den lagres i `values` i revisjonsloggen: tom tekst er `null`, dato som ISO. */
type AuditValue = string | boolean | null;

function toAuditValue(value: string | boolean | Date | null | undefined): AuditValue {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value.trim() === "" ? null : value;
  return value ?? null;
}

/** Normalisert sammenligning: tom tekst = `null`, dato på millisekund. */
function sameValue(a: string | boolean | Date | null, b: string | boolean | Date | null) {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return toAuditValue(a) === toAuditValue(b);
}

/**
 * Endrer feltene på en lagret ordre (T1, «full redigeringstilgang. alltid»), i alle statuser:
 * mottatt, gjort om og avvist (A250). Krever `assignment.edit` (A249).
 *
 * - Bare feltene i `ORDER_EDITABLE_FIELDS` skrives. Status, avvisningsgrunn, oppdrag, kilde og
 *   ønsket rapport endres aldri, og oppdraget endres ikke (A251).
 * - Tom mottatt beholder verdien; tomme valgfrie felt tømmes; adressen kan ikke tømmes.
 * - Firmaet utledes bare fra kontakten (aldri fra skjemaet). Ny kontakt som er fremmed, ukjent
 *   eller slettet gir `ContactNotFoundError`. Uendret kontakt slås ikke opp på nytt, slik at en
 *   ordre med en kontakt som senere er fjernet fortsatt kan endres.
 * - `expectedRowVersion` er `rowVersion` fra `getOrder` da skjemaet ble åpnet. Er raden endret
 *   siden, gir det `OrderChangedError` (A253).
 * - Ingen endring: ingen oppdatering, ingen loggrad, ingen hendelse.
 * - Revisjonsloggen får `fields` (feltkoder i fast rekkefølge) og `values` (gammel og ny verdi,
 *   bestiller og firma som id). Hendelsen `order.updated` får bare `orderId` og `fields`.
 * - Ingen KI-kall. Verdiene sendes aldri til applikasjonsloggen.
 */
export async function updateOrder(
  actor: Actor,
  organizationId: string,
  orderId: string,
  input: OrderUpdateInput,
  expectedRowVersion: number,
  now: Date = new Date(),
) {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  if (!isUuid(orderId)) throw new AccessDeniedError();
  const values = orderUpdateSchema(now).parse(input);

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

    // Firmaet følger kontakten. Uendret kontakt: firmaet står som det er.
    let orderedByFirmId = before.orderedByFirmId;
    if (values.orderedByContactId === null) {
      orderedByFirmId = null;
    } else if (values.orderedByContactId !== before.orderedByContactId) {
      const contact = await findContactForLink(tx, grant.organizationId, values.orderedByContactId);
      if (!contact) throw new ContactNotFoundError();
      orderedByFirmId = contact.firmId;
    }

    const next: Record<OrderEditableField, string | boolean | Date | null> = {
      receivedAt: values.receivedAt ?? before.receivedAt,
      externalRef: values.externalRef,
      orderedByText: values.orderedByText,
      orderedByContactId: values.orderedByContactId,
      orderedByFirmId,
      addressText: values.addressText,
      gnr: values.gnr,
      bnr: values.bnr,
      snr: values.snr,
      housingAssociationName: values.housingAssociationName,
      sellerDeclarationReceived: values.sellerDeclarationReceived,
    };

    const fields = ORDER_EDITABLE_FIELDS.filter((field) => !sameValue(before[field], next[field]));
    if (fields.length === 0) {
      const unchanged = await selectOrder(tx, grant.organizationId, orderId);
      if (!unchanged) throw new AccessDeniedError();
      return unchanged;
    }

    const changedValues: Partial<Record<OrderEditableField, { from: AuditValue; to: AuditValue }>> =
      {};
    const set: Partial<typeof orders.$inferInsert> = {};
    for (const field of fields) {
      changedValues[field] = { from: toAuditValue(before[field]), to: toAuditValue(next[field]) };
      Object.assign(set, { [field]: next[field] });
    }

    const [updated] = await tx
      .update(orders)
      .set({ ...set, rowVersion: before.rowVersion + 1, updatedBy: grant.employeeId })
      .where(where)
      .returning({ id: orders.id });
    if (!updated) throw new AccessDeniedError();

    await recordAuditEvent(tx, grant, {
      entityType: "order",
      entityId: updated.id,
      action: "update",
      changes: { fields, values: changedValues },
    });
    await recordEvent(tx, grant, {
      type: "order.updated",
      data: { orderId: updated.id, fields },
    });

    const order = await selectOrder(tx, grant.organizationId, orderId);
    if (!order) throw new AccessDeniedError();
    return order;
  });
}

/**
 * Legger inn en ordre fra e-posten (`source = manual`, `status = received`). `now` kan sendes
 * inn i tester; mottatt kan ikke være etter `now`. Bestilleren kan kobles til en kontakt i
 * registeret (`orderedByContactId`); firmaet følger kontakten. Fremmed, ukjent eller slettet
 * kontakt gir `ContactNotFoundError`, og ingenting lagres.
 */
export async function createOrder(
  actor: Actor,
  organizationId: string,
  input: OrderInput,
  now: Date = new Date(),
) {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  const values = orderInputSchema(now).parse(input);

  return db.transaction(async (tx) => {
    let orderedByFirmId: string | null = null;
    if (values.orderedByContactId !== null) {
      const contact = await findContactForLink(tx, grant.organizationId, values.orderedByContactId);
      if (!contact) throw new ContactNotFoundError();
      orderedByFirmId = contact.firmId;
    }

    const [row] = await tx
      .insert(orders)
      .values({
        ...values,
        orderedByFirmId,
        organizationId: grant.organizationId,
        source: MANUAL_SOURCE,
        requestedReportType: REQUESTED_REPORT_TYPE,
        status: "received",
        createdBy: grant.employeeId,
      })
      .returning();
    if (!row) throw new Error("Fant ikke ordren etter at den ble lagret. Prøv igjen.");

    await recordEvent(tx, grant, {
      type: "order.received",
      data: { orderId: row.id, source: row.source },
    });
    await recordAuditEvent(tx, grant, {
      entityType: "order",
      entityId: row.id,
      action: "create",
      changes: {
        status: row.status,
        source: row.source,
        requestedReportType: row.requestedReportType,
        // Bare id-er, og bare når bestilleren er koblet (uten kobling er raden som før)
        ...(row.orderedByContactId === null
          ? {}
          : { orderedByContactId: row.orderedByContactId, orderedByFirmId: row.orderedByFirmId }),
      },
    });
    return row;
  });
}

/** Avviser en mottatt ordre med grunn (A55). Ordren blir stående i listen. */
export async function rejectOrder(
  actor: Actor,
  organizationId: string,
  orderId: string,
  reason: string,
) {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  const rejectedReason = rejectReasonSchema.parse(reason);
  if (!isUuid(orderId)) throw new AccessDeniedError();

  return db.transaction(async (tx) => {
    const where = and(
      eq(orders.id, orderId),
      eq(orders.organizationId, grant.organizationId),
      isNull(orders.deletedAt),
    );
    const [before] = await tx
      .select({ id: orders.id, status: orders.status, rowVersion: orders.rowVersion })
      .from(orders)
      .where(where)
      .for("update");
    if (!before) throw new AccessDeniedError();
    if (before.status !== "received") throw new OrderAlreadyHandledError();

    // `row_version` økes, så et åpent endringsskjema får `OrderChangedError` (A253)
    const [row] = await tx
      .update(orders)
      .set({
        status: "rejected",
        rejectedReason,
        rowVersion: before.rowVersion + 1,
        updatedBy: grant.employeeId,
      })
      .where(where)
      .returning();
    if (!row) throw new AccessDeniedError();

    await recordEvent(tx, grant, { type: "order.rejected", data: { orderId: row.id } });
    await recordAuditEvent(tx, grant, {
      entityType: "order",
      entityId: row.id,
      action: "reject",
      changes: { status: { from: before.status, to: row.status }, rejectedReason },
    });
    return row;
  });
}

type ConvertOptions = {
  officeId: string;
  /** Tiden som avgjør året i nummeret (norsk tid). Standard: nå. */
  now?: Date;
};

/**
 * Gjør en mottatt ordre om til et oppdrag med nytt nummer (`2026-00001`). Rekkefølgen er fast:
 * ordreraden låses først (`FOR UPDATE`), så sjekkes status og kontor, og først da hentes
 * nummeret. Slik får to samtidige forsøk på samme ordre ett oppdrag, og taperen bruker ikke opp
 * et nummer.
 */
export async function convertOrderToAssignment(
  actor: Actor,
  organizationId: string,
  orderId: string,
  { officeId, now = new Date() }: ConvertOptions,
) {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  if (!isUuid(orderId)) throw new AccessDeniedError();

  return db.transaction(async (tx) => {
    // (1) Lås ordreraden, filtrert på organisasjonen og ikke slettet
    const orderWhere = and(
      eq(orders.id, orderId),
      eq(orders.organizationId, grant.organizationId),
      isNull(orders.deletedAt),
    );
    const [before] = await tx
      .select({ id: orders.id, status: orders.status, rowVersion: orders.rowVersion })
      .from(orders)
      .where(orderWhere)
      .for("update");
    if (!before) throw new AccessDeniedError();

    // (2) Bare fra mottatt
    if (before.status !== "received") throw new OrderAlreadyHandledError();

    // (3) Kontoret finnes i organisasjonen og er ikke slettet
    if (!isUuid(officeId)) throw new OfficeNotFoundError();
    const [office] = await tx
      .select({ id: offices.id })
      .from(offices)
      .where(
        and(
          eq(offices.id, officeId),
          eq(offices.organizationId, grant.organizationId),
          isNull(offices.deletedAt),
        ),
      );
    if (!office) throw new OfficeNotFoundError();

    // (4) Neste nummer, med lås i databasen
    const number = await nextAssignmentNumber(tx, grant, todayInOslo(now));

    // (5) Oppdraget
    const [assignment] = await tx
      .insert(assignments)
      .values({
        organizationId: grant.organizationId,
        number,
        officeId: office.id,
        orderId: before.id,
        assignmentType: "condition_report",
        status: "ordered",
        createdBy: grant.employeeId,
      })
      .returning({
        id: assignments.id,
        number: assignments.number,
        officeId: assignments.officeId,
        status: assignments.status,
        orderId: assignments.orderId,
      });
    if (!assignment) throw new Error("Fant ikke oppdraget etter at det ble lagret. Prøv igjen.");

    // (6) Ordren peker på oppdraget. `row_version` økes, så et åpent endringsskjema får
    // `OrderChangedError` (A253).
    const [order] = await tx
      .update(orders)
      .set({
        status: "converted",
        assignmentId: assignment.id,
        rowVersion: before.rowVersion + 1,
        updatedBy: grant.employeeId,
      })
      .where(orderWhere)
      .returning();
    if (!order) throw new AccessDeniedError();

    // (7) Hendelse og revisjonslogg
    await recordEvent(tx, grant, {
      type: "assignment.created",
      assignmentId: assignment.id,
      data: { number, orderId: order.id },
    });
    await recordAuditEvent(tx, grant, {
      entityType: "order",
      entityId: order.id,
      action: "convert",
      changes: {
        status: { from: before.status, to: order.status },
        assignmentId: assignment.id,
        number,
      },
    });
    await recordAuditEvent(tx, grant, {
      entityType: "assignment",
      entityId: assignment.id,
      action: "create",
      changes: { number, status: assignment.status, officeId: assignment.officeId },
    });

    return { assignment, order };
  });
}
