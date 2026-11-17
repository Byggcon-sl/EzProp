import { and, asc, desc, eq, isNull, or, type SQL } from "drizzle-orm";
import {
  AccessDeniedError,
  requireOrganizationAccess,
  type Actor,
  type EmployeeGrant,
} from "@/core/access";
import { assignmentFieldsMatch, nextAssignmentNumber, orderFieldsMatch } from "@/core/assignments";
import { recordAuditEvent } from "@/core/audit";
import { ContactNotFoundError, findContactForLink } from "@/core/contacts";
import { recordEvent } from "@/core/events";
import { db, type DbExecutor } from "@/db/client";
import { assignments, offices, orders } from "@/db/schema";
import { todayInOslo } from "@/shared/lib/dates";
import { isUuid } from "@/shared/lib/uuid";
import {
  OFFER_LIST_FILTERS,
  type OfferListFilter,
  type OrderSource,
  type OrderStatus,
} from "./codes";
import type { OfferRejectionInput } from "./contract";
import { OfficeNotFoundError, OrderAlreadyHandledError } from "./errors";
import { ORDER_LIST_LIMIT, type ListOrders, type OrderListItem } from "./list";
import {
  offerCountSql,
  offerDisplayStatus,
  offerListFilterSql,
  parseOfferListFilter,
} from "./offer-status";
import { orderInputSchema, rejectReasonSchema, type OrderInput } from "./schemas";

/*
 * Ordre, som heter «Tilbud» i grensesnittet (ADR 0012, docs/05-domenemodell.md 4.3). Se med `organization.read`, legge inn, avvise og gjøre om
 * med `assignment.edit` (A53). All filtrering bruker `grant.organizationId` fra tilgangssjekken,
 * aldri parameteren. Fremmed, ukjent, slettet eller ugyldig ordre-id gir `AccessDeniedError`.
 *
 * Ordren kan endres etter lagring i alle statuser, også etter at den er gjort om til oppdrag
 * (`updateOrder` i `update-order.ts`; T1, Ståle 12.11.2026, endrer A55 og A87). Oppdraget endres
 * ikke av det (A251).
 *
 * Hendelser og revisjonslogg skrives i samme transaksjon som endringen. Oppretting, avvisning og
 * konvertering får aldri adresse, bestiller, matrikkel eller borettslag. Endring (`update`) er
 * eneste ordrehandling med gamle og nye verdier, og bare i revisjonsloggen (A252, spørsmål 79).
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
 * Tilbudene i organisasjonen som ikke er slettet, med filter (ADR 0012), søk og antall per filter
 * (F3). Kontrakten står i `./contract.ts` (`ListOffers`). Søket (`options.query`) bruker det samme
 * vilkåret som arbeidskøen (`orderFieldsMatch` og `assignmentFieldsMatch`). Oppdraget er en left
 * join på én rad per tilbud, og undertabellene hentes med `EXISTS`, så det blir aldri doble rader.
 * Tilbud med kansellert oppdrag er med, også i søket. Søketeksten logges ikke.
 *
 * Filteret og tellingen bruker samme uttrykk (`offerListFilterSql`) og samme `today`
 * (`todayInOslo(now)`), så tallet på knappen alltid er antallet i listen.
 */
export const listOrders: ListOrders = async (actor, organizationId, options = {}) => {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  const query = options.query ?? "";
  const status = parseOfferListFilter(options.status);
  const today = todayInOslo(options.now ?? new Date());
  const base = and(
    eq(orders.organizationId, grant.organizationId),
    isNull(orders.deletedAt),
    or(orderFieldsMatch(query), assignmentFieldsMatch(grant.organizationId, query)),
  );
  const where = and(base, offerListFilterSql(status, today));
  const ordering =
    status === "open"
      ? [asc(orders.validUntil), desc(orders.receivedAt), desc(orders.id)]
      : [desc(orders.receivedAt), desc(orders.id)];

  const countColumns = Object.fromEntries(
    OFFER_LIST_FILTERS.map((filter) => [filter, offerCountSql(filter, today)]),
  ) as Record<OfferListFilter, SQL<number>>;

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
        validUntil: orders.validUntil,
        assignmentId: orders.assignmentId,
        assignmentNumber: assignments.number,
        assignmentDeletedAt: assignments.deletedAt,
      })
      .from(orders)
      .leftJoin(assignments, assignmentJoin(grant.organizationId))
      .where(where)
      .orderBy(...ordering)
      .limit(ORDER_LIST_LIMIT),
    db
      .select(countColumns)
      .from(orders)
      .leftJoin(assignments, assignmentJoin(grant.organizationId))
      .where(base),
  ]);

  const counts = Object.fromEntries(
    OFFER_LIST_FILTERS.map((filter) => [filter, Number(counted?.[filter] ?? 0)]),
  ) as Record<OfferListFilter, number>;

  const items: OrderListItem[] = rows.map(({ assignmentDeletedAt, ...row }) => {
    const orderStatus = row.status as OrderStatus;
    return {
      ...row,
      source: row.source as OrderSource,
      status: orderStatus,
      displayStatus: offerDisplayStatus(orderStatus, row.validUntil, today),
      assignmentCancelled: row.assignmentId !== null && assignmentDeletedAt !== null,
    };
  });
  return { items, total: counts[status], status, counts };
};

/**
 * Leser én ordre med alle feltene, oppdragsnummeret og `rowVersion` (versjonen skjemaet for
 * endring sender tilbake, A253). Ingen andre sporingsfelt. Tar `grant` fra tilgangssjekken og
 * filtrerer på `grant.organizationId`, så den kan ikke kalles med en id fra adressen. Gir `null`
 * når ordren ikke finnes i organisasjonen eller er slettet. Intern for `core/orders`: eksporteres
 * ikke fra `index.ts`.
 */
export async function selectOrder(executor: DbExecutor, grant: EmployeeGrant, orderId: string) {
  const organizationId = grant.organizationId;
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
      validUntil: orders.validUntil,
      rejectedReason: orders.rejectedReason,
      rejectedReasonKey: orders.rejectedReasonKey,
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
 * Ett tilbud med alle feltene, oppdragsnummeret og `rowVersion` (til skjemaet for endring), og
 * visningsstatusen regnet med `todayInOslo(now)` (ADR 0012). Ingen andre sporingsfelt.
 */
export async function getOrder(
  actor: Actor,
  organizationId: string,
  orderId: string,
  now: Date = new Date(),
) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  if (!isUuid(orderId)) throw new AccessDeniedError();
  const order = await selectOrder(db, grant, orderId);
  if (!order) throw new AccessDeniedError();
  const today = todayInOslo(now);
  return {
    ...order,
    displayStatus: offerDisplayStatus(order.status as OrderStatus, order.validUntil, today),
  };
}

/**
 * Lager et tilbud (`source = manual`, `status = received`). Kontrakten står i `./contract.ts`
 * (`CreateOffer`). `now` kan sendes inn i tester; mottatt kan ikke være etter `now`. Mangler
 * «Gyldig til», blir den i dag + `OFFER_VALID_DAYS`; ellers må den ligge mellom i dag og ett år
 * fram (A328). Bestilleren kan kobles til en kontakt i
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
    if (!row) throw new Error("Fant ikke tilbudet etter at det ble lagret. Prøv igjen.");

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

/**
 * Avslår et åpent eller utløpt tilbud med fast grunn og eventuell tekst (A55, F4). Kontrakten
 * står i `./contract.ts` (`RejectOffer`). Tilbudet blir stående i listen, og feltene kan fortsatt
 * endres (T1). `row_version` øker, så et åpent endringsskjema får `OrderChangedError`. Hendelsen
 * får koden for grunnen, aldri teksten.
 */
export async function rejectOrder(
  actor: Actor,
  organizationId: string,
  orderId: string,
  input: OfferRejectionInput,
) {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  const { reasonKey, reasonText: rejectedReason } = rejectReasonSchema.parse(input);
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
      .set({
        status: "rejected",
        rejectedReasonKey: reasonKey,
        rejectedReason,
        updatedBy: grant.employeeId,
      })
      .where(where)
      .returning();
    if (!row) throw new AccessDeniedError();

    // Hendelsen får bare id og koden for grunnen, aldri friteksten.
    await recordEvent(tx, grant, {
      type: "order.rejected",
      data: { orderId: row.id, reasonKey },
    });
    await recordAuditEvent(tx, grant, {
      entityType: "order",
      entityId: row.id,
      action: "reject",
      changes: {
        status: { from: before.status, to: row.status },
        rejectedReasonKey: reasonKey,
        rejectedReason,
      },
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
 * Gjør et åpent eller utløpt tilbud om til et oppdrag med nytt nummer (`2026-00001`). Kontrakten
 * står i `./contract.ts` (`ConvertOfferToAssignment`). «Gyldig til» kopieres ikke. Rekkefølgen er fast:
 * ordreraden låses først (`FOR UPDATE`), så sjekkes status og kontor, og først da hentes
 * nummeret. Slik får to samtidige forsøk på samme ordre ett oppdrag, og taperen bruker ikke opp
 * et nummer. `row_version` på ordren øker, så et åpent endringsskjema får `OrderChangedError`.
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
      .select({
        id: orders.id,
        status: orders.status,
        receivedAt: orders.receivedAt,
        source: orders.source,
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
        // Oppdraget eier bestillingsopplysningene (ADR 0011): kopieres fra ordren i samme
        // transaksjon. Ordren beholder sin kopi som «slik bestillingen kom».
        receivedAt: before.receivedAt,
        source: before.source,
        externalRef: before.externalRef,
        orderedByText: before.orderedByText,
        orderedByContactId: before.orderedByContactId,
        orderedByFirmId: before.orderedByFirmId,
        addressText: before.addressText,
        gnr: before.gnr,
        bnr: before.bnr,
        snr: before.snr,
        housingAssociationName: before.housingAssociationName,
        sellerDeclarationReceived: before.sellerDeclarationReceived,
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
