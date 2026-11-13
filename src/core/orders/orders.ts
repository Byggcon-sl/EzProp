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
import { orderInputSchema, rejectReasonSchema, type OrderInput } from "./schemas";

/*
 * Ordre (docs/05-domenemodell.md 4.3). Se med `organization.read`, legge inn, endre, avvise og
 * gjøre om med `assignment.edit` (A53, A249). All filtrering bruker `grant.organizationId` fra
 * tilgangssjekken, aldri parameteren. Fremmed, ukjent, slettet eller ugyldig ordre-id gir
 * `AccessDeniedError`.
 *
 * Hendelser og revisjonslogg skrives i samme transaksjon som endringen. Hendelsene og
 * applikasjonsloggen får aldri adresse, bestiller, matrikkel, borettslag eller ekstern
 * referanse. I revisjonsloggen er `update` den eneste ordrehandlingen med verdier: gammel og ny
 * verdi per endret felt står samlet under `changes.values` (A252, spørsmål 78), slik at de kan
 * tømmes ett sted. Oppretting, avvisning og konvertering har ingen verdier. Raden er kilden.
 *
 * `row_version` øker ved hver endring av raden (også avvisning og konvertering), via
 * `$onUpdate` i `baseColumns`. `updateOrder` bruker den til å stoppe lagring over en nyere
 * endring (A253).
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
  return db
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
    })
    .from(orders)
    .leftJoin(assignments, assignmentJoin(grant.organizationId))
    .where(and(eq(orders.organizationId, grant.organizationId), isNull(orders.deletedAt)))
    .orderBy(desc(orders.receivedAt), desc(orders.id));
}

/**
 * Én ordre med alle feltene, oppdragsnummeret og `rowVersion`. `rowVersion` sendes med når
 * ordren endres (`updateOrder`), slik at en lagring over en nyere endring stoppes (A253). Ingen
 * andre sporingsfelt.
 */
export async function getOrder(actor: Actor, organizationId: string, orderId: string) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  if (!isUuid(orderId)) throw new AccessDeniedError();
  const order = await selectOrder(db, grant.organizationId, orderId);
  if (!order) throw new AccessDeniedError();
  return order;
}

/** Ordren i formen `getOrder` gir. `organizationId` er alltid fra tilgangssjekken. */
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

type OrderFieldValues = Record<OrderEditableField, string | boolean | Date | null>;
/** Verdien slik den lagres i revisjonsloggen: dato som ISO-tekst, tom tekst som `null`. */
type AuditValue = string | boolean | null;

function auditValue(value: string | boolean | Date | null): AuditValue {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  return value;
}

/** Tom mottatt-dato i skjemaet betyr «behold den lagrede» ved endring (ikke «nå»). */
function isEmptyReceivedAt(value: OrderInput["receivedAt"]): boolean {
  return value === null || value === undefined || value === "";
}

/**
 * Endrer feltene på en lagret ordre (T1, Ståle 12.11.2026: «full redigeringstilgang. alltid»),
 * i alle statuser: mottatt, gjort om og avvist (A250). Bare feltene i `ORDER_EDITABLE_FIELDS`
 * kan endres; status, avvisningsgrunn, oppdrag, kilde og ønsket rapport skrives aldri, og
 * oppdraget røres ikke (A251).
 *
 * `expectedRowVersion` er `rowVersion` fra `getOrder` da skjemaet ble åpnet. Er ordren endret
 * siden, gir det `OrderChangedError` og ingenting endres (A253). Lagring uten endring gir ingen
 * loggrad, ingen hendelse og samme `rowVersion`. Tom mottatt-dato beholder den lagrede.
 *
 * Bestilleren: firmaet følger kontakten, som ved oppretting. Fremmed, ukjent eller slettet
 * kontakt gir `ContactNotFoundError`. Er kontakten den samme som før og er slettet siden, står
 * kontakten og firmaet som før, slik at andre felt fortsatt kan endres.
 *
 * Applikasjonsloggen får aldri verdier fra skjemaet eller raden (funksjonen logger ingenting).
 * Returnerer ordren i samme form som `getOrder`.
 */
export async function updateOrder(
  actor: Actor,
  organizationId: string,
  orderId: string,
  input: OrderInput,
  expectedRowVersion: number,
) {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  if (!isUuid(orderId)) throw new AccessDeniedError();
  const now = new Date();
  const values = orderInputSchema(now).parse(input);
  const keepReceivedAt = isEmptyReceivedAt(input.receivedAt);

  return db.transaction(async (tx) => {
    const where = and(
      eq(orders.id, orderId),
      eq(orders.organizationId, grant.organizationId),
      isNull(orders.deletedAt),
    );
    const [before] = await tx.select().from(orders).where(where).for("update");
    if (!before) throw new AccessDeniedError();
    if (before.rowVersion !== expectedRowVersion) throw new OrderChangedError();

    let orderedByContactId: string | null = null;
    let orderedByFirmId: string | null = null;
    if (values.orderedByContactId !== null) {
      const contact = await findContactForLink(tx, grant.organizationId, values.orderedByContactId);
      if (contact) {
        orderedByContactId = contact.id;
        orderedByFirmId = contact.firmId;
      } else if (values.orderedByContactId === before.orderedByContactId) {
        orderedByContactId = before.orderedByContactId;
        orderedByFirmId = before.orderedByFirmId;
      } else {
        throw new ContactNotFoundError();
      }
    }

    const next: OrderFieldValues = {
      receivedAt: keepReceivedAt ? before.receivedAt : values.receivedAt,
      externalRef: values.externalRef,
      orderedByText: values.orderedByText,
      orderedByContactId,
      orderedByFirmId,
      addressText: values.addressText,
      gnr: values.gnr,
      bnr: values.bnr,
      snr: values.snr,
      housingAssociationName: values.housingAssociationName,
      sellerDeclarationReceived: values.sellerDeclarationReceived,
    };

    // Endrede felt i fast rekkefølge, med gammel og ny verdi
    const fields: OrderEditableField[] = [];
    const changes: Partial<Record<OrderEditableField, { from: AuditValue; to: AuditValue }>> = {};
    for (const field of ORDER_EDITABLE_FIELDS) {
      const from = auditValue(before[field]);
      const to = auditValue(next[field]);
      if (from === to) continue;
      fields.push(field);
      changes[field] = { from, to };
    }

    if (fields.length > 0) {
      const set: Partial<typeof orders.$inferInsert> = { updatedBy: grant.employeeId };
      for (const field of fields) Object.assign(set, { [field]: next[field] });
      const updated = await tx
        .update(orders)
        .set({ ...set, updatedAt: now })
        .where(and(where, eq(orders.rowVersion, expectedRowVersion)))
        .returning({ id: orders.id });
      if (updated.length === 0) throw new OrderChangedError();

      await recordAuditEvent(tx, grant, {
        entityType: "order",
        entityId: before.id,
        action: "update",
        changes: { fields, values: changes },
        occurredAt: now,
      });
      await recordEvent(tx, grant, {
        type: "order.updated",
        data: { orderId: before.id, fields },
      });
    }

    const order = await selectOrder(tx, grant.organizationId, before.id);
    if (!order) throw new AccessDeniedError();
    return order;
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
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(where)
      .for("update");
    if (!before) throw new AccessDeniedError();
    if (before.status !== "received") throw new OrderAlreadyHandledError();

    const [row] = await tx
      .update(orders)
      .set({ status: "rejected", rejectedReason, updatedBy: grant.employeeId })
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
      .select({ id: orders.id, status: orders.status })
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

    // (6) Ordren peker på oppdraget
    const [order] = await tx
      .update(orders)
      .set({ status: "converted", assignmentId: assignment.id, updatedBy: grant.employeeId })
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
