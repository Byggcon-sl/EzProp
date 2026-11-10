import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import {
  createAiUsageLog,
  createAssignment,
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { AI_ERROR_CODES, AI_OUTCOMES, AI_SUGGESTION_STATUSES } from "./ai-usage-log";

/*
 * Databasereglene for `ai_usage_log` (docs/funksjoner/fase2a-ki-modul-logg.md Omfang 1).
 * Testplan docs/funksjoner/fase2a-ki-modul-logg-testplan.md avsnitt 1. Oppdiktede data.
 */

beforeEach(resetDatabase);

/**
 * Venter at databasen avviser med akkurat denne sjekken eller fremmednøkkelen, så testen ikke
 * blir grønn av en annen feil.
 */
async function expectViolation(write: PromiseLike<unknown>, constraint: string) {
  const error: unknown = await Promise.resolve(write).then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, `forventet at ${constraint} avviste skrivingen`).toBeInstanceOf(Error);
  const cause = (error as { cause?: { constraint_name?: string } }).cause;
  expect(cause?.constraint_name).toBe(constraint);
}

async function twoOrganizations() {
  const orgA = await createOrganization("Organisasjon A");
  const orgB = await createOrganization("Organisasjon B");
  return { orgA, orgB };
}

async function foreignEmployee(organizationId: string) {
  return createEmployee(await createUser(), organizationId, ["inspector"]);
}

type ColumnInfo = { column_name: string; data_type: string; is_nullable: "YES" | "NO" };

async function columns(): Promise<Map<string, ColumnInfo>> {
  const found = (await db.execute(sql`
    select column_name, data_type, is_nullable from information_schema.columns
    where table_name = 'ai_usage_log'`)) as unknown as ColumnInfo[];
  return new Map(found.map((row) => [row.column_name, row]));
}

describe("ai_usage_log: kolonner (1.1, 1.5, 1.10)", () => {
  it("1.1 kolonnene finnes med riktige typer og påkrevd/valgfri", async () => {
    const cols = await columns();
    expect(cols.get("cost")?.data_type).toBe("numeric");
    for (const name of ["target_ref", "source_fields", "input_summary"]) {
      expect(cols.get(name)?.data_type, name).toBe("jsonb");
      expect(cols.get(name)?.is_nullable, name).toBe("NO");
    }
    expect(cols.get("retain_until")?.is_nullable).toBe("NO");
    expect(cols.get("retain_until")?.data_type).toBe("timestamp with time zone");
    for (const name of ["report_id", "assignment_id", "decided_by", "decided_at", "status"]) {
      expect(cols.get(name)?.is_nullable, name).toBe("YES");
    }
    for (const name of [
      "employee_id",
      "feature",
      "provider",
      "model",
      "prompt_version",
      "outcome",
      "tokens_in",
      "tokens_out",
      "currency",
    ]) {
      expect(cols.get(name)?.is_nullable, name).toBe("NO");
    }
    const [precision] = (await db.execute(sql`
      select numeric_precision, numeric_scale from information_schema.columns
      where table_name = 'ai_usage_log' and column_name = 'cost'`)) as unknown as {
      numeric_precision: number;
      numeric_scale: number;
    }[];
    expect(precision).toEqual({ numeric_precision: 12, numeric_scale: 4 });
  });

  it("1.1 standardverdier: kostnad 0, NOK, null tokens, og kostnaden leses som tekst (ikke flyttall)", async () => {
    const org = await createOrganization();
    const row = await createAiUsageLog(org.id);
    expect(row.cost).toBe("0.0000");
    expect(row.currency).toBe("NOK");
    expect(row.tokensIn).toBe(0);
    expect(row.tokensOut).toBe(0);
  });

  it("1.1 retain_until er påkrevd (ingen standardverdi)", async () => {
    const org = await createOrganization();
    const employee = await foreignEmployee(org.id);
    await expect(
      db.execute(sql`
        insert into ai_usage_log (organization_id, employee_id, feature, provider, model,
          prompt_version, target_ref, source_fields, input_summary, outcome, status)
        values (${org.id}, ${employee.id}, 'language_polish', 'fake', 'fake-v1',
          'language_polish.v1', '{"type":"answer","id":"x","fieldKey":"text"}'::jsonb,
          '["text"]'::jsonb, '{"text":10}'::jsonb, 'ok', 'suggested')`),
    ).rejects.toThrow();
  });

  it("1.1 fabrikken setter retain_until til omtrent nå + 10 år", async () => {
    const org = await createOrganization();
    const row = await createAiUsageLog(org.id);
    const expected = new Date(row.createdAt);
    expected.setUTCFullYear(expected.getUTCFullYear() + 10);
    expect(Math.abs(row.retainUntil.getTime() - expected.getTime())).toBeLessThan(60_000);
  });

  it("1.5 report_id kan være tom, og har ingen fremmednøkkel (A158)", async () => {
    const org = await createOrganization();
    const empty = await createAiUsageLog(org.id, { reportId: null });
    expect(empty.reportId).toBeNull();
    // En id som ikke finnes noe sted, godtas: ingen fremmednøkkel før `reports` er bygget
    const unknown = await createAiUsageLog(org.id, {
      reportId: "0192f000-0000-7000-8000-000000000001",
    });
    expect(unknown.reportId).toBe("0192f000-0000-7000-8000-000000000001");
    const fks = (await db.execute(sql`
      select kcu.column_name from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = tc.constraint_name and kcu.table_name = tc.table_name
      where tc.table_name = 'ai_usage_log' and tc.constraint_type = 'FOREIGN KEY'`)) as unknown as {
      column_name: string;
    }[];
    expect(fks.map((fk) => fk.column_name)).not.toContain("report_id");
  });

  it("1.10 myk sletting: deleted_at og deleted_by finnes, og ingen ON DELETE CASCADE", async () => {
    const cols = await columns();
    expect(cols.has("deleted_at")).toBe(true);
    expect(cols.has("deleted_by")).toBe(true);
    const rules = (await db.execute(sql`
      select rc.constraint_name, rc.delete_rule from information_schema.referential_constraints rc
      join information_schema.table_constraints tc on tc.constraint_name = rc.constraint_name
      where tc.table_name = 'ai_usage_log'`)) as unknown as {
      constraint_name: string;
      delete_rule: string;
    }[];
    expect(rules.map((rule) => rule.constraint_name).sort()).toEqual([
      "ai_usage_log_assignment_fk",
      "ai_usage_log_decided_by_fk",
      "ai_usage_log_employee_fk",
      "ai_usage_log_organization_id_organizations_id_fk",
    ]);
    for (const rule of rules) expect(rule.delete_rule, rule.constraint_name).toBe("NO ACTION");
  });
});

describe("ai_usage_log: sammensatte fremmednøkler (1.2–1.4)", () => {
  it("1.2 employee_id fra en annen organisasjon avvises", async () => {
    const { orgA, orgB } = await twoOrganizations();
    const foreign = await foreignEmployee(orgB.id);
    await expectViolation(
      createAiUsageLog(orgA.id, { employeeId: foreign.id }),
      "ai_usage_log_employee_fk",
    );
  });

  it("1.3 decided_by fra en annen organisasjon avvises", async () => {
    const { orgA, orgB } = await twoOrganizations();
    const foreign = await foreignEmployee(orgB.id);
    await expectViolation(
      createAiUsageLog(orgA.id, {
        status: "accepted",
        decidedBy: foreign.id,
        decidedAt: new Date(),
      }),
      "ai_usage_log_decided_by_fk",
    );
  });

  it("1.3 decided_by fra egen organisasjon godtas", async () => {
    const org = await createOrganization();
    const own = await foreignEmployee(org.id);
    const row = await createAiUsageLog(org.id, {
      status: "accepted",
      decidedBy: own.id,
      decidedAt: new Date(),
    });
    expect(row.decidedBy).toBe(own.id);
  });

  it("1.4 assignment_id fra en annen organisasjon avvises, fra egen godtas", async () => {
    const { orgA, orgB } = await twoOrganizations();
    const foreign = await createAssignment(orgB.id);
    await expectViolation(
      createAiUsageLog(orgA.id, { assignmentId: foreign.id }),
      "ai_usage_log_assignment_fk",
    );
    const own = await createAssignment(orgA.id);
    const row = await createAiUsageLog(orgA.id, { assignmentId: own.id });
    expect(row.assignmentId).toBe(own.id);
  });
});

describe("ai_usage_log: sjekken på utfall, status og forslag (1.6–1.8)", () => {
  it("1.6 godtas: ok med status suggested og output_text", async () => {
    const org = await createOrganization();
    const row = await createAiUsageLog(org.id, {
      outcome: "ok",
      status: "suggested",
      outputText: "Taket er gammelt og har sprekker.",
    });
    expect(row.status).toBe("suggested");
  });

  it.each([
    ["ok uten status", { outcome: "ok", status: null }],
    ["no_match med status", { outcome: "no_match", status: "suggested", outputText: null }],
    ["no_match med output_text", { outcome: "no_match", status: null, outputText: "Tekst" }],
    [
      "error med status",
      { outcome: "error", errorCode: "unknown", status: "rejected", outputText: null },
    ],
    [
      "error med output_text",
      { outcome: "error", errorCode: "unknown", status: null, outputText: "Tekst" },
    ],
  ])("1.7 avvises: %s", async (_label, overrides) => {
    const org = await createOrganization();
    await expectViolation(createAiUsageLog(org.id, overrides), "ai_usage_log_outcome_status_check");
  });

  it.each([
    ["no_match", { outcome: "no_match", status: null, outputText: null }],
    ["error", { outcome: "error", errorCode: "timeout", status: null, outputText: null }],
  ])("1.8 godtas: %s med tom status og tom output_text", async (_label, overrides) => {
    const org = await createOrganization();
    const row = await createAiUsageLog(org.id, overrides);
    expect(row.status).toBeNull();
    expect(row.outputText).toBeNull();
  });
});

describe("ai_usage_log: ugyldige koder (1.9)", () => {
  it("1.9 alle kjente koder godtas", async () => {
    const org = await createOrganization();
    for (const status of AI_SUGGESTION_STATUSES) {
      await createAiUsageLog(org.id, { status });
    }
    for (const errorCode of AI_ERROR_CODES) {
      await createAiUsageLog(org.id, {
        outcome: "error",
        errorCode,
        status: null,
        outputText: null,
      });
    }
    expect([...AI_OUTCOMES]).toEqual(["ok", "no_match", "error"]);
  });

  it.each([
    ["outcome", { outcome: "maybe", status: null, outputText: null }, "ai_usage_log_outcome_check"],
    ["status", { status: "approved" }, "ai_usage_log_status_check"],
    [
      "error_code",
      { outcome: "error", errorCode: "boom", status: null, outputText: null },
      "ai_usage_log_error_code_check",
    ],
    ["currency", { currency: "EUR" }, "ai_usage_log_currency_check"],
  ])("1.9 ukjent %s avvises", async (_label, overrides, constraint) => {
    const org = await createOrganization();
    await expectViolation(createAiUsageLog(org.id, overrides), constraint);
  });
});
