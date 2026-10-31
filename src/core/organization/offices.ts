import { and, asc, eq, isNull } from "drizzle-orm";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { db } from "@/db/client";
import { offices } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { DuplicateOfficeNameError, isUniqueViolation } from "./errors";
import { officeInputSchema, type OfficeInput } from "./schemas";

/**
 * Kontorene i organisasjonen som ikke er slettet, sortert på rekkefølge og så navn.
 * Gir aldri sporingsfelt (createdBy/updatedBy/deletedBy), organizationId, rowVersion
 * eller tidsstempler.
 */
export async function listOffices(actor: Actor, organizationId: string) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  return db
    .select({
      id: offices.id,
      name: offices.name,
      address: offices.address,
      sortOrder: offices.sortOrder,
    })
    .from(offices)
    .where(and(eq(offices.organizationId, grant.organizationId), isNull(offices.deletedAt)))
    .orderBy(asc(offices.sortOrder), asc(offices.name));
}

const officeFields = ["name", "address", "sortOrder"] as const;

/** Gjør om brudd på unikt kontornavn til en norsk feil i stedet for en databasefeil. */
async function withOfficeNameCheck<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isUniqueViolation(error, "offices_organization_id_name_idx")) {
      throw new DuplicateOfficeNameError();
    }
    throw error;
  }
}

/** Oppretter et kontor. Bare admin (`organization.manage`). Revisjonslogg i samme transaksjon. */
export async function createOffice(actor: Actor, organizationId: string, input: OfficeInput) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  const values = officeInputSchema.parse(input);

  return withOfficeNameCheck(() =>
    db.transaction(async (tx) => {
      const [row] = await tx
        .insert(offices)
        .values({ ...values, organizationId: grant.organizationId, createdBy: grant.employeeId })
        .returning();
      if (!row) throw new Error("Fant ikke kontoret etter at det ble lagret. Prøv igjen.");
      await recordAuditEvent(tx, grant, {
        entityType: "office",
        entityId: row.id,
        action: "create",
        changes: { ...values },
      });
      return row;
    }),
  );
}

/**
 * Endrer et kontor. Bare admin. Fremmed, ukjent, slettet og ugyldig id gir `AccessDeniedError`.
 * `row_version` økes med 1.
 */
export async function updateOffice(
  actor: Actor,
  organizationId: string,
  officeId: string,
  input: OfficeInput,
) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  const values = officeInputSchema.parse(input);
  if (!isUuid(officeId)) throw new AccessDeniedError();

  return withOfficeNameCheck(() =>
    db.transaction(async (tx) => {
      const where = and(
        eq(offices.id, officeId),
        eq(offices.organizationId, grant.organizationId),
        isNull(offices.deletedAt),
      );
      const [before] = await tx.select().from(offices).where(where).for("update");
      if (!before) throw new AccessDeniedError();

      const [row] = await tx
        .update(offices)
        .set({ ...values, updatedBy: grant.employeeId })
        .where(where)
        .returning();
      if (!row) throw new AccessDeniedError();

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const field of officeFields) {
        if (before[field] !== row[field]) changes[field] = { from: before[field], to: row[field] };
      }
      await recordAuditEvent(tx, grant, {
        entityType: "office",
        entityId: row.id,
        action: "update",
        changes,
      });
      return row;
    }),
  );
}
