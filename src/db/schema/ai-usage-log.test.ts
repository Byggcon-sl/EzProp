import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
  type AiUsageLogOverrides,
} from "../../../tests/factories";

/*
 * Skjema og migrering for `ai_usage_log` (docs/funksjoner/fase2a-ki-modul-logg-testplan.md
 * avsnitt 1, ADR 0006 del 5). Mot testdatabasen. Alle verdier er oppdiktet.
 *
 * Støtter hovedmål: KI i bunnen (én logg for alle KI-kall) og færre reklamasjoner (en rad kan
 * aldri peke på tvers av organisasjoner, og ingenting slettes).
 */

type ColumnInfo = { column_name: string; data_type: string; is_nullable: "YES" | "NO" };

async function columns(): Promise<Map<string, ColumnInfo>> {
  const rows = (await db.execute(sql`
    select column_name, data_type, is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'ai_usage_log'`)) as unknown as ColumnInfo[];
  return new Map(rows.map((row) => [row.column_name, row]));
}

/** Venter på at databasen avviser innsettingen. */
async function expectRejected(insert: () => Promise<unknown>) {
  let failed = false;
  try {
    await insert();
  } catch {
    failed = true;
  }
  expect(failed, "databasen skulle avvist raden").toBe(true);
}

async function twoOrganizations() {
  const orgA = await createOrganization("Oppdiktet Takst A");
  const orgB = await createOrganization("Oppdiktet Takst B");
  const employeeA = await createEmployee(await createUser(), orgA.id, ["inspector"]);
  const employeeB = await createEmployee(await createUser(), orgB.id, ["inspector"]);
  return { orgA, orgB, employeeA, employeeB };
}

beforeEach(resetDatabase);

describe("ai_usage_log: kolonnene (1.1)", () => {
  it("1.1 kolonnene finnes med riktige typer", async () => {
    const found = await columns();
    const expected = [
      "id",
      "organization_id",
      "created_at",
      "created_by",
      "updated_at",
      "updated_by",
      "deleted_at",
      "deleted_by",
      "row_version",
      "employee_id",
      "feature",
      "provider",
      "model",
      "prompt_version",
      "assignment_id",
      "report_id",
      "target_ref",
      "source_fields",
      "input_summary",
      "outcome",
      "error_code",
      "output_text",
      "status",
      "decided_by",
      "decided_at",
      "tokens_in",
      "tokens_out",
      "cost",
      "currency",
      "redacted_count",
      "retain_until",
    ];
    expect([...found.keys()].sort()).toEqual(expect.arrayContaining(expected.sort()));
    expect(found.get("cost")!.data_type).toBe("numeric");
    for (const name of ["target_ref", "source_fields", "input_summary"]) {
      expect(found.get(name)!.data_type, name).toBe("jsonb");
    }
    expect(found.get("retain_until")!.is_nullable).toBe("NO");
    expect(found.get("report_id")!.is_nullable).toBe("YES");
    expect(found.get("assignment_id")!.is_nullable).toBe("YES");
    expect(found.get("organization_id")!.is_nullable).toBe("NO");
    expect(found.get("id")!.data_type).toBe("uuid");
  });
});

describe("ai_usage_log: sammensatte fremmednøkler (1.2–1.5)", () => {
  it("1.2 employee_id fra en annen organisasjon avvises", async () => {
    const { orgA, employeeB } = await twoOrganizations();
    await expectRejected(() => createAiUsageLog(orgA.id, { employeeId: employeeB.id }));
  });

  it("1.3 decided_by fra en annen organisasjon avvises", async () => {
    const { orgA, employeeA, employeeB } = await twoOrganizations();
    await expectRejected(() =>
      createAiUsageLog(orgA.id, {
        employeeId: employeeA.id,
        status: "accepted",
        decidedBy: employeeB.id,
        decidedAt: new Date(),
      }),
    );
    // Kontroll: samme organisasjon går gjennom
    const ok = await createAiUsageLog(orgA.id, {
      employeeId: employeeA.id,
      status: "accepted",
      decidedBy: employeeA.id,
      decidedAt: new Date(),
    });
    expect(ok.decided_by).toBe(employeeA.id);
  });

  it("1.4 assignment_id fra en annen organisasjon avvises", async () => {
    const { orgA, orgB, employeeA } = await twoOrganizations();
    const assignmentB = await createAssignment(orgB.id);
    await expectRejected(() =>
      createAiUsageLog(orgA.id, { employeeId: employeeA.id, assignmentId: assignmentB.id }),
    );
    const assignmentA = await createAssignment(orgA.id);
    const ok = await createAiUsageLog(orgA.id, {
      employeeId: employeeA.id,
      assignmentId: assignmentA.id,
    });
    expect(ok.assignment_id).toBe(assignmentA.id);
  });

  it("1.5 report_id kan være tom, og har ingen fremmednøkkel (A158)", async () => {
    const { orgA, employeeA } = await twoOrganizations();
    const empty = await createAiUsageLog(orgA.id, { employeeId: employeeA.id, reportId: null });
    expect(empty.report_id).toBeNull();
    const foreignKeys = (await db.execute(sql`
      select kcu.column_name from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
      where tc.table_schema = 'public' and tc.table_name = 'ai_usage_log'
        and tc.constraint_type = 'FOREIGN KEY'`)) as unknown as { column_name: string }[];
    const columnsWithForeignKey = new Set(foreignKeys.map((row) => row.column_name));
    expect(columnsWithForeignKey.has("report_id")).toBe(false);
    for (const name of ["organization_id", "employee_id", "decided_by", "assignment_id"]) {
      expect(columnsWithForeignKey.has(name), name).toBe(true);
    }
  });
});

describe("ai_usage_log: sjekken mellom utfall, status og forslag (1.6–1.9)", () => {
  it("1.6 ok med status suggested og output_text godtas", async () => {
    const { orgA, employeeA } = await twoOrganizations();
    const row = await createAiUsageLog(orgA.id, {
      employeeId: employeeA.id,
      outcome: "ok",
      status: "suggested",
      outputText: "Taket er gammelt og har noen sprekker.",
    });
    expect(row.outcome).toBe("ok");
    expect(row.status).toBe("suggested");
  });

  it.each([
    { name: "ok uten status", outcome: "ok", status: null, outputText: "Tekst" },
    { name: "no_match med status", outcome: "no_match", status: "suggested", outputText: null },
    { name: "no_match med output_text", outcome: "no_match", status: null, outputText: "Tekst" },
    { name: "error med status", outcome: "error", status: "suggested", outputText: null },
    { name: "error med output_text", outcome: "error", status: null, outputText: "Tekst" },
  ])("1.7 avvises: $name", async ({ outcome, status, outputText }) => {
    const { orgA, employeeA } = await twoOrganizations();
    await expectRejected(() =>
      createAiUsageLog(orgA.id, {
        employeeId: employeeA.id,
        outcome,
        status,
        outputText,
        errorCode: outcome === "error" ? "timeout" : null,
      }),
    );
  });

  it.each(["no_match", "error"])(
    "1.8 %s med tom status og tom output_text godtas",
    async (outcome) => {
      const { orgA, employeeA } = await twoOrganizations();
      const row = await createAiUsageLog(orgA.id, {
        employeeId: employeeA.id,
        outcome,
        status: null,
        outputText: null,
        errorCode: outcome === "error" ? "unavailable" : null,
      });
      expect(row.status).toBeNull();
      expect(row.output_text).toBeNull();
    },
  );

  it.for<{ name: string; overrides: AiUsageLogOverrides }>([
    { name: "outcome", overrides: { outcome: "maybe", status: null, outputText: null } },
    { name: "status", overrides: { status: "approved" } },
    {
      name: "error_code",
      overrides: { outcome: "error", status: null, outputText: null, errorCode: "kaputt" },
    },
  ])(
    "1.9 ukjent kode i $name avvises (når kolonnen har sjekk eller enum)",
    async ({ name, overrides }, context) => {
      const found = await columns();
      const checks = (await db.execute(sql`
      select pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid = 'public.ai_usage_log'::regclass and contype = 'c'`)) as unknown as {
        def: string;
      }[];
      const guarded =
        found.get(name)?.data_type === "USER-DEFINED" ||
        checks.some((check) => new RegExp(`\\b${name}\\b[^,(]*=\\s*ANY`, "i").test(check.def));
      // Testplanen 1.9: bare når det er sjekk eller enum på kolonnen
      if (!guarded) context.skip();
      const { orgA, employeeA } = await twoOrganizations();
      await expectRejected(() =>
        createAiUsageLog(orgA.id, { employeeId: employeeA.id, ...overrides }),
      );
    },
  );
});

describe("ai_usage_log: redacted_count og utfallet blocked (vask før KI V6.1–V6.2)", () => {
  it("V6.1 redacted_count finnes, er ikke tom og har standard 0", async () => {
    const found = await columns();
    expect(found.get("redacted_count")?.data_type).toBe("integer");
    expect(found.get("redacted_count")?.is_nullable).toBe("NO");
    const { orgA, employeeA } = await twoOrganizations();
    const row = await createAiUsageLog(orgA.id, { employeeId: employeeA.id });
    // Fabrikken setter ikke kolonnen, så standardverdien gjelder
    expect((row as unknown as { redacted_count: number }).redacted_count).toBe(0);
  });

  it("V6.1 negativt redacted_count avvises", async () => {
    const { orgA, employeeA } = await twoOrganizations();
    const row = await createAiUsageLog(orgA.id, { employeeId: employeeA.id });
    await expectRejected(() =>
      db.execute(sql`update ai_usage_log set redacted_count = -1 where id = ${row.id}`),
    );
    await db.execute(sql`update ai_usage_log set redacted_count = 3 where id = ${row.id}`);
  });

  it("V6.2 blocked med tom status, output_text og error_code godtas", async () => {
    const { orgA, employeeA } = await twoOrganizations();
    const row = await createAiUsageLog(orgA.id, {
      employeeId: employeeA.id,
      outcome: "blocked",
      status: null,
      outputText: null,
      errorCode: null,
    });
    expect(row.outcome).toBe("blocked");
    expect(row.status).toBeNull();
    expect(row.output_text).toBeNull();
    expect(row.error_code).toBeNull();
  });

  it.each([
    { name: "status", overrides: { status: "suggested" } },
    { name: "output_text", overrides: { outputText: "Oppdiktet tekst" } },
    { name: "error_code", overrides: { errorCode: "timeout" } },
  ])("V6.2 blocked med $name satt avvises", async ({ overrides }) => {
    const { orgA, employeeA } = await twoOrganizations();
    await expectRejected(() =>
      createAiUsageLog(orgA.id, {
        employeeId: employeeA.id,
        outcome: "blocked",
        status: null,
        outputText: null,
        errorCode: null,
        ...overrides,
      }),
    );
  });
});

describe("ai_usage_log: myk sletting (1.10)", () => {
  it("1.10 deleted_at og deleted_by finnes, og ingen ON DELETE CASCADE kan fjerne rader", async () => {
    const found = await columns();
    expect(found.has("deleted_at")).toBe(true);
    expect(found.has("deleted_by")).toBe(true);
    const rules = (await db.execute(sql`
      select confdeltype::text as on_delete, conname from pg_constraint
      where conrelid = 'public.ai_usage_log'::regclass and contype = 'f'`)) as unknown as {
      on_delete: string;
      conname: string;
    }[];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      // c = cascade, n = set null, d = set default. Alle ville endret eller fjernet KI-loggen.
      expect(["a", "r"], rule.conname).toContain(rule.on_delete);
    }
  });
});

// Vask før KI (docs/funksjoner/fase2a-vask-for-ki-testplan.md avsnitt 6, kortet «Data», A171,
// A172). Migrering 0027: `redacted_count` og utfallet `blocked`. Verdiene er oppdiktet.
describe("ai_usage_log: redacted_count og blocked (V6)", () => {
  it("V6.1 redacted_count finnes, er heltall, ikke tom, standard 0", async () => {
    const found = await columns();
    const column = found.get("redacted_count");
    expect(column, "kolonnen redacted_count mangler").toBeDefined();
    expect(column!.data_type).toBe("integer");
    expect(column!.is_nullable).toBe("NO");
    const [def] = (await db.execute(sql`
      select column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'ai_usage_log'
        and column_name = 'redacted_count'`)) as unknown as { column_default: string | null }[];
    expect(def!.column_default).toBe("0");
  });

  it("V6.1 rad uten verdi får 0, og -1 avvises", async () => {
    const { orgA, employeeA } = await twoOrganizations();
    const row = await createAiUsageLog(orgA.id, { employeeId: employeeA.id });
    expect(row.redacted_count).toBe(0);
    await expectRejected(() =>
      db.execute(sql`update ai_usage_log set redacted_count = -1 where id = ${row.id}`),
    );
    await db.execute(sql`update ai_usage_log set redacted_count = 3 where id = ${row.id}`);
    const [updated] = (await db.execute(
      sql`select redacted_count from ai_usage_log where id = ${row.id}`,
    )) as unknown as { redacted_count: number }[];
    expect(updated!.redacted_count).toBe(3);
  });

  it("V6.2 blocked med tom status, output_text og error_code godtas", async () => {
    const { orgA, employeeA } = await twoOrganizations();
    const row = await createAiUsageLog(orgA.id, {
      employeeId: employeeA.id,
      outcome: "blocked",
      status: null,
      outputText: null,
      errorCode: null,
    });
    expect(row.outcome).toBe("blocked");
    expect(row.redacted_count).toBe(0);
  });

  it.each<{ name: string; overrides: AiUsageLogOverrides }>([
    { name: "status", overrides: { status: "suggested", outputText: null, errorCode: null } },
    { name: "output_text", overrides: { status: null, outputText: "Oppdiktet", errorCode: null } },
    { name: "error_code", overrides: { status: null, outputText: null, errorCode: "unknown" } },
  ])("V6.2 blocked med $name satt avvises", async ({ overrides }) => {
    const { orgA, employeeA } = await twoOrganizations();
    await expectRejected(() =>
      createAiUsageLog(orgA.id, { employeeId: employeeA.id, outcome: "blocked", ...overrides }),
    );
  });

  it("V6.3 migreringen 0027 finnes, sletter ingenting og endrer ikke eksisterende rader", () => {
    const dir = join(__dirname, "..", "migrations");
    const files = readdirSync(dir).filter((name) => /^0027_.*\.sql$/u.test(name));
    expect(files, "migrering 0027 mangler").toHaveLength(1);
    const migration = readFileSync(join(dir, files[0]!), "utf8");
    expect(migration).toMatch(/redacted_count/u);
    expect(migration).toMatch(/blocked/u);
    for (const forbidden of [
      /\bdelete\s+from\b/iu,
      /\btruncate\b/iu,
      /\bdrop\s+table\b/iu,
      /\bdrop\s+column\b/iu,
      /\bupdate\s+"?ai_usage_log"?\s+set\b/iu,
    ]) {
      expect(migration, String(forbidden)).not.toMatch(forbidden);
    }
  });
});
