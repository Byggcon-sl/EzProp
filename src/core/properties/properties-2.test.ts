import { randomUUID } from "node:crypto";
import { and, asc, count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { AccessDeniedError, type Actor } from "@/core/access";
import { db } from "@/db/client";
import {
  assignments,
  auditLog,
  cadastralUnits,
  commonAreas,
  employees,
  events,
  orders,
  organizations,
  properties,
  type EmployeeRole,
} from "@/db/schema";
import {
  createAssignment,
  createCommonAreas,
  createEmployee,
  createOrder,
  createOrganization,
  createProperty,
  createUser,
  grantPermission,
  resetDatabase,
  TEST_NOW,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { CommonAreasNotApplicableError } from "./errors";
import { getAssignmentProperty, saveAssignmentProperty, saveCommonAreas } from "./index";

/*
 * Eiendom, matrikkel og fellesdeler på oppdraget: kjernen i src/core/properties.
 * Testplan: docs/funksjoner/fase2a-eiendom-matrikkel-testplan.md avsnitt 4. 4.7.5 (feil i
 * hendelsen eller loggen ruller tilbake) står i properties-transaction.test.ts.
 *
 * Signaturene er fra kortet punkt 7:
 * - getAssignmentProperty(actor, organizationId, assignmentId) → { property, commonAreas, prefill }
 *   (`property` har den ene matrikkelraden i `cadastralUnit`)
 * - saveAssignmentProperty(actor, organizationId, assignmentId, input)
 * - saveCommonAreas(actor, organizationId, assignmentId, input)
 * Testene leser resultatet av lagringen fra databasen, ikke fra svaret.
 *
 * Avgjørelser etter gjennomgangen (kortet): myk-slettet eiendom regnes som manglende eiendom, og
 * fellesdeler som ikke gjelder gir `commonAreas = null` (raden står).
 *
 * Testdata er oppdiktet: «Testveien 1», 0000, «Testby», 0000, «Testkommune», gnr/bnr 999,
 * fnr 0, snr 9, «Borettslaget Test», 000000000, 0-0, «Forvalter Test», «Sett trapperom og kjeller».
 *
 * Støtter hovedmål: reklamasjoner (boligtype og eierform på hvert oppdrag, fellesdeler for
 * leilighet, aldri data fra en annen organisasjon, ingenting slettes), tid (forhåndsutfylt fra
 * ordren) og KI først (`data_source = manual`, ingen adresse eller fritekst i hendelser og logg).
 */

beforeEach(resetDatabase);

const ADDRESS = "Testveien 1";
const CITY = "Testby";
const MUNICIPALITY = "Testkommune";
const ASSOCIATION = "Borettslaget Test";
const ORG_NUMBER = "000000000";
const SHARE_NUMBER = "0-0";
const MANAGING_AGENT = "Forvalter Test";
const NOTES = "Sett trapperom og kjeller";

/** Verdier som aldri skal stå i hendelser eller revisjonslogg (4.7.3). */
const PRIVATE_VALUES = [
  ADDRESS,
  CITY,
  MUNICIPALITY,
  "999",
  ASSOCIATION,
  ORG_NUMBER,
  SHARE_NUMBER,
  MANAGING_AGENT,
  "Sett trapperom",
];

type PropertyInput = Parameters<typeof saveAssignmentProperty>[3];
type CommonAreasInput = Parameters<typeof saveCommonAreas>[3];

function propertyInput(overrides: Record<string, unknown> = {}): PropertyInput {
  return {
    address: ADDRESS,
    postalCode: "0000",
    city: CITY,
    municipalityNumber: "0000",
    municipalityName: MUNICIPALITY,
    housingType: "apartment",
    ownershipForm: "cooperative",
    gnr: "999",
    bnr: "999",
    fnr: "0",
    snr: "9",
    associationName: ASSOCIATION,
    associationOrgNumber: ORG_NUMBER,
    shareNumber: SHARE_NUMBER,
    ...overrides,
  } as PropertyInput;
}

function commonAreasInput(overrides: Record<string, unknown> = {}): CommonAreasInput {
  return {
    managingAgent: MANAGING_AGENT,
    conditionReportStatus: "yes",
    maintenancePlanStatus: "unknown",
    notes: NOTES,
    ...overrides,
  } as CommonAreasInput;
}

async function setInspectorsEditAll(organizationId: string, value: boolean) {
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": value } })
    .where(eq(organizations.id, organizationId));
}

/** Organisasjon med admin og ett oppdrag uten eiendom. */
async function orgWithAdmin(name = "Testfirma takst") {
  const org = await createOrganization(name);
  const admin = await createUser({ name: "Test Admin" });
  const adminEmployee = await createEmployee(admin, org.id, ["admin"]);
  const assignment = await createAssignment(org.id);
  return { org, admin, adminEmployee, assignment };
}

/** Et oppdrag med leilighet i borettslag (fellesdeler gjelder). */
async function apartmentAssignment(organizationId: string) {
  const assignment = await createAssignment(organizationId);
  const { property, cadastralUnit } = await createProperty(organizationId, {
    assignmentId: assignment.id,
    housingType: "apartment",
    ownershipForm: "cooperative",
  });
  return { assignment, property, cadastralUnit };
}

async function person(organizationId: string, roles: EmployeeRole[], name?: string) {
  const actor = await createUser(name ? { name } : {});
  const employee = await createEmployee(actor, organizationId, roles);
  return { actor, employee };
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

async function cadastralRowsFor(propertyId: string) {
  return db
    .select()
    .from(cadastralUnits)
    .where(eq(cadastralUnits.propertyId, propertyId))
    .orderBy(asc(cadastralUnits.createdAt));
}

async function commonAreasRowsFor(assignmentId: string) {
  return db.select().from(commonAreas).where(eq(commonAreas.assignmentId, assignmentId));
}

async function activeCommonAreasFor(assignmentId: string) {
  return (await commonAreasRowsFor(assignmentId)).filter((row) => row.deletedAt === null);
}

async function eventsFor(organizationId: string, type?: string) {
  const rows = await db
    .select()
    .from(events)
    .where(eq(events.organizationId, organizationId))
    .orderBy(asc(events.receivedAt));
  return rows.filter((row) => type === undefined || row.type === type);
}

async function auditFor(organizationId: string, entityType?: string) {
  const rows = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.organizationId, organizationId))
    .orderBy(asc(auditLog.receivedAt), asc(auditLog.createdAt));
  return rows.filter((row) => entityType === undefined || row.entityType === entityType);
}

/** Bytter ut alle uuid-er, så tall i id-er ikke forveksles med gnr/bnr i personverntesten. */
function withoutIds(text: string): string {
  return text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>");
}

/** Fanger feilen fra en handling som skal feile. */
async function caught(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => null,
    (error: unknown) => error,
  );
}

/** Lagrer en eiendom og gir eiendoms-id-en fra oppdraget. */
async function savedPropertyId(
  actor: Actor,
  organizationId: string,
  assignmentId: string,
  input: PropertyInput = propertyInput(),
) {
  await saveAssignmentProperty(actor, organizationId, assignmentId, input);
  const row = await assignmentRow(assignmentId);
  if (!row.propertyId) throw new Error("oppdraget fikk ingen eiendom");
  return row.propertyId;
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

describe("4.1 tilgang per rolle", () => {
  it.each(MATRIX)(
    "4.1.1 $name med innstillingen $setting kan lese eiendommen",
    async ({ roles, editAll }) => {
      const org = await createOrganization();
      await setInspectorsEditAll(org.id, editAll);
      const { assignment, property } = await apartmentAssignment(org.id);
      const { actor } = await person(org.id, roles);

      const result = await getAssignmentProperty(actor, org.id, assignment.id);
      expect(result.property?.id).toBe(property.id);
    },
  );

  it.each(WRITE_ALLOWED)(
    "4.1.2 $name med innstillingen $setting kan lagre eiendom og fellesdeler",
    async ({ roles, editAll }) => {
      const org = await createOrganization();
      await setInspectorsEditAll(org.id, editAll);
      const assignment = await createAssignment(org.id);
      const { actor } = await person(org.id, roles);

      await saveAssignmentProperty(actor, org.id, assignment.id, propertyInput());
      await saveCommonAreas(actor, org.id, assignment.id, commonAreasInput());

      expect((await assignmentRow(assignment.id)).propertyId).not.toBeNull();
      expect(await activeCommonAreasFor(assignment.id)).toHaveLength(1);
    },
  );

  it.each([
    ["saveAssignmentProperty", "uten eiendom"],
    ["saveAssignmentProperty", "med eiendom"],
    ["saveCommonAreas", "med eiendom"],
  ] as const)(
    "4.1.2 takstmann med innstillingen av får AccessDeniedError på %s (%s), og ingenting endres",
    async (name, state) => {
      const org = await createOrganization();
      await setInspectorsEditAll(org.id, false);
      const target =
        state === "med eiendom"
          ? (await apartmentAssignment(org.id)).assignment
          : await createAssignment(org.id);
      const { actor } = await person(org.id, ["inspector"]);
      const before = await tableCounts();
      const assignmentBefore = await assignmentRow(target.id);

      const run =
        name === "saveAssignmentProperty"
          ? saveAssignmentProperty(actor, org.id, target.id, propertyInput({ address: "Nytt" }))
          : saveCommonAreas(actor, org.id, target.id, commonAreasInput());
      await expect(run).rejects.toThrow(AccessDeniedError);

      expect(await tableCounts()).toEqual(before);
      const assignmentAfter = await assignmentRow(target.id);
      expect(assignmentAfter.propertyId).toBe(assignmentBefore.propertyId);
      if (assignmentBefore.propertyId) {
        expect((await propertyRow(assignmentBefore.propertyId)).address).toBe(ADDRESS);
      }
    },
  );

  it("4.1.2 takstmann med innstillingen av kan fortsatt lese eiendommen og fellesdelene", async () => {
    const org = await createOrganization();
    await setInspectorsEditAll(org.id, false);
    const { assignment, property } = await apartmentAssignment(org.id);
    const areas = await createCommonAreas(org.id, { assignmentId: assignment.id });
    const { actor } = await person(org.id, ["inspector"]);

    const result = await getAssignmentProperty(actor, org.id, assignment.id);
    expect(result.property?.id).toBe(property.id);
    expect(result.commonAreas?.id).toBe(areas.id);
  });

  it("4.1.3 takstmann med innstillingen av og enkeltrettigheten assignment.edit kan begge skrivefunksjonene", async () => {
    const org = await createOrganization();
    await setInspectorsEditAll(org.id, false);
    const assignment = await createAssignment(org.id);
    const { actor, employee } = await person(org.id, ["inspector"]);
    await grantPermission(employee, "assignment.edit");

    await saveAssignmentProperty(actor, org.id, assignment.id, propertyInput());
    await saveCommonAreas(actor, org.id, assignment.id, commonAreasInput());
    expect((await assignmentRow(assignment.id)).propertyId).not.toBeNull();
    expect(await activeCommonAreasFor(assignment.id)).toHaveLength(1);
  });

  it("4.1.4 bruker uten ansattrad får AccessDeniedError på lesing og lagring", async () => {
    const { org } = await orgWithAdmin();
    const { assignment } = await apartmentAssignment(org.id);
    const stranger = await createUser();
    const before = await tableCounts();

    await expect(getAssignmentProperty(stranger, org.id, assignment.id)).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(
      saveAssignmentProperty(stranger, org.id, assignment.id, propertyInput()),
    ).rejects.toThrow(AccessDeniedError);
    expect(await tableCounts()).toEqual(before);
  });

  it.each([
    ["deaktivert", { deactivatedAt: new Date("2026-11-01T08:00:00Z") }],
    ["slettet", { deletedAt: new Date("2026-11-01T08:00:00Z") }],
  ] as const)(
    "4.1.4 %s ansatt (admin) får AccessDeniedError på lesing og lagring",
    async (_name, set) => {
      const { org } = await orgWithAdmin();
      const { assignment } = await apartmentAssignment(org.id);
      const { actor, employee } = await person(org.id, ["admin"]);
      await db.update(employees).set(set).where(eq(employees.id, employee.id));
      const before = await tableCounts();

      await expect(getAssignmentProperty(actor, org.id, assignment.id)).rejects.toThrow(
        AccessDeniedError,
      );
      await expect(
        saveAssignmentProperty(actor, org.id, assignment.id, propertyInput()),
      ).rejects.toThrow(AccessDeniedError);
      expect(await tableCounts()).toEqual(before);
    },
  );

  it("4.1.4 ansatt uten roller får AccessDeniedError på lesing og lagring", async () => {
    const { org } = await orgWithAdmin();
    const { assignment } = await apartmentAssignment(org.id);
    const { actor } = await person(org.id, []);
    const before = await tableCounts();

    await expect(getAssignmentProperty(actor, org.id, assignment.id)).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(
      saveAssignmentProperty(actor, org.id, assignment.id, propertyInput()),
    ).rejects.toThrow(AccessDeniedError);
    expect(await tableCounts()).toEqual(before);
  });

  // Regel 11: admin stenges aldri ute. Testen skal aldri fjernes.
  it("4.1.5 admin uten andre roller og med innstillingen av kan lese og bruke begge skrivefunksjonene", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);

    const empty = await getAssignmentProperty(admin, org.id, assignment.id);
    expect(empty.property).toBeNull();
    await saveAssignmentProperty(admin, org.id, assignment.id, propertyInput());
    await saveCommonAreas(admin, org.id, assignment.id, commonAreasInput());

    const result = await getAssignmentProperty(admin, org.id, assignment.id);
    expect(result.property).toMatchObject({ address: ADDRESS, housingType: "apartment" });
    expect(result.commonAreas).toMatchObject({ managingAgent: MANAGING_AGENT });
  });
});

// ---------------------------------------------------------------------------------------------
// 4.2 Tenant-isolasjon (regel 2): ett kall til expectTenantIsolation per funksjon
// ---------------------------------------------------------------------------------------------

describe("4.2 tenant-isolasjon", () => {
  it("4.2.1 getAssignmentProperty gir aldri eiendom eller fellesdeler fra en annen organisasjon", async () => {
    const assignmentFor = new Map<string, string>();
    const addressFor = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids: Record<string, string[]> = {};
        for (const [grant, address] of [
          [grantA, "Testveien 1 A"],
          [grantB, "Testveien 1 B"],
        ] as const) {
          const assignment = await createAssignment(grant.organizationId);
          const { property } = await createProperty(grant.organizationId, {
            assignmentId: assignment.id,
            address,
            housingType: "apartment",
            ownershipForm: "section",
          });
          const areas = await createCommonAreas(grant.organizationId, {
            assignmentId: assignment.id,
          });
          assignmentFor.set(grant.organizationId, assignment.id);
          addressFor.set(grant.organizationId, address);
          ids[grant.organizationId] = [property.id, areas.id];
        }
        return { a: ids[grantA.organizationId]!, b: ids[grantB.organizationId]! };
      },
      query: async (actor, organizationId) => {
        const result = await getAssignmentProperty(
          actor,
          organizationId,
          assignmentFor.get(organizationId) ?? randomUUID(),
        );
        // Adressen fra den andre organisasjonen står aldri i svaret
        const text = JSON.stringify(result);
        for (const [org, address] of addressFor) {
          if (org !== organizationId) expect(text).not.toContain(address);
        }
        return [result.property, result.commonAreas].filter(
          (row): row is NonNullable<typeof row> => row !== null,
        );
      },
      idOf: (row) => row.id,
    });
  });

  it("4.2.2 saveAssignmentProperty lagrer bare i egen organisasjon", async () => {
    const assignmentFor = new Map<string, string>();
    const propertyFor = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const grant of [grantA, grantB]) {
          const assignment = await createAssignment(grant.organizationId);
          const { property } = await createProperty(grant.organizationId, {
            assignmentId: assignment.id,
          });
          assignmentFor.set(grant.organizationId, assignment.id);
          propertyFor.set(grant.organizationId, property.id);
        }
        return {
          a: [propertyFor.get(grantA.organizationId)!],
          b: [propertyFor.get(grantB.organizationId)!],
        };
      },
      query: async (actor, organizationId) => {
        const assignmentId = assignmentFor.get(organizationId) ?? randomUUID();
        await saveAssignmentProperty(
          actor,
          organizationId,
          assignmentId,
          propertyInput({ address: `Testveien 1 ${organizationId.slice(0, 4)}` }),
        );
        const row = await assignmentRow(assignmentId);
        return [{ id: row.propertyId! }];
      },
      idOf: (row) => row.id,
    });

    // Hver organisasjon har bare sine egne rader, og eiendommen i B har Bs adresse
    for (const [organizationId, propertyId] of propertyFor) {
      const property = await propertyRow(propertyId);
      expect(property.organizationId).toBe(organizationId);
      expect(property.address).toBe(`Testveien 1 ${organizationId.slice(0, 4)}`);
      for (const unit of await cadastralRowsFor(propertyId)) {
        expect(unit.organizationId).toBe(organizationId);
      }
      for (const row of await eventsFor(organizationId)) {
        expect(row.assignmentId).toBe(assignmentFor.get(organizationId));
      }
    }
    expect(await rowCount(properties)).toBe(2);
  });

  it("4.2.3 saveCommonAreas lagrer bare i egen organisasjon", async () => {
    const assignmentFor = new Map<string, string>();
    const areasFor = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const grant of [grantA, grantB]) {
          const areas = await createCommonAreas(grant.organizationId);
          assignmentFor.set(grant.organizationId, areas.assignmentId);
          areasFor.set(grant.organizationId, areas.id);
        }
        return {
          a: [areasFor.get(grantA.organizationId)!],
          b: [areasFor.get(grantB.organizationId)!],
        };
      },
      query: async (actor, organizationId) => {
        const assignmentId = assignmentFor.get(organizationId) ?? randomUUID();
        await saveCommonAreas(
          actor,
          organizationId,
          assignmentId,
          commonAreasInput({ managingAgent: `Forvalter ${organizationId.slice(0, 4)}` }),
        );
        return (await activeCommonAreasFor(assignmentId)).map((row) => ({ id: row.id }));
      },
      idOf: (row) => row.id,
    });

    for (const [organizationId, areasId] of areasFor) {
      const rows = await activeCommonAreasFor(assignmentFor.get(organizationId)!);
      expect(rows.map((row) => row.id)).toEqual([areasId]);
      expect(rows[0]!.organizationId).toBe(organizationId);
      expect(rows[0]!.managingAgent).toBe(`Forvalter ${organizationId.slice(0, 4)}`);
    }
    expect(await rowCount(commonAreas)).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------
// 4.3 Fremmed, ukjent og ugyldig id (IDOR)
// ---------------------------------------------------------------------------------------------

describe("4.3 fremmed, ukjent og ugyldig id", () => {
  async function twoOrgs() {
    const a = await orgWithAdmin("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const b = await apartmentAssignment(orgB.id);
    const bAreas = await createCommonAreas(orgB.id, { assignmentId: b.assignment.id });
    return { a, orgB, b, bAreas };
  }

  async function snapshotB(b: Awaited<ReturnType<typeof twoOrgs>>) {
    const property = await propertyRow(b.b.property.id);
    const units = await cadastralRowsFor(b.b.property.id);
    const areas = await commonAreasRowsFor(b.b.assignment.id);
    const assignment = await assignmentRow(b.b.assignment.id);
    return {
      property: { ...property },
      units: units.map((u) => ({ ...u })),
      areas: areas.map((r) => ({ ...r })),
      propertyId: assignment.propertyId,
      eventsB: (await eventsFor(b.orgB.id)).length,
    };
  }

  it("4.3.1 admin i A med Bs oppdrags-id får AccessDeniedError i alle tre, og B er uendret", async () => {
    const setup = await twoOrgs();
    const { a, b } = setup;
    const before = await snapshotB(setup);
    const countsBefore = await tableCounts();

    for (const run of [
      () => getAssignmentProperty(a.admin, a.org.id, b.assignment.id),
      () => saveAssignmentProperty(a.admin, a.org.id, b.assignment.id, propertyInput()),
      () => saveCommonAreas(a.admin, a.org.id, b.assignment.id, commonAreasInput()),
    ]) {
      await expect(run()).rejects.toThrow(AccessDeniedError);
    }

    expect(await snapshotB(setup)).toEqual(before);
    expect(await tableCounts()).toEqual(countsBefore);
  });

  it("4.3.2 organizationId og propertyId i input ignoreres: bare As egen eiendom lages", async () => {
    const setup = await twoOrgs();
    const { a, orgB, b } = setup;
    const before = await snapshotB(setup);

    await saveAssignmentProperty(
      a.admin,
      a.org.id,
      a.assignment.id,
      propertyInput({
        propertyId: b.property.id,
        id: b.property.id,
        organizationId: orgB.id,
        dataSource: "kartverket",
        address: "Testveien 2",
      }),
    );

    const own = await assignmentRow(a.assignment.id);
    expect(own.propertyId).not.toBeNull();
    expect(own.propertyId).not.toBe(b.property.id);
    const property = await propertyRow(own.propertyId!);
    expect(property).toMatchObject({
      organizationId: a.org.id,
      address: "Testveien 2",
      dataSource: "manual",
    });
    expect(await snapshotB(setup)).toEqual(before);
  });

  it("4.3.2 lagring på nytt med Bs propertyId i input endrer bare As eiendom", async () => {
    const setup = await twoOrgs();
    const { a, b } = setup;
    const ownId = await savedPropertyId(a.admin, a.org.id, a.assignment.id);
    const before = await snapshotB(setup);

    await saveAssignmentProperty(
      a.admin,
      a.org.id,
      a.assignment.id,
      propertyInput({ propertyId: b.property.id, address: "Testveien 3" }),
    );

    expect((await assignmentRow(a.assignment.id)).propertyId).toBe(ownId);
    expect((await propertyRow(ownId)).address).toBe("Testveien 3");
    expect(await snapshotB(setup)).toEqual(before);
  });

  it.each([
    ["tilfeldig uuid", () => randomUUID()],
    ["ikke en id", () => "ikke-en-id"],
    ["tom", () => ""],
  ])(
    "4.3.3 %s som oppdrags-id gir AccessDeniedError i alle tre, aldri databasefeil",
    async (_n, id) => {
      const { org, admin } = await orgWithAdmin();
      const before = await tableCounts();
      for (const run of [
        () => getAssignmentProperty(admin, org.id, id()),
        () => saveAssignmentProperty(admin, org.id, id(), propertyInput()),
        () => saveCommonAreas(admin, org.id, id(), commonAreasInput()),
      ]) {
        const error = await caught(run());
        expect(error, String(error)).toBeInstanceOf(AccessDeniedError);
      }
      expect(await tableCounts()).toEqual(before);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// 4.4 Myk sletting
// ---------------------------------------------------------------------------------------------

describe("4.4 myk sletting", () => {
  it("4.4.1 slettet oppdrag gir AccessDeniedError i alle tre", async () => {
    const { org, admin } = await orgWithAdmin();
    const { assignment } = await apartmentAssignment(org.id);
    await db
      .update(assignments)
      .set({ deletedAt: TEST_NOW })
      .where(eq(assignments.id, assignment.id));
    const before = await tableCounts();

    for (const run of [
      () => getAssignmentProperty(admin, org.id, assignment.id),
      () => saveAssignmentProperty(admin, org.id, assignment.id, propertyInput()),
      () => saveCommonAreas(admin, org.id, assignment.id, commonAreasInput()),
    ]) {
      await expect(run()).rejects.toThrow(AccessDeniedError);
    }
    expect(await tableCounts()).toEqual(before);
  });

  it("4.4.2 myk-slettet eiendom regnes som manglende: property = null og prefill fra ordren", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await createOrder(org.id, {
      addressText: ADDRESS,
      gnr: "999",
      bnr: "999",
      snr: "9",
      housingAssociationName: ASSOCIATION,
    });
    const assignment = await createAssignment(org.id, { orderId: order.id });
    await db
      .update(orders)
      .set({ status: "converted", assignmentId: assignment.id })
      .where(eq(orders.id, order.id));
    const { property } = await createProperty(org.id, {
      assignmentId: assignment.id,
      address: "Testveien 5",
      deletedAt: TEST_NOW,
    });

    const result = await getAssignmentProperty(admin, org.id, assignment.id);
    expect(result.property).toBeNull();
    expect(result.prefill).toEqual({
      address: ADDRESS,
      gnr: "999",
      bnr: "999",
      snr: "9",
      associationName: ASSOCIATION,
    });
    expect(property.deletedAt).not.toBeNull();
  });

  it("4.4.2 lagring lager ny eiendom og flytter property_id; den slettede raden står urørt", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const { property: deleted } = await createProperty(org.id, {
      assignmentId: assignment.id,
      address: "Testveien 5",
      deletedAt: TEST_NOW,
    });
    const deletedBefore = await propertyRow(deleted.id);

    await saveAssignmentProperty(admin, org.id, assignment.id, propertyInput());

    const row = await assignmentRow(assignment.id);
    expect(row.propertyId).not.toBeNull();
    expect(row.propertyId).not.toBe(deleted.id);
    expect(await propertyRow(row.propertyId!)).toMatchObject({
      address: ADDRESS,
      deletedAt: null,
    });
    expect(await cadastralRowsFor(row.propertyId!)).toHaveLength(1);
    const deletedAfter = await propertyRow(deleted.id);
    expect(deletedAfter).toEqual(deletedBefore);
    expect(await cadastralRowsFor(deleted.id)).toHaveLength(1);
  });

  it("4.4.3 bytte til enebolig/selveier: fellesdelsraden står, men vises ikke; bytte tilbake viser den igjen", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await saveAssignmentProperty(admin, org.id, assignment.id, propertyInput());
    await saveCommonAreas(admin, org.id, assignment.id, commonAreasInput());
    const [areas] = await activeCommonAreasFor(assignment.id);
    expect(areas).toBeDefined();

    await saveAssignmentProperty(
      admin,
      org.id,
      assignment.id,
      propertyInput({ housingType: "detached", ownershipForm: "freehold" }),
    );
    const rows = await commonAreasRowsFor(assignment.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: areas!.id,
      deletedAt: null,
      managingAgent: MANAGING_AGENT,
    });
    expect((await getAssignmentProperty(admin, org.id, assignment.id)).commonAreas).toBeNull();

    await saveAssignmentProperty(admin, org.id, assignment.id, propertyInput());
    const back = await getAssignmentProperty(admin, org.id, assignment.id);
    expect(back.commonAreas).toMatchObject({
      id: areas!.id,
      managingAgent: MANAGING_AGENT,
      conditionReportStatus: "yes",
      maintenancePlanStatus: "unknown",
      notes: NOTES,
    });
  });

  it("4.4.4 myk-slettet fellesdelsrad vises ikke, og saveCommonAreas lager en ny rad", async () => {
    const { org, admin } = await orgWithAdmin();
    const { assignment } = await apartmentAssignment(org.id);
    const deleted = await createCommonAreas(org.id, {
      assignmentId: assignment.id,
      managingAgent: "Forvalter Slettet",
      deletedAt: TEST_NOW,
    });

    expect((await getAssignmentProperty(admin, org.id, assignment.id)).commonAreas).toBeNull();

    await saveCommonAreas(admin, org.id, assignment.id, commonAreasInput());
    const active = await activeCommonAreasFor(assignment.id);
    expect(active).toHaveLength(1);
    expect(active[0]!.id).not.toBe(deleted.id);
    const rows = await commonAreasRowsFor(assignment.id);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === deleted.id)?.managingAgent).toBe("Forvalter Slettet");
  });
});

// ---------------------------------------------------------------------------------------------
// 4.5 getAssignmentProperty
// ---------------------------------------------------------------------------------------------

describe("4.5 getAssignmentProperty", () => {
  const FORBIDDEN_KEYS = [
    "deletedAt",
    "deletedBy",
    "rowVersion",
    "organizationId",
    "createdBy",
    "updatedBy",
  ];

  it("4.5.1 faste felt: ingen deletedAt, rowVersion, organizationId eller createdBy", async () => {
    const { org, admin } = await orgWithAdmin();
    const { assignment } = await apartmentAssignment(org.id);
    await createCommonAreas(org.id, { assignmentId: assignment.id });

    const result = await getAssignmentProperty(admin, org.id, assignment.id);
    const property = result.property as unknown as Record<string, unknown>;
    const unit = property.cadastralUnit as Record<string, unknown>;
    const areas = result.commonAreas as unknown as Record<string, unknown>;

    expect(Object.keys(property).sort()).toEqual(
      [
        "id",
        "address",
        "postalCode",
        "city",
        "municipalityNumber",
        "municipalityName",
        "housingType",
        "ownershipForm",
        "dataSource",
        "cadastralUnit",
      ].sort(),
    );
    expect(Object.keys(unit).sort()).toEqual(
      [
        "id",
        "gnr",
        "bnr",
        "fnr",
        "snr",
        "associationName",
        "associationOrgNumber",
        "shareNumber",
      ].sort(),
    );
    expect(Object.keys(areas).sort()).toEqual(
      ["id", "managingAgent", "conditionReportStatus", "maintenancePlanStatus", "notes"].sort(),
    );
    for (const record of [property, unit, areas]) {
      for (const key of FORBIDDEN_KEYS) expect(Object.keys(record)).not.toContain(key);
    }
  });

  it("4.5.2 uten eiendom, med ordre: prefill har nøyaktig de fem verdiene fra ordren, adressen ikke delt opp", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await createOrder(org.id, {
      addressText: "Testveien 1, 0000 Testby",
      gnr: "999",
      bnr: "999",
      snr: "9",
      housingAssociationName: ASSOCIATION,
    });
    const assignment = await createAssignment(org.id, { orderId: order.id });
    await db
      .update(orders)
      .set({ status: "converted", assignmentId: assignment.id })
      .where(eq(orders.id, order.id));

    const result = await getAssignmentProperty(admin, org.id, assignment.id);
    expect(result.property).toBeNull();
    expect(result.commonAreas).toBeNull();
    expect(result.prefill).toEqual({
      address: "Testveien 1, 0000 Testby",
      gnr: "999",
      bnr: "999",
      snr: "9",
      associationName: ASSOCIATION,
    });
  });

  it("4.5.3 uten eiendom og uten ordre: prefill har tomme verdier", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const result = await getAssignmentProperty(admin, org.id, assignment.id);
    expect(result.property).toBeNull();
    expect(Object.keys(result.prefill).sort()).toEqual(
      ["address", "gnr", "bnr", "snr", "associationName"].sort(),
    );
    for (const value of Object.values(result.prefill)) expect([null, ""]).toContain(value);
  });

  it("4.5.4 med eiendom: property har feltene og én matrikkelrad, prefill er tom", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await createOrder(org.id, { addressText: "Ordreveien 1", gnr: "1", bnr: "2" });
    const assignment = await createAssignment(org.id, { orderId: order.id });
    await saveAssignmentProperty(admin, org.id, assignment.id, propertyInput());

    const result = await getAssignmentProperty(admin, org.id, assignment.id);
    expect(result.property).toMatchObject({
      address: ADDRESS,
      postalCode: "0000",
      city: CITY,
      municipalityNumber: "0000",
      municipalityName: MUNICIPALITY,
      housingType: "apartment",
      ownershipForm: "cooperative",
      dataSource: "manual",
      cadastralUnit: {
        gnr: "999",
        bnr: "999",
        fnr: "0",
        snr: "9",
        associationName: ASSOCIATION,
        associationOrgNumber: ORG_NUMBER,
        shareNumber: SHARE_NUMBER,
      },
    });
    const prefill = (result.prefill ?? {}) as Record<string, unknown>;
    for (const value of Object.values(prefill)) expect([null, ""]).toContain(value);
    expect(JSON.stringify(prefill)).not.toContain("Ordreveien");
  });

  it("4.5.5 flere matrikkelrader: svaret har én, og det er alltid den eldste (A65)", async () => {
    const { org, admin } = await orgWithAdmin();
    const { assignment, property, cadastralUnit } = await apartmentAssignment(org.id);
    const [older] = await db
      .insert(cadastralUnits)
      .values({
        organizationId: org.id,
        propertyId: property.id,
        gnr: "1",
        bnr: "1",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      })
      .returning();
    await db.insert(cadastralUnits).values({
      organizationId: org.id,
      propertyId: property.id,
      gnr: "3",
      bnr: "3",
      createdAt: new Date("2030-01-01T00:00:00Z"),
    });

    for (let i = 0; i < 3; i += 1) {
      const result = await getAssignmentProperty(admin, org.id, assignment.id);
      const unit = (result.property as unknown as { cadastralUnit: { id: string } }).cadastralUnit;
      expect(unit.id).toBe(older!.id);
      expect(unit.id).not.toBe(cadastralUnit.id);
    }
  });

  it("4.5.6 myk-slettet ordre gir tom prefill", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await createOrder(org.id, {
      addressText: ADDRESS,
      gnr: "999",
      bnr: "999",
      deletedAt: TEST_NOW,
    });
    const assignment = await createAssignment(org.id, { orderId: order.id });
    await db
      .update(orders)
      .set({ status: "converted", assignmentId: assignment.id })
      .where(eq(orders.id, order.id));

    const result = await getAssignmentProperty(admin, org.id, assignment.id);
    for (const value of Object.values(result.prefill)) expect([null, ""]).toContain(value);
  });
});

// ---------------------------------------------------------------------------------------------
// 4.6 Lagring
// ---------------------------------------------------------------------------------------------

describe("4.6 lagring", () => {
  it("4.6.1 første lagring lager én eiendom og én matrikkelrad, setter property_id og gir én hendelse", async () => {
    const { org, admin, adminEmployee, assignment } = await orgWithAdmin();

    await saveAssignmentProperty(admin, org.id, assignment.id, propertyInput());

    const row = await assignmentRow(assignment.id);
    expect(row.propertyId).not.toBeNull();
    const property = await propertyRow(row.propertyId!);
    expect(property).toMatchObject({
      organizationId: org.id,
      address: ADDRESS,
      postalCode: "0000",
      city: CITY,
      municipalityNumber: "0000",
      municipalityName: MUNICIPALITY,
      housingType: "apartment",
      ownershipForm: "cooperative",
      dataSource: "manual",
      createdBy: adminEmployee.id,
      deletedAt: null,
    });
    const units = await cadastralRowsFor(property.id);
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({
      organizationId: org.id,
      gnr: "999",
      bnr: "999",
      fnr: "0",
      snr: "9",
      associationName: ASSOCIATION,
      associationOrgNumber: ORG_NUMBER,
      shareNumber: SHARE_NUMBER,
    });
    expect(await rowCount(properties)).toBe(1);
    expect(await rowCount(cadastralUnits)).toBe(1);

    const saved = await eventsFor(org.id, "assignment.property_saved");
    expect(saved).toHaveLength(1);
    expect(saved[0]!.assignmentId).toBe(assignment.id);
    expect(saved[0]!.data).toEqual({ propertyId: property.id, created: true });
  });

  it("4.6.2 andre lagring oppdaterer de samme radene; ingen nye rader; created = false", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const propertyId = await savedPropertyId(admin, org.id, assignment.id);
    const [unit] = await cadastralRowsFor(propertyId);

    await saveAssignmentProperty(
      admin,
      org.id,
      assignment.id,
      propertyInput({ address: "Testveien 2", gnr: "998", housingType: "terraced" }),
    );

    expect((await assignmentRow(assignment.id)).propertyId).toBe(propertyId);
    expect(await propertyRow(propertyId)).toMatchObject({
      address: "Testveien 2",
      housingType: "terraced",
    });
    const units = await cadastralRowsFor(propertyId);
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({ id: unit!.id, gnr: "998" });
    expect(await rowCount(properties)).toBe(1);
    expect(await rowCount(cadastralUnits)).toBe(1);

    const saved = await eventsFor(org.id, "assignment.property_saved");
    expect(saved.map((row) => row.data)).toEqual([
      { propertyId, created: true },
      { propertyId, created: false },
    ]);
  });

  it("4.6.3 lagring uten endring gir ingen hendelse, ingen loggrad og samme updated_at", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const propertyId = await savedPropertyId(admin, org.id, assignment.id);
    const propertyBefore = await propertyRow(propertyId);
    const [unitBefore] = await cadastralRowsFor(propertyId);
    const eventsBefore = await rowCount(events);
    const auditBefore = await rowCount(auditLog);

    await saveAssignmentProperty(admin, org.id, assignment.id, propertyInput());

    expect(await rowCount(events)).toBe(eventsBefore);
    expect(await rowCount(auditLog)).toBe(auditBefore);
    const propertyAfter = await propertyRow(propertyId);
    expect(propertyAfter.updatedAt.toISOString()).toBe(propertyBefore.updatedAt.toISOString());
    expect(propertyAfter.rowVersion).toBe(propertyBefore.rowVersion);
    const [unitAfter] = await cadastralRowsFor(propertyId);
    expect(unitAfter!.updatedAt.toISOString()).toBe(unitBefore!.updatedAt.toISOString());
  });

  it("4.6.4 valgfrie felt kan tømmes: postnummer satt, så tomt → null", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const propertyId = await savedPropertyId(admin, org.id, assignment.id);
    expect((await propertyRow(propertyId)).postalCode).toBe("0000");

    await saveAssignmentProperty(
      admin,
      org.id,
      assignment.id,
      propertyInput({ postalCode: "", fnr: "", shareNumber: "" }),
    );

    expect((await propertyRow(propertyId)).postalCode).toBeNull();
    const [unit] = await cadastralRowsFor(propertyId);
    expect(unit).toMatchObject({ fnr: null, shareNumber: null });
  });

  it.each([
    ["uten boligtype", { housingType: "" }],
    ["med ukjent eierform", { ownershipForm: "bond" }],
    ["med bokstaver i gnr", { gnr: "12a" }],
    ["med fødselsnummer i adressen", { address: "12345678901" }],
  ])("4.6.5 lagring %s gir ZodError, ingen rad og ingen hendelse", async (_name, overrides) => {
    const { org, admin, assignment } = await orgWithAdmin();
    const before = await tableCounts();

    await expect(
      saveAssignmentProperty(admin, org.id, assignment.id, propertyInput(overrides)),
    ).rejects.toBeInstanceOf(ZodError);

    expect(await tableCounts()).toEqual(before);
    expect((await assignmentRow(assignment.id)).propertyId).toBeNull();
  });

  it("4.6.5 ugyldige fellesdeler gir ZodError og ingen rad", async () => {
    const { org, admin } = await orgWithAdmin();
    const { assignment } = await apartmentAssignment(org.id);
    const before = await tableCounts();
    await expect(
      saveCommonAreas(admin, org.id, assignment.id, commonAreasInput({ notes: "12345678901" })),
    ).rejects.toBeInstanceOf(ZodError);
    expect(await tableCounts()).toEqual(before);
  });

  it("4.6.6 saveCommonAreas på enebolig med selveier gir CommonAreasNotApplicableError og ingen rad", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await createProperty(org.id, {
      assignmentId: assignment.id,
      housingType: "detached",
      ownershipForm: "freehold",
    });
    const before = await tableCounts();

    await expect(
      saveCommonAreas(admin, org.id, assignment.id, commonAreasInput()),
    ).rejects.toBeInstanceOf(CommonAreasNotApplicableError);

    expect(await tableCounts()).toEqual(before);
  });

  it("4.6.6 saveCommonAreas uten eiendom gir CommonAreasNotApplicableError og ingen rad", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const before = await tableCounts();

    await expect(
      saveCommonAreas(admin, org.id, assignment.id, commonAreasInput()),
    ).rejects.toBeInstanceOf(CommonAreasNotApplicableError);

    expect(await tableCounts()).toEqual(before);
  });

  it("4.6.6 saveCommonAreas når eiendommen er myk-slettet gir CommonAreasNotApplicableError", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await createProperty(org.id, {
      assignmentId: assignment.id,
      housingType: "apartment",
      ownershipForm: "cooperative",
      deletedAt: TEST_NOW,
    });
    await expect(
      saveCommonAreas(admin, org.id, assignment.id, commonAreasInput()),
    ).rejects.toBeInstanceOf(CommonAreasNotApplicableError);
    expect(await rowCount(commonAreas)).toBe(0);
  });

  it.each([
    ["apartment", "freehold"],
    ["detached", "section"],
    ["terraced", "cooperative"],
    ["detached", "share"],
    ["apartment", "share"],
  ])("4.6.7 saveCommonAreas på %s med %s lykkes", async (housingType, ownershipForm) => {
    const { org, admin, adminEmployee, assignment } = await orgWithAdmin();
    await createProperty(org.id, { assignmentId: assignment.id, housingType, ownershipForm });

    await saveCommonAreas(admin, org.id, assignment.id, commonAreasInput());

    const rows = await activeCommonAreasFor(assignment.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: org.id,
      managingAgent: MANAGING_AGENT,
      conditionReportStatus: "yes",
      maintenancePlanStatus: "unknown",
      notes: NOTES,
      createdBy: adminEmployee.id,
    });
  });

  it("4.6.8 saveCommonAreas to ganger: én rad, oppdatert; created = false; uten endring ingen hendelse", async () => {
    const { org, admin } = await orgWithAdmin();
    const { assignment } = await apartmentAssignment(org.id);

    await saveCommonAreas(admin, org.id, assignment.id, commonAreasInput());
    const [first] = await activeCommonAreasFor(assignment.id);
    await saveCommonAreas(
      admin,
      org.id,
      assignment.id,
      commonAreasInput({ maintenancePlanStatus: "no", notes: "Sett tak" }),
    );

    const rows = await commonAreasRowsFor(assignment.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: first!.id,
      maintenancePlanStatus: "no",
      notes: "Sett tak",
    });

    const saved = await eventsFor(org.id, "assignment.common_areas_saved");
    expect(saved.map((row) => row.data)).toEqual([
      { commonAreasId: first!.id, created: true },
      { commonAreasId: first!.id, created: false },
    ]);
    for (const row of saved) expect(row.assignmentId).toBe(assignment.id);

    const eventsBefore = await rowCount(events);
    const auditBefore = await rowCount(auditLog);
    const before = rows[0]!;
    await saveCommonAreas(
      admin,
      org.id,
      assignment.id,
      commonAreasInput({ maintenancePlanStatus: "no", notes: "Sett tak" }),
    );
    expect(await rowCount(events)).toBe(eventsBefore);
    expect(await rowCount(auditLog)).toBe(auditBefore);
    const [after] = await commonAreasRowsFor(assignment.id);
    expect(after!.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
  });

  it("4.6.9 to samtidige første lagringer gir én eiendom og én property_id", async () => {
    const { org, admin, assignment } = await orgWithAdmin();

    const results = await Promise.allSettled([
      saveAssignmentProperty(admin, org.id, assignment.id, propertyInput()),
      saveAssignmentProperty(admin, org.id, assignment.id, propertyInput()),
    ]);
    for (const result of results) {
      expect(result.status, JSON.stringify(result)).toBe("fulfilled");
    }

    const activeProperties = await db
      .select()
      .from(properties)
      .where(and(eq(properties.organizationId, org.id)));
    expect(activeProperties).toHaveLength(1);
    expect((await assignmentRow(assignment.id)).propertyId).toBe(activeProperties[0]!.id);
    expect(await rowCount(cadastralUnits)).toBe(1);
  });

  it("4.6.9 to samtidige saveCommonAreas gir én aktiv rad og ingen unik-feil til brukeren", async () => {
    const { org, admin } = await orgWithAdmin();
    const { assignment } = await apartmentAssignment(org.id);

    const results = await Promise.allSettled([
      saveCommonAreas(admin, org.id, assignment.id, commonAreasInput()),
      saveCommonAreas(admin, org.id, assignment.id, commonAreasInput({ notes: "Sett tak" })),
    ]);
    for (const result of results) {
      expect(result.status, JSON.stringify(result)).toBe("fulfilled");
    }
    expect(await activeCommonAreasFor(assignment.id)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// 4.7 Hendelser og revisjonslogg
// ---------------------------------------------------------------------------------------------

describe("4.7 hendelser og revisjonslogg", () => {
  it("4.7.1 saveAssignmentProperty: revisjonslogg property og cadastral_unit med create, så update med feltnavnene", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const propertyId = await savedPropertyId(admin, org.id, assignment.id);
    const [unit] = await cadastralRowsFor(propertyId);

    const created = await auditFor(org.id);
    expect(
      created.filter((row) => row.entityType === "property").map((r) => [r.entityId, r.action]),
    ).toEqual([[propertyId, "create"]]);
    expect(
      created
        .filter((row) => row.entityType === "cadastral_unit")
        .map((r) => [r.entityId, r.action]),
    ).toEqual([[unit!.id, "create"]]);
    expect(JSON.stringify(created.map((row) => row.changes))).toContain("cooperative");

    await saveAssignmentProperty(
      admin,
      org.id,
      assignment.id,
      propertyInput({ postalCode: "0001", shareNumber: "1-1" }),
    );

    const updates = (await auditFor(org.id)).filter((row) => row.action === "update");
    const propertyUpdate = updates.find((row) => row.entityType === "property");
    const unitUpdate = updates.find((row) => row.entityType === "cadastral_unit");
    expect(propertyUpdate?.entityId).toBe(propertyId);
    expect(JSON.stringify(propertyUpdate?.changes)).toMatch(/postalCode|postal_code/);
    expect(unitUpdate?.entityId).toBe(unit!.id);
    expect(JSON.stringify(unitUpdate?.changes)).toMatch(/shareNumber|share_number/);
  });

  it("4.7.1 bare matrikkelen endret: ingen update-rad for property", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await savedPropertyId(admin, org.id, assignment.id);
    await saveAssignmentProperty(admin, org.id, assignment.id, propertyInput({ gnr: "998" }));
    const updates = (await auditFor(org.id)).filter((row) => row.action === "update");
    expect(updates.map((row) => row.entityType)).toEqual(["cadastral_unit"]);
  });

  it("4.7.2 saveCommonAreas: hendelse og revisjonslogg common_areas med create og update", async () => {
    const { org, admin } = await orgWithAdmin();
    const { assignment } = await apartmentAssignment(org.id);
    await saveCommonAreas(admin, org.id, assignment.id, commonAreasInput());
    const [row] = await activeCommonAreasFor(assignment.id);
    await saveCommonAreas(
      admin,
      org.id,
      assignment.id,
      commonAreasInput({ conditionReportStatus: "no" }),
    );

    const audit = await auditFor(org.id, "common_areas");
    expect(audit.map((r) => [r.entityId, r.action])).toEqual([
      [row!.id, "create"],
      [row!.id, "update"],
    ]);
    expect(JSON.stringify(audit[1]!.changes)).toMatch(
      /conditionReportStatus|condition_report_status/,
    );
    const saved = await eventsFor(org.id, "assignment.common_areas_saved");
    expect(saved).toHaveLength(2);
  });

  it("4.7.3 ingen adresse, matrikkel eller fritekst i hendelser og revisjonslogg (create og update)", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await saveAssignmentProperty(admin, org.id, assignment.id, propertyInput());
    await saveCommonAreas(admin, org.id, assignment.id, commonAreasInput());
    // Update: skriv de samme private verdiene på nytt i andre felt, og endre dem
    await saveAssignmentProperty(
      admin,
      org.id,
      assignment.id,
      propertyInput({
        address: `${ADDRESS} B`,
        city: `${CITY} B`,
        municipalityName: `${MUNICIPALITY} B`,
        gnr: "9999",
        associationName: `${ASSOCIATION} B`,
        shareNumber: `${SHARE_NUMBER}-0`,
      }),
    );
    await saveCommonAreas(
      admin,
      org.id,
      assignment.id,
      commonAreasInput({ managingAgent: `${MANAGING_AGENT} B`, notes: `${NOTES} B` }),
    );

    const eventRows = await eventsFor(org.id);
    const auditRows = await auditFor(org.id);
    expect(eventRows.length).toBeGreaterThanOrEqual(4);
    expect(auditRows.filter((row) => row.action === "update").length).toBeGreaterThanOrEqual(3);

    const text = withoutIds(
      JSON.stringify({
        events: eventRows.map((row) => row.data),
        audit: auditRows.map((row) => row.changes),
      }),
    );
    for (const value of PRIVATE_VALUES) expect(text, value).not.toContain(value);
  });

  it("4.7.4 ingen hendelse ved avvist tilgang, valideringsfeil, fellesdeler som ikke gjelder eller ingen endring", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);
    const { actor: inspector } = await person(org.id, ["inspector"]);

    await caught(saveAssignmentProperty(inspector, org.id, assignment.id, propertyInput()));
    await caught(
      saveAssignmentProperty(admin, org.id, assignment.id, propertyInput({ housingType: "" })),
    );
    await caught(saveCommonAreas(admin, org.id, assignment.id, commonAreasInput()));
    expect(await rowCount(events)).toBe(0);
    expect(await rowCount(auditLog)).toBe(0);

    await saveAssignmentProperty(
      admin,
      org.id,
      assignment.id,
      propertyInput({ housingType: "detached", ownershipForm: "freehold" }),
    );
    const eventsAfterSave = await rowCount(events);
    await caught(saveCommonAreas(admin, org.id, assignment.id, commonAreasInput()));
    await saveAssignmentProperty(
      admin,
      org.id,
      assignment.id,
      propertyInput({ housingType: "detached", ownershipForm: "freehold" }),
    );
    expect(await rowCount(events)).toBe(eventsAfterSave);
  });
});
