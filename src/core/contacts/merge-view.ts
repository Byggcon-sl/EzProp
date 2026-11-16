import {
  and,
  countDistinct,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
  type AnyColumn,
} from "drizzle-orm";
import { requireOrganizationAccess, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { assignmentParties, assignments, contacts, firms, orders } from "@/db/schema";
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
 * Antall oppdrag per kontakt eller firma: aktive parter og bestilleren på oppdraget (ADR 0011),
 * hvert oppdrag én gang selv om det treffer begge. Kansellerte oppdrag telles ikke som bestiller.
 */
async function assignmentUsage(
  organizationId: string,
  ids: string[],
  partyColumn: AnyColumn,
  orderedByColumn: AnyColumn,
): Promise<{ id: string | null; count: number }[]> {
  const rows = await db.execute<{ id: string | null; count: number }>(sql`
    select usage.ref_id as id, count(distinct usage.assignment_id)::int as count
    from (
      select ${partyColumn} as ref_id, ${assignmentParties.assignmentId} as assignment_id
      from ${assignmentParties}
      where ${assignmentParties.organizationId} = ${organizationId}
        and ${assignmentParties.deletedAt} is null
        and ${inArray(partyColumn, ids)}
      union all
      select ${orderedByColumn} as ref_id, ${assignments.id} as assignment_id
      from ${assignments}
      where ${assignments.organizationId} = ${organizationId}
        and ${assignments.deletedAt} is null
        and ${inArray(orderedByColumn, ids)}
    ) as usage
    group by usage.ref_id
  `);
  return [...rows].map((row) => ({ id: row.id, count: Number(row.count) }));
}

/**
 * Hvor mange oppdrag (aktive parter og bestilleren på oppdraget, hvert oppdrag én gang) og ordrer
 * som peker på hver kontakt. Id-er uten treff gir 0.
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

  const partyRows = await assignmentUsage(
    grant.organizationId,
    ids,
    assignmentParties.contactId,
    assignments.orderedByContactId,
  );
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
  const partyRows = await assignmentUsage(
    grant.organizationId,
    ids,
    assignmentParties.firmId,
    assignments.orderedByFirmId,
  );
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
