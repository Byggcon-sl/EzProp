import { randomUUID } from "node:crypto";
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
  createReportRow,
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

  it("1.5 report_id kan være tom, og peker ellers på en rapport i samme organisasjon (A158)", async () => {
    const { orgA, orgB, employeeA } = await twoOrganizations();
    const empty = await createAiUsageLog(orgA.id, { employeeId: employeeA.id, reportId: null });
    expect(empty.report_id).toBeNull();

    const reportA = await createReportRow(orgA.id);
    const reportB = await createReportRow(orgB.id);
    const ok = await createAiUsageLog(orgA.id, { employeeId: employeeA.id, reportId: reportA.id });
    expect(ok.report_id).toBe(reportA.id);
    await expectRejected(() =>
      createAiUsageLog(orgA.id, { employeeId: employeeA.id, reportId: reportB.id }),
    );
    await expectRejected(() =>
      createAiUsageLog(orgA.id, { employeeId: employeeA.id, reportId: randomUUID() }),
    );
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
    expect(row.status).toBeNull();
    expect(row.output_text).toBeNull();
    expect(row.error_code).toBeNull();
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

/*
 * «KI i veien» (docs/funksjoner/fase2a-ki-i-veien-testplan.md avsnitt 3, K3.1–K3.3, K3.6).
 * Migrering `0037_ki-i-veien`: nye kolonner, utfallet `stopped` med vaktkodene, CHECK på
 * kandidatene og sammendraget, og indeksene. Alle verdier er oppdiktet.
 */
describe("KI i veien: kolonner, CHECK og indekser (K3.1–K3.3)", () => {
  async function columnsOf(table: string) {
    const rows = (await db.execute(sql`
      select column_name, data_type, is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = ${table}`)) as unknown as ColumnInfo[];
    return new Map(rows.map((row) => [row.column_name, row]));
  }

  async function okRow() {
    const { orgA, employeeA } = await twoOrganizations();
    const row = await createAiUsageLog(orgA.id, {
      employeeId: employeeA.id,
      feature: "phrase_suggest",
      outputText: null,
    });
    return { orgA, employeeA, row };
  }

  const ref = (id = randomUUID()) => ({ source: "template_outcome", id });

  async function setColumns(id: string, values: Record<string, unknown>) {
    const set = Object.entries(values).map(([column, value]) =>
      value === null
        ? sql`${sql.identifier(column)} = null`
        : typeof value === "object"
          ? sql`${sql.identifier(column)} = ${JSON.stringify(value)}::jsonb`
          : sql`${sql.identifier(column)} = ${value}`,
    );
    await db.execute(sql`update ai_usage_log set ${sql.join(set, sql`, `)} where id = ${id}`);
  }

  it("K3.1 de nye kolonnene finnes og tåler tom verdi", async () => {
    const log = await columnsOf("ai_usage_log");
    for (const column of ["candidate_refs", "chosen_candidate"]) {
      expect(log.get(column)?.data_type, column).toBe("jsonb");
      expect(log.get(column)?.is_nullable, column).toBe("YES");
    }
    const report = await columnsOf("reports");
    expect(report.get("summary_text")?.data_type).toBe("text");
    expect(report.get("summary_text")?.is_nullable).toBe("YES");
    expect(report.get("summary_basis")?.data_type).toBe("jsonb");
    expect(report.get("summary_basis")?.is_nullable).toBe("YES");
  });

  it("K3.1 jsonb_typeof: candidate_refs er en liste, chosen_candidate et objekt", async () => {
    const { row } = await okRow();
    const first = ref();
    await setColumns(row.id, { candidate_refs: [first, ref()] });
    await setColumns(row.id, { status: "accepted", chosen_candidate: first });
    const [types] = (await db.execute(sql`
      select jsonb_typeof(candidate_refs) as refs, jsonb_typeof(chosen_candidate) as chosen
      from ai_usage_log where id = ${row.id}`)) as unknown as { refs: string; chosen: string }[];
    expect(types).toEqual({ refs: "array", chosen: "object" });
  });

  it.each(["tg_guard", "number_guard", "coverage_guard", "placeholder_guard"])(
    "K3.2 stopped godtas med %s, mengde og kostnad og uten status",
    async (code) => {
      const { orgA, employeeA } = await twoOrganizations();
      const row = await createAiUsageLog(orgA.id, {
        employeeId: employeeA.id,
        outcome: "stopped",
        errorCode: code,
        status: null,
        outputText: "Stoppet svar.",
        tokensIn: 12,
        tokensOut: 4,
        cost: "0.0100",
      });
      expect(row.outcome).toBe("stopped");
    },
  );

  it.each([
    { name: "uten error_code", values: { errorCode: null, status: null } },
    { name: "med en feilkode fra leverandøren", values: { errorCode: "timeout", status: null } },
    { name: "med ukjent vaktkode", values: { errorCode: "word_guard", status: null } },
    { name: "med status satt", values: { errorCode: "tg_guard", status: "suggested" } },
  ])("K3.2 stopped $name avvises", async ({ values }) => {
    const { orgA, employeeA } = await twoOrganizations();
    await expectRejected(() =>
      createAiUsageLog(orgA.id, {
        employeeId: employeeA.id,
        outcome: "stopped",
        outputText: "Stoppet svar.",
        ...(values as AiUsageLogOverrides),
      }),
    );
  });

  it("K3.2 en vaktkode ved error avvises", async () => {
    const { orgA, employeeA } = await twoOrganizations();
    await expectRejected(() =>
      createAiUsageLog(orgA.id, {
        employeeId: employeeA.id,
        outcome: "error",
        errorCode: "tg_guard",
      }),
    );
  });

  it("K3.2a candidate_refs: liste med 1–5 ved ok", async () => {
    const { row } = await okRow();
    await setColumns(row.id, { candidate_refs: [ref(), ref(), ref(), ref(), ref()] });
    await expectRejected(() => setColumns(row.id, { candidate_refs: [] }));
    await expectRejected(() =>
      setColumns(row.id, { candidate_refs: Array.from({ length: 6 }, () => ref()) }),
    );
    await expectRejected(() => setColumns(row.id, { candidate_refs: ref() }));
  });

  it("K3.2a candidate_refs er tom på en no_match-rad", async () => {
    const { orgA, employeeA } = await twoOrganizations();
    const row = await createAiUsageLog(orgA.id, { employeeId: employeeA.id, outcome: "no_match" });
    await expectRejected(() => setColumns(row.id, { candidate_refs: [ref()] }));
  });

  it("K3.2a chosen_candidate krever accepted og må stå i candidate_refs", async () => {
    const { row } = await okRow();
    const first = ref();
    await setColumns(row.id, { candidate_refs: [first] });
    // Status suggested: ikke lov
    await expectRejected(() => setColumns(row.id, { chosen_candidate: first }));
    // Ikke blant de viste: ikke lov
    await expectRejected(() => setColumns(row.id, { status: "accepted", chosen_candidate: ref() }));
    await setColumns(row.id, { status: "accepted", chosen_candidate: first });
  });

  it.each([
    { name: "{}", value: {} },
    { name: '{"id":"x"} uten source', value: { id: "x" } },
    { name: "ukjent source", value: { source: "free_text", id: "x" } },
    { name: "en liste", value: [{ source: "template_outcome", id: "x" }] },
    { name: "id som tall", value: { source: "template_outcome", id: 7 } },
    { name: "ekstra nøkkel", value: { source: "template_outcome", id: "x", text: "Tekst" } },
  ])("K3.2a chosen_candidate = $name avvises", async ({ value }) => {
    const { row } = await okRow();
    await setColumns(row.id, { candidate_refs: [{ source: "template_outcome", id: "x" }] });
    await expectRejected(() => setColumns(row.id, { status: "accepted", chosen_candidate: value }));
  });

  it("K3.2a summary_text over 10 000 tegn og summary_basis over 200 funn avvises", async () => {
    const { orgA } = await twoOrganizations();
    const report = await createReportRow(orgA.id);
    await db.execute(
      sql`update reports set summary_text = ${"a".repeat(10000)} where id = ${report.id}`,
    );
    await expectRejected(() =>
      db.execute(
        sql`update reports set summary_text = ${"a".repeat(10001)} where id = ${report.id}`,
      ),
    );
    const entry = { source: "deviation", id: randomUUID(), group: "tg2", rowVersion: 1 };
    await db.execute(
      sql`update reports set summary_basis = ${JSON.stringify(Array.from({ length: 200 }, () => entry))}::jsonb where id = ${report.id}`,
    );
    await expectRejected(() =>
      db.execute(
        sql`update reports set summary_basis = ${JSON.stringify(Array.from({ length: 201 }, () => entry))}::jsonb where id = ${report.id}`,
      ),
    );
    await expectRejected(() =>
      db.execute(sql`update reports set summary_basis = '{}'::jsonb where id = ${report.id}`),
    );
  });

  it("K3.3 indeksene for målet og «Mest brukt» finnes med predikatet", async () => {
    const rows = (await db.execute(sql`
      select indexname, indexdef from pg_indexes
      where schemaname = 'public' and tablename = 'ai_usage_log'`)) as unknown as {
      indexname: string;
      indexdef: string;
    }[];
    const byName = new Map(rows.map((row) => [row.indexname, row.indexdef]));
    const target = byName.get("ai_usage_log_target_idx") ?? "";
    expect(target).toMatch(/\(organization_id, feature, target_ref\)/u);
    expect(target).toMatch(/WHERE \(deleted_at IS NULL\)/u);
    const chosen = byName.get("ai_usage_log_chosen_candidate_idx") ?? "";
    expect(chosen).toMatch(/\(organization_id, feature\)/u);
    expect(chosen).toMatch(/chosen_candidate IS NOT NULL/u);
    expect(chosen).toMatch(/deleted_at IS NULL/u);
  });

  it("K3.6 ingen ny tabell: tenant-tabellene har ingen KI-tabell utover ai_usage_log", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "..", "tests", "tenant-tables.ts"),
      "utf8",
    );
    const aiTables = [...source.matchAll(/table:\s*"(ai_[a-z_]+)"/gu)].map((match) => match[1]);
    expect(aiTables).toEqual(["ai_usage_log"]);
  });
});
