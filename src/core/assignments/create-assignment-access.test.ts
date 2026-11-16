import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { employees, organizations } from "@/db/schema";
import {
  TEST_NOW,
  createEmployee,
  createOffice,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import {
  createAssignment as createAssignmentService,
  findPossibleDuplicatesFor,
  findPossibleDuplicatesForAssignment,
  getAssignmentBooking,
  getNewAssignmentFormOptions,
  listAssignmentBookingHistory,
  updateAssignmentBooking,
} from "./index";

/*
 * Tilgang per rolle for «Nytt oppdrag» og bestillingen på oppdraget (testplan for «Nytt oppdrag»
 * 4.4). Oppretting og endring krever `assignment.edit`; lesing (historikk, dublett) bare
 * `organization.read`. Mot testdatabasen. Oppdiktede navn.
 *
 * Støtter hovedmål: de ansatte (kontoret og lederne kan alltid lage oppdrag; admin stenges aldri
 * ute, regel 11) og færre reklamasjoner (den som er fjernet eller har sluttet, kan ikke endre).
 */

beforeEach(resetDatabase);

const ADDRESS = "Testveien 12, 8000 Bodø";
type Role = "inspector" | "office" | "manager" | "admin";

async function setInspectorsEditAll(organizationId: string, value: boolean) {
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": value } })
    .where(eq(organizations.id, organizationId));
}

async function setup(editAll: boolean) {
  const org = await createOrganization("Oppdiktet Takst A");
  await setInspectorsEditAll(org.id, editAll);
  const office = await createOffice(org.id);
  const owner = await createUser({ name: "Test Eier" });
  await createEmployee(owner, org.id, ["admin"]);
  const responsible = await createEmployee(await createUser({ name: "Test Ansvarlig" }), org.id, [
    "inspector",
  ]);
  const existing = await createAssignmentService(owner, org.id, {
    addressText: ADDRESS,
    officeId: office.id,
    responsibleEmployeeId: responsible.id,
  });
  return { org, office, responsible, existing };
}

async function actorWith(organizationId: string, roles: Role[]): Promise<Actor> {
  const actor = await createUser({ name: `Test ${roles.join(" ")}` });
  await createEmployee(actor, organizationId, roles);
  return actor;
}

async function assignmentCount(): Promise<number> {
  const [row] = (await db.execute(sql`select count(*)::int as n from assignments`)) as unknown as {
    n: number;
  }[];
  return row!.n;
}

const TABLE: [Role, boolean, boolean][] = [
  ["inspector", true, true],
  ["inspector", false, false],
  ["office", true, true],
  ["office", false, true],
  ["manager", true, true],
  ["manager", false, true],
  ["admin", true, true],
  ["admin", false, true],
];

describe("4.4.1 rolletabellen for oppretting og endring", () => {
  it.each(TABLE)(
    "%s med access.inspectors_edit_all = %s: tilgang = %s",
    async (role, editAll, allowed) => {
      const { org, office, responsible, existing } = await setup(editAll);
      const actor = await actorWith(org.id, [role]);
      const before = await assignmentCount();

      const create = () =>
        createAssignmentService(actor, org.id, {
          addressText: "Prøvegata 3",
          officeId: office.id,
          responsibleEmployeeId: responsible.id,
        });
      const update = () =>
        updateAssignmentBooking(
          actor,
          org.id,
          existing.id,
          { addressText: "Prøvegata 4" },
          existing.rowVersion,
          TEST_NOW,
        );

      if (allowed) {
        await expect(create()).resolves.toMatchObject({ created: true });
        await expect(update()).resolves.toMatchObject({ fields: ["addressText"] });
        expect(await assignmentCount()).toBe(before + 1);
      } else {
        await expect(create()).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(update()).rejects.toBeInstanceOf(AccessDeniedError);
        expect(await assignmentCount()).toBe(before);
        await expect(getNewAssignmentFormOptions(actor, org.id)).rejects.toBeInstanceOf(
          AccessDeniedError,
        );
      }
    },
  );
});

describe("4.4.2 admin stenges aldri ute (regel 11, testen skal aldri fjernes)", () => {
  it("admin uten andre roller og uten sertifisering lager og endrer oppdrag med innstillingen av", async () => {
    const { org, office, responsible, existing } = await setup(false);
    const admin = await actorWith(org.id, ["admin"]);
    const created = await createAssignmentService(admin, org.id, {
      addressText: "Prøvegata 3",
      officeId: office.id,
      responsibleEmployeeId: responsible.id,
    });
    expect(created.created).toBe(true);
    const updated = await updateAssignmentBooking(
      admin,
      org.id,
      existing.id,
      { addressText: "Prøvegata 9" },
      existing.rowVersion,
    );
    expect(updated.rowVersion).toBe(existing.rowVersion + 1);
    const options = await getNewAssignmentFormOptions(admin, org.id);
    expect(options.offices.map((o) => o.id)).toContain(office.id);
  });
});

describe("4.4.3 fjernet, deaktivert og manglende ansatt", () => {
  const VARIANTS = ["fjernet (slettet mykt)", "deaktivert", "uten ansattrad"] as const;

  async function actorFor(organizationId: string, variant: (typeof VARIANTS)[number]) {
    const actor = await createUser({ name: "Test Sluttet" });
    if (variant === "uten ansattrad") return actor;
    const employee = await createEmployee(actor, organizationId, ["admin"]);
    await db
      .update(employees)
      .set(variant === "deaktivert" ? { deactivatedAt: TEST_NOW } : { deletedAt: TEST_NOW })
      .where(eq(employees.id, employee.id));
    return actor;
  }

  it.each(VARIANTS)("%s får AccessDeniedError på alle tjenestene", async (variant) => {
    const { org, office, responsible, existing } = await setup(true);
    const actor = await actorFor(org.id, variant);
    const calls: [string, () => Promise<unknown>][] = [
      [
        "createAssignment",
        () =>
          createAssignmentService(actor, org.id, {
            addressText: ADDRESS,
            officeId: office.id,
            responsibleEmployeeId: responsible.id,
          }),
      ],
      [
        "updateAssignmentBooking",
        () =>
          updateAssignmentBooking(actor, org.id, existing.id, { addressText: "X 1" }, 1, TEST_NOW),
      ],
      [
        "listAssignmentBookingHistory",
        () => listAssignmentBookingHistory(actor, org.id, existing.id),
      ],
      [
        "findPossibleDuplicatesFor",
        () =>
          findPossibleDuplicatesFor(actor, org.id, {
            addressText: ADDRESS,
            gnr: null,
            bnr: null,
            snr: null,
            receivedAt: TEST_NOW,
          }),
      ],
      [
        "findPossibleDuplicatesForAssignment",
        () => findPossibleDuplicatesForAssignment(actor, org.id, existing.id),
      ],
      ["getAssignmentBooking", () => getAssignmentBooking(actor, org.id, existing.id)],
      ["getNewAssignmentFormOptions", () => getNewAssignmentFormOptions(actor, org.id)],
    ];
    for (const [name, call] of calls) {
      await expect(call(), name).rejects.toBeInstanceOf(AccessDeniedError);
    }
  });
});

describe("4.4.4 lesing krever bare organization.read", () => {
  it("takstmann med innstillingen av leser historikk, dublett og bestillingen", async () => {
    const { org, existing } = await setup(false);
    const inspector = await actorWith(org.id, ["inspector"]);
    const history = await listAssignmentBookingHistory(inspector, org.id, existing.id);
    expect(history.map((entry) => entry.action)).toEqual(["create"]);
    const draft = await findPossibleDuplicatesFor(inspector, org.id, {
      addressText: ADDRESS,
      gnr: null,
      bnr: null,
      snr: null,
      receivedAt: TEST_NOW,
    });
    expect(draft.items.map((item) => item.id)).toEqual([existing.id]);
    await expect(
      findPossibleDuplicatesForAssignment(inspector, org.id, existing.id),
    ).resolves.toMatchObject({ items: [] });
    await expect(getAssignmentBooking(inspector, org.id, existing.id)).resolves.toBeDefined();
  });
});

describe("4.4.5 takstmann med innstillingen på", () => {
  it("kan velge en annen takstmann som ansvarlig", async () => {
    const { org, office, responsible } = await setup(true);
    const inspector = await actorWith(org.id, ["inspector"]);
    const created = await createAssignmentService(inspector, org.id, {
      addressText: "Prøvegata 3",
      officeId: office.id,
      responsibleEmployeeId: responsible.id,
    });
    const [team] = (await db.execute(sql`
      select employee_id from assignment_team_members
      where assignment_id = ${created.id} and team_role = 'responsible'`)) as unknown as {
      employee_id: string;
    }[];
    expect(team?.employee_id).toBe(responsible.id);
  });
});
