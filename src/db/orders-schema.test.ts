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
import { tenantTables } from "../../tests/tenant-tables";

/*
 * Databasen selv avviser ugyldige ordre, oppdrag og nummerserier
 * (docs/funksjoner/fase2a-manuell-ordre-testplan.md avsnitt 6). Direkte innsetting med SQL,
 * utenom kjernen, så det er skrankene i databasen som prøves. Feilkoden sjekkes, så en
 * skrivefeil i et kolonnenavn ikke gir en falsk grønn test.
 *
 * Støtter hovedmål: reklamasjoner (en ordre kan aldri peke på et oppdrag i en annen
 * organisasjon, og to oppdrag kan aldri få samme nummer). Testdata er oppdiktet.
 */

beforeEach(resetDatabase);

const CHECK = "23514";
const FOREIGN_KEY = "23503";
const UNIQUE = "23505";

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

function insertOrderSql(values: {
  organizationId: string;
  status?: string;
  source?: string;
  rejectedReason?: string | null;
  assignmentId?: string | null;
  requestedReportType?: string;
}) {
  return db.execute(sql`
    insert into orders (
      organization_id, received_at, source, address_text, requested_report_type,
      seller_declaration_received, status, rejected_reason, assignment_id
    ) values (
      ${values.organizationId}, now(), ${values.source ?? "manual"}, 'Testveien 12, 8000 Bodø',
      ${values.requestedReportType ?? "condition_report"}, false, ${values.status ?? "received"},
      ${values.rejectedReason ?? null}, ${values.assignmentId ?? null}
    )`);
}

function insertAssignmentSql(values: {
  organizationId: string;
  officeId: string;
  number?: string;
  orderId?: string | null;
  assignmentType?: string;
  status?: string;
}) {
  return db.execute(sql`
    insert into assignments (organization_id, number, office_id, order_id, assignment_type, status)
    values (
      ${values.organizationId}, ${values.number ?? `TEST-${randomUUID().slice(0, 8)}`},
      ${values.officeId}, ${values.orderId ?? null},
      ${values.assignmentType ?? "condition_report"}, ${values.status ?? "ordered"}
    )`);
}

function insertSequenceSql(values: {
  organizationId: string;
  scope?: string;
  prefix?: string;
  nextValue?: number;
}) {
  return db.execute(sql`
    insert into number_sequences (organization_id, scope, prefix, next_value, padding)
    values (
      ${values.organizationId}, ${values.scope ?? "assignment"}, ${values.prefix ?? "2026-"},
      ${values.nextValue ?? 1}, 5
    )`);
}

async function twoOrgs() {
  const orgA = await createOrganization("Organisasjon A");
  const orgB = await createOrganization("Organisasjon B");
  return { orgA, orgB };
}

describe("orders i databasen", () => {
  it("godtar en gyldig mottatt ordre (kontroll av hjelperen)", async () => {
    const { orgA } = await twoOrgs();
    await insertOrderSql({ organizationId: orgA.id });
  });

  it("6.1 avvist uten grunn avvises (CHECK)", async () => {
    const { orgA } = await twoOrgs();
    await expectPgError(insertOrderSql({ organizationId: orgA.id, status: "rejected" }), CHECK);
  });

  it("6.2 gjort om uten assignment_id avvises (CHECK)", async () => {
    const { orgA } = await twoOrgs();
    await expectPgError(insertOrderSql({ organizationId: orgA.id, status: "converted" }), CHECK);
  });

  it("6.3 assignment_id på en mottatt ordre avvises (CHECK)", async () => {
    const { orgA } = await twoOrgs();
    const assignment = await createAssignment(orgA.id);
    await expectPgError(
      insertOrderSql({ organizationId: orgA.id, status: "received", assignmentId: assignment.id }),
      CHECK,
    );
  });

  it("6.4 avvist med assignment_id avvises (CHECK)", async () => {
    const { orgA } = await twoOrgs();
    const assignment = await createAssignment(orgA.id);
    await expectPgError(
      insertOrderSql({
        organizationId: orgA.id,
        status: "rejected",
        rejectedReason: "Feil registrering",
        assignmentId: assignment.id,
      }),
      CHECK,
    );
  });

  it("6.2 gjort om med oppdrag i egen organisasjon godtas", async () => {
    const { orgA } = await twoOrgs();
    const assignment = await createAssignment(orgA.id);
    await insertOrderSql({
      organizationId: orgA.id,
      status: "converted",
      assignmentId: assignment.id,
    });
  });

  it("6.5 ordre som peker på oppdrag i en annen organisasjon avvises (sammensatt fremmednøkkel)", async () => {
    const { orgA, orgB } = await twoOrgs();
    const assignmentB = await createAssignment(orgB.id);
    await expectPgError(
      insertOrderSql({
        organizationId: orgA.id,
        status: "converted",
        assignmentId: assignmentB.id,
      }),
      FOREIGN_KEY,
    );
  });
});

describe("assignments i databasen", () => {
  it("6.6 oppdrag med kontor fra en annen organisasjon avvises", async () => {
    const { orgA, orgB } = await twoOrgs();
    const officeB = await createOffice(orgB.id);
    await expectPgError(
      insertAssignmentSql({ organizationId: orgA.id, officeId: officeB.id }),
      FOREIGN_KEY,
    );
  });

  it("6.6 oppdrag med ordre fra en annen organisasjon avvises", async () => {
    const { orgA, orgB } = await twoOrgs();
    const officeA = await createOffice(orgA.id);
    const orderB = await createOrder(orgB.id);
    await expectPgError(
      insertAssignmentSql({ organizationId: orgA.id, officeId: officeA.id, orderId: orderB.id }),
      FOREIGN_KEY,
    );
  });

  it("6.7 to oppdrag med samme nummer i samme organisasjon avvises; i to organisasjoner godtas", async () => {
    const { orgA, orgB } = await twoOrgs();
    const officeA = await createOffice(orgA.id);
    const officeB = await createOffice(orgB.id);
    await insertAssignmentSql({
      organizationId: orgA.id,
      officeId: officeA.id,
      number: "2026-00001",
    });
    await expectPgError(
      insertAssignmentSql({ organizationId: orgA.id, officeId: officeA.id, number: "2026-00001" }),
      UNIQUE,
    );
    await insertAssignmentSql({
      organizationId: orgB.id,
      officeId: officeB.id,
      number: "2026-00001",
    });
  });
});

describe("ukjente koder (6.8)", () => {
  it("source = fax avvises", async () => {
    const { orgA } = await twoOrgs();
    await expectPgError(insertOrderSql({ organizationId: orgA.id, source: "fax" }), CHECK);
  });

  it("source = email godtas (kroken for KI, finnes i listen)", async () => {
    const { orgA } = await twoOrgs();
    await insertOrderSql({ organizationId: orgA.id, source: "email" });
  });

  it("ordrestatus = lost avvises", async () => {
    const { orgA } = await twoOrgs();
    await expectPgError(insertOrderSql({ organizationId: orgA.id, status: "lost" }), CHECK);
  });

  it("requested_report_type = valuation avvises", async () => {
    const { orgA } = await twoOrgs();
    await expectPgError(
      insertOrderSql({ organizationId: orgA.id, requestedReportType: "valuation" }),
      CHECK,
    );
  });

  it("assignment_type = valuation avvises", async () => {
    const { orgA } = await twoOrgs();
    const office = await createOffice(orgA.id);
    await expectPgError(
      insertAssignmentSql({
        organizationId: orgA.id,
        officeId: office.id,
        assignmentType: "valuation",
      }),
      CHECK,
    );
  });

  it("oppdragsstatus = cancelled avvises, de fire fra 27.10.2026 godtas", async () => {
    const { orgA } = await twoOrgs();
    const office = await createOffice(orgA.id);
    await expectPgError(
      insertAssignmentSql({ organizationId: orgA.id, officeId: office.id, status: "cancelled" }),
      CHECK,
    );
    for (const status of ["ordered", "in_progress", "completed", "invoiced"]) {
      await insertAssignmentSql({ organizationId: orgA.id, officeId: office.id, status });
    }
  });

  it("scope = invoice avvises", async () => {
    const { orgA } = await twoOrgs();
    await expectPgError(insertSequenceSql({ organizationId: orgA.id, scope: "invoice" }), CHECK);
  });
});

describe("events.assignment_id (6.9, A33)", () => {
  it("hendelse med oppdrag fra en annen organisasjon avvises", async () => {
    const { orgA, orgB } = await twoOrgs();
    const assignmentB = await createAssignment(orgB.id);
    await expectPgError(
      db.execute(sql`
        insert into events (organization_id, type, assignment_id, actor_type, data)
        values (${orgA.id}, 'assignment.created', ${assignmentB.id}, 'system', '{}'::jsonb)`),
      FOREIGN_KEY,
    );
  });

  it("hendelse med oppdrag i egen organisasjon og hendelse uten oppdrag godtas", async () => {
    const { orgA } = await twoOrgs();
    const assignment = await createAssignment(orgA.id);
    await db.execute(sql`
      insert into events (organization_id, type, assignment_id, actor_type, data)
      values (${orgA.id}, 'assignment.created', ${assignment.id}, 'system', '{}'::jsonb)`);
    await db.execute(sql`
      insert into events (organization_id, type, assignment_id, actor_type, data)
      values (${orgA.id}, 'order.received', null, 'system', '{}'::jsonb)`);
  });

  it("hendelse med et oppdrag som ikke finnes avvises", async () => {
    const { orgA } = await twoOrgs();
    await expectPgError(
      db.execute(sql`
        insert into events (organization_id, type, assignment_id, actor_type, data)
        values (${orgA.id}, 'assignment.created', ${randomUUID()}, 'system', '{}'::jsonb)`),
      FOREIGN_KEY,
    );
  });
});

describe("number_sequences i databasen (6.10)", () => {
  it("to serier med samme organisasjon, scope og prefiks avvises; annet prefiks og annen organisasjon godtas", async () => {
    const { orgA, orgB } = await twoOrgs();
    await insertSequenceSql({ organizationId: orgA.id });
    await expectPgError(insertSequenceSql({ organizationId: orgA.id }), UNIQUE);
    await insertSequenceSql({ organizationId: orgA.id, prefix: "2027-" });
    await insertSequenceSql({ organizationId: orgB.id });
  });

  it("next_value = 0 avvises (CHECK >= 1)", async () => {
    const { orgA } = await twoOrgs();
    await expectPgError(insertSequenceSql({ organizationId: orgA.id, nextValue: 0 }), CHECK);
  });

  it("fabrikken lager en gyldig serie (kontroll)", async () => {
    const { orgA } = await twoOrgs();
    await createNumberSequence(orgA.id);
  });
});

describe("registeret og migreringen (6.11)", () => {
  it("de tre nye tabellene har organization_id og står i tests/tenant-tables.ts med riktig testfil", async () => {
    const result = await db.execute<{ table_name: string }>(sql`
      select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'organization_id'`);
    const tables = new Set(result.map((row) => row.table_name));
    const expected = {
      orders: "src/core/orders/orders.test.ts",
      assignments: "src/core/orders/orders.test.ts",
      number_sequences: "src/core/assignments/number-sequence.test.ts",
    } as const;
    for (const [table, testFile] of Object.entries(expected)) {
      expect(tables.has(table), `${table} har organization_id`).toBe(true);
      const entry = tenantTables.find((candidate) => candidate.table === table);
      expect(entry?.testFile, `${table} i tenant-registeret`).toBe(testFile);
    }
  });

  it("orders og assignments har unik indeks på (organization_id, id), og assignments på (organization_id, number)", async () => {
    const result = await db.execute<{ tablename: string; indexdef: string }>(sql`
      select tablename, indexdef from pg_indexes
      where schemaname = 'public' and tablename in ('orders', 'assignments')`);
    const unique = result
      .filter((row) => row.indexdef.toLowerCase().includes("unique"))
      .map((row) => `${row.tablename}:${row.indexdef.replace(/\s+/g, " ").toLowerCase()}`);
    expect(
      unique.some((def) => def.startsWith("orders:") && def.includes("(organization_id, id)")),
    ).toBe(true);
    expect(
      unique.some((def) => def.startsWith("assignments:") && def.includes("(organization_id, id)")),
    ).toBe(true);
    expect(
      unique.some(
        (def) => def.startsWith("assignments:") && def.includes("(organization_id, number)"),
      ),
    ).toBe(true);
  });
});
