import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { auditLog, contacts, employees, firms, orders } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { ORDER_EDITABLE_FIELDS, isOrderEditableField, orderFieldLabel } from "./codes";

/*
 * Endringene på én ordre (T1), lest fra revisjonsloggen. Synlig for alle med
 * `organization.read` (spørsmål 78 c til Ståle). Bare per ordre; ingen oppsummering per ansatt
 * (arbeidsmiljøloven kap. 9).
 *
 * Returnerer en fast form, aldri rå `changes`: bare feltkoder fra `ORDER_EDITABLE_FIELDS`
 * slipper gjennom, og en ødelagt rad gir en linje uten verdier, aldri unntak.
 */

const ORDER_HISTORY_ACTIONS = ["create", "update", "reject", "convert"] as const;
export type OrderHistoryAction = (typeof ORDER_HISTORY_ACTIONS)[number];

const ACTION_LABELS: Record<OrderHistoryAction, string> = {
  create: "Opprettet",
  update: "Endret",
  reject: "Avvist",
  convert: "Gjort om til oppdrag",
};

/** Høyst så mange linjer, de nyeste. */
const HISTORY_LIMIT = 200;

const REMOVED_CONTACT = "(fjernet kontakt)";
const REMOVED_FIRM = "(fjernet firma)";

export type OrderHistoryValue = string | boolean | null;

export type OrderHistoryChange = {
  field: string;
  label: string;
  from: OrderHistoryValue;
  to: OrderHistoryValue;
};

export type OrderHistoryEntry = {
  id: string;
  orderId: string;
  occurredAt: Date;
  actorName: string | null;
  action: OrderHistoryAction;
  actionLabel: string;
  changes: OrderHistoryChange[];
};

const changesSchema = z.object({
  fields: z.array(z.unknown()).optional().catch(undefined),
  values: z.record(z.string(), z.unknown()).optional().catch(undefined),
});

const valueSchema = z.union([z.string(), z.boolean(), z.null()]);
const fromToSchema = z.object({ from: valueSchema, to: valueSchema });

/** Feltene i en `update`-rad med verdier. Bestiller og firma er fortsatt id-er her. */
function readUpdateChanges(raw: unknown): OrderHistoryChange[] {
  const parsed = changesSchema.safeParse(raw);
  if (!parsed.success) return [];
  const { fields = [], values } = parsed.data;
  const known = new Set<string>();
  for (const field of fields) if (isOrderEditableField(field)) known.add(field);
  if (values) for (const key of Object.keys(values)) if (isOrderEditableField(key)) known.add(key);

  return ORDER_EDITABLE_FIELDS.filter((field) => known.has(field)).map((field) => {
    const entry =
      values && Object.hasOwn(values, field) ? fromToSchema.safeParse(values[field]) : null;
    const pair = entry?.success ? entry.data : { from: null, to: null };
    return { field, label: orderFieldLabel(field), from: pair.from, to: pair.to };
  });
}

/** Id-ene for et felt (bare gyldige uuid-er, så oppslaget aldri feiler). */
function idsFor(entries: OrderHistoryEntry[], field: string) {
  const ids = new Set<string>();
  for (const entry of entries)
    for (const change of entry.changes)
      if (change.field === field)
        for (const value of [change.from, change.to])
          if (typeof value === "string" && isUuid(value)) ids.add(value);
  return [...ids];
}

/** Bytter id med navn. Ukjent, slettet eller ugyldig id gir `removed`. */
function replaceIds(
  entries: OrderHistoryEntry[],
  field: string,
  names: Map<string, string>,
  removed: string,
) {
  const swap = (value: OrderHistoryValue): OrderHistoryValue =>
    typeof value === "string" ? (names.get(value) ?? removed) : null;
  for (const entry of entries)
    for (const change of entry.changes)
      if (change.field === field) {
        change.from = swap(change.from);
        change.to = swap(change.to);
      }
}

/**
 * Endringene på ordren, nyeste først, høyst 200 linjer. Fremmed, ukjent, slettet eller ugyldig
 * ordre-id gir `AccessDeniedError`. Navnet på en myk-slettet ansatt vises fortsatt.
 */
export async function listOrderHistory(
  actor: Actor,
  organizationId: string,
  orderId: string,
): Promise<OrderHistoryEntry[]> {
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

  // Left join: navnet står også når den ansatte er myk-slettet; join krever samme organisasjon.
  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      changes: auditLog.changes,
      occurredAt: auditLog.occurredAt,
      actorName: employees.name,
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
        inArray(auditLog.action, [...ORDER_HISTORY_ACTIONS]),
      ),
    )
    .orderBy(desc(auditLog.occurredAt), desc(auditLog.receivedAt))
    .limit(HISTORY_LIMIT);

  const entries: OrderHistoryEntry[] = rows.map((row) => {
    const action = row.action as OrderHistoryAction;
    return {
      id: row.id,
      orderId: order.id,
      occurredAt: row.occurredAt,
      actorName: row.actorName,
      action,
      actionLabel: ACTION_LABELS[action],
      changes: action === "update" ? readUpdateChanges(row.changes) : [],
    };
  });

  const contactIds = idsFor(entries, "orderedByContactId");
  const contactNames = new Map<string, string>();
  if (contactIds.length > 0) {
    const found = await db
      .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName })
      .from(contacts)
      .where(
        and(
          inArray(contacts.id, contactIds),
          eq(contacts.organizationId, grant.organizationId),
          isNull(contacts.deletedAt),
        ),
      );
    for (const c of found)
      contactNames.set(c.id, [c.firstName, c.lastName].filter(Boolean).join(" "));
  }
  replaceIds(entries, "orderedByContactId", contactNames, REMOVED_CONTACT);

  const firmIds = idsFor(entries, "orderedByFirmId");
  const firmNames = new Map<string, string>();
  if (firmIds.length > 0) {
    const found = await db
      .select({ id: firms.id, name: firms.name })
      .from(firms)
      .where(
        and(
          inArray(firms.id, firmIds),
          eq(firms.organizationId, grant.organizationId),
          isNull(firms.deletedAt),
        ),
      );
    for (const f of found) firmNames.set(f.id, f.name);
  }
  replaceIds(entries, "orderedByFirmId", firmNames, REMOVED_FIRM);

  return entries;
}
