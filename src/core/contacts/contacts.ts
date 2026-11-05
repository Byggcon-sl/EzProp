import { and, asc, eq, isNull } from "drizzle-orm";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { db, type DbExecutor } from "@/db/client";
import { contacts, firms } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import type { ContactSource } from "./codes";
import { FirmNotFoundError } from "./errors";
import { contactInputSchema, type ContactInput } from "./schemas";
import { listLimit, matchesAny, searchPattern, type ListOptions } from "./search";

/*
 * Kontakter (docs/05-domenemodell.md 4.2): personer utenfor organisasjonen, for eksempel
 * meglere. Personopplysninger: sendes aldri til KI, og verdiene skrives aldri i revisjonsloggen
 * (bare id-er, kilden og navnene på feltene som ble endret).
 *
 * Se med `organization.read`, legge inn og endre med `assignment.edit`. All filtrering bruker
 * `grant.organizationId` fra tilgangssjekken. Fremmed, ukjent, slettet eller ugyldig id gir
 * `AccessDeniedError`. Ingen sletting her.
 */

const MANUAL_SOURCE: ContactSource = "manual";

/** Feltene som kan endres, i fast rekkefølge (navnene går til revisjonsloggen). */
const CONTACT_FIELDS = ["firstName", "lastName", "email", "phone", "firmId", "notes"] as const;

/** Feltene på én kontakt ut av kjernen. Ingen sporingsfelt, ingen organisasjon. */
const contactColumns = {
  id: contacts.id,
  firstName: contacts.firstName,
  lastName: contacts.lastName,
  email: contacts.email,
  phone: contacts.phone,
  firmId: contacts.firmId,
  notes: contacts.notes,
  source: contacts.source,
};

/**
 * Firmaet hentes med left join i samme organisasjon. Et slettet firma vises ikke: da er både
 * `firmId` og `firmName` `null` i svaret.
 */
function firmJoin(organizationId: string) {
  return and(
    eq(firms.id, contacts.firmId),
    eq(firms.organizationId, organizationId),
    isNull(firms.deletedAt),
  );
}

/**
 * Kontaktene i organisasjonen som ikke er slettet, sortert på etternavn og fornavn. Høyst 200.
 * Søket treffer fornavn, etternavn, e-post og firmanavn.
 */
export async function listContacts(
  actor: Actor,
  organizationId: string,
  options: ListOptions = {},
) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  const pattern = searchPattern(options.query);
  return db
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      phone: contacts.phone,
      firmId: firms.id,
      firmName: firms.name,
      source: contacts.source,
    })
    .from(contacts)
    .leftJoin(firms, firmJoin(grant.organizationId))
    .where(
      and(
        eq(contacts.organizationId, grant.organizationId),
        isNull(contacts.deletedAt),
        pattern
          ? matchesAny(pattern, [contacts.firstName, contacts.lastName, contacts.email, firms.name])
          : undefined,
      ),
    )
    .orderBy(asc(contacts.lastName), asc(contacts.firstName), asc(contacts.id))
    .limit(listLimit(options));
}

/** Én kontakt med alle feltene, kilden og firmanavnet. */
export async function getContact(actor: Actor, organizationId: string, contactId: string) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  if (!isUuid(contactId)) throw new AccessDeniedError();
  const [row] = await db
    .select({ ...contactColumns, firmId: firms.id, firmName: firms.name })
    .from(contacts)
    .leftJoin(firms, firmJoin(grant.organizationId))
    .where(
      and(
        eq(contacts.id, contactId),
        eq(contacts.organizationId, grant.organizationId),
        isNull(contacts.deletedAt),
      ),
    );
  if (!row) throw new AccessDeniedError();
  return row;
}

/** Firmaet må finnes i organisasjonen og ikke være slettet. */
async function requireFirm(tx: DbExecutor, organizationId: string, firmId: string | null) {
  if (firmId === null) return;
  const [firm] = await tx
    .select({ id: firms.id })
    .from(firms)
    .where(
      and(eq(firms.id, firmId), eq(firms.organizationId, organizationId), isNull(firms.deletedAt)),
    );
  if (!firm) throw new FirmNotFoundError();
}

/** Legger inn en kontakt for hånd (`source = manual`). */
export async function createContact(actor: Actor, organizationId: string, input: ContactInput) {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  const values = contactInputSchema.parse(input);

  return db.transaction(async (tx) => {
    await requireFirm(tx, grant.organizationId, values.firmId);
    const [row] = await tx
      .insert(contacts)
      .values({
        ...values,
        source: MANUAL_SOURCE,
        organizationId: grant.organizationId,
        createdBy: grant.employeeId,
      })
      .returning(contactColumns);
    if (!row) throw new Error("Fant ikke kontakten etter at den ble lagret. Prøv igjen.");
    await recordAuditEvent(tx, grant, {
      entityType: "contact",
      entityId: row.id,
      action: "create",
      changes: { contactId: row.id, firmId: row.firmId, source: row.source },
    });
    return row;
  });
}

/** Endrer alle feltene på en kontakt (ikke kilden). `row_version` økes med 1. */
export async function updateContact(
  actor: Actor,
  organizationId: string,
  contactId: string,
  input: ContactInput,
) {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  const values = contactInputSchema.parse(input);
  if (!isUuid(contactId)) throw new AccessDeniedError();

  return db.transaction(async (tx) => {
    const where = and(
      eq(contacts.id, contactId),
      eq(contacts.organizationId, grant.organizationId),
      isNull(contacts.deletedAt),
    );
    const [before] = await tx.select(contactColumns).from(contacts).where(where).for("update");
    if (!before) throw new AccessDeniedError();
    await requireFirm(tx, grant.organizationId, values.firmId);

    const [row] = await tx
      .update(contacts)
      .set({ ...values, updatedBy: grant.employeeId })
      .where(where)
      .returning(contactColumns);
    if (!row) throw new AccessDeniedError();

    await recordAuditEvent(tx, grant, {
      entityType: "contact",
      entityId: row.id,
      action: "update",
      changes: {
        contactId: row.id,
        firmId: row.firmId,
        source: row.source,
        changedFields: CONTACT_FIELDS.filter((field) => before[field] !== row[field]),
      },
    });
    return row;
  });
}
