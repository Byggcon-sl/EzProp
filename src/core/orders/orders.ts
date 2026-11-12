import { and, desc, eq, isNull } from "drizzle-orm";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import { nextAssignmentNumber } from "@/core/assignments";
import { recordAuditEvent } from "@/core/audit";
import { ContactNotFoundError, findContactForLink } from "@/core/contacts";
import { recordEvent } from "@/core/events";
import { db, type DbExecutor } from "@/db/client";
import { assignments, auditLog, employees, offices, orders } from "@/db/schema";
import { todayInOslo } from "@/shared/lib/dates";
import { isUuid } from "@/shared/lib/uuid";
import { ORDER_EDITABLE_FIELDS, type OrderEditableField, type OrderSource } from "./codes";
import { OfficeNotFoundError, OrderAlreadyHandledError, OrderChangedError } from "./errors";
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
 * Én ordre med alle feltene og oppdragsnummeret. Ingen sporingsfelt; `rowVersion` er med for
 * versjonssjekken ved retting.
 */
export async function getOrder(actor: Actor, organizationId: string, orderId: string) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  if (!isUuid(orderId)) throw new AccessDeniedError();
  return findOrder(db, grant.organizationId, orderId);
}

/**
 * Leser én ordre i formen `getOrder` gir. Sjekker ikke tilgang selv: `organizationId` skal komme
 * fra tilgangssjekken (`grant.organizationId`) hos den som kaller. Ukjent eller slettet ordre gir
 * `AccessDeniedError`.
 */
async function findOrder(executor: DbExecutor, organizationId: string, orderId: string) {
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

/** Lik verdi i databasen og i skjemaet: datoer på tidspunkt, ellers `===`. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

/**
 * Retter en lagret ordre (T1, A249–A253): de samme feltene som på «Ny ordre», i alle statuser
 * (mottatt, gjort om og avvist). Status, avvisningsgrunn, oppdragskobling, kilde og ønsket rapport
 * endres aldri her, og oppdraget røres ikke (A251). Firmaet følger kontakten, som ved oppretting.
 *
 * `expectedRowVersion` er `rowVersion` fra `getOrder` da skjemaet ble åpnet. Er den ikke lik
 * versjonen i databasen, gir det `OrderChangedError` og ingenting endres (A253). Mangler mottatt
 * i skjemaet, beholdes lagret verdi. Ingen endring gir ingen lagring, logg eller hendelse.
 *
 * Revisjonsloggen og hendelsen `order.updated` får bare feltkodene (`changedFields`), aldri
 * verdiene (A252).
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

  const changedFields = await db.transaction(async (tx) => {
    const where = and(
      eq(orders.id, orderId),
      eq(orders.organizationId, grant.organizationId),
      isNull(orders.deletedAt),
    );
    const [before] = await tx
      .select({
        rowVersion: orders.rowVersion,
        addressText: orders.addressText,
        receivedAt: orders.receivedAt,
        orderedByContactId: orders.orderedByContactId,
        orderedByFirmId: orders.orderedByFirmId,
        orderedByText: orders.orderedByText,
        externalRef: orders.externalRef,
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

    // Skjemaet valideres før noe skrives. Tom mottatt beholder lagret verdi, ikke `now`.
    const received = input.receivedAt;
    const values = orderInputSchema(now).parse(
      received === undefined || received === null || received === ""
        ? { ...input, receivedAt: before.receivedAt }
        : input,
    );

    if (!Number.isInteger(expectedRowVersion) || before.rowVersion !== expectedRowVersion) {
      throw new OrderChangedError();
    }

    let orderedByFirmId = before.orderedByFirmId;
    if (values.orderedByContactId !== before.orderedByContactId) {
      if (values.orderedByContactId === null) {
        orderedByFirmId = null;
      } else {
        const contact = await findContactForLink(
          tx,
          grant.organizationId,
          values.orderedByContactId,
        );
        if (!contact) throw new ContactNotFoundError();
        orderedByFirmId = contact.firmId;
      }
    }

    const changed: OrderEditableField[] = ORDER_EDITABLE_FIELDS.filter(
      (field) => !sameValue(values[field], before[field]),
    );
    if (changed.length === 0) return changed;

    const [row] = await tx
      .update(orders)
      .set({
        addressText: values.addressText,
        receivedAt: values.receivedAt,
        orderedByContactId: values.orderedByContactId,
        orderedByFirmId,
        orderedByText: values.orderedByText,
        externalRef: values.externalRef,
        gnr: values.gnr,
        bnr: values.bnr,
        snr: values.snr,
        housingAssociationName: values.housingAssociationName,
        sellerDeclarationReceived: values.sellerDeclarationReceived,
        updatedBy: grant.employeeId,
      })
      .where(where)
      .returning({ id: orders.id });
    if (!row) throw new AccessDeniedError();

    // Bare feltkodene, aldri verdiene (A252)
    await recordEvent(tx, grant, {
      type: "order.updated",
      data: { orderId: row.id, changedFields: changed },
    });
    await recordAuditEvent(tx, grant, {
      entityType: "order",
      entityId: row.id,
      action: "update",
      changes: { changedFields: changed },
    });
    return changed;
  });

  const order = await findOrder(db, grant.organizationId, orderId);
  return { ...order, changedFields: changedFields as string[] };
}

/** `changedFields` fra en loggrad, bare når det er en liste med tekst. Ellers `null`. */
function changedFieldsOf(changes: Record<string, unknown>): string[] | null {
  const value = changes.changedFields;
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as string[])
    : null;
}

/**
 * Endringsloggen til én ordre: alle rader i revisjonsloggen (opprettet, rettet, avvist, gjort om),
 * nyeste først. Navnet på den ansatte kommer med left join i samme organisasjon, som i
 * `listAuditEvents`; rader uten ansatt får `actorName = null`. Gir aldri `changes` rått, bare
 * feltkodene for rettinger.
 */
export async function listOrderHistory(actor: Actor, organizationId: string, orderId: string) {
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

  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      changes: auditLog.changes,
      actorName: employees.name,
      createdAt: auditLog.occurredAt,
    })
    .from(auditLog)
    .leftJoin(
      employees,
      and(
        eq(employees.id, auditLog.actorEmployeeId),
        eq(employees.organizationId, grant.organizationId),
      ),
    )
    .where(
      and(
        eq(auditLog.organizationId, grant.organizationId),
        eq(auditLog.entityType, "order"),
        eq(auditLog.entityId, order.id),
      ),
    )
    .orderBy(desc(auditLog.occurredAt), desc(auditLog.id));

  return rows.map(({ changes, ...row }) => ({
    id: row.id,
    action: row.action,
    changedFields: changedFieldsOf(changes),
    actorName: row.actorName,
    createdAt: row.createdAt,
  }));
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
