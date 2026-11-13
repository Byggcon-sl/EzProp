import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import { assignmentFieldsMatch, nextAssignmentNumber, orderFieldsMatch } from "@/core/assignments";
import { recordAuditEvent } from "@/core/audit";
import { ContactNotFoundError, findContactForLink } from "@/core/contacts";
import { recordEvent } from "@/core/events";
import { db } from "@/db/client";
import { assignments, offices, orders } from "@/db/schema";
import { todayInOslo } from "@/shared/lib/dates";
import { isUuid } from "@/shared/lib/uuid";
import type { OrderSource, OrderStatus } from "./codes";
import { OfficeNotFoundError, OrderAlreadyHandledError } from "./errors";
import { ORDER_LIST_LIMIT, type ListOrders, type OrderListItem } from "./list";
import { orderInputSchema, rejectReasonSchema, type OrderInput } from "./schemas";

/*
 * Ordre (docs/05-domenemodell.md 4.3). Se med `organization.read`, legge inn, avvise og gjøre om
 * med `assignment.edit` (A53). All filtrering bruker `grant.organizationId` fra tilgangssjekken,
 * aldri parameteren. Fremmed, ukjent, slettet eller ugyldig ordre-id gir `AccessDeniedError`.
 *
 * Hendelser og revisjonslogg skrives i samme transaksjon som endringen, og får aldri adresse,
 * bestiller, matrikkel eller borettslag. Raden er kilden.
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
 * Ordrene i organisasjonen som ikke er slettet, nyeste mottatt først, høyst `ORDER_LIST_LIMIT`.
 * Kontrakten står i `./list.ts`. Søket (`options.query`) bruker det samme vilkåret som
 * arbeidskøen (`orderFieldsMatch` og `assignmentFieldsMatch`). Oppdraget er en left join på én
 * rad per ordre, og undertabellene hentes med `EXISTS`, så det blir aldri doble rader. Ordre med
 * kansellert oppdrag er med, også i søket. Søketeksten logges ikke.
 */
export const listOrders: ListOrders = async (actor, organizationId, options = {}) => {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  const query = options.query ?? "";
  const where = and(
    eq(orders.organizationId, grant.organizationId),
    isNull(orders.deletedAt),
    or(orderFieldsMatch(query), assignmentFieldsMatch(grant.organizationId, query)),
  );

  const [rows, [counted]] = await Promise.all([
    db
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
      .where(where)
      .orderBy(desc(orders.receivedAt), desc(orders.id))
      .limit(ORDER_LIST_LIMIT),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .leftJoin(assignments, assignmentJoin(grant.organizationId))
      .where(where),
  ]);

  const items: OrderListItem[] = rows.map((row) => ({
    ...row,
    source: row.source as OrderSource,
    status: row.status as OrderStatus,
  }));
  return { items, total: Number(counted?.count ?? 0) };
};

/** Én ordre med alle feltene og oppdragsnummeret. Ingen sporingsfelt. */
export async function getOrder(actor: Actor, organizationId: string, orderId: string) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  if (!isUuid(orderId)) throw new AccessDeniedError();
  const [row] = await db
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
    })
    .from(orders)
    .leftJoin(assignments, assignmentJoin(grant.organizationId))
    .where(
      and(
        eq(orders.id, orderId),
        eq(orders.organizationId, grant.organizationId),
        isNull(orders.deletedAt),
      ),
    );
  if (!row) throw new AccessDeniedError();
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
