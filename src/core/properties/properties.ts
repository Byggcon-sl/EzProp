import { and, asc, eq, isNull } from "drizzle-orm";
import {
  AccessDeniedError,
  requireOrganizationAccess,
  type Actor,
  type EmployeeGrant,
} from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { recordEvent } from "@/core/events";
import { db, type DbExecutor } from "@/db/client";
import { assignments, cadastralUnits, commonAreas, orders, properties } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { hasCommonAreas } from "./codes";
import { CommonAreasNotApplicableError } from "./errors";
import {
  commonAreasInputSchema,
  propertyInputSchema,
  type CommonAreasInput,
  type CommonAreasValues,
  type PropertyInput,
  type PropertyValues,
} from "./schemas";

/*
 * Eiendommen og fellesdelene på oppdraget (docs/05-domenemodell.md 4.4). Lagt inn for hånd,
 * forhåndsutfylt fra ordren (`data_source = manual`). Lesing med `organization.read`, endring med
 * `assignment.edit`. All filtrering bruker `grant.organizationId`, aldri en id fra skjemaet; en
 * `propertyId` i input leses aldri. Hendelser og revisjonslogg har bare id-er, kodene og navnene
 * på feltene som er endret, aldri adresse, matrikkelnummer, borettslag, andelsnummer,
 * forretningsfører eller notater (raden er kilden).
 *
 * Myk-slettet eiendom regnes som at eiendom mangler: lesing gir `property = null` og
 * forhåndsutfylling, lagring lager en ny eiendom og flytter `assignments.property_id`.
 * Fellesdeler vises bare når `hasCommonAreas` er sann for eiendommen; raden slettes aldri.
 */

export type CadastralUnitDetail = {
  id: string;
  gnr: string;
  bnr: string;
  fnr: string | null;
  snr: string | null;
  associationName: string | null;
  associationOrgNumber: string | null;
  shareNumber: string | null;
};

export type PropertyDetail = {
  id: string;
  address: string;
  postalCode: string | null;
  city: string | null;
  municipalityNumber: string | null;
  municipalityName: string | null;
  housingType: string;
  ownershipForm: string;
  dataSource: string;
  /** Den eldste matrikkelraden som ikke er slettet (A65). */
  cadastralUnit: CadastralUnitDetail | null;
};

export type CommonAreasDetail = {
  id: string;
  managingAgent: string | null;
  conditionReportStatus: string;
  maintenancePlanStatus: string;
  notes: string | null;
};

/** Verdiene fra ordren som fyller ut skjemaet når eiendom mangler. Tom = `null`. */
export type PropertyPrefill = {
  address: string | null;
  gnr: string | null;
  bnr: string | null;
  snr: string | null;
  associationName: string | null;
};

export type AssignmentProperty = {
  property: PropertyDetail | null;
  /** `null` når raden mangler, eller når eiendommen ikke har fellesdeler (A67). */
  commonAreas: CommonAreasDetail | null;
  /** Fra ordren når eiendom mangler, ellers tomme verdier. Adressen deles ikke opp (A68). */
  prefill: PropertyPrefill;
};

const EMPTY_PREFILL: PropertyPrefill = {
  address: null,
  gnr: null,
  bnr: null,
  snr: null,
  associationName: null,
};

const PROPERTY_FIELDS = [
  "address",
  "postalCode",
  "city",
  "municipalityNumber",
  "municipalityName",
  "housingType",
  "ownershipForm",
] as const satisfies readonly (keyof PropertyValues)[];

const CADASTRAL_FIELDS = [
  "gnr",
  "bnr",
  "fnr",
  "snr",
  "associationName",
  "associationOrgNumber",
  "shareNumber",
] as const satisfies readonly (keyof PropertyValues)[];

const COMMON_AREAS_FIELDS = [
  "managingAgent",
  "conditionReportStatus",
  "maintenancePlanStatus",
  "notes",
] as const satisfies readonly (keyof CommonAreasValues)[];

/** Felt der verdien kan stå i revisjonsloggen (bare faste koder). */
const LOGGABLE_FIELDS = new Set<string>([
  "housingType",
  "ownershipForm",
  "conditionReportStatus",
  "maintenancePlanStatus",
]);

const propertyColumns = {
  id: properties.id,
  address: properties.address,
  postalCode: properties.postalCode,
  city: properties.city,
  municipalityNumber: properties.municipalityNumber,
  municipalityName: properties.municipalityName,
  housingType: properties.housingType,
  ownershipForm: properties.ownershipForm,
  dataSource: properties.dataSource,
};

const cadastralColumns = {
  id: cadastralUnits.id,
  gnr: cadastralUnits.gnr,
  bnr: cadastralUnits.bnr,
  fnr: cadastralUnits.fnr,
  snr: cadastralUnits.snr,
  associationName: cadastralUnits.associationName,
  associationOrgNumber: cadastralUnits.associationOrgNumber,
  shareNumber: cadastralUnits.shareNumber,
};

const commonAreasColumns = {
  id: commonAreas.id,
  managingAgent: commonAreas.managingAgent,
  conditionReportStatus: commonAreas.conditionReportStatus,
  maintenancePlanStatus: commonAreas.maintenancePlanStatus,
  notes: commonAreas.notes,
};

/** Navnene på feltene som er endret, og fra/til bare for de faste kodene. */
function describeChanges<T extends string>(
  fields: readonly T[],
  before: Record<T, unknown>,
  after: Record<T, unknown>,
): { fields: T[]; codes: Record<string, { from: unknown; to: unknown }> } {
  const changed = fields.filter((field) => before[field] !== after[field]);
  const codes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of changed) {
    if (LOGGABLE_FIELDS.has(field)) codes[field] = { from: before[field], to: after[field] };
  }
  return { fields: changed, codes };
}

function propertyPart(values: PropertyValues) {
  return {
    address: values.address,
    postalCode: values.postalCode,
    city: values.city,
    municipalityNumber: values.municipalityNumber,
    municipalityName: values.municipalityName,
    housingType: values.housingType,
    ownershipForm: values.ownershipForm,
  } satisfies Record<(typeof PROPERTY_FIELDS)[number], unknown>;
}

function cadastralPart(values: PropertyValues) {
  return {
    gnr: values.gnr,
    bnr: values.bnr,
    fnr: values.fnr,
    snr: values.snr,
    associationName: values.associationName,
    associationOrgNumber: values.associationOrgNumber,
    shareNumber: values.shareNumber,
  } satisfies Record<(typeof CADASTRAL_FIELDS)[number], unknown>;
}

/**
 * Henter og låser oppdraget (`FOR UPDATE`) i transaksjonen, i organisasjonen fra tilgangssjekken
 * og ikke slettet. Ellers `AccessDeniedError`.
 */
async function lockAssignment(tx: DbExecutor, grant: EmployeeGrant, assignmentId: string) {
  const [row] = await tx
    .select({ id: assignments.id, propertyId: assignments.propertyId })
    .from(assignments)
    .where(
      and(
        eq(assignments.id, assignmentId),
        eq(assignments.organizationId, grant.organizationId),
        isNull(assignments.deletedAt),
      ),
    )
    .for("update");
  if (!row) throw new AccessDeniedError();
  return row;
}

/** Eiendommen som ikke er slettet, i organisasjonen. */
async function findProperty(tx: DbExecutor, organizationId: string, propertyId: string | null) {
  if (propertyId === null) return null;
  const [row] = await tx
    .select(propertyColumns)
    .from(properties)
    .where(
      and(
        eq(properties.id, propertyId),
        eq(properties.organizationId, organizationId),
        isNull(properties.deletedAt),
      ),
    );
  return row ?? null;
}

/** Den eldste matrikkelraden som ikke er slettet (A65). */
async function findCadastralUnit(tx: DbExecutor, organizationId: string, propertyId: string) {
  const [row] = await tx
    .select(cadastralColumns)
    .from(cadastralUnits)
    .where(
      and(
        eq(cadastralUnits.organizationId, organizationId),
        eq(cadastralUnits.propertyId, propertyId),
        isNull(cadastralUnits.deletedAt),
      ),
    )
    .orderBy(asc(cadastralUnits.createdAt), asc(cadastralUnits.id))
    .limit(1);
  return row ?? null;
}

/** Fellesdelsraden for oppdraget som ikke er slettet. */
async function findCommonAreas(tx: DbExecutor, organizationId: string, assignmentId: string) {
  const [row] = await tx
    .select(commonAreasColumns)
    .from(commonAreas)
    .where(
      and(
        eq(commonAreas.organizationId, organizationId),
        eq(commonAreas.assignmentId, assignmentId),
        isNull(commonAreas.deletedAt),
      ),
    );
  return row ?? null;
}

/**
 * Eiendommen på oppdraget med én matrikkelrad, fellesdelene (når de gjelder) og
 * forhåndsutfyllingen fra ordren. Ukjent, fremmed, slettet eller ugyldig oppdrags-id gir
 * `AccessDeniedError`.
 */
export async function getAssignmentProperty(
  actor: Actor,
  organizationId: string,
  assignmentId: string,
): Promise<AssignmentProperty> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  if (!isUuid(assignmentId)) throw new AccessDeniedError();
  const orgId = grant.organizationId;

  const [assignment] = await db
    .select({
      id: assignments.id,
      propertyId: assignments.propertyId,
      orderAddress: orders.addressText,
      orderGnr: orders.gnr,
      orderBnr: orders.bnr,
      orderSnr: orders.snr,
      orderAssociationName: orders.housingAssociationName,
    })
    .from(assignments)
    .leftJoin(
      orders,
      and(
        eq(orders.id, assignments.orderId),
        eq(orders.organizationId, orgId),
        isNull(orders.deletedAt),
      ),
    )
    .where(
      and(
        eq(assignments.id, assignmentId),
        eq(assignments.organizationId, orgId),
        isNull(assignments.deletedAt),
      ),
    )
    .limit(1);
  if (!assignment) throw new AccessDeniedError();

  const property = await findProperty(db, orgId, assignment.propertyId);
  if (!property) {
    return {
      property: null,
      commonAreas: null,
      prefill: {
        address: assignment.orderAddress ?? null,
        gnr: assignment.orderGnr ?? null,
        bnr: assignment.orderBnr ?? null,
        snr: assignment.orderSnr ?? null,
        associationName: assignment.orderAssociationName ?? null,
      },
    };
  }

  const [cadastralUnit, areas] = await Promise.all([
    findCadastralUnit(db, orgId, property.id),
    hasCommonAreas(property) ? findCommonAreas(db, orgId, assignment.id) : null,
  ]);

  return {
    property: { ...property, cadastralUnit },
    commonAreas: areas,
    prefill: EMPTY_PREFILL,
  };
}

/**
 * Lagrer eiendommen på oppdraget. Første gang (eller når eiendommen er slettet) lages eiendom og
 * matrikkelrad, og `assignments.property_id` settes; ellers oppdateres de to radene. Uten
 * endringer skrives ingenting (ingen hendelse). Oppdraget låses først, så to samtidige første
 * lagringer gir én eiendom.
 */
export async function saveAssignmentProperty(
  actor: Actor,
  organizationId: string,
  assignmentId: string,
  input: PropertyInput,
): Promise<{ id: string; created: boolean; changed: boolean }> {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  const values = propertyInputSchema.parse(input);
  if (!isUuid(assignmentId)) throw new AccessDeniedError();
  const orgId = grant.organizationId;
  const propertyValues = propertyPart(values);
  const cadastralValues = cadastralPart(values);

  return db.transaction(async (tx) => {
    const assignment = await lockAssignment(tx, grant, assignmentId);
    const existing = await findProperty(tx, orgId, assignment.propertyId);

    // (1) Ingen eiendom (eller slettet): lag eiendom og matrikkelrad, og koble til oppdraget
    if (!existing) {
      const [property] = await tx
        .insert(properties)
        .values({
          ...propertyValues,
          organizationId: orgId,
          dataSource: "manual",
          createdBy: grant.employeeId,
        })
        .returning({ id: properties.id });
      if (!property) throw new Error("Fant ikke eiendommen etter at den ble lagret. Prøv igjen.");
      const [unit] = await tx
        .insert(cadastralUnits)
        .values({
          ...cadastralValues,
          organizationId: orgId,
          propertyId: property.id,
          createdBy: grant.employeeId,
        })
        .returning({ id: cadastralUnits.id });
      if (!unit) throw new Error("Fant ikke matrikkelen etter at den ble lagret. Prøv igjen.");
      await tx
        .update(assignments)
        .set({ propertyId: property.id, updatedBy: grant.employeeId })
        .where(and(eq(assignments.id, assignment.id), eq(assignments.organizationId, orgId)));

      await recordAuditEvent(tx, grant, {
        entityType: "property",
        entityId: property.id,
        action: "create",
        changes: {
          assignmentId: assignment.id,
          housingType: values.housingType,
          ownershipForm: values.ownershipForm,
          dataSource: "manual",
        },
      });
      await recordAuditEvent(tx, grant, {
        entityType: "cadastral_unit",
        entityId: unit.id,
        action: "create",
        changes: { assignmentId: assignment.id, propertyId: property.id },
      });
      await recordEvent(tx, grant, {
        type: "assignment.property_saved",
        assignmentId: assignment.id,
        data: { propertyId: property.id, created: true },
      });
      return { id: property.id, created: true, changed: true };
    }

    // (2) Eiendommen finnes: oppdater det som er endret
    const unit = await findCadastralUnit(tx, orgId, existing.id);
    const propertyChanges = describeChanges(PROPERTY_FIELDS, existing, propertyValues);
    const cadastralChanges = unit ? describeChanges(CADASTRAL_FIELDS, unit, cadastralValues) : null;
    if (
      propertyChanges.fields.length === 0 &&
      cadastralChanges !== null &&
      cadastralChanges.fields.length === 0
    ) {
      return { id: existing.id, created: false, changed: false };
    }

    if (propertyChanges.fields.length > 0) {
      await tx
        .update(properties)
        .set({ ...propertyValues, updatedBy: grant.employeeId })
        .where(and(eq(properties.id, existing.id), eq(properties.organizationId, orgId)));
      await recordAuditEvent(tx, grant, {
        entityType: "property",
        entityId: existing.id,
        action: "update",
        changes: {
          assignmentId: assignment.id,
          fields: propertyChanges.fields,
          ...propertyChanges.codes,
        },
      });
    }

    if (!unit) {
      // Matrikkelraden er slettet: lag en ny på samme eiendom
      const [created] = await tx
        .insert(cadastralUnits)
        .values({
          ...cadastralValues,
          organizationId: orgId,
          propertyId: existing.id,
          createdBy: grant.employeeId,
        })
        .returning({ id: cadastralUnits.id });
      if (!created) throw new Error("Fant ikke matrikkelen etter at den ble lagret. Prøv igjen.");
      await recordAuditEvent(tx, grant, {
        entityType: "cadastral_unit",
        entityId: created.id,
        action: "create",
        changes: { assignmentId: assignment.id, propertyId: existing.id },
      });
    } else if (cadastralChanges && cadastralChanges.fields.length > 0) {
      await tx
        .update(cadastralUnits)
        .set({ ...cadastralValues, updatedBy: grant.employeeId })
        .where(and(eq(cadastralUnits.id, unit.id), eq(cadastralUnits.organizationId, orgId)));
      await recordAuditEvent(tx, grant, {
        entityType: "cadastral_unit",
        entityId: unit.id,
        action: "update",
        changes: {
          assignmentId: assignment.id,
          propertyId: existing.id,
          fields: cadastralChanges.fields,
        },
      });
    }

    await recordEvent(tx, grant, {
      type: "assignment.property_saved",
      assignmentId: assignment.id,
      data: { propertyId: existing.id, created: false },
    });
    return { id: existing.id, created: false, changed: true };
  });
}

/**
 * Lagrer fellesdelene på oppdraget: lager raden første gang, ellers oppdateres den. Krever at
 * oppdraget har en eiendom med fellesdeler (`hasCommonAreas`), ellers
 * `CommonAreasNotApplicableError`. Uten endringer skrives ingenting (ingen hendelse).
 */
export async function saveCommonAreas(
  actor: Actor,
  organizationId: string,
  assignmentId: string,
  input: CommonAreasInput,
): Promise<{ id: string; created: boolean; changed: boolean }> {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  const values = commonAreasInputSchema.parse(input);
  if (!isUuid(assignmentId)) throw new AccessDeniedError();
  const orgId = grant.organizationId;

  return db.transaction(async (tx) => {
    const assignment = await lockAssignment(tx, grant, assignmentId);
    const property = await findProperty(tx, orgId, assignment.propertyId);
    if (!property || !hasCommonAreas(property)) throw new CommonAreasNotApplicableError();

    const existing = await findCommonAreas(tx, orgId, assignment.id);
    if (!existing) {
      const [row] = await tx
        .insert(commonAreas)
        .values({
          ...values,
          organizationId: orgId,
          assignmentId: assignment.id,
          createdBy: grant.employeeId,
        })
        .returning({ id: commonAreas.id });
      if (!row) throw new Error("Fant ikke fellesdelene etter at de ble lagret. Prøv igjen.");
      await recordAuditEvent(tx, grant, {
        entityType: "common_areas",
        entityId: row.id,
        action: "create",
        changes: {
          assignmentId: assignment.id,
          conditionReportStatus: values.conditionReportStatus,
          maintenancePlanStatus: values.maintenancePlanStatus,
        },
      });
      await recordEvent(tx, grant, {
        type: "assignment.common_areas_saved",
        assignmentId: assignment.id,
        data: { commonAreasId: row.id, created: true },
      });
      return { id: row.id, created: true, changed: true };
    }

    const changes = describeChanges(COMMON_AREAS_FIELDS, existing, values);
    if (changes.fields.length === 0) return { id: existing.id, created: false, changed: false };

    await tx
      .update(commonAreas)
      .set({ ...values, updatedBy: grant.employeeId })
      .where(and(eq(commonAreas.id, existing.id), eq(commonAreas.organizationId, orgId)));
    await recordAuditEvent(tx, grant, {
      entityType: "common_areas",
      entityId: existing.id,
      action: "update",
      changes: { assignmentId: assignment.id, fields: changes.fields, ...changes.codes },
    });
    await recordEvent(tx, grant, {
      type: "assignment.common_areas_saved",
      assignmentId: assignment.id,
      data: { commonAreasId: existing.id, created: false },
    });
    return { id: existing.id, created: false, changed: true };
  });
}
