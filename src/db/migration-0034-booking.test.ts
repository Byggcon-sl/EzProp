import { randomBytes, randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS_FOLDER, runMigrations } from "./run-migrations";

/*
 * Migreringen 0034: oppdraget eier bestillingsopplysningene (ADR 0011). Testplan for «Nytt
 * oppdrag» 3.2. Lager en egen tom database (`ezprop_mig_<tilfeldig>`), kjører migreringene til og
 * med 0033 fra en kopi av mappen med kuttet journal, setter inn rader med rå SQL slik de kan se ut
 * i drift i dag, og kjører så hele mappen. Databasen og kopien slettes i `afterAll`.
 *
 * Alle data er oppdiktet («Testveien», «Prøvegata», gnr 9001).
 *
 * Støtter hovedmål: færre reklamasjoner og de ansatte (ekte oppdrag beholder adressen og
 * bestilleren når oppdraget blir eier av bestillingen; stopper migreringen, er ingenting endret).
 */

type Sql = ReturnType<typeof postgres>;

/** Testdatabasen (oppsettet i tests/setup-env.ts peker DATABASE_URL hit). */
function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL mangler (se .env.example)");
  return url;
}

const DB_NAME = `ezprop_mig_${randomBytes(6).toString("hex")}`;
const MIGRATED_THROUGH = "0033_indekser-mulig-dublett";

function urlFor(database: string): string {
  const url = new URL(testDatabaseUrl());
  url.pathname = `/${database}`;
  return url.toString();
}

let admin: Sql;
let target: Sql;
let partialFolder: string;

/** Id-ene til radene som settes inn før migreringen. */
const ids = {
  orgA: randomUUID(),
  orgB: randomUUID(),
  officeA: randomUUID(),
  officeB: randomUUID(),
  contactA: randomUUID(),
  firmA: randomUUID(),
  // 3.2.1: ordren peker på oppdraget (orders.assignment_id), oppdraget har ikke order_id
  a1: randomUUID(),
  o1: randomUUID(),
  // 3.2.2: oppdraget peker på ordren (assignments.order_id)
  a2: randomUUID(),
  o2: randomUUID(),
  // 3.2.3: to ordre, den eldste slettet mykt; den som ikke er slettet brukes
  a3: randomUUID(),
  o3Deleted: randomUUID(),
  o3Live: randomUUID(),
  // 3.2.3: to ordre som ikke er slettet; den eldste brukes
  a3b: randomUUID(),
  o3bOld: randomUUID(),
  o3bNew: randomUUID(),
  // 3.2.4: uten ordre, med eiendom
  a4: randomUUID(),
  p4: randomUUID(),
  // 3.2.5: uten ordre og uten eiendom (stopper migreringen)
  a5: randomUUID(),
  p5: randomUUID(),
  // 3.2.7: ordre i B som feilaktig peker på oppdraget i A
  a7: randomUUID(),
  p7: randomUUID(),
  o7B: randomUUID(),
};

const T = {
  o1: "2026-09-01T08:00:00.000Z",
  o2: "2026-09-02T08:00:00.000Z",
  o3Deleted: "2026-08-01T08:00:00.000Z",
  o3Live: "2026-08-15T08:00:00.000Z",
  o3bOld: "2026-07-01T08:00:00.000Z",
  o3bNew: "2026-07-20T08:00:00.000Z",
  a4Created: "2026-06-10T09:30:00.000Z",
  a1Updated: "2026-10-01T12:00:00.000Z",
};

type AssignmentAfter = {
  id: string;
  address_text: string;
  gnr: string | null;
  bnr: string | null;
  snr: string | null;
  ordered_by_text: string | null;
  ordered_by_contact_id: string | null;
  ordered_by_firm_id: string | null;
  external_ref: string | null;
  housing_association_name: string | null;
  seller_declaration_received: boolean;
  received_at: Date;
  source: string;
  row_version: number;
  updated_at: Date;
  created_at: Date;
};

/** Resultatet av første kjøring (som skal stoppe) og tilstanden rett etter. */
let failure: unknown;
let columnsAfterFailure: string[] = [];
let journalAfterFailure: string[] = [];
let rowsBeforeFailure: unknown[] = [];
let rowsAfterFailure: unknown[] = [];
/** Resultatet av andre og tredje kjøring. */
let secondRunError: unknown;
let thirdRunError: unknown;
let journalAfterThird: string[] = [];
let after = new Map<string, AssignmentAfter>();

async function assignmentColumns(sql: Sql): Promise<string[]> {
  const rows = await sql<{ column_name: string }[]>`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'assignments' order by column_name`;
  return rows.map((row) => row.column_name);
}

async function journal(sql: Sql): Promise<string[]> {
  const rows = await sql<{ hash: string }[]>`
    select hash from drizzle.__drizzle_migrations order by id`;
  return rows.map((row) => row.hash);
}

async function rawAssignments(sql: Sql): Promise<unknown[]> {
  return [...(await sql`select * from assignments order by id`)];
}

async function seedBeforeMigration(sql: Sql) {
  await sql`insert into organizations (id, name, brand_name) values
    (${ids.orgA}, 'Oppdiktet migrering A', 'Oppdiktet migrering A'),
    (${ids.orgB}, 'Oppdiktet migrering B', 'Oppdiktet migrering B')`;
  await sql`insert into offices (id, organization_id, name) values
    (${ids.officeA}, ${ids.orgA}, 'Bodø'), (${ids.officeB}, ${ids.orgB}, 'Bodø')`;
  await sql`insert into firms (id, organization_id, name) values
    (${ids.firmA}, ${ids.orgA}, 'Testmegling AS')`;
  await sql`insert into contacts (id, organization_id, first_name, last_name, firm_id) values
    (${ids.contactA}, ${ids.orgA}, 'Test', 'Megler', ${ids.firmA})`;

  // 3.2.1 ordren peker på oppdraget
  await sql`insert into assignments (id, organization_id, number, office_id, assignment_type,
      status, row_version, updated_at)
    values (${ids.a1}, ${ids.orgA}, 'MIG-001', ${ids.officeA}, 'condition_report', 'in_progress',
      7, ${T.a1Updated})`;
  await sql`insert into orders (id, organization_id, received_at, source, external_ref,
      ordered_by_text, ordered_by_contact_id, ordered_by_firm_id, address_text, gnr, bnr, snr,
      housing_association_name, seller_declaration_received, status, assignment_id)
    values (${ids.o1}, ${ids.orgA}, ${T.o1}, 'email', 'REF-9001', 'Test Megler fritekst',
      ${ids.contactA}, ${ids.firmA}, 'Testveien 12, 8000 Bodø', '9001', '1', '2',
      'Prøvetunet Borettslag', true, 'converted', ${ids.a1})`;

  // 3.2.2 oppdraget peker på ordren (ordren har ikke assignment_id, så den står som mottatt)
  await sql`insert into orders (id, organization_id, received_at, address_text, gnr, bnr,
      ordered_by_text, status)
    values (${ids.o2}, ${ids.orgA}, ${T.o2}, 'Prøvegata 3, 8006 Bodø', '9001', '2',
      'Annen Bestiller', 'received')`;
  await sql`insert into assignments (id, organization_id, number, office_id, assignment_type,
      status, order_id)
    values (${ids.a2}, ${ids.orgA}, 'MIG-002', ${ids.officeA}, 'condition_report', 'ordered',
      ${ids.o2})`;

  // 3.2.3 to ordre på samme oppdrag, den eldste slettet mykt
  await sql`insert into assignments (id, organization_id, number, office_id, assignment_type,
      status)
    values (${ids.a3}, ${ids.orgA}, 'MIG-003', ${ids.officeA}, 'condition_report', 'ordered'),
      (${ids.a3b}, ${ids.orgA}, 'MIG-003B', ${ids.officeA}, 'condition_report', 'ordered')`;
  await sql`insert into orders (id, organization_id, received_at, address_text, status,
      assignment_id, deleted_at)
    values
      (${ids.o3Deleted}, ${ids.orgA}, ${T.o3Deleted}, 'Slettetveien 1', 'converted', ${ids.a3},
        now()),
      (${ids.o3Live}, ${ids.orgA}, ${T.o3Live}, 'Levendeveien 2', 'converted', ${ids.a3}, null),
      (${ids.o3bOld}, ${ids.orgA}, ${T.o3bOld}, 'Eldsteveien 3', 'converted', ${ids.a3b}, null),
      (${ids.o3bNew}, ${ids.orgA}, ${T.o3bNew}, 'Nyesteveien 4', 'converted', ${ids.a3b}, null)`;

  // 3.2.4 uten ordre, med eiendom
  await sql`insert into properties (id, organization_id, address, postal_code, city,
      housing_type, ownership_form)
    values (${ids.p4}, ${ids.orgA}, ' Eiendomsveien 4 ', '8000', 'Bodø', 'detached', 'freehold')`;
  await sql`insert into assignments (id, organization_id, number, office_id, assignment_type,
      status, property_id, created_at)
    values (${ids.a4}, ${ids.orgA}, 'MIG-004', ${ids.officeA}, 'condition_report', 'completed',
      ${ids.p4}, ${T.a4Created})`;

  // 3.2.5 uten ordre og uten eiendom
  await sql`insert into assignments (id, organization_id, number, office_id, assignment_type,
      status)
    values (${ids.a5}, ${ids.orgA}, 'MIG-005', ${ids.officeA}, 'condition_report', 'ordered')`;

  // 3.2.7 oppdrag i A med eiendom, og en ordre i B som feilaktig peker på det. Den sammensatte
  // fremmednøkkelen stopper dette i dag, så den tas bort i denne prøvedatabasen for å etterligne
  // en feil rad.
  await sql`insert into properties (id, organization_id, address, postal_code, city,
      housing_type, ownership_form)
    values (${ids.p7}, ${ids.orgA}, 'Egenveien 7', '8000', 'Bodø', 'apartment', 'section')`;
  await sql`insert into assignments (id, organization_id, number, office_id, assignment_type,
      status, property_id)
    values (${ids.a7}, ${ids.orgA}, 'MIG-007', ${ids.officeA}, 'condition_report', 'ordered',
      ${ids.p7})`;
  await sql`alter table orders drop constraint orders_assignment_fk`;
  await sql`insert into orders (id, organization_id, received_at, address_text, gnr, bnr,
      ordered_by_text, status, assignment_id)
    values (${ids.o7B}, ${ids.orgB}, '2026-05-05T05:05:00Z', 'Fremmedveien 99, 9000 Tromsø', '8888',
      '8', 'Fremmed Bestiller', 'converted', ${ids.a7})`;
}

beforeAll(async () => {
  admin = postgres(testDatabaseUrl(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database "${DB_NAME}"`);
  target = postgres(urlFor(DB_NAME), { max: 1, onnotice: () => {} });

  // Kopi av mappen der journalen slutter med 0033
  partialFolder = mkdtempSync(join(tmpdir(), "ezprop-mig-0034-"));
  cpSync(MIGRATIONS_FOLDER, partialFolder, { recursive: true });
  const journalPath = join(partialFolder, "meta", "_journal.json");
  const journalJson = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: { tag: string }[];
  };
  const cut = journalJson.entries.findIndex((entry) => entry.tag === MIGRATED_THROUGH);
  if (cut < 0) throw new Error(`Fant ikke ${MIGRATED_THROUGH} i journalen`);
  journalJson.entries = journalJson.entries.slice(0, cut + 1);
  writeFileSync(journalPath, JSON.stringify(journalJson));

  await runMigrations(urlFor(DB_NAME), partialFolder);
  await seedBeforeMigration(target);

  // (1) Første kjøring stopper på oppdraget uten ordre og eiendom
  rowsBeforeFailure = await rawAssignments(target);
  failure = await runMigrations(urlFor(DB_NAME)).then(
    () => null,
    (error: unknown) => error,
  );
  columnsAfterFailure = await assignmentColumns(target);
  journalAfterFailure = await journal(target);
  rowsAfterFailure = await rawAssignments(target);

  // (2) Eiendom legges inn, og migreringen går gjennom
  await target`insert into properties (id, organization_id, address, postal_code, city,
      housing_type, ownership_form)
    values (${ids.p5}, ${ids.orgA}, 'Rettetveien 5', '8000', 'Bodø', 'detached', 'freehold')`;
  await target`update assignments set property_id = ${ids.p5} where id = ${ids.a5}`;
  secondRunError = await runMigrations(urlFor(DB_NAME)).then(
    () => null,
    (error: unknown) => error,
  );

  // (3) Tredje kjøring gjør ingenting
  thirdRunError = await runMigrations(urlFor(DB_NAME)).then(
    () => null,
    (error: unknown) => error,
  );
  journalAfterThird = await journal(target);

  const rows = await target<AssignmentAfter[]>`
    select id, address_text, gnr, bnr, snr, ordered_by_text, ordered_by_contact_id,
      ordered_by_firm_id, external_ref, housing_association_name, seller_declaration_received,
      received_at, source, row_version, updated_at, created_at
    from assignments`;
  after = new Map(rows.map((row) => [row.id, row]));
}, 120_000);

afterAll(async () => {
  await target?.end();
  if (admin) {
    await admin.unsafe(`drop database if exists "${DB_NAME}" with (force)`);
    await admin.end();
  }
  if (partialFolder) rmSync(partialFolder, { recursive: true, force: true });
});

function errorText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (current instanceof Error) parts.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join("\n");
}

function row(id: string): AssignmentAfter {
  const found = after.get(id);
  if (!found) throw new Error("Fant ikke oppdraget etter migreringen");
  return found;
}

describe("3.2 migreringen 0034", () => {
  it("3.2.5 oppdrag uten ordre og eiendom: stopper med antallet, uten adresse eller id", () => {
    expect(failure).toBeInstanceOf(Error);
    const text = errorText(failure);
    expect(text).toContain("Migrering 0034 stoppet: 1 oppdrag");
    for (const leak of [ids.a5, "MIG-005", "Testveien", "Prøvegata", ids.orgA]) {
      expect(text).not.toContain(leak);
    }
  });

  it("3.2.5 ingenting er endret når den stopper: ingen nye kolonner, journalen uten 0034, radene like", () => {
    expect(columnsAfterFailure).not.toContain("address_text");
    expect(columnsAfterFailure).not.toContain("received_at");
    expect(columnsAfterFailure).not.toContain("creation_key");
    expect(journalAfterFailure).toHaveLength(34);
    expect(rowsAfterFailure).toEqual(rowsBeforeFailure);
  });

  it("3.2.5 etter at eiendom er lagt inn, går migreringen gjennom", () => {
    expect(secondRunError).toBeNull();
    expect(row(ids.a5).address_text).toBe("Rettetveien 5, 8000 Bodø");
  });

  it("3.2.1 oppdrag med orders.assignment_id får alle bestillingsfeltene fra ordren", () => {
    expect(row(ids.a1)).toMatchObject({
      address_text: "Testveien 12, 8000 Bodø",
      gnr: "9001",
      bnr: "1",
      snr: "2",
      ordered_by_text: "Test Megler fritekst",
      ordered_by_contact_id: ids.contactA,
      ordered_by_firm_id: ids.firmA,
      external_ref: "REF-9001",
      housing_association_name: "Prøvetunet Borettslag",
      seller_declaration_received: true,
      source: "email",
    });
    expect(row(ids.a1).received_at.toISOString()).toBe(T.o1);
  });

  it("3.2.2 oppdrag med order_id får feltene fra ordren", () => {
    expect(row(ids.a2)).toMatchObject({
      address_text: "Prøvegata 3, 8006 Bodø",
      gnr: "9001",
      bnr: "2",
      snr: null,
      ordered_by_text: "Annen Bestiller",
      ordered_by_contact_id: null,
      source: "manual",
      seller_declaration_received: false,
    });
    expect(row(ids.a2).received_at.toISOString()).toBe(T.o2);
  });

  it("3.2.3 to ordre på samme oppdrag: ordren som ikke er slettet brukes, ellers den eldste", () => {
    expect(row(ids.a3).address_text).toBe("Levendeveien 2");
    expect(row(ids.a3).received_at.toISOString()).toBe(T.o3Live);
    expect(row(ids.a3b).address_text).toBe("Eldsteveien 3");
    expect(row(ids.a3b).received_at.toISOString()).toBe(T.o3bOld);
  });

  it("3.2.4 uten ordre, med eiendom: adressen fra eiendommen og mottatt = opprettet", () => {
    expect(row(ids.a4).address_text).toBe("Eiendomsveien 4, 8000 Bodø");
    expect(row(ids.a4).received_at.toISOString()).toBe(T.a4Created);
    expect(row(ids.a4).source).toBe("manual");
    expect(row(ids.a4).gnr).toBeNull();
  });

  it("3.2.6 row_version og updated_at er uendret", () => {
    expect(row(ids.a1).row_version).toBe(7);
    expect(row(ids.a1).updated_at.toISOString()).toBe(T.a1Updated);
    const before = (rowsBeforeFailure as { id: string; row_version: number; updated_at: Date }[])
      .map((r) => [r.id, r.row_version, r.updated_at.toISOString()])
      .sort();
    const now = [...after.values()]
      .filter((r) => r.id !== ids.a5)
      .map((r) => [r.id, r.row_version, r.updated_at.toISOString()])
      .sort();
    expect(now).toEqual(before.filter(([id]) => id !== ids.a5));
  });

  it("3.2.7 en ordre i B kopieres aldri til et oppdrag i A, selv med feil assignment_id", () => {
    const a7 = row(ids.a7);
    expect(a7.address_text).toBe("Egenveien 7, 8000 Bodø");
    expect(a7.gnr).toBeNull();
    expect(a7.ordered_by_text).toBeNull();
    expect(JSON.stringify(a7)).not.toContain("Fremmed");
  });

  it("3.2 alle oppdrag har adresse og mottatt, og kolonnene er påkrevd", async () => {
    const [nulls] = await target<{ n: number }[]>`
      select count(*)::int as n from assignments where address_text is null or received_at is null`;
    expect(nulls?.n).toBe(0);
    const columns = await target<{ column_name: string; is_nullable: string }[]>`
      select column_name, is_nullable from information_schema.columns
      where table_name = 'assignments' and column_name in ('address_text', 'received_at')`;
    expect(columns.map((c) => [c.column_name, c.is_nullable]).sort()).toEqual([
      ["address_text", "NO"],
      ["received_at", "NO"],
    ]);
  });

  it("3.2.8 kjører to ganger uten feil, og journalen har 0034 én gang", () => {
    expect(thirdRunError).toBeNull();
    expect(journalAfterThird).toHaveLength(35);
    expect(new Set(journalAfterThird).size).toBe(35);
  });
});
