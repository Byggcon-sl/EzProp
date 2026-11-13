import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { auditLog, contacts, employees, firms, orders } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import {
  ORDER_EDITABLE_FIELDS,
  isOrderEditableField,
  orderFieldLabel,
  type OrderEditableField,
} from "./codes";

/*
 * Endringene på én ordre (docs/funksjoner/fase2a-rette-ordre.md punkt 2), lest fra
 * revisjonsloggen. Loggen vises bare per ordre; ingen oppsummering per ansatt (arbeidsmiljøloven
 * kap. 9). Returnerer en fast form og aldri rå `changes`: bare kjente feltkoder slipper gjennom,
 * og ødelagte verdier gir en linje uten verdier i stedet for en feil.
 */

/** Høyst så mange linjer, de nyeste. */
export const ORDER_HISTORY_LIMIT = 200;

const REMOVED_CONTACT = "(fjernet kontakt)";
const REMOVED_FIRM = "(fjernet firma)";

const ACTION_LABELS: Record<string, string> = {
  create: "Opprettet",
  update: "Endret",
  reject: "Avvist",
  convert: "Gjort om til oppdrag",
};

export type OrderHistoryValue = string | number | boolean | null;

export type OrderHistoryChange = {
  field: OrderEditableField;
  label: string;
  from: OrderHistoryValue;
  to: OrderHistoryValue;
};

export type OrderHistoryEntry = {
  id: string;
  orderId: string;
  occurredAt: Date;
  actorName: string | null;
  action: "create" | "update" | "reject" | "convert" | (string & {});
  actionLabel: string;
  changes: OrderHistoryChange[];
};

const valueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const fromToSchema = z.object({ from: valueSchema, to: valueSchema });
const fieldsSchema = z.array(z.unknown());
const valuesSchema = z.record(z.string(), z.unknown());

type ParsedChange = { field: OrderEditableField; from: OrderHistoryValue; to: OrderHistoryValue };

/** Leser `changes` fra en `update`-rad. Ukjente koder hoppes over; ødelagte verdier blir `null`. */
function parseUpdateChanges(changes: unknown): ParsedChange[] {
  const record = valuesSchema.safeParse(changes);
  if (!record.success) return [];
  const parsedValues = valuesSchema.safeParse(record.data.values);
  const values = parsedValues.success ? parsedValues.data : {};
  const parsedFields = fieldsSchema.safeParse(record.data.fields);
  const listed = parsedFields.success ? parsedFields.data : Object.keys(values);
  const known = new Set(listed.filter(isOrderEditableField));

  return ORDER_EDITABLE_FIELDS.filter((field) => known.has(field)).map((field) => {
    const pair = fromToSchema.safeParse(Object.hasOwn(values, field) ? values[field] : undefined);
    return pair.success
      ? { field, from: pair.data.from, to: pair.data.to }
      : { field, from: null, to: null };
  });
}

function collectIds(changes: ParsedChange[][], field: OrderEditableField): string[] {
  const ids = new Set<string>();
  for (const list of changes) {
    for (const change of list) {
      if (change.field !== field) continue;
      for (const value of [change.from, change.to]) {
        if (typeof value === "string" && isUuid(value)) ids.add(value);
      }
    }
  }
  return [...ids];
}

/**
 * Hendelsene på ordren, nyeste først, høyst 200. Krever `organization.read`. Fremmed, ukjent,
 * slettet eller ugyldig ordre-id gir `AccessDeniedError`. Kontakt og firma vises med navn fra
 * registeret i organisasjonen fra tilgangssjekken; slettet eller ukjent gir «(fjernet kontakt)»
 * eller «(fjernet firma)». Navnet på den ansatte vises også når den er slettet eller har sluttet.
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

  const rows = await db
    .select({
      id: auditLog.id,
      entityId: auditLog.entityId,
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
      ),
    )
    .orderBy(desc(auditLog.occurredAt), desc(auditLog.id))
    .limit(ORDER_HISTORY_LIMIT);

  const parsed = rows.map((row) => (row.action === "update" ? parseUpdateChanges(row.changes) : []));

  const contactIds = collectIds(parsed, "orderedByContactId");
  const firmIds = collectIds(parsed, "orderedByFirmId");
  const contactNames = new Map<string, string>();
  const firmNames = new Map<string, string>();
  if (contactIds.length > 0) {
    const found = await db
      .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName })
      .from(contacts)
      .where(
        and(
          eq(contacts.organizationId, grant.organizationId),
          inArray(contacts.id, contactIds),
          isNull(contacts.deletedAt),
        ),
      );
    for (const contact of found) {
      contactNames.set(
        contact.id,
        [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim(),
      );
    }
  }
  if (firmIds.length > 0) {
    const found = await db
      .select({ id: firms.id, name: firms.name })
      .from(firms)
      .where(
        and(
          eq(firms.organizationId, grant.organizationId),
          inArray(firms.id, firmIds),
          isNull(firms.deletedAt),
        ),
      );
    for (const firm of found) firmNames.set(firm.id, firm.name);
  }

  function display(field: OrderEditableField, value: OrderHistoryValue): OrderHistoryValue {
    if (value === null) return null;
    if (field === "orderedByContactId") {
      return typeof value === "string" ? (contactNames.get(value) ?? REMOVED_CONTACT) : REMOVED_CONTACT;
    }
    if (field === "orderedByFirmId") {
      return typeof value === "string" ? (firmNames.get(value) ?? REMOVED_FIRM) : REMOVED_FIRM;
    }
    return value;
  }

  return rows.map((row, index) => ({
    id: row.id,
    orderId: row.entityId,
    occurredAt: row.occurredAt,
    actorName: row.actorName,
    action: row.action,
    actionLabel: Object.hasOwn(ACTION_LABELS, row.action)
      ? (ACTION_LABELS[row.action] ?? row.action)
      : row.action,
    changes: (parsed[index] ?? []).map((change) => ({
      field: change.field,
      label: orderFieldLabel(change.field),
      from: display(change.field, change.from),
      to: display(change.field, change.to),
    })),
  }));
}
