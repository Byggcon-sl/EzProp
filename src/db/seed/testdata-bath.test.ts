import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  AccessDeniedError,
  permissions,
  requireOrganizationAccess,
  type Actor,
} from "@/core/access";
import { removeDeviation } from "@/core/reports/deviations";
import { getRoomView } from "@/core/reports/room-view";
import { saveField } from "@/core/reports/save-field";
import { decideSuggestion } from "@/core/reports/suggestions";
import type { RoomReportView } from "@/core/reports/types";
import { db } from "@/db/client";
import {
  assignments,
  assignmentTeamMembers,
  auditLog,
  checkpointResults,
  deviations,
  employeeRoleAssignments,
  employees,
  fieldAnswers,
  organizations,
  reports,
  ruleSuggestionDecisions,
  templateVersions,
  users,
} from "@/db/schema";
import { brand } from "@/shared/config/brand";
import { uuidv7 } from "@/shared/lib/uuid";
import { setInspectorsEditAll } from "../../../tests/report-fixtures";
import {
  TEST_NOW,
  activeAdminCount,
  createAssignment,
  createBuilding,
  createCheckpointResultRow,
  createDeviationRow,
  createEmployee,
  createFloor,
  createOrder,
  createOrganization,
  createReportRow,
  createRoom,
  createTemplate,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { runSeed } from "./run";
import { runSampleSeed } from "./sample-assignments";
import { wetRoomTemplate } from "./templates/wet-room";
import { seedTestdata } from "./testdata";
import { findTestdataOrganization, resolveTestdataPlan } from "./testdata-anchor";
import {
  TestdataBathError,
  assignBathScenarios,
  bathCandidatesFromPlan,
  checkBathAgainstRules,
  findShowcaseBathReport,
  findTestdataBathReports,
  planTestdataBaths,
  seedTestdataBaths,
  type TestdataBathPlacement,
} from "./testdata-bath";
import {
  BATH_RULES,
  MANDATORY_BATH_SCENARIO_KEYS,
  WET_ROOM_CHECKPOINT_ORDER,
  bathScenarioByKey,
} from "./testdata-bath.data";
import { TestdataNotAllowedError } from "./testdata-guard";
import {
  TESTDATA_FIRST_NAMES,
  TESTDATA_LAST_NAMES,
  TESTDATA_SEED,
  TESTDATA_STREET_NAMES,
} from "./testdata.data";

/*
 * Seed-steget for badene mot testdatabasen (docs/funksjoner/fase2a-testdata-del-2-testplan.md
 * seksjon 2). En full kjøring med badene tar flere sekunder, så hver blokk kjører den én gang i
 * `beforeAll` og prøver flere ting på samme data; testene som endrer data, ligger sist i blokken.
 *
 * Støtter hovedmålene: færre reklamasjoner (TG bare gjennom tjenestene og regelmotoren, ingen
 * ferdig rapport bryter sperrekravene), KI i bunnen (regelbeslutninger i samme form som ekte data,
 * ingen KI-rader) og de ansatte (tilgang som badskjermen, admin stenges aldri ute).
 */

// `tests/report-fixtures.ts` importerer `@/core/reports`, som er merket `server-only`
vi.mock("server-only", () => ({}));

const SEED_ENV = { SEED_ADMIN_EMAIL: "admin@example.com", SEED_ADMIN_NAME: "Test Admin" };
const LONG = 600_000;
/** Tidsgrensen for hele `seedTestdata` (forbedrer runde 2, tillegg 3). */
const TIME_LIMIT_MS = 60_000;

const BATH_TABLES = [
  "reports",
  "field_answers",
  "checkpoint_results",
  "deviations",
  "deviation_measures",
  "tgiu_details",
  "rule_suggestion_decisions",
] as const;
const COUNTED = [...BATH_TABLES, "audit_log", "ai_usage_log"] as const;

/** Antall rader per tabell, eventuelt bare i én organisasjon. */
async function countRows(organizationId?: string): Promise<Record<string, number>> {
  const where = organizationId ? ` where organization_id = '${organizationId}'` : "";
  const parts = COUNTED.map(
    (table) => `(select count(*)::int from ${table}${where}) as "${table}"`,
  ).join(", ");
  const [row] = (await db.execute(sql.raw(`select ${parts}`))) as unknown as Record<
    string,
    number
  >[];
  return { ...row! };
}

/** `deleted_at` og `updated_at` på alle rader i rapporttabellene, til sammenligning. */
async function rowStamps(): Promise<string[]> {
  const out: string[] = [];
  for (const table of BATH_TABLES) {
    const rows = (await db.execute(
      sql.raw(
        `select id::text, updated_at::text as u, deleted_at::text as d from ${table} order by id`,
      ),
    )) as unknown as { id: string; u: string; d: string | null }[];
    for (const row of rows) out.push(`${table}|${row.id}|${row.u}|${row.d ?? "-"}`);
  }
  return out;
}

async function byggconId(): Promise<string> {
  const org = await findTestdataOrganization(db);
  if (!org) throw new Error("Byggcon mangler i testen");
  return org.id;
}

/** Byggcon med publisert systemmal for tilstandsrapport (som i drift). */
async function publishTemplate(organizationId: string, document: unknown = wetRoomTemplate) {
  return createTemplate(organizationId, {
    status: "published",
    document: document as typeof wetRoomTemplate,
    name: "Tilstandsrapport",
  });
}

async function prepare(options: { template?: boolean } = {}) {
  await resetDatabase();
  await runSeed(SEED_ENV);
  const orgId = await byggconId();
  if (options.template !== false) await publishTemplate(orgId);
  return orgId;
}

/** Takstmannen på oppdraget (aktiv ansvarlig). */
async function responsibleActor(
  assignmentId: string,
): Promise<{ actor: Actor; employeeId: string }> {
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name, employeeId: employees.id })
    .from(assignmentTeamMembers)
    .innerJoin(employees, eq(employees.id, assignmentTeamMembers.employeeId))
    .innerJoin(users, eq(users.id, employees.userId))
    .where(
      and(
        eq(assignmentTeamMembers.assignmentId, assignmentId),
        eq(assignmentTeamMembers.teamRole, "responsible"),
        isNull(assignmentTeamMembers.toAt),
      ),
    )
    .orderBy(asc(assignmentTeamMembers.fromAt));
  if (!row) throw new Error("fant ikke takstmannen");
  return { actor: { id: row.id, email: row.email, name: row.name }, employeeId: row.employeeId };
}

async function seedAdmin(): Promise<Actor & { employeeId: string }> {
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name, employeeId: employees.id })
    .from(users)
    .innerJoin(employees, eq(employees.userId, users.id))
    .where(eq(users.email, SEED_ENV.SEED_ADMIN_EMAIL));
  if (!row) throw new Error("admin mangler");
  return row;
}

type StartedView = Extract<RoomReportView, { state: "started" }>;
type LoadedBath = TestdataBathPlacement & { view: StartedView; actor: Actor };

async function loadBaths(orgId: string): Promise<LoadedBath[]> {
  const placements = await planTestdataBaths({
    db,
    organizationId: orgId,
    seed: TESTDATA_SEED,
    now: TEST_NOW,
  });
  const out: LoadedBath[] = [];
  for (const placement of placements) {
    const { actor } = await responsibleActor(placement.assignmentId);
    const view = await getRoomView(actor, orgId, {
      assignmentId: placement.assignmentId,
      roomId: placement.roomId,
    });
    if (view.state !== "started") throw new Error("badet er ikke startet");
    out.push({ ...placement, view, actor });
  }
  return out;
}

const DONE = new Set(["completed", "invoiced"]);
const label = (b: LoadedBath) => `${b.bath.assignmentLabel} ${b.bath.roomName} (${b.scenarioKey})`;

// ---------------------------------------------------------------------------------------------
// Hele datasettet etter én kjøring
// ---------------------------------------------------------------------------------------------

describe("seedTestdataBaths: datasettet", { timeout: LONG }, () => {
  let orgId = "";
  let durationMs = 0;
  let summary: Awaited<ReturnType<typeof seedTestdata>>;
  let baths: LoadedBath[] = [];
  let logged = "";
  let adminBefore: { roles: string[]; activeAdmins: number; deactivatedAt: Date | null };
  let adminPermissionsBefore: Record<string, boolean>;
  let adminAfterSeed: typeof adminBefore;

  async function adminPermissions(): Promise<Record<string, boolean>> {
    const admin = await seedAdmin();
    const result: Record<string, boolean> = {};
    for (const permission of permissions) {
      try {
        await requireOrganizationAccess(admin, orgId, permission);
        result[permission] = true;
      } catch {
        result[permission] = false;
      }
    }
    return result;
  }

  async function adminState() {
    const admin = await seedAdmin();
    const roles = await db
      .select({ role: employeeRoleAssignments.role })
      .from(employeeRoleAssignments)
      .where(eq(employeeRoleAssignments.employeeId, admin.employeeId));
    const [employee] = await db
      .select({ deactivatedAt: employees.deactivatedAt })
      .from(employees)
      .where(eq(employees.id, admin.employeeId));
    return {
      roles: roles.map((r) => r.role).sort(),
      activeAdmins: await activeAdminCount(orgId),
      deactivatedAt: employee?.deactivatedAt ?? null,
    };
  }

  beforeAll(async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
    orgId = await prepare();
    adminBefore = await adminState();
    adminPermissionsBefore = await adminPermissions();
    const started = Date.now();
    summary = await seedTestdata({ db, now: TEST_NOW, seed: TESTDATA_SEED });
    durationMs = Date.now() - started;
    adminAfterSeed = await adminState();
    logged = lines.join("\n");
    baths = await loadBaths(orgId);
  }, LONG);

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- 2.1 Rapportene ---

  it("2.1.1 rapport i hvert våtrom i under arbeid, ferdig og fakturert; ingen i bestilt", async () => {
    const rows = await db
      .select({ id: assignments.id, status: assignments.status, report: reports.id })
      .from(assignments)
      .leftJoin(reports, and(eq(reports.assignmentId, assignments.id), isNull(reports.deletedAt)))
      .where(eq(assignments.organizationId, orgId));
    const withBath = new Set(baths.map((b) => b.assignmentId));
    for (const row of rows) {
      if (row.status === "ordered") expect(row.report).toBeNull();
      if (withBath.has(row.id)) expect(row.report, row.id).not.toBeNull();
    }
    expect(baths.length).toBeGreaterThan(0);
    expect(summary.bathsFilled).toBe(baths.length);
  });

  it("2.1.2 rapportene er låst til den publiserte systemmalen", async () => {
    const [published] = await db
      .select({ id: templateVersions.id })
      .from(templateVersions)
      .where(
        and(eq(templateVersions.organizationId, orgId), eq(templateVersions.status, "published")),
      );
    const rows = await findTestdataBathReports(db, orgId);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.templateVersionId).toBe(published!.id);
  });

  it("2.1.3 ferdig og fakturert har 8 av 8; under arbeid har færre", () => {
    for (const bath of baths) {
      expect(bath.view.progress.total, label(bath)).toBe(8);
      if (DONE.has(bath.bath.status)) expect(bath.view.progress.done, label(bath)).toBe(8);
      else expect(bath.view.progress.done, label(bath)).toBeLessThan(8);
    }
  });

  it("2.1.4 under arbeid er en avbrutt befaring i malens rekkefølge (unntak tilliggende)", async () => {
    for (const bath of baths.filter((b) => b.bath.status === "in_progress")) {
      const done = WET_ROOM_CHECKPOINT_ORDER.map(
        (key) => bath.view.checkpoints.find((c) => c.checkpointKey === key)?.done ?? false,
      );
      const k = done.filter(Boolean).length;
      expect(done.slice(0, k).every(Boolean), label(bath)).toBe(true);
      expect(done.slice(k).some(Boolean), label(bath)).toBe(false);
      for (const key of WET_ROOM_CHECKPOINT_ORDER.slice(k)) {
        if (key === "wet_room.adjacent") continue;
        const view = bath.view.checkpoints.find((c) => c.checkpointKey === key)!;
        expect(view.deviations, `${label(bath)} ${key}`).toEqual([]);
        expect(view.resultId, `${label(bath)} ${key}`).toBeNull();
        const elements = bath.view.document.elements
          .filter((e) => e.checkpoint_key === key)
          .map((e) => e.key);
        expect(
          bath.view.answers.filter((a) => elements.includes(a.elementKey)),
          `${label(bath)} ${key}`,
        ).toEqual([]);
      }
    }
  });

  it("2.1.5 hulltaking i alle ferdige bad: måling med enhet, eller ikke utført med grunn og TGIU", () => {
    for (const bath of baths.filter((b) => DONE.has(b.bath.status))) {
      const answer = (key: string) => bath.view.answers.find((a) => a.elementKey === key)?.value;
      const drilling = answer("wet_room.hole_drilling")?.optionKeys?.[0];
      if (drilling === "not_done") {
        expect(answer("wet_room.hole_drilling_reason")?.optionKeys?.length, label(bath)).toBe(1);
        const adjacent = bath.view.checkpoints.find((c) => c.checkpointKey === "wet_room.adjacent");
        expect(adjacent?.tgDirect, label(bath)).toBe("IU");
      } else {
        expect(["done_no_findings", "done_with_findings"]).toContain(drilling);
        expect(answer("wet_room.hole_moisture_reading")?.number, label(bath)).not.toBeNull();
        expect(answer("wet_room.hole_moisture_unit")?.optionKeys?.[0]).toBe("weight_percent");
      }
    }
  });

  it("2.1.6 ingen av de fire advarslene på ferdige og fakturerte", () => {
    const forbidden = [
      "tg3_on_age_only",
      "tgiu_suggested_not_set",
      "tgiu_details_missing",
      "checkpoint_done_without_tg",
    ];
    for (const bath of baths.filter((b) => DONE.has(b.bath.status))) {
      for (const checkpoint of bath.view.checkpoints) {
        const codes = checkpoint.warnings.map((w) => w.code);
        for (const code of forbidden)
          expect(codes, `${label(bath)} ${checkpoint.checkpointKey}`).not.toContain(code);
      }
    }
  });

  it("2.1.7 byggeåret stemmer med planen, og sjiktets årstall er tomt", async () => {
    const plan = await resolveTestdataPlan(db, orgId, TESTDATA_SEED, TEST_NOW);
    const planned = bathCandidatesFromPlan(plan);
    for (const bath of baths) {
      const answer = (key: string) => bath.view.answers.find((a) => a.elementKey === key)?.value;
      expect(answer("wet_room.membrane_year"), label(bath)).toBeUndefined();
      const scenario = bathScenarioByKey(bath.scenarioKey);
      if (scenario.buildYear === "unknown") {
        expect(answer("wet_room.build_year"), label(bath)).toBeUndefined();
        expect(answer("wet_room.build_year_source")?.optionKeys).toEqual(["unknown"]);
        continue;
      }
      expect(answer("wet_room.build_year")?.number, label(bath)).toBe(bath.bath.bathYear);
      expect(answer("wet_room.build_year_source")?.optionKeys).toEqual([bath.bath.bathYearSource]);
      const fromPlan = planned.filter(
        (p) => p.roomName === bath.bath.roomName && p.bathYear === bath.bath.bathYear,
      );
      expect(fromPlan.length, label(bath)).toBeGreaterThan(0);
    }
    expect(baths.some((b) => b.bath.bathYearSource === "owner_stated")).toBe(true);
    expect(baths.some((b) => b.bath.bathYearSource === "documented")).toBe(true);
  });

  it("2.1.9 alle pliktige scenarioer finnes, og fordelingen er lik den rene fordelingen", async () => {
    for (const key of MANDATORY_BATH_SCENARIO_KEYS) {
      expect(
        baths.some((b) => b.scenarioKey === key),
        key,
      ).toBe(true);
    }
    const plan = await resolveTestdataPlan(db, orgId, TESTDATA_SEED, TEST_NOW);
    const pure = assignBathScenarios({ baths: bathCandidatesFromPlan(plan), seed: TESTDATA_SEED });
    expect(baths.map((b) => [b.bath.roomName, b.scenarioKey])).toEqual(
      pure.map((p) => [p.bath.roomName, p.scenarioKey]),
    );
    expect(summary.bathScenarioMap.map((line) => line.scenarioKey)).toEqual([
      ...MANDATORY_BATH_SCENARIO_KEYS,
    ]);
  });

  // --- 2.2 TG bare gjennom tjenestene ---

  it("2.2.10 hvert avvik med TG har kilde: beslutning, fast TG i malen, eller valgt TG med revisjonsrad", async () => {
    const decisions = await db
      .select({ deviationId: ruleSuggestionDecisions.deviationId })
      .from(ruleSuggestionDecisions)
      .where(eq(ruleSuggestionDecisions.organizationId, orgId));
    const fromDecision = new Set(decisions.map((d) => d.deviationId));
    const audits = await db
      .select({ entityId: auditLog.entityId, changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.organizationId, orgId), eq(auditLog.entityType, "deviation")));
    const audited = new Map(audits.map((a) => [a.entityId, a.changes]));
    let count = 0;
    for (const bath of baths) {
      for (const checkpoint of bath.view.checkpoints) {
        for (const d of checkpoint.deviations) {
          if (d.kind !== "tg" || d.tg === null) continue;
          count += 1;
          const outcome = bath.view.document.outcomes.find(
            (o) => o.question_key === d.questionKey && o.key === d.outcomeKey,
          );
          const fixed = outcome?.kind === "tg2" ? 2 : outcome?.kind === "tg3" ? 3 : null;
          const ok =
            fromDecision.has(d.id) ||
            fixed === d.tg ||
            (outcome?.kind === "choose_tg2_tg3" && audited.get(d.id)?.tg === d.tg);
          expect(ok, `${label(bath)} ${d.questionKey}`).toBe(true);
        }
      }
    }
    expect(count).toBeGreaterThan(0);
  });

  it("2.2.11 TG1 direkte bare på punkt uten avvik med TG og uten åpent forslag", () => {
    for (const bath of baths) {
      for (const checkpoint of bath.view.checkpoints) {
        if (checkpoint.tgDirect !== "1") continue;
        expect(checkpoint.deviations.some((d) => d.kind === "tg" && d.tg !== null)).toBe(false);
        const open = bath.view.suggestions.filter(
          (s) =>
            s.checkpointKey === checkpoint.checkpointKey &&
            s.state === "triggered" &&
            s.latestDecision === null,
        );
        expect(open, `${label(bath)} ${checkpoint.checkpointKey}`).toEqual([]);
      }
    }
  });

  it("2.2.12 TG0 bare ved godtatt TG0-forslag og bare på tilliggende", () => {
    let count = 0;
    for (const bath of baths) {
      for (const checkpoint of bath.view.checkpoints) {
        if (checkpoint.tgDirect !== "0") continue;
        count += 1;
        expect(checkpoint.checkpointKey).toBe("wet_room.adjacent");
        const suggestion = bath.view.suggestions.find((s) => s.ruleKey === BATH_RULES.noMoisture);
        expect(suggestion?.latestDecision?.decision, label(bath)).toBe("accepted");
      }
    }
    expect(count).toBeGreaterThan(0);
  });

  it("2.2.13 seed-filene skriver aldri direkte til rapporttabellene", () => {
    const dir = join(process.cwd(), "src", "db", "seed");
    const files = readdirSync(dir).filter(
      (name) => /^testdata.*\.ts$/.test(name) && !name.endsWith(".test.ts"),
    );
    expect(files).toContain("testdata-bath.ts");
    const tables =
      "deviations|checkpointResults|ruleSuggestionDecisions|deviationMeasures|tgiuDetails|fieldAnswers|reports";
    const sqlTables =
      "deviations|checkpoint_results|rule_suggestion_decisions|deviation_measures|tgiu_details|field_answers|reports";
    for (const name of files) {
      const source = readFileSync(join(dir, name), "utf8");
      expect(source, name).not.toMatch(
        new RegExp(`\\.(insert|update|delete)\\(\\s*(${tables})\\b`),
      );
      expect(source, name).not.toMatch(
        new RegExp(`(insert\\s+into|update|delete\\s+from)\\s+"?(${sqlTables})\\b`, "i"),
      );
    }
  });

  it("2.2.14d hele seedTestdata tar under 60 sekunder", () => {
    expect(durationMs).toBeLessThan(TIME_LIMIT_MS);
  });

  // --- 2.3 Hele datasettet ---

  function allDeviations() {
    return baths.flatMap((bath) =>
      bath.view.checkpoints.flatMap((c) => c.deviations.map((d) => ({ bath, c, d }))),
    );
  }

  it("2.3.15–19 TG3 med kostnad, TG2/TG3 med årsak og konsekvens, TG2 uten kostnad, TG0 bare på tilliggende, ingen TG3 på dokumentasjon", () => {
    for (const { bath, c, d } of allDeviations()) {
      const where = `${label(bath)} ${d.questionKey}`;
      if (d.tg === 3) expect(d.cost.type, where).toBe("band");
      if (d.tg === 2 || d.tg === 3) {
        expect(d.causeCriterion, where).not.toBeNull();
        expect(d.causeText?.trim(), where).toBeTruthy();
        expect(d.consequenceText?.trim(), where).toBeTruthy();
      }
      if (d.tg === 2) expect(d.cost.type, where).toBe("none");
      if (c.checkpointKey === "wet_room.documentation") expect(d.tg, where).not.toBe(3);
    }
    for (const bath of baths) {
      for (const c of bath.view.checkpoints) {
        if (c.tgDirect === "0") expect(c.checkpointKey).toBe("wet_room.adjacent");
      }
    }
  });

  it("2.3.20 ingen TG på HMS, og testen feiler ved 0 HMS-avvik", () => {
    const hms = allDeviations().filter(({ d }) => d.kind === "hms");
    expect(hms.length).toBeGreaterThan(0);
    for (const { d } of hms) {
      expect(d.tg).toBeNull();
      expect(d.consequenceText?.trim()).toBeTruthy();
      expect(d.measures.length).toBeGreaterThan(0);
    }
  });

  it("2.3.21 ingen avvik med kode utenfor badmalen", () => {
    const outcomes = new Set(wetRoomTemplate.outcomes.map((o) => `${o.question_key}|${o.key}`));
    for (const { d } of allDeviations()) {
      expect(outcomes.has(`${d.questionKey}|${d.outcomeKey}`), d.questionKey ?? "").toBe(true);
    }
  });

  it("2.3.22 ingen ferdig punkt uten TG", () => {
    for (const bath of baths) {
      for (const c of bath.view.checkpoints) {
        if (c.done) expect(c.tg, `${label(bath)} ${c.checkpointKey}`).not.toBeNull();
      }
    }
  });

  it("2.3.23 text_source er bare template eller edited, og minst ett av hver", () => {
    const sources = allDeviations().map(({ d }) => d.textSource);
    for (const source of sources) expect(["template", "edited"]).toContain(source);
    expect(sources).toContain("template");
    expect(sources).toContain("edited");
  });

  it("2.3.24 TGIU har opplysningene grunnen krever, og en rad i tgiu_details", () => {
    let count = 0;
    for (const bath of baths) {
      const adjacent = bath.view.checkpoints.find((c) => c.checkpointKey === "wet_room.adjacent")!;
      if (adjacent.tgDirect !== "IU") continue;
      count += 1;
      const t = adjacent.tgiuDetails!;
      expect(t, label(bath)).not.toBeNull();
      for (const value of [
        t.reason,
        t.riskAssessment,
        t.howToExamine,
        t.alternativeCheckMethod,
        t.alternativeCheckResult,
      ]) {
        expect(value?.trim(), label(bath)).toBeTruthy();
      }
      expect(["yes", "no"]).toContain(t.constructionVulnerable);
      const reason = bath.view.answers.find((a) => a.elementKey === "wet_room.hole_drilling_reason")
        ?.value.optionKeys?.[0];
      expect(t.ownerInformed === true, label(bath)).toBe(reason === "owner_refused");
      expect(adjacent.warnings.map((w) => w.code)).not.toContain("tgiu_details_missing");
    }
    expect(count).toBeGreaterThan(0);
  });

  it("2.3.25 minst ett changed og ett rejected med begrunnelseskode", async () => {
    const rows = await db
      .select({
        decision: ruleSuggestionDecisions.decision,
        code: ruleSuggestionDecisions.overrideReasonCode,
      })
      .from(ruleSuggestionDecisions)
      .where(eq(ruleSuggestionDecisions.organizationId, orgId));
    expect(rows.some((r) => r.decision === "changed" && r.code !== null)).toBe(true);
    expect(rows.some((r) => r.decision === "rejected" && r.code === "measured_again")).toBe(true);
  });

  // --- 2.6 KI og revisjonslogg ---

  it("2.6.31 ingen rader i ai_usage_log", async () => {
    expect((await countRows()).ai_usage_log).toBe(0);
  });

  it("2.6.32 aktøren i revisjonsloggen for rapportradene er takstmannen på oppdraget, aldri admin", async () => {
    const admin = await seedAdmin();
    const expected = new Map<string, string>();
    for (const bath of baths) {
      const report = await db
        .select({ id: reports.id })
        .from(reports)
        .where(eq(reports.assignmentId, bath.assignmentId));
      expected.set(report[0]!.id, (await responsibleActor(bath.assignmentId)).employeeId);
    }
    const rows = await db
      .select({
        actor: auditLog.actorEmployeeId,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        changes: auditLog.changes,
      })
      .from(auditLog)
      .where(eq(auditLog.organizationId, orgId));
    const reportRows = rows.filter((r) => r.entityType === "report");
    expect(reportRows.length).toBe(expected.size);
    for (const row of reportRows) {
      expect(row.actor).toBe(expected.get(row.entityId));
    }
    const bathEntities = new Set([
      "field_answer",
      "deviation",
      "checkpoint_result",
      "tgiu_details",
      "rule_suggestion_decision",
    ]);
    const inspectors = new Set(expected.values());
    const bathRows = rows.filter((r) => bathEntities.has(r.entityType));
    expect(bathRows.length).toBeGreaterThan(0);
    for (const row of bathRows) {
      expect(row.actor).not.toBe(admin.employeeId);
      expect(inspectors.has(row.actor!)).toBe(true);
    }
  });

  it("2.6.33 ingen persondata i loggen, revisjonsloggen eller rapportdataene", async () => {
    const plan = await resolveTestdataPlan(db, orgId, TESTDATA_SEED, TEST_NOW);
    const words = [
      ...TESTDATA_FIRST_NAMES,
      ...TESTDATA_LAST_NAMES,
      ...TESTDATA_STREET_NAMES,
      ...plan.employees.map((e) => e.name),
      ...plan.contacts.map((c) => c.name),
    ];
    const texts: string[] = [logged];
    const audits = await db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(eq(auditLog.organizationId, orgId));
    texts.push(...audits.map((a) => JSON.stringify(a.changes)));
    const devs = (await db.execute(
      sql`select concat_ws(' ', deviation_text, cause_text, consequence_text, cost_text) as t from deviations where organization_id = ${orgId}`,
    )) as unknown as { t: string }[];
    const measures = (await db.execute(
      sql`select text as t from deviation_measures where organization_id = ${orgId}`,
    )) as unknown as { t: string }[];
    const tgiu = (await db.execute(
      sql`select concat_ws(' ', reason, alternative_check_method, alternative_check_result, risk_assessment, how_to_examine) as t from tgiu_details where organization_id = ${orgId}`,
    )) as unknown as { t: string }[];
    const answers = (await db.execute(
      sql`select coalesce(value_text, '') as t from field_answers where organization_id = ${orgId}`,
    )) as unknown as { t: string }[];
    texts.push(...[...devs, ...measures, ...tgiu, ...answers].map((r) => r.t));
    for (const text of texts) {
      expect(text).not.toContain("@");
      expect(text).not.toMatch(/\bgnr\b|\bbnr\b|\+47/i);
      for (const word of words) {
        expect(new RegExp(`(?<![\\p{L}])${word}(?![\\p{L}])`, "u").test(text), word).toBe(false);
      }
    }
  });

  // --- 2.7 Tenant-isolasjon (oppslagene) ---

  it("2.7.37 getRoomView fra en annen organisasjon gir ikke tilgang og lekker ingenting", async () => {
    const other = await createOrganization("Annen organisasjon");
    const user = await createUser({ name: "Admin annen" });
    await createEmployee(user, other.id, ["admin"]);
    const showcase = await findShowcaseBathReport(db, orgId);
    expect(showcase).not.toBeNull();
    const room = { assignmentId: showcase!.assignmentId, roomId: showcase!.roomId };
    await expect(getRoomView(user, orgId, room)).rejects.toBeInstanceOf(AccessDeniedError);
    const error = await getRoomView(user, other.id, room).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AccessDeniedError);
    expect(String((error as Error).message)).not.toMatch(/Bad|2026-|wet_room/);
  });

  it("visningsbadet finnes på innholdet: under arbeid, TG3 og TGIU i samme bad", async () => {
    const showcase = await findShowcaseBathReport(db, orgId);
    const placed = baths.find((b) => b.scenarioKey === "showcase")!;
    expect(showcase?.roomId).toBe(placed.roomId);
    expect(showcase?.assignmentNumber).toBe(placed.bath.assignmentLabel);
  });

  it("oppsummeringen har de nye tabellene, bad fylt ut og scenariokartet", () => {
    expect(summary.created.reports).toBeGreaterThan(0);
    expect(summary.created.ruleSuggestionDecisions).toBeGreaterThan(0);
    expect(summary.bathsSkipped).toBe(0);
    expect(summary.bathTemplatePublished).toBe(true);
    expect(summary.bathScenarioMap).toHaveLength(MANDATORY_BATH_SCENARIO_KEYS.length);
  });

  // --- 2.8 Tilgang per rolle (endrer visningsbadet; etter lesetestene) ---

  describe("2.8 tilgang per rolle", () => {
    it.each(["inspector", "office", "manager", "admin"] as const)(
      "2.8.39 %s åpner en seedet rapport slik badskjermen tillater",
      async (role) => {
        const user = await createUser({ name: `Rolle ${role}` });
        await createEmployee(user, orgId, [role]);
        const showcase = (await findShowcaseBathReport(db, orgId))!;
        const view = await getRoomView(user, orgId, {
          assignmentId: showcase.assignmentId,
          roomId: showcase.roomId,
        });
        expect(view.state).toBe("started");
        if (view.state !== "started") return;
        expect(view.canEdit).toBe(role !== "office");
        expect(view.checkpoints.some((c) => c.deviations.some((d) => d.tg === 3))).toBe(true);
      },
    );

    it("2.8.40 takstmann kan endre med inspectors_edit_all på; kontor kan ikke avgjøre forslag", async () => {
      const bath = baths.find((b) => b.scenarioKey === "rejected_suggestion")!;
      const room = { assignmentId: bath.assignmentId, roomId: bath.roomId };
      const inspector = await createUser({ name: "Takstmann ekstra" });
      await createEmployee(inspector, orgId, ["inspector"]);
      const saved = await saveField(inspector, orgId, room, {
        table: "checkpoint_results",
        checkpointKey: "wet_room.floor",
        field: "description_text",
        value: null,
        base: null,
      });
      expect(saved.status).toBe("saved");
      const office = await createUser({ name: "Kontor ekstra" });
      await createEmployee(office, orgId, ["office"]);
      await expect(
        decideSuggestion(office, orgId, room, {
          id: uuidv7(),
          ruleKey: BATH_RULES.noMoisture,
          decision: "accepted",
        }),
      ).rejects.toBeInstanceOf(AccessDeniedError);
    });

    it("2.8.41 admin lagrer på et urørt punkt i visningsbadet med inspectors_edit_all av, og har alle rettighetene", async () => {
      const settingsBefore = (
        await db.select().from(organizations).where(eq(organizations.id, orgId))
      )[0]!.settings;
      await setInspectorsEditAll(orgId, false);
      try {
        const admin = await seedAdmin();
        const showcase = (await findShowcaseBathReport(db, orgId))!;
        const room = { assignmentId: showcase.assignmentId, roomId: showcase.roomId };
        const view = await getRoomView(admin, orgId, room);
        if (view.state !== "started") throw new Error("ikke startet");
        const ventilation = view.checkpoints.find(
          (c) => c.checkpointKey === "wet_room.ventilation",
        )!;
        expect(ventilation.resultId).toBeNull();
        const open = view.suggestions.filter((s) => s.state === "triggered" && !s.latestDecision);
        expect(open).toEqual([]);
        const empty = { text: null, number: null, optionKeys: null };
        const result = await saveField(admin, orgId, room, {
          table: "field_answers",
          id: uuidv7(),
          elementKey: "wet_room.ventilation_type",
          field: "value",
          value: { ...empty, optionKeys: ["balanced"] },
          base: empty,
        });
        expect(result.status).toBe("saved");
        // Tilbake til tomt svar (ingen sletting), så visningsbadet er likt for de andre testene
        const back = await saveField(admin, orgId, room, {
          table: "field_answers",
          id: uuidv7(),
          elementKey: "wet_room.ventilation_type",
          field: "value",
          value: empty,
          base: { ...empty, optionKeys: ["balanced"] },
        });
        expect(back.status).toBe("saved");
        expect(await adminPermissions()).toEqual(adminPermissionsBefore);
      } finally {
        await db
          .update(organizations)
          .set({ settings: settingsBefore })
          .where(eq(organizations.id, orgId));
      }
    });

    it("2.8.42 seed-admin er urørt", async () => {
      expect(adminAfterSeed).toEqual(adminBefore);
      const now = await adminState();
      expect(now.roles).toEqual(adminBefore.roles);
      expect(now.deactivatedAt).toEqual(adminBefore.deactivatedAt);
    });
  });

  // --- 2.4 Ny kjøring og myk sletting (endrer data; sist) ---

  describe("2.4 ny kjøring", () => {
    it("2.4.26–29 andre kjøring skriver ingenting, beholder svar endret for hånd og myk-slettede avvik", async () => {
      // Et svar endret for hånd av takstmannen og et avvik som er myk-slettet
      const bath = baths.find((b) => b.scenarioKey === "tg2_age")!;
      const room = { assignmentId: bath.assignmentId, roomId: bath.roomId };
      const answer = bath.view.answers.find((a) => a.elementKey === "wet_room.ceiling_type")!;
      const changed = await saveField(bath.actor, orgId, room, {
        table: "field_answers",
        id: answer.id,
        elementKey: "wet_room.ceiling_type",
        field: "value",
        value: { text: null, number: null, optionKeys: ["panel"] },
        base: answer.value,
      });
      expect(changed.status).toBe("saved");
      const hms = baths.find((b) => b.scenarioKey === "hms")!;
      const hmsDeviation = hms.view.checkpoints
        .flatMap((c) => c.deviations)
        .find((d) => d.kind === "hms")!;
      await removeDeviation(
        hms.actor,
        orgId,
        { assignmentId: hms.assignmentId, roomId: hms.roomId },
        hmsDeviation.id,
      );

      const countsBefore = await countRows();
      const stampsBefore = await rowStamps();
      const tgBefore = (await loadBaths(orgId)).map((b) =>
        b.view.checkpoints.map((c) => `${c.checkpointKey}:${c.tg ?? "-"}`).join(","),
      );

      const again = await seedTestdata({ db, now: TEST_NOW, seed: TESTDATA_SEED });
      expect(again.bathsFilled).toBe(0);
      expect(again.bathsSkipped).toBe(baths.length);
      for (const table of ["reports", "fieldAnswers", "deviations", "tgiuDetails"] as const) {
        expect(again.created[table]).toBe(0);
      }

      expect(await countRows()).toEqual(countsBefore);
      expect(await rowStamps()).toEqual(stampsBefore);
      const tgAfter = (await loadBaths(orgId)).map((b) =>
        b.view.checkpoints.map((c) => `${c.checkpointKey}:${c.tg ?? "-"}`).join(","),
      );
      expect(tgAfter).toEqual(tgBefore);

      const [kept] = await db
        .select({ value: fieldAnswers.valueOptionKeys })
        .from(fieldAnswers)
        .where(eq(fieldAnswers.id, answer.id));
      expect(kept?.value).toEqual(["panel"]);
      const [removed] = await db
        .select({ deletedAt: deviations.deletedAt })
        .from(deviations)
        .where(eq(deviations.id, hmsDeviation.id));
      expect(removed?.deletedAt).not.toBeNull();
      const live = await db
        .select({ id: deviations.id })
        .from(deviations)
        .innerJoin(checkpointResults, eq(checkpointResults.id, deviations.checkpointResultId))
        .where(
          and(
            eq(checkpointResults.roomId, hms.roomId),
            eq(deviations.kind, "hms"),
            isNull(deviations.deletedAt),
          ),
        );
      expect(live).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// 2.7 Tenant-isolasjon og annen organisasjon
// ---------------------------------------------------------------------------------------------

/** Et testoppdrag med bad og rapport i organisasjonen (for oppslagene). */
async function bathReportIn(organizationId: string, options: { showcase?: boolean } = {}) {
  const assignment = await createAssignment(organizationId, {
    status: "in_progress",
    inspectionAt: new Date("2026-10-01T10:00:00Z"),
  });
  await createOrder(organizationId, {
    externalRef: "TD-0001",
    assignmentId: assignment.id,
    status: "converted",
  });
  const building = await createBuilding(organizationId, { assignmentId: assignment.id });
  const floor = await createFloor(organizationId, { buildingId: building.id });
  const room = await createRoom(organizationId, { floorId: floor.id, roomType: "bathroom" });
  const report = await createReportRow(organizationId, { assignmentId: assignment.id });
  if (options.showcase) {
    const result = await createCheckpointResultRow(organizationId, {
      reportId: report.id,
      roomId: room.id,
      tgDirect: "IU",
    });
    await createDeviationRow(organizationId, {
      reportId: report.id,
      checkpointResultId: result.id,
      kind: "tg",
      tg: 3,
    });
  }
  return { assignment, room, report };
}

describe("2.7 tenant-isolasjon", { timeout: LONG }, () => {
  it("2.7.34 findTestdataBathReports", async () => {
    await resetDatabase();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await bathReportIn(grantA.organizationId);
        const b = await bathReportIn(grantB.organizationId);
        return { a: [a.report.id], b: [b.report.id] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId);
        return findTestdataBathReports(db, grant.organizationId);
      },
      idOf: (row) => row.reportId,
    });
  });

  it("2.7.34 findShowcaseBathReport", async () => {
    await resetDatabase();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await bathReportIn(grantA.organizationId, { showcase: true });
        const b = await bathReportIn(grantB.organizationId, { showcase: true });
        return { a: [a.report.id], b: [b.report.id] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId);
        const row = await findShowcaseBathReport(db, grant.organizationId);
        return row ? [row] : [];
      },
      idOf: (row) => row.reportId,
    });
  });

  it("2.7.35–36 andre organisasjoner er urørt, og deres rapporter teller ikke for Byggcon", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const orgId = await prepare();
    await runSampleSeed(SEED_ENV, TEST_NOW);
    const other = await createOrganization("Egen organisasjon");
    await publishTemplate(other.id);
    const own = await bathReportIn(other.id, { showcase: true });
    const sample = (
      await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(sql`${organizations.name} <> ${brand.companyName}`)
    ).map((r) => r.id);
    const before = await Promise.all(sample.map((id) => countRows(id)));

    const summary = await seedTestdata({ db, now: TEST_NOW, seed: TESTDATA_SEED });
    expect(summary.bathsSkipped).toBe(0);
    expect(summary.bathsFilled).toBeGreaterThan(0);
    const after = await Promise.all(sample.map((id) => countRows(id)));
    for (let i = 0; i < sample.length; i += 1) {
      const { audit_log: _a, ...b } = before[i]!;
      const { audit_log: _b, ...a } = after[i]!;
      expect(a).toEqual(b);
    }
    // Rommet i den andre organisasjonen har fortsatt bare sine egne rader
    const rows = await db
      .select({ id: checkpointResults.id })
      .from(checkpointResults)
      .where(eq(checkpointResults.roomId, own.room.id));
    expect(rows).toHaveLength(1);
    expect((await findTestdataBathReports(db, orgId)).length).toBeGreaterThan(0);
    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------------------------
// Feil før noe skrives: vakten, manglende befaringsdato og forslag som ikke stemmer
// ---------------------------------------------------------------------------------------------

/** Del 1 uten publisert mal (badene hoppes over), så malen publiseres etterpå. */
async function partOneOnly(): Promise<string> {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const orgId = await prepare({ template: false });
  const summary = await seedTestdata({ db, now: TEST_NOW, seed: TESTDATA_SEED });
  expect(summary.bathTemplatePublished).toBe(false);
  expect(summary.bathsFilled).toBe(0);
  return orgId;
}

describe("seedTestdataBaths: feil før noe skrives", { timeout: LONG }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each([
    ["production", "production"],
    ["tom", ""],
    ["mangler", undefined],
  ])(
    "2.5.30 APP_ENVIRONMENT %s: norsk feil, ingen nye rader og ingen transaksjon",
    async (_, value) => {
      await resetDatabase();
      await runSeed(SEED_ENV);
      await publishTemplate(await byggconId());
      const before = await countRows();
      vi.stubEnv("APP_ENVIRONMENT", value as string);
      const transaction = vi.spyOn(db, "transaction");
      await expect(
        seedTestdataBaths({ db, now: TEST_NOW, seed: TESTDATA_SEED }),
      ).rejects.toBeInstanceOf(TestdataNotAllowedError);
      await expect(seedTestdata({ db, now: TEST_NOW, seed: TESTDATA_SEED })).rejects.toBeInstanceOf(
        TestdataNotAllowedError,
      );
      expect(transaction).not.toHaveBeenCalled();
      vi.unstubAllEnvs();
      expect(await countRows()).toEqual(before);
    },
  );

  it("2.1.8 oppdrag under arbeid uten befaringsdato gir norsk feil, og ingen rapport lages", async () => {
    const orgId = await partOneOnly();
    const placements = await planTestdataBaths({
      db,
      organizationId: orgId,
      seed: TESTDATA_SEED,
      now: TEST_NOW,
    });
    const inProgress = placements.find((p) => p.bath.status === "in_progress")!;
    await db
      .update(assignments)
      .set({ inspectionAt: null })
      .where(eq(assignments.id, inProgress.assignmentId));
    await publishTemplate(orgId);
    const error = await seedTestdataBaths({ db, now: TEST_NOW, seed: TESTDATA_SEED }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(TestdataBathError);
    expect((error as Error).message).toContain(inProgress.bath.assignmentLabel);
    expect((error as Error).message).toMatch(/mangler befaringsdato/);
    expect((await countRows()).reports).toBe(0);
  });

  it("2.2.14 et forslag som mangler i den publiserte malen stopper seed før noe skrives", async () => {
    const orgId = await partOneOnly();
    // Malen uten TG0-regelen: badene som venter TG0, mangler forslaget
    await publishTemplate(orgId, {
      ...wetRoomTemplate,
      rules: wetRoomTemplate.rules.filter((r) => r.key !== BATH_RULES.noMoisture),
      rule_conditions: wetRoomTemplate.rule_conditions.filter(
        (c) => c.rule_key !== BATH_RULES.noMoisture,
      ),
      rule_test_cases: wetRoomTemplate.rule_test_cases.filter(
        (c) => c.rule_key !== BATH_RULES.noMoisture,
      ),
    });
    const transaction = vi.spyOn(db, "transaction");
    const error = await seedTestdataBaths({ db, now: TEST_NOW, seed: TESTDATA_SEED }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(TestdataBathError);
    expect((error as Error).message).toMatch(/wet_room\.hole_no_elevated_moisture/);
    expect((error as Error).message).toMatch(/Ingen bad er fylt ut/);
    expect(transaction).not.toHaveBeenCalled();
    const counts = await countRows();
    for (const table of BATH_TABLES) expect(counts[table], table).toBe(0);
  });

  it("2.2.14b et uventet forslag stopper seed før noe skrives, uten TG1 og uten halv rapport", async () => {
    const orgId = await partOneOnly();
    // Malen der TGIU-regelen også slår til på «utført uten funn»: uventet forslag i mange bad
    await publishTemplate(orgId, {
      ...wetRoomTemplate,
      rule_conditions: wetRoomTemplate.rule_conditions.map((c) =>
        c.rule_key === BATH_RULES.notDone
          ? { ...c, operator: "in", value: ["not_done", "done_no_findings"] }
          : c,
      ),
    });
    const error = await seedTestdataBaths({ db, now: TEST_NOW, seed: TESTDATA_SEED }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(TestdataBathError);
    expect((error as Error).message).toMatch(
      /gir forslaget wet_room\.hole_drilling_not_done, som scenarioet ikke venter/,
    );
    const counts = await countRows();
    for (const table of BATH_TABLES) expect(counts[table], table).toBe(0);
  });

  it("2.2.14b smøremembran uten dokumentasjon, 15 år, i badet uten avvik gir uventet forslag", () => {
    const base = bathScenarioByKey("no_deviations");
    const scenario = {
      ...base,
      answers: {
        ...base.answers,
        "wet_room.documentation": { "wet_room.documentation_type": "none" },
        "wet_room.membrane_drain": {
          ...base.answers["wet_room.membrane_drain"],
          "wet_room.membrane_type": "liquid_membrane",
        },
      },
      expected: {
        deviations: [
          ...bathScenarioByKey("tg2_age").expected.deviations.filter(
            (d) => d.checkpointKey === "wet_room.documentation",
          ),
        ],
      },
    };
    expect(() =>
      checkBathAgainstRules({
        scenario,
        bath: {
          assignmentKey: "2026-00099",
          assignmentLabel: "2026-00099",
          status: "completed",
          inspectionYear: 2026,
          roomOrder: 1,
          roomName: "Bad",
          bathYear: 2011,
          bathYearSource: "documented",
        },
        inspectionYear: 2026,
        document: wetRoomTemplate,
      }),
    ).toThrow(/gir forslaget wet_room\.membrane_past_lifespan, som scenarioet ikke venter/);
  });

  it("uten publisert systemmal hoppes badene over med en tydelig linje, og ingenting skrives", async () => {
    await partOneOnly();
    const counts = await countRows();
    for (const table of BATH_TABLES) expect(counts[table], table).toBe(0);
  });

  it("A515: med inspectors_edit_all av fylles ikke badene til takstmenn uten rett til å endre", async () => {
    const orgId = await partOneOnly();
    await publishTemplate(orgId);
    await setInspectorsEditAll(orgId, false);
    const summary = await seedTestdataBaths({ db, now: TEST_NOW, seed: TESTDATA_SEED });
    expect(summary.bathsWithoutAccess).toBeGreaterThan(0);
    const admin = await seedAdmin();
    const rows = await db
      .select({ actor: auditLog.actorEmployeeId })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.organizationId, orgId),
          inArray(auditLog.entityType, ["report", "field_answer"]),
        ),
      );
    for (const row of rows) expect(row.actor).not.toBe(admin.employeeId);
  });
});
