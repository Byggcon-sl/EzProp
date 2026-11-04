import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import {
  createAssignment,
  createNumberSequence,
  createOffice,
  createOrder,
  createOrganization,
  resetDatabase,
} from "../../tests/factories";

/*
 * Databasen selv avviser ugyldige ordre, oppdrag og nummerserier (testplan
 * docs/funksjoner/fase2a-manuell-ordre-testplan.md avsnitt 6, med runde 1 og 2). Direkte
 * innsetting med SQL, utenom kjernen, slik at det er skranken i databasen som prøves, og
 * navnet på skranken sjekkes. Testdata er oppdiktet.
 * Støtter hovedmål: reklamasjoner (en ordre kan aldri peke på et oppdrag i en annen organisasjon,
 * og to oppdrag får aldri samme nummer).
 */

beforeEach(resetDatabase);

const ADDRESS = "Testveien 12, 8000 Bodø";

/** Venter på at setningen avvises av skranken med navnet `constraint`. */
async function expectConstraint(query: Promise<unknown>, constraint: string) {
  const error = await query.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, `setningen skulle vært avvist av ${constraint}`).not.toBeNull();
  const cause = (error as { cause?: { constraint_name?: string } }).cause;
  const name =
    cause?.constraint_name ?? (error as { constraint_name?: string }).constraint_name ?? "";
  expect(name).toBe(constraint);
}

async function count(table: "orders" | "assignments" | "events" | "number_sequences") {
  const rows = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.identifier(table)}`,
  );
  return Array.from(rows)[0]?.n ?? 0;
}

function insertOrder(values: {
  organizationId: string;
  status?: string;
  rejectedReason?: string | null;
  assignmentId?: string | null;
  source?: string;
}) {
  return db.execute(sql`
    insert into orders (organization_id, address_text, status, rejected_reason, assignment_id, source)
    values (${values.organizationId}, ${ADDRESS}, ${values.status ?? "received"},
      ${values.rejectedReason ?? null}, ${values.assignmentId ?? null}, ${values.source ?? "manual"})`);
}

function insertAssignment(values: {
  organizationId: string;
  officeId: string;
  number: string;
  assignmentType?: string;
  status?: string;
}) {
  return db.execute(sql`
    insert into assignments (organization_id, office_id, number, assignment_type, status)
    values (${values.organizationId}, ${values.officeId}, ${values.number},
      ${values.assignmentType ?? "condition_report"}, ${values.status ?? "ordered"})`);
}

function insertSequence(values: {
  organizationId: string;
  scope?: string;
  prefix?: string;
  nextValue?: number;
}) {
  return db.execute(sql`
    insert into number_sequences (organization_id, scope, prefix, next_value)
    values (${values.organizationId}, ${values.scope ?? "assignment"},
      ${values.prefix ?? "2026-"}, ${values.nextValue ?? 1})`);
}

async function twoOrganizations() {
  const orgA = await createOrganization("Organisasjon A");
  const orgB = await createOrganization("Organisasjon B");
  return { orgA, orgB };
}

describe("orders i databasen", () => {
  it("6.1 rejected uten rejected_reason avvises", async () => {
    const org = await createOrganization();
    await expectConstraint(
      insertOrder({ organizationId: org.id, status: "rejected" }),
      "orders_rejected_reason_check",
    );
    await expectConstraint(
      insertOrder({ organizationId: org.id, status: "rejected", rejectedReason: "   " }),
      "orders_rejected_reason_check",
    );
    await insertOrder({ organizationId: org.id, status: "rejected", rejectedReason: "Feil" });
    expect(await count("orders")).toBe(1);
  });

  it("6.2 converted uten assignment_id avvises", async () => {
    const org = await createOrganization();
    await expectConstraint(
      insertOrder({ organizationId: org.id, status: "converted" }),
      "orders_assignment_id_check",
    );
    expect(await count("orders")).toBe(0);
  });

  it("6.3 assignment_id på en received-ordre avvises", async () => {
    const org = await createOrganization();
    const assignment = await createAssignment(org.id);
    await expectConstraint(
      insertOrder({ organizationId: org.id, status: "received", assignmentId: assignment.id }),
      "orders_assignment_id_check",
    );
    expect(await count("orders")).toBe(0);
  });

  it("6.4 rejected med assignment_id avvises", async () => {
    const org = await createOrganization();
    const assignment = await createAssignment(org.id);
    await expectConstraint(
      insertOrder({
        organizationId: org.id,
        status: "rejected",
        rejectedReason: "Feil registrering",
        assignmentId: assignment.id,
      }),
      "orders_assignment_id_check",
    );
  });

  it("6.4b converted med oppdrag i samme organisasjon godtas", async () => {
    const org = await createOrganization();
    const assignment = await createAssignment(org.id);
    await insertOrder({ organizationId: org.id, status: "converted", assignmentId: assignment.id });
    expect(await count("orders")).toBe(1);
  });

  it("6.5 ordre som peker på oppdrag i en annen organisasjon avvises (sammensatt fremmednøkkel)", async () => {
    const { orgA, orgB } = await twoOrganizations();
    const assignmentB = await createAssignment(orgB.id);
    await expectConstraint(
      insertOrder({ organizationId: orgA.id, status: "converted", assignmentId: assignmentB.id }),
      "orders_assignment_fk",
    );
    expect(await count("orders")).toBe(0);
  });
});

describe("assignments i databasen", () => {
  it("6.6 oppdrag med kontor fra en annen organisasjon avvises", async () => {
    const { orgA, orgB } = await twoOrganizations();
    const officeB = await createOffice(orgB.id);
    await expectConstraint(
      insertAssignment({ organizationId: orgA.id, officeId: officeB.id, number: "2026-00001" }),
      "assignments_office_fk",
    );
    expect(await count("assignments")).toBe(0);
  });

  it("6.6b oppdrag med ordre fra en annen organisasjon avvises", async () => {
    const { orgA, orgB } = await twoOrganizations();
    const officeA = await createOffice(orgA.id);
    const orderB = await createOrder(orgB.id);
    await expectConstraint(
      db.execute(sql`
        insert into assignments (organization_id, office_id, order_id, number)
        values (${orgA.id}, ${officeA.id}, ${orderB.id}, '2026-00001')`),
      "assignments_order_fk",
    );
  });

  it("6.7 to oppdrag med samme nummer i samme organisasjon avvises; i to organisasjoner godtas", async () => {
    const { orgA, orgB } = await twoOrganizations();
    const officeA = await createOffice(orgA.id);
    const officeB = await createOffice(orgB.id);
    await insertAssignment({ organizationId: orgA.id, officeId: officeA.id, number: "2026-00001" });
    await expectConstraint(
      insertAssignment({ organizationId: orgA.id, officeId: officeA.id, number: "2026-00001" }),
      "assignments_organization_id_number_idx",
    );
    await insertAssignment({ organizationId: orgB.id, officeId: officeB.id, number: "2026-00001" });
    expect(await count("assignments")).toBe(2);
  });

  it("6.7b samme nummer avvises også når det første oppdraget er slettet", async () => {
    const org = await createOrganization();
    const office = await createOffice(org.id);
    await createAssignment(org.id, {
      officeId: office.id,
      number: "2026-00001",
      deletedAt: new Date(),
    });
    await expectConstraint(
      insertAssignment({ organizationId: org.id, officeId: office.id, number: "2026-00001" }),
      "assignments_organization_id_number_idx",
    );
  });
});

describe("ukjente koder (6.8)", () => {
  it("source = fax avvises", async () => {
    const org = await createOrganization();
    await expectConstraint(
      insertOrder({ organizationId: org.id, source: "fax" }),
      "orders_source_check",
    );
  });

  it("source = email godtas (kroken for e-post-til-ordre)", async () => {
    const org = await createOrganization();
    await insertOrder({ organizationId: org.id, source: "email" });
    expect(await count("orders")).toBe(1);
  });

  it("orders.status = lost avvises", async () => {
    const org = await createOrganization();
    await expectConstraint(
      insertOrder({ organizationId: org.id, status: "lost" }),
      "orders_status_check",
    );
  });

  it("requested_report_type = valuation avvises", async () => {
    const org = await createOrganization();
    await expectConstraint(
      db.execute(sql`
        insert into orders (organization_id, address_text, requested_report_type)
        values (${org.id}, ${ADDRESS}, 'valuation')`),
      "orders_requested_report_type_check",
    );
  });

  it("assignment_type = valuation avvises", async () => {
    const org = await createOrganization();
    const office = await createOffice(org.id);
    await expectConstraint(
      insertAssignment({
        organizationId: org.id,
        officeId: office.id,
        number: "2026-00001",
        assignmentType: "valuation",
      }),
      "assignments_assignment_type_check",
    );
  });

  it("assignments.status = cancelled avvises", async () => {
    const org = await createOrganization();
    const office = await createOffice(org.id);
    await expectConstraint(
      insertAssignment({
        organizationId: org.id,
        officeId: office.id,
        number: "2026-00001",
        status: "cancelled",
      }),
      "assignments_status_check",
    );
  });

  it("scope = invoice avvises", async () => {
    const org = await createOrganization();
    await expectConstraint(
      insertSequence({ organizationId: org.id, scope: "invoice" }),
      "number_sequences_scope_check",
    );
    expect(await count("number_sequences")).toBe(0);
  });
});

describe("events.assignment_id (6.9, A33)", () => {
  it("hendelse med oppdrag fra en annen organisasjon avvises", async () => {
    const { orgA, orgB } = await twoOrganizations();
    const assignmentB = await createAssignment(orgB.id);
    await expectConstraint(
      db.execute(sql`
        insert into events (organization_id, type, actor_type, assignment_id, data)
        values (${orgA.id}, 'assignment.created', 'system', ${assignmentB.id}, '{}'::jsonb)`),
      "events_assignment_fk",
    );
    expect(await count("events")).toBe(0);
  });

  it("hendelse med ukjent oppdrag avvises", async () => {
    const org = await createOrganization();
    await expectConstraint(
      db.execute(sql`
        insert into events (organization_id, type, actor_type, assignment_id, data)
        values (${org.id}, 'assignment.created', 'system', ${randomUUID()}, '{}'::jsonb)`),
      "events_assignment_fk",
    );
  });

  it("hendelse med oppdrag i samme organisasjon og hendelse uten oppdrag godtas", async () => {
    const org = await createOrganization();
    const assignment = await createAssignment(org.id);
    await db.execute(sql`
      insert into events (organization_id, type, actor_type, assignment_id, data)
      values (${org.id}, 'assignment.created', 'system', ${assignment.id}, '{}'::jsonb)`);
    await db.execute(sql`
      insert into events (organization_id, type, actor_type, assignment_id, data)
      values (${org.id}, 'order.received', 'system', null, '{}'::jsonb)`);
    expect(await count("events")).toBe(2);
  });
});

describe("number_sequences i databasen (6.10)", () => {
  it("to serier med samme (organization_id, scope, prefix) avvises; annet år eller annen organisasjon godtas", async () => {
    const { orgA, orgB } = await twoOrganizations();
    await createNumberSequence(orgA.id);
    await expectConstraint(
      insertSequence({ organizationId: orgA.id }),
      "number_sequences_organization_id_scope_prefix_idx",
    );
    await insertSequence({ organizationId: orgA.id, prefix: "2027-" });
    await insertSequence({ organizationId: orgB.id });
    expect(await count("number_sequences")).toBe(3);
  });

  it("next_value = 0 avvises (CHECK >= 1)", async () => {
    const org = await createOrganization();
    await expectConstraint(
      insertSequence({ organizationId: org.id, nextValue: 0 }),
      "number_sequences_next_value_check",
    );
    const sequence = await createNumberSequence(org.id);
    await expectConstraint(
      db.execute(sql`update number_sequences set next_value = 0 where id = ${sequence.id}`),
      "number_sequences_next_value_check",
    );
  });
});
