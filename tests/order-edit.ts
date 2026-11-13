import { and, count, eq } from "drizzle-orm";
import type { Actor } from "@/core/access";
import { db } from "@/db/client";
import { auditLog, employees, events, orders, organizations, type EmployeeRole } from "@/db/schema";
import {
  createAssignment,
  createEmployee,
  createOffice,
  createOrder as insertOrder,
  createOrganization,
  createUser,
} from "./factories";

/*
 * Felles hjelpere for testene av «Endre ordren» (docs/funksjoner/fase2a-rette-ordre-testplan.md).
 * Bare oppdiktede data. Ingen tilgangslogikk her: testene går alltid gjennom tjenesten.
 */

/** Feltlisten fra kortet, i fast rekkefølge (fasit, ikke importert fra koden, regel 6). */
export const EXPECTED_ORDER_FIELDS = [
  "receivedAt",
  "externalRef",
  "orderedByText",
  "orderedByContactId",
  "orderedByFirmId",
  "addressText",
  "gnr",
  "bnr",
  "snr",
  "housingAssociationName",
  "sellerDeclarationReceived",
] as const;

export const OLD_ADDRESS = "Testveien 12, 8000 Bodø";
export const NEW_ADDRESS = "Testveien 14, 8000 Bodø";
export const CHANGED_MESSAGE = "Ordren er endret av en annen. Last siden på nytt.";

export async function setInspectorsEditAll(organizationId: string, value: boolean) {
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": value } })
    .where(eq(organizations.id, organizationId));
}

/** Organisasjon med admin. */
export async function orgWithAdmin(name = "Testfirma takst") {
  const org = await createOrganization(name);
  const admin = await createUser({ name: "Test Admin" });
  const adminEmployee = await createEmployee(admin, org.id, ["admin"]);
  return { org, admin, adminEmployee };
}

/** En person med rollene i organisasjonen. */
export async function person(organizationId: string, roles: EmployeeRole[], name?: string) {
  const actor: Actor = await createUser(name ? { name } : {});
  const employee = await createEmployee(actor, organizationId, roles);
  return { actor, employee };
}

/** En ordre som er gjort om til et oppdrag (fabrikkene, ikke nummerserien). */
export async function insertConvertedOrder(
  organizationId: string,
  overrides: Record<string, unknown> = {},
) {
  const order = await insertOrder(organizationId, overrides);
  const office = await createOffice(organizationId);
  const assignment = await createAssignment(organizationId, {
    orderId: order.id,
    officeId: office.id,
  });
  const [converted] = await db
    .update(orders)
    .set({ status: "converted", assignmentId: assignment.id })
    .where(eq(orders.id, order.id))
    .returning();
  if (!converted) throw new Error("kunne ikke gjøre om ordren");
  return { order: converted, assignment };
}

export async function orderRow(id: string) {
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  if (!row) throw new Error("fant ikke ordren");
  return row;
}

type OrderRow = Awaited<ReturnType<typeof orderRow>>;

/**
 * Skjemaet slik det sendes når ordren åpnes: alle feltene med verdiene på raden, og
 * `overrides` oppå. Mottatt sendes som ISO-tekst.
 */
export function editInput(row: OrderRow, overrides: Record<string, unknown> = {}) {
  return {
    receivedAt: row.receivedAt.toISOString(),
    externalRef: row.externalRef,
    orderedByText: row.orderedByText,
    orderedByContactId: row.orderedByContactId,
    addressText: row.addressText,
    gnr: row.gnr,
    bnr: row.bnr,
    snr: row.snr,
    housingAssociationName: row.housingAssociationName,
    sellerDeclarationReceived: row.sellerDeclarationReceived,
    ...overrides,
  };
}

/** Loggradene for én ordre, eldste først. */
export async function orderAuditRows(orderId: string) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, "order"), eq(auditLog.entityId, orderId)))
    .orderBy(auditLog.receivedAt, auditLog.createdAt);
}

export async function updateAuditRows(orderId: string) {
  return (await orderAuditRows(orderId)).filter((row) => row.action === "update");
}

export async function eventsOfType(type: string) {
  return db.select().from(events).where(eq(events.type, type));
}

export async function tableCount(table: typeof auditLog | typeof events | typeof orders) {
  const [row] = await db.select({ n: count() }).from(table);
  return row?.n ?? 0;
}

export async function setEmployee(
  employeeId: string,
  set: { deactivatedAt?: Date | null; deletedAt?: Date | null },
) {
  await db.update(employees).set(set).where(eq(employees.id, employeeId));
}
