import { and, eq, inArray, isNull } from "drizzle-orm";
import type { EmployeeGrant } from "@/core/access";
import { db } from "@/db/client";
import { contacts, firms } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";

/*
 * Navn på kontakter og firma til visning andre steder (først ordrehistorikken, T2). Tar en
 * `grant` fra en tilgangssjekk som kalleren alt har gjort, og filtrerer bare på
 * `grant.organizationId`. Slettede, fremmede og ugyldige id-er er ikke med i svaret;
 * kalleren viser da sin egen «(fjernet …)»-tekst.
 */

export type ContactAndFirmNames = {
  contacts: Map<string, string>;
  firms: Map<string, string>;
};

function validIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => isUuid(id)))];
}

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

/**
 * Navn på aktive kontakter (fornavn og etternavn) og firma (firmanavn) i organisasjonen til
 * `grant`. Tomme lister gir tomme maps uten spørring.
 */
export async function lookupContactAndFirmNames(
  grant: EmployeeGrant,
  ids: { contactIds: readonly string[]; firmIds: readonly string[] },
): Promise<ContactAndFirmNames> {
  const [contactsById, firmsById] = await Promise.all([
    contactNames(grant.organizationId, validIds(ids.contactIds)),
    firmNames(grant.organizationId, validIds(ids.firmIds)),
  ]);
  return { contacts: contactsById, firms: firmsById };
}
