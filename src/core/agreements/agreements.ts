import { and, asc, eq, isNull } from "drizzle-orm";
import { requireOrganizationAccess, type Actor, type EmployeeGrant } from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { db, type DbExecutor } from "@/db/client";
import { clientAgreements, firms } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { NotFoundError } from "./errors";
import { agreementSchema, type AgreementInput } from "./schemas";

/*
 * Avtaler med oppdragsgiver (docs/funksjoner/fase2a-oppdragsgiveravtale.md). Alle ser dem
 * (`organization.read`); bare admin oppretter, endrer og fjerner (`organization.manage`, A108).
 * All filtrering bruker `grant.organizationId` fra tilgangssjekken, aldri parameteren. Ukjent,
 * fremmed, slettet eller ugyldig id gir `NotFoundError`. Ingen permanent sletting.
 *
 * Revisjonsloggen får bare id-er og navnene på feltene som ble endret, aldri premisseteksten
 * (A112).
 */

const AGREEMENT_NOT_FOUND = "Fant ikke avtalen.";
const FIRM_NOT_FOUND = "Firmaet finnes ikke.";

/** Feltene som kan endres, i fast rekkefølge (navnene går til revisjonsloggen). */
const AGREEMENT_FIELDS = [
  "firmId",
  "name",
  "validFrom",
  "validTo",
  "premiseText",
  "reportProfileCode",
] as const;

/** Feltene på én avtale ut av kjernen. Ingen sporingsfelt utover sletting. */
const agreementColumns = {
  id: clientAgreements.id,
  organizationId: clientAgreements.organizationId,
  firmId: clientAgreements.firmId,
  name: clientAgreements.name,
  validFrom: clientAgreements.validFrom,
  validTo: clientAgreements.validTo,
  premiseText: clientAgreements.premiseText,
  reportProfileCode: clientAgreements.reportProfileCode,
  deletedAt: clientAgreements.deletedAt,
};

export type AgreementListItem = {
  id: string;
  firmId: string;
  firmName: string | null;
  name: string;
  validFrom: string;
  validTo: string | null;
  reportProfileCode: string | null;
};

/**
 * Avtalene i organisasjonen som ikke er fjernet, sortert på navn, med firmaets navn. Utløpte
 * avtaler er med; merket regnes ut i siden.
 */
export async function listAgreements(
  actor: Actor,
  organizationId: string,
): Promise<AgreementListItem[]> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  const orgId = grant.organizationId;
  return db
    .select({
      id: clientAgreements.id,
      firmId: clientAgreements.firmId,
      firmName: firms.name,
      name: clientAgreements.name,
      validFrom: clientAgreements.validFrom,
      validTo: clientAgreements.validTo,
      reportProfileCode: clientAgreements.reportProfileCode,
    })
    .from(clientAgreements)
    .leftJoin(firms, and(eq(firms.id, clientAgreements.firmId), eq(firms.organizationId, orgId)))
    .where(and(eq(clientAgreements.organizationId, orgId), isNull(clientAgreements.deletedAt)))
    .orderBy(asc(clientAgreements.name), asc(clientAgreements.id));
}

/** Én avtale med firmaets navn og premisseteksten. Fjernet avtale gir `NotFoundError`. */
export async function getAgreement(actor: Actor, organizationId: string, agreementId: string) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  if (!isUuid(agreementId)) throw new NotFoundError(AGREEMENT_NOT_FOUND);
  const orgId = grant.organizationId;
  const [row] = await db
    .select({ ...agreementColumns, firmName: firms.name })
    .from(clientAgreements)
    .leftJoin(firms, and(eq(firms.id, clientAgreements.firmId), eq(firms.organizationId, orgId)))
    .where(
      and(
        eq(clientAgreements.id, agreementId),
        eq(clientAgreements.organizationId, orgId),
        isNull(clientAgreements.deletedAt),
      ),
    );
  if (!row) throw new NotFoundError(AGREEMENT_NOT_FOUND);
  return row;
}

/** Firmaet må finnes i organisasjonen og ikke være slettet. Ellers `NotFoundError`. */
async function requireFirm(tx: DbExecutor, grant: EmployeeGrant, firmId: string) {
  const [firm] = await tx
    .select({ id: firms.id })
    .from(firms)
    .where(
      and(
        eq(firms.id, firmId),
        eq(firms.organizationId, grant.organizationId),
        isNull(firms.deletedAt),
      ),
    );
  if (!firm) throw new NotFoundError(FIRM_NOT_FOUND);
}

/** Legger inn en avtale for et firma i organisasjonen. */
export async function createAgreement(actor: Actor, organizationId: string, input: AgreementInput) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  const values = agreementSchema.parse(input);

  return db.transaction(async (tx) => {
    await requireFirm(tx, grant, values.firmId);
    const [row] = await tx
      .insert(clientAgreements)
      .values({ ...values, organizationId: grant.organizationId, createdBy: grant.employeeId })
      .returning(agreementColumns);
    if (!row) throw new Error("Fant ikke avtalen etter at den ble lagret. Prøv igjen.");
    await recordAuditEvent(tx, grant, {
      entityType: "client_agreement",
      entityId: row.id,
      action: "create",
      changes: { agreementId: row.id, firmId: row.firmId },
    });
    return row;
  });
}

/** Endrer alle feltene på en avtale. Fjernet avtale gir `NotFoundError` og ingen loggrad. */
export async function updateAgreement(
  actor: Actor,
  organizationId: string,
  agreementId: string,
  input: AgreementInput,
) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  const values = agreementSchema.parse(input);
  if (!isUuid(agreementId)) throw new NotFoundError(AGREEMENT_NOT_FOUND);

  return db.transaction(async (tx) => {
    const where = and(
      eq(clientAgreements.id, agreementId),
      eq(clientAgreements.organizationId, grant.organizationId),
      isNull(clientAgreements.deletedAt),
    );
    const [before] = await tx
      .select(agreementColumns)
      .from(clientAgreements)
      .where(where)
      .for("update");
    if (!before) throw new NotFoundError(AGREEMENT_NOT_FOUND);
    await requireFirm(tx, grant, values.firmId);

    const [row] = await tx
      .update(clientAgreements)
      .set({ ...values, updatedBy: grant.employeeId })
      .where(where)
      .returning(agreementColumns);
    if (!row) throw new NotFoundError(AGREEMENT_NOT_FOUND);

    await recordAuditEvent(tx, grant, {
      entityType: "client_agreement",
      entityId: row.id,
      action: "update",
      changes: {
        agreementId: row.id,
        firmId: row.firmId,
        changedFields: AGREEMENT_FIELDS.filter((field) => before[field] !== row[field]),
        // Aldri verdiene: premisseteksten er fritekst og loggen ryddes aldri (A112).
      },
    });
    return row;
  });
}

/**
 * Fjerner avtalen (myk sletting). Oppdrag som har den, beholder den med merket «Slettet»
 * (A111). Allerede fjernet avtale gir `NotFoundError` og ingen loggrad.
 */
export async function deleteAgreement(actor: Actor, organizationId: string, agreementId: string) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  if (!isUuid(agreementId)) throw new NotFoundError(AGREEMENT_NOT_FOUND);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(clientAgreements)
      .set({ deletedAt: new Date(), deletedBy: grant.employeeId, updatedBy: grant.employeeId })
      .where(
        and(
          eq(clientAgreements.id, agreementId),
          eq(clientAgreements.organizationId, grant.organizationId),
          isNull(clientAgreements.deletedAt),
        ),
      )
      .returning(agreementColumns);
    if (!row) throw new NotFoundError(AGREEMENT_NOT_FOUND);
    await recordAuditEvent(tx, grant, {
      entityType: "client_agreement",
      entityId: row.id,
      action: "delete",
      changes: { agreementId: row.id, firmId: row.firmId },
    });
    return row;
  });
}
