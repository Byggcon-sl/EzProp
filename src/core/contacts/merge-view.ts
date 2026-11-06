import { and, countDistinct, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { requireOrganizationAccess, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { assignmentParties, contacts, firms, orders } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";

/*
 * Lesing for skjermene «Fjern» og «Slå sammen» (docs/funksjoner/fase2a-fjerne-sla-sammen-kontakter.md).
 * Alle krever `contacts.manage` og filtrerer på `grant.organizationId` fra tilgangssjekken.
 * Ugyldige id-er gir ingen treff. Ingen endringer her.
 */

/** Antall oppdrag og ordrer per kontakt. */
export type ContactUsage = { assignmentCount: number; orderCount: number };

/** Antall aktive kontakter, oppdrag og ordrer per firma. */
export type FirmUsage = ContactUsage & { contactCount: number };

/** Skriver antallet fra en gruppert rad inn i svaret. Rader uten id hoppes over. */
function setCount<T extends Record<string, number>>(
  result: Record<string, T>,
  row: { id: string | null; count: number },
  key: keyof T,
) {
  const entry = row.id ? result[row.id] : undefined;
  if (entry) (entry as Record<keyof T, number>)[key] = row.count;
}

function validIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => isUuid(id)))];
}

/**
 * Hvor mange oppdrag (aktive parter, hvert oppdrag én gang) og ordrer som peker på hver kontakt.
 * Id-er uten treff gir 0.
 */
export async function getContactUsage(
  actor: Actor,
  organizationId: string,
  contactIds: readonly string[],
): Promise<Record<string, ContactUsage>> {
  const grant = await requireOrganizationAccess(actor, organizationId, "contacts.manage");
  const ids = validIds(contactIds);
  const result: Record<string, ContactUsage> = {};
  for (const id of ids) result[id] = { assignmentCount: 0, orderCount: 0 };
  if (ids.length === 0) return result;

  const partyRows = await db
    .select({
      id: assignmentParties.contactId,
      count: countDistinct(assignmentParties.assignmentId),
    })
    .from(assignmentParties)
    .where(
      and(
        eq(assignmentParties.organizationId, grant.organizationId),
        inArray(assignmentParties.contactId, ids),
        isNull(assignmentParties.deletedAt),
      ),
    )
    .groupBy(assignmentParties.contactId);
  const orderRows = await db
    .select({ id: orders.orderedByContactId, count: countDistinct(orders.id) })
    .from(orders)
    .where(
      and(
        eq(orders.organizationId, grant.organizationId),
        inArray(orders.orderedByContactId, ids),
        isNull(orders.deletedAt),
      ),
    )
    .groupBy(orders.orderedByContactId);

  for (const row of partyRows) setCount(result, row, "assignmentCount");
  for (const row of orderRows) setCount(result, row, "orderCount");
  return result;
}

/** Hvor mange aktive kontakter, oppdrag og ordrer som peker på hvert firma. */
export async function getFirmUsage(
  actor: Actor,
  organizationId: string,
  firmIds: readonly string[],
): Promise<Record<string, FirmUsage>> {
  const grant = await requireOrganizationAccess(actor, organizationId, "contacts.manage");
  const ids = validIds(firmIds);
  const result: Record<string, FirmUsage> = {};
  for (const id of ids) result[id] = { contactCount: 0, assignmentCount: 0, orderCount: 0 };
  if (ids.length === 0) return result;

  const contactRows = await db
    .select({ id: contacts.firmId, count: countDistinct(contacts.id) })
    .from(contacts)
    .where(
      and(
        eq(contacts.organizationId, grant.organizationId),
        inArray(contacts.firmId, ids),
        isNull(contacts.deletedAt),
      ),
    )
    .groupBy(contacts.firmId);
  const partyRows = await db
    .select({ id: assignmentParties.firmId, count: countDistinct(assignmentParties.assignmentId) })
    .from(assignmentParties)
    .where(
      and(
        eq(assignmentParties.organizationId, grant.organizationId),
        inArray(assignmentParties.firmId, ids),
        isNull(assignmentParties.deletedAt),
      ),
    )
    .groupBy(assignmentParties.firmId);
  const orderRows = await db
    .select({ id: orders.orderedByFirmId, count: countDistinct(orders.id) })
    .from(orders)
    .where(
      and(
        eq(orders.organizationId, grant.organizationId),
        inArray(orders.orderedByFirmId, ids),
        isNull(orders.deletedAt),
      ),
    )
    .groupBy(orders.orderedByFirmId);

  for (const row of contactRows) setCount(result, row, "contactCount");
  for (const row of partyRows) setCount(result, row, "assignmentCount");
  for (const row of orderRows) setCount(result, row, "orderCount");
  return result;
}

/**
 * Navnet på en fjernet kontakt, til kvitteringen «<navn> er fjernet.» etter fjerning. Bare
 * fjernede kontakter i organisasjonen; ellers `null`.
 */
export async function getRemovedContactName(
  actor: Actor,
  organizationId: string,
  contactId: string,
): Promise<{ firstName: string; lastName: string | null } | null> {
  const grant = await requireOrganizationAccess(actor, organizationId, "contacts.manage");
  if (!isUuid(contactId)) return null;
  const [row] = await db
    .select({ firstName: contacts.firstName, lastName: contacts.lastName })
    .from(contacts)
    .where(
      and(
        eq(contacts.id, contactId),
        eq(contacts.organizationId, grant.organizationId),
        isNotNull(contacts.deletedAt),
      ),
    );
  return row ?? null;
}

/** Navnet på et fjernet firma, til kvitteringen etter fjerning. Ellers `null`. */
export async function getRemovedFirmName(
  actor: Actor,
  organizationId: string,
  firmId: string,
): Promise<string | null> {
  const grant = await requireOrganizationAccess(actor, organizationId, "contacts.manage");
  if (!isUuid(firmId)) return null;
  const [row] = await db
    .select({ name: firms.name })
    .from(firms)
    .where(
      and(
        eq(firms.id, firmId),
        eq(firms.organizationId, grant.organizationId),
        isNotNull(firms.deletedAt),
      ),
    );
  return row?.name ?? null;
}
