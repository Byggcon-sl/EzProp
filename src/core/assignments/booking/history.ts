import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { AccessDeniedError, requireOrganizationAccess, type EmployeeGrant } from "@/core/access";
import { lookupContactAndFirmNames } from "@/core/contacts";
import { db } from "@/db/client";
import { assignments, auditLog, employees } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { BOOKING_EDITABLE_FIELDS } from "./codes";
import {
  BOOKING_HISTORY_LIMIT,
  type BookingHistoryEntry,
  type BookingHistoryValue,
  type ListAssignmentBookingHistory,
} from "./contract";

/*
 * Endringene i bestillingen («Endringer» på ordresiden og oppdragssiden). Felles for ordre og
 * oppdrag (ADR 0011). Leser revisjonsloggen og gir en fast form, aldri rå `changes`. Bare
 * feltkodene den som kaller tillater, slipper gjennom (oppdraget: `BOOKING_EDITABLE_FIELDS`;
 * tilbudet: `ORDER_EDITABLE_FIELDS` med `validUntil`, ADR 0012). Listen kommer som parameter, så
 * `booking` aldri importerer fra `orders` (ADR 0011 punkt 9). Ukjente koder og verdier i feil
 * form hoppes over uten unntak. Loggen vises bare per ordre eller oppdrag, aldri som oppsummering per
 * ansatt (arbeidsmiljøloven kap. 9).
 */

/** Vises i stedet for navnet når kontakten er fjernet, ukjent eller i en annen organisasjon. */
export const REMOVED_CONTACT_LABEL = "(fjernet kontakt)";
/** Som over, for firma. */
export const REMOVED_FIRM_LABEL = "(fjernet firma)";

/** Handlingene i revisjonsloggen for ordre og oppdrag. */
const BOOKING_HISTORY_ACTION_LABELS = new Map<string, string>([
  ["create", "Opprettet"],
  ["update", "Endret"],
  ["reject", "Avvist"],
  ["convert", "Gjort om til oppdrag"],
]);

/** Norsk etikett for en handling i historikken. Ukjent kode gir koden tilbake. */
export function bookingHistoryActionLabel(action: string): string {
  return BOOKING_HISTORY_ACTION_LABELS.get(action) ?? action;
}

const fieldValueSchema = z.union([z.string(), z.boolean(), z.null()]);
const fromToSchema = z.object({ from: fieldValueSchema, to: fieldValueSchema });
const fieldListSchema = z.array(z.unknown());
const valuesObjectSchema = z.record(z.string(), z.unknown());

/** Feltkodene i loggraden: bare tillatte koder, uten dubletter, i rekkefølgen fra listen. */
function readFields<F extends string>(
  changes: Record<string, unknown>,
  allowedFields: readonly F[],
): F[] {
  const raw = Object.hasOwn(changes, "fields") ? changes.fields : undefined;
  const parsed = fieldListSchema.safeParse(raw);
  if (!parsed.success) return [];
  const known = new Set(parsed.data.filter((value) => typeof value === "string"));
  return allowedFields.filter((field) => known.has(field));
}

/** Gammel og ny verdi per tillatt feltkode. Ugyldige oppføringer hoppes over. */
function readValues<F extends string>(
  changes: Record<string, unknown>,
  allowedFields: readonly F[],
): BookingHistoryValue<F>[] {
  const raw = Object.hasOwn(changes, "values") ? changes.values : undefined;
  const parsed = valuesObjectSchema.safeParse(raw);
  if (!parsed.success) return [];
  const values: BookingHistoryValue<F>[] = [];
  for (const field of allowedFields) {
    if (!Object.hasOwn(parsed.data, field)) continue;
    const entry = fromToSchema.safeParse(parsed.data[field]);
    if (!entry.success) continue;
    values.push({ field, from: entry.data.from, to: entry.data.to });
  }
  return values;
}

/** Id-ene som må slås opp for ett felt (bare gyldige uuid-er). */
function idsFor<F extends string>(entries: BookingHistoryValue<F>[][], field: string): string[] {
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

function nameOrRemoved(
  value: string | boolean | null,
  names: Map<string, string>,
  removed: string,
): string | boolean | null {
  if (value === null) return null;
  if (typeof value !== "string") return removed;
  return names.get(value) ?? removed;
}

export type BookingHistoryTarget = {
  entityType: "order" | "assignment";
  /** Id-en må alt være funnet i `grant.organizationId` av den som kaller. */
  entityId: string;
  /** Bare disse handlingene. Tom: alle. */
  actions?: readonly string[];
  /** Bare rader der `changes.fields` har minst én av de tillatte feltkodene. */
  onlyBookingFields?: boolean;
};

/**
 * Leser historikken for én ordre eller ett oppdrag, nyeste først, høyst `BOOKING_HISTORY_LIMIT`.
 * Kall den bare med `grant` fra `requireOrganizationAccess`, og etter at raden er funnet i
 * organisasjonen; den filtrerer på `grant.organizationId`. Eksporteres ikke fra
 * `@/core/assignments`. Den ansattes navn vises også når den ansatte er myk-slettet.
 *
 * `allowedFields` er feltkodene som vises, i den rekkefølgen (oppdraget sender
 * `BOOKING_EDITABLE_FIELDS`, tilbudet `ORDER_EDITABLE_FIELDS`). Andre koder hoppes over.
 */
export async function readBookingHistory<F extends string>(
  grant: EmployeeGrant,
  target: BookingHistoryTarget,
  allowedFields: readonly F[],
): Promise<BookingHistoryEntry<F>[]> {
  const bookingFieldsFilter = target.onlyBookingFields
    ? sql`(jsonb_typeof(${auditLog.changes} -> 'fields') = 'array' and (${auditLog.changes} -> 'fields') ?| array[${sql.join(
        allowedFields.map((field) => sql`${field}`),
        sql`, `,
      )}]::text[])`
    : undefined;

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
        eq(auditLog.entityType, target.entityType),
        eq(auditLog.entityId, target.entityId),
        target.actions && target.actions.length > 0
          ? inArray(auditLog.action, [...target.actions])
          : undefined,
        bookingFieldsFilter,
      ),
    )
    .orderBy(desc(auditLog.occurredAt), desc(auditLog.receivedAt), desc(auditLog.id))
    .limit(BOOKING_HISTORY_LIMIT);

  const parsed = rows.map((row) => {
    const changes = valuesObjectSchema.safeParse(row.changes);
    const data = changes.success ? changes.data : {};
    return {
      row,
      fields: readFields(data, allowedFields),
      values: readValues(data, allowedFields),
    };
  });

  const allValues = parsed.map((entry) => entry.values);
  const { contacts: contactsById, firms: firmsById } = await lookupContactAndFirmNames(grant, {
    contactIds: idsFor(allValues, "orderedByContactId"),
    firmIds: idsFor(allValues, "orderedByFirmId"),
  });

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

/** Handlingene på oppdraget som kan gjelde bestillingen. */
const ASSIGNMENT_BOOKING_ACTIONS = ["create", "update"] as const;

/**
 * Endringene i bestillingen på ett oppdrag. Kontrakten står i `./contract.ts`. Fremmed, ukjent,
 * slettet eller ugyldig oppdrags-id gir `AccessDeniedError`.
 */
export const listAssignmentBookingHistory: ListAssignmentBookingHistory = async (
  actor,
  organizationId,
  assignmentId,
) => {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  if (!isUuid(assignmentId)) throw new AccessDeniedError();

  const [assignment] = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(
      and(
        eq(assignments.id, assignmentId),
        eq(assignments.organizationId, grant.organizationId),
        isNull(assignments.deletedAt),
      ),
    );
  if (!assignment) throw new AccessDeniedError();

  return readBookingHistory(
    grant,
    {
      entityType: "assignment",
      entityId: assignment.id,
      actions: ASSIGNMENT_BOOKING_ACTIONS,
      onlyBookingFields: true,
    },
    BOOKING_EDITABLE_FIELDS,
  );
};
