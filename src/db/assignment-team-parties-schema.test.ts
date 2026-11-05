import { randomUUID } from "node:crypto";
import { getTableColumns, getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import {
  createAssignment,
  createCompany,
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
  TEST_NOW,
} from "../../tests/factories";
import { tenantTables } from "../../tests/tenant-tables";

/*
 * Databasen selv holder reglene for team og parter på oppdraget
 * (docs/funksjoner/fase2a-oppdrag-team-parter-testplan.md avsnitt 3). Direkte innsetting med
 * SQL, utenom kjernen, så det er skrankene i databasen som prøves. Feilkoden sjekkes, så en
 * skrivefeil i et kolonnenavn ikke gir en falsk grønn test.
 *
 * Støtter hovedmål: reklamasjoner (aldri to aktive i samme rolle, aldri en ansatt eller et
 * oppdrag fra en annen organisasjon, historikken har alltid slutt etter start). Testdata er
 * oppdiktet.
 */

beforeEach(resetDatabase);

const CHECK = "23514";
const FOREIGN_KEY = "23503";
const UNIQUE = "23505";
const LATER = new Date(TEST_NOW.getTime() + 60 * 60 * 1000);
const EARLIER = new Date(TEST_NOW.getTime() - 60 * 60 * 1000);

/** Postgres-feilkoden, også når Drizzle har pakket feilen inn. */
function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

async function expectPgError(run: Promise<unknown>, code: string) {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, "databasen skulle avvist raden").not.toBeNull();
  expect(pgCode(error), `feilkode (fikk ${String(error)})`).toBe(code);
}

async function employeeIn(organizationId: string) {
  return createEmployee(await createUser(), organizationId, ["inspector"]);
}

function insertTeamSql(values: {
  organizationId: string;
  assignmentId: string;
  employeeId: string;
  teamRole?: string;
  fromAt?: Date;
  toAt?: Date | null;
  deletedAt?: Date | null;
}) {
  return db.execute(sql`
    insert into assignment_team_members (
      organization_id, assignment_id, employee_id, team_role, from_at, to_at, deleted_at
    ) values (
      ${values.organizationId}, ${values.assignmentId}, ${values.employeeId},
      ${values.teamRole ?? "responsible"}, ${(values.fromAt ?? TEST_NOW).toISOString()},
      ${values.toAt ? values.toAt.toISOString() : null},
      ${values.deletedAt ? values.deletedAt.toISOString() : null}
    )`);
}

function insertPartySql(values: { organizationId: string; assignmentId: string; role?: string }) {
  return db.execute(sql`
    insert into assignment_parties (organization_id, assignment_id, role, name)
    values (${values.organizationId}, ${values.assignmentId}, ${values.role ?? "broker"},
      'Megler Test')
    returning receives_report, receives_invoice, receives_messages`);
}

/** Én organisasjon med ett oppdrag og to ansatte. */
async function setup() {
  const org = await createOrganization("Oppdiktet takst A");
  const assignment = await createAssignment(org.id);
  const first = await employeeIn(org.id);
  const second = await employeeIn(org.id);
  return { org, assignment, first, second };
}

describe("3 assignment_team_members", () => {
  it("3.1 to aktive i samme rolle på samme oppdrag avvises (unik delvis indeks)", async () => {
    const { org, assignment, first, second } = await setup();
    await insertTeamSql({
      organizationId: org.id,
      assignmentId: assignment.id,
      employeeId: first.id,
    });
    await expectPgError(
      insertTeamSql({
        organizationId: org.id,
        assignmentId: assignment.id,
        employeeId: second.id,
      }),
      UNIQUE,
    );
  });

  it("3.2 en avsluttet rad sperrer ikke for en ny aktiv i samme rolle", async () => {
    const { org, assignment, first, second } = await setup();
    await insertTeamSql({
      organizationId: org.id,
      assignmentId: assignment.id,
      employeeId: first.id,
      toAt: LATER,
    });
    await insertTeamSql({
      organizationId: org.id,
      assignmentId: assignment.id,
      employeeId: second.id,
      fromAt: LATER,
    });
  });

  it("3.3 en myk-slettet aktiv rad sperrer ikke for en ny aktiv rad", async () => {
    const { org, assignment, first, second } = await setup();
    await insertTeamSql({
      organizationId: org.id,
      assignmentId: assignment.id,
      employeeId: first.id,
      deletedAt: LATER,
    });
    await insertTeamSql({
      organizationId: org.id,
      assignmentId: assignment.id,
      employeeId: second.id,
    });
  });

  it("3.4 samme ansatt kan være ansvarlig og befaringstakstmann", async () => {
    const { org, assignment, first } = await setup();
    await insertTeamSql({
      organizationId: org.id,
      assignmentId: assignment.id,
      employeeId: first.id,
      teamRole: "responsible",
    });
    await insertTeamSql({
      organizationId: org.id,
      assignmentId: assignment.id,
      employeeId: first.id,
      teamRole: "inspector",
    });
  });

  it("3.5 samme rolle på to ulike oppdrag godtas", async () => {
    const { org, assignment, first } = await setup();
    const other = await createAssignment(org.id);
    await insertTeamSql({
      organizationId: org.id,
      assignmentId: assignment.id,
      employeeId: first.id,
    });
    await insertTeamSql({ organizationId: org.id, assignmentId: other.id, employeeId: first.id });
  });

  it("3.6 ansatt fra en annen organisasjon avvises av den sammensatte fremmednøkkelen", async () => {
    const { org, assignment } = await setup();
    const orgB = await createOrganization("Oppdiktet takst B");
    const foreign = await employeeIn(orgB.id);
    await expectPgError(
      insertTeamSql({
        organizationId: org.id,
        assignmentId: assignment.id,
        employeeId: foreign.id,
      }),
      FOREIGN_KEY,
    );
  });

  it("3.7 oppdrag fra en annen organisasjon avvises", async () => {
    const { org, first } = await setup();
    const orgB = await createOrganization("Oppdiktet takst B");
    const foreign = await createAssignment(orgB.id);
    await expectPgError(
      insertTeamSql({ organizationId: org.id, assignmentId: foreign.id, employeeId: first.id }),
      FOREIGN_KEY,
    );
  });

  it.each(["owner", "client", "", "Responsible"])(
    "3.8 ukjent team_role «%s» avvises (CHECK)",
    async (teamRole) => {
      const { org, assignment, first } = await setup();
      await expectPgError(
        insertTeamSql({
          organizationId: org.id,
          assignmentId: assignment.id,
          employeeId: first.id,
          teamRole,
        }),
        CHECK,
      );
    },
  );

  it.each(["responsible", "co_responsible", "inspector", "peer_reviewer", "office"])(
    "3.8 kjent team_role %s godtas",
    async (teamRole) => {
      const { org, assignment, first } = await setup();
      await insertTeamSql({
        organizationId: org.id,
        assignmentId: assignment.id,
        employeeId: first.id,
        teamRole,
      });
    },
  );

  it("3.9 to_at før from_at avvises", async () => {
    const { org, assignment, first } = await setup();
    await expectPgError(
      insertTeamSql({
        organizationId: org.id,
        assignmentId: assignment.id,
        employeeId: first.id,
        toAt: EARLIER,
      }),
      CHECK,
    );
  });

  it("3.9 to_at lik from_at godtas", async () => {
    const { org, assignment, first } = await setup();
    await insertTeamSql({
      organizationId: org.id,
      assignmentId: assignment.id,
      employeeId: first.id,
      toAt: TEST_NOW,
    });
  });

  it("from_at er påkrevd", async () => {
    const { org, assignment, first } = await setup();
    await expectPgError(
      db.execute(sql`
        insert into assignment_team_members (
          organization_id, assignment_id, employee_id, team_role, from_at
        ) values (${org.id}, ${assignment.id}, ${first.id}, 'responsible', null)`),
      "23502",
    );
  });
});

describe("3 assignment_parties", () => {
  it("3.7 oppdrag fra en annen organisasjon avvises", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const orgB = await createOrganization("Oppdiktet takst B");
    const foreign = await createAssignment(orgB.id);
    await expectPgError(
      insertPartySql({ organizationId: org.id, assignmentId: foreign.id }),
      FOREIGN_KEY,
    );
  });

  it.each(["client", "other", "", "Broker"])(
    "3.8 ukjent rolle «%s» på part avvises (CHECK)",
    async (role) => {
      const org = await createOrganization("Oppdiktet takst A");
      const assignment = await createAssignment(org.id);
      await expectPgError(
        insertPartySql({ organizationId: org.id, assignmentId: assignment.id, role }),
        CHECK,
      );
    },
  );

  it.each(["broker", "seller", "buyer", "seller_representative", "invoice_recipient"])(
    "3.8 kjent rolle %s godtas",
    async (role) => {
      const org = await createOrganization("Oppdiktet takst A");
      const assignment = await createAssignment(org.id);
      await insertPartySql({ organizationId: org.id, assignmentId: assignment.id, role });
    },
  );

  it("3.10 part uten mottar-felt har rapport, faktura og kopi = false", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const assignment = await createAssignment(org.id);
    const result = await insertPartySql({ organizationId: org.id, assignmentId: assignment.id });
    const [row] = result as unknown as Record<string, unknown>[];
    expect(row).toEqual({
      receives_report: false,
      receives_invoice: false,
      receives_messages: false,
    });
  });

  it("navn er påkrevd", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const assignment = await createAssignment(org.id);
    await expectPgError(
      db.execute(sql`
        insert into assignment_parties (organization_id, assignment_id, role, name)
        values (${org.id}, ${assignment.id}, 'broker', null)`),
      "23502",
    );
  });
});

describe("3.11 tenant-tabellene", () => {
  const schemaValues: unknown[] = Object.values(schema);
  const tables = schemaValues.filter((value): value is PgTable => is(value, PgTable));

  it.each(["assignment_team_members", "assignment_parties"])(
    "%s finnes i skjemaet med organization_id og deleted_at",
    (name) => {
      const table = tables.find((candidate) => getTableName(candidate) === name);
      expect(table, `tabellen ${name} i skjemaet`).toBeDefined();
      const columns = Object.values(getTableColumns(table!)).map((column) => column.name);
      expect(columns).toEqual(expect.arrayContaining(["organization_id", "deleted_at"]));
    },
  );

  it.each([
    ["assignment_team_members", "createTeamMember"],
    ["assignment_parties", "createAssignmentParty"],
  ])("%s står i tests/tenant-tables.ts med testfilen for team og parter", async (name) => {
    const entry = tenantTables.find((candidate) => candidate.table === name);
    expect(entry, `${name} i tests/tenant-tables.ts`).toBeDefined();
    expect(entry!.testFile).toBe("src/core/assignments/assignment-team-parties.test.ts");
    const org = await createOrganization("Oppdiktet takst A");
    const id = await entry!.insertRow(org.id);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

/*
 * Utstedende selskap på oppdraget (docs/agenter/oppgaver/fase2a-utstedende-selskap-testplan.md
 * avsnitt 1). `assignments.company_id` kan være tom, og den sammensatte fremmednøkkelen
 * `assignments_company_fk` på (organization_id, company_id) stopper et selskap fra en annen
 * organisasjon. Navnet på fremmednøkkelen sjekkes, så det ikke er en annen nøkkel som slår til.
 */

/** Navnet på skranken som stoppet raden, også når Drizzle har pakket feilen inn. */
function pgConstraint(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const name = (current as { constraint_name?: unknown }).constraint_name;
    if (typeof name === "string") return name;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

async function expectCompanyFk(run: Promise<unknown>) {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, "databasen skulle avvist selskapet").not.toBeNull();
  expect(pgCode(error), `feilkode (fikk ${String(error)})`).toBe(FOREIGN_KEY);
  expect(pgConstraint(error)).toBe("assignments_company_fk");
}

function insertAssignmentSql(values: {
  organizationId: string;
  officeId: string;
  companyId: string | null;
}) {
  return db.execute(sql`
    insert into assignments (organization_id, number, office_id, company_id)
    values (${values.organizationId}, ${`SQL-${randomUUID().slice(0, 8)}`}, ${values.officeId},
      ${values.companyId})
    returning id, company_id`);
}

function updateCompanySql(assignmentId: string, companyId: string | null) {
  return db.execute(
    sql`update assignments set company_id = ${companyId} where id = ${assignmentId}`,
  );
}

async function companyIdOf(assignmentId: string) {
  const rows = (await db.execute(
    sql`select company_id from assignments where id = ${assignmentId}`,
  )) as unknown as { company_id: string | null }[];
  return rows[0]?.company_id;
}

describe("3.x utstedende selskap (assignments.company_id)", () => {
  it("1.1 company_id kan være tom", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const assignment = await createAssignment(org.id);
    expect(await companyIdOf(assignment.id)).toBeNull();
    const result = await insertAssignmentSql({
      organizationId: org.id,
      officeId: assignment.officeId,
      companyId: null,
    });
    const [row] = result as unknown as { company_id: string | null }[];
    expect(row?.company_id).toBeNull();
  });

  it("1.2 company_id fra egen organisasjon godtas (insert og update)", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const own = await createCompany(org.id, { legalName: "Selskap A1 AS" });
    const other = await createCompany(org.id, { legalName: "Selskap A2 AS" });
    const assignment = await createAssignment(org.id);

    const result = await insertAssignmentSql({
      organizationId: org.id,
      officeId: assignment.officeId,
      companyId: own.id,
    });
    const [row] = result as unknown as { company_id: string | null }[];
    expect(row?.company_id).toBe(own.id);

    await updateCompanySql(assignment.id, other.id);
    expect(await companyIdOf(assignment.id)).toBe(other.id);
    await updateCompanySql(assignment.id, null);
    expect(await companyIdOf(assignment.id)).toBeNull();
  });

  it("1.3 company_id fra en annen organisasjon avvises av assignments_company_fk", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const orgB = await createOrganization("Oppdiktet takst B");
    const foreign = await createCompany(orgB.id, { legalName: "Selskap B AS" });
    const assignment = await createAssignment(org.id);

    await expectCompanyFk(
      insertAssignmentSql({
        organizationId: org.id,
        officeId: assignment.officeId,
        companyId: foreign.id,
      }),
    );
    await expectCompanyFk(updateCompanySql(assignment.id, foreign.id));
    expect(await companyIdOf(assignment.id)).toBeNull();
  });

  it("1.4 ukjent company_id avvises av samme fremmednøkkel", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const assignment = await createAssignment(org.id);

    await expectCompanyFk(
      insertAssignmentSql({
        organizationId: org.id,
        officeId: assignment.officeId,
        companyId: randomUUID(),
      }),
    );
    await expectCompanyFk(updateCompanySql(assignment.id, randomUUID()));
    expect(await companyIdOf(assignment.id)).toBeNull();
  });
});
