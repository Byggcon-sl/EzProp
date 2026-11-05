import { and, asc, eq, isNull } from "drizzle-orm";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { isUniqueViolation } from "@/core/organization/errors";
import { db } from "@/db/client";
import { contacts, firms } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { FirmDuplicateError } from "./errors";
import { firmInputSchema, type FirmInput, type FirmValues } from "./schemas";
import { LIST_LIMIT, matchesAny, searchPattern, type ListOptions } from "./search";

/*
 * Firma (docs/05-domenemodell.md 4.2). Se med `organization.read`, legge inn og endre med
 * `assignment.edit` (samme som partene på oppdraget). All filtrering bruker
 * `grant.organizationId` fra tilgangssjekken, aldri parameteren. Fremmed, ukjent, slettet eller
 * ugyldig id gir `AccessDeniedError`. Ingen sletting her.
 *
 * Revisjonsloggen får id, firmatype og navnene på feltene som ble endret, aldri navn,
 * organisasjonsnummer eller notat.
 */

const DUPLICATE_INDEX = "firms_organization_id_org_number_idx";

/** Feltene som kan endres, i fast rekkefølge (navnene går til revisjonsloggen). */
const FIRM_FIELDS = ["name", "orgNumber", "firmType", "notes"] as const;

/** Feltene på ett firma ut av kjernen. Ingen sporingsfelt, ingen organisasjon. */
const firmColumns = {
  id: firms.id,
  name: firms.name,
  orgNumber: firms.orgNumber,
  firmType: firms.firmType,
  notes: firms.notes,
};

/** Firma i organisasjonen som ikke er slettet, sortert på navn. Høyst 200, valgfritt søk. */
export async function listFirms(actor: Actor, organizationId: string, options: ListOptions = {}) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  const pattern = searchPattern(options.query);
  return db
    .select({
      id: firms.id,
      name: firms.name,
      orgNumber: firms.orgNumber,
      firmType: firms.firmType,
    })
    .from(firms)
    .where(
      and(
        eq(firms.organizationId, grant.organizationId),
        isNull(firms.deletedAt),
        pattern ? matchesAny(pattern, [firms.name, firms.orgNumber]) : undefined,
      ),
    )
    .orderBy(asc(firms.name), asc(firms.id))
    .limit(LIST_LIMIT);
}

/** Ett firma med kontaktene i firmaet (ikke slettede), sortert på etternavn og fornavn. */
export async function getFirm(actor: Actor, organizationId: string, firmId: string) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  if (!isUuid(firmId)) throw new AccessDeniedError();
  const [firm] = await db
    .select(firmColumns)
    .from(firms)
    .where(
      and(
        eq(firms.id, firmId),
        eq(firms.organizationId, grant.organizationId),
        isNull(firms.deletedAt),
      ),
    );
  if (!firm) throw new AccessDeniedError();

  const firmContacts = await db
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      phone: contacts.phone,
    })
    .from(contacts)
    .where(
      and(
        eq(contacts.firmId, firm.id),
        eq(contacts.organizationId, grant.organizationId),
        isNull(contacts.deletedAt),
      ),
    )
    .orderBy(asc(contacts.lastName), asc(contacts.firstName), asc(contacts.id));

  return { ...firm, contacts: firmContacts };
}

/**
 * Den unike indeksen er eneste vakt mot to aktive firma med samme organisasjonsnummer. Når den
 * slår til, er transaksjonen avbrutt; da slås firmaet som finnes opp (i samme organisasjon) og
 * `FirmDuplicateError` kastes med id og navn.
 */
async function withDuplicateCheck<T>(
  organizationId: string,
  values: FirmValues,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (!values.orgNumber || !isUniqueViolation(error, DUPLICATE_INDEX)) throw error;
    const [existing] = await db
      .select({ id: firms.id, name: firms.name })
      .from(firms)
      .where(
        and(
          eq(firms.organizationId, organizationId),
          eq(firms.orgNumber, values.orgNumber),
          isNull(firms.deletedAt),
        ),
      );
    if (!existing) throw error;
    throw new FirmDuplicateError(existing.id, existing.name);
  }
}

/** Legger inn et firma. Organisasjonsnummer som finnes gir `FirmDuplicateError`. */
export async function createFirm(actor: Actor, organizationId: string, input: FirmInput) {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  const values = firmInputSchema.parse(input);

  return withDuplicateCheck(grant.organizationId, values, () =>
    db.transaction(async (tx) => {
      const [row] = await tx
        .insert(firms)
        .values({ ...values, organizationId: grant.organizationId, createdBy: grant.employeeId })
        .returning(firmColumns);
      if (!row) throw new Error("Fant ikke firmaet etter at det ble lagret. Prøv igjen.");
      await recordAuditEvent(tx, grant, {
        entityType: "firm",
        entityId: row.id,
        action: "create",
        changes: { firmId: row.id, firmType: row.firmType },
      });
      return row;
    }),
  );
}

/** Endrer alle feltene på et firma. `row_version` økes med 1. */
export async function updateFirm(
  actor: Actor,
  organizationId: string,
  firmId: string,
  input: FirmInput,
) {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  const values = firmInputSchema.parse(input);
  if (!isUuid(firmId)) throw new AccessDeniedError();

  return withDuplicateCheck(grant.organizationId, values, () =>
    db.transaction(async (tx) => {
      const where = and(
        eq(firms.id, firmId),
        eq(firms.organizationId, grant.organizationId),
        isNull(firms.deletedAt),
      );
      const [before] = await tx.select(firmColumns).from(firms).where(where).for("update");
      if (!before) throw new AccessDeniedError();

      const [row] = await tx
        .update(firms)
        .set({ ...values, updatedBy: grant.employeeId })
        .where(where)
        .returning(firmColumns);
      if (!row) throw new AccessDeniedError();

      await recordAuditEvent(tx, grant, {
        entityType: "firm",
        entityId: row.id,
        action: "update",
        changes: {
          firmId: row.id,
          firmType: row.firmType,
          changedFields: FIRM_FIELDS.filter((field) => before[field] !== row[field]),
        },
      });
      return row;
    }),
  );
}
