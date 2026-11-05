import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { AccessDeniedError, type Actor } from "@/core/access";
import { db } from "@/db/client";
import {
  assignmentParties,
  assignments,
  assignmentTeamMembers,
  auditLog,
  companies,
  employees,
  events,
  organizations,
  type EmployeeRole,
} from "@/db/schema";
import {
  createAssignment,
  createAssignmentParty,
  createCompany,
  createEmployee,
  createOffice,
  createOrder,
  createOrganization,
  createTeamMember,
  createUser,
  grantPermission,
  resetDatabase,
  TEST_NOW,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { EmployeeNotFoundError } from "./errors";
import { addParty, getAssignment, removeParty, setTeamMember, updateParty } from "./index";

/*
 * Team og parter på oppdraget: kjernen i src/core/assignments.
 * Testplan: docs/funksjoner/fase2a-oppdrag-team-parter-testplan.md avsnitt 4.
 * 4.8.5 (feil i hendelsen eller loggen ruller tilbake) står i
 * assignment-team-parties-transaction.test.ts.
 *
 * Signaturene er fra kortet punkt 4:
 * - getAssignment(actor, organizationId, assignmentId) → { id, number, status, officeName,
 *   orderId, companyName, team, parties, teamCandidates } (oppdragsfeltene flatt, listene ved
 *   siden av)
 * - setTeamMember(actor, organizationId, assignmentId, { teamRole, employeeId, reason?, now? })
 * - addParty(actor, organizationId, assignmentId, input) → raden (minst `id`)
 * - updateParty(actor, organizationId, partyId, input), removeParty(actor, organizationId, partyId)
 *
 * Fast tid: TEST_NOW og LATER = TEST_NOW + 1 time. Testdata er oppdiktet: «Megler Test»,
 * «Testmegling AS», megler@example.com, telefon 00000000, grunn «Ferie».
 *
 * Støtter hovedmål: reklamasjoner (hvem hadde ansvaret står alltid, bytter skrives aldri over,
 * aldri data fra en annen organisasjon), tid (partene står på oppdraget) og KI først (rollekoder
 * og mottar-valg er data, uten personopplysninger i hendelser og logg).
 */

beforeEach(resetDatabase);

const LATER = new Date(TEST_NOW.getTime() + 60 * 60 * 1000);
const LATEST = new Date(TEST_NOW.getTime() + 2 * 60 * 60 * 1000);

const PARTY_NAME = "Megler Test";
const FIRM = "Testmegling AS";
const EMAIL = "megler@example.com";
const PHONE = "00000000";
const REASON = "Ferie";
const PERSONAL_VALUES = [PARTY_NAME, FIRM, EMAIL, PHONE, REASON];

type PartyInput = Parameters<typeof addParty>[3];

function partyInput(overrides: Record<string, unknown> = {}): PartyInput {
  return {
    role: "broker",
    name: PARTY_NAME,
    firmName: FIRM,
    email: EMAIL,
    phone: PHONE,
    receivesReport: true,
    receivesInvoice: false,
    receivesMessages: true,
    ...overrides,
  } as PartyInput;
}

async function setInspectorsEditAll(organizationId: string, value: boolean) {
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": value } })
    .where(eq(organizations.id, organizationId));
}

/** Organisasjon med admin, ett kontor og ett oppdrag. */
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

async function rowCount(
  table: typeof assignmentTeamMembers | typeof assignmentParties | typeof events | typeof auditLog,
) {
  const [row] = await db.select({ n: count() }).from(table);
  return row?.n ?? 0;
}

async function tableCounts() {
  return {
    team: await rowCount(assignmentTeamMembers),
    parties: await rowCount(assignmentParties),
    events: await rowCount(events),
    auditLog: await rowCount(auditLog),
  };
}

async function teamRows(assignmentId: string, teamRole?: string) {
  const rows = await db
    .select()
    .from(assignmentTeamMembers)
    .where(eq(assignmentTeamMembers.assignmentId, assignmentId));
  return rows
    .filter((row) => teamRole === undefined || row.teamRole === teamRole)
    .sort((a, b) => a.fromAt.getTime() - b.fromAt.getTime());
}

async function activeTeamRows(assignmentId: string, teamRole?: string) {
  return (await teamRows(assignmentId, teamRole)).filter(
    (row) => row.toAt === null && row.deletedAt === null,
  );
}

async function partyRow(id: string) {
  const [row] = await db.select().from(assignmentParties).where(eq(assignmentParties.id, id));
  if (!row) throw new Error("fant ikke parten");
  return row;
}

async function eventsFor(organizationId: string, type?: string) {
  const rows = await db.select().from(events).where(eq(events.organizationId, organizationId));
  return rows.filter((row) => type === undefined || row.type === type);
}

async function auditFor(organizationId: string, entityType?: string) {
  const rows = await db.select().from(auditLog).where(eq(auditLog.organizationId, organizationId));
  return rows.filter((row) => entityType === undefined || row.entityType === entityType);
}

/** Admin-aktøren i organisasjonen (fra `expectTenantIsolation`). */
async function adminActorOf(organizationId: string): Promise<Actor> {
  const [row] = await db
    .select({ userId: employees.userId, name: employees.name })
    .from(employees)
    .where(eq(employees.organizationId, organizationId));
  return { id: row!.userId!, email: `${row!.userId}@example.com`, name: row!.name };
}

/** Fanger feilen fra en handling som skal feile. */
async function caught(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => null,
    (error: unknown) => error,
  );
}

/** Data til alle fire skrivefunksjonene i organisasjonen. */
async function writeFixtures(organizationId: string, assignmentId: string) {
  const { employee } = await person(organizationId, ["inspector"], "Takstmann Testesen");
  const toUpdate = await createAssignmentParty(organizationId, { assignmentId });
  const toRemove = await createAssignmentParty(organizationId, { assignmentId, role: "seller" });
  return { employee, toUpdate, toRemove };
}

type WriteFixtures = Awaited<ReturnType<typeof writeFixtures>>;

/** De fire skrivefunksjonene, hver for seg. */
function writeCalls(actor: Actor, organizationId: string, assignmentId: string, f: WriteFixtures) {
  return {
    setTeamMember: () =>
      setTeamMember(actor, organizationId, assignmentId, {
        teamRole: "responsible",
        employeeId: f.employee.id,
        now: TEST_NOW,
      }),
    addParty: () => addParty(actor, organizationId, assignmentId, partyInput()),
    updateParty: () =>
      updateParty(actor, organizationId, f.toUpdate.id, partyInput({ name: "Megler Endret" })),
    removeParty: () => removeParty(actor, organizationId, f.toRemove.id),
  };
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

const READ_MATRIX = SETTINGS.flatMap((s) => ROLE_CASES.map((r) => ({ ...r, ...s })));
const WRITE_ALLOWED = READ_MATRIX.filter((c) => c.editAll || c.roles[0] !== "inspector");

describe("4.1 tilgang per rolle", () => {
  it.each(READ_MATRIX)(
    "4.1.1 $name med innstillingen $setting kan lese oppdraget",
    async ({ roles, editAll }) => {
      const { org, assignment } = await orgWithAdmin();
      await setInspectorsEditAll(org.id, editAll);
      const { actor } = await person(org.id, roles);

      const result = await getAssignment(actor, org.id, assignment.id);
      expect(result.id).toBe(assignment.id);
    },
  );

  it.each(WRITE_ALLOWED)(
    "4.1.2 $name med innstillingen $setting kan sette teamet og legge til, endre og fjerne parter",
    async ({ roles, editAll }) => {
      const { org, assignment } = await orgWithAdmin();
      await setInspectorsEditAll(org.id, editAll);
      const { actor } = await person(org.id, roles);
      const fixtures = await writeFixtures(org.id, assignment.id);
      const calls = writeCalls(actor, org.id, assignment.id, fixtures);

      await calls.setTeamMember();
      await calls.addParty();
      await calls.updateParty();
      await calls.removeParty();

      expect(await activeTeamRows(assignment.id, "responsible")).toHaveLength(1);
      expect((await partyRow(fixtures.toUpdate.id)).name).toBe("Megler Endret");
      expect((await partyRow(fixtures.toRemove.id)).deletedAt).not.toBeNull();
    },
  );

  it.each(["setTeamMember", "addParty", "updateParty", "removeParty"] as const)(
    "4.1.2 takstmann med innstillingen av får AccessDeniedError på %s, og ingen tabell endres",
    async (name) => {
      const { org, assignment } = await orgWithAdmin();
      await setInspectorsEditAll(org.id, false);
      const { actor } = await person(org.id, ["inspector"]);
      const fixtures = await writeFixtures(org.id, assignment.id);
      const before = await tableCounts();
      const updateBefore = await partyRow(fixtures.toUpdate.id);

      await expect(writeCalls(actor, org.id, assignment.id, fixtures)[name]()).rejects.toThrow(
        AccessDeniedError,
      );

      expect(await tableCounts()).toEqual(before);
      const updateAfter = await partyRow(fixtures.toUpdate.id);
      expect(updateAfter.name).toBe(updateBefore.name);
      expect(updateAfter.rowVersion).toBe(updateBefore.rowVersion);
      expect((await partyRow(fixtures.toRemove.id)).deletedAt).toBeNull();
    },
  );

  it("4.1.2 takstmann med innstillingen av kan fortsatt lese teamet og partene", async () => {
    const { org, assignment } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);
    const member = await createTeamMember(org.id, { assignmentId: assignment.id });
    const party = await createAssignmentParty(org.id, { assignmentId: assignment.id });
    const { actor } = await person(org.id, ["inspector"]);

    const result = await getAssignment(actor, org.id, assignment.id);
    expect(result.team.map((row) => row.employeeId)).toEqual([member.employeeId]);
    expect(result.parties.map((row) => row.id)).toEqual([party.id]);
  });

  it("4.1.3 takstmann med innstillingen av og enkeltrettigheten assignment.edit kan alle fire", async () => {
    const { org, assignment } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);
    const { actor, employee } = await person(org.id, ["inspector"]);
    await grantPermission(employee, "assignment.edit");
    const fixtures = await writeFixtures(org.id, assignment.id);
    const calls = writeCalls(actor, org.id, assignment.id, fixtures);

    await calls.setTeamMember();
    await calls.addParty();
    await calls.updateParty();
    await calls.removeParty();
    expect(await activeTeamRows(assignment.id, "responsible")).toHaveLength(1);
    expect((await partyRow(fixtures.toRemove.id)).deletedAt).not.toBeNull();
  });

  it("4.1.4 bruker uten ansattrad får AccessDeniedError på getAssignment og addParty", async () => {
    const { org, assignment } = await orgWithAdmin();
    const stranger = await createUser();
    const before = await tableCounts();

    await expect(getAssignment(stranger, org.id, assignment.id)).rejects.toThrow(AccessDeniedError);
    await expect(addParty(stranger, org.id, assignment.id, partyInput())).rejects.toThrow(
      AccessDeniedError,
    );
    expect(await tableCounts()).toEqual(before);
  });

  it.each([
    ["deaktivert", { deactivatedAt: new Date("2026-11-01T08:00:00Z") }],
    ["slettet", { deletedAt: new Date("2026-11-01T08:00:00Z") }],
  ] as const)(
    "4.1.4 %s ansatt (admin) får AccessDeniedError på getAssignment og addParty",
    async (_name, set) => {
      const { org, assignment } = await orgWithAdmin();
      const { actor, employee } = await person(org.id, ["admin"]);
      await db.update(employees).set(set).where(eq(employees.id, employee.id));
      const before = await tableCounts();

      await expect(getAssignment(actor, org.id, assignment.id)).rejects.toThrow(AccessDeniedError);
      await expect(addParty(actor, org.id, assignment.id, partyInput())).rejects.toThrow(
        AccessDeniedError,
      );
      expect(await tableCounts()).toEqual(before);
    },
  );

  it("4.1.4 ansatt uten roller får AccessDeniedError på getAssignment og addParty", async () => {
    const { org, assignment } = await orgWithAdmin();
    const { actor } = await person(org.id, []);
    await expect(getAssignment(actor, org.id, assignment.id)).rejects.toThrow(AccessDeniedError);
    await expect(addParty(actor, org.id, assignment.id, partyInput())).rejects.toThrow(
      AccessDeniedError,
    );
    expect(await rowCount(assignmentParties)).toBe(0);
  });

  // Regel 11: admin stenges aldri ute. Testen skal aldri fjernes.
  it("4.1.5 admin uten andre roller og med innstillingen av kan lese og bruke alle fire skrivefunksjonene", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);
    const fixtures = await writeFixtures(org.id, assignment.id);
    const calls = writeCalls(admin, org.id, assignment.id, fixtures);

    expect((await getAssignment(admin, org.id, assignment.id)).id).toBe(assignment.id);
    await calls.setTeamMember();
    await calls.addParty();
    await calls.updateParty();
    await calls.removeParty();

    const result = await getAssignment(admin, org.id, assignment.id);
    expect(result.team.map((row) => row.employeeId)).toEqual([fixtures.employee.id]);
    expect(result.parties.map((row) => row.name).sort()).toEqual(["Megler Endret", PARTY_NAME]);
  });
});

// ---------------------------------------------------------------------------------------------
// 4.2 Tenant-isolasjon (regel 2): åtte kall til expectTenantIsolation (det niende, 5.1 for
// utstedende selskap, står nederst)
// ---------------------------------------------------------------------------------------------

describe("4.2 tenant-isolasjon", () => {
  it("4.2.1 getAssignment gir aldri et oppdrag fra en annen organisasjon", async () => {
    const assignmentFor = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const grant of [grantA, grantB]) {
          const row = await createAssignment(grant.organizationId);
          assignmentFor.set(grant.organizationId, row.id);
        }
        return {
          a: [assignmentFor.get(grantA.organizationId)!],
          b: [assignmentFor.get(grantB.organizationId)!],
        };
      },
      query: async (actor, organizationId) => [
        await getAssignment(
          actor,
          organizationId,
          assignmentFor.get(organizationId) ?? randomUUID(),
        ),
      ],
      idOf: (row) => row.id,
    });
  });

  it("4.2.2 getAssignment(...).team viser aldri teamrader fra en annen organisasjon", async () => {
    const assignmentFor = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids: Record<string, string[]> = {};
        for (const grant of [grantA, grantB]) {
          const member = await createTeamMember(grant.organizationId);
          assignmentFor.set(grant.organizationId, member.assignmentId);
          ids[grant.organizationId] = [member.employeeId];
        }
        return { a: ids[grantA.organizationId]!, b: ids[grantB.organizationId]! };
      },
      query: async (actor, organizationId) =>
        (
          await getAssignment(
            actor,
            organizationId,
            assignmentFor.get(organizationId) ?? randomUUID(),
          )
        ).team,
      idOf: (row) => row.employeeId,
    });
  });

  it("4.2.3 getAssignment(...).parties viser aldri parter fra en annen organisasjon", async () => {
    const assignmentFor = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids: Record<string, string[]> = {};
        for (const grant of [grantA, grantB]) {
          const party = await createAssignmentParty(grant.organizationId);
          assignmentFor.set(grant.organizationId, party.assignmentId);
          ids[grant.organizationId] = [party.id];
        }
        return { a: ids[grantA.organizationId]!, b: ids[grantB.organizationId]! };
      },
      query: async (actor, organizationId) =>
        (
          await getAssignment(
            actor,
            organizationId,
            assignmentFor.get(organizationId) ?? randomUUID(),
          )
        ).parties,
      idOf: (row) => row.id,
    });
  });

  it("4.2.4 getAssignment(...).teamCandidates viser aldri ansatte fra en annen organisasjon", async () => {
    const assignmentFor = new Map<string, string>();
    let orgA = "";
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgA = grantA.organizationId;
        orgB = grantB.organizationId;
        const ids: Record<string, string[]> = {};
        for (const grant of [grantA, grantB]) {
          const row = await createAssignment(grant.organizationId);
          assignmentFor.set(grant.organizationId, row.id);
          const { employee } = await person(grant.organizationId, ["inspector"]);
          ids[grant.organizationId] = [employee.id, grant.employeeId];
        }
        return { a: ids[grantA.organizationId]!, b: ids[grantB.organizationId]! };
      },
      query: async (actor, organizationId) =>
        (
          await getAssignment(
            actor,
            organizationId,
            assignmentFor.get(organizationId) ?? randomUUID(),
          )
        ).teamCandidates,
      idOf: (row) => row.id,
    });

    // Ingen ansatt i B (heller ikke admin B) står i listen hos A
    const employeesB = await db
      .select({ id: employees.id })
      .from(employees)
      .where(eq(employees.organizationId, orgB));
    const candidatesA = (
      await getAssignment(await adminActorOf(orgA), orgA, assignmentFor.get(orgA)!)
    ).teamCandidates;
    const idsA = new Set(candidatesA.map((row) => row.id));
    for (const row of employeesB) expect(idsA.has(row.id)).toBe(false);
  });

  it("4.2.5 setTeamMember setter bare teamet på oppdrag i egen organisasjon", async () => {
    const seeded = new Map<string, { assignmentId: string; employeeId: string }>();
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        for (const grant of [grantA, grantB]) {
          const row = await createAssignment(grant.organizationId);
          const { employee } = await person(grant.organizationId, ["inspector"]);
          seeded.set(grant.organizationId, { assignmentId: row.id, employeeId: employee.id });
        }
        return {
          a: [seeded.get(grantA.organizationId)!.employeeId],
          b: [seeded.get(grantB.organizationId)!.employeeId],
        };
      },
      query: async (actor, organizationId) => {
        const target = seeded.get(organizationId) ?? {
          assignmentId: randomUUID(),
          employeeId: randomUUID(),
        };
        await setTeamMember(actor, organizationId, target.assignmentId, {
          teamRole: "responsible",
          employeeId: target.employeeId,
          now: TEST_NOW,
        });
        return activeTeamRows(target.assignmentId);
      },
      idOf: (row) => row.employeeId,
    });

    const b = seeded.get(orgB)!;
    expect(await activeTeamRows(b.assignmentId)).toHaveLength(1);
    expect((await teamRows(b.assignmentId)).every((row) => row.organizationId === orgB)).toBe(true);
    const eventsB = await eventsFor(orgB);
    expect(eventsB).toHaveLength(1);
    for (const row of await auditFor(orgB)) expect(row.organizationId).toBe(orgB);
  });

  it("4.2.6 addParty legger alltid parten i egen organisasjon", async () => {
    const assignmentFor = new Map<string, string>();
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        for (const grant of [grantA, grantB]) {
          assignmentFor.set(
            grant.organizationId,
            (await createAssignment(grant.organizationId)).id,
          );
        }
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor, organizationId) => {
        const row = await addParty(
          actor,
          organizationId,
          assignmentFor.get(organizationId) ?? randomUUID(),
          partyInput(),
        );
        return [await partyRow(row.id)];
      },
      idOf: (row) => row.organizationId,
    });

    const partiesB = await db
      .select()
      .from(assignmentParties)
      .where(eq(assignmentParties.organizationId, orgB));
    expect(partiesB).toHaveLength(1);
    expect(partiesB[0]!.assignmentId).toBe(assignmentFor.get(orgB));
    expect(await rowCount(assignmentParties)).toBe(2);
    for (const row of await eventsFor(orgB)) expect(row.organizationId).toBe(orgB);
  });

  it("4.2.7 updateParty endrer bare parter i egen organisasjon", async () => {
    const partyFor = new Map<string, string>();
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        for (const grant of [grantA, grantB]) {
          partyFor.set(
            grant.organizationId,
            (await createAssignmentParty(grant.organizationId)).id,
          );
        }
        return {
          a: [partyFor.get(grantA.organizationId)!],
          b: [partyFor.get(grantB.organizationId)!],
        };
      },
      query: async (actor, organizationId) => {
        const id = partyFor.get(organizationId) ?? randomUUID();
        await updateParty(actor, organizationId, id, partyInput({ name: "Megler Endret" }));
        return [{ id }];
      },
      idOf: (row) => row.id,
    });

    // Bs part er endret nøyaktig én gang, av B
    const rowB = await partyRow(partyFor.get(orgB)!);
    expect(rowB.name).toBe("Megler Endret");
    expect(rowB.rowVersion).toBe(2);
    expect(await eventsFor(orgB, "assignment.party_updated")).toHaveLength(1);
  });

  it("4.2.8 removeParty fjerner bare parter i egen organisasjon", async () => {
    const partyFor = new Map<string, string>();
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        for (const grant of [grantA, grantB]) {
          partyFor.set(
            grant.organizationId,
            (await createAssignmentParty(grant.organizationId)).id,
          );
        }
        return {
          a: [partyFor.get(grantA.organizationId)!],
          b: [partyFor.get(grantB.organizationId)!],
        };
      },
      query: async (actor, organizationId) => {
        const id = partyFor.get(organizationId) ?? randomUUID();
        await removeParty(actor, organizationId, id);
        return [{ id }];
      },
      idOf: (row) => row.id,
    });

    const rowB = await partyRow(partyFor.get(orgB)!);
    expect(rowB.deletedAt).not.toBeNull();
    expect(rowB.rowVersion).toBe(2);
    expect(await eventsFor(orgB, "assignment.party_removed")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// 4.3 Fremmed id i egen organisasjon (IDOR)
// ---------------------------------------------------------------------------------------------

describe("4.3 fremmed, ukjent og ugyldig id", () => {
  async function twoOrgs() {
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    return { a, b };
  }

  it("4.3.1 Bs oppdrags-id gir AccessDeniedError i getAssignment, setTeamMember og addParty; ingenting lagres", async () => {
    const { a, b } = await twoOrgs();
    const { employee } = await person(a.org.id, ["inspector"]);
    const before = await tableCounts();

    await expect(getAssignment(a.admin, a.org.id, b.assignment.id)).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(
      setTeamMember(a.admin, a.org.id, b.assignment.id, {
        teamRole: "responsible",
        employeeId: employee.id,
        now: TEST_NOW,
      }),
    ).rejects.toThrow(AccessDeniedError);
    await expect(addParty(a.admin, a.org.id, b.assignment.id, partyInput())).rejects.toThrow(
      AccessDeniedError,
    );

    expect(await tableCounts()).toEqual(before);
  });

  it("4.3.2 Bs part-id gir AccessDeniedError i updateParty og removeParty; Bs rad er uendret", async () => {
    const { a, b } = await twoOrgs();
    const partyB = await createAssignmentParty(b.org.id, { assignmentId: b.assignment.id });
    const before = await tableCounts();

    await expect(
      updateParty(a.admin, a.org.id, partyB.id, partyInput({ name: "Megler Endret" })),
    ).rejects.toThrow(AccessDeniedError);
    await expect(removeParty(a.admin, a.org.id, partyB.id)).rejects.toThrow(AccessDeniedError);

    const after = await partyRow(partyB.id);
    expect(after.name).toBe(partyB.name);
    expect(after.deletedAt).toBeNull();
    expect(after.rowVersion).toBe(partyB.rowVersion);
    expect(after.updatedAt.toISOString()).toBe(partyB.updatedAt.toISOString());
    expect(await tableCounts()).toEqual(before);
  });

  it("4.3.3 Bs ansatt-id på eget oppdrag gir EmployeeNotFoundError; ingen teamrad, ingen hendelse, den aktive er urørt", async () => {
    const { a, b } = await twoOrgs();
    const active = await createTeamMember(a.org.id, { assignmentId: a.assignment.id });
    const { employee: foreign } = await person(b.org.id, ["inspector"]);
    const before = await tableCounts();

    await expect(
      setTeamMember(a.admin, a.org.id, a.assignment.id, {
        teamRole: "responsible",
        employeeId: foreign.id,
        now: LATER,
      }),
    ).rejects.toThrow(EmployeeNotFoundError);

    expect(await tableCounts()).toEqual(before);
    const [row] = await activeTeamRows(a.assignment.id, "responsible");
    expect(row?.id).toBe(active.id);
    expect(row?.toAt).toBeNull();
  });

  it("4.3.4 organizationId i input ignoreres: parten lagres i A (eller skjemaet avviser)", async () => {
    const { a, b } = await twoOrgs();
    const input = partyInput({ organizationId: b.org.id });
    const error = await caught(addParty(a.admin, a.org.id, a.assignment.id, input));

    if (error === null) {
      const rows = await db.select().from(assignmentParties);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.organizationId).toBe(a.org.id);
    } else {
      expect(error).toBeInstanceOf(ZodError);
    }
    const inB = await db
      .select()
      .from(assignmentParties)
      .where(eq(assignmentParties.organizationId, b.org.id));
    expect(inB).toHaveLength(0);
    expect(await eventsFor(b.org.id)).toHaveLength(0);
  });

  it.each([
    ["tilfeldig uuid", randomUUID()],
    ["ikke en id", "ikke-en-id"],
  ])("4.3.5 %s som oppdrags-id gir AccessDeniedError, aldri databasefeil", async (_name, id) => {
    const { org, admin } = await orgWithAdmin();
    const { employee } = await person(org.id, ["inspector"]);
    await expect(getAssignment(admin, org.id, id)).rejects.toThrow(AccessDeniedError);
    await expect(
      setTeamMember(admin, org.id, id, {
        teamRole: "responsible",
        employeeId: employee.id,
        now: TEST_NOW,
      }),
    ).rejects.toThrow(AccessDeniedError);
    await expect(addParty(admin, org.id, id, partyInput())).rejects.toThrow(AccessDeniedError);
  });

  it.each([
    ["tilfeldig uuid", randomUUID()],
    ["ikke en id", "ikke-en-id"],
  ])("4.3.5 %s som part-id gir AccessDeniedError, aldri databasefeil", async (_name, id) => {
    const { org, admin } = await orgWithAdmin();
    await expect(updateParty(admin, org.id, id, partyInput())).rejects.toThrow(AccessDeniedError);
    await expect(removeParty(admin, org.id, id)).rejects.toThrow(AccessDeniedError);
  });

  it.each([
    ["tilfeldig uuid", randomUUID()],
    ["ikke en id", "ikke-en-id"],
  ])(
    "4.3.5 %s som ansatt-id gir EmployeeNotFoundError eller AccessDeniedError, aldri databasefeil",
    async (_name, id) => {
      const { org, admin, assignment } = await orgWithAdmin();
      const error = await caught(
        setTeamMember(admin, org.id, assignment.id, {
          teamRole: "responsible",
          employeeId: id,
          now: TEST_NOW,
        }),
      );
      expect(
        error instanceof EmployeeNotFoundError || error instanceof AccessDeniedError,
        `fikk ${String(error)}`,
      ).toBe(true);
      expect(await rowCount(assignmentTeamMembers)).toBe(0);
      expect(await rowCount(events)).toBe(0);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// 4.4 Myk sletting
// ---------------------------------------------------------------------------------------------

describe("4.4 myk sletting", () => {
  it("4.4.1 slettet oppdrag gir AccessDeniedError i alle fem funksjonene", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const fixtures = await writeFixtures(org.id, assignment.id);
    await db
      .update(assignments)
      .set({ deletedAt: new Date("2026-11-03T09:00:00Z") })
      .where(eq(assignments.id, assignment.id));
    const before = await tableCounts();
    const calls = writeCalls(admin, org.id, assignment.id, fixtures);

    await expect(getAssignment(admin, org.id, assignment.id)).rejects.toThrow(AccessDeniedError);
    await expect(calls.setTeamMember()).rejects.toThrow(AccessDeniedError);
    await expect(calls.addParty()).rejects.toThrow(AccessDeniedError);
    await expect(calls.updateParty()).rejects.toThrow(AccessDeniedError);
    await expect(calls.removeParty()).rejects.toThrow(AccessDeniedError);

    expect(await tableCounts()).toEqual(before);
    expect((await partyRow(fixtures.toRemove.id)).deletedAt).toBeNull();
  });

  it("4.4.2 fjernet part finnes med deleted_at, vises ikke, og kan ikke endres eller fjernes igjen", async () => {
    const { org, admin, assignment, adminEmployee } = await orgWithAdmin();
    const party = await createAssignmentParty(org.id, { assignmentId: assignment.id });

    await removeParty(admin, org.id, party.id);

    const row = await partyRow(party.id);
    expect(row.deletedAt).not.toBeNull();
    expect(row.deletedBy).toBeTruthy();
    expect([adminEmployee.id, admin.id]).toContain(row.deletedBy);
    expect((await getAssignment(admin, org.id, assignment.id)).parties).toEqual([]);

    const before = await tableCounts();
    await expect(
      updateParty(admin, org.id, party.id, partyInput({ name: "Megler Endret" })),
    ).rejects.toThrow(AccessDeniedError);
    await expect(removeParty(admin, org.id, party.id)).rejects.toThrow(AccessDeniedError);
    expect(await tableCounts()).toEqual(before);
    expect((await partyRow(party.id)).name).toBe(PARTY_NAME);
  });

  it("4.4.3 fjernet part kan legges inn igjen; den gamle står med deleted_at", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const first = await addParty(admin, org.id, assignment.id, partyInput());
    await removeParty(admin, org.id, first.id);
    const second = await addParty(admin, org.id, assignment.id, partyInput());

    expect(second.id).not.toBe(first.id);
    expect((await partyRow(first.id)).deletedAt).not.toBeNull();
    expect((await partyRow(second.id)).deletedAt).toBeNull();
    const shown = (await getAssignment(admin, org.id, assignment.id)).parties;
    expect(shown.map((row) => row.id)).toEqual([second.id]);
  });

  it("4.4.4 teamrader slettes aldri: sett, bytt, «Ingen» gir tre rader, null aktive, ingen slettet", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const { employee: first } = await person(org.id, ["inspector"]);
    const { employee: second } = await person(org.id, ["inspector"]);

    await setTeamMember(admin, org.id, assignment.id, {
      teamRole: "responsible",
      employeeId: first.id,
      now: TEST_NOW,
    });
    await setTeamMember(admin, org.id, assignment.id, {
      teamRole: "responsible",
      employeeId: second.id,
      now: LATER,
    });
    await setTeamMember(admin, org.id, assignment.id, {
      teamRole: "responsible",
      employeeId: null,
      now: LATEST,
    });

    const rows = await teamRows(assignment.id, "responsible");
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.toAt === null)).toHaveLength(0);
    expect(rows.every((row) => row.deletedAt === null)).toBe(true);
    expect(rows.map((row) => row.employeeId)).toEqual([first.id, second.id]);
    expect(rows.map((row) => row.toAt?.toISOString())).toEqual([
      LATER.toISOString(),
      LATEST.toISOString(),
    ]);
  });

  it("4.4.5 myk-slettet teamrad vises ikke i getAssignment(...).team", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await createTeamMember(org.id, {
      assignmentId: assignment.id,
      deletedAt: new Date("2026-11-03T09:00:00Z"),
    });
    expect((await getAssignment(admin, org.id, assignment.id)).team).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 4.5 getAssignment
// ---------------------------------------------------------------------------------------------

const ASSIGNMENT_KEYS = [
  "id",
  "number",
  "status",
  "officeName",
  "orderId",
  // 6.1: utstedende selskap (docs/agenter/oppgaver/fase2a-utstedende-selskap-testplan.md)
  "companyName",
  "team",
  "parties",
  "teamCandidates",
].sort();
const TEAM_KEYS = ["teamRole", "employeeId", "employeeName", "fromAt"];
const TEAM_OPTIONAL_KEYS = ["id"];
const PARTY_KEYS = [
  "id",
  "role",
  "name",
  "firmName",
  "email",
  "phone",
  "receivesReport",
  "receivesInvoice",
  "receivesMessages",
];
const PARTY_OPTIONAL_KEYS = ["assignmentId"];
const CANDIDATE_KEYS = ["id", "name"].sort();
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

function expectKeys(row: object, required: string[], optional: string[] = []) {
  const keys = Object.keys(row);
  for (const key of required) expect(keys, `mangler ${key}`).toContain(key);
  for (const key of keys) {
    expect([...required, ...optional], `uventet felt ${key}`).toContain(key);
  }
  for (const key of FORBIDDEN_KEYS) expect(keys).not.toContain(key);
}

describe("4.5 getAssignment", () => {
  it("4.5.1 faste feltlister på oppdraget, teamet, partene og kandidatene; ingen sporingsfelt", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await createTeamMember(org.id, { assignmentId: assignment.id });
    await createAssignmentParty(org.id, { assignmentId: assignment.id });

    const result = await getAssignment(admin, org.id, assignment.id);
    expect(Object.keys(result).sort()).toEqual(ASSIGNMENT_KEYS);
    expect(result.team).toHaveLength(1);
    expect(result.parties).toHaveLength(1);
    expect(result.teamCandidates.length).toBeGreaterThan(0);
    for (const row of result.team) expectKeys(row, TEAM_KEYS, TEAM_OPTIONAL_KEYS);
    for (const row of result.parties) expectKeys(row, PARTY_KEYS, PARTY_OPTIONAL_KEYS);
    for (const row of result.teamCandidates) {
      expect(Object.keys(row).sort()).toEqual(CANDIDATE_KEYS);
    }
  });

  it("4.5.2 teamet har bare aktive rader, med employeeName og fromAt", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const { employee: old } = await person(org.id, ["inspector"], "Takstmann Gammel");
    const { employee: current } = await person(org.id, ["inspector"], "Takstmann Ny");
    await createTeamMember(org.id, {
      assignmentId: assignment.id,
      employeeId: old.id,
      fromAt: TEST_NOW,
      toAt: LATER,
      handedOverReason: REASON,
    });
    await createTeamMember(org.id, {
      assignmentId: assignment.id,
      employeeId: current.id,
      fromAt: LATER,
    });

    const { team } = await getAssignment(admin, org.id, assignment.id);
    expect(team).toHaveLength(1);
    expect(team[0]).toMatchObject({
      teamRole: "responsible",
      employeeId: current.id,
      employeeName: "Takstmann Ny",
    });
    expect(new Date(team[0]!.fromAt).toISOString()).toBe(LATER.toISOString());
  });

  it("4.5.3 kandidatene er ansatte som ikke har sluttet og ikke er slettet, sortert på navn", async () => {
    const { org, admin, assignment, adminEmployee } = await orgWithAdmin();
    const { employee: berit } = await person(org.id, ["inspector"], "Berit Testdatter");
    const { employee: anders } = await person(org.id, ["office"], "Anders Testesen");
    const { employee: quit } = await person(org.id, ["inspector"], "Cecilie Sluttet");
    const { employee: gone } = await person(org.id, ["inspector"], "Dag Slettet");
    await db
      .update(employees)
      .set({ deactivatedAt: new Date("2026-11-01T08:00:00Z") })
      .where(eq(employees.id, quit.id));
    await db
      .update(employees)
      .set({ deletedAt: new Date("2026-11-01T08:00:00Z") })
      .where(eq(employees.id, gone.id));

    const { teamCandidates } = await getAssignment(admin, org.id, assignment.id);
    const ids = teamCandidates.map((row) => row.id);
    expect(ids).toEqual(expect.arrayContaining([berit.id, anders.id, adminEmployee.id]));
    expect(ids).not.toContain(quit.id);
    expect(ids).not.toContain(gone.id);
    const names = teamCandidates.map((row) => row.name);
    expect(names).toEqual([...names].sort((x, y) => x.localeCompare(y, "nb")));
    expect(names.indexOf("Anders Testesen")).toBeLessThan(names.indexOf("Berit Testdatter"));
  });

  it("4.5.4 tomt oppdrag har tomt team og ingen parter", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const result = await getAssignment(admin, org.id, assignment.id);
    expect(result.team).toEqual([]);
    expect(result.parties).toEqual([]);
  });

  it("4.5.5 orderId og officeName er med (lenken «Ordren» og toppen på siden)", async () => {
    const { org, admin, office } = await orgWithAdmin();
    const order = await createOrder(org.id);
    const assignment = await createAssignment(org.id, { officeId: office.id, orderId: order.id });

    const result = await getAssignment(admin, org.id, assignment.id);
    expect(result).toMatchObject({
      id: assignment.id,
      number: assignment.number,
      status: "ordered",
      officeName: "Testkontor Bodø",
      orderId: order.id,
    });
  });

  it("4.5.5 oppdrag uten ordre har orderId = null", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    expect((await getAssignment(admin, org.id, assignment.id)).orderId).toBeNull();
  });

  it("4.5.6 ingen N+1: fem teamrader og fem parter gir like mange spørringer som én av hver", async () => {
    const { org, admin, assignment: small } = await orgWithAdmin();
    const big = await createAssignment(org.id);
    await createTeamMember(org.id, { assignmentId: small.id });
    await createAssignmentParty(org.id, { assignmentId: small.id });
    for (const teamRole of [
      "responsible",
      "co_responsible",
      "inspector",
      "peer_reviewer",
      "office",
    ]) {
      await createTeamMember(org.id, { assignmentId: big.id, teamRole });
    }
    for (const role of [
      "broker",
      "seller",
      "buyer",
      "seller_representative",
      "invoice_recipient",
    ]) {
      await createAssignmentParty(org.id, { assignmentId: big.id, role });
    }

    // Drizzle sender hver spørring gjennom `unsafe` på postgres-klienten
    const client = (db as unknown as { $client: { unsafe: (...args: unknown[]) => unknown } })
      .$client;
    const spy = vi.spyOn(client, "unsafe");
    try {
      spy.mockClear();
      await getAssignment(admin, org.id, small.id);
      const smallCount = spy.mock.calls.length;
      spy.mockClear();
      const result = await getAssignment(admin, org.id, big.id);
      const bigCount = spy.mock.calls.length;

      expect(result.team).toHaveLength(5);
      expect(result.parties).toHaveLength(5);
      expect(smallCount, "spørringene ble talt").toBeGreaterThan(0);
      expect(bigCount).toBe(smallCount);
    } finally {
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 4.6 Team (setTeamMember)
// ---------------------------------------------------------------------------------------------

describe("4.6 team", () => {
  it("4.6.1 sette ansvarlig på tomt oppdrag gir én aktiv rad fra now og én hendelse", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const { employee } = await person(org.id, ["inspector"]);

    await setTeamMember(admin, org.id, assignment.id, {
      teamRole: "responsible",
      employeeId: employee.id,
      now: TEST_NOW,
    });

    const rows = await teamRows(assignment.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: org.id,
      teamRole: "responsible",
      employeeId: employee.id,
      toAt: null,
      handedOverReason: null,
    });
    expect(rows[0]!.fromAt.toISOString()).toBe(TEST_NOW.toISOString());
    expect(await eventsFor(org.id, "assignment.team_changed")).toHaveLength(1);
  });

  it("4.6.2 bytte med grunn: den gamle får to_at = LATER og grunnen, den nye er aktiv fra LATER", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const { employee: first } = await person(org.id, ["inspector"]);
    const { employee: second } = await person(org.id, ["inspector"]);

    await setTeamMember(admin, org.id, assignment.id, {
      teamRole: "responsible",
      employeeId: first.id,
      now: TEST_NOW,
    });
    await setTeamMember(admin, org.id, assignment.id, {
      teamRole: "responsible",
      employeeId: second.id,
      reason: REASON,
      now: LATER,
    });

    const [old, current] = await teamRows(assignment.id, "responsible");
    expect(old).toMatchObject({ employeeId: first.id, handedOverReason: REASON });
    expect(old!.toAt?.toISOString()).toBe(LATER.toISOString());
    expect(current).toMatchObject({ employeeId: second.id, toAt: null });
    expect(current!.fromAt.toISOString()).toBe(LATER.toISOString());
  });

  it("4.6.3 samme ansatt igjen gir ingen ny rad, ingen hendelse og ingen loggrad", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const { employee } = await person(org.id, ["inspector"]);
    await setTeamMember(admin, org.id, assignment.id, {
      teamRole: "responsible",
      employeeId: employee.id,
      now: TEST_NOW,
    });
    const before = await tableCounts();

    await setTeamMember(admin, org.id, assignment.id, {
      teamRole: "responsible",
      employeeId: employee.id,
      reason: REASON,
      now: LATER,
    });

    expect(await tableCounts()).toEqual(before);
    const [row] = await teamRows(assignment.id);
    expect(row?.toAt).toBeNull();
    expect(row?.handedOverReason).toBeNull();
  });

  it("4.6.4 «Ingen» når noen er satt: raden avsluttes, null aktive, én hendelse med toEmployeeId = null", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const member = await createTeamMember(org.id, { assignmentId: assignment.id });

    await setTeamMember(admin, org.id, assignment.id, {
      teamRole: "responsible",
      employeeId: null,
      now: LATER,
    });

    expect(await activeTeamRows(assignment.id)).toHaveLength(0);
    const [row] = await teamRows(assignment.id);
    expect(row?.toAt?.toISOString()).toBe(LATER.toISOString());
    const changed = await eventsFor(org.id, "assignment.team_changed");
    expect(changed).toHaveLength(1);
    expect(changed[0]!.data).toEqual({
      teamRole: "responsible",
      fromEmployeeId: member.employeeId,
      toEmployeeId: null,
    });
  });

  it("4.6.5 «Ingen» når ingen er satt: ingenting skjer, ingen hendelse", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const before = await tableCounts();
    await setTeamMember(admin, org.id, assignment.id, {
      teamRole: "responsible",
      employeeId: null,
      now: TEST_NOW,
    });
    expect(await tableCounts()).toEqual(before);
  });

  it.each(["responsible", "co_responsible", "inspector", "peer_reviewer", "office"] as const)(
    "4.6.6 rollen %s kan settes",
    async (teamRole) => {
      const { org, admin, assignment } = await orgWithAdmin();
      const { employee } = await person(org.id, ["inspector"]);
      await setTeamMember(admin, org.id, assignment.id, {
        teamRole,
        employeeId: employee.id,
        now: TEST_NOW,
      });
      const { team } = await getAssignment(admin, org.id, assignment.id);
      expect(team.map((row) => [row.teamRole, row.employeeId])).toEqual([[teamRole, employee.id]]);
    },
  );

  it("4.6.6 én ansatt i to roller gir to aktive rader", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const { employee } = await person(org.id, ["inspector"]);
    for (const teamRole of ["responsible", "inspector"] as const) {
      await setTeamMember(admin, org.id, assignment.id, {
        teamRole,
        employeeId: employee.id,
        now: TEST_NOW,
      });
    }
    const active = await activeTeamRows(assignment.id);
    expect(active.map((row) => row.teamRole).sort()).toEqual(["inspector", "responsible"]);
  });

  it("4.6.6 ukjent rolle avvises uten endring", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const { employee } = await person(org.id, ["inspector"]);
    const before = await tableCounts();
    await expect(
      setTeamMember(admin, org.id, assignment.id, {
        teamRole: "owner" as never,
        employeeId: employee.id,
        now: TEST_NOW,
      }),
    ).rejects.toThrow();
    expect(await tableCounts()).toEqual(before);
  });

  it.each([
    ["har sluttet", { deactivatedAt: new Date("2026-11-01T08:00:00Z") }],
    ["er slettet", { deletedAt: new Date("2026-11-01T08:00:00Z") }],
  ] as const)(
    "4.6.7 ansatt som %s gir EmployeeNotFoundError, ingen rad, ingen hendelse",
    async (_name, set) => {
      const { org, admin, assignment } = await orgWithAdmin();
      const { employee } = await person(org.id, ["inspector"]);
      await db.update(employees).set(set).where(eq(employees.id, employee.id));
      const before = await tableCounts();

      const error = await caught(
        setTeamMember(admin, org.id, assignment.id, {
          teamRole: "responsible",
          employeeId: employee.id,
          now: TEST_NOW,
        }),
      );
      expect(error).toBeInstanceOf(EmployeeNotFoundError);
      expect((error as Error).message).toBe("Den ansatte finnes ikke.");
      expect(await tableCounts()).toEqual(before);
    },
  );

  it("4.6.8 grunn med 11 sifre gir «Fødselsnummer skal ikke lagres her.», ingen endring", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const member = await createTeamMember(org.id, { assignmentId: assignment.id });
    const { employee } = await person(org.id, ["inspector"]);
    const before = await tableCounts();

    const error = await caught(
      setTeamMember(admin, org.id, assignment.id, {
        teamRole: "responsible",
        employeeId: employee.id,
        reason: "Ferie 12345678901",
        now: LATER,
      }),
    );
    expect(error).toBeInstanceOf(ZodError);
    expect((error as ZodError).issues.map((issue) => issue.message)).toContain(
      "Fødselsnummer skal ikke lagres her.",
    );
    expect(await tableCounts()).toEqual(before);
    const [row] = await activeTeamRows(assignment.id);
    expect(row?.id).toBe(member.id);
  });

  it("4.6.9 samtidige bytter på samme rolle lykkes begge: én aktiv, én avsluttet, to hendelser", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const { employee: first } = await person(org.id, ["inspector"]);
    const { employee: second } = await person(org.id, ["inspector"]);

    // Ingen `now`: kjernen bruker klokken, slik skjermen gjør
    const results = await Promise.allSettled([
      setTeamMember(admin, org.id, assignment.id, {
        teamRole: "responsible",
        employeeId: first.id,
      }),
      setTeamMember(admin, org.id, assignment.id, {
        teamRole: "responsible",
        employeeId: second.id,
      }),
    ]);

    expect(
      results
        .filter((r) => r.status === "rejected")
        .map((r) => String((r as PromiseRejectedResult).reason)),
    ).toEqual([]);
    const rows = await teamRows(assignment.id, "responsible");
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.toAt === null)).toHaveLength(1);
    expect(rows.filter((row) => row.toAt !== null)).toHaveLength(1);
    expect(rows.map((row) => row.employeeId).sort()).toEqual([first.id, second.id].sort());
    expect(await eventsFor(org.id, "assignment.team_changed")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------------
// 4.7 Parter
// ---------------------------------------------------------------------------------------------

describe("4.7 parter", () => {
  it("4.7.1 addParty lagrer alle feltene i organisasjonen fra tilgangssjekken, createdBy = den ansatte", async () => {
    const { org, admin, adminEmployee, assignment } = await orgWithAdmin();
    const created = await addParty(admin, org.id, assignment.id, partyInput());

    const row = await partyRow(created.id);
    expect(row).toMatchObject({
      organizationId: org.id,
      assignmentId: assignment.id,
      role: "broker",
      name: PARTY_NAME,
      firmName: FIRM,
      email: EMAIL,
      phone: PHONE,
      receivesReport: true,
      receivesInvoice: false,
      receivesMessages: true,
      deletedAt: null,
    });
    expect(row.createdBy).toBe(adminEmployee.id);
  });

  it("4.7.2 minimal part: firma, e-post og telefon blir null; mottar som sendt", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const created = await addParty(admin, org.id, assignment.id, {
      role: "buyer",
      name: "Kjøper Test",
    } as PartyInput);
    expect(await partyRow(created.id)).toMatchObject({
      role: "buyer",
      name: "Kjøper Test",
      firmName: null,
      email: null,
      phone: null,
      receivesReport: false,
      receivesInvoice: false,
      receivesMessages: false,
    });
  });

  it("4.7.3 mottar lagres som sendt, ikke etter rollen (forhåndsutfylling er bare i skjermen)", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const created = await addParty(
      admin,
      org.id,
      assignment.id,
      partyInput({ receivesReport: false, receivesInvoice: true, receivesMessages: false }),
    );
    expect(await partyRow(created.id)).toMatchObject({
      role: "broker",
      receivesReport: false,
      receivesInvoice: true,
      receivesMessages: false,
    });
  });

  it("4.7.4 samme person i to roller gir to rader", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await addParty(admin, org.id, assignment.id, partyInput({ role: "seller" }));
    await addParty(admin, org.id, assignment.id, partyInput({ role: "invoice_recipient" }));
    const { parties } = await getAssignment(admin, org.id, assignment.id);
    expect(parties.map((row) => row.role).sort()).toEqual(["invoice_recipient", "seller"]);
    expect(new Set(parties.map((row) => row.name))).toEqual(new Set([PARTY_NAME]));
  });

  it("4.7.5 updateParty endrer rolle og mottar; updatedAt endres", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const party = await createAssignmentParty(org.id, { assignmentId: assignment.id });

    await updateParty(
      admin,
      org.id,
      party.id,
      partyInput({ role: "invoice_recipient", receivesReport: false, receivesInvoice: true }),
    );

    const row = await partyRow(party.id);
    expect(row).toMatchObject({
      role: "invoice_recipient",
      receivesReport: false,
      receivesInvoice: true,
      assignmentId: assignment.id,
      organizationId: org.id,
    });
    expect(row.updatedAt.getTime()).toBeGreaterThan(party.updatedAt.getTime());
    expect(row.rowVersion).toBe(party.rowVersion + 1);
  });

  it.each([
    ["tomt navn", { name: " " }],
    ["ugyldig e-post", { email: "ikke-epost" }],
    ["bokstaver i telefon", { phone: "abc" }],
    ["ukjent rolle", { role: "client" }],
    ["fødselsnummer i navn", { name: "12345678901" }],
  ])(
    "4.7.6 %s gir ZodError i addParty og updateParty; ingen rad, ingen hendelse",
    async (_n, bad) => {
      const { org, admin, assignment } = await orgWithAdmin();
      const party = await createAssignmentParty(org.id, { assignmentId: assignment.id });
      const before = await tableCounts();

      await expect(addParty(admin, org.id, assignment.id, partyInput(bad))).rejects.toThrow(
        ZodError,
      );
      await expect(updateParty(admin, org.id, party.id, partyInput(bad))).rejects.toThrow(ZodError);

      expect(await tableCounts()).toEqual(before);
      expect((await partyRow(party.id)).rowVersion).toBe(party.rowVersion);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// 4.8 Hendelser og revisjonslogg
// ---------------------------------------------------------------------------------------------

describe("4.8 hendelser og revisjonslogg", () => {
  it("4.8.1 setTeamMember: assignment.team_changed med data, og revisjonslogg create/end ved bytte", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const { employee: first } = await person(org.id, ["inspector"]);
    const { employee: second } = await person(org.id, ["inspector"]);

    await setTeamMember(admin, org.id, assignment.id, {
      teamRole: "responsible",
      employeeId: first.id,
      now: TEST_NOW,
    });
    await setTeamMember(admin, org.id, assignment.id, {
      teamRole: "responsible",
      employeeId: second.id,
      reason: REASON,
      now: LATER,
    });

    const changed = (await eventsFor(org.id, "assignment.team_changed")).sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id),
    );
    expect(changed).toHaveLength(2);
    for (const row of changed) expect(row.assignmentId).toBe(assignment.id);
    expect(changed.map((row) => row.data)).toEqual(
      expect.arrayContaining([
        { teamRole: "responsible", fromEmployeeId: null, toEmployeeId: first.id },
        { teamRole: "responsible", fromEmployeeId: first.id, toEmployeeId: second.id },
      ]),
    );

    const [old, current] = await teamRows(assignment.id, "responsible");
    const audit = await auditFor(org.id, "assignment_team_member");
    expect(audit.map((row) => `${row.action}:${row.entityId}`).sort()).toEqual(
      [`create:${old!.id}`, `create:${current!.id}`, `end:${old!.id}`].sort(),
    );
  });

  it("4.8.2 parter: party_added, party_updated, party_removed med { partyId, role }, og revisjonslogg create/update/delete", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const created = await addParty(admin, org.id, assignment.id, partyInput());
    await updateParty(admin, org.id, created.id, partyInput({ phone: "+47 000 00 000" }));
    await removeParty(admin, org.id, created.id);

    for (const type of [
      "assignment.party_added",
      "assignment.party_updated",
      "assignment.party_removed",
    ]) {
      const rows = await eventsFor(org.id, type);
      expect(rows, type).toHaveLength(1);
      expect(rows[0]!.data, type).toEqual({ partyId: created.id, role: "broker" });
    }

    const audit = await auditFor(org.id, "assignment_party");
    expect(audit.map((row) => row.action).sort()).toEqual(["create", "delete", "update"]);
    for (const row of audit) expect(row.entityId).toBe(created.id);
    // Ved endring står navnet på feltet, ikke verdien
    const update = audit.find((row) => row.action === "update")!;
    const text = JSON.stringify(update.changes);
    expect(text).toContain("phone");
    expect(text).not.toContain("+47 000 00 000");
    expect(text).not.toContain(PHONE);
  });

  it("4.8.3 ingen personopplysninger i events.data eller audit_log.changes fra noen av de fem funksjonene", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const { employee: first } = await person(org.id, ["inspector"]);
    const { employee: second } = await person(org.id, ["inspector"]);

    await getAssignment(admin, org.id, assignment.id);
    await setTeamMember(admin, org.id, assignment.id, {
      teamRole: "responsible",
      employeeId: first.id,
      now: TEST_NOW,
    });
    await setTeamMember(admin, org.id, assignment.id, {
      teamRole: "responsible",
      employeeId: second.id,
      reason: REASON,
      now: LATER,
    });
    const created = await addParty(admin, org.id, assignment.id, partyInput());
    await updateParty(
      admin,
      org.id,
      created.id,
      partyInput({ name: `${PARTY_NAME} Endret`, firmName: `${FIRM} Nord` }),
    );
    await removeParty(admin, org.id, created.id);

    const allEvents = await eventsFor(org.id);
    const allAudit = await auditFor(org.id);
    expect(allEvents.length).toBeGreaterThanOrEqual(5);
    expect(allAudit.length).toBeGreaterThanOrEqual(6);
    const text = JSON.stringify([
      allEvents.map((row) => row.data),
      allAudit.map((row) => row.changes),
    ]);
    for (const value of PERSONAL_VALUES) expect(text, value).not.toContain(value);
    expect(text).not.toContain("Testmegling");
  });

  it("4.8.4 ingen hendelse ved avvist tilgang, valideringsfeil, EmployeeNotFoundError eller samme ansatt igjen", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);
    const member = await createTeamMember(org.id, { assignmentId: assignment.id });
    const { actor: inspector } = await person(org.id, ["inspector"]);
    const { employee: quit } = await person(org.id, ["inspector"]);
    await db
      .update(employees)
      .set({ deactivatedAt: new Date("2026-11-01T08:00:00Z") })
      .where(eq(employees.id, quit.id));

    await caught(addParty(inspector, org.id, assignment.id, partyInput()));
    await caught(addParty(admin, org.id, assignment.id, partyInput({ name: "" })));
    await caught(
      setTeamMember(admin, org.id, assignment.id, {
        teamRole: "responsible",
        employeeId: quit.id,
        now: LATER,
      }),
    );
    await setTeamMember(admin, org.id, assignment.id, {
      teamRole: "responsible",
      employeeId: member.employeeId,
      now: LATER,
    });

    expect(await rowCount(events)).toBe(0);
    expect(await rowCount(auditLog)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Utstedende selskap fra ansvarlig takstmann
// Testplan: docs/agenter/oppgaver/fase2a-utstedende-selskap-testplan.md avsnitt 2–6.
// Støtter hovedmål: reklamasjoner (rapporten kommer fra riktig selskap, og hvert bytte har spor).
// Alle navn er oppdiktet.
// ---------------------------------------------------------------------------------------------

const COMPANY_A1 = "Selskap A1 AS";
const COMPANY_A2 = "Selskap A2 AS";
const COMPANY_B = "Selskap B AS";
const PEOPLE = {
  respA1: "Rita Ansvarligsen",
  respA1b: "Rolf Ansvarligsen",
  respA2: "Randi Nordselskap",
  noCompany: "Nils Utenselskap",
  sidemann: "Siri Sidemannsen",
} as const;
type PersonKey = keyof typeof PEOPLE;
type CompanyKey = "a1" | "a2";
type TeamRoleCode = "responsible" | "co_responsible" | "inspector" | "peer_reviewer" | "office";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** En ansatt med rollene, eventuelt i et selskap. */
async function personInCompany(
  organizationId: string,
  roles: EmployeeRole[],
  name: string,
  companyId?: string,
) {
  const actor = await createUser({ name });
  const employee = await createEmployee(
    actor,
    organizationId,
    roles,
    companyId ? { companyId } : {},
  );
  return { actor, employee };
}

/** Organisasjon A med to selskaper og de fem ansatte fra testplanen. */
async function companySetup() {
  const base = await orgWithAdmin("Organisasjon A");
  const orgId = base.org.id;
  const a1 = await createCompany(orgId, { legalName: COMPANY_A1 });
  const a2 = await createCompany(orgId, { legalName: COMPANY_A2 });
  const people = {
    respA1: (await personInCompany(orgId, ["inspector"], PEOPLE.respA1, a1.id)).employee,
    respA1b: (await personInCompany(orgId, ["inspector"], PEOPLE.respA1b, a1.id)).employee,
    respA2: (await personInCompany(orgId, ["inspector"], PEOPLE.respA2, a2.id)).employee,
    noCompany: (await personInCompany(orgId, ["inspector"], PEOPLE.noCompany)).employee,
    sidemann: (await personInCompany(orgId, ["inspector"], PEOPLE.sidemann, a2.id)).employee,
  };
  const companyIds: Record<CompanyKey, string> = { a1: a1.id, a2: a2.id };
  return { ...base, a1, a2, people, companyIds };
}

type CompanySetup = Awaited<ReturnType<typeof companySetup>>;

async function companyIdOf(assignmentId: string) {
  const [row] = await db
    .select({ companyId: assignments.companyId })
    .from(assignments)
    .where(eq(assignments.id, assignmentId));
  if (!row) throw new Error("fant ikke oppdraget");
  return row.companyId;
}

function companyEvents(organizationId: string) {
  return eventsFor(organizationId, "assignment.company_changed");
}

function companyAudit(organizationId: string) {
  return auditFor(organizationId, "assignment");
}

/** Setter (eller fjerner) personen i rollen som admin. */
function setRole(s: CompanySetup, teamRole: TeamRoleCode, who: PersonKey | null, now: Date) {
  return setTeamMember(s.admin, s.org.id, s.assignment.id, {
    teamRole,
    employeeId: who === null ? null : s.people[who].id,
    now,
  });
}

type RuleCase = {
  id: string;
  name: string;
  /** Ansvarlig før handlingen (settes med setTeamMember). */
  before: PersonKey | null;
  /** Handlingen, ett eller flere kall. */
  steps: { teamRole: TeamRoleCode; who: PersonKey | null }[];
  expected: CompanyKey | null;
  /** Forventet `company_changed` (fra, til), eller null når ingen hendelse skal komme. */
  change: [CompanyKey | null, CompanyKey | null] | null;
  /** Antall nye `team_changed` (bare der testplanen sier noe). */
  teamChanged?: number;
};

const RULE_CASES: RuleCase[] = [
  {
    id: "2.1",
    name: "ingen ansvarlig, sett respA1",
    before: null,
    steps: [{ teamRole: "responsible", who: "respA1" }],
    expected: "a1",
    change: [null, "a1"],
  },
  {
    id: "2.2",
    name: "respA1, bytt til respA2",
    before: "respA1",
    steps: [{ teamRole: "responsible", who: "respA2" }],
    expected: "a2",
    change: ["a1", "a2"],
  },
  {
    id: "2.3",
    name: "respA1, bytt til respA1b i samme selskap",
    before: "respA1",
    steps: [{ teamRole: "responsible", who: "respA1b" }],
    expected: "a1",
    change: null,
    teamChanged: 1,
  },
  {
    id: "2.4",
    name: "respA1, «Ingen» (A66)",
    before: "respA1",
    steps: [{ teamRole: "responsible", who: null }],
    expected: null,
    change: ["a1", null],
  },
  {
    id: "2.5",
    name: "respA1, bytt til ansatt uten selskap (A66)",
    before: "respA1",
    steps: [{ teamRole: "responsible", who: "noCompany" }],
    expected: null,
    change: ["a1", null],
  },
  {
    id: "2.6",
    name: "ansvarlig uten selskap, bytt til respA2",
    before: "noCompany",
    steps: [{ teamRole: "responsible", who: "respA2" }],
    expected: "a2",
    change: [null, "a2"],
  },
  {
    id: "2.7",
    name: "ingen ansvarlig, sett ansatt uten selskap",
    before: null,
    steps: [{ teamRole: "responsible", who: "noCompany" }],
    expected: null,
    change: null,
    teamChanged: 1,
  },
  {
    id: "2.8",
    name: "respA1, samme ansatt igjen",
    before: "respA1",
    steps: [{ teamRole: "responsible", who: "respA1" }],
    expected: "a1",
    change: null,
    teamChanged: 0,
  },
  {
    id: "2.9",
    name: "respA1, sidemann i A2 settes i de fire andre rollene",
    before: "respA1",
    steps: [
      { teamRole: "peer_reviewer", who: "sidemann" },
      { teamRole: "co_responsible", who: "sidemann" },
      { teamRole: "inspector", who: "sidemann" },
      { teamRole: "office", who: "sidemann" },
    ],
    expected: "a1",
    change: null,
  },
  {
    id: "2.10",
    name: "respA1, sidemann settes og fjernes",
    before: "respA1",
    steps: [
      { teamRole: "peer_reviewer", who: "sidemann" },
      { teamRole: "peer_reviewer", who: null },
    ],
    expected: "a1",
    change: null,
  },
];

/** Kjører en regelsak og gir oppsettet og tellingene fra før handlingen. */
async function runRuleCase(c: RuleCase) {
  const s = await companySetup();
  if (c.before !== null) await setRole(s, "responsible", c.before, TEST_NOW);
  const companyBefore = await companyIdOf(s.assignment.id);
  const eventsBefore = (await companyEvents(s.org.id)).length;
  const auditBefore = (await companyAudit(s.org.id)).length;
  const teamChangedBefore = (await eventsFor(s.org.id, "assignment.team_changed")).length;

  for (const [index, step] of c.steps.entries()) {
    await setRole(s, step.teamRole, step.who, new Date(LATER.getTime() + index * 60 * 1000));
    // Skal selskapet stå fast, gjør det det etter hvert kall
    if (c.change === null) {
      expect(await companyIdOf(s.assignment.id), `etter steg ${index + 1}`).toBe(companyBefore);
    }
  }
  const idOf = (key: CompanyKey | null) => (key === null ? null : s.companyIds[key]);
  return { s, idOf, eventsBefore, auditBefore, teamChangedBefore };
}

describe("4.9 utstedende selskap", () => {
  it.each(RULE_CASES)("$id $name", async (c) => {
    const { s, idOf, eventsBefore, auditBefore, teamChangedBefore } = await runRuleCase(c);

    expect(await companyIdOf(s.assignment.id)).toBe(idOf(c.expected));

    const changed = await companyEvents(s.org.id);
    const audit = await companyAudit(s.org.id);
    if (c.change === null) {
      expect(changed).toHaveLength(eventsBefore);
      expect(audit).toHaveLength(auditBefore);
    } else {
      expect(changed).toHaveLength(eventsBefore + 1);
      expect(audit).toHaveLength(auditBefore + 1);
      const from = idOf(c.change[0]);
      const to = idOf(c.change[1]);
      expect(changed.map((row) => row.data)).toContainEqual({
        fromCompanyId: from,
        toCompanyId: to,
      });
      expect(audit.map((row) => row.changes)).toContainEqual({ companyId: { from, to } });
    }
    if (c.teamChanged !== undefined) {
      const after = (await eventsFor(s.org.id, "assignment.team_changed")).length;
      expect(after - teamChangedBefore).toBe(c.teamChanged);
    }
  });

  it("2.11 selskapet leses fra den ansattes rad nå, ikke fra skjemaet", async () => {
    const s = await companySetup();
    const orgB = await createOrganization("Organisasjon B");
    const companyB = await createCompany(orgB.id, { legalName: COMPANY_B });

    for (const [index, foreignCompanyId] of [companyB.id, s.a2.id].entries()) {
      const error = await caught(
        setTeamMember(s.admin, s.org.id, s.assignment.id, {
          teamRole: "responsible",
          employeeId: index === 0 ? s.people.respA1.id : s.people.respA1b.id,
          companyId: foreignCompanyId,
          now: new Date(TEST_NOW.getTime() + index * 60 * 1000),
        } as Parameters<typeof setTeamMember>[3]),
      );
      // Feltet ignoreres (eller avvises av skjemaet); selskapet tas aldri fra input
      if (error !== null) expect(error).toBeInstanceOf(ZodError);
      expect(await companyIdOf(s.assignment.id)).not.toBe(foreignCompanyId);
    }
    expect(await companyIdOf(s.assignment.id)).toBe(s.a1.id);
    const data = JSON.stringify((await companyEvents(s.org.id)).map((row) => row.data));
    expect(data).not.toContain(companyB.id);
    expect(data).not.toContain(s.a2.id);
  });

  it("2.12 admin endrer den ansattes selskap senere: oppdraget beholder det gamle (A67)", async () => {
    const s = await companySetup();
    await setRole(s, "responsible", "respA1", TEST_NOW);
    expect(await companyIdOf(s.assignment.id)).toBe(s.a1.id);

    await db
      .update(employees)
      .set({ companyId: s.a2.id })
      .where(eq(employees.id, s.people.respA1.id));

    expect(await companyIdOf(s.assignment.id)).toBe(s.a1.id);
    expect(await companyEvents(s.org.id)).toHaveLength(1);
    expect(await companyAudit(s.org.id)).toHaveLength(1);

    // Bytt bort og tilbake: nå gjelder selskapet slik det står på den ansatte i dag
    await setRole(s, "responsible", null, LATER);
    await setRole(s, "responsible", "respA1", LATEST);
    expect(await companyIdOf(s.assignment.id)).toBe(s.a2.id);
    expect((await companyEvents(s.org.id)).map((row) => row.data)).toContainEqual({
      fromCompanyId: null,
      toCompanyId: s.a2.id,
    });
  });

  it("2.13 samtidige bytter av ansvarlig: selskapet følger den som er aktiv til slutt", async () => {
    const s = await companySetup();

    // Ingen `now`: kjernen bruker klokken, slik skjermen gjør
    const results = await Promise.allSettled([
      setTeamMember(s.admin, s.org.id, s.assignment.id, {
        teamRole: "responsible",
        employeeId: s.people.respA1.id,
      }),
      setTeamMember(s.admin, s.org.id, s.assignment.id, {
        teamRole: "responsible",
        employeeId: s.people.respA2.id,
      }),
    ]);
    expect(
      results
        .filter((r) => r.status === "rejected")
        .map((r) => String((r as PromiseRejectedResult).reason)),
    ).toEqual([]);

    const [active] = await activeTeamRows(s.assignment.id, "responsible");
    const expected = active!.employeeId === s.people.respA1.id ? s.a1.id : s.a2.id;
    expect(await companyIdOf(s.assignment.id)).toBe(expected);

    // To faktiske endringer: tom → den første, den første → den siste
    const data = (await companyEvents(s.org.id)).map(
      (row) => row.data as { fromCompanyId: string | null; toCompanyId: string | null },
    );
    expect(data).toHaveLength(2);
    const first = data.find((row) => row.fromCompanyId === null);
    const second = data.find((row) => row.fromCompanyId !== null);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second!.fromCompanyId).toBe(first!.toCompanyId);
    expect(second!.toCompanyId).toBe(expected);
    expect(await companyAudit(s.org.id)).toHaveLength(2);
  });

  it("2.14 Bs ansatt-id gir EmployeeNotFoundError og selskapet er urørt", async () => {
    const s = await companySetup();
    await setRole(s, "responsible", "respA1", TEST_NOW);
    const orgB = await createOrganization("Organisasjon B");
    const companyB = await createCompany(orgB.id, { legalName: COMPANY_B });
    const { employee: foreign } = await personInCompany(
      orgB.id,
      ["inspector"],
      "Bjørn Fremmedsen",
      companyB.id,
    );
    const before = await tableCounts();

    await expect(
      setTeamMember(s.admin, s.org.id, s.assignment.id, {
        teamRole: "responsible",
        employeeId: foreign.id,
        now: LATER,
      }),
    ).rejects.toThrow(EmployeeNotFoundError);

    expect(await companyIdOf(s.assignment.id)).toBe(s.a1.id);
    expect(await tableCounts()).toEqual(before);
    expect(await companyEvents(s.org.id)).toHaveLength(1);
  });

  it("2.15 avvist tilgang og valideringsfeil endrer ikke selskapet", async () => {
    const s = await companySetup();
    await setRole(s, "responsible", "respA1", TEST_NOW);
    await setInspectorsEditAll(s.org.id, false);
    const { actor: inspector } = await person(s.org.id, ["inspector"], "Tore Takstmann");
    const before = await tableCounts();

    await expect(
      setTeamMember(inspector, s.org.id, s.assignment.id, {
        teamRole: "responsible",
        employeeId: s.people.respA2.id,
        now: LATER,
      }),
    ).rejects.toThrow(AccessDeniedError);
    await expect(
      setTeamMember(s.admin, s.org.id, s.assignment.id, {
        teamRole: "owner" as never,
        employeeId: s.people.respA2.id,
        now: LATER,
      }),
    ).rejects.toThrow();
    await expect(
      setTeamMember(s.admin, s.org.id, s.assignment.id, {
        teamRole: "responsible",
        employeeId: s.people.respA2.id,
        reason: "Ferie 12345678901",
        now: LATER,
      }),
    ).rejects.toThrow(ZodError);

    expect(await companyIdOf(s.assignment.id)).toBe(s.a1.id);
    expect(await tableCounts()).toEqual(before);
  });

  it("2.16 den ansvarliges selskap er mykt slettet: selskapet settes likevel, og navnet vises (A68)", async () => {
    const s = await companySetup();
    const removed = await createCompany(s.org.id, {
      legalName: "Selskap A3 AS",
      deletedAt: new Date("2026-11-01T08:00:00Z"),
    });
    const { employee } = await personInCompany(
      s.org.id,
      ["inspector"],
      "Rune Nedlagtsen",
      removed.id,
    );

    await setTeamMember(s.admin, s.org.id, s.assignment.id, {
      teamRole: "responsible",
      employeeId: employee.id,
      now: TEST_NOW,
    });

    expect(await companyIdOf(s.assignment.id)).toBe(removed.id);
    expect((await getAssignment(s.admin, s.org.id, s.assignment.id)).companyName).toBe(
      "Selskap A3 AS",
    );
    expect((await companyEvents(s.org.id)).map((row) => row.data)).toEqual([
      { fromCompanyId: null, toCompanyId: removed.id },
    ]);
  });
});

describe("4.8 hendelser og revisjonslogg: utstedende selskap", () => {
  it("3.1 assignment.company_changed har { fromCompanyId, toCompanyId } og bare id-er", async () => {
    const s = await companySetup();
    await setRole(s, "responsible", "respA1", TEST_NOW);
    await setRole(s, "responsible", "respA2", LATER);

    const all = await companyEvents(s.org.id);
    const swaps = all.filter(
      (row) => (row.data as { fromCompanyId?: unknown }).fromCompanyId === s.a1.id,
    );
    expect(swaps).toHaveLength(1);
    const [swap] = swaps;
    expect(swap!.assignmentId).toBe(s.assignment.id);
    expect(Object.keys(swap!.data).sort()).toEqual(["fromCompanyId", "toCompanyId"]);
    expect(swap!.data).toEqual({ fromCompanyId: s.a1.id, toCompanyId: s.a2.id });
    for (const row of all) {
      for (const value of Object.values(row.data)) {
        expect(value === null || (typeof value === "string" && UUID.test(value))).toBe(true);
      }
    }
    const text = JSON.stringify(all.map((row) => row.data));
    expect(text).not.toContain(COMPANY_A1);
    expect(text).not.toContain(COMPANY_A2);
  });

  it("3.2 revisjonslogg: entityType assignment, action update, changes { companyId: { from, to } }", async () => {
    const s = await companySetup();
    await setRole(s, "responsible", "respA1", TEST_NOW);
    await setRole(s, "responsible", "respA2", LATER);

    const audit = await companyAudit(s.org.id);
    expect(audit).toHaveLength(2);
    for (const row of audit) {
      expect(row.entityId).toBe(s.assignment.id);
      expect(row.action).toBe("update");
    }
    expect(audit.map((row) => row.changes)).toEqual(
      expect.arrayContaining([
        { companyId: { from: null, to: s.a1.id } },
        { companyId: { from: s.a1.id, to: s.a2.id } },
      ]),
    );
    const text = JSON.stringify(audit.map((row) => row.changes));
    expect(text).not.toContain("legalName");
    expect(text).not.toContain(COMPANY_A1);
    expect(text).not.toContain(COMPANY_A2);
  });

  it.each(RULE_CASES.filter((c) => ["2.3", "2.7", "2.8", "2.9"].includes(c.id)))(
    "3.3 ingen company_changed og ingen assignment-loggrad når selskapet ikke endres ($id)",
    async (c) => {
      const { s, eventsBefore, auditBefore } = await runRuleCase(c);
      expect((await companyEvents(s.org.id)).length - eventsBefore).toBe(0);
      expect((await companyAudit(s.org.id)).length - auditBefore).toBe(0);
    },
  );

  it("3.4 ingen personopplysninger eller selskapsnavn i events.data eller audit_log.changes", async () => {
    const s = await companySetup();
    // 2.1–2.5 etter hverandre på samme oppdrag
    const steps: (PersonKey | null)[] = [
      "respA1",
      "respA2",
      "respA1b",
      null,
      "respA1",
      "noCompany",
    ];
    for (const [index, who] of steps.entries()) {
      await setTeamMember(s.admin, s.org.id, s.assignment.id, {
        teamRole: "responsible",
        employeeId: who === null ? null : s.people[who].id,
        reason: index > 0 ? REASON : null,
        now: new Date(TEST_NOW.getTime() + index * 60 * 1000),
      });
    }
    expect((await companyEvents(s.org.id)).length).toBeGreaterThanOrEqual(5);

    const text = JSON.stringify([
      (await eventsFor(s.org.id)).map((row) => row.data),
      (await auditFor(s.org.id)).map((row) => row.changes),
    ]);
    for (const value of [...Object.values(PEOPLE), COMPANY_A1, COMPANY_A2, REASON, "Test Admin"]) {
      expect(text, value).not.toContain(value);
    }
  });
});

describe("4.1 tilgang per rolle: utstedende selskap", () => {
  it.each(ROLE_CASES)(
    "4.1 $name (innstillingen på) setter ansvarlig og får selskapet",
    async ({ roles }) => {
      const s = await companySetup();
      await setInspectorsEditAll(s.org.id, true);
      const { actor } = await person(s.org.id, roles, "Petra Rolletest");

      await setTeamMember(actor, s.org.id, s.assignment.id, {
        teamRole: "responsible",
        employeeId: s.people.respA1.id,
        now: TEST_NOW,
      });

      expect(await companyIdOf(s.assignment.id)).toBe(s.a1.id);
    },
  );

  it("4.2 takstmann med inspectors_edit_all av: AccessDeniedError, selskapet urørt, companyName kan leses", async () => {
    const s = await companySetup();
    await setRole(s, "responsible", "respA1", TEST_NOW);
    await setInspectorsEditAll(s.org.id, false);
    const { actor } = await person(s.org.id, ["inspector"], "Tore Takstmann");

    await expect(
      setTeamMember(actor, s.org.id, s.assignment.id, {
        teamRole: "responsible",
        employeeId: s.people.respA2.id,
        now: LATER,
      }),
    ).rejects.toThrow(AccessDeniedError);

    expect(await companyIdOf(s.assignment.id)).toBe(s.a1.id);
    expect(await companyEvents(s.org.id)).toHaveLength(1);
    expect((await getAssignment(actor, s.org.id, s.assignment.id)).companyName).toBe(COMPANY_A1);
  });

  // Regel 11: admin stenges aldri ute. Testen skal aldri fjernes.
  it("4.3 admin uten andre roller og med innstillingen av setter ansvarlig og får selskapet", async () => {
    const s = await companySetup();
    await setInspectorsEditAll(s.org.id, false);

    await setRole(s, "responsible", "respA1", TEST_NOW);

    expect(await companyIdOf(s.assignment.id)).toBe(s.a1.id);
    expect((await getAssignment(s.admin, s.org.id, s.assignment.id)).companyName).toBe(COMPANY_A1);
  });

  it.each(SETTINGS)(
    "4.4 alle fire roller ser samme companyName (innstillingen $setting)",
    async ({ editAll }) => {
      const s = await companySetup();
      await setRole(s, "responsible", "respA2", TEST_NOW);
      await setInspectorsEditAll(s.org.id, editAll);

      for (const { roles } of ROLE_CASES) {
        const { actor } = await person(s.org.id, roles);
        expect((await getAssignment(actor, s.org.id, s.assignment.id)).companyName).toBe(
          COMPANY_A2,
        );
      }
    },
  );

  it("4.5 bruker uten ansattrad og ansatt uten roller får AccessDeniedError, og ingen companyName lekker", async () => {
    const s = await companySetup();
    await setRole(s, "responsible", "respA1", TEST_NOW);
    const stranger = await createUser({ name: "Ukjent Testbruker" });
    const { actor: noRoles } = await person(s.org.id, [], "Ingrid Utenrolle");
    const before = await tableCounts();

    for (const actor of [stranger, noRoles]) {
      const read = await caught(getAssignment(actor, s.org.id, s.assignment.id));
      expect(read).toBeInstanceOf(AccessDeniedError);
      expect((read as Error).message).not.toContain(COMPANY_A1);
      await expect(
        setTeamMember(actor, s.org.id, s.assignment.id, {
          teamRole: "responsible",
          employeeId: s.people.respA2.id,
          now: LATER,
        }),
      ).rejects.toThrow(AccessDeniedError);
    }

    expect(await companyIdOf(s.assignment.id)).toBe(s.a1.id);
    expect(await tableCounts()).toEqual(before);
  });
});

describe("4.2 tenant-isolasjon: utstedende selskap", () => {
  it("5.1 getAssignment(...).companyName viser aldri selskap fra en annen organisasjon", async () => {
    const assignmentFor = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const names = new Map<string, string>();
        for (const [grant, name] of [
          [grantA, "Selskap A AS"],
          [grantB, "Selskap B AS"],
        ] as const) {
          const orgId = grant.organizationId;
          const company = await createCompany(orgId, { legalName: name });
          const { employee } = await personInCompany(
            orgId,
            ["inspector"],
            `Ansvarlig ${name}`,
            company.id,
          );
          const row = await createAssignment(orgId);
          await setTeamMember(await adminActorOf(orgId), orgId, row.id, {
            teamRole: "responsible",
            employeeId: employee.id,
            now: TEST_NOW,
          });
          assignmentFor.set(orgId, row.id);
          names.set(orgId, name);
        }
        return {
          a: [names.get(grantA.organizationId)!],
          b: [names.get(grantB.organizationId)!],
        };
      },
      query: async (actor, organizationId) => [
        await getAssignment(
          actor,
          organizationId,
          assignmentFor.get(organizationId) ?? randomUUID(),
        ),
      ],
      idOf: (row) => row.companyName ?? "",
    });
  });

  it("5.2 setTeamMember skriver bare company_id på oppdrag i egen organisasjon", async () => {
    const s = await companySetup();
    const b = await orgWithAdmin("Organisasjon B");
    const companyB = await createCompany(b.org.id, { legalName: COMPANY_B });
    const { employee: respB } = await personInCompany(
      b.org.id,
      ["inspector"],
      "Berit Bselskap",
      companyB.id,
    );
    await setTeamMember(b.admin, b.org.id, b.assignment.id, {
      teamRole: "responsible",
      employeeId: respB.id,
      now: TEST_NOW,
    });
    const eventsB = (await eventsFor(b.org.id)).length;
    const auditB = (await auditFor(b.org.id)).length;

    // A setter ansvarlig på eget oppdrag, og prøver Bs oppdrag og Bs ansatt
    await setRole(s, "responsible", "respA1", TEST_NOW);
    await expect(
      setTeamMember(s.admin, s.org.id, b.assignment.id, {
        teamRole: "responsible",
        employeeId: s.people.respA2.id,
        now: LATER,
      }),
    ).rejects.toThrow(AccessDeniedError);
    await expect(
      setTeamMember(s.admin, s.org.id, s.assignment.id, {
        teamRole: "responsible",
        employeeId: respB.id,
        now: LATER,
      }),
    ).rejects.toThrow(EmployeeNotFoundError);

    expect(await companyIdOf(b.assignment.id)).toBe(companyB.id);
    expect(await companyIdOf(s.assignment.id)).toBe(s.a1.id);
    expect(await eventsFor(b.org.id)).toHaveLength(eventsB);
    expect(await auditFor(b.org.id)).toHaveLength(auditB);
    for (const row of await companyEvents(s.org.id)) {
      expect(row.organizationId).toBe(s.org.id);
      expect(JSON.stringify(row.data)).not.toContain(companyB.id);
    }
  });
});

describe("4.5 getAssignment og myk sletting: utstedende selskap", () => {
  it("6.2 oppdrag uten selskap gir companyName = null", async () => {
    const s = await companySetup();
    expect((await getAssignment(s.admin, s.org.id, s.assignment.id)).companyName).toBeNull();
    await setRole(s, "responsible", "noCompany", TEST_NOW);
    expect((await getAssignment(s.admin, s.org.id, s.assignment.id)).companyName).toBeNull();
  });

  it("6.3 mykt slettet selskap vises fortsatt med navn", async () => {
    const s = await companySetup();
    await setRole(s, "responsible", "respA1", TEST_NOW);
    await db
      .update(companies)
      .set({ deletedAt: new Date("2026-11-04T08:00:00Z") })
      .where(eq(companies.id, s.a1.id));

    expect(await companyIdOf(s.assignment.id)).toBe(s.a1.id);
    expect((await getAssignment(s.admin, s.org.id, s.assignment.id)).companyName).toBe(COMPANY_A1);
  });

  it("6.4 ingen N+1: oppdrag med selskap gir like mange spørringer som uten", async () => {
    const s = await companySetup();
    const without = await createAssignment(s.org.id, { officeId: s.office.id });
    await setRole(s, "responsible", "respA1", TEST_NOW);
    await setTeamMember(s.admin, s.org.id, without.id, {
      teamRole: "responsible",
      employeeId: s.people.noCompany.id,
      now: TEST_NOW,
    });

    // Drizzle sender hver spørring gjennom `unsafe` på postgres-klienten
    const client = (db as unknown as { $client: { unsafe: (...args: unknown[]) => unknown } })
      .$client;
    const spy = vi.spyOn(client, "unsafe");
    try {
      spy.mockClear();
      const plain = await getAssignment(s.admin, s.org.id, without.id);
      const plainCount = spy.mock.calls.length;
      spy.mockClear();
      const withCompany = await getAssignment(s.admin, s.org.id, s.assignment.id);
      const companyCount = spy.mock.calls.length;

      expect(plain.companyName).toBeNull();
      expect(withCompany.companyName).toBe(COMPANY_A1);
      expect(plainCount, "spørringene ble talt").toBeGreaterThan(0);
      expect(companyCount).toBe(plainCount);
    } finally {
      spy.mockRestore();
    }
  });

  it("6.5 teamrader og oppdrag slettes aldri ved selskapsbytter; selskapet endres med update", async () => {
    const s = await companySetup();
    const steps: (PersonKey | null)[] = ["respA1", "respA2", null, "noCompany", "respA1"];
    for (const [index, who] of steps.entries()) {
      await setRole(s, "responsible", who, new Date(TEST_NOW.getTime() + index * 60 * 1000));
    }

    const rows = await teamRows(s.assignment.id, "responsible");
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.deletedAt === null)).toBe(true);
    const [assignmentRow] = await db
      .select()
      .from(assignments)
      .where(eq(assignments.id, s.assignment.id));
    expect(assignmentRow?.deletedAt).toBeNull();
    expect(assignmentRow?.companyId).toBe(s.a1.id);
    const audit = await auditFor(s.org.id);
    expect(audit.map((row) => row.action)).not.toContain("delete");
    const assignmentAudit = audit.filter((row) => row.entityType === "assignment");
    expect(assignmentAudit.length).toBeGreaterThan(0);
    expect(assignmentAudit.every((row) => row.action === "update")).toBe(true);
    const companyRows = await db
      .select({ deletedAt: companies.deletedAt })
      .from(companies)
      .where(eq(companies.organizationId, s.org.id));
    expect(companyRows.every((row) => row.deletedAt === null)).toBe(true);
  });
});
