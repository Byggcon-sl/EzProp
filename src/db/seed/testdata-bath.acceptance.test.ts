import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import { EVAL_GUESS_WORDS } from "@/core/ai/evals/run";
import { emptyKnownValues } from "@/core/ai/redaction";
import { ROOM_TYPES } from "@/core/buildings/codes";
import {
  getRoomView,
  removeDeviation,
  saveField,
  startReport,
  type AnswerValue,
  type CheckpointView,
  type RoomRef,
  type RoomReportView,
} from "@/core/reports";
import { missingTgiuDetails } from "@/core/reports/logic/warnings";
import { evaluateRules, runRuleTestCases, type JsonValue, type RuleResult } from "@/core/rules";
import { WET_ROOM_LIFESPANS } from "@/core/rules/data/lifespans";
import { WET_ROOM_THRESHOLDS } from "@/core/rules/data/thresholds";
import {
  createTemplateFamily,
  parseTemplateDocument,
  publishVersion,
  saveDraftContent,
  type TemplateDocument,
} from "@/core/templates";
import { db } from "@/db/client";
import { brand } from "@/shared/config/brand";
import { resetEnvCache } from "@/shared/config/env";
import { uuidv7 } from "@/shared/lib/uuid";
import { fakeAiProvider } from "../../../tests/ai";
import {
  TEST_NOW,
  createAssignment,
  createBuilding,
  createEmployee,
  createFloor,
  createOrder,
  createRoom,
  createTeamMember,
  createTemplate,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { containsWord, loadKnownValues, redactText } from "../../../tests/redaction";
import { createBathroomFixture } from "../../../tests/report-fixtures";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { runSeed } from "./run";
import { wetRoomTemplate } from "./templates/wet-room";
import { TESTDATA_TABLES, seedTestdata, type TestdataSummary } from "./testdata";
import { TESTDATA_ENVIRONMENT_MESSAGE, TestdataNotAllowedError } from "./testdata-guard";
import { summaryLines } from "./testdata-index";
import { buildTestdataPlan } from "./testdata-plan";
import { TESTDATA_EMAIL_DOMAIN, TESTDATA_ORDER_PREFIX, TESTDATA_SEED } from "./testdata.data";

vi.mock("server-only", () => ({}));

/*
 * Akseptkriteriene for «Testdata, del 2» (docs/funksjoner/fase2a-testdata-del-2.md) som tester,
 * skrevet av testskriver uavhengig av seed-koden (testplanen seksjon 3). Én `it` per kriterium i
 * kortets rekkefølge og med samme navn. Kriteriet om versjon og A501–A514 dekkes i gjennomgangen.
 *
 * Testene bruker bare det offentlige grensesnittet: `seedTestdata`, oppsummeringen
 * (`TestdataSummary`, `summaryLines`), `TESTDATA_TABLES`, databasen, regelmotoren, advarslene i
 * `getRoomView` og `missingTgiuDetails`, og de avtalte eksportene fra `testdata-bath.data.ts` og
 * `testdata-bath.ts` (kortet, «Avtale med testskriver»). De to nye modulene lastes dynamisk, slik
 * at filen typesjekker før seed-koden finnes; formen de skal ha, står i typene under.
 *
 * Ingen forventet TG står som eget tall her. TG leses fra malen (utfallets art, testsakene) og
 * regeldataene (`lifespans.ts`, `thresholds.ts`). Alle data er oppdiktet.
 *
 * Støtter hovedmål: færre reklamasjoner (testbadene er faglig riktige, og hver TG kommer fra
 * regelmotoren eller malen) og best for de ansatte (testmiljøet har realistiske bad som kan prøves
 * uten utfylling for hånd, og skriptet rører aldri annen organisasjon eller ekte arbeid).
 */

vi.setConfig({ testTimeout: 600_000, hookTimeout: 240_000 });

// --- Avtalt form på de nye modulene (kortet, «Avtale med testskriver») ---------------------------

type BathScenario = {
  key: string;
  mandatory: boolean;
  answers: Readonly<Record<string, unknown>>;
  expected?: unknown;
} & Record<string, unknown>;

type BathDataModule = {
  TESTDATA_BATH_SCENARIOS: readonly BathScenario[];
  MANDATORY_BATH_SCENARIO_KEYS: readonly string[];
  TG3_COST_BANDS: Readonly<Record<string, unknown>>;
  TESTDATA_BATH_FREE_TEXTS: unknown;
  TESTDATA_DRAFT_LABEL: string;
};

type BathRef = { reportId: string; assignmentId: string; roomId: string };

type BathModule = {
  findTestdataBathReports: (database: typeof db, organizationId: string) => Promise<BathRef[]>;
  findShowcaseBathReport: (database: typeof db, organizationId: string) => Promise<BathRef | null>;
};

type SeedWithScenarios = (input: {
  db: typeof db;
  now: Date;
  seed: number;
  bathScenarios?: readonly BathScenario[];
}) => Promise<TestdataSummary>;

const BATH_DATA_PATH = "./testdata-bath.data";
const BATH_PATH = "./testdata-bath";

async function loadBathData(): Promise<BathDataModule> {
  const mod = (await import(/* @vite-ignore */ BATH_DATA_PATH)) as Partial<BathDataModule>;
  expect(Array.isArray(mod.TESTDATA_BATH_SCENARIOS), "TESTDATA_BATH_SCENARIOS finnes").toBe(true);
  expect(Array.isArray(mod.MANDATORY_BATH_SCENARIO_KEYS), "MANDATORY_BATH_SCENARIO_KEYS").toBe(
    true,
  );
  expect(mod.TG3_COST_BANDS, "TG3_COST_BANDS finnes").toBeTypeOf("object");
  expect(mod.TESTDATA_BATH_FREE_TEXTS, "TESTDATA_BATH_FREE_TEXTS finnes").toBeDefined();
  expect(mod.TESTDATA_DRAFT_LABEL, "TESTDATA_DRAFT_LABEL finnes").toBeTypeOf("string");
  return mod as BathDataModule;
}

async function loadBath(): Promise<BathModule> {
  const mod = (await import(/* @vite-ignore */ BATH_PATH)) as Partial<BathModule>;
  expect(mod.findTestdataBathReports, "findTestdataBathReports finnes").toBeTypeOf("function");
  expect(mod.findShowcaseBathReport, "findShowcaseBathReport finnes").toBeTypeOf("function");
  return mod as BathModule;
}

// --- Faste koder fra malen -------------------------------------------------------------------

const env = { SEED_ADMIN_EMAIL: "admin@example.com", SEED_ADMIN_NAME: "Test Admin" };
const plan = buildTestdataPlan({ seed: TESTDATA_SEED, anchor: TEST_NOW });

const SYSTEM = { kind: "system", reportType: "condition_report" } as const;
const ELIGIBLE = ["in_progress", "completed", "invoiced"] as const;
const FINISHED = ["completed", "invoiced"] as const;
const WET_ROOM_TYPES: string[] = ROOM_TYPES.filter((t) => t.group === "wet_room").map((t) => t.key);

const GENERAL = "wet_room.general";
const DOCUMENTATION = "wet_room.documentation";
const MEMBRANE_DRAIN = "wet_room.membrane_drain";
const ADJACENT = "wet_room.adjacent";

const EL = {
  buildYear: "wet_room.build_year",
  buildYearSource: "wet_room.build_year_source",
  documentation: "wet_room.documentation_type",
  membraneType: "wet_room.membrane_type",
  membraneYear: "wet_room.membrane_year",
  hole: "wet_room.hole_drilling",
  reading: "wet_room.hole_moisture_reading",
  unit: "wet_room.hole_moisture_unit",
  location: "wet_room.hole_moisture_location",
  construction: "wet_room.hole_construction",
  reason: "wet_room.hole_drilling_reason",
  reasonNote: "wet_room.hole_drilling_reason_note",
  ownerInformed: "wet_room.owner_informed",
  otherMethod: "wet_room.other_moisture_method",
  otherResult: "wet_room.other_moisture_result",
  risk: "wet_room.not_investigated_risk",
  damageProne: "wet_room.construction_damage_prone",
} as const;

const RULE_PAST_LIFESPAN = "wet_room.membrane_past_lifespan";
const RULE_BEFORE_2000 = "wet_room.membrane_before_2000";
const RULE_MOISTURE = "wet_room.hole_moisture_over_limit";
const RULE_NOT_DRILLED = "wet_room.hole_drilling_not_done";
const RULE_NO_MOISTURE = "wet_room.hole_no_elevated_moisture";

const FOUR_WARNINGS = [
  "tg3_on_age_only",
  "tgiu_suggested_not_set",
  "tgiu_details_missing",
  "checkpoint_done_without_tg",
] as const;

function parsedTemplate(): TemplateDocument {
  const result = parseTemplateDocument(wetRoomTemplate);
  if (!result.success) throw new Error("badmalen er ugyldig");
  return result.document;
}
const TEMPLATE = parsedTemplate();
const CHECKPOINT_KEYS = TEMPLATE.checkpoints.map((c) => c.key);
const QUESTION_KEYS = new Set(TEMPLATE.deviation_questions.map((q) => q.key));

/** Utfallets art i malen for spørsmålet (`tg2`, `tg3`, `choose_tg2_tg3` eller `hms`). */
function outcomeKindOf(questionKey: string | null): string | null {
  if (questionKey === null) return null;
  return TEMPLATE.outcomes.find((o) => o.question_key === questionKey)?.kind ?? null;
}

/** Fast TG fra utfallet i malen (`tg2` → 2, `tg3` → 3), ellers `null`. */
function fixedTgOf(questionKey: string | null): number | null {
  const kind = outcomeKindOf(questionKey);
  return kind === "tg2" || kind === "tg3" ? Number(kind.slice(2)) : null;
}

/** Fuktgrensen og enheten fra regeldataene. */
const MOISTURE_THRESHOLD = (() => {
  const condition = TEMPLATE.rule_conditions.find(
    (c) => c.rule_key === RULE_MOISTURE && c.threshold_key !== null,
  );
  const entry = WET_ROOM_THRESHOLDS.entries.find((t) => t.key === condition?.threshold_key);
  if (!entry) throw new Error("fant ikke fuktgrensen i regeldataene");
  return entry;
})();

/** Levetiden (laveste alder) for materialet uten dokumentasjon, fra alderstabellen. */
function lifespanWithout(material: string): number {
  const entry = WET_ROOM_LIFESPANS.entries.find(
    (e) =>
      e.material_code === material && (e.documentation === "without" || e.documentation === "any"),
  );
  if (!entry || entry.min_age === null) throw new Error(`mangler levetid for ${material}`);
  return entry.min_age;
}

/** Siste år i trinnet «før 2000» fra alderstabellen. */
const CUT_YEAR = (() => {
  const entry = WET_ROOM_LIFESPANS.entries.find(
    (e) => e.material_code === null && e.outcome_kind === "tg3",
  );
  if (!entry || entry.to_year === null) throw new Error("mangler trinnet før 2000");
  return entry.to_year;
})();

// --- Databasen -------------------------------------------------------------------------------

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(query)) as unknown as T[];
}

async function count(query: ReturnType<typeof sql>): Promise<number> {
  const [row] = await rows<{ n: number }>(query);
  return row?.n ?? -1;
}

const REPORT_TABLES = [
  "reports",
  "field_answers",
  "checkpoint_results",
  "deviations",
  "deviation_measures",
  "tgiu_details",
  "rule_suggestion_decisions",
] as const;

const COUNTED_TABLES = [
  ...REPORT_TABLES,
  "audit_log",
  "ai_usage_log",
  "assignments",
  "orders",
  "rooms",
  "employees",
  "users",
  "template_versions",
] as const;

/** Antall rader per tabell i hele databasen. */
async function countRows(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of COUNTED_TABLES) {
    out[table] = await count(sql`select count(*)::int as n from ${sql.identifier(table)}`);
  }
  return out;
}

/** Antall rader per tabell i én organisasjon. */
async function countRowsIn(organizationId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of [...REPORT_TABLES, "audit_log", "assignments", "rooms"]) {
    out[table] = await count(
      sql`select count(*)::int as n from ${sql.identifier(table)} where organization_id = ${organizationId}`,
    );
  }
  out.ai_usage_log = await count(
    sql`select count(*)::int as n from ai_usage_log where organization_id = ${organizationId}`,
  );
  return out;
}

/** `id:updated_at:deleted_at` for alle rapportrader i organisasjonen. */
async function reportRowSnapshot(organizationId: string): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const table of REPORT_TABLES) {
    const found = await rows<{ line: string }>(sql`
      select id::text || ':' || updated_at::text || ':' || coalesce(deleted_at::text, '-') as line
      from ${sql.identifier(table)} where organization_id = ${organizationId} order by id`);
    out[table] = found.map((row) => row.line);
  }
  return out;
}

async function byggconId(): Promise<string> {
  const found = await rows<{ id: string }>(
    sql`select id from organizations where name = ${brand.companyName} order by created_at`,
  );
  expect(found, "nøyaktig én Byggcon").toHaveLength(1);
  return found[0]!.id;
}

async function actorByEmail(email: string): Promise<Actor> {
  const [user] = await rows<Actor>(
    sql`select id, name, email from users where email = ${email.toLowerCase()}`,
  );
  if (!user) throw new Error("fant ikke brukeren");
  return user;
}

async function employeeIdOf(actor: Actor, organizationId: string): Promise<string> {
  const [row] = await rows<{ id: string }>(
    sql`select id from employees where user_id = ${actor.id} and organization_id = ${organizationId}`,
  );
  if (!row) throw new Error("fant ikke den ansatte");
  return row.id;
}

/** Publiserer badmalen som systemmal gjennom maltjenestene, som admin gjør i drift. */
async function publishSystemTemplate(admin: Actor, organizationId: string): Promise<string> {
  const { versionId } = await createTemplateFamily(admin, organizationId, {
    name: "Tilstandsrapport bolig",
    kind: "system",
    report_type: "condition_report",
  });
  await saveDraftContent(admin, organizationId, versionId, wetRoomTemplate, TEST_NOW);
  await publishVersion(admin, organizationId, versionId, "Publisert i testen.", TEST_NOW);
  return versionId;
}

type Setup = { orgId: string; admin: Actor; adminEmployeeId: string; versionId: string };

/** `pnpm db:seed` og publisert systemmal, som i testmiljøet før `pnpm db:seed:testdata`. */
async function setupByggcon(): Promise<Setup> {
  await runSeed(env);
  const orgId = await byggconId();
  const admin = await actorByEmail(env.SEED_ADMIN_EMAIL);
  const versionId = await publishSystemTemplate(admin, orgId);
  return { orgId, admin, adminEmployeeId: await employeeIdOf(admin, orgId), versionId };
}

function seedBaths(): Promise<TestdataSummary> {
  return seedTestdata({ db, now: TEST_NOW, seed: TESTDATA_SEED });
}

async function seedAll(): Promise<Setup & { summary: TestdataSummary }> {
  const setup = await setupByggcon();
  const summary = await seedBaths();
  return { ...setup, summary };
}

type BathRow = {
  assignment_id: string;
  number: string;
  status: string;
  external_ref: string | null;
  building: string;
  floor: string;
  room_id: string;
  room_name: string | null;
  room_type: string;
};

/** Alle våtrom i TD-oppdragene i organisasjonen, sortert på oppdragsnummer. */
async function loadBaths(organizationId: string): Promise<BathRow[]> {
  return rows<BathRow>(sql`
    select a.id as assignment_id, a.number, a.status, o.external_ref, rb.name as building,
      f.name as floor, r.id as room_id, r.name as room_name, r.room_type
    from rooms r
    join floors f on f.id = r.floor_id and f.organization_id = r.organization_id
    join report_buildings rb on rb.id = f.report_building_id and rb.organization_id = r.organization_id
    join assignments a on a.id = rb.assignment_id and a.organization_id = r.organization_id
    join orders o on o.assignment_id = a.id and o.organization_id = r.organization_id
    where r.organization_id = ${organizationId}
      and o.external_ref like ${`${TESTDATA_ORDER_PREFIX}%`}
      and r.deleted_at is null and f.deleted_at is null and rb.deleted_at is null
      and a.deleted_at is null
      and r.room_type in ${sql.raw(`(${WET_ROOM_TYPES.map((t) => `'${t}'`).join(", ")})`)}
    order by a.number, rb.name, f.level, r.name`);
}

type Started = Extract<RoomReportView, { state: "started" }>;
type BathView = { bath: BathRow; room: RoomRef; view: Started };

function refOf(bath: BathRow): RoomRef {
  return { assignmentId: bath.assignment_id, roomId: bath.room_id };
}

async function startedViewOf(actor: Actor, organizationId: string, room: RoomRef) {
  const view = await getRoomView(actor, organizationId, room);
  expect(view.state, `rapporten for rommet ${room.roomId} er startet`).toBe("started");
  return view as Started;
}

/** Visningen av hvert bad i oppdrag som skal ha rapport. */
async function eligibleViews(actor: Actor, organizationId: string): Promise<BathView[]> {
  const out: BathView[] = [];
  for (const bath of await loadBaths(organizationId)) {
    if (!(ELIGIBLE as readonly string[]).includes(bath.status)) continue;
    const room = refOf(bath);
    out.push({ bath, room, view: await startedViewOf(actor, organizationId, room) });
  }
  return out;
}

function isFinished(bath: BathRow): boolean {
  return (FINISHED as readonly string[]).includes(bath.status);
}

function checkpointOf(view: Started, key: string): CheckpointView {
  const found = view.checkpoints.find((c) => c.checkpointKey === key);
  if (!found) throw new Error(`fant ikke punktet ${key}`);
  return found;
}

function answerOf(view: Started, elementKey: string): AnswerValue | null {
  return view.answers.find((a) => a.elementKey === elementKey)?.value ?? null;
}

function optionOf(view: Started, elementKey: string): string | null {
  return answerOf(view, elementKey)?.optionKeys?.[0] ?? null;
}

function numberOf(view: Started, elementKey: string): number | null {
  return answerOf(view, elementKey)?.number ?? null;
}

function textOf(view: Started, elementKey: string): string | null {
  return answerOf(view, elementKey)?.text ?? null;
}

function hasValue(value: AnswerValue | null): boolean {
  if (value === null) return false;
  return (
    (value.optionKeys !== null && value.optionKeys.length > 0) ||
    value.number !== null ||
    (value.text !== null && value.text.trim() !== "")
  );
}

function isBlank(text: string | null | undefined): boolean {
  return text === null || text === undefined || text.trim() === "";
}

function where(item: BathView): string {
  return `${item.bath.number} ${item.bath.room_name ?? item.bath.room_type} (${item.bath.status})`;
}

/** Svarene i badet slik regelmotoren leser dem (samme form som serveren). */
function ruleAnswersOf(view: Started): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  for (const answer of view.answers) {
    const value = answer.value;
    if (value.optionKeys && value.optionKeys.length > 0) out[answer.elementKey] = value.optionKeys;
    else if (value.number !== null) out[answer.elementKey] = value.number;
    else if (value.text !== null && value.text.trim() !== "") out[answer.elementKey] = value.text;
  }
  return out;
}

function evaluate(answers: Record<string, JsonValue>, inspectionYear: number | null) {
  return evaluateRules({
    template: SYSTEM,
    document: TEMPLATE,
    answers,
    inspectionYear,
    lifespans: WET_ROOM_LIFESPANS,
    thresholds: WET_ROOM_THRESHOLDS,
  });
}

function resultOf(results: RuleResult[], ruleKey: string): RuleResult {
  const found = results.find((r) => r.rule_key === ruleKey);
  if (!found) throw new Error(`regelen ${ruleKey} ga ikke svar`);
  return found;
}

function triggered(view: Started) {
  return view.suggestions.filter((s) => s.state === "triggered" && s.suggestion !== null);
}

// --- Tekstsjekkene (gjetteord, standarden, persondata) ------------------------------------------

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wordPattern(word: string, caseSensitive: boolean): RegExp {
  return new RegExp(`(?<![\\p{L}])${escapeRegExp(word)}(?![\\p{L}])`, caseSensitive ? "u" : "iu");
}

/** Henvisninger til standarden og andre systemer (samme liste som kopisjekken). */
const REFERENCES: { word: string; caseSensitive: boolean }[] = [
  { word: "NS 3600", caseSensitive: false },
  { word: "NS 3424", caseSensitive: false },
  { word: "NS", caseSensitive: true },
  { word: "TEK", caseSensitive: true },
  { word: "Byggforsk", caseSensitive: false },
  { word: "IVIT", caseSensitive: false },
  { word: "SmartTakst", caseSensitive: false },
];

function guessWordsIn(text: string): string[] {
  return EVAL_GUESS_WORDS.filter((word) => wordPattern(word, false).test(text));
}

function referencesIn(text: string): string[] {
  return REFERENCES.filter(({ word, caseSensitive }) =>
    wordPattern(word, caseSensitive).test(text),
  ).map(({ word }) => word);
}

const RUN_LENGTH = 8;

function wordsOf(text: string): string[] {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((w) => w.length > 0);
}

function runsOf(text: string): string[] {
  const list = wordsOf(text);
  const out: string[] = [];
  for (let i = 0; i + RUN_LENGTH <= list.length; i++) {
    out.push(list.slice(i, i + RUN_LENGTH).join(" "));
  }
  return out;
}

function researchFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return researchFiles(path);
    return /\.(md|txt|json|csv)$/u.test(name) ? [path] : [];
  });
}

let researchRuns: Set<string> | null = null;
/** Alle 8 ord på rad i de låste referansetekstene (`docs/kartlegging/`). */
function researchRunSet(): Set<string> {
  if (researchRuns) return researchRuns;
  const set = new Set<string>();
  for (const file of researchFiles(join(process.cwd(), "docs", "kartlegging"))) {
    for (const run of runsOf(readFileSync(file, "utf8"))) set.add(run);
  }
  researchRuns = set;
  return set;
}

function copiedRun(text: string): string | null {
  const set = researchRunSet();
  return runsOf(text).find((run) => set.has(run)) ?? null;
}

/** Navn, e-post, telefon, adresser og matrikkel fra planen i del 1 (oppdiktet). */
const PLAN_SECRETS: string[] = (() => {
  const out = new Set<string>();
  for (const employee of plan.employees) {
    out.add(employee.name);
    out.add(employee.email);
  }
  for (const firm of plan.firms) out.add(firm.name);
  for (const contact of plan.contacts) {
    for (const value of Object.values(contact)) {
      if (typeof value === "string" && /@|\d{3}/.test(value)) out.add(value);
    }
    const named = contact as unknown as { firstName?: string; lastName?: string };
    if (named.firstName && named.lastName) out.add(`${named.firstName} ${named.lastName}`);
  }
  for (const order of plan.orders) {
    if (!order.converted) continue;
    const assignment = order.converted.assignment;
    for (const party of assignment.parties) {
      out.add(party.name);
      if (party.email) out.add(party.email);
      if (party.phone) out.add(party.phone);
    }
    out.add(assignment.property.address);
    out.add(`${assignment.property.gnr}/${assignment.property.bnr}`);
  }
  return [...out].filter((value) => value.trim().length >= 4);
})();

function planSecretsIn(text: string): string[] {
  return PLAN_SECRETS.filter((secret) => containsWord(text, secret));
}

/** Alle tekstverdier i en verdi, med sti. */
function allStrings(value: unknown, path = ""): { path: string; text: string }[] {
  if (typeof value === "string") return [{ path, text: value }];
  if (Array.isArray(value)) return value.flatMap((item, i) => allStrings(item, `${path}[${i}]`));
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, item]) =>
      allStrings(item, path === "" ? key : `${path}.${key}`),
    );
  }
  return [];
}

/** Tekster med mellomrom (fritekst), ikke faste koder. */
function proseOf(value: unknown): { path: string; text: string }[] {
  return allStrings(value).filter(({ text }) => /\s/.test(text.trim()));
}

/** Objektene i en verdi som har nøkkelen (dypt). */
function objectsWithKey(value: unknown, key: string): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap((item) => objectsWithKey(item, key));
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  const own = Object.hasOwn(record, key) ? [record] : [];
  return [...own, ...Object.values(record).flatMap((item) => objectsWithKey(item, key))];
}

/** Alle tekstproblemer: gjetteord, henvisning, kopi fra researchen og persondata. */
function textProblems(texts: { path: string; text: string }[]): string[] {
  return texts.flatMap(({ path, text }) => {
    const problems: string[] = [];
    for (const word of guessWordsIn(text)) problems.push(`${path}: gjetteord «${word}»`);
    for (const word of referencesIn(text)) problems.push(`${path}: henvisning «${word}»`);
    const run = copiedRun(text);
    if (run !== null) problems.push(`${path}: kopi «${run}»`);
    if (redactText(text, emptyKnownValues()).count > 0) problems.push(`${path}: persondatamønster`);
    for (const secret of planSecretsIn(text)) problems.push(`${path}: fra planen «${secret}»`);
    return problems;
  });
}

// --- Planen i del 1 ---------------------------------------------------------------------------

type PlanRoom = { yearRenovated: number | null; buildYear: number };

/** Rommet i planen for et bad i databasen (ordre, bygning, etasje og rom). */
function planRoomOf(bath: BathRow): PlanRoom {
  const order = plan.orders.find((o) => o.externalRef === bath.external_ref);
  if (!order || !order.converted) throw new Error(`fant ikke ${bath.external_ref} i planen`);
  const assignment = order.converted.assignment;
  for (const building of assignment.buildings) {
    if (building.name !== bath.building) continue;
    for (const floor of building.floors) {
      if (floor.name !== bath.floor) continue;
      const room = floor.rooms.find(
        (r) => r.name === bath.room_name && r.roomType === bath.room_type,
      );
      if (room)
        return { yearRenovated: room.yearRenovated, buildYear: assignment.property.buildYear };
    }
  }
  throw new Error(`fant ikke rommet i planen for ${bath.external_ref}`);
}

// --- Scenariokartet i oppsummeringen ----------------------------------------------------------

const SCENARIO_LINE = /^(.+): oppdrag ([^,\s]+), (.+)$/u;

function scenarioLines(summary: TestdataSummary): string[] {
  return summaryLines(summary).filter((line) => SCENARIO_LINE.test(line));
}

/** Kostnadsintervallet for TG3 i datafilen, slått opp på spørsmålskoden (kortet, avtalen). */
function bandFor(bands: Readonly<Record<string, unknown>>, questionKey: string): string | null {
  const short = questionKey.split(".").pop() ?? questionKey;
  const value = bands[questionKey] ?? bands[short];
  if (typeof value === "string") return value;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["bandKey", "band_key", "costBandKey", "cost_band_key", "key"]) {
      if (typeof record[key] === "string") return record[key] as string;
    }
  }
  return null;
}

/** Meldingen i feilen og i årsakene, slått sammen. */
function messagesOf(error: unknown): string {
  const out: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    out.push(current.message);
    current = current.cause;
  }
  return out.join(" | ");
}

async function errorFrom(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }
  throw new Error("kallet kastet ikke");
}

/** Badet uten avvik: åtte punkt ferdige, ingen avvik og godtatt TG0-forslag på tilliggende. */
function isNoDeviationBath(item: BathView): boolean {
  const { view } = item;
  if (!isFinished(item.bath)) return false;
  if (view.checkpoints.some((c) => c.deviations.length > 0 || !c.done)) return false;
  return view.suggestions.some(
    (s) =>
      s.suggestion?.kind === "tg0" &&
      s.checkpointKey === ADJACENT &&
      s.latestDecision?.decision === "accepted",
  );
}

/** Sjekker badet uten avvik slik kriteriet beskriver det. Gir listen over feil. */
function noDeviationProblems(item: BathView): string[] {
  const { view } = item;
  const problems: string[] = [];
  for (const checkpoint of view.checkpoints) {
    const expected = checkpoint.checkpointKey === ADJACENT ? "0" : "1";
    if (checkpoint.tg !== expected || checkpoint.tgDirect !== expected) {
      problems.push(`${where(item)} ${checkpoint.checkpointKey}: TG ${checkpoint.tg}`);
    }
    if (checkpoint.warnings.length > 0) {
      problems.push(`${where(item)} ${checkpoint.checkpointKey}: advarsler`);
    }
  }
  const documentation = optionOf(view, EL.documentation);
  if (documentation !== "declaration_of_conformity" && documentation !== "wet_room_certificate") {
    problems.push(`${where(item)}: dokumentasjon ${documentation}`);
  }
  const reading = numberOf(view, EL.reading);
  if (
    optionOf(view, EL.hole) !== "done_no_findings" ||
    optionOf(view, EL.unit) !== MOISTURE_THRESHOLD.unit ||
    reading === null ||
    reading >= MOISTURE_THRESHOLD.value
  ) {
    problems.push(`${where(item)}: hulltaking uten funn under grensen mangler`);
  }
  return problems;
}

// --- Oppsett per test -------------------------------------------------------------------------

const savedEnvironment = process.env.APP_ENVIRONMENT;

beforeEach(async () => {
  await resetDatabase();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (savedEnvironment === undefined) delete process.env.APP_ENVIRONMENT;
  else process.env.APP_ENVIRONMENT = savedEnvironment;
  resetEnvCache();
});

describe("testdata del 2: akseptkriteriene (testplanen seksjon 3)", () => {
  it("`pnpm db:seed:testdata` gir rapport låst til publisert systemmal i hvert våtrom i oppdrag med status «under arbeid», «ferdig» og «fakturert», og ingen i «bestilt».", async () => {
    const { orgId, admin, versionId } = await seedAll();
    const baths = await loadBaths(orgId);
    for (const status of ELIGIBLE) {
      expect(
        baths.some((b) => b.status === status),
        `minst ett bad i ${status}`,
      ).toBe(true);
    }

    const [version] = await rows<{ status: string; kind: string; report_type: string }>(sql`
      select v.status, f.kind, f.report_type from template_versions v
      join template_families f on f.id = v.family_id where v.id = ${versionId}`);
    expect(version).toEqual({
      status: "published",
      kind: "system",
      report_type: "condition_report",
    });

    const eligibleRooms: string[] = [];
    for (const bath of baths) {
      const view = await getRoomView(admin, orgId, refOf(bath));
      if (bath.status === "ordered") {
        expect(view.state, `${bath.number} er bestilt`).toBe("not_started");
        continue;
      }
      expect(view.state, `${bath.number} ${bath.room_name}`).toBe("started");
      if (view.state !== "started") continue;
      eligibleRooms.push(bath.room_id);
      const [report] = await rows<{ template_version_id: string; assignment_id: string }>(sql`
        select template_version_id, assignment_id from reports
        where id = ${view.reportId} and organization_id = ${orgId}`);
      expect(report).toEqual({ template_version_id: versionId, assignment_id: bath.assignment_id });
    }
    expect(eligibleRooms.length).toBeGreaterThan(0);

    expect(
      await count(sql`
        select count(*)::int as n from reports r
        join assignments a on a.id = r.assignment_id and a.organization_id = r.organization_id
        where r.organization_id = ${orgId} and a.status = 'ordered'`),
      "ingen rapport i «bestilt»",
    ).toBe(0);

    const { findTestdataBathReports } = await loadBath();
    const found = await findTestdataBathReports(db, orgId);
    expect(new Set(found.map((r) => r.roomId))).toEqual(new Set(eligibleRooms));
  });

  it("Alle tolv pliktige scenarioer er brukt minst én gang, med fast fordeling; samme frø gir samme fordeling (test på datafilen og i databasen). Oppsummeringen viser scenariokartet (scenarionavn, oppdragsnummer, rom) og antall bad fylt ut, uten `@`, navn eller adresse.", async () => {
    const data = await loadBathData();
    const keys = [...data.MANDATORY_BATH_SCENARIO_KEYS];
    expect(keys).toHaveLength(12);
    expect(new Set(keys).size).toBe(12);
    const mandatory = data.TESTDATA_BATH_SCENARIOS.filter((s) => s.mandatory).map((s) => s.key);
    expect(new Set(mandatory)).toEqual(new Set(keys));

    const first = await seedAll();
    const lines = scenarioLines(first.summary);
    expect(lines, "én linje per pliktig scenario").toHaveLength(12);
    const names = lines.map((line) => SCENARIO_LINE.exec(line)![1]);
    expect(new Set(names).size, "ulike scenarionavn").toBe(12);

    const baths = await loadBaths(first.orgId);
    const eligible = baths.filter((b) => (ELIGIBLE as readonly string[]).includes(b.status));
    for (const line of lines) {
      const [, , number, roomName] = SCENARIO_LINE.exec(line)!;
      const bath = eligible.find((b) => b.number === number && b.room_name === roomName);
      expect(bath, `badet i «${line}» finnes og skal ha rapport`).toBeDefined();
      const view = await startedViewOf(first.admin, first.orgId, refOf(bath!));
      expect(view.answers.length, `badet i «${line}» er fylt ut`).toBeGreaterThan(0);
    }

    const all = summaryLines(first.summary);
    const filledLine = all.find((line) => /fylt ut/i.test(line));
    expect(filledLine, "linje med antall bad fylt ut").toBeDefined();
    expect(filledLine!.match(/\d+/g) ?? []).toContain(String(eligible.length));
    for (const line of [...lines, filledLine!]) {
      expect(line).not.toContain("@");
      expect(planSecretsIn(line), line).toEqual([]);
      expect(line, line).not.toMatch(/gnr|bnr|\d+\/\d+/i);
    }

    // Samme frø på en tom database gir samme fordeling
    await resetDatabase();
    const second = await seedAll();
    expect(scenarioLines(second.summary)).toEqual(lines);
  });

  it("Badet uten avvik har sju punkt med TG1 og tilliggende med TG0 fra et godtatt forslag, og dokumentasjon lagt fram.", async () => {
    const { orgId, admin } = await seedAll();
    const views = await eligibleViews(admin, orgId);
    const noDeviation = views.filter(isNoDeviationBath);
    expect(noDeviation.length, "minst ett bad uten avvik").toBeGreaterThan(0);
    expect(noDeviation.flatMap(noDeviationProblems)).toEqual([]);
    for (const item of noDeviation) {
      const adjacent = item.view.suggestions.find(
        (s) => s.checkpointKey === ADJACENT && s.suggestion?.kind === "tg0",
      );
      expect(adjacent?.ruleKey).toBe(RULE_NO_MOISTURE);
      expect(adjacent?.stale).toBe(false);
    }
  });

  it("Et forslag scenarioet ikke venter, stopper seed med tydelig feil og ruller tilbake badet (test: scenarioet «Bad uten avvik» uten den godtatte TG0-beslutningen, så TG0-forslaget på tilliggende kommer uventet).", async () => {
    const data = await loadBathData();
    const { orgId } = await setupByggcon();
    const noDeviationKey = data.MANDATORY_BATH_SCENARIO_KEYS[9];
    const target = data.TESTDATA_BATH_SCENARIOS.find((s) => s.key === noDeviationKey);
    expect(target, "scenarioet «Bad uten avvik» er nummer 10").toBeDefined();
    expect(
      (target as unknown as { decisions: unknown[] }).decisions.length,
      "scenarioet godtar TG0-forslaget",
    ).toBeGreaterThan(0);

    // Varianten venter ingen forslag, men reglene gir TG0-forslaget på tilliggende (hull uten funn)
    const forced = data.TESTDATA_BATH_SCENARIOS.map((scenario) =>
      scenario.key === noDeviationKey ? { ...scenario, decisions: [] } : scenario,
    );

    const error = await errorFrom(
      (seedTestdata as unknown as SeedWithScenarios)({
        db,
        now: TEST_NOW,
        seed: TESTDATA_SEED,
        bathScenarios: forced,
      }),
    );
    const message = messagesOf(error);
    expect(message, "tydelig norsk feil om forslaget").toMatch(/forslag/i);
    expect(message).not.toContain("@");
    expect(planSecretsIn(message)).toEqual([]);

    // Ingen bad er fylt ut: seed kontrollerer alle badene før noe skrives (A518)
    expect(
      await count(sql`
        select count(*)::int as n from field_answers fa where fa.organization_id = ${orgId}`),
      "ingen halv rapport",
    ).toBe(0);
    expect(
      await count(sql`
        select count(*)::int as n from field_answers fa
        join template_elements te on te.id = fa.element_id
        where fa.organization_id = ${orgId} and te.key = ${EL.membraneType}
          and 'liquid_membrane' = any(fa.value_option_keys)
          and exists (
            select 1 from field_answers d join template_elements de on de.id = d.element_id
            where d.organization_id = fa.organization_id and d.room_id = fa.room_id
              and d.report_id = fa.report_id and de.key = ${EL.documentation}
              and 'none' = any(d.value_option_keys))
          and exists (
            select 1 from checkpoint_results cr
            where cr.organization_id = fa.organization_id and cr.room_id = fa.room_id
              and cr.report_id = fa.report_id and cr.tg_direct = '1')
          and not exists (
            select 1 from deviations dv
            where dv.organization_id = fa.organization_id and dv.report_id = fa.report_id
              and dv.deleted_at is null)`),
      "ingen TG1 på et bad med smøremembran uten dokumentasjon og uten avvik",
    ).toBe(0);
  });

  it("Ferdige bad med dokumentasjon «Ingen» eller tom har `missing_membrane_documentation` med TG2 og uten kostnad (A510).", async () => {
    const { orgId, admin } = await seedAll();
    const questionKey = `${DOCUMENTATION}.missing_membrane_documentation`;
    const fixedTg = fixedTgOf(questionKey);
    expect(fixedTg, "utfallet har fast TG i malen").not.toBeNull();

    const finished = (await eligibleViews(admin, orgId)).filter((item) => isFinished(item.bath));
    const without = finished.filter((item) => {
      const documentation = optionOf(item.view, EL.documentation);
      return documentation === null || documentation === "none";
    });
    expect(without.length, "minst ett ferdig bad uten dokumentasjon").toBeGreaterThan(0);
    for (const item of without) {
      const found = checkpointOf(item.view, DOCUMENTATION).deviations.filter(
        (d) => d.questionKey === questionKey,
      );
      expect(found, where(item)).toHaveLength(1);
      expect(found[0]!.kind).toBe("tg");
      expect(found[0]!.tg).toBe(fixedTg);
      expect(found[0]!.cost.type).toBe("none");
    }
  });

  it("«Eier informert» er avkrysset bare ved `owner_refused`; TGIU med `concrete_or_masonry` har feltet tomt, har begrunnelse, annen fuktkontroll (metode og resultat), risiko, skadeutsatt og «hva må til», og gir ingen advarsel `tgiu_details_missing`.", async () => {
    const { orgId, admin } = await seedAll();
    const views = await eligibleViews(admin, orgId);
    const problems: string[] = [];
    let ownerRefused = 0;
    let concrete = 0;

    for (const item of views) {
      const { view } = item;
      const reason = optionOf(view, EL.reason);
      const informedAnswer = numberOf(view, EL.ownerInformed) === 1;
      const adjacent = checkpointOf(view, ADJACENT);
      const tgiu = adjacent.tgiuDetails;
      if (reason === "owner_refused") ownerRefused += 1;
      if (reason !== "owner_refused" && informedAnswer) {
        problems.push(`${where(item)}: eier informert uten owner_refused`);
      }
      if (reason !== "owner_refused" && tgiu?.ownerInformed === true) {
        problems.push(`${where(item)}: TGIU eier informert uten owner_refused`);
      }
      if (adjacent.tgDirect !== "IU") continue;
      if (!tgiu) {
        problems.push(`${where(item)}: TGIU uten opplysninger`);
        continue;
      }
      if (adjacent.warnings.some((w) => w.code === "tgiu_details_missing")) {
        problems.push(`${where(item)}: advarselen tgiu_details_missing`);
      }
      const requirements = { alternativeCheck: true, ownerInformed: reason === "owner_refused" };
      const missing = missingTgiuDetails(tgiu, requirements);
      if (missing.length > 0) problems.push(`${where(item)}: mangler ${missing.join(", ")}`);
      if (reason === "owner_refused" && (!informedAnswer || tgiu.ownerInformed !== true)) {
        problems.push(`${where(item)}: eier nektet, men ikke informert`);
      }
      if (reason === "concrete_or_masonry") {
        concrete += 1;
        if (tgiu.ownerInformed === true || informedAnswer) {
          problems.push(`${where(item)}: concrete_or_masonry med eier informert`);
        }
        for (const field of [EL.reasonNote, EL.otherMethod, EL.otherResult, EL.risk]) {
          if (isBlank(textOf(view, field))) problems.push(`${where(item)}: ${field} er tom`);
        }
        if (optionOf(view, EL.damageProne) === null) {
          problems.push(`${where(item)}: skadeutsatt er ikke svart`);
        }
      }
    }
    expect(problems).toEqual([]);
    expect(ownerRefused, "minst ett bad der eier nektet").toBeGreaterThan(0);
    expect(concrete, "minst én TGIU med concrete_or_masonry").toBeGreaterThan(0);
  });

  it("Ingen testbad har dokumentasjonen `other_written`; datatesten feiler hvis et ferdig eller fakturert bad har det (A513).", async () => {
    const data = await loadBathData();
    const inData = allStrings(data.TESTDATA_BATH_SCENARIOS).filter(
      ({ text }) => text === "other_written",
    );
    expect(inData, "scenariofilen bruker ikke other_written").toEqual([]);

    const { orgId, admin } = await seedAll();
    const views = await eligibleViews(admin, orgId);
    const withOther = views.filter(
      (item) => optionOf(item.view, EL.documentation) === "other_written",
    );
    expect(withOther.map(where)).toEqual([]);
    expect(
      await count(sql`
        select count(*)::int as n from field_answers fa
        join template_elements te on te.id = fa.element_id
        where fa.organization_id = ${orgId} and te.key = ${EL.documentation}
          and 'other_written' = any(fa.value_option_keys)`),
    ).toBe(0);
  });

  it("Regelmotoren kjørt på hele fordelingen (pliktige og tilfeldige) med hvert bads år gir nøyaktig forslagene i `expected`, også aldersforslaget etter aldersprofilen; `open` finnes bare på punkt som ikke står ferdig (A514).", async () => {
    const { orgId, admin } = await seedAll();
    const views = await eligibleViews(admin, orgId);
    const problems: string[] = [];

    for (const item of views) {
      const { view } = item;
      const results = evaluate(ruleAnswersOf(view), view.inspectionYear.year);
      for (const suggestion of view.suggestions) {
        const own = results.find((r) => r.rule_key === suggestion.ruleKey);
        if (
          !own ||
          own.state !== suggestion.state ||
          !isDeepStrictEqual(own.suggestion, suggestion.suggestion)
        ) {
          problems.push(`${where(item)} ${suggestion.ruleKey}: regelmotoren gir noe annet`);
        }
        if (suggestion.stale)
          problems.push(`${where(item)} ${suggestion.ruleKey}: gjelder ikke lenger`);
      }
      for (const suggestion of triggered(view)) {
        const checkpoint = checkpointOf(view, suggestion.checkpointKey);
        if (suggestion.latestDecision === null && checkpoint.done) {
          problems.push(`${where(item)} ${suggestion.ruleKey}: åpent forslag på ferdig punkt`);
        }
      }
      for (const checkpoint of view.checkpoints) {
        if (checkpoint.warnings.some((w) => w.code === "suggestion_no_longer_applies")) {
          problems.push(
            `${where(item)} ${checkpoint.checkpointKey}: forslaget gjelder ikke lenger`,
          );
        }
      }

      // Aldersprofilen: før 2000 gir TG3-forslaget uansett sjikttype, og aldri TG2 i tillegg
      const year = numberOf(view, EL.membraneYear) ?? numberOf(view, EL.buildYear);
      if (year === null) continue;
      const before2000 = resultOf(results, RULE_BEFORE_2000).state === "triggered";
      const pastLifespan = resultOf(results, RULE_PAST_LIFESPAN).state === "triggered";
      if (year <= CUT_YEAR && !before2000)
        problems.push(`${where(item)}: ${year} uten TG3-forslag`);
      if (year > CUT_YEAR && before2000) problems.push(`${where(item)}: ${year} med TG3-forslag`);
      if (before2000 && pastLifespan) problems.push(`${where(item)}: TG3 og TG2 for alder`);
      const membrane = checkpointOf(view, MEMBRANE_DRAIN);
      for (const ruleKey of [RULE_BEFORE_2000, RULE_PAST_LIFESPAN]) {
        const suggestion = view.suggestions.find((s) => s.ruleKey === ruleKey);
        if (suggestion?.state !== "triggered" || !membrane.done) continue;
        if (suggestion.latestDecision?.decision !== "accepted") {
          problems.push(`${where(item)} ${ruleKey}: aldersforslaget er ikke godtatt`);
        }
      }
    }
    expect(problems).toEqual([]);
    expect(views.length).toBeGreaterThan(12);
  });

  it("Datatesten feiler for vekt-%-tekst med betong eller mur, for RF % på ferdig tilliggende med TG1, og for «utført uten funn» med 15 vekt-% eller mer.", async () => {
    const { orgId, admin } = await seedAll();
    const views = await eligibleViews(admin, orgId);
    const problems: string[] = [];
    let weightPercent = 0;
    for (const item of views) {
      const { view } = item;
      const unit = optionOf(view, EL.unit);
      const adjacent = checkpointOf(view, ADJACENT);
      if (unit === "weight_percent") {
        weightPercent += 1;
        for (const field of [EL.location, EL.construction]) {
          const text = textOf(view, field) ?? "";
          if (/betong|\bmur/iu.test(text)) problems.push(`${where(item)} ${field}: «${text}»`);
        }
      }
      if (unit === "relative_humidity" && adjacent.done) {
        problems.push(`${where(item)}: RF % på ferdig tilliggende (TG ${adjacent.tg})`);
      }
      const reading = numberOf(view, EL.reading);
      if (
        optionOf(view, EL.hole) === "done_no_findings" &&
        unit === MOISTURE_THRESHOLD.unit &&
        reading !== null &&
        reading >= MOISTURE_THRESHOLD.value
      ) {
        problems.push(`${where(item)}: utført uten funn med ${reading}`);
      }
      if (adjacent.warnings.some((w) => w.code === "no_findings_with_reading_over_limit")) {
        problems.push(`${where(item)}: advarselen no_findings_with_reading_over_limit`);
      }
    }
    expect(problems).toEqual([]);
    expect(weightPercent, "minst ett bad med vekt-%").toBeGreaterThan(0);
  });

  it("Hver `fieldNote` i `expected` består testene for gjetteord, kopi fra standarden og persondata.", async () => {
    const data = await loadBathData();
    const planned = data.TESTDATA_BATH_SCENARIOS.flatMap((scenario) =>
      objectsWithKey(scenario.expected, "plannedPhotos").map((deviation) => ({
        scenario: scenario.key,
        deviation,
      })),
    );
    expect(planned.length, "forventede avvik med planlagte bilder").toBeGreaterThan(0);

    const notes: { path: string; text: string }[] = [];
    const problems: string[] = [];
    for (const { scenario, deviation } of planned) {
      const note = deviation.fieldNote;
      if (typeof note !== "string" || note.trim() === "") {
        problems.push(`${scenario}: avvik uten fieldNote`);
        continue;
      }
      notes.push({ path: `${scenario}.fieldNote`, text: note });
      const photos = deviation.plannedPhotos;
      if (!Array.isArray(photos) || photos.length === 0) problems.push(`${scenario}: ingen bilder`);
      for (const photo of Array.isArray(photos) ? photos : []) {
        if (
          typeof photo !== "string" ||
          /person|eier|ansikt|\.(jpe?g|png|heic|webp)\b/iu.test(photo)
        ) {
          problems.push(`${scenario}: planlagt bilde «${String(photo)}»`);
        }
      }
    }
    problems.push(...textProblems(notes));
    expect(problems).toEqual([]);
  });

  it("Integrasjonstesten måler hele `seedTestdata` og feiler over 60 sekunder.", async () => {
    const { orgId } = await setupByggcon();
    const started = performance.now();
    await seedBaths();
    const elapsed = performance.now() - started;
    expect(elapsed, `seedTestdata tok ${Math.round(elapsed)} ms`).toBeLessThan(60_000);
    expect(
      await count(sql`select count(*)::int as n from reports where organization_id = ${orgId}`),
      "kjøringen la inn rapporter",
    ).toBeGreaterThan(0);
  });

  it("Hvert scenario kjørt gjennom regelmotoren gir forslaget malens testsak forventer, både med befaringsåret og med klokken flyttet to år fram.", async () => {
    // Testsakene i malen består
    const cases = runRuleTestCases({
      template: SYSTEM,
      document: TEMPLATE,
      lifespans: WET_ROOM_LIFESPANS,
      thresholds: WET_ROOM_THRESHOLDS,
    });
    expect(cases.length).toBeGreaterThan(0);
    expect(cases.filter((c) => !c.passed).map((c) => `${c.rule_key} ${c.name}`)).toEqual([]);

    const setup = await setupByggcon();
    // Klokken flyttes to år fram før seed; befaringsåret skal komme fra oppdraget
    const moved = new Date(TEST_NOW.getTime() + 2 * 365 * 86_400_000);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(moved);
    try {
      await seedBaths();
      const views = await eligibleViews(setup.admin, setup.orgId);
      expect(views.length).toBeGreaterThan(0);
      const problems: string[] = [];
      for (const item of views) {
        const { view } = item;
        if (view.inspectionYear.source !== "assignment") {
          problems.push(`${where(item)}: befaringsåret kommer ikke fra oppdraget`);
        }
        if (view.inspectionYear.year === moved.getUTCFullYear()) {
          problems.push(`${where(item)}: befaringsåret er året på klokken`);
        }
        const results = evaluate(ruleAnswersOf(view), view.inspectionYear.year);
        for (const suggestion of triggered(view)) {
          const own = resultOf(results, suggestion.ruleKey);
          if (!isDeepStrictEqual(own.suggestion, suggestion.suggestion)) {
            problems.push(`${where(item)} ${suggestion.ruleKey}: regelmotoren gir noe annet`);
          }
          if (suggestion.stale)
            problems.push(`${where(item)} ${suggestion.ruleKey}: gjelder ikke lenger`);
          // Forslaget er ett av dem malens testsaker forventer for samme regel
          const expectedBy = TEMPLATE.rule_test_cases.filter(
            (c) =>
              c.rule_key === suggestion.ruleKey &&
              c.expected_state === "triggered" &&
              (suggestion.suggestion?.kind !== "outcome" ||
                (c.expected_outcome !== null &&
                  c.expected_outcome.question_key === suggestion.suggestion.question_key &&
                  c.expected_outcome.outcome_key === suggestion.suggestion.outcome_key)),
          );
          if (expectedBy.length === 0) {
            problems.push(
              `${where(item)} ${suggestion.ruleKey}: ingen testsak forventer forslaget`,
            );
          }
        }
        const stored = await rows<{ inspection_year: number }>(sql`
          select d.inspection_year from rule_suggestion_decisions d
          join checkpoint_results cr on cr.id = d.checkpoint_result_id and cr.organization_id = d.organization_id
          where d.organization_id = ${setup.orgId} and d.report_id = ${view.reportId}
            and cr.room_id = ${item.bath.room_id}`);
        for (const row of stored) {
          if (row.inspection_year !== view.inspectionYear.year) {
            problems.push(`${where(item)}: beslutning med befaringsår ${row.inspection_year}`);
          }
        }
      }
      expect(problems).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("TG bare gjennom tjenestene: hvert avvik med TG har en rad i `rule_suggestion_decisions` med samme `deviation_id`, eller kommer fra et utfall med fast TG, eller fra «velg TG2 eller TG3» med TG 2 eller 3 og en rad fra `setTgDirect` i revisjonsloggen. TG1 direkte bare på punkt uten avvik med TG og uten åpent forslag. En statisk test viser at seed-filene ikke skriver til `deviations`, `checkpoint_results` eller `rule_suggestion_decisions` med `insert` eller `update`.", async () => {
    // Statisk: seed-filene skriver ikke forbi tjenestene
    const seedDir = join(process.cwd(), "src", "db", "seed");
    const files = readdirSync(seedDir).filter(
      (name) => /^testdata.*\.ts$/u.test(name) && !name.endsWith(".test.ts"),
    );
    expect(files).toEqual(expect.arrayContaining(["testdata-bath.ts", "testdata-bath.data.ts"]));
    const tables =
      "deviations|checkpointResults|ruleSuggestionDecisions|deviationMeasures|tgiuDetails|fieldAnswers|reports";
    const rawTables =
      "deviations|checkpoint_results|rule_suggestion_decisions|deviation_measures|tgiu_details|field_answers|reports";
    const drizzleWrite = new RegExp(`\\.(insert|update)\\(\\s*(${tables})\\b`, "u");
    const rawWrite = new RegExp(`(insert\\s+into|update)\\s+"?(${rawTables})\\b`, "iu");
    for (const name of files) {
      const source = readFileSync(join(seedDir, name), "utf8");
      expect(source, `${name} skriver forbi tjenestene`).not.toMatch(drizzleWrite);
      expect(source, `${name} har rå SQL mot rapporttabellene`).not.toMatch(rawWrite);
    }

    const { orgId, admin } = await seedAll();
    const views = await eligibleViews(admin, orgId);
    const decided = new Set(
      (
        await rows<{ deviation_id: string }>(sql`
          select deviation_id from rule_suggestion_decisions
          where organization_id = ${orgId} and deviation_id is not null`)
      ).map((r) => r.deviation_id),
    );
    const audits = await rows<{
      entity_id: string;
      action: string;
      changes: Record<string, unknown>;
    }>(sql`
      select entity_id, action, changes from audit_log
      where organization_id = ${orgId} and entity_type = 'deviation'`);

    const problems: string[] = [];
    let withTg = 0;
    for (const item of views) {
      for (const checkpoint of item.view.checkpoints) {
        for (const deviation of checkpoint.deviations) {
          if (deviation.kind !== "tg" || deviation.tg === null) continue;
          withTg += 1;
          if (decided.has(deviation.id)) continue;
          const kind = outcomeKindOf(deviation.questionKey);
          if (fixedTgOf(deviation.questionKey) === deviation.tg) continue;
          const chosenInAudit = audits.some(
            (a) =>
              a.entity_id === deviation.id &&
              ((a.action === "create" && a.changes.tg === deviation.tg) ||
                (a.action === "update" && a.changes.field === "tg")),
          );
          if (kind === "choose_tg2_tg3" && chosenInAudit) continue;
          problems.push(`${where(item)} ${deviation.questionKey}: TG ${deviation.tg} uten kilde`);
        }
        if (checkpoint.tgDirect === "1") {
          if (checkpoint.deviations.some((d) => d.kind === "tg" && d.tg !== null)) {
            problems.push(`${where(item)} ${checkpoint.checkpointKey}: TG1 med avvik`);
          }
          const open = triggered(item.view).filter(
            (s) => s.checkpointKey === checkpoint.checkpointKey && s.latestDecision === null,
          );
          if (open.length > 0) {
            problems.push(`${where(item)} ${checkpoint.checkpointKey}: TG1 med åpent forslag`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
    expect(withTg, "datasettet har avvik med TG").toBeGreaterThan(0);
  });

  it("Hele datasettet: ingen TG3 uten kostnadsintervall, ingen TG2 eller TG3 uten årsak og konsekvens, ingen TG2 med kostnad, ingen TG0 utenfor tilliggende, ingen TG3 på dokumentasjon, ingen TG på HMS (testen feiler ved 0 HMS-avvik), ingen avvik utenfor badmalen, ingen ferdig punkt uten TG.", async () => {
    const data = await loadBathData();
    const { orgId, admin } = await seedAll();
    const views = await eligibleViews(admin, orgId);
    const problems: string[] = [];
    let hms = 0;
    let seen = 0;
    for (const item of views) {
      expect(item.view.checkpoints.map((c) => c.checkpointKey)).toEqual(CHECKPOINT_KEYS);
      for (const checkpoint of item.view.checkpoints) {
        const at = `${where(item)} ${checkpoint.checkpointKey}`;
        if (checkpoint.done && checkpoint.tg === null) problems.push(`${at}: ferdig uten TG`);
        if (checkpoint.tg === "0" && checkpoint.checkpointKey !== ADJACENT) {
          problems.push(`${at}: TG0 utenfor tilliggende`);
        }
        for (const deviation of checkpoint.deviations) {
          seen += 1;
          const tag = `${at} ${deviation.questionKey}`;
          if (deviation.questionKey === null || !QUESTION_KEYS.has(deviation.questionKey)) {
            problems.push(`${tag}: utenfor badmalen`);
          } else if (!deviation.questionKey.startsWith(`${checkpoint.checkpointKey}.`)) {
            problems.push(`${tag}: på feil punkt`);
          }
          if (deviation.kind === "hms") {
            hms += 1;
            if (deviation.tg !== null) problems.push(`${tag}: HMS med TG`);
            if (isBlank(deviation.consequenceText)) problems.push(`${tag}: HMS uten konsekvens`);
            if (deviation.measures.filter((m) => !isBlank(m.text)).length === 0) {
              problems.push(`${tag}: HMS uten tiltak`);
            }
            continue;
          }
          if (deviation.tg === 2 || deviation.tg === 3) {
            if (
              deviation.causeCriterion === null ||
              isBlank(deviation.causeText) ||
              isBlank(deviation.consequenceText)
            ) {
              problems.push(`${tag}: TG${deviation.tg} uten årsak og konsekvens`);
            }
          }
          if (deviation.tg === 2 && deviation.cost.type !== "none") {
            problems.push(`${tag}: TG2 med kostnad`);
          }
          if (deviation.tg === 3) {
            if (checkpoint.checkpointKey === DOCUMENTATION)
              problems.push(`${tag}: TG3 på dokumentasjon`);
            if (deviation.cost.type === "none") problems.push(`${tag}: TG3 uten kostnad`);
            if (deviation.cost.type === "band") {
              const band = bandFor(data.TG3_COST_BANDS, deviation.questionKey ?? "");
              if (deviation.cost.bandKey !== band) {
                problems.push(`${tag}: intervall ${deviation.cost.bandKey}, ventet ${band}`);
              }
            }
            if (
              deviation.cost.type === "approx" &&
              (deviation.cost.amount === null || deviation.cost.amount % 10_000 !== 0)
            ) {
              problems.push(`${tag}: eget beløp er ikke rundet til nærmeste 10 000`);
            }
          }
        }
      }
    }
    expect(problems).toEqual([]);
    expect(hms, "minst ett HMS-avvik").toBeGreaterThan(0);
    // Alle avvik i organisasjonen ligger i badene over (ingenting utenfor badmalen)
    expect(
      await count(
        sql`select count(*)::int as n from deviations where organization_id = ${orgId} and deleted_at is null`,
      ),
    ).toBe(seen);
  });

  it("«Ferdig» og «fakturert» har 8 av 8 punkt ferdige, hulltaking med måling eller TGIU med grunn, og ingen av advarslene `tg3_on_age_only`, `tgiu_suggested_not_set`, `tgiu_details_missing` og `checkpoint_done_without_tg`. «Under arbeid» har færre enn 8, og punktene som står igjen, har ingen svar (unntak: tilliggende kan ha hulltaking, forslag og TGIU uten å stå ferdig, A512).", async () => {
    const { orgId, admin } = await seedAll();
    const views = await eligibleViews(admin, orgId);
    const problems: string[] = [];
    let inProgress = 0;
    for (const item of views) {
      const { view } = item;
      expect(view.progress.total, where(item)).toBe(CHECKPOINT_KEYS.length);
      if (isFinished(item.bath)) {
        if (view.progress.done !== view.progress.total) {
          problems.push(`${where(item)}: ${view.progress.done} av ${view.progress.total}`);
        }
        const hole = optionOf(view, EL.hole);
        if (hole === "done_no_findings" || hole === "done_with_findings") {
          if (numberOf(view, EL.reading) === null || optionOf(view, EL.unit) === null) {
            problems.push(`${where(item)}: hull uten måling og enhet`);
          }
        } else if (hole === "not_done") {
          if (optionOf(view, EL.reason) === null)
            problems.push(`${where(item)}: ikke utført uten grunn`);
          const adjacent = checkpointOf(view, ADJACENT);
          if (adjacent.tgDirect !== "IU" || adjacent.tgiuDetails === null) {
            problems.push(`${where(item)}: ikke utført uten TGIU`);
          }
        } else {
          problems.push(`${where(item)}: hulltaking mangler`);
        }
        for (const checkpoint of view.checkpoints) {
          for (const warning of checkpoint.warnings) {
            if ((FOUR_WARNINGS as readonly string[]).includes(warning.code)) {
              problems.push(`${where(item)} ${checkpoint.checkpointKey}: ${warning.code}`);
            }
          }
        }
        continue;
      }
      inProgress += 1;
      if (view.progress.done >= view.progress.total) {
        problems.push(`${where(item)}: under arbeid med alle punkt ferdige`);
      }
      // Avbrutt befaring: ferdige punkt først i malens rekkefølge, resten urørt (unntatt tilliggende)
      const ordered = view.checkpoints.filter((c) => c.checkpointKey !== ADJACENT);
      const firstOpen = ordered.findIndex((c) => !c.done);
      for (const checkpoint of firstOpen < 0 ? [] : ordered.slice(firstOpen)) {
        const at = `${where(item)} ${checkpoint.checkpointKey}`;
        if (checkpoint.done) problems.push(`${at}: ferdig etter et punkt som står igjen`);
        const elements = view.document.elements
          .filter((e) => e.checkpoint_key === checkpoint.checkpointKey)
          .map((e) => e.key);
        if (elements.some((key) => hasValue(answerOf(view, key)))) problems.push(`${at}: har svar`);
        if (checkpoint.deviations.length > 0) problems.push(`${at}: har avvik`);
        if (checkpoint.tgDirect !== null) problems.push(`${at}: har TG ${checkpoint.tgDirect}`);
        if (!isBlank(checkpoint.descriptionText)) problems.push(`${at}: har beskrivelse`);
      }
    }
    expect(problems).toEqual([]);
    expect(inProgress, "minst ett bad under arbeid").toBeGreaterThan(0);
  });

  it("Testsakene fra fagansvarlig består (alder −18 gir TG2, −17 gir ingenting, 1999 gir TG3 uten TG2, 2000 gir TG2, hull nektet gir TGIU uten TG2, 14,9 vekt-% gir TG0 bare på tilliggende, 15 vekt-% gir fukt med riktig tiltak, RF % og «Ukjent» gir ikke vurdert).", () => {
    const year = TEST_NOW.getUTCFullYear();
    const foil = lifespanWithout("foil");
    const membrane = (y: number | null) => ({
      [EL.membraneType]: "foil",
      [EL.documentation]: "none",
      [EL.membraneYear]: y,
    });
    const outcomeOf = (results: RuleResult[], ruleKey: string) => {
      const suggestion = resultOf(results, ruleKey).suggestion;
      return suggestion?.kind === "outcome" ? suggestion : null;
    };

    // Alder −18 (levetiden for folie uten dokumentasjon) gir TG2-forslaget
    const atLimit = evaluate(membrane(year - foil), year);
    expect(resultOf(atLimit, RULE_PAST_LIFESPAN).state).toBe("triggered");
    expect(fixedTgOf(outcomeOf(atLimit, RULE_PAST_LIFESPAN)?.question_key ?? null)).toBe(
      fixedTgOf(`${MEMBRANE_DRAIN}.membrane_past_lifespan`),
    );
    expect(outcomeKindOf(`${MEMBRANE_DRAIN}.membrane_past_lifespan`)).toBe("tg2");

    // Alder −17 gir ingenting
    const below = evaluate(membrane(year - foil + 1), year);
    expect(below.filter((r) => r.state === "triggered").map((r) => r.rule_key)).toEqual([]);

    // 1999 gir TG3 uten TG2
    const cut = evaluate(membrane(CUT_YEAR), year);
    expect(resultOf(cut, RULE_BEFORE_2000).state).toBe("triggered");
    expect(outcomeKindOf(outcomeOf(cut, RULE_BEFORE_2000)?.question_key ?? null)).toBe("tg3");
    expect(resultOf(cut, RULE_PAST_LIFESPAN).state).not.toBe("triggered");

    // 2000 gir TG2 (folie uten dokumentasjon er eldre enn levetiden), ikke TG3
    const after = evaluate(membrane(CUT_YEAR + 1), year);
    expect(year - (CUT_YEAR + 1)).toBeGreaterThanOrEqual(foil);
    expect(resultOf(after, RULE_PAST_LIFESPAN).state).toBe("triggered");
    expect(resultOf(after, RULE_BEFORE_2000).state).not.toBe("triggered");

    // Hull nektet gir TGIU uten TG2
    const refused = evaluate({ [EL.hole]: "not_done", [EL.reason]: "owner_refused" }, year);
    expect(resultOf(refused, RULE_NOT_DRILLED).suggestion).toEqual({
      kind: "tgiu",
      checkpoint_key: ADJACENT,
    });
    expect(
      refused.filter((r) => r.state === "triggered" && r.suggestion?.kind === "outcome"),
    ).toEqual([]);

    // Rett under grensen gir TG0 bare på tilliggende
    const under = MOISTURE_THRESHOLD.value - 0.1;
    const noFindings = evaluate(
      { [EL.hole]: "done_no_findings", [EL.reading]: under, [EL.unit]: MOISTURE_THRESHOLD.unit },
      year,
    );
    expect(resultOf(noFindings, RULE_NO_MOISTURE).suggestion).toEqual({
      kind: "tg0",
      checkpoint_key: ADJACENT,
    });
    expect(resultOf(noFindings, RULE_MOISTURE).state).toBe("not_triggered");
    const tg0Elsewhere = TEMPLATE.rule_test_cases
      .flatMap((c) => evaluate(c.input as Record<string, JsonValue>, c.inspection_year))
      .filter((r) => r.suggestion?.kind === "tg0" && r.suggestion.checkpoint_key !== ADJACENT);
    expect(tg0Elsewhere).toEqual([]);

    // Grensen gir forhøyet fukt med «velg TG2 eller TG3», og tiltaket følger valgt TG
    const atThreshold = evaluate(
      {
        [EL.hole]: "done_with_findings",
        [EL.reading]: MOISTURE_THRESHOLD.value,
        [EL.unit]: MOISTURE_THRESHOLD.unit,
      },
      year,
    );
    const moisture = outcomeOf(atThreshold, RULE_MOISTURE);
    expect(moisture?.question_key).toBe(`${ADJACENT}.elevated_moisture`);
    expect(outcomeKindOf(moisture?.question_key ?? null)).toBe("choose_tg2_tg3");
    const measures = TEMPLATE.standard_measures.filter(
      (m) => m.question_key === moisture?.question_key && m.outcome_key === moisture?.outcome_key,
    );
    expect(new Set(measures.map((m) => m.applies_to_tg))).toEqual(new Set([2, 3]));

    // RF % gir ikke vurdert
    const humidity = evaluate(
      { [EL.hole]: "done_with_findings", [EL.reading]: 85, [EL.unit]: "relative_humidity" },
      year,
    );
    expect(resultOf(humidity, RULE_MOISTURE).state).toBe("not_evaluated");
    expect(resultOf(humidity, RULE_NO_MOISTURE).state).not.toBe("triggered");

    // «Ukjent» byggeår (B2.5) gir ikke vurdert for alder
    const unknown = evaluate(
      {
        [EL.buildYearSource]: "unknown",
        [EL.membraneType]: "foil",
        [EL.documentation]: "none",
      },
      year,
    );
    expect(resultOf(unknown, RULE_PAST_LIFESPAN).state).toBe("not_evaluated");
    expect(resultOf(unknown, RULE_BEFORE_2000).state).toBe("not_evaluated");

    // Alle testsakene i malen består
    const cases = runRuleTestCases({
      template: SYSTEM,
      document: TEMPLATE,
      lifespans: WET_ROOM_LIFESPANS,
      thresholds: WET_ROOM_THRESHOLDS,
    });
    expect(cases.filter((c) => !c.passed).map((c) => c.name)).toEqual([]);
  });

  it("`build_year` og `build_year_source` stemmer med `yearRenovated` (`owner_stated`) eller `buildYear` (`documented`), og `membrane_year` er tomt.", async () => {
    const { orgId, admin } = await seedAll();
    const views = await eligibleViews(admin, orgId);
    const problems: string[] = [];
    let unknown = 0;
    for (const item of views) {
      const { view } = item;
      if (hasValue(answerOf(view, EL.membraneYear))) problems.push(`${where(item)}: membrane_year`);
      const source = optionOf(view, EL.buildYearSource);
      const year = numberOf(view, EL.buildYear);
      if (source === null) {
        if (isFinished(item.bath)) problems.push(`${where(item)}: kilde for byggeåret mangler`);
        continue;
      }
      if (source === "unknown") {
        unknown += 1;
        if (year !== null) problems.push(`${where(item)}: ukjent med år ${year}`);
        if (isFinished(item.bath)) problems.push(`${where(item)}: «Ukjent» i ferdig bad`);
        continue;
      }
      const planned = planRoomOf(item.bath);
      const expected =
        planned.yearRenovated !== null
          ? { year: planned.yearRenovated, source: "owner_stated" }
          : { year: planned.buildYear, source: "documented" };
      if (year !== expected.year || source !== expected.source) {
        problems.push(
          `${where(item)}: ${year}/${source}, ventet ${expected.year}/${expected.source}`,
        );
      }
    }
    expect(problems).toEqual([]);
    expect(unknown, "minst ett bad med «Ukjent» byggeår").toBeGreaterThan(0);
  });

  it("To kjøringer på rad gir like mange rader per tabell og samme TG per bad. En rapport som er endret for hånd, og et avvik som er myk-slettet, røres ikke ved ny kjøring.", async () => {
    const { orgId, admin } = await seedAll();
    const views = await eligibleViews(admin, orgId);

    // Endret for hånd: beskrivelsen på «Generelt» i et ferdig bad
    const edited = views.find((item) => isFinished(item.bath))!;
    const general = checkpointOf(edited.view, GENERAL);
    const handText = "Endret for hånd i testen.";
    const saved = await saveField(admin, orgId, edited.room, {
      table: "checkpoint_results",
      checkpointKey: GENERAL,
      field: "description_text",
      value: handText,
      base: general.descriptionText,
    });
    expect(saved.status).toBe("saved");

    // Myk-slettet avvik
    const withDeviation = views.find((item) =>
      item.view.checkpoints.some((c) => c.deviations.length > 0),
    )!;
    const deviation = withDeviation.view.checkpoints.flatMap((c) => c.deviations)[0]!;
    const removed = await removeDeviation(admin, orgId, withDeviation.room, deviation.id);
    expect(removed.status).toBe("saved");

    const tgsOf = async () =>
      Object.fromEntries(
        (await eligibleViews(admin, orgId)).map((item) => [
          item.bath.room_id,
          item.view.checkpoints.map((c) => `${c.checkpointKey}:${c.tg}`),
        ]),
      );
    const before = {
      counts: await countRows(),
      snapshot: await reportRowSnapshot(orgId),
      tgs: await tgsOf(),
    };

    const second = await seedBaths();

    expect(await countRows()).toEqual(before.counts);
    expect(await reportRowSnapshot(orgId)).toEqual(before.snapshot);
    expect(await tgsOf()).toEqual(before.tgs);
    const after = await startedViewOf(admin, orgId, edited.room);
    expect(checkpointOf(after, GENERAL).descriptionText).toBe(handText);
    const [row] = await rows<{ deleted: boolean }>(
      sql`select deleted_at is not null as deleted from deviations where id = ${deviation.id}`,
    );
    expect(row?.deleted, "avviket står myk-slettet").toBe(true);
    expect((second as unknown as { bathsSkipped: unknown }).bathsSkipped).toBe(views.length);
  });

  it("Seed stopper med tydelig melding når `APP_ENVIRONMENT` ikke er development eller test, eller mangler, før noe skrives (0 nye rader).", async () => {
    for (const value of ["production", "", undefined] as const) {
      await resetDatabase();
      process.env.APP_ENVIRONMENT = "test";
      resetEnvCache();
      await setupByggcon();
      if (value === undefined) delete process.env.APP_ENVIRONMENT;
      else process.env.APP_ENVIRONMENT = value;
      resetEnvCache();
      const transaction = vi.spyOn(db, "transaction");
      const before = await countRows();

      const error = await errorFrom(seedBaths());
      expect(error, `APP_ENVIRONMENT=${String(value)}`).toBeInstanceOf(TestdataNotAllowedError);
      expect(error.message).toBe(TESTDATA_ENVIRONMENT_MESSAGE);
      expect(await countRows(), `0 nye rader ved ${String(value)}`).toEqual(before);
      expect(transaction).not.toHaveBeenCalled();
      transaction.mockRestore();
    }
  });

  it("Ingen rader i `ai_usage_log` fra seed. Aktøren i revisjonsloggen er takstmannen på oppdraget, aldri admin.", async () => {
    const complete = vi.spyOn(fakeAiProvider, "complete");
    const { orgId, adminEmployeeId } = await setupByggcon();
    const aiBefore = await count(sql`select count(*)::int as n from ai_usage_log`);
    await seedBaths();
    expect(await count(sql`select count(*)::int as n from ai_usage_log`)).toBe(aiBefore);
    expect(complete).not.toHaveBeenCalled();

    const audits = await rows<{ actor_employee_id: string | null; assignment_id: string }>(sql`
      select l.actor_employee_id, r.assignment_id from audit_log l
      join reports r on r.organization_id = l.organization_id
        and (r.id::text = l.changes->>'reportId' or (l.entity_type = 'report' and r.id::text = l.entity_id))
      where l.organization_id = ${orgId}`);
    expect(audits.length, "revisjonsrader for rapportene").toBeGreaterThan(0);
    const team = await rows<{ assignment_id: string; employee_id: string }>(sql`
      select assignment_id, employee_id from assignment_team_members
      where organization_id = ${orgId} and deleted_at is null
        and team_role in ('responsible', 'co_responsible', 'inspector')`);
    const problems = audits.flatMap((audit) => {
      if (audit.actor_employee_id === adminEmployeeId) return ["admin er aktør"];
      const onTeam = team.some(
        (t) => t.assignment_id === audit.assignment_id && t.employee_id === audit.actor_employee_id,
      );
      return onTeam ? [] : [`aktøren er ikke takstmann på oppdraget (${audit.assignment_id})`];
    });
    expect([...new Set(problems)]).toEqual([]);
  });

  it("Ingen tekst i datafilen eller rapportdataene har navn, adresse, e-post, telefon eller matrikkel fra testdataene, gjetteord eller tekst fra standarden (test med `tests/redaction.ts` og `tests/known-values.ts`).", async () => {
    const data = await loadBathData();
    expect(data.TESTDATA_DRAFT_LABEL).toBe("utkast, ikke godkjent av fagrådet");
    const dataTexts = [
      ...proseOf(data.TESTDATA_BATH_SCENARIOS).map((t) => ({ ...t, path: `scenario.${t.path}` })),
      ...proseOf(data.TESTDATA_BATH_FREE_TEXTS).map((t) => ({ ...t, path: `fritekst.${t.path}` })),
      ...proseOf(data.TG3_COST_BANDS).map((t) => ({ ...t, path: `kostnad.${t.path}` })),
    ];
    expect(dataTexts.length).toBeGreaterThan(0);
    expect(textProblems(dataTexts)).toEqual([]);

    const { orgId, admin } = await seedAll();
    const grant = await requireOrganizationAccess(admin, orgId, "organization.read");
    const reports = await rows<{ id: string; assignment_id: string }>(
      sql`select id, assignment_id from reports where organization_id = ${orgId}`,
    );
    expect(reports.length).toBeGreaterThan(0);
    const problems: string[] = [];
    for (const report of reports) {
      const known = await loadKnownValues(grant, report.assignment_id);
      const texts = await rows<{ path: string; text: string }>(sql`
        select 'deviations' as path, t as text from deviations d,
          unnest(array[d.deviation_text, d.cause_text, d.consequence_text, d.cost_text]) t
          where d.organization_id = ${orgId} and d.report_id = ${report.id} and t is not null
        union all
        select 'deviation_measures', text from deviation_measures
          where organization_id = ${orgId} and report_id = ${report.id}
        union all
        select 'tgiu_details', t from tgiu_details g,
          unnest(array[g.reason, g.alternative_check_method, g.alternative_check_result,
            g.risk_assessment, g.how_to_examine]) t
          where g.organization_id = ${orgId} and g.report_id = ${report.id} and t is not null
        union all
        select 'field_answers', value_text from field_answers
          where organization_id = ${orgId} and report_id = ${report.id} and value_text is not null
        union all
        select 'checkpoint_results', description_text from checkpoint_results
          where organization_id = ${orgId} and report_id = ${report.id} and description_text is not null`);
      for (const { path, text } of texts) {
        if (redactText(text, known).count > 0) problems.push(`${path}: persondata`);
        for (const word of guessWordsIn(text)) problems.push(`${path}: gjetteord «${word}»`);
        for (const word of referencesIn(text)) problems.push(`${path}: henvisning «${word}»`);
        if (planSecretsIn(text).length > 0) problems.push(`${path}: fra planen`);
      }
    }
    expect([...new Set(problems)]).toEqual([]);

    // Revisjonsloggen for rapportene har ingen persondata
    const details = await rows<{ changes: string }>(sql`
      select changes::text as changes from audit_log
      where organization_id = ${orgId} and entity_type in
        ('report', 'field_answer', 'checkpoint_result', 'deviation', 'deviation_measure',
         'tgiu_details', 'rule_suggestion_decision')`);
    for (const { changes } of details) {
      expect(changes).not.toContain("@");
      expect(planSecretsIn(changes)).toEqual([]);
    }
  });

  it("Bruker i annen organisasjon ser ingen av rapportene (`expectTenantIsolation` på oppslaget), og en annen organisasjon har samme radtall før og etter seed. Takstmann, kontor, leder og admin åpner en seedet rapport slik badskjermen tillater.", async () => {
    const { findTestdataBathReports, findShowcaseBathReport } = await loadBath();

    // En annen organisasjon med publisert badmal og eget bad med rapport, laget før seed
    const other = await createBathroomFixture({});
    await startReport(other.actor, other.organizationId, other.assignmentId);
    const otherSaved = await saveField(other.actor, other.organizationId, other.room, {
      table: "field_answers",
      id: uuidv7(),
      elementKey: EL.buildYear,
      field: "value",
      value: { text: null, number: 2010, optionKeys: null },
      base: { text: null, number: null, optionKeys: null },
    });
    expect(otherSaved.status).toBe("saved");
    const otherBefore = await countRowsIn(other.organizationId);

    const { orgId } = await seedAll();
    expect(await countRowsIn(other.organizationId)).toEqual(otherBefore);

    // Annen organisasjon får ikke åpne et seedet bad
    const showcase = await findShowcaseBathReport(db, orgId);
    expect(showcase, "visningsbadet finnes").not.toBeNull();
    const room = { assignmentId: showcase!.assignmentId, roomId: showcase!.roomId };
    const otherAdmin = await createUser({ name: "Annen Admin" });
    await createEmployee(otherAdmin, other.organizationId, ["admin"]);
    await expect(getRoomView(otherAdmin, orgId, room)).rejects.toBeInstanceOf(AccessDeniedError);
    const leak = await errorFrom(getRoomView(otherAdmin, other.organizationId, room));
    expect(leak.message).not.toContain(showcase!.reportId);
    expect(leak.message).not.toContain(showcase!.assignmentId);

    // Takstmann, kontor, leder og admin i Byggcon åpner visningsbadet
    const access: Record<string, boolean> = {};
    for (const role of ["inspector", "office", "manager", "admin"] as const) {
      const actor = await createUser({ name: `Rolle ${role}` });
      await createEmployee(actor, orgId, [role]);
      const view = await startedViewOf(actor, orgId, room);
      expect(view.reportId).toBe(showcase!.reportId);
      expect(view.progress.total).toBe(CHECKPOINT_KEYS.length);
      const canEdit = await requireOrganizationAccess(actor, orgId, "report.edit").then(
        () => true,
        () => false,
      );
      expect(view.canEdit, role).toBe(canEdit && view.reportStatus === "draft");
      access[role] = view.canEdit;
    }
    expect(access.office, "kontor er skrivebeskyttet").toBe(false);
    expect(access.admin, "admin stenges ikke ute").toBe(true);

    // Oppslaget gir aldri rader fra en annen organisasjon
    let tdCounter = 0;
    const putBath = async (organizationId: string) => {
      tdCounter += 1;
      await createTemplate(organizationId, {
        status: "published",
        document: wetRoomTemplate,
        name: "Tilstandsrapport",
      });
      const externalRef = `${TESTDATA_ORDER_PREFIX}${String(tdCounter).padStart(4, "0")}`;
      const assignment = await createAssignment(organizationId, {
        status: "in_progress",
        inspectionAt: new Date("2026-10-20T09:00:00Z"),
        externalRef,
      });
      await createOrder(organizationId, {
        externalRef,
        status: "converted",
        assignmentId: assignment.id,
      });
      const building = await createBuilding(organizationId, { assignmentId: assignment.id });
      const floor = await createFloor(organizationId, { buildingId: building.id });
      const bathroom = await createRoom(organizationId, {
        floorId: floor.id,
        roomType: "bathroom",
      });
      const inspector = await createUser({
        name: `Takstmann ${tdCounter}`,
        email: `takstmann-isolasjon-${tdCounter}@${TESTDATA_EMAIL_DOMAIN}`,
      });
      const employee = await createEmployee(inspector, organizationId, ["inspector"]);
      await createTeamMember(organizationId, {
        assignmentId: assignment.id,
        employeeId: employee.id,
        teamRole: "responsible",
      });
      const { reportId } = await startReport(inspector, organizationId, assignment.id);
      const ref = { assignmentId: assignment.id, roomId: bathroom.id };
      const result = await saveField(inspector, organizationId, ref, {
        table: "field_answers",
        id: uuidv7(),
        elementKey: EL.buildYear,
        field: "value",
        value: { text: null, number: 2015, optionKeys: null },
        base: { text: null, number: null, optionKeys: null },
      });
      expect(result.status).toBe("saved");
      const described = await saveField(inspector, organizationId, ref, {
        table: "checkpoint_results",
        checkpointKey: GENERAL,
        field: "description_text",
        value: "Oppdiktet bad i testen.",
        base: null,
      });
      expect(described.status).toBe("saved");
      return reportId;
    };
    await expectTenantIsolation({
      seed: async (grantA, grantB) => ({
        a: [await putBath(grantA.organizationId)],
        b: [await putBath(grantB.organizationId)],
      }),
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
        return findTestdataBathReports(db, grant.organizationId);
      },
      idOf: (row: BathRef) => row.reportId,
    });
  });

  it("`TESTDATA_TABLES` og oppsummeringen viser de nye tabellene og antall bad som er hoppet over.", async () => {
    const normalize = (name: string) => name.replace(/_/g, "").toLowerCase();
    const listed = new Map(TESTDATA_TABLES.map((name) => [normalize(name), name as string]));
    const newTables = REPORT_TABLES.map((table) => {
      const name = listed.get(normalize(table));
      expect(name, `TESTDATA_TABLES har ${table}`).toBeDefined();
      return { table, name: name! };
    });

    const { orgId, summary } = await seedAll();
    const created = summary.created as Record<string, number>;
    for (const { table, name } of newTables) {
      expect(created[name], `oppsummeringen for ${table}`).toBe(
        await count(
          sql`select count(*)::int as n from ${sql.identifier(table)} where organization_id = ${orgId}`,
        ),
      );
    }
    expect((summary as unknown as { bathsSkipped: unknown }).bathsSkipped).toBe(0);
    for (const line of summaryLines(summary)) expect(line).not.toContain("@");

    const filled = (await loadBaths(orgId)).filter((b) =>
      (ELIGIBLE as readonly string[]).includes(b.status),
    ).length;
    const second = await seedBaths();
    expect((second as unknown as { bathsSkipped: unknown }).bathsSkipped).toBe(filled);
    const createdAgain = second.created as Record<string, number>;
    for (const { name } of newTables) expect(createdAgain[name], name).toBe(0);
    const skippedLine = summaryLines(second).find(
      (line) => /hoppet over/i.test(line) && /bad/i.test(line),
    );
    expect(skippedLine, "linje med bad hoppet over").toBeDefined();
    expect(skippedLine!.match(/\d+/g) ?? []).toContain(String(filled));
  });

  it("E2e (PC og iPad-størrelse): visningsbadet, funnet med `findShowcaseBathReport`, viser TG3 med kostnad, TGIU og fremdrift «x av 8» med x < 8 og totalen 8. Badet uten avvik vises riktig.", async () => {
    const { findShowcaseBathReport } = await loadBath();
    const { orgId, admin } = await seedAll();
    const showcase = await findShowcaseBathReport(db, orgId);
    expect(showcase, "visningsbadet finnes").not.toBeNull();
    const [assignment] = await rows<{ status: string }>(
      sql`select status from assignments where id = ${showcase!.assignmentId} and organization_id = ${orgId}`,
    );
    expect(assignment?.status).toBe("in_progress");

    const inspector = await createUser({ name: "Takstmann visning" });
    await createEmployee(inspector, orgId, ["inspector"]);
    const view = await startedViewOf(inspector, orgId, {
      assignmentId: showcase!.assignmentId,
      roomId: showcase!.roomId,
    });
    expect(view.reportId).toBe(showcase!.reportId);
    const deviations = view.checkpoints.flatMap((c) => c.deviations);

    const tg3 = deviations.filter((d) => d.kind === "tg" && d.tg === 3);
    expect(tg3.length, "TG3").toBeGreaterThan(0);
    for (const d of tg3) expect(d.cost.type, "TG3 med kostnad").not.toBe("none");

    const adjacent = checkpointOf(view, ADJACENT);
    expect(adjacent.tgDirect, "TGIU på tilliggende").toBe("IU");
    expect(adjacent.tgiuDetails).not.toBeNull();
    const ownerRefused = optionOf(view, EL.reason) === "owner_refused";
    expect(
      missingTgiuDetails(adjacent.tgiuDetails, {
        alternativeCheck: true,
        ownerInformed: ownerRefused,
      }),
    ).toEqual([]);

    expect(
      deviations.some((d) => d.kind === "hms" && d.tg === null),
      "HMS uten TG",
    ).toBe(true);
    expect(
      deviations.some(
        (d) => fixedTgOf(d.questionKey) === 2 && d.tg === 2 && d.textSource === "edited",
      ),
      "TG2-utfall med fast TG og endret tekst",
    ).toBe(true);
    expect(view.progress.total).toBe(8);
    expect(view.progress.done).toBeLessThan(8);

    // Badet uten avvik
    const views = await eligibleViews(admin, orgId);
    const noDeviation = views.filter(isNoDeviationBath);
    expect(noDeviation.length, "badet uten avvik finnes").toBeGreaterThan(0);
    expect(noDeviation.flatMap(noDeviationProblems)).toEqual([]);
    for (const item of noDeviation) {
      expect(item.view.progress).toEqual({ done: 8, total: 8 });
    }
  });
});
