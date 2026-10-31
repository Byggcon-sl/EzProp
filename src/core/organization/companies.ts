import { and, asc, eq, isNull } from "drizzle-orm";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { db } from "@/db/client";
import { companies } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { DuplicateOrgNumberError, isUniqueViolation } from "./errors";
import { companyInputSchema, type CompanyInput } from "./schemas";

/**
 * Selskapene i organisasjonen som ikke er slettet, sortert på navn.
 * Gir aldri sporingsfelt (createdBy/updatedBy/deletedBy), organizationId, rowVersion
 * eller tidsstempler.
 */
export async function listCompanies(actor: Actor, organizationId: string) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  return db
    .select({
      id: companies.id,
      legalName: companies.legalName,
      orgNumber: companies.orgNumber,
      vatRegistered: companies.vatRegistered,
      address: companies.address,
      postalCode: companies.postalCode,
      city: companies.city,
      companyText: companies.companyText,
      liabilityInsurer: companies.liabilityInsurer,
      liabilityPolicyNumber: companies.liabilityPolicyNumber,
      liabilityValidTo: companies.liabilityValidTo,
    })
    .from(companies)
    .where(and(eq(companies.organizationId, grant.organizationId), isNull(companies.deletedAt)))
    .orderBy(asc(companies.legalName));
}

/** Feltene i skjemaet som lagres på selskapet, i fast rekkefølge (til revisjonsloggen). */
const companyFields = [
  "legalName",
  "orgNumber",
  "vatRegistered",
  "address",
  "postalCode",
  "city",
  "companyText",
  "liabilityInsurer",
  "liabilityPolicyNumber",
  "liabilityValidTo",
] as const;

/** Gjør om brudd på unikt org.nr. til en norsk feil i stedet for en databasefeil. */
async function withOrgNumberCheck<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isUniqueViolation(error, "companies_organization_id_org_number_idx")) {
      throw new DuplicateOrgNumberError();
    }
    throw error;
  }
}

/**
 * Oppretter et selskap. Bare admin (`organization.manage`). Revisjonsloggen får verdiene
 * (selskapsdata er ikke persontekst) i samme transaksjon.
 */
export async function createCompany(actor: Actor, organizationId: string, input: CompanyInput) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  const values = companyInputSchema.parse(input);

  return withOrgNumberCheck(() =>
    db.transaction(async (tx) => {
      const [row] = await tx
        .insert(companies)
        .values({ ...values, organizationId: grant.organizationId, createdBy: grant.employeeId })
        .returning();
      if (!row) throw new Error("Fant ikke selskapet etter at det ble lagret. Prøv igjen.");
      await recordAuditEvent(tx, grant, {
        entityType: "company",
        entityId: row.id,
        action: "create",
        changes: { ...values },
      });
      return row;
    }),
  );
}

/**
 * Endrer alle feltene på et selskap. Bare admin. Fremmed, ukjent, slettet og ugyldig id gir
 * `AccessDeniedError`. `row_version` økes med 1. Revisjonsloggen får gammel og ny verdi for
 * feltene som er endret.
 */
export async function updateCompany(
  actor: Actor,
  organizationId: string,
  companyId: string,
  input: CompanyInput,
) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  const values = companyInputSchema.parse(input);
  if (!isUuid(companyId)) throw new AccessDeniedError();

  return withOrgNumberCheck(() =>
    db.transaction(async (tx) => {
      const where = and(
        eq(companies.id, companyId),
        eq(companies.organizationId, grant.organizationId),
        isNull(companies.deletedAt),
      );
      const [before] = await tx.select().from(companies).where(where).for("update");
      if (!before) throw new AccessDeniedError();

      const [row] = await tx
        .update(companies)
        .set({ ...values, updatedBy: grant.employeeId })
        .where(where)
        .returning();
      if (!row) throw new AccessDeniedError();

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const field of companyFields) {
        if (before[field] !== row[field]) changes[field] = { from: before[field], to: row[field] };
      }
      await recordAuditEvent(tx, grant, {
        entityType: "company",
        entityId: row.id,
        action: "update",
        changes,
      });
      return row;
    }),
  );
}
