import { randomUUID } from "node:crypto";
import { count, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { AccessDeniedError, type Actor } from "@/core/access";
import {
  CommonAreasNotApplicableError,
  getAssignmentProperty,
  saveAssignmentProperty,
  saveCommonAreas,
} from "@/core/properties";
import { db } from "@/db/client";
import {
  assignments,
  auditLog,
  cadastralUnits,
  commonAreas,
  employees,
  events,
  organizations,
  properties,
  type EmployeeRole,
} from "@/db/schema";
import {
  createAssignment,
  createCommonAreas,
  createEmployee,
  createOffice,
  createOrder,
  createOrganization,
  createProperty,
  createUser,
  grantPermission,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";

/*
 * Eiendom, matrikkel og fellesdeler på oppdraget: kjernen i src/core/properties.
 * Testplan: docs/funksjoner/fase2a-eiendom-matrikkel-testplan.md avsnitt 4. 4.7.5 (feil i
 * hendelsen eller loggen ruller tilbake) står i properties-transaction.test.ts.
 *
 * Signaturene er fra kortet punkt 7:
 * - getAssignmentProperty(actor, organizationId, assignmentId) → { property | null,
 *   commonAreas | null, prefill: { address, gnr, bnr, snr, associationName } }
 * - saveAssignmentProperty(actor, organizationId, assignmentId, input)
 * - saveCommonAreas(actor, organizationId, assignmentId, input)
 * Kortet sier ikke om matrikkelraden står flatt i `property` eller som et eget objekt; testene
 * leser begge (`flatProperty`). Returverdien fra lagringen brukes ikke; testene leser databasen.
 *
 * Avgjørelser etter gjennomgangen (kortet): slettet eiendom regnes som manglende (ny eiendom ved
 * lagring, den slettede står urørt), og fellesdeler som ikke gjelder gir `commonAreas = null`
 * uten at raden slettes.
 *
 * Testdata er oppdiktet: «Testveien 1», 0000, «Testby», 0000, «Testkommune», gnr/bnr 999, fnr 0,
 * snr 9, «Borettslaget Test», 000000000, 0-0, «Forvalter Test», «Sett trapperom og kjeller».
 *
 * Støtter hovedmål: reklamasjoner (faste koder, fellesdeler bare der de gjelder, aldri data fra en
 * annen organisasjon, aldri adresse eller fritekst i hendelser og logg), tid (forhåndsutfylling
 * fra ordren) og KI først (`data_source = manual`, feltene har samme form som et senere oppslag).
 */

beforeEach(resetDatabase);

const ADDRESS = "Testveien 1";
const POSTAL = "0000";
const CITY = "Testby";
const MUNICIPALITY_NUMBER = "0000";
const MUNICIPALITY = "Testkommune";
const GNR = "999";
const BNR = "999";
const FNR = "0";
const SNR = "9";
const ASSOCIATION = "Borettslaget Test";
const ORG_NUMBER = "000000000";
const SHARE = "0-0";
const AGENT = "Forvalter Test";
const NOTES = "Sett trapperom og kjeller";
const DELETED_AT = new Date("2026-11-03T09:00:00Z");

type PropertyInput = Parameters<typeof saveAssignmentProperty>[3];
type CommonAreasInput = Parameters<typeof saveCommonAreas>[3];

/** Full eiendom: leilighet i borettslag (fellesdeler gjelder). */
const APARTMENT_INPUT = {
  address: ADDRESS,
  postalCode: POSTAL,
  city: CITY,
  municipalityNumber: MUNICIPALITY_NUMBER,
  municipalityName: MUNICIPALITY,
  housingType: "apartment",
  ownershipForm: "cooperative",
  gnr: GNR,
  bnr: BNR,
  fnr: FNR,
  snr: SNR,
  associationName: ASSOCIATION,
  associationOrgNumber: ORG_NUMBER,
  shareNumber: SHARE,
};

function propertyInput(overrides: Record<string, unknown> = {}): PropertyInput {
  return { ...APARTMENT_INPUT, ...overrides } as unknown as PropertyInput;
}

function detachedInput(overrides: Record<string, unknown> = {}): PropertyInput {
  return propertyInput({
    housingType: "detached",
    ownershipForm: "freehold",
    associationName: "",
    associationOrgNumber: "",
    shareNumber: "",
    snr: "",
    ...overrides,
  });
}

function commonInput(overrides: Record<string, unknown> = {}): CommonAreasInput {
  return {
    managingAgent: AGENT,
    conditionReportStatus: "yes",
    maintenancePlanStatus: "unknown",
    notes: NOTES,
    ...overrides,
  } as unknown as CommonAreasInput;
}

async function setInspectorsEditAll(organizationId: string, value: boolean) {
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": value } })
    .where(eq(organizations.id, organizationId));
}

/** Organisasjon med admin, ett kontor og ett oppdrag uten eiendom. */
async function orgWithAdmin(name = "Testfirma takst") {
  const org = await createOrganization(name);
  const admin = await createUser({ name: "Test Admin" });
  const adminEmployee = await createEmployee(admin, org.id, ["admin"]);
  const office = await createOffice(org.id, { name: "Testkontor Bodø" });
  const assignment = await createAssignment(org.id, { officeId: office.id });
  return { org, admin, adminEmployee, office, assignment };
}

/** En person med rollene i organisasjonen. */
async function person(organizationId: string, roles: EmployeeRole[], name?: string) {
  const actor = await createUser(name ? { name } : {});
  const employee = await createEmployee(actor, organizationId, roles);
  return { actor, employee };
}

/**
 * Et oppdrag gjort om fra en ordre: ordren er `converted` og peker på oppdraget, og oppdraget
 * peker på ordren (begge retninger, som når kontoret gjør om ordren).
 */
async function assignmentFromOrder(
  organizationId: string,
  officeId: string,
  orderValues: Parameters<typeof createOrder>[1],
) {
  const assignment = await createAssignment(organizationId, { officeId });
  const order = await createOrder(organizationId, {
    ...orderValues,
    status: "converted",
    assignmentId: assignment.id,
  });
  await db.update(assignments).set({ orderId: order.id }).where(eq(assignments.id, assignment.id));
  return { ...assignment, orderId: order.id };
}

/** Leilighet i borettslag på oppdraget (fellesdeler gjelder). */
async function apartmentOn(organizationId: string, assignmentId: string) {
  return createProperty(organizationId, {
    assignmentId,
    housingType: "apartment",
    ownershipForm: "cooperative",
    associationName: ASSOCIATION,
  });
}

type CountedTable =
  typeof properties | typeof cadastralUnits | typeof commonAreas | typeof events | typeof auditLog;

async function rowCount(table: CountedTable) {
  const [row] = await db.select({ n: count() }).from(table);
  return row?.n ?? 0;
}

async function tableCounts() {
  return {
    properties: await rowCount(properties),
    cadastralUnits: await rowCount(cadastralUnits),
    commonAreas: await rowCount(commonAreas),
    events: await rowCount(events),
    auditLog: await rowCount(auditLog),
  };
}

async function assignmentRow(id: string) {
  const [row] = await db.select().from(assignments).where(eq(assignments.id, id));
  if (!row) throw new Error("fant ikke oppdraget");
  return row;
}

async function propertyRow(id: string) {
  const [row] = await db.select().from(properties).where(eq(properties.id, id));
  if (!row) throw new Error("fant ikke eiendommen");
  return row;
}

async function propertiesIn(organizationId: string) {
  return db.select().from(properties).where(eq(properties.organizationId, organizationId));
}

async function cadastralFor(propertyId: string) {
  return db.select().from(cadastralUnits).where(eq(cadastralUnits.propertyId, propertyId));
}

async function commonRowsFor(assignmentId: string) {
  return db.select().from(commonAreas).where(eq(commonAreas.assignmentId, assignmentId));
}

async function eventsFor(organizationId: string, type?: string) {
  const rows = await db.select().from(events).where(eq(events.organizationId, organizationId));
  return rows.filter((row) => type === undefined || row.type === type);
}

async function auditFor(organizationId: string, entityType?: string) {
  const rows = await db.select().from(auditLog).where(eq(auditLog.organizationId, organizationId));
  return rows.filter((row) => entityType === undefined || row.entityType === entityType);
}

/** Fanger feilen fra en handling som skal feile. */
async function caught(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => null,
    (error: unknown) => error,
  );
}

type Result = Awaited<ReturnType<typeof getAssignmentProperty>>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date)
  );
}

/**
 * Eiendommen med matrikkelraden flatt, uansett om kjernen legger raden i et eget objekt
 * (`cadastralUnit`) eller rett i `property`. Eiendommens `id` vinner over matrikkelradens.
 */
function flatProperty(property: Result["property"]): Record<string, unknown> {
  if (!property) throw new Error("eiendommen mangler i svaret");
  const own = property as unknown as Record<string, unknown>;
  const flat: Record<string, unknown> = {};
  for (const value of Object.values(own)) {
    if (isPlainObject(value)) {
      for (const [inner, innerValue] of Object.entries(value)) {
        if (inner !== "id") flat[inner] = innerValue;
      }
    } else if (Array.isArray(value) && value.length > 0 && isPlainObject(value[0])) {
      for (const [inner, innerValue] of Object.entries(value[0])) {
        if (inner !== "id") flat[inner] = innerValue;
      }
    }
  }
  for (const [key, value] of Object.entries(own)) {
    if (!isPlainObject(value) && !Array.isArray(value)) flat[key] = value;
  }
  return flat;
}

function isBlank(value: unknown) {
  return value === null || value === undefined || value === "";
}

function expectBlankPrefill(prefill: Result["prefill"] | undefined) {
  if (prefill === undefined || prefill === null) return;
  for (const [key, value] of Object.entries(prefill)) {
    expect(isBlank(value), `prefill.${key} er tom`).toBe(true);
  }
}

// ---------------------------------------------------------------------------------------------
// 4.1 Tilgang per rolle (innstillingen på og av)
// ---------------------------------------------------------------------------------------------

type RoleCase = { name: string; roles: EmployeeRole[] };

const ROLE_CASES: RoleCase[] = [
  { name: "takstmann", roles: ["inspector"] },
  { name: "kontor", roles: ["office"] },
  { name: "leder", roles: ["manager"] },
  { name: "admin", roles: ["admin"] },
];

const SETTINGS = [
  { setting: "på", editAll: true },
  { setting: "av", editAll: false },
] as const;

const MATRIX = SETTINGS.flatMap((s) => ROLE_CASES.map((r) => ({ ...r, ...s })));
const WRITE_ALLOWED = MATRIX.filter((c) => c.editAll || c.roles[0] !== "inspector");

/** Id-ene i loggen er tilfeldige og kan inneholde «998» eller «1111»; fjern dem før sjekken av verdier. */
function withoutUuids(text: string): string {
  return text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "");
}

describe("4.1 tilgang per rolle", () => {
  it.each(MATRIX)(
    "4.1.1 $name med innstillingen $setting kan lese eiendommen",
    async ({ roles, editAll }) => {
      const { org, assignment } = await orgWithAdmin();
      const { property } = await apartmentOn(org.id, assignment.id);
      await setInspectorsEditAll(org.id, editAll);
      const { actor } = await person(org.id, roles);

      const result = await getAssignmentProperty(actor, org.id, assignment.id);
      expect(result.property?.id).toBe(property.id);
    },
  );

  it.each(WRITE_ALLOWED)(
    "4.1.2 $name med innstillingen $setting kan lagre eiendom og fellesdeler",
    async ({ roles, editAll }) => {
      const { org, assignment } = await orgWithAdmin();
      await setInspectorsEditAll(org.id, editAll);
      const { actor } = await person(org.id, roles);

      await saveAssignmentProperty(actor, org.id, assignment.id, propertyInput());
      await saveCommonAreas(actor, org.id, assignment.id, commonInput());

      expect((await assignmentRow(assignment.id)).propertyId).toBeTruthy();
      expect(await commonRowsFor(assignment.id)).toHaveLength(1);
    },
  );

  it.each(["saveAssignmentProperty", "saveCommonAreas"] as const)(
    "4.1.2 takstmann med innstillingen av får AccessDeniedError på %s, og ingen tabell endres",
    async (name) => {
      const { org, assignment } = await orgWithAdmin();
      const { property } = await apartmentOn(org.id, assignment.id);
      await setInspectorsEditAll(org.id, false);
      const { actor } = await person(org.id, ["inspector"]);
      const before = await tableCounts();

      const call =
        name === "saveAssignmentProperty"
          ? saveAssignmentProperty(actor, org.id, assignment.id, propertyInput({ city: "Endret" }))
          : saveCommonAreas(actor, org.id, assignment.id, commonInput());
      await expect(call).rejects.toThrow(AccessDeniedError);

      expect(await tableCounts()).toEqual(before);
      expect((await assignmentRow(assignment.id)).propertyId).toBe(property.id);
      const after = await propertyRow(property.id);
      expect(after.city).toBe(property.city);
      expect(after.rowVersion).toBe(property.rowVersion);
    },
  );

  it("4.1.2 takstmann med innstillingen av på oppdrag uten eiendom: property_id er fortsatt tom", async () => {
    const { org, assignment } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);
    const { actor } = await person(org.id, ["inspector"]);

    await expect(
      saveAssignmentProperty(actor, org.id, assignment.id, propertyInput()),
    ).rejects.toThrow(AccessDeniedError);
    expect((await assignmentRow(assignment.id)).propertyId).toBeNull();
    expect(await tableCounts()).toEqual({
      properties: 0,
      cadastralUnits: 0,
      commonAreas: 0,
      events: 0,
      auditLog: 0,
    });
  });

  it("4.1.2 takstmann med innstillingen av kan fortsatt lese eiendommen og fellesdelene", async () => {
    const { org, assignment } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);
    const { property } = await apartmentOn(org.id, assignment.id);
    const areas = await createCommonAreas(org.id, { assignmentId: assignment.id });
    const { actor } = await person(org.id, ["inspector"]);

    const result = await getAssignmentProperty(actor, org.id, assignment.id);
    expect(result.property?.id).toBe(property.id);
    expect(result.commonAreas?.id).toBe(areas.id);
  });

  it("4.1.3 takstmann med innstillingen av og enkeltrettigheten assignment.edit kan begge skrivefunksjonene", async () => {
    const { org, assignment } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);
    const { actor, employee } = await person(org.id, ["inspector"]);
    await grantPermission(employee, "assignment.edit");

    await saveAssignmentProperty(actor, org.id, assignment.id, propertyInput());
    await saveCommonAreas(actor, org.id, assignment.id, commonInput());
    expect((await assignmentRow(assignment.id)).propertyId).toBeTruthy();
    expect(await commonRowsFor(assignment.id)).toHaveLength(1);
  });

  it("4.1.4 bruker uten ansattrad får AccessDeniedError på lesing og lagring", async () => {
    const { org, assignment } = await orgWithAdmin();
    const stranger = await createUser();

    await expect(getAssignmentProperty(stranger, org.id, assignment.id)).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(
      saveAssignmentProperty(stranger, org.id, assignment.id, propertyInput()),
    ).rejects.toThrow(AccessDeniedError);
    expect(await rowCount(properties)).toBe(0);
  });

  it.each([
    ["deaktivert", { deactivatedAt: new Date("2026-11-01T08:00:00Z") }],
    ["slettet", { deletedAt: new Date("2026-11-01T08:00:00Z") }],
  ] as const)(
    "4.1.4 %s ansatt (admin) får AccessDeniedError på lesing og lagring",
    async (_name, set) => {
      const { org, assignment } = await orgWithAdmin();
      const { actor, employee } = await person(org.id, ["admin"]);
      await db.update(employees).set(set).where(eq(employees.id, employee.id));

      await expect(getAssignmentProperty(actor, org.id, assignment.id)).rejects.toThrow(
        AccessDeniedError,
      );
      await expect(
        saveAssignmentProperty(actor, org.id, assignment.id, propertyInput()),
      ).rejects.toThrow(AccessDeniedError);
      expect(await rowCount(properties)).toBe(0);
    },
  );

  it("4.1.4 ansatt uten roller får AccessDeniedError på lesing og lagring", async () => {
    const { org, assignment } = await orgWithAdmin();
    const { actor } = await person(org.id, []);
    await expect(getAssignmentProperty(actor, org.id, assignment.id)).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(
      saveAssignmentProperty(actor, org.id, assignment.id, propertyInput()),
    ).rejects.toThrow(AccessDeniedError);
    expect(await rowCount(properties)).toBe(0);
  });

  // Regel 11: admin stenges aldri ute. Testen skal aldri fjernes.
  it("4.1.5 admin uten andre roller og med innstillingen av kan lese og bruke begge skrivefunksjonene", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);

    expect((await getAssignmentProperty(admin, org.id, assignment.id)).property).toBeNull();
    await saveAssignmentProperty(admin, org.id, assignment.id, propertyInput());
    await saveCommonAreas(admin, org.id, assignment.id, commonInput());

    const result = await getAssignmentProperty(admin, org.id, assignment.id);
    expect(flatProperty(result.property)).toMatchObject({ address: ADDRESS, gnr: GNR });
    expect(result.commonAreas).toMatchObject({ managingAgent: AGENT });
  });
});

// ---------------------------------------------------------------------------------------------
// 4.2 Tenant-isolasjon (regel 2): tre kall til expectTenantIsolation, ett per funksjon
// ---------------------------------------------------------------------------------------------

describe("4.2 tenant-isolasjon", () => {
  it("4.2.1 getAssignmentProperty gir aldri eiendom eller fellesdeler fra en annen organisasjon", async () => {
    const assignmentFor = new Map<string, string>();
    let orgA = "";
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgA = grantA.organizationId;
        orgB = grantB.organizationId;
        const ids: Record<string, string[]> = {};
        for (const grant of [grantA, grantB]) {
          const assignment = await createAssignment(grant.organizationId);
          const { property } = await createProperty(grant.organizationId, {
            assignmentId: assignment.id,
            housingType: "apartment",
            ownershipForm: "cooperative",
            address: `Testveien 1 ${grant.organizationId === orgA ? "A" : "B"}`,
          });
          const common = await createCommonAreas(grant.organizationId, {
            assignmentId: assignment.id,
          });
          assignmentFor.set(grant.organizationId, assignment.id);
          ids[grant.organizationId] = [property.id, common.id];
        }
        return { a: ids[orgA]!, b: ids[orgB]! };
      },
      query: async (actor, organizationId) => {
        const result = await getAssignmentProperty(
          actor,
          organizationId,
          assignmentFor.get(organizationId) ?? randomUUID(),
        );
        const rows: { id: string }[] = [];
        if (result.property) rows.push({ id: result.property.id });
        if (result.commonAreas) rows.push({ id: result.commonAreas.id });
        return rows;
      },
      idOf: (row) => row.id,
    });

    // Bs adresse og id-er står aldri i As svar
    const adminA = await adminActorOf(orgA);
    const text = JSON.stringify(
      await getAssignmentProperty(adminA, orgA, assignmentFor.get(orgA)!),
    );
    expect(text).not.toContain("Testveien 1 B");
    const [propertyB] = await propertiesIn(orgB);
    expect(text).not.toContain(propertyB!.id);
  });

  it("4.2.2 saveAssignmentProperty lagrer alltid eiendommen i egen organisasjon", async () => {
    const assignmentFor = new Map<string, string>();
    let orgA = "";
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgA = grantA.organizationId;
        orgB = grantB.organizationId;
        for (const grant of [grantA, grantB]) {
          assignmentFor.set(
            grant.organizationId,
            (await createAssignment(grant.organizationId)).id,
          );
        }
        return { a: [orgA], b: [orgB] };
      },
      query: async (actor, organizationId) => {
        const assignmentId = assignmentFor.get(organizationId) ?? randomUUID();
        await saveAssignmentProperty(actor, organizationId, assignmentId, propertyInput());
        const { propertyId } = await assignmentRow(assignmentId);
        return [await propertyRow(propertyId!)];
      },
      idOf: (row) => row.organizationId,
    });

    for (const org of [orgA, orgB]) {
      const own = await propertiesIn(org);
      expect(own).toHaveLength(1);
      expect((await assignmentRow(assignmentFor.get(org)!)).propertyId).toBe(own[0]!.id);
      const units = await cadastralFor(own[0]!.id);
      expect(units).toHaveLength(1);
      expect(units[0]!.organizationId).toBe(org);
      for (const row of await eventsFor(org)) expect(row.assignmentId).toBe(assignmentFor.get(org));
    }
    expect(await rowCount(properties)).toBe(2);
    expect(await rowCount(cadastralUnits)).toBe(2);
  });

  it("4.2.3 saveCommonAreas lagrer alltid fellesdelene i egen organisasjon", async () => {
    const assignmentFor = new Map<string, string>();
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        for (const grant of [grantA, grantB]) {
          const assignment = await createAssignment(grant.organizationId);
          await apartmentOn(grant.organizationId, assignment.id);
          assignmentFor.set(grant.organizationId, assignment.id);
        }
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor, organizationId) => {
        const assignmentId = assignmentFor.get(organizationId) ?? randomUUID();
        await saveCommonAreas(actor, organizationId, assignmentId, commonInput());
        return commonRowsFor(assignmentId);
      },
      idOf: (row) => row.organizationId,
    });

    const rowsB = await db.select().from(commonAreas).where(eq(commonAreas.organizationId, orgB));
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0]!.assignmentId).toBe(assignmentFor.get(orgB));
    expect(await rowCount(commonAreas)).toBe(2);
  });
});

/** Admin-aktøren i organisasjonen (fra `expectTenantIsolation`). */
async function adminActorOf(organizationId: string): Promise<Actor> {
  const [row] = await db
    .select({ userId: employees.userId, name: employees.name })
    .from(employees)
    .where(eq(employees.organizationId, organizationId));
  return { id: row!.userId!, email: `${row!.userId}@example.com`, name: row!.name };
}

// ---------------------------------------------------------------------------------------------
// 4.3 Fremmed id i egen organisasjon (IDOR)
// ---------------------------------------------------------------------------------------------

describe("4.3 fremmed, ukjent og ugyldig id", () => {
  async function twoOrgs() {
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    const { property: propertyB, cadastralUnit: unitB } = await apartmentOn(
      b.org.id,
      b.assignment.id,
    );
    const commonB = await createCommonAreas(b.org.id, {
      assignmentId: b.assignment.id,
      managingAgent: "Forvalter B",
    });
    return { a, b, propertyB, unitB, commonB };
  }

  it("4.3.1 Bs assignmentId med As org-id gir AccessDeniedError i alle tre; Bs eiendom, matrikkel og fellesdeler er uendret", async () => {
    const { a, b, propertyB, unitB, commonB } = await twoOrgs();
    const before = await tableCounts();

    await expect(getAssignmentProperty(a.admin, a.org.id, b.assignment.id)).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(
      saveAssignmentProperty(a.admin, a.org.id, b.assignment.id, propertyInput({ city: "Endret" })),
    ).rejects.toThrow(AccessDeniedError);
    await expect(
      saveCommonAreas(a.admin, a.org.id, b.assignment.id, commonInput({ managingAgent: "Endret" })),
    ).rejects.toThrow(AccessDeniedError);

    expect(await tableCounts()).toEqual(before);
    const propertyAfter = await propertyRow(propertyB.id);
    expect(propertyAfter.updatedAt.toISOString()).toBe(propertyB.updatedAt.toISOString());
    expect(propertyAfter.rowVersion).toBe(propertyB.rowVersion);
    expect(propertyAfter.city).toBe(propertyB.city);
    const [unitAfter] = await cadastralFor(propertyB.id);
    expect(unitAfter!.updatedAt.toISOString()).toBe(unitB.updatedAt.toISOString());
    const [commonAfter] = await commonRowsFor(b.assignment.id);
    expect(commonAfter!.managingAgent).toBe("Forvalter B");
    expect(commonAfter!.updatedAt.toISOString()).toBe(commonB.updatedAt.toISOString());
    expect((await assignmentRow(b.assignment.id)).propertyId).toBe(propertyB.id);
    expect(await eventsFor(a.org.id)).toHaveLength(0);
    expect(await eventsFor(b.org.id)).toHaveLength(0);
  });

  it("4.3.2 propertyId og organizationId i input ignoreres: bare As egen eiendom lages (eller skjemaet avviser)", async () => {
    const { a, b, propertyB } = await twoOrgs();
    const input = propertyInput({
      propertyId: propertyB.id,
      organizationId: b.org.id,
      id: propertyB.id,
      city: "Endret",
    });

    const error = await caught(saveAssignmentProperty(a.admin, a.org.id, a.assignment.id, input));
    if (error === null) {
      const own = await propertiesIn(a.org.id);
      expect(own).toHaveLength(1);
      expect(own[0]!.id).not.toBe(propertyB.id);
      expect((await assignmentRow(a.assignment.id)).propertyId).toBe(own[0]!.id);
    } else {
      expect(error).toBeInstanceOf(ZodError);
    }

    const after = await propertyRow(propertyB.id);
    expect(after.city).toBe(propertyB.city);
    expect(after.organizationId).toBe(b.org.id);
    expect(after.rowVersion).toBe(propertyB.rowVersion);
    expect(await propertiesIn(b.org.id)).toHaveLength(1);
    expect(await eventsFor(b.org.id)).toHaveLength(0);
  });

  it("4.3.2 eiendommen på As oppdrag kan ikke byttes til Bs eiendom via input ved andre lagring", async () => {
    const { a, b, propertyB } = await twoOrgs();
    await saveAssignmentProperty(a.admin, a.org.id, a.assignment.id, propertyInput());
    const ownId = (await assignmentRow(a.assignment.id)).propertyId;

    await caught(
      saveAssignmentProperty(
        a.admin,
        a.org.id,
        a.assignment.id,
        propertyInput({ propertyId: propertyB.id, city: "Endret" }),
      ),
    );

    expect((await assignmentRow(a.assignment.id)).propertyId).toBe(ownId);
    expect((await propertyRow(propertyB.id)).city).toBe(propertyB.city);
    expect((await assignmentRow(b.assignment.id)).propertyId).toBe(propertyB.id);
  });

  it.each([
    ["tilfeldig uuid", randomUUID()],
    ["ikke en id", "ikke-en-id"],
  ])("4.3.3 %s som oppdrags-id gir AccessDeniedError, aldri databasefeil", async (_name, id) => {
    const { org, admin } = await orgWithAdmin();
    await expect(getAssignmentProperty(admin, org.id, id)).rejects.toThrow(AccessDeniedError);
    await expect(saveAssignmentProperty(admin, org.id, id, propertyInput())).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(saveCommonAreas(admin, org.id, id, commonInput())).rejects.toThrow(
      AccessDeniedError,
    );
    expect(await rowCount(properties)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// 4.4 Myk sletting
// ---------------------------------------------------------------------------------------------

describe("4.4 myk sletting", () => {
  it("4.4.1 slettet oppdrag gir AccessDeniedError i alle tre funksjonene", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await apartmentOn(org.id, assignment.id);
    await db
      .update(assignments)
      .set({ deletedAt: DELETED_AT })
      .where(eq(assignments.id, assignment.id));
    const before = await tableCounts();

    await expect(getAssignmentProperty(admin, org.id, assignment.id)).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(
      saveAssignmentProperty(admin, org.id, assignment.id, propertyInput()),
    ).rejects.toThrow(AccessDeniedError);
    await expect(saveCommonAreas(admin, org.id, assignment.id, commonInput())).rejects.toThrow(
      AccessDeniedError,
    );
    expect(await tableCounts()).toEqual(before);
  });

  it("4.4.2 oppdrag som peker på myk-slettet eiendom: get gir property = null og prefill fra ordren", async () => {
    const { org, admin, office } = await orgWithAdmin();
    const assignment = await assignmentFromOrder(org.id, office.id, {
      addressText: ADDRESS,
      gnr: GNR,
      bnr: BNR,
      snr: SNR,
      housingAssociationName: ASSOCIATION,
    });
    await createProperty(org.id, { assignmentId: assignment.id, deletedAt: DELETED_AT });

    const result = await getAssignmentProperty(admin, org.id, assignment.id);
    expect(result.property).toBeNull();
    expect(result.prefill).toEqual({
      address: ADDRESS,
      gnr: GNR,
      bnr: BNR,
      snr: SNR,
      associationName: ASSOCIATION,
    });
  });

  it("4.4.2 lagring på oppdrag med myk-slettet eiendom lager ny eiendom og flytter property_id; den slettede står urørt", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const { property: deleted, cadastralUnit: deletedUnit } = await createProperty(org.id, {
      assignmentId: assignment.id,
      address: "Testveien 3",
      deletedAt: DELETED_AT,
    });

    await saveAssignmentProperty(admin, org.id, assignment.id, propertyInput());

    const { propertyId } = await assignmentRow(assignment.id);
    expect(propertyId).toBeTruthy();
    expect(propertyId).not.toBe(deleted.id);
    expect(await cadastralFor(propertyId!)).toHaveLength(1);
    const old = await propertyRow(deleted.id);
    expect(old.address).toBe("Testveien 3");
    expect(old.deletedAt?.toISOString()).toBe(DELETED_AT.toISOString());
    expect(old.rowVersion).toBe(deleted.rowVersion);
    expect(old.updatedAt.toISOString()).toBe(deleted.updatedAt.toISOString());
    const [oldUnit] = await cadastralFor(deleted.id);
    expect(oldUnit!.rowVersion).toBe(deletedUnit.rowVersion);
    expect(await propertiesIn(org.id)).toHaveLength(2);
    const [event] = await eventsFor(org.id, "assignment.property_saved");
    expect(event!.data).toMatchObject({ propertyId, created: true });
  });

  it("4.4.3 bytte til enebolig/selveier skjuler fellesdelene uten å slette dem; bytte tilbake viser de gamle verdiene", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await saveAssignmentProperty(admin, org.id, assignment.id, propertyInput());
    await saveCommonAreas(admin, org.id, assignment.id, commonInput());

    await saveAssignmentProperty(admin, org.id, assignment.id, detachedInput());

    const rows = await commonRowsFor(assignment.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.deletedAt).toBeNull();
    expect(rows[0]!.managingAgent).toBe(AGENT);
    expect((await getAssignmentProperty(admin, org.id, assignment.id)).commonAreas).toBeNull();

    await saveAssignmentProperty(admin, org.id, assignment.id, propertyInput());
    const back = await getAssignmentProperty(admin, org.id, assignment.id);
    expect(back.commonAreas).toMatchObject({
      id: rows[0]!.id,
      managingAgent: AGENT,
      conditionReportStatus: "yes",
      maintenancePlanStatus: "unknown",
      notes: NOTES,
    });
  });

  it("4.4.4 myk-slettet fellesdelsrad vises ikke, og saveCommonAreas lager en ny rad", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await apartmentOn(org.id, assignment.id);
    const old = await createCommonAreas(org.id, {
      assignmentId: assignment.id,
      managingAgent: "Forvalter Gammel",
      deletedAt: DELETED_AT,
    });

    expect((await getAssignmentProperty(admin, org.id, assignment.id)).commonAreas).toBeNull();
    await saveCommonAreas(admin, org.id, assignment.id, commonInput());

    const rows = await commonRowsFor(assignment.id);
    expect(rows).toHaveLength(2);
    const active = rows.filter((row) => row.deletedAt === null);
    expect(active).toHaveLength(1);
    expect(active[0]!.id).not.toBe(old.id);
    expect(active[0]!.managingAgent).toBe(AGENT);
    const oldAfter = rows.find((row) => row.id === old.id)!;
    expect(oldAfter.managingAgent).toBe("Forvalter Gammel");
    expect(oldAfter.deletedAt?.toISOString()).toBe(DELETED_AT.toISOString());
  });
});

// ---------------------------------------------------------------------------------------------
// 4.5 getAssignmentProperty
// ---------------------------------------------------------------------------------------------

const PROPERTY_KEYS = [
  "id",
  "address",
  "postalCode",
  "city",
  "municipalityNumber",
  "municipalityName",
  "housingType",
  "ownershipForm",
  "dataSource",
  "gnr",
  "bnr",
  "fnr",
  "snr",
  "associationName",
  "associationOrgNumber",
  "shareNumber",
];
/** Mulige ekstra nøkler: matrikkelraden som objekt, eller id-ene til raden og oppdraget. */
const PROPERTY_OPTIONAL_KEYS = [
  "cadastralUnit",
  "cadastralUnits",
  "cadastralUnitId",
  "propertyId",
  "assignmentId",
];
const COMMON_KEYS = [
  "id",
  "managingAgent",
  "conditionReportStatus",
  "maintenancePlanStatus",
  "notes",
];
const COMMON_OPTIONAL_KEYS = ["assignmentId"];
const PREFILL_KEYS = ["address", "gnr", "bnr", "snr", "associationName"].sort();
const FORBIDDEN_KEYS = [
  "organizationId",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
  "deletedAt",
  "deletedBy",
  "rowVersion",
];

function expectNoForbiddenKeys(value: unknown, path: string) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => expectNoForbiddenKeys(item, `${path}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value)) {
    expect(FORBIDDEN_KEYS, `${path}.${key} skal ikke være med`).not.toContain(key);
    expectNoForbiddenKeys(value[key], `${path}.${key}`);
  }
}

describe("4.5 getAssignmentProperty", () => {
  it("4.5.1 faste feltlister på eiendom og fellesdeler; ingen sporingsfelt", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await saveAssignmentProperty(admin, org.id, assignment.id, propertyInput());
    await saveCommonAreas(admin, org.id, assignment.id, commonInput());

    const result = await getAssignmentProperty(admin, org.id, assignment.id);
    expect(Object.keys(result).sort()).toEqual(expect.arrayContaining(["commonAreas", "property"]));
    for (const key of Object.keys(result)) {
      expect(["property", "commonAreas", "prefill"], `uventet felt ${key}`).toContain(key);
    }

    const ownKeys = Object.keys(result.property!);
    for (const key of ownKeys) {
      expect([...PROPERTY_KEYS, ...PROPERTY_OPTIONAL_KEYS], `uventet felt ${key}`).toContain(key);
    }
    const flat = flatProperty(result.property);
    for (const key of PROPERTY_KEYS) expect(Object.keys(flat), `mangler ${key}`).toContain(key);

    const commonKeys = Object.keys(result.commonAreas!);
    for (const key of COMMON_KEYS) expect(commonKeys, `mangler ${key}`).toContain(key);
    for (const key of commonKeys) {
      expect([...COMMON_KEYS, ...COMMON_OPTIONAL_KEYS], `uventet felt ${key}`).toContain(key);
    }
    expectNoForbiddenKeys(result, "svar");
  });

  it("4.5.2 uten eiendom, med ordre: prefill har nøyaktig ordrens fem verdier; adressen er ikke delt opp (A73)", async () => {
    const { org, admin, office } = await orgWithAdmin();
    const fullAddress = `${ADDRESS}, 0000 Testby`;
    const assignment = await assignmentFromOrder(org.id, office.id, {
      addressText: fullAddress,
      gnr: GNR,
      bnr: BNR,
      snr: SNR,
      housingAssociationName: ASSOCIATION,
    });

    const result = await getAssignmentProperty(admin, org.id, assignment.id);
    expect(result.property).toBeNull();
    expect(result.commonAreas).toBeNull();
    expect(Object.keys(result.prefill).sort()).toEqual(PREFILL_KEYS);
    expect(result.prefill).toEqual({
      address: fullAddress,
      gnr: GNR,
      bnr: BNR,
      snr: SNR,
      associationName: ASSOCIATION,
    });
  });

  it("4.5.2 ordre uten matrikkel: adressen fylles ut, resten er tomt", async () => {
    const { org, admin, office } = await orgWithAdmin();
    const assignment = await assignmentFromOrder(org.id, office.id, { addressText: ADDRESS });

    const { prefill } = await getAssignmentProperty(admin, org.id, assignment.id);
    expect(prefill.address).toBe(ADDRESS);
    for (const key of ["gnr", "bnr", "snr", "associationName"] as const) {
      expect(isBlank(prefill[key]), key).toBe(true);
    }
  });

  it("4.5.3 uten eiendom og uten ordre: prefill har tomme verdier", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const result = await getAssignmentProperty(admin, org.id, assignment.id);
    expect(result.property).toBeNull();
    expect(result.commonAreas).toBeNull();
    expect(Object.keys(result.prefill).sort()).toEqual(PREFILL_KEYS);
    expectBlankPrefill(result.prefill);
  });

  it("4.5.4 med eiendom: property har feltene og én matrikkelrad; prefill er tom eller mangler", async () => {
    const { org, admin, office } = await orgWithAdmin();
    const assignment = await assignmentFromOrder(org.id, office.id, {
      addressText: "Testveien 5",
      gnr: "1",
      bnr: "2",
    });
    await saveAssignmentProperty(admin, org.id, assignment.id, propertyInput());

    const result = await getAssignmentProperty(admin, org.id, assignment.id);
    expect(flatProperty(result.property)).toMatchObject({
      ...APARTMENT_INPUT,
      dataSource: "manual",
    });
    expect(result.property!.id).toBe((await assignmentRow(assignment.id)).propertyId);
    expectBlankPrefill(result.prefill);
  });

  it("4.5.5 flere matrikkelrader: svaret har den eldste (A70)", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const { property } = await createProperty(org.id, { assignmentId: assignment.id, gnr: GNR });
    await db.execute(sql`
      insert into cadastral_units (organization_id, property_id, gnr, bnr, created_at)
      values (${org.id}, ${property.id}, '998', '998', now() + interval '1 hour')`);

    const result = await getAssignmentProperty(admin, org.id, assignment.id);
    expect(flatProperty(result.property)).toMatchObject({ gnr: GNR, bnr: BNR });
  });

  it("4.5.6 myk-slettet ordre gir tom prefill", async () => {
    const { org, admin, office } = await orgWithAdmin();
    const assignment = await assignmentFromOrder(org.id, office.id, {
      addressText: ADDRESS,
      gnr: GNR,
      bnr: BNR,
      deletedAt: DELETED_AT,
    });

    const { prefill } = await getAssignmentProperty(admin, org.id, assignment.id);
    expectBlankPrefill(prefill);
  });

  it("4.5.7 fellesdeler som ikke gjelder (enebolig/selveier) gir commonAreas = null, selv om raden finnes", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await createProperty(org.id, { assignmentId: assignment.id });
    await createCommonAreas(org.id, { assignmentId: assignment.id, managingAgent: AGENT });

    const result = await getAssignmentProperty(admin, org.id, assignment.id);
    expect(result.property).not.toBeNull();
    expect(result.commonAreas).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// 4.6 Lagring
// ---------------------------------------------------------------------------------------------

describe("4.6 lagring", () => {
  it("4.6.1 første lagring lager én eiendom og én matrikkelrad, setter property_id, manual og createdBy", async () => {
    const { org, admin, adminEmployee, assignment } = await orgWithAdmin();

    await saveAssignmentProperty(admin, org.id, assignment.id, propertyInput());

    const own = await propertiesIn(org.id);
    expect(own).toHaveLength(1);
    const property = own[0]!;
    expect(property).toMatchObject({
      organizationId: org.id,
      address: ADDRESS,
      postalCode: POSTAL,
      city: CITY,
      municipalityNumber: MUNICIPALITY_NUMBER,
      municipalityName: MUNICIPALITY,
      housingType: "apartment",
      ownershipForm: "cooperative",
      dataSource: "manual",
      deletedAt: null,
    });
    expect([adminEmployee.id, admin.id]).toContain(property.createdBy);
    const units = await cadastralFor(property.id);
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({
      organizationId: org.id,
      gnr: GNR,
      bnr: BNR,
      fnr: FNR,
      snr: SNR,
      associationName: ASSOCIATION,
      associationOrgNumber: ORG_NUMBER,
      shareNumber: SHARE,
    });
    expect((await assignmentRow(assignment.id)).propertyId).toBe(property.id);
    const saved = await eventsFor(org.id, "assignment.property_saved");
    expect(saved).toHaveLength(1);
    expect(saved[0]!.data).toEqual({ propertyId: property.id, created: true });
  });

  it("4.6.2 andre lagring oppdaterer de samme radene; ingen nye rader; created = false", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await saveAssignmentProperty(admin, org.id, assignment.id, propertyInput());
    const { propertyId } = await assignmentRow(assignment.id);
    const [unitBefore] = await cadastralFor(propertyId!);

    await saveAssignmentProperty(
      admin,
      org.id,
      assignment.id,
      propertyInput({ city: "Testby Nord", gnr: "998", ownershipForm: "section" }),
    );

    expect((await assignmentRow(assignment.id)).propertyId).toBe(propertyId);
    expect(await rowCount(properties)).toBe(1);
    expect(await rowCount(cadastralUnits)).toBe(1);
    const property = await propertyRow(propertyId!);
    expect(property).toMatchObject({ city: "Testby Nord", ownershipForm: "section" });
    const [unitAfter] = await cadastralFor(propertyId!);
    expect(unitAfter!.id).toBe(unitBefore!.id);
    expect(unitAfter!.gnr).toBe("998");
    const saved = await eventsFor(org.id, "assignment.property_saved");
    expect(saved.map((row) => (row.data as { created: boolean }).created).sort()).toEqual([
      false,
      true,
    ]);
  });

  it("4.6.3 lagring uten endring gir ingen hendelse, ingen loggrad, og updated_at er uendret", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await saveAssignmentProperty(admin, org.id, assignment.id, propertyInput());
    const { propertyId } = await assignmentRow(assignment.id);
    const before = await tableCounts();
    const propertyBefore = await propertyRow(propertyId!);
    const [unitBefore] = await cadastralFor(propertyId!);

    // Samme verdier, med mellomrom rundt (trimmes til det samme)
    await saveAssignmentProperty(
      admin,
      org.id,
      assignment.id,
      propertyInput({ address: `  ${ADDRESS}  ` }),
    );

    expect(await tableCounts()).toEqual(before);
    const propertyAfter = await propertyRow(propertyId!);
    expect(propertyAfter.updatedAt.toISOString()).toBe(propertyBefore.updatedAt.toISOString());
    expect(propertyAfter.rowVersion).toBe(propertyBefore.rowVersion);
    const [unitAfter] = await cadastralFor(propertyId!);
    expect(unitAfter!.updatedAt.toISOString()).toBe(unitBefore!.updatedAt.toISOString());
  });

  it("4.6.4 valgfrie felt kan tømmes: postnummer satt, så tomt → null", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await saveAssignmentProperty(admin, org.id, assignment.id, propertyInput());
    await saveAssignmentProperty(
      admin,
      org.id,
      assignment.id,
      propertyInput({ postalCode: "", shareNumber: "" }),
    );

    const { propertyId } = await assignmentRow(assignment.id);
    expect((await propertyRow(propertyId!)).postalCode).toBeNull();
    expect((await cadastralFor(propertyId!))[0]!.shareNumber).toBeNull();
  });

  it.each([
    ["tom adresse", { address: " " }],
    ["ukjent boligtype", { housingType: "villa" }],
    ["obligasjon (A69)", { ownershipForm: "bond" }],
    ["bokstaver i gnr", { gnr: "12a" }],
    ["fødselsnummer i adressen", { address: "Testveien 12345678901" }],
  ])("4.6.5 %s gir ZodError; ingen rad og ingen hendelse", async (_name, bad) => {
    const { org, admin, assignment } = await orgWithAdmin();
    await expect(
      saveAssignmentProperty(admin, org.id, assignment.id, propertyInput(bad)),
    ).rejects.toThrow(ZodError);
    expect(await tableCounts()).toEqual({
      properties: 0,
      cadastralUnits: 0,
      commonAreas: 0,
      events: 0,
      auditLog: 0,
    });
    expect((await assignmentRow(assignment.id)).propertyId).toBeNull();
  });

  it("4.6.5 valideringsfeil i fellesdelene gir ZodError og ingen rad", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await apartmentOn(org.id, assignment.id);
    await expect(
      saveCommonAreas(
        admin,
        org.id,
        assignment.id,
        commonInput({ conditionReportStatus: "maybe" }),
      ),
    ).rejects.toThrow(ZodError);
    expect(await commonRowsFor(assignment.id)).toHaveLength(0);
  });

  it("4.6.6 saveCommonAreas på enebolig/selveier gir CommonAreasNotApplicableError og ingen rad", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await createProperty(org.id, { assignmentId: assignment.id });

    const error = await caught(saveCommonAreas(admin, org.id, assignment.id, commonInput()));
    expect(error).toBeInstanceOf(CommonAreasNotApplicableError);
    expect((error as Error).message).toBe(
      "Fellesdeler gjelder bare leilighet, eierseksjon, borettslag og aksjeleilighet.",
    );
    expect(await commonRowsFor(assignment.id)).toHaveLength(0);
    expect(await rowCount(events)).toBe(0);
  });

  it("4.6.6 saveCommonAreas uten eiendom gir CommonAreasNotApplicableError og ingen rad", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await expect(saveCommonAreas(admin, org.id, assignment.id, commonInput())).rejects.toThrow(
      CommonAreasNotApplicableError,
    );
    expect(await commonRowsFor(assignment.id)).toHaveLength(0);
  });

  it("4.6.6 saveCommonAreas på leilighet i tomannsbolig med selveier gir CommonAreasNotApplicableError (A72)", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await createProperty(org.id, {
      assignmentId: assignment.id,
      housingType: "apartment_in_house",
      ownershipForm: "freehold",
    });
    await expect(saveCommonAreas(admin, org.id, assignment.id, commonInput())).rejects.toThrow(
      CommonAreasNotApplicableError,
    );
  });

  it("4.6.6 saveCommonAreas når eiendommen er myk-slettet gir CommonAreasNotApplicableError", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await createProperty(org.id, {
      assignmentId: assignment.id,
      housingType: "apartment",
      ownershipForm: "cooperative",
      deletedAt: DELETED_AT,
    });
    await expect(saveCommonAreas(admin, org.id, assignment.id, commonInput())).rejects.toThrow(
      CommonAreasNotApplicableError,
    );
    expect(await commonRowsFor(assignment.id)).toHaveLength(0);
  });

  it.each([
    ["apartment", "freehold"],
    ["detached", "section"],
    ["terraced", "cooperative"],
    ["detached", "share"],
  ])("4.6.7 saveCommonAreas på %s/%s lykkes", async (housingType, ownershipForm) => {
    const { org, admin, assignment } = await orgWithAdmin();
    await createProperty(org.id, { assignmentId: assignment.id, housingType, ownershipForm });

    await saveCommonAreas(admin, org.id, assignment.id, commonInput());

    const rows = await commonRowsFor(assignment.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: org.id,
      managingAgent: AGENT,
      conditionReportStatus: "yes",
      maintenancePlanStatus: "unknown",
      notes: NOTES,
      deletedAt: null,
    });
  });

  it("4.6.8 saveCommonAreas to ganger: én rad, oppdatert, created = false; ingen endring gir ingen hendelse", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await apartmentOn(org.id, assignment.id);

    await saveCommonAreas(admin, org.id, assignment.id, commonInput());
    const [first] = await commonRowsFor(assignment.id);
    await saveCommonAreas(
      admin,
      org.id,
      assignment.id,
      commonInput({ maintenancePlanStatus: "no", notes: "Sett trapperom" }),
    );

    const rows = await commonRowsFor(assignment.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(first!.id);
    expect(rows[0]).toMatchObject({ maintenancePlanStatus: "no", notes: "Sett trapperom" });
    const saved = await eventsFor(org.id, "assignment.common_areas_saved");
    expect(saved).toHaveLength(2);
    for (const row of saved) {
      expect(row.assignmentId).toBe(assignment.id);
      expect((row.data as { commonAreasId: string }).commonAreasId).toBe(first!.id);
    }
    expect(saved.map((row) => (row.data as { created: boolean }).created).sort()).toEqual([
      false,
      true,
    ]);

    const before = await tableCounts();
    await saveCommonAreas(
      admin,
      org.id,
      assignment.id,
      commonInput({ maintenancePlanStatus: "no", notes: " Sett trapperom " }),
    );
    expect(await tableCounts()).toEqual(before);
    const [unchanged] = await commonRowsFor(assignment.id);
    expect(unchanged!.rowVersion).toBe(rows[0]!.rowVersion);
  });

  it("4.6.9 to samtidige første lagringer gir én eiendom og én property_id", async () => {
    const { org, admin, assignment } = await orgWithAdmin();

    const results = await Promise.allSettled([
      saveAssignmentProperty(admin, org.id, assignment.id, propertyInput()),
      saveAssignmentProperty(admin, org.id, assignment.id, propertyInput({ city: "Testby Nord" })),
    ]);

    expect(
      results
        .filter((r) => r.status === "rejected")
        .map((r) => String((r as PromiseRejectedResult).reason)),
    ).toEqual([]);
    const own = await propertiesIn(org.id);
    expect(own).toHaveLength(1);
    expect((await assignmentRow(assignment.id)).propertyId).toBe(own[0]!.id);
    expect(await cadastralFor(own[0]!.id)).toHaveLength(1);
    const created = (await eventsFor(org.id, "assignment.property_saved")).filter(
      (row) => (row.data as { created: boolean }).created,
    );
    expect(created).toHaveLength(1);
  });

  it("4.6.9 to samtidige saveCommonAreas gir én aktiv rad og ingen unik-feil til brukeren", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await apartmentOn(org.id, assignment.id);

    const results = await Promise.allSettled([
      saveCommonAreas(admin, org.id, assignment.id, commonInput()),
      saveCommonAreas(admin, org.id, assignment.id, commonInput({ notes: "Sett kjeller" })),
    ]);

    expect(
      results
        .filter((r) => r.status === "rejected")
        .map((r) => String((r as PromiseRejectedResult).reason)),
    ).toEqual([]);
    const active = (await commonRowsFor(assignment.id)).filter((row) => row.deletedAt === null);
    expect(active).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// 4.7 Hendelser og revisjonslogg
// ---------------------------------------------------------------------------------------------

/** Verdier som aldri skal stå i hendelser eller revisjonslogg (raden er kilden). */
const LONG_SENSITIVE = [
  ADDRESS,
  CITY,
  MUNICIPALITY,
  ASSOCIATION,
  ORG_NUMBER,
  AGENT,
  "Sett trapperom",
];
/** Korte verdier som kan forekomme inni en uuid; de sjekkes mot hver verdi som ikke er en uuid. */
const SHORT_SENSITIVE = [GNR, BNR, SHARE, POSTAL];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Alle tekst- og tallverdier i strukturen (ikke nøklene). */
function leaves(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === "string") return [value];
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(leaves);
  if (typeof value === "object") return Object.values(value).flatMap(leaves);
  return [];
}

function expectNoSensitive(payload: unknown) {
  const text = JSON.stringify(payload);
  for (const value of LONG_SENSITIVE) expect(text, value).not.toContain(value);
  for (const leaf of leaves(payload)) {
    if (UUID.test(leaf)) continue;
    for (const value of SHORT_SENSITIVE) {
      expect(leaf.includes(value), `«${leaf}» inneholder ${value}`).toBe(false);
    }
  }
}

describe("4.7 hendelser og revisjonslogg", () => {
  it("4.7.1 saveAssignmentProperty: property_saved med { propertyId, created }, og revisjonslogg property og cadastral_unit med create, så update med feltnavn", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await saveAssignmentProperty(admin, org.id, assignment.id, propertyInput());
    const { propertyId } = await assignmentRow(assignment.id);
    const [unit] = await cadastralFor(propertyId!);

    const [event] = await eventsFor(org.id, "assignment.property_saved");
    expect(event!.assignmentId).toBe(assignment.id);
    expect(event!.data).toEqual({ propertyId, created: true });

    const createdProperty = await auditFor(org.id, "property");
    expect(createdProperty.map((row) => `${row.action}:${row.entityId}`)).toEqual([
      `create:${propertyId}`,
    ]);
    const createdUnit = await auditFor(org.id, "cadastral_unit");
    expect(createdUnit.map((row) => `${row.action}:${row.entityId}`)).toEqual([
      `create:${unit!.id}`,
    ]);

    await saveAssignmentProperty(
      admin,
      org.id,
      assignment.id,
      propertyInput({ postalCode: "1111", gnr: "998" }),
    );
    const propertyUpdate = (await auditFor(org.id, "property")).find(
      (row) => row.action === "update",
    );
    expect(propertyUpdate?.entityId).toBe(propertyId);
    const propertyText = withoutUuids(JSON.stringify(propertyUpdate!.changes));
    expect(propertyText).toMatch(/postal_?[cC]ode/);
    expect(propertyText).not.toContain("1111");
    const unitUpdate = (await auditFor(org.id, "cadastral_unit")).find(
      (row) => row.action === "update",
    );
    expect(unitUpdate?.entityId).toBe(unit!.id);
    const unitText = withoutUuids(JSON.stringify(unitUpdate!.changes));
    expect(unitText).toContain("gnr");
    expect(unitText).not.toContain("998");
  });

  it("4.7.1 bare matrikkelen endret: ingen update-rad for property", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await saveAssignmentProperty(admin, org.id, assignment.id, propertyInput());
    await saveAssignmentProperty(admin, org.id, assignment.id, propertyInput({ gnr: "998" }));
    const updates = (await auditFor(org.id)).filter((row) => row.action === "update");
    expect(updates.map((row) => row.entityType)).toEqual(["cadastral_unit"]);
  });

  it("4.7.2 saveCommonAreas: common_areas_saved med { commonAreasId, created }, og revisjonslogg common_areas", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await apartmentOn(org.id, assignment.id);
    await saveCommonAreas(admin, org.id, assignment.id, commonInput());
    const [row] = await commonRowsFor(assignment.id);

    const [event] = await eventsFor(org.id, "assignment.common_areas_saved");
    expect(event!.assignmentId).toBe(assignment.id);
    expect(event!.data).toEqual({ commonAreasId: row!.id, created: true });

    await saveCommonAreas(admin, org.id, assignment.id, commonInput({ notes: "Sett loft" }));
    const audit = await auditFor(org.id, "common_areas");
    expect(audit.map((entry) => `${entry.action}:${entry.entityId}`).sort()).toEqual(
      [`create:${row!.id}`, `update:${row!.id}`].sort(),
    );
    const update = audit.find((entry) => entry.action === "update")!;
    const text = JSON.stringify(update.changes);
    expect(text).toContain("notes");
    expect(text).not.toContain("Sett loft");
  });

  it("4.7.3 ingen adresse, matrikkel, borettslag, andelsnummer, forretningsfører eller notater i events.data eller audit_log.changes", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await saveAssignmentProperty(admin, org.id, assignment.id, propertyInput());
    await saveCommonAreas(admin, org.id, assignment.id, commonInput());
    // Endring: verdiene byttes til andre oppdiktede verdier og tilbake
    await saveAssignmentProperty(
      admin,
      org.id,
      assignment.id,
      propertyInput({
        address: `${ADDRESS} B`,
        city: `${CITY} Nord`,
        municipalityName: `${MUNICIPALITY} Nord`,
        associationName: `${ASSOCIATION} Nord`,
        postalCode: "0001",
      }),
    );
    await saveAssignmentProperty(admin, org.id, assignment.id, propertyInput());
    await saveCommonAreas(
      admin,
      org.id,
      assignment.id,
      commonInput({ managingAgent: `${AGENT} Nord`, notes: "Sett trapperom og loft" }),
    );

    const allEvents = await eventsFor(org.id);
    const allAudit = await auditFor(org.id);
    expect(allEvents.length).toBeGreaterThanOrEqual(5);
    expect(allAudit.length).toBeGreaterThanOrEqual(6);
    expectNoSensitive([allEvents.map((row) => row.data), allAudit.map((row) => row.changes)]);
  });

  it("4.7.4 ingen hendelse ved avvist tilgang, valideringsfeil, CommonAreasNotApplicableError eller lagring uten endring", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);
    const { actor: inspector } = await person(org.id, ["inspector"]);
    const other = await createAssignment(org.id);
    await createProperty(org.id, { assignmentId: other.id });

    await caught(saveAssignmentProperty(inspector, org.id, assignment.id, propertyInput()));
    await caught(saveAssignmentProperty(admin, org.id, assignment.id, propertyInput({ gnr: "" })));
    await caught(saveCommonAreas(admin, org.id, other.id, commonInput()));
    expect(await rowCount(events)).toBe(0);
    expect(await rowCount(auditLog)).toBe(0);

    await saveAssignmentProperty(admin, org.id, assignment.id, propertyInput());
    const before = await tableCounts();
    await saveAssignmentProperty(admin, org.id, assignment.id, propertyInput());
    expect(await tableCounts()).toEqual(before);
  });
});
