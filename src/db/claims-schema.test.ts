import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import {
  createAssignment,
  createAssignmentParty,
  createClaim,
  createOrganization,
  resetDatabase,
} from "../../tests/factories";
import { tenantTables } from "../../tests/tenant-tables";

/*
 * Databasen selv stopper reklamasjonssaker på fremmede oppdrag, ukjente koder og negative beløp
 * (docs/funksjoner/fase2a-reklamasjoner-testplan.md avsnitt 3). Direkte innsetting med SQL, utenom
 * kjernen og Zod, så det er skrankene i databasen som prøves. Feilkoden sjekkes, så en skrivefeil i
 * et kolonnenavn ikke gir en falsk grønn test.
 *
 * 3.2 (part fra annen organisasjon) prøves her bare hvis databasen har en sammensatt fremmednøkkel
 * for parten; ellers dekkes den av kjernen (claims.test.ts, 4.5.3), slik testplanen sier.
 *
 * Støtter hovedmål: reklamasjoner (en sak kan aldri peke på et oppdrag i en annen organisasjon,
 * og tallene i tabellen er alltid gyldige koder). Testdata er oppdiktet.
 */

beforeEach(resetDatabase);

const CHECK = "23514";
const FOREIGN_KEY = "23503";

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

async function expectPgError(run: Promise<unknown>, code: string) {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, "databasen skulle avvist raden").not.toBeNull();
  expect(pgError(error).code, `feilkode (fikk ${String(error)})`).toBe(code);
}

type ClaimSql = {
  organizationId: string;
  assignmentId: string;
  claimType?: string;
  outcome?: string;
  amount?: number | null;
  claimantPartyId?: string | null;
};

/** En sak satt inn med SQL. Uten `outcome` brukes standardverdien i databasen. */
function insertClaimSql(values: ClaimSql) {
  const outcome = values.outcome;
  return outcome === undefined
    ? db.execute(sql`
        insert into claims (organization_id, assignment_id, claim_type, received_at,
          claimant_text, description, created_by, amount, claimant_party_id)
        values (${values.organizationId}, ${values.assignmentId}, ${values.claimType ?? "complaint"},
          '2026-11-02'::date, 'Kjøper Test', 'Fukt i kjeller ikke nevnt', gen_random_uuid(),
          ${values.amount ?? null}::integer, ${values.claimantPartyId ?? null})
        returning id, outcome, closed_at, deleted_at`)
    : db.execute(sql`
        insert into claims (organization_id, assignment_id, claim_type, received_at,
          claimant_text, description, created_by, amount, outcome, claimant_party_id)
        values (${values.organizationId}, ${values.assignmentId}, ${values.claimType ?? "complaint"},
          '2026-11-02'::date, 'Kjøper Test', 'Fukt i kjeller ikke nevnt', gen_random_uuid(),
          ${values.amount ?? null}::integer, ${outcome}, ${values.claimantPartyId ?? null})
        returning id, outcome, closed_at, deleted_at`);
}

describe("3. databasen for claims", () => {
  it("3.1 sak med oppdrag fra en annen organisasjon avvises (sammensatt fremmednøkkel)", async () => {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const assignmentB = await createAssignment(orgB.id);
    await expectPgError(
      insertClaimSql({ organizationId: orgA.id, assignmentId: assignmentB.id }),
      FOREIGN_KEY,
    );
    // Kontroll: samme innsetting i riktig organisasjon går
    await expect(
      insertClaimSql({ organizationId: orgB.id, assignmentId: assignmentB.id }),
    ).resolves.toHaveLength(1);
  });

  it("3.2 part fra en annen organisasjon: avvises av databasen hvis fremmednøkkelen er sammensatt", async () => {
    const [fk] = await db.execute<{ columns: number }>(sql`
      select array_length(conkey, 1) as columns from pg_constraint
      where conrelid = 'claims'::regclass and contype = 'f'
        and confrelid = 'assignment_parties'::regclass`);
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const assignmentA = await createAssignment(orgA.id);
    const partyB = await createAssignmentParty(orgB.id);
    if (fk && Number(fk.columns) > 1) {
      await expectPgError(
        insertClaimSql({
          organizationId: orgA.id,
          assignmentId: assignmentA.id,
          claimantPartyId: partyB.id,
        }),
        FOREIGN_KEY,
      );
    } else {
      // Enkel fremmednøkkel: kjernen må stoppe det (claims.test.ts 4.5.3). Ukjent id stoppes likevel.
      expect(fk, "claims skal ha en fremmednøkkel til assignment_parties").toBeDefined();
      await expectPgError(
        insertClaimSql({
          organizationId: orgA.id,
          assignmentId: assignmentA.id,
          claimantPartyId: "0190a8c2-1f2e-7a3b-8c4d-5e6f7a8b9c0d",
        }),
        FOREIGN_KEY,
      );
    }
  });

  it.each(["internal", "Complaint", ""])("3.3 ukjent claim_type %j avvises", async (claimType) => {
    const org = await createOrganization();
    const assignment = await createAssignment(org.id);
    await expectPgError(
      insertClaimSql({ organizationId: org.id, assignmentId: assignment.id, claimType }),
      CHECK,
    );
  });

  it.each(["closed", "Open", ""])("3.3 ukjent outcome %j avvises", async (outcome) => {
    const org = await createOrganization();
    const assignment = await createAssignment(org.id);
    await expectPgError(
      insertClaimSql({ organizationId: org.id, assignmentId: assignment.id, outcome }),
      CHECK,
    );
  });

  it("3.4 standardverdier: utfall open, closed_at og deleted_at tomme", async () => {
    const org = await createOrganization();
    const assignment = await createAssignment(org.id);
    const [row] = await insertClaimSql({ organizationId: org.id, assignmentId: assignment.id });
    expect(row).toMatchObject({ outcome: "open", closed_at: null, deleted_at: null });
  });

  it("3.5 negativt beløp avvises, 0 godtas", async () => {
    const org = await createOrganization();
    const assignment = await createAssignment(org.id);
    await expectPgError(
      insertClaimSql({
        organizationId: org.id,
        assignmentId: assignment.id,
        outcome: "upheld",
        amount: -1,
      }),
      CHECK,
    );
    await expect(
      insertClaimSql({
        organizationId: org.id,
        assignmentId: assignment.id,
        outcome: "settled",
        amount: 0,
      }),
    ).resolves.toHaveLength(1);
  });

  it("3.6 claims står i tenant-registeret med radbygger og testfil med expectTenantIsolation", async () => {
    const entry = tenantTables.find((candidate) => candidate.table === "claims");
    expect(entry?.testFile).toBe("src/core/claims/claims.test.ts");
    const text = readFileSync(path.resolve(process.cwd(), entry!.testFile!), "utf8");
    expect(text).toContain("expectTenantIsolation(");

    const org = await createOrganization();
    const id = await entry!.insertRow(org.id);
    const [row] = await db.execute<{ organization_id: string }>(
      sql`select organization_id from claims where id = ${id}`,
    );
    expect(row?.organization_id).toBe(org.id);
  });

  it("3.6 fabrikken createClaim lager oppdraget i samme organisasjon", async () => {
    const org = await createOrganization();
    const claim = await createClaim(org.id);
    const [row] = await db.execute<{ organization_id: string }>(
      sql`select organization_id from assignments where id = ${claim.assignmentId}`,
    );
    expect(row?.organization_id).toBe(org.id);
    expect(claim.outcome).toBe("open");
    expect(claim.receivedAt).toBe("2026-11-02");
  });

  it("3.7 migreringen 0023_reklamasjoner finnes", () => {
    const dir = path.join(process.cwd(), "src/db/migrations");
    expect(readdirSync(dir).filter((file) => file.startsWith("0023_"))).toEqual([
      "0023_reklamasjoner.sql",
    ]);
  });
});
