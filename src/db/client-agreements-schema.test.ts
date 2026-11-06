import { existsSync, readdirSync } from "node:fs";
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
 * Databasen selv stopper feil periode og fremmede id-er for avtale med oppdragsgiver.
 * Testplan: docs/funksjoner/fase2a-oppdragsgiveravtale-testplan.md avsnitt 3.
 *
 * Direkte innsetting med SQL, utenom kjernen og Zod, så det er skrankene i databasen som prøves.
 * Feilkoden og navnet på skranken sjekkes, så en skrivefeil i et kolonnenavn ikke gir falsk grønn.
 *
 * Støtter hovedmål: reklamasjoner (en avtale eller et oppdrag kan aldri peke på data i en annen
 * organisasjon, og perioden kan aldri slutte før den starter). Testdata er oppdiktet.
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
      const constraint =
        (current as { constraint_name?: unknown }).constraint_name ??
        (current as { constraint?: unknown }).constraint;
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

function insertAgreementSql(values: {
  organizationId: string;
  firmId: string | null;
  name?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
}) {
  return db.execute(sql`
    insert into client_agreements (organization_id, firm_id, name, valid_from, valid_to)
    values (${values.organizationId}, ${values.firmId},
      ${values.name === undefined ? "Testavtale forsikring" : values.name},
      ${values.validFrom === undefined ? "2026-03-01" : values.validFrom}::date,
      ${values.validTo ?? null}::date)
    returning id`);
}

describe("3. client_agreements i databasen", () => {
  it.each([
    { name: "til-dato dagen før fra-dato avvises", validTo: "2026-02-28", ok: false },
    { name: "lik dag godtas", validTo: "2026-03-01", ok: true },
    { name: "tom til-dato godtas", validTo: null, ok: true },
  ])("3.1 CHECK uten Zod: $name", async ({ validTo, ok }) => {
    const org = await createOrganization();
    const firm = await createFirm(org.id);
    const run = insertAgreementSql({
      organizationId: org.id,
      firmId: firm.id,
      validFrom: "2026-03-01",
      validTo,
    });
    if (ok) await expect(run).resolves.toBeDefined();
    else await expectPgError(run, CHECK);
  });

  it("3.2 firm_id fra en annen organisasjon avvises av den sammensatte fremmednøkkelen", async () => {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const firmB = await createFirm(orgB.id);
    await expectPgError(insertAgreementSql({ organizationId: orgA.id, firmId: firmB.id }), FOREIGN_KEY);
  });

  it("3.3 assignments.client_agreement_id fra en annen organisasjon avvises (assignments_client_agreement_fk)", async () => {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const assignmentA = await createAssignment(orgA.id);
    const agreementB = await createClientAgreement(orgB.id);
    const agreementA = await createClientAgreement(orgA.id);

    await expectPgError(
      db.execute(
        sql`update assignments set client_agreement_id = ${agreementB.id} where id = ${assignmentA.id}`,
      ),
      FOREIGN_KEY,
      "assignments_client_agreement_fk",
    );
    // Egen organisasjon går
    await db.execute(
      sql`update assignments set client_agreement_id = ${agreementA.id} where id = ${assignmentA.id}`,
    );
    const [row] = (await db.execute(
      sql`select client_agreement_id from assignments where id = ${assignmentA.id}`,
    )) as unknown as { client_agreement_id: string }[];
    expect(row?.client_agreement_id).toBe(agreementA.id);
  });

  it.each([
    { field: "name", values: { name: null } },
    { field: "valid_from", values: { validFrom: null } },
    { field: "firm_id", values: { firmId: null } },
  ])("3.4 $field kan ikke være null", async ({ values }) => {
    const org = await createOrganization();
    const firm = await createFirm(org.id);
    await expectPgError(
      insertAgreementSql({ organizationId: org.id, firmId: firm.id, ...values }),
      NOT_NULL,
    );
  });

  it("3.5 indeksene finnes: unik (organization_id, id) og delvis (organization_id, firm_id)", async () => {
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
    expect(entry, "client_agreements i tests/tenant-tables.ts").toBeDefined();
    expect(entry!.testFile).toBe("src/core/agreements/agreements.test.ts");
    const org = await createOrganization();
    const id = await entry!.insertRow(org.id);
    const [row] = (await db.execute(
      sql`select organization_id from client_agreements where id = ${id}`,
    )) as unknown as { organization_id: string }[];
    expect(row?.organization_id).toBe(org.id);
  });

  it("3.7 migreringen heter 0021_oppdragsgiveravtale.sql", () => {
    const dir = path.join(process.cwd(), "src/db/migrations");
    expect(existsSync(path.join(dir, "0021_oppdragsgiveravtale.sql"))).toBe(true);
    expect(readdirSync(dir).filter((file) => file.startsWith("0021_"))).toEqual([
      "0021_oppdragsgiveravtale.sql",
    ]);
  });
});
