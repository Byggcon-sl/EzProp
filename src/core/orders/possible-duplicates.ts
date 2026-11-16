import {
  AccessDeniedError,
  requireOrganizationAccess,
  type Actor,
  type EmployeeGrant,
} from "@/core/access";
import type { PossibleDuplicateFields } from "@/core/assignments/booking/contract";
import type { PossibleDuplicateRow } from "@/core/assignments/booking/duplicate-sql";
import {
  lookupPossibleDuplicateRows,
  rowReasons,
} from "@/core/assignments/booking/duplicates-service";
import { db } from "@/db/client";
import { isUuid } from "@/shared/lib/uuid";
import type { DuplicateReason, OrderStatus } from "./codes";
import { selectOrder } from "./orders";

export { PossibleDuplicatesLookupError } from "@/core/assignments/errors";
export type { PossibleDuplicateFields } from "@/core/assignments/booking/contract";

/*
 * Varselet om mulig dublett på ordresiden (T3), i formen ordresiden har i dag. Regelen og
 * spørringen er felles for ordre og oppdrag og står i `@/core/assignments/booking/` (ADR 0011);
 * her gjøres treffene om til ordreform. Nye skjermer bruker `findPossibleDuplicatesFor` fra
 * `@/core/assignments`, som også gir oppdrag laget direkte.
 *
 * Et oppdrag som kom fra en ordre vises som ordren, «gjort om» med oppdragsnummeret. Et oppdrag
 * laget direkte («Nytt oppdrag») har ingen ordre og vises som oppdraget (`kind: "assignment"`),
 * med lenke til oppdraget (kortet, «Regler»: «ordre mot oppdrag»).
 *
 * Personvern: loggen får bare antall treff, id-er og organisasjonen (se tjenesten i kjernen).
 */

/** Én annen ordre som kan være samme bestilling. Fast nøkkelliste, uten matrikkel og kontakter. */
export type PossibleDuplicateOrder = {
  /**
   * `order`: en ordre (også gjort om), `id` er ordre-id. `assignment`: et oppdrag laget direkte
   * uten ordre, `id` er oppdrags-id.
   */
  kind: "order" | "assignment";
  id: string;
  receivedAt: Date;
  /** Vises bare på skjermen i samme organisasjon (A290). Logges aldri og sendes aldri til KI. */
  addressText: string;
  /** Ordrestatusen. `null` for et oppdrag laget direkte (det har ingen ordre). */
  status: OrderStatus | null;
  /** Oppdragsnummeret når ordren er gjort om eller treffet er et oppdrag, ellers `null`. */
  assignmentNumber: string | null;
  /** Oppdragsstatusen når ordren er gjort om eller treffet er et oppdrag, ellers `null`. */
  assignmentStatus: string | null;
  reasons: DuplicateReason[];
};

export type PossibleDuplicateOrders = { items: PossibleDuplicateOrder[]; hasMore: boolean };

const EMPTY: PossibleDuplicateOrders = { items: [], hasMore: false };

/** Rettigheten for oppslaget: den samme som for å lese ordren. */
const PERMISSION = "organization.read";

/** Treffet i ordreform. Et oppdrag uten ordre gir `kind: "assignment"`. */
function toOrderForm(row: PossibleDuplicateRow): PossibleDuplicateOrder {
  const reasons = rowReasons(row);
  if (row.kind === "order") {
    return {
      kind: "order",
      id: row.id,
      receivedAt: row.receivedAt,
      addressText: row.addressText,
      status: row.status as OrderStatus,
      assignmentNumber: null,
      assignmentStatus: null,
      reasons,
    };
  }
  if (row.orderId === null) {
    return {
      kind: "assignment",
      id: row.id,
      receivedAt: row.receivedAt,
      addressText: row.addressText,
      status: null,
      assignmentNumber: row.number ?? null,
      assignmentStatus: row.status,
      reasons,
    };
  }
  return {
    kind: "order",
    id: row.orderId,
    receivedAt: row.receivedAt,
    addressText: row.addressText,
    status: "converted",
    assignmentNumber: row.number ?? null,
    assignmentStatus: row.status,
    reasons,
  };
}

async function lookupOrders(
  grant: EmployeeGrant,
  fields: PossibleDuplicateFields,
): Promise<PossibleDuplicateOrders> {
  const { rows, hasMore } = await lookupPossibleDuplicateRows(grant, fields);
  const items = rows.map(toOrderForm);
  return { items, hasMore };
}

/**
 * Andre ordre i organisasjonen som kan være samme bestilling som ordrefeltene. Høyst 10, nyeste
 * mottatt først og så `id`; `hasMore` når det finnes flere. Ugyldige felt gir `ZodError` (ugyldig
 * dato, id som ikke er uuid), aldri en databasefeil.
 */
export async function findPossibleDuplicateOrdersFor(
  actor: Actor,
  organizationId: string,
  fields: PossibleDuplicateFields,
): Promise<PossibleDuplicateOrders> {
  const grant = await requireOrganizationAccess(actor, organizationId, PERMISSION);
  return lookupOrders(grant, fields);
}

/**
 * Mulige dubletter for en lagret ordre. Ukjent, fremmed, myk-slettet eller ugyldig ordre-id gir
 * `AccessDeniedError`. En avvist ordre gir tom liste. Ordren selv er aldri med.
 */
export async function findPossibleDuplicateOrders(
  actor: Actor,
  organizationId: string,
  orderId: string,
): Promise<PossibleDuplicateOrders> {
  const grant = await requireOrganizationAccess(actor, organizationId, PERMISSION);
  if (!isUuid(orderId)) throw new AccessDeniedError();
  const order = await selectOrder(db, grant, orderId);
  if (!order) throw new AccessDeniedError();
  if (order.status === "rejected") return EMPTY;

  return lookupOrders(grant, {
    addressText: order.addressText,
    gnr: order.gnr,
    bnr: order.bnr,
    snr: order.snr,
    receivedAt: order.receivedAt,
    excludeOrderId: order.id,
    excludeAssignmentId: order.assignmentId,
  });
}
