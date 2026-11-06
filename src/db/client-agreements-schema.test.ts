import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import {
  createAssignment,
  createClientAgreement,
  createFirm,
  createOrganization,
  resetDatabase,
} from "../../tests/factories";
import { tenantTables } from "../../tests/tenant-tables";

/*
 * Databasen selv stopper feil periode og fremmede id-er for avtale med oppdragsgiver
 * (docs/funksjoner/fase2a-oppdragsgiveravtale-testplan.md avsnitt 3). Direkte innsetting med SQL,
 * utenom kjernen og Zod, så det er skrankene i databasen som prøves. Feilkoden sjekkes, så en
 * skrivefeil i et kolonnenavn ikke gir en falsk grønn test.
 *
 * Støtter hovedmål: reklamasjoner (et oppdrag kan aldri peke på en avtale, og en avtale aldri på
 * et firma, i en annen organisasjon). Testdata er oppdiktet.
 */

beforeEach(resetDatabase);

const CHECK = "23514";
const FOREIGN_KEY = "23503";
const NOT_NULL = "23502";

type PgError = { code?: string; constraint?: string };

/** Postgres-feilen (kode og skranke), også når Drizzle har pakket den inn. */
function pgError(error: unknown): PgError {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") {
      const named = current as { constraint_name?: unknown; constraint?: unknown };
      const constraint = named.constraint_name ?? named.constraint;
      return { code, constraint: typeof constraint === "string" ? constraint : undefined };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return {};
}

async function expectPgError(run: Promise<unknown>, code: string, constraint?: string) {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, "databasen skulle avvist raden").not.toBeNull();
  const found = pgError(error);
  expect(found.code, `feilkode (fikk ${String(error)})`).toBe(code);
  if (constraint) expect(found.constraint).toBe(constraint);
}

type AgreementSql = {
  organizationId: string;
  firmId: string | null;
  name?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
};

function insertAgreementSql(values: AgreementSql) {
  const name = values.name === undefined ? "Testavtale forsikring" : values.name;
  const validFrom = values.validFrom === undefined ? "2026-01-01" : values.validFrom;
  return db.execute(sql`
    insert into client_agreements (organization_id, firm_id, name, valid_from, valid_to)
    values (${values.organizationId}, ${values.firmId}, ${name}, ${validFrom}::date,
      ${values.validTo ?? null}::date)
    returning id`);
}

function setAssignmentAgreementSql(assignmentId: string, agreementId: string | null) {
  return db.execute(sql`
    update assignments set client_agreement_id = ${agreementId} where id = ${assignmentId}
    returning id, client_agreement_id`);
}

describe("3. client_agreements i databasen", () => {
  it("3.1 CHECK: valid_to før valid_from avvises uten Zod; lik dag og null godtas", async () => {
    const org = await createOrganization();
    const firm = await createFirm(org.id);
    await expectPgError(
      insertAgreementSql({
        organizationId: org.id,
        firmId: firm.id,
        validFrom: "2026-03-01",
        validTo: "2026-02-28",
      }),
      CHECK,
      "client_agreements_valid_range_check",
    );
    await expect(
      insertAgreementSql({
        organizationId: org.id,
        firmId: firm.id,
        validFrom: "2026-03-01",
        validTo: "2026-03-01",
      }),
    ).resolves.toHaveLength(1);
    await expect(
      insertAgreementSql({ organizationId: org.id, firmId: firm.id, validTo: null }),
    ).resolves.toHaveLength(1);
  });

  it("3.2 firm_id fra en annen organisasjon avvises av den sammensatte fremmednøkkelen", async () => {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const firmB = await createFirm(orgB.id, { name: "Testforsikring AS" });
    await expectPgError(
      insertAgreementSql({ organizationId: orgA.id, firmId: firmB.id }),
      FOREIGN_KEY,
    );
    // Kontroll: samme firma i egen organisasjon går
    await expect(
      insertAgreementSql({ organizationId: orgB.id, firmId: firmB.id }),
    ).resolves.toHaveLength(1);
  });

  it("3.3 assignments.client_agreement_id med avtale fra en annen organisasjon avvises (assignments_client_agreement_fk)", async () => {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const assignmentA = await createAssignment(orgA.id);
    const assignmentB = await createAssignment(orgB.id);
    const agreementA = await createClientAgreement(orgA.id);
    const agreementB = await createClientAgreement(orgB.id);

    await expectPgError(
      setAssignmentAgreementSql(assignmentA.id, agreementB.id),
      FOREIGN_KEY,
      "assignments_client_agreement_fk",
    );
    await expectPgError(
      setAssignmentAgreementSql(assignmentB.id, agreementA.id),
      FOREIGN_KEY,
      "assignments_client_agreement_fk",
    );

    // Kontroll: egen avtale går, og null (ingen avtale) går
    const [set] = await setAssignmentAgreementSql(assignmentA.id, agreementA.id);
    expect(set?.client_agreement_id).toBe(agreementA.id);
    const [cleared] = await setAssignmentAgreementSql(assignmentA.id, null);
    expect(cleared?.client_agreement_id).toBeNull();
  });

  it("3.3 et nytt oppdrag har ingen avtale (client_agreement_id er null)", async () => {
    const org = await createOrganization();
    const assignment = await createAssignment(org.id);
    const [row] = await db.execute<{ client_agreement_id: string | null }>(
      sql`select client_agreement_id from assignments where id = ${assignment.id}`,
    );
    expect(row?.client_agreement_id).toBeNull();
  });

  it.each([
    { column: "name", values: { name: null } },
    { column: "valid_from", values: { validFrom: null } },
    { column: "firm_id", values: { firmId: null } },
  ])("3.4 $column kan ikke være null", async ({ values }) => {
    const org = await createOrganization();
    const firm = await createFirm(org.id);
    await expectPgError(
      insertAgreementSql({ organizationId: org.id, firmId: firm.id, ...values }),
      NOT_NULL,
    );
  });

  it("3.5 indeksene finnes: unik (organization_id, id) og delvis (organization_id, firm_id) for ikke slettede", async () => {
    const result = await db.execute<{ indexname: string; indexdef: string }>(sql`
      select indexname, indexdef from pg_indexes
      where schemaname = 'public' and tablename = 'client_agreements'`);
    const defs = [...result].map((row) => row.indexdef.replace(/\s+/g, " ").toLowerCase());

    expect(
      defs.some((def) => def.includes("unique index") && def.includes("(organization_id, id)")),
      "unik indeks (organization_id, id)",
    ).toBe(true);
    const byFirm = defs.find((def) => def.includes("(organization_id, firm_id)"));
    expect(byFirm, "indeks (organization_id, firm_id)").toBeDefined();
    expect(byFirm!).toMatch(/where .*deleted_at is null/);
  });

  it("3.6 client_agreements står i tenant-registeret med radbygger og riktig testfil", async () => {
    const entry = tenantTables.find((candidate) => candidate.table === "client_agreements");
    expect(entry?.testFile).toBe("src/core/agreements/agreements.test.ts");
    const text = readFileSync(path.resolve(process.cwd(), entry!.testFile!), "utf8");
    expect(text).toContain("expectTenantIsolation(");

    const org = await createOrganization();
    const id = await entry!.insertRow(org.id);
    const [row] = await db.execute<{ organization_id: string }>(
      sql`select organization_id from client_agreements where id = ${id}`,
    );
    expect(row?.organization_id).toBe(org.id);
  });
});
