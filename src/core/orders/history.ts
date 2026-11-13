import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { auditLog, contacts, employees, firms, orders } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { ORDER_EDITABLE_FIELDS, isOrderEditableField, type OrderEditableField } from "./codes";

/*
 * Endringene på én ordre («Endringer» på ordresiden, T1). Leser revisjonsloggen for ordren og
 * gir en fast form, aldri rå `changes`. Bare feltkoder fra `ORDER_EDITABLE_FIELDS` slipper
 * gjennom; ukjente koder og verdier i feil form hoppes over uten unntak. Loggen vises bare per
 * ordre, ikke som oppsummering per ansatt (arbeidsmiljøloven kap. 9).
 */

/** Høyst så mange rader vises, de nyeste. */
export const ORDER_HISTORY_LIMIT = 200;

/** Vises i stedet for navnet når kontakten er fjernet, ukjent eller i en annen organisasjon. */
export const REMOVED_CONTACT_LABEL = "(fjernet kontakt)";
/** Som over, for firma. */
export const REMOVED_FIRM_LABEL = "(fjernet firma)";

/** Handlingene ordren har i revisjonsloggen (`create`, `update`, `reject`, `convert`). */
const ORDER_HISTORY_ACTION_LABELS = new Map<string, string>([
  ["create", "Opprettet"],
  ["update", "Endret"],
  ["reject", "Avvist"],
  ["convert", "Gjort om til oppdrag"],
]);

/** Norsk etikett for en handling på ordren. Ukjent kode gir koden tilbake. */
export function orderHistoryActionLabel(action: string): string {
  return ORDER_HISTORY_ACTION_LABELS.get(action) ?? action;
}

export type OrderHistoryValue = {
  field: OrderEditableField;
  /** Tekst, ja/nei eller tom. Bestiller og firma er navn (eller «(fjernet …)»), ikke id-er. */
  from: string | boolean | null;
  to: string | boolean | null;
};

export type OrderHistoryEntry = {
  id: string;
  action: string;
  actorName: string | null;
  occurredAt: Date;
  fields: OrderEditableField[];
  values: OrderHistoryValue[];
};

const fieldValueSchema = z.union([z.string(), z.boolean(), z.null()]);
const fromToSchema = z.object({ from: fieldValueSchema, to: fieldValueSchema });
const fieldListSchema = z.array(z.unknown());
const valuesObjectSchema = z.record(z.string(), z.unknown());

/** Feltkodene i loggraden: bare kjente koder, uten dubletter, i rekkefølgen fra listen. */
function readFields(changes: Record<string, unknown>): OrderEditableField[] {
  const raw = Object.hasOwn(changes, "fields") ? changes.fields : undefined;
  const parsed = fieldListSchema.safeParse(raw);
  if (!parsed.success) return [];
  const known = new Set(parsed.data.filter(isOrderEditableField));
  return ORDER_EDITABLE_FIELDS.filter((field) => known.has(field));
}

/** Gammel og ny verdi per kjent feltkode. Ugyldige oppføringer hoppes over. */
function readValues(changes: Record<string, unknown>): OrderHistoryValue[] {
  const raw = Object.hasOwn(changes, "values") ? changes.values : undefined;
  const parsed = valuesObjectSchema.safeParse(raw);
  if (!parsed.success) return [];
  const values: OrderHistoryValue[] = [];
  for (const field of ORDER_EDITABLE_FIELDS) {
    if (!Object.hasOwn(parsed.data, field)) continue;
    const entry = fromToSchema.safeParse(parsed.data[field]);
    if (!entry.success) continue;
    values.push({ field, from: entry.data.from, to: entry.data.to });
  }
  return values;
}

/** Id-ene som må slås opp for ett felt (bare gyldige uuid-er). */
function idsFor(entries: OrderHistoryValue[][], field: OrderEditableField): string[] {
  const ids = new Set<string>();
  for (const values of entries) {
    for (const value of values) {
      if (value.field !== field) continue;
      for (const id of [value.from, value.to])
        if (typeof id === "string" && isUuid(id)) ids.add(id);
    }
  }
  return [...ids];
}

/** Navn på aktive kontakter i organisasjonen. Slettede og fremmede er ikke med. */
async function contactNames(organizationId: string, ids: string[]) {
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const rows = await db
    .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName })
    .from(contacts)
    .where(
      and(
        inArray(contacts.id, ids),
        eq(contacts.organizationId, organizationId),
        isNull(contacts.deletedAt),
      ),
    );
  for (const row of rows) {
    names.set(row.id, [row.firstName, row.lastName].filter(Boolean).join(" "));
  }
  return names;
}

/** Navn på aktive firma i organisasjonen. Slettede og fremmede er ikke med. */
async function firmNames(organizationId: string, ids: string[]) {
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const rows = await db
    .select({ id: firms.id, name: firms.name })
    .from(firms)
    .where(
      and(
        inArray(firms.id, ids),
        eq(firms.organizationId, organizationId),
        isNull(firms.deletedAt),
      ),
    );
  for (const row of rows) names.set(row.id, row.name);
  return names;
}

function nameOrRemoved(
  value: string | boolean | null,
  names: Map<string, string>,
  removed: string,
): string | boolean | null {
  if (value === null) return null;
  if (typeof value !== "string") return removed;
  return names.get(value) ?? removed;
}

/**
 * Endringene på én ordre, nyeste først, høyst `ORDER_HISTORY_LIMIT` rader. Krever
 * `organization.read`. Fremmed, ukjent, slettet eller ugyldig ordre-id gir `AccessDeniedError`.
 * Den ansattes navn vises også når den ansatte er myk-slettet.
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
      action: auditLog.action,
      changes: auditLog.changes,
      actorName: employees.name,
      occurredAt: auditLog.occurredAt,
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
    .orderBy(desc(auditLog.occurredAt), desc(auditLog.receivedAt), desc(auditLog.id))
    .limit(ORDER_HISTORY_LIMIT);

  const parsed = rows.map((row) => {
    const changes = valuesObjectSchema.safeParse(row.changes);
    const data = changes.success ? changes.data : {};
    return { row, fields: readFields(data), values: readValues(data) };
  });

  const allValues = parsed.map((entry) => entry.values);
  const [contactsById, firmsById] = await Promise.all([
    contactNames(grant.organizationId, idsFor(allValues, "orderedByContactId")),
    firmNames(grant.organizationId, idsFor(allValues, "orderedByFirmId")),
  ]);

  return parsed.map(({ row, fields, values }) => ({
    id: row.id,
    action: row.action,
    actorName: row.actorName ?? null,
    occurredAt: row.occurredAt,
    fields,
    values: values.map((value) => {
      if (value.field === "orderedByContactId") {
        return {
          field: value.field,
          from: nameOrRemoved(value.from, contactsById, REMOVED_CONTACT_LABEL),
          to: nameOrRemoved(value.to, contactsById, REMOVED_CONTACT_LABEL),
        };
      }
      if (value.field === "orderedByFirmId") {
        return {
          field: value.field,
          from: nameOrRemoved(value.from, firmsById, REMOVED_FIRM_LABEL),
          to: nameOrRemoved(value.to, firmsById, REMOVED_FIRM_LABEL),
        };
      }
      return value;
    }),
  }));
}
