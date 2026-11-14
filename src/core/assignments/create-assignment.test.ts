import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContactNotFoundError } from "@/core/contacts";
import { db } from "@/db/client";
import {
  assignmentTeamMembers,
  assignments,
  auditLog,
  employees,
  events,
  numberSequences,
  offices,
} from "@/db/schema";
import {
  TEST_NOW,
  createCompany,
  createContact,
  createEmployee,
  createFirm,
  createOffice,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import {
  EmployeeNotFoundError,
  OfficeNotFoundError,
  ResponsibleNotInspectorError,
  createAssignment as createAssignmentService,
} from "./index";

/*
 * «Nytt oppdrag»: rett vei og avvisninger (testplan for «Nytt oppdrag» 4.1, 4.2, 4.5.1 og 4.13,
 * kontrakten `CreateAssignment` i `./booking/contract.ts`). Mot testdatabasen. Tjenesten heter som
 * fabrikken og importeres som `createAssignmentService`. Oppdiktede adresser og navn.
 *
 * Støtter hovedmål: de ansatte (oppdrag uten ordre, med ansvarlig og kontor fra start) og færre
 * reklamasjoner (ingenting lagres ved feil, og aldri med data fra en annen organisasjon).
 */

const ADDRESS = "Testveien 12, 8000 Bodø";
const RANDOM = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";

type Counts = {
  assignments: number;
  team: number;
  events: number;
  audit: number;
  sequence: number;
  orders: number;
  contacts: number;
  firms: number;
};

async function counts(): Promise<Counts> {
  const [row] = (await db.execute(sql`
    select
      (select count(*)::int from ${assignments}) as assignments,
      (select count(*)::int from ${assignmentTeamMembers}) as team,
      (select count(*)::int from ${events}) as events,
      (select count(*)::int from ${auditLog}) as audit,
      (select coalesce(sum(next_value), 0)::int from ${numberSequences}) as sequence,
      (select count(*)::int from orders) as orders,
      (select count(*)::int from contacts) as contacts,
      (select count(*)::int from firms) as firms`)) as unknown as Counts[];
  return row!;
}

let start: Counts;

beforeEach(async () => {
  await resetDatabase();
  start = await counts();
});

// 4.13: ingen tjeneste i oppgaven sletter rader
afterEach(async () => {
  const now = await counts();
  for (const table of ["assignments", "orders", "contacts", "firms"] as const) {
    expect(now[table], table).toBeGreaterThanOrEqual(start[table]);
  }
});

async function setup(name = "Oppdiktet Takst A") {
  const org = await createOrganization(name);
  const company = await createCompany(org.id);
  const office = await createOffice(org.id);
  const admin = await createUser({ name: "Test Admin" });
  const adminEmployee = await createEmployee(admin, org.id, ["admin"]);
  const inspectorUser = await createUser({ name: "Test Takstmann" });
  const inspector = await createEmployee(inspectorUser, org.id, ["inspector"], {
    companyId: company.id,
    officeId: office.id,
  });
  return { org, company, office, admin, adminEmployee, inspector, inspectorUser };
}

function input(office: { id: string }, inspector: { id: string }, extra = {}) {
  return {
    addressText: ADDRESS,
    officeId: office.id,
    responsibleEmployeeId: inspector.id,
    ...extra,
  };
}

describe("4.1 rett vei", () => {
  it("4.1.1 befaringstid lagres når den er satt, og bestillingsfeltene står på oppdraget", async () => {
    const { org, admin, office, inspector } = await setup();
    const { id } = await createAssignmentService(
      admin,
      org.id,
      input(office, inspector, {
        inspectionAt: "2026-11-20T09:30",
        gnr: "9001",
        bnr: "1",
        snr: "2",
        orderedByText: "Megler Oppdiktet",
        externalRef: "ORD-2026-0001",
        housingAssociationName: "Prøvetunet Borettslag",
        receivedAt: "2026-11-02T08:15",
      }),
      { now: TEST_NOW },
    );
    const [row] = await db.select().from(assignments).where(eq(assignments.id, id));
    expect(row?.inspectionAt?.toISOString()).toBe("2026-11-20T08:30:00.000Z");
    expect(row?.receivedAt.toISOString()).toBe("2026-11-02T07:15:00.000Z");
    expect(row).toMatchObject({
      gnr: "9001",
      bnr: "1",
      snr: "2",
      orderedByText: "Megler Oppdiktet",
      externalRef: "ORD-2026-0001",
      housingAssociationName: "Prøvetunet Borettslag",
      orderedByContactId: null,
      orderedByFirmId: null,
      sellerDeclarationReceived: false,
      creationKey: null,
      createdBy: expect.any(String),
    });
  });

  it("4.1.2 ansvarlig blir teammedlem med rollen responsible, og oppdraget får selskapet til den ansatte", async () => {
    const { org, admin, office, inspector, company } = await setup();
    const { id } = await createAssignmentService(admin, org.id, input(office, inspector), {
      now: TEST_NOW,
    });
    const team = await db
      .select()
      .from(assignmentTeamMembers)
      .where(eq(assignmentTeamMembers.assignmentId, id));
    expect(team).toHaveLength(1);
    expect(team[0]).toMatchObject({
      employeeId: inspector.id,
      teamRole: "responsible",
      organizationId: org.id,
      deletedAt: null,
    });
    const [row] = await db.select().from(assignments).where(eq(assignments.id, id));
    expect(row?.companyId).toBe(company.id);
  });

  it("4.1.3 firmaet settes fra kontakten også når skjemaet sender et annet firma; uten firma blir det tomt", async () => {
    const { org, admin, office, inspector } = await setup();
    const firmX = await createFirm(org.id, { name: "Testmegling X AS" });
    const firmY = await createFirm(org.id, { name: "Testmegling Y AS" });
    const contact = await createContact(org.id, { firmId: firmX.id });
    const lone = await createContact(org.id, { firmId: null });

    const a = await createAssignmentService(
      admin,
      org.id,
      input(office, inspector, { orderedByContactId: contact.id, orderedByFirmId: firmY.id }),
    );
    const b = await createAssignmentService(
      admin,
      org.id,
      input(office, inspector, { orderedByContactId: lone.id, orderedByFirmId: firmY.id }),
    );
    const rows = await db.select().from(assignments);
    expect(rows.find((r) => r.id === a.id)?.orderedByFirmId).toBe(firmX.id);
    expect(rows.find((r) => r.id === b.id)?.orderedByFirmId).toBeNull();
  });

  it("4.1.4 og 4.1.5 én hendelse og én loggrad med feltkoder, uten verdier", async () => {
    const { org, admin, office, inspector } = await setup();
    const { id, number } = await createAssignmentService(
      admin,
      org.id,
      input(office, inspector, { gnr: "9001", bnr: "1", orderedByText: "Megler Oppdiktet" }),
      { now: TEST_NOW },
    );
    const eventRows = await db.select().from(events).where(eq(events.assignmentId, id));
    expect(eventRows).toHaveLength(1);
    expect(eventRows[0]?.data).toEqual({ number, orderId: null });

    const logs = await db.select().from(auditLog).where(eq(auditLog.entityId, id));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ entityType: "assignment", action: "create" });
    const changes = logs[0]?.changes as { fields: string[] };
    expect(changes.fields).toEqual(["receivedAt", "orderedByText", "addressText", "gnr", "bnr"]);
    const text = JSON.stringify(logs[0]);
    for (const value of ["Testveien", "9001", "Megler Oppdiktet"]) {
      expect(text).not.toContain(value);
    }
  });

  it("4.1.6 organization_id på oppdrag, teammedlem, hendelse og loggrad er organisasjonen fra tilgangen", async () => {
    const { org, admin, office, inspector } = await setup();
    await setup("Oppdiktet Takst B");
    const { id } = await createAssignmentService(admin, org.id, input(office, inspector));
    const rows = (await db.execute(sql`
      select organization_id from assignments where id = ${id}
      union all select organization_id from assignment_team_members where assignment_id = ${id}
      union all select organization_id from events where assignment_id = ${id}
      union all select organization_id from audit_log where entity_id = ${id}`)) as unknown as {
      organization_id: string;
    }[];
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((row) => row.organization_id))).toEqual(new Set([org.id]));
  });

  it("4.1.7 samme engangsnøkkel etter hverandre gir samme id og nummer, uten ny hendelse", async () => {
    const { org, admin, office, inspector } = await setup();
    const data = input(office, inspector, { creationKey: randomUUID() });
    const first = await createAssignmentService(admin, org.id, data, { now: TEST_NOW });
    const second = await createAssignmentService(admin, org.id, data, { now: TEST_NOW });
    expect(second).toEqual({ ...first, created: false });
    const now = await counts();
    expect(now.assignments - start.assignments).toBe(1);
    expect(now.events - start.events).toBe(1);
    expect(now.audit - start.audit).toBe(1);
    expect(now.team - start.team).toBe(1);
  });

  it("4.1.7 engangsnøkkelen gjelder per organisasjon: samme nøkkel i B gir et nytt oppdrag", async () => {
    const a = await setup("Oppdiktet Takst A");
    const b = await setup("Oppdiktet Takst B");
    const creationKey = randomUUID();
    const inA = await createAssignmentService(
      a.admin,
      a.org.id,
      input(a.office, a.inspector, { creationKey }),
    );
    const inB = await createAssignmentService(
      b.admin,
      b.org.id,
      input(b.office, b.inspector, { creationKey }),
    );
    expect(inB.id).not.toBe(inA.id);
    expect(inB.created).toBe(true);
  });

  it("4.1.8 uten engangsnøkkel gir to kall to oppdrag med to nummer", async () => {
    const { org, admin, office, inspector } = await setup();
    const first = await createAssignmentService(admin, org.id, input(office, inspector), {
      now: TEST_NOW,
    });
    const second = await createAssignmentService(admin, org.id, input(office, inspector), {
      now: TEST_NOW,
    });
    expect(second.id).not.toBe(first.id);
    expect([first.number, second.number]).toEqual(["2026-00001", "2026-00002"]);
  });
});

type Setup = Awaited<ReturnType<typeof setup>>;
type Case = [
  string,
  (own: Setup, other: Setup) => Promise<Record<string, unknown>>,
  new () => Error,
];

const REJECTIONS: Case[] = [
  ["kontor fra B", async (_own, other) => ({ officeId: other.office.id }), OfficeNotFoundError],
  [
    "kontor slettet mykt (arkivert)",
    async (own) => {
      const office = await createOffice(own.org.id);
      await db.update(offices).set({ deletedAt: TEST_NOW }).where(eq(offices.id, office.id));
      return { officeId: office.id };
    },
    OfficeNotFoundError,
  ],
  ["tilfeldig uuid som kontor", async () => ({ officeId: RANDOM }), OfficeNotFoundError],
  [
    "ansvarlig fra B",
    async (_own, other) => ({ responsibleEmployeeId: other.inspector.id }),
    EmployeeNotFoundError,
  ],
  [
    "ansvarlig deaktivert",
    async (own) => {
      const employee = await createEmployee(await createUser(), own.org.id, ["inspector"]);
      await db
        .update(employees)
        .set({ deactivatedAt: TEST_NOW })
        .where(eq(employees.id, employee.id));
      return { responsibleEmployeeId: employee.id };
    },
    EmployeeNotFoundError,
  ],
  [
    "ansvarlig slettet mykt",
    async (own) => {
      const employee = await createEmployee(await createUser(), own.org.id, ["inspector"]);
      await db.update(employees).set({ deletedAt: TEST_NOW }).where(eq(employees.id, employee.id));
      return { responsibleEmployeeId: employee.id };
    },
    EmployeeNotFoundError,
  ],
  [
    "ansvarlig med bare kontorrollen",
    async (own) => ({
      responsibleEmployeeId: (await createEmployee(await createUser(), own.org.id, ["office"])).id,
    }),
    ResponsibleNotInspectorError,
  ],
  [
    "ansvarlig med bare lederrollen",
    async (own) => ({
      responsibleEmployeeId: (await createEmployee(await createUser(), own.org.id, ["manager"])).id,
    }),
    ResponsibleNotInspectorError,
  ],
  [
    "tilfeldig uuid som ansvarlig",
    async () => ({ responsibleEmployeeId: RANDOM }),
    EmployeeNotFoundError,
  ],
  [
    "kontakt fra B",
    async (_own, other) => ({ orderedByContactId: (await createContact(other.org.id)).id }),
    ContactNotFoundError,
  ],
  [
    "kontakt slettet mykt",
    async (own) => ({
      orderedByContactId: (await createContact(own.org.id, { deletedAt: TEST_NOW })).id,
    }),
    ContactNotFoundError,
  ],
  [
    "tilfeldig uuid som kontakt",
    async () => ({ orderedByContactId: RANDOM }),
    ContactNotFoundError,
  ],
];

describe("4.2 avvisninger: tydelig feil og ingenting lagret", () => {
  it.each(REJECTIONS)("%s", async (_name, extra, ErrorType) => {
    const own = await setup("Oppdiktet Takst A");
    const other = await setup("Oppdiktet Takst B");
    const overrides = await extra(own, other);
    const before = await counts();

    const error = await createAssignmentService(
      own.admin,
      own.org.id,
      input(own.office, own.inspector, overrides),
    ).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ErrorType);
    const after = await counts();
    for (const key of ["assignments", "team", "events", "audit", "sequence"] as const) {
      expect(after[key], key).toBe(before[key]);
    }
  });

  it.each([
    ["kontor", async (other: Setup) => ({ officeId: other.office.id }), { officeId: RANDOM }],
    [
      "ansvarlig",
      async (other: Setup) => ({ responsibleEmployeeId: other.inspector.id }),
      { responsibleEmployeeId: RANDOM },
    ],
    [
      "kontakt",
      async (other: Setup) => ({ orderedByContactId: (await createContact(other.org.id)).id }),
      { orderedByContactId: RANDOM },
    ],
  ] as const)(
    "4.2.4 fremmed og ukjent %s gir nøyaktig samme feil og melding",
    async (_name, foreign, unknown) => {
      const own = await setup("Oppdiktet Takst A");
      const other = await setup("Oppdiktet Takst B");
      const run = (extra: Record<string, unknown>) =>
        createAssignmentService(
          own.admin,
          own.org.id,
          input(own.office, own.inspector, extra),
        ).then(
          () => null,
          (caught: unknown) => caught as Error,
        );
      const a = await run(await foreign(other));
      const b = await run(unknown);
      expect(a).toBeInstanceOf(Error);
      expect(a?.constructor).toBe(b?.constructor);
      expect(a?.message).toBe(b?.message);
    },
  );

  it.each([
    ["tom adresse", { addressText: "" }],
    ["elleve sifre i bestiller", { orderedByText: "Ring 01020312345" }],
    ["bokstaver i gnr", { gnr: "12a" }],
    ["kontor som ikke er uuid", { officeId: "kontor-1" }],
  ])("4.2.5 ugyldig input (%s): valideringsfeil, ingen rader", async (_name, extra) => {
    const own = await setup();
    const before = await counts();
    const error = await createAssignmentService(
      own.admin,
      own.org.id,
      input(own.office, own.inspector, extra),
    ).then(
      () => null,
      (caught: unknown) => caught as Error,
    );
    expect(error?.name).toBe("ZodError");
    expect(await counts()).toEqual(before);
  });
});

describe("4.5.1 tenant-isolasjon for createAssignment", () => {
  it("et oppdrag laget i B har alle rader i B, og A ser det aldri", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const result = { a: [] as string[], b: [] as string[] };
        for (const [key, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const office = await createOffice(grant.organizationId);
          const user = await createUser();
          const inspector = await createEmployee(user, grant.organizationId, ["inspector"]);
          const created = await createAssignmentService(user, grant.organizationId, {
            addressText: ADDRESS,
            officeId: office.id,
            responsibleEmployeeId: inspector.id,
          });
          result[key].push(created.id);
          // Alle rader for oppdraget har organisasjonen fra tilgangen
          const rows = (await db.execute(sql`
            select organization_id from assignment_team_members where assignment_id = ${created.id}
            union all select organization_id from events where assignment_id = ${created.id}
            union all select organization_id from audit_log where entity_id = ${created.id}`)) as unknown as {
            organization_id: string;
          }[];
          expect(rows).toHaveLength(3);
          for (const row of rows) expect(row.organization_id).toBe(grant.organizationId);
        }
        return result;
      },
      query: async (actor, organizationId) => {
        const error = await createAssignmentService(actor, organizationId, {
          addressText: ADDRESS,
          officeId: RANDOM,
          responsibleEmployeeId: RANDOM,
        }).catch((caught: unknown) => caught);
        if (!(error instanceof OfficeNotFoundError)) throw error;
        return db
          .select({ id: assignments.id })
          .from(assignments)
          .where(eq(assignments.organizationId, organizationId));
      },
      idOf: (row) => row.id,
    });
  });
});
