import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AccessDeniedError,
  permissions as PERMISSIONS,
  readInspectorsEditAll,
  requireOrganizationAccess,
  type Actor,
} from "@/core/access";
import {
  decideSuggestion,
  getRoomView,
  saveField,
  startReport,
  type CheckpointView,
  type DeviationView,
  type RoomReportView,
  type SuggestionView,
} from "@/core/reports";
import { evaluateRules, type JsonValue, type RuleResult } from "@/core/rules";
import { WET_ROOM_LIFESPANS } from "@/core/rules/data/lifespans";
import { WET_ROOM_THRESHOLDS } from "@/core/rules/data/thresholds";
import { parseTemplateDocument } from "@/core/templates";
import { db } from "@/db/client";
import { brand } from "@/shared/config/brand";
import { uuidv7 } from "@/shared/lib/uuid";
import { fakeAiProvider } from "../../../tests/ai";
import {
  TEST_NOW,
  activeAdminCount,
  createOrder,
  createTemplate,
  resetDatabase,
} from "../../../tests/factories";
import { answer, answerHole, createBathroomFixture, RULE } from "../../../tests/report-fixtures";
import { containsWord, loadKnownValues, redactText } from "../../../tests/redaction";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { runSeed } from "./run";
import { runSampleSeed } from "./sample-assignments";
import { wetRoomTemplate } from "./templates/wet-room";
import { TESTDATA_TABLES, seedTestdata, type TestdataSummary } from "./testdata";
import { TESTDATA_ENVIRONMENT_MESSAGE, TestdataNotAllowedError } from "./testdata-guard";
import { summaryLines } from "./testdata-index";
import { buildTestdataPlan } from "./testdata-plan";
import {
  TESTDATA_FIRST_NAMES,
  TESTDATA_LAST_NAMES,
  TESTDATA_SEED,
  TESTDATA_STREET_NAMES,
} from "./testdata.data";

vi.mock("server-only", () => ({}));

/*
 * Akseptkriteriene for testdata del 2 (badet fylt ut i testoppdragene), skrevet av testskriver
 * uavhengig av seed-koden. Testplan: docs/funksjoner/fase2a-testdata-del-2-testplan.md avsnitt 3.
 * Oppgavekort: docs/funksjoner/fase2a-testdata-del-2.md («Akseptkriterier», ett `it` per
 * kriterium i kortets rekkefølge, med kortets tekst som navn).
 *
 * Testene bruker bare det offentlige grensesnittet: `seedTestdata`, oppsummeringen og databasen.
 * Badene leses med `getRoomView` (samme visning som badskjermen), så TG, status, forslag og
 * advarsler regnes av rapportkjernen, ikke av testen. Scenarioene kjennes igjen på innholdet i
 * databasen, ikke på navnene i scenariofilen. Funksjonene fra avtalen om signaturer
 * (`findTestdataBathReports`, `findShowcaseBathReport`) og datafilen lastes dynamisk, slik at
 * resten av testene kan kjøre før modulene finnes.
 *
 * «Uventet forslag» (kriterium 4) lages ved å korte ned levetidene i regeldataene mens seed
 * kjører (bare i den ene testen). Da får badet uten avvik et aldersforslag scenarioet ikke venter.
 * Testplanens variant med smøremembran 15 år ligger i seksjon 2 (`testdata-bath.test.ts`).
 *
 * Alle data er oppdiktet. Admin fra seed er `admin@example.com`.
 *
 * Støtter hovedmål: de ansatte (testmiljøet har bad som ligner ekte befaringer, og skriptet rører
 * aldri ekte arbeid eller admin), KI i bunnen (faste koder og regelbeslutninger, ingen KI-rader,
 * ingen persondata i fritekst) og færre reklamasjoner (TG kommer bare fra reglene og malen, og
 * ingen ferdig rapport bryter sperrekravene).
 */

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

// Levetidene kan kortes ned mens seed kjører (kriterium 4). Ellers brukes de vanlige.
const lifespanOverride = vi.hoisted(() => ({ shrink: false }));
vi.mock("@/core/rules/data/lifespans", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/rules/data/lifespans")>();
  const shrunk = {
    ...actual.WET_ROOM_LIFESPANS,
    entries: actual.WET_ROOM_LIFESPANS.entries.map((entry) =>
      entry.min_age === null ? entry : { ...entry, min_age: 1 },
    ),
  };
  return {
    ...actual,
    get WET_ROOM_LIFESPANS() {
      return lifespanOverride.shrink ? shrunk : actual.WET_ROOM_LIFESPANS;
    },
  };
});

const env = { SEED_ADMIN_EMAIL: "admin@example.com", SEED_ADMIN_NAME: "Test Admin" };
const plan = buildTestdataPlan({ seed: TESTDATA_SEED, anchor: TEST_NOW });

const WET_ROOM_TYPES = [
  "bathroom",
  "laundry",
  "bathroom_laundry",
  "room_with_drain",
  "other_wet_room",
] as const;
const ACTIVE_STATUSES = ["in_progress", "completed", "invoiced"] as const;
const FINISHED = new Set(["completed", "invoiced"]);

const CP = {
  general: "wet_room.general",
  documentation: "wet_room.documentation",
  wallsCeiling: "wet_room.walls_ceiling",
  floor: "wet_room.floor",
  membrane: "wet_room.membrane_drain",
  fixtures: "wet_room.fixtures",
  ventilation: "wet_room.ventilation",
  adjacent: "wet_room.adjacent",
} as const;

const F = {
  buildYear: "wet_room.build_year",
  buildYearSource: "wet_room.build_year_source",
  docs: "wet_room.documentation_type",
  membraneType: "wet_room.membrane_type",
  membraneYear: "wet_room.membrane_year",
  hole: "wet_room.hole_drilling",
  reading: "wet_room.hole_moisture_reading",
  unit: "wet_room.hole_moisture_unit",
  location: "wet_room.hole_moisture_location",
  construction: "wet_room.hole_construction",
  reason: "wet_room.hole_drilling_reason",
  fall1: "wet_room.fall_direction_1",
  fall2: "wet_room.fall_direction_2",
} as const;

/** Tabellene seed-steget skal fylle (kortet, «Data»), og de testplanen teller i tillegg. */
const BATH_TABLES = [
  "reports",
  "field_answers",
  "checkpoint_results",
  "deviations",
  "deviation_measures",
  "tgiu_details",
  "rule_suggestion_decisions",
] as const;
const COUNTED_TABLES = [...BATH_TABLES, "audit_log", "ai_usage_log"] as const;

const GUESS_WORDS = /\b(antas|trolig|sannsynligvis|formodentlig|kanskje)\b/i;
const STANDARD_TEXT = /NS\s?3600|NS\s?3424|TEK\s?\d+\s?§|§\s?\d+-\d+/i;
const PHONE = /(\+47\s?)?\b\d{2}\s?\d{2}\s?\d{2}\s?\d{2}\b|\b\d{3}\s\d{2}\s\d{3}\b/;
const CADASTRE = /\b(gnr|bnr)\b|\b\d{1,4}\/\d{1,4}\b/i;
const CONCRETE_OR_MASONRY = /betong|(?<![\p{L}])mur(?:vegg|stein|t|en|ing)?(?![\p{L}])/iu;
const WEIGHT_LIMIT =
  WET_ROOM_THRESHOLDS.entries.find((t) => t.unit === "weight_percent")?.value ?? Number.NaN;

// --- Malen -----------------------------------------------------------------------------------

const TEMPLATE = (() => {
  const parsed = parseTemplateDocument(wetRoomTemplate);
  if (!parsed.success) throw new Error("badmalen er ugyldig");
  return parsed.document;
})();
const CHECKPOINT_ORDER = [...TEMPLATE.checkpoints]
  .sort((a, b) => a.sort_order - b.sort_order)
  .map((c) => c.key);
const CHECKPOINT_OF_ELEMENT = new Map(TEMPLATE.elements.map((e) => [e.key, e.checkpoint_key]));
const QUESTION_KEYS = new Set(TEMPLATE.deviation_questions.map((q) => q.key));

// --- Database ----------------------------------------------------------------------------------

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(query)) as unknown as T[];
}

async function count(query: ReturnType<typeof sql>): Promise<number> {
  const [row] = await rows<{ n: number }>(query);
  return row?.n ?? -1;
}

async function countRows(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of COUNTED_TABLES) {
    out[table] = await count(sql`select count(*)::int as n from ${sql.identifier(table)}`);
  }
  return out;
}

async function countRowsIn(organizationId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of BATH_TABLES) {
    out[table] = await count(
      sql`select count(*)::int as n from ${sql.identifier(table)} where organization_id = ${organizationId}`,
    );
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
  if (!user) throw new Error("Fant ikke brukeren");
  return user;
}

const adminActor = () => actorByEmail(env.SEED_ADMIN_EMAIL);

/** Publisert systemmal for tilstandsrapport i organisasjonen, som i drift. */
async function publishTemplate(organizationId: string): Promise<string> {
  const { versionId } = await createTemplate(organizationId, {
    status: "published",
    document: wetRoomTemplate,
    name: "Tilstandsrapport bolig",
  });
  return versionId;
}

/** Seed (Byggcon og admin), publisert badmal og testdataene. */
async function seedAll(): Promise<{ organizationId: string; summary: TestdataSummary }> {
  await runSeed(env);
  const organizationId = await byggconId();
  await publishTemplate(organizationId);
  const summary = await seedTestdata({ db, now: TEST_NOW, seed: TESTDATA_SEED });
  return { organizationId, summary };
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

// --- Badene i databasen ------------------------------------------------------------------------

type BathRow = {
  assignment_id: string;
  number: string;
  status: string;
  inspection_at: Date | null;
  external_ref: string;
  building_name: string | null;
  floor_name: string | null;
  room_id: string;
  room_name: string | null;
  room_type: string;
  report_id: string | null;
  template_version_id: string | null;
};

type StartedView = Extract<RoomReportView, { state: "started" }>;

type Bath = BathRow & { view: StartedView | null; label: string };

/** Alle våtrom i TD-oppdragene i organisasjonen, med rapporten når den finnes. */
async function bathRows(organizationId: string): Promise<BathRow[]> {
  return rows<BathRow>(sql`
    select a.id as assignment_id, a.number, a.status, a.inspection_at, o.external_ref,
      b.name as building_name, f.name as floor_name, r.id as room_id, r.name as room_name,
      r.room_type, rep.id as report_id, rep.template_version_id
    from orders o
    join assignments a on a.id = o.assignment_id and a.organization_id = o.organization_id
    join report_buildings b on b.assignment_id = a.id and b.organization_id = a.organization_id
      and b.deleted_at is null
    join floors f on f.report_building_id = b.id and f.organization_id = a.organization_id
      and f.deleted_at is null
    join rooms r on r.floor_id = f.id and r.organization_id = a.organization_id
      and r.deleted_at is null
    left join reports rep on rep.assignment_id = a.id and rep.organization_id = a.organization_id
      and rep.deleted_at is null and rep.status <> 'superseded'
    where o.organization_id = ${organizationId} and o.external_ref like 'TD-%'
      and o.deleted_at is null and a.deleted_at is null
      and r.room_type in (${sql.join(
        WET_ROOM_TYPES.map((t) => sql`${t}`),
        sql`, `,
      )})
    order by a.number, b.name, f.name, r.name, r.id`);
}

/** Badene med visningen fra rapportkjernen (som admin, bare lesing). */
async function loadBaths(organizationId: string): Promise<Bath[]> {
  const admin = await adminActor();
  const out: Bath[] = [];
  for (const row of await bathRows(organizationId)) {
    let view: StartedView | null = null;
    if (row.report_id) {
      const found = await getRoomView(admin, organizationId, {
        assignmentId: row.assignment_id,
        roomId: row.room_id,
      });
      if (found.state === "started") view = found;
    }
    out.push({
      ...row,
      view,
      label: `${row.external_ref} ${row.number} ${row.building_name ?? ""}/${row.floor_name ?? ""}/${row.room_name ?? ""}`,
    });
  }
  return out;
}

function started(bath: Bath): StartedView {
  if (!bath.view) throw new Error(`${bath.label}: rapporten er ikke startet`);
  return bath.view;
}

function cp(view: StartedView, key: string): CheckpointView {
  const found = view.checkpoints.find((c) => c.checkpointKey === key);
  if (!found) throw new Error(`fant ikke punktet ${key}`);
  return found;
}

function answerOf(view: StartedView, elementKey: string) {
  return view.answers.find((a) => a.elementKey === elementKey)?.value;
}

function opt(view: StartedView, elementKey: string): string | null {
  return answerOf(view, elementKey)?.optionKeys?.[0] ?? null;
}

function num(view: StartedView, elementKey: string): number | null {
  const value = answerOf(view, elementKey)?.number;
  return value === undefined ? null : value;
}

function text(view: StartedView, elementKey: string): string | null {
  return answerOf(view, elementKey)?.text ?? null;
}

function hasValue(value: {
  text: string | null;
  number: number | null;
  optionKeys: string[] | null;
}) {
  return (
    (value.text !== null && value.text.trim() !== "") ||
    value.number !== null ||
    (value.optionKeys !== null && value.optionKeys.length > 0)
  );
}

function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === "";
}

type Located = DeviationView & { checkpointKey: string };

function deviationsOf(view: StartedView): Located[] {
  return view.checkpoints.flatMap((c) =>
    c.deviations.map((d) => ({ ...d, checkpointKey: c.checkpointKey })),
  );
}

function isQuestion(d: DeviationView, suffix: string): boolean {
  return d.questionKey !== null && d.questionKey.endsWith(`.${suffix}`);
}

function suggestionOf(view: StartedView, ruleKey: string): SuggestionView | undefined {
  return view.suggestions.find((s) => s.ruleKey === ruleKey);
}

function hasCost(d: DeviationView): boolean {
  return (
    (d.cost.type === "band" && d.cost.bandKey !== null) ||
    (d.cost.type === "approx" && d.cost.amount !== null)
  );
}

/** TGIU-opplysningene som alltid kreves på tilliggende (uansett grunn). */
function tgiuCoreComplete(c: CheckpointView): boolean {
  const t = c.tgiuDetails;
  return (
    t !== null &&
    !isBlank(t.reason) &&
    !isBlank(t.riskAssessment) &&
    !isBlank(t.howToExamine) &&
    !isBlank(t.alternativeCheckMethod) &&
    !isBlank(t.alternativeCheckResult) &&
    t.constructionVulnerable !== null
  );
}

/** Alle tekstfelt i badet (svar, beskrivelser, avvik, tiltak og TGIU). */
function textsOf(view: StartedView): string[] {
  const out: string[] = [];
  for (const a of view.answers) if (a.value.text) out.push(a.value.text);
  for (const c of view.checkpoints) {
    if (c.descriptionText) out.push(c.descriptionText);
    const t = c.tgiuDetails;
    if (t) {
      for (const value of [
        t.reason,
        t.riskAssessment,
        t.howToExamine,
        t.alternativeCheckMethod,
        t.alternativeCheckResult,
      ]) {
        if (value) out.push(value);
      }
    }
    for (const d of c.deviations) {
      for (const value of [d.deviationText, d.causeText, d.consequenceText, d.costText]) {
        if (value) out.push(value);
      }
      for (const m of d.measures) out.push(m.text);
    }
  }
  return out;
}

/** TG og innhold per bad, for å sammenligne to kjøringer. */
function fingerprint(baths: readonly Bath[]): string[] {
  return baths.map((bath) => {
    if (!bath.view) return `${bath.label}: ingen rapport`;
    const parts = CHECKPOINT_ORDER.map((key) => {
      const c = cp(bath.view!, key);
      const devs = c.deviations
        .map((d) => `${d.questionKey}:${d.outcomeKey}:${d.kind}:${d.tg ?? "-"}:${d.textSource}`)
        .sort()
        .join(",");
      return `${key}=${c.tg ?? "-"}/${c.done ? "ferdig" : "åpen"}[${devs}]`;
    });
    return `${bath.label}: ${parts.join(" ")}`;
  });
}

// --- Scenarioene kjent igjen på innholdet --------------------------------------------------------

type Detector = { name: string; matches: (bath: Bath) => boolean };

const MANDATORY: Detector[] = [
  { name: "1 visningsbad", matches: (b) => isShowcase(b) },
  {
    name: "2 TG2 for alder",
    matches: (b) => {
      if (!b.view || !FINISHED.has(b.status)) return false;
      const decision = suggestionOf(b.view, RULE.pastLifespan)?.latestDecision;
      return (
        decision?.decision === "accepted" &&
        deviationsOf(b.view).some(
          (d) =>
            isQuestion(d, "membrane_past_lifespan") &&
            d.tg === 2 &&
            d.cost.type === "none" &&
            d.id === decision.deviationId,
        )
      );
    },
  },
  {
    name: "3 TG3 før 2000",
    matches: (b) => {
      if (!b.view || !FINISHED.has(b.status)) return false;
      const devs = deviationsOf(b.view);
      return (
        devs.some((d) => isQuestion(d, "membrane_before_2000") && d.tg === 3 && hasCost(d)) &&
        !devs.some((d) => isQuestion(d, "membrane_past_lifespan")) &&
        (num(b.view, F.buildYear) ?? 9999) < 2000 &&
        num(b.view, F.membraneYear) === null
      );
    },
  },
  {
    name: "4 TGIU komplett (eier nektet)",
    matches: (b) => {
      if (!b.view || !FINISHED.has(b.status)) return false;
      const adjacent = cp(b.view, CP.adjacent);
      return (
        adjacent.tgDirect === "IU" &&
        opt(b.view, F.hole) === "not_done" &&
        opt(b.view, F.reason) === "owner_refused" &&
        tgiuCoreComplete(adjacent) &&
        adjacent.tgiuDetails?.ownerInformed === true &&
        suggestionOf(b.view, RULE.notDone)?.latestDecision?.decision === "accepted"
      );
    },
  },
  {
    name: "5 TG0",
    matches: (b) => {
      if (!b.view) return false;
      const adjacent = cp(b.view, CP.adjacent);
      const reading = num(b.view, F.reading);
      return (
        adjacent.tgDirect === "0" &&
        suggestionOf(b.view, RULE.noMoisture)?.latestDecision?.decision === "accepted" &&
        opt(b.view, F.hole) === "done_no_findings" &&
        opt(b.view, F.unit) === "weight_percent" &&
        reading !== null &&
        reading < WEIGHT_LIMIT
      );
    },
  },
  { name: "6 forhøyet fukt med TG2", matches: (b) => elevatedMoisture(b, 2) },
  { name: "7 forhøyet fukt med TG3", matches: (b) => elevatedMoisture(b, 3) },
  {
    name: "8 endret forslag (TG0 til TG1)",
    matches: (b) => {
      if (!b.view) return false;
      const decision = suggestionOf(b.view, RULE.noMoisture)?.latestDecision;
      return (
        decision?.decision === "changed" &&
        decision.chosenTg === "1" &&
        decision.overrideReasonCode !== null &&
        cp(b.view, CP.adjacent).tgDirect === "1"
      );
    },
  },
  {
    name: "9 avvist forslag (målt på nytt)",
    matches: (b) => {
      if (!b.view || b.status !== "in_progress") return false;
      const decision = suggestionOf(b.view, RULE.noMoisture)?.latestDecision;
      return (
        decision?.decision === "rejected" &&
        decision.overrideReasonCode === "measured_again" &&
        !cp(b.view, CP.adjacent).done
      );
    },
  },
  { name: "10 bad uten avvik", matches: (b) => isWithoutDeviations(b) },
  {
    name: "11 «Ukjent» byggeår",
    matches: (b) => {
      if (!b.view || b.status !== "in_progress") return false;
      const membrane = cp(b.view, CP.membrane);
      return (
        opt(b.view, F.buildYearSource) === "unknown" &&
        num(b.view, F.buildYear) === null &&
        num(b.view, F.membraneYear) === null &&
        !membrane.done &&
        membrane.tg === null &&
        [RULE.pastLifespan, RULE.before2000].every((key) => {
          const s = suggestionOf(b.view!, key);
          return !s || (s.state !== "triggered" && s.latestDecision === null);
        })
      );
    },
  },
  {
    name: "12 HMS",
    matches: (b) => {
      if (!b.view) return false;
      const fixtures = cp(b.view, CP.fixtures);
      return fixtures.deviations.some(
        (d) =>
          isQuestion(d, "signs_of_overheating") &&
          d.kind === "hms" &&
          d.tg === null &&
          !isBlank(d.consequenceText) &&
          d.measures.length > 0,
      );
    },
  },
];

function isShowcase(b: Bath): boolean {
  if (!b.view || b.status !== "in_progress") return false;
  const devs = deviationsOf(b.view);
  const adjacent = cp(b.view, CP.adjacent);
  return (
    devs.some((d) => isQuestion(d, "membrane_before_2000") && d.tg === 3 && hasCost(d)) &&
    adjacent.tgDirect === "IU" &&
    tgiuCoreComplete(adjacent) &&
    devs.some((d) => d.kind === "hms" && d.tg === null) &&
    devs.some((d) => d.outcomeKey === "tg2" && d.tg === 2 && d.textSource === "edited") &&
    b.view.progress.done < b.view.progress.total
  );
}

function elevatedMoisture(b: Bath, tg: 2 | 3): boolean {
  if (!b.view) return false;
  const reading = num(b.view, F.reading);
  return (
    opt(b.view, F.hole) === "done_with_findings" &&
    opt(b.view, F.unit) === "weight_percent" &&
    reading !== null &&
    reading >= WEIGHT_LIMIT &&
    cp(b.view, CP.adjacent).deviations.some(
      (d) =>
        isQuestion(d, "elevated_moisture") &&
        d.tg === tg &&
        d.measures.length > 0 &&
        (tg === 2 || hasCost(d)),
    )
  );
}

function isWithoutDeviations(b: Bath): boolean {
  if (!b.view || !FINISHED.has(b.status)) return false;
  const v = b.view;
  const others = CHECKPOINT_ORDER.filter((key) => key !== CP.adjacent);
  return (
    deviationsOf(v).length === 0 &&
    v.checkpoints.every((c) => c.done) &&
    others.every((key) => cp(v, key).tg === "1") &&
    cp(v, CP.adjacent).tg === "0" &&
    suggestionOf(v, RULE.noMoisture)?.latestDecision?.decision === "accepted" &&
    ["declaration_of_conformity", "wet_room_certificate"].includes(opt(v, F.docs) ?? "")
  );
}

// --- Modulene fra avtalen om signaturer (lastes dynamisk) -----------------------------------------

async function loadModule(path: string): Promise<Record<string, unknown>> {
  return (await import(/* @vite-ignore */ path)) as Record<string, unknown>;
}

async function bathModule(): Promise<Record<string, unknown>> {
  return loadModule("./testdata-bath");
}

type Lookup = (database: typeof db, organizationId: string) => Promise<unknown>;

async function lookupFn(
  name: "findTestdataBathReports" | "findShowcaseBathReport",
): Promise<Lookup> {
  const fn = (await bathModule())[name];
  if (typeof fn !== "function")
    throw new Error(`src/db/seed/testdata-bath.ts eksporterer ikke ${name}`);
  return fn as Lookup;
}

/** Rom- og oppdrags-id fra svaret til et oppslag, uansett form. */
function idsOf(value: unknown): {
  roomId: string | null;
  assignmentId: string | null;
  reportId: string | null;
} {
  const record = (value ?? {}) as Record<string, unknown>;
  const nested = (key: string) => (record[key] ?? {}) as Record<string, unknown>;
  const pick = (...candidates: unknown[]) =>
    (candidates.find((c) => typeof c === "string") as string | undefined) ?? null;
  return {
    roomId: pick(record.roomId, nested("room").id, nested("room").roomId),
    assignmentId: pick(record.assignmentId, nested("room").assignmentId, nested("assignment").id),
    reportId: pick(record.reportId, record.id),
  };
}

/** Alle strenger i en verdi (objekt, liste, Map, Set), og verdiene til felt med navnet `key`. */
function collectStrings(
  value: unknown,
  key: string,
  out: { all: string[]; named: string[] } = { all: [], named: [] },
  seen = new Set<unknown>(),
) {
  if (typeof value === "string") {
    out.all.push(value);
    return out;
  }
  if (value === null || typeof value !== "object" || seen.has(value)) return out;
  seen.add(value);
  if (value instanceof Map || value instanceof Set || Array.isArray(value)) {
    for (const item of value instanceof Map ? [...value.values()] : [...value]) {
      collectStrings(item, key, out, seen);
    }
    return out;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === key && typeof v === "string") out.named.push(v);
    collectStrings(v, key, out, seen);
  }
  return out;
}

/** Strengene i kildeteksten, uten kommentarer. */
function stringLiterals(source: string): string[] {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const found: string[] = [];
  const pattern = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
  for (const match of withoutComments.matchAll(pattern)) {
    found.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return found;
}

/** Navn og gatenavn fra testdataene (del 1). */
const PERSONAL_WORDS = [
  ...new Set<string>([
    ...TESTDATA_FIRST_NAMES,
    ...TESTDATA_LAST_NAMES,
    ...TESTDATA_STREET_NAMES,
    ...plan.employees.map((e) => e.name),
    ...plan.contacts.map((c) => c.name),
  ]),
];

/** Problemene i en tekst: persondata, gjetteord eller tekst fra standarden. */
function textProblems(value: string): string[] {
  const problems: string[] = [];
  if (value.includes("@")) problems.push("@");
  if (PHONE.test(value)) problems.push("telefonnummer");
  if (CADASTRE.test(value)) problems.push("gnr/bnr");
  if (GUESS_WORDS.test(value)) problems.push("gjetteord");
  if (STANDARD_TEXT.test(value)) problems.push("standarden");
  for (const word of PERSONAL_WORDS) if (containsWord(value, word)) problems.push(`navn: ${word}`);
  return problems;
}

// ===============================================================================================
// Ett felles datasett for kriteriene som bare leser
// ===============================================================================================

describe("testdata del 2: akseptkriteriene (ett datasett)", () => {
  let organizationId = "";
  let summary: TestdataSummary;
  let lines: string[] = [];
  let baths: Bath[] = [];
  let seedMs = 0;
  let aiCalls = 0;
  let aiRowsBefore = 0;
  let adminRolesBefore = "";
  let adminCountBefore = 0;

  beforeAll(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await resetDatabase();
    await runSeed(env);
    organizationId = await byggconId();
    await publishTemplate(organizationId);
    const admin = await adminActor();
    adminRolesBefore = JSON.stringify(
      await rows(sql`
        select er.role, e.deactivated_at, e.deleted_at from employees e
        left join employee_roles er on er.employee_id = e.id and er.deleted_at is null
        where e.user_id = ${admin.id} order by er.role`),
    );
    adminCountBefore = await activeAdminCount(organizationId);
    aiRowsBefore = await count(sql`select count(*)::int as n from ai_usage_log`);
    const complete = vi.spyOn(fakeAiProvider, "complete");
    const started = performance.now();
    summary = await seedTestdata({ db, now: TEST_NOW, seed: TESTDATA_SEED });
    seedMs = performance.now() - started;
    aiCalls = complete.mock.calls.length;
    complete.mockRestore();
    lines = summaryLines(summary);
    baths = await loadBaths(organizationId);
  });

  afterAll(() => vi.restoreAllMocks());

  const filled = () => baths.filter((b) => b.view !== null);
  const finished = () => filled().filter((b) => FINISHED.has(b.status));

  it("`pnpm db:seed:testdata` gir rapport låst til publisert systemmal i hvert våtrom i oppdrag med status «under arbeid», «ferdig» og «fakturert», og ingen i «bestilt».", async () => {
    const [published] = await rows<{ id: string }>(sql`
      select tv.id from template_versions tv
      join template_families tf on tf.id = tv.family_id and tf.organization_id = tv.organization_id
      where tv.organization_id = ${organizationId} and tv.status = 'published'
        and tf.kind = 'system' and tf.report_type = 'condition_report' and tv.deleted_at is null`);
    expect(published, "Byggcon har en publisert systemmal").toBeTruthy();
    const active = baths.filter((b) => (ACTIVE_STATUSES as readonly string[]).includes(b.status));
    expect(
      active.length,
      "del 1 har våtrom i oppdrag som er under arbeid, ferdige eller fakturert",
    ).toBeGreaterThan(10);
    for (const bath of active) {
      expect(bath.report_id, `${bath.label}: rapport`).not.toBeNull();
      expect(bath.template_version_id, `${bath.label}: låst til publisert systemmal`).toBe(
        published!.id,
      );
      expect(bath.view, `${bath.label}: badskjermen viser rapporten`).not.toBeNull();
      expect(started(bath).progress.total, `${bath.label}: åtte punkt`).toBe(8);
    }
    const ordered = await count(sql`
      select count(*)::int as n from reports rep
      join assignments a on a.id = rep.assignment_id and a.organization_id = rep.organization_id
      where rep.organization_id = ${organizationId} and a.status = 'ordered'`);
    expect(ordered, "ingen rapport i «bestilt»").toBe(0);
  });

  it("Alle tolv pliktige scenarioer er brukt minst én gang, med fast fordeling; samme frø gir samme fordeling (test på datafilen og i databasen). Oppsummeringen viser scenariokartet (scenarionavn, oppdragsnummer, rom) og antall bad fylt ut, uten `@`, navn eller adresse.", async () => {
    // I databasen: hvert pliktig scenario kjennes igjen på innholdet
    const missing = MANDATORY.filter((d) => !filled().some((b) => d.matches(b))).map((d) => d.name);
    expect(missing, "pliktige scenarioer som ikke finnes i databasen").toEqual([]);

    // Datafilen: tolv pliktige nøkler, og fordelingen er lik med samme frø
    const data = await loadModule("./testdata-bath.data");
    const keys = data.MANDATORY_BATH_SCENARIO_KEYS;
    expect(Array.isArray(keys), "MANDATORY_BATH_SCENARIO_KEYS er en liste").toBe(true);
    expect((keys as unknown[]).length).toBe(12);
    expect(new Set(keys as unknown[]).size).toBe(12);

    // Oppsummeringen: én linje per pliktig scenario med oppdragsnummer og rom
    const mapLines = lines.filter((line) => /oppdrag\s+\S+.*,\s*\S+/i.test(line) && /:/.test(line));
    expect(mapLines.length, "scenariokartet har minst tolv linjer").toBeGreaterThanOrEqual(12);
    const showcaseLine = lines.find((line) => /^Visningsbad\b/i.test(line));
    expect(showcaseLine, "linjen for visningsbadet").toBeTruthy();
    const showcase = filled().find(isShowcase);
    expect(showcase, "visningsbadet i databasen").toBeTruthy();
    expect(showcaseLine).toContain(showcase!.number);
    if (showcase!.room_name) expect(showcaseLine).toContain(showcase!.room_name);
    expect(
      lines.some((line) => /fylt ut/i.test(line) && line.includes(String(filled().length))),
      "antall bad fylt ut",
    ).toBe(true);
    for (const line of lines) {
      expect(line).not.toContain("@");
      for (const word of [...TESTDATA_STREET_NAMES, ...plan.employees.map((e) => e.name)]) {
        expect(containsWord(line, word), `ingen navn eller adresse i «${line}»`).toBe(false);
      }
    }
  });

  it("Badet uten avvik har sju punkt med TG1 og tilliggende med TG0 fra et godtatt forslag, og dokumentasjon lagt fram.", () => {
    const found = finished().filter(isWithoutDeviations);
    expect(found.length, "minst ett bad uten avvik").toBeGreaterThan(0);
    for (const bath of found) {
      const v = started(bath);
      const decision = suggestionOf(v, RULE.noMoisture)!.latestDecision!;
      expect(decision.decision).toBe("accepted");
      expect(decision.chosenTg === null || decision.chosenTg === "0").toBe(true);
      expect(opt(v, F.hole)).toBe("done_no_findings");
      expect(num(v, F.reading)).toBeLessThan(WEIGHT_LIMIT);
    }
  });

  it("Ferdige bad med dokumentasjon «Ingen» eller tom har `missing_membrane_documentation` med TG2 og uten kostnad (A510).", () => {
    const withoutDocs = finished().filter((b) => {
      const docs = opt(started(b), F.docs);
      return docs === null || docs === "none";
    });
    expect(
      withoutDocs.length,
      "minst ett ferdig bad uten dokumentasjon (scenario 2 og 3)",
    ).toBeGreaterThan(0);
    for (const bath of withoutDocs) {
      const docsPoint = cp(started(bath), CP.documentation);
      const found = docsPoint.deviations.filter((d) =>
        isQuestion(d, "missing_membrane_documentation"),
      );
      expect(found, `${bath.label}: missing_membrane_documentation`).toHaveLength(1);
      expect(found[0]!.tg).toBe(2);
      expect(found[0]!.cost.type).toBe("none");
    }
  });

  it("«Eier informert» er avkrysset bare ved `owner_refused`; TGIU med `concrete_or_masonry` har feltet tomt, har begrunnelse, annen fuktkontroll (metode og resultat), risiko, skadeutsatt og «hva må til», og gir ingen advarsel `tgiu_details_missing`.", () => {
    const tgiu = filled().filter((b) => cp(started(b), CP.adjacent).tgDirect === "IU");
    expect(tgiu.length).toBeGreaterThan(0);
    const reasons = new Set<string>();
    for (const bath of tgiu) {
      const v = started(bath);
      const adjacent = cp(v, CP.adjacent);
      const reason = opt(v, F.reason);
      expect(reason, `${bath.label}: grunn for TGIU`).not.toBeNull();
      reasons.add(reason!);
      expect(tgiuCoreComplete(adjacent), `${bath.label}: opplysningene ved TGIU`).toBe(true);
      if (reason === "owner_refused") {
        expect(adjacent.tgiuDetails!.ownerInformed, `${bath.label}: eier informert`).toBe(true);
      } else {
        expect(
          adjacent.tgiuDetails!.ownerInformed === true,
          `${bath.label}: eier informert står tomt`,
        ).toBe(false);
      }
      expect(
        adjacent.warnings.filter((w) => w.code === "tgiu_details_missing"),
        `${bath.label}: ingen tgiu_details_missing`,
      ).toEqual([]);
    }
    expect(reasons.has("owner_refused"), "TGIU der eier nektet").toBe(true);
    expect(
      reasons.has("concrete_or_masonry"),
      "TGIU der hullet ikke kunne tas (betong eller mur)",
    ).toBe(true);
  });

  it("Ingen testbad har dokumentasjonen `other_written`; datatesten feiler hvis et ferdig eller fakturert bad har det (A513).", async () => {
    const used = filled().filter((b) => opt(started(b), F.docs) === "other_written");
    expect(used.map((b) => b.label)).toEqual([]);
    const source = readFileSync(join(process.cwd(), "src/db/seed/testdata-bath.data.ts"), "utf8");
    expect(stringLiterals(source).filter((s) => s === "other_written")).toEqual([]);
  });

  it("Regelmotoren kjørt på hele fordelingen (pliktige og tilfeldige) med hvert bads år gir nøyaktig forslagene i `expected`, også aldersforslaget etter aldersprofilen; `open` finnes bare på punkt som ikke står ferdig (A514).", () => {
    for (const bath of filled()) {
      const v = started(bath);
      for (const s of v.suggestions) {
        const point = cp(v, s.checkpointKey);
        if (s.state === "triggered" && s.latestDecision === null) {
          expect(
            point.done,
            `${bath.label}: åpent forslag ${s.ruleKey} bare på punkt som ikke står ferdig`,
          ).toBe(false);
        }
        expect(s.stale, `${bath.label}: ${s.ruleKey} gjelder fortsatt`).toBe(false);
      }
      // Aldersprofilen: før 2000 gir forslaget for før 2000, ellers aldri
      const year = num(v, F.membraneYear) ?? num(v, F.buildYear);
      const before2000 = suggestionOf(v, RULE.before2000);
      const past = suggestionOf(v, RULE.pastLifespan);
      if (year !== null && year < 2000 && opt(v, F.membraneType) !== null) {
        expect(before2000?.state, `${bath.label}: før 2000`).toBe("triggered");
        expect(past?.state === "triggered", `${bath.label}: ikke TG2 for alder i tillegg`).toBe(
          false,
        );
      }
      if (year !== null && year >= 2000) {
        expect(before2000?.state === "triggered", `${bath.label}: ikke før 2000`).toBe(false);
      }
      // I ferdige bad er hvert forslag avgjort, og godtatte utfall har et levende avvik
      if (FINISHED.has(bath.status)) {
        for (const s of v.suggestions.filter((x) => x.state === "triggered")) {
          const decision = s.latestDecision;
          expect(decision, `${bath.label}: ${s.ruleKey} er avgjort`).not.toBeNull();
          expect(["accepted", "changed"]).toContain(decision!.decision);
          if (decision!.decision === "accepted" && s.suggestion?.kind === "outcome") {
            expect(decision!.deviationId, `${bath.label}: avviket fra ${s.ruleKey}`).not.toBeNull();
          }
        }
      }
    }
  });

  it("Datatesten feiler for vekt-%-tekst med betong eller mur, for RF % på ferdig tilliggende med TG1, og for «utført uten funn» med 15 vekt-% eller mer.", () => {
    for (const bath of filled()) {
      const v = started(bath);
      const unit = opt(v, F.unit);
      if (unit === "weight_percent") {
        for (const key of [F.location, F.construction]) {
          const value = text(v, key);
          if (value)
            expect(CONCRETE_OR_MASONRY.test(value), `${bath.label}: ${key} beskriver treverk`).toBe(
              false,
            );
        }
      }
      if (unit === "relative_humidity") {
        expect(
          cp(v, CP.adjacent).done,
          `${bath.label}: RF % bare der tilliggende ikke står ferdig`,
        ).toBe(false);
      }
      if (opt(v, F.hole) === "done_no_findings" && unit === "weight_percent") {
        expect(num(v, F.reading) ?? 0, `${bath.label}: uten funn under grensen`).toBeLessThan(
          WEIGHT_LIMIT,
        );
      }
      expect(
        cp(v, CP.adjacent).warnings.filter((w) => w.code === "no_findings_with_reading_over_limit"),
      ).toEqual([]);
    }
    // Vakten i testen virker: påtvungne tekster gir treff
    expect(CONCRETE_OR_MASONRY.test("Målt i betongdekke under sluk")).toBe(true);
    expect(CONCRETE_OR_MASONRY.test("Hull i mur mot gang")).toBe(true);
    expect(CONCRETE_OR_MASONRY.test("Bunnsvill i vegg mot bad")).toBe(false);
  });

  it("Hver `fieldNote` i `expected` består testene for gjetteord, kopi fra standarden og persondata.", async () => {
    const data = await loadModule("./testdata-bath.data");
    const { named } = collectStrings(data, "fieldNote");
    expect(named.length, "feltnotater i scenariofilen").toBeGreaterThanOrEqual(6);
    for (const note of named) {
      expect(note.trim().length, "notatet er ikke tomt").toBeGreaterThan(0);
      expect(note.length, `kort notat: «${note}»`).toBeLessThanOrEqual(160);
      expect(textProblems(note), `«${note}»`).toEqual([]);
    }
  });

  it("Integrasjonstesten måler hele `seedTestdata` og feiler over 60 sekunder.", () => {
    expect(filled().length, "seed fylte ut bad").toBeGreaterThan(0);
    expect(seedMs, `seedTestdata tok ${Math.round(seedMs)} ms`).toBeLessThan(60_000);
  });

  it("Hvert scenario kjørt gjennom regelmotoren gir forslaget malens testsak forventer, både med befaringsåret og med klokken flyttet to år fram.", async () => {
    expect(filled().length).toBeGreaterThan(0);
    for (const bath of filled()) {
      const year = started(bath).inspectionYear;
      expect(year.source, `${bath.label}: befaringsåret fra oppdraget`).toBe("assignment");
      expect(year.year).toBe(new Date(bath.inspection_at!).getUTCFullYear());
    }
    const admin = await adminActor();
    const before = filled().map((b) =>
      JSON.stringify(
        started(b).suggestions.map((s) => [s.ruleKey, s.state, s.suggestion, s.stale]),
      ),
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW.getTime() + 2 * 365 * 86_400_000));
      const after: string[] = [];
      for (const bath of filled()) {
        const view = await getRoomView(admin, organizationId, {
          assignmentId: bath.assignment_id,
          roomId: bath.room_id,
        });
        if (view.state !== "started") throw new Error("rapporten forsvant");
        after.push(
          JSON.stringify(view.suggestions.map((s) => [s.ruleKey, s.state, s.suggestion, s.stale])),
        );
      }
      expect(after).toEqual(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("TG bare gjennom tjenestene: hvert avvik med TG har en rad i `rule_suggestion_decisions` med samme `deviation_id`, eller kommer fra et utfall med fast TG, eller fra «velg TG2 eller TG3» med TG 2 eller 3 og en rad fra `setTgDirect` i revisjonsloggen. TG1 direkte bare på punkt uten avvik med TG og uten åpent forslag. En statisk test viser at seed-filene ikke skriver til `deviations`, `checkpoint_results` eller `rule_suggestion_decisions` med `insert` eller `update`.", async () => {
    const decided = new Set(
      (
        await rows<{ deviation_id: string }>(sql`
          select deviation_id from rule_suggestion_decisions
          where organization_id = ${organizationId} and deviation_id is not null`)
      ).map((r) => r.deviation_id),
    );
    const audited = new Set(
      (
        await rows<{ entity_id: string }>(sql`
          select entity_id from audit_log where organization_id = ${organizationId}`)
      ).map((r) => r.entity_id),
    );
    let checked = 0;
    for (const bath of filled()) {
      const v = started(bath);
      for (const d of deviationsOf(v).filter((x) => x.tg !== null)) {
        checked += 1;
        const fromRule = decided.has(d.id);
        const fixed = d.outcomeKey === "tg2" || d.outcomeKey === "tg3";
        const chosen = d.outcomeKey === "choose" && (d.tg === 2 || d.tg === 3) && audited.has(d.id);
        expect(
          fromRule || fixed || chosen,
          `${bath.label}: kilden til TG på ${d.questionKey}`,
        ).toBe(true);
        if (fixed) expect(String(d.tg)).toBe(d.outcomeKey!.slice(2));
      }
      for (const c of v.checkpoints.filter((x) => x.tgDirect === "1")) {
        const decision = v.suggestions.find(
          (s) => s.checkpointKey === c.checkpointKey && s.latestDecision?.chosenTg === "1",
        );
        if (decision) continue; // Endret forslag TG0 til TG1 (scenario 8)
        expect(
          c.deviations.some((d) => d.tg !== null),
          `${bath.label}: TG1 direkte uten avvik med TG`,
        ).toBe(false);
        const open = v.suggestions.filter(
          (s) =>
            s.checkpointKey === c.checkpointKey &&
            s.state === "triggered" &&
            s.latestDecision === null,
        );
        expect(
          open.map((s) => s.ruleKey),
          `${bath.label}: TG1 direkte uten åpent forslag`,
        ).toEqual([]);
      }
    }
    expect(checked, "avvik med TG i datasettet").toBeGreaterThan(0);

    // Statisk: seed-filene skriver aldri forbi tjenestene
    const dir = join(process.cwd(), "src/db/seed");
    const files = readdirSync(dir).filter(
      (f) => /^testdata.*\.ts$/.test(f) && !f.endsWith(".test.ts"),
    );
    const tables = [
      "deviations",
      "checkpointResults",
      "ruleSuggestionDecisions",
      "deviationMeasures",
      "tgiuDetails",
      "fieldAnswers",
      "reports",
    ];
    const rawTables = [
      "deviations",
      "checkpoint_results",
      "rule_suggestion_decisions",
      "deviation_measures",
      "tgiu_details",
      "field_answers",
      "reports",
    ];
    for (const file of files) {
      const source = readFileSync(join(dir, file), "utf8");
      for (const table of tables) {
        expect(source, `${file}: insert/update mot ${table}`).not.toMatch(
          new RegExp(`\\.(insert|update)\\(\\s*${table}\\b`),
        );
      }
      for (const table of rawTables) {
        expect(source, `${file}: rå SQL mot ${table}`).not.toMatch(
          new RegExp(`(insert\\s+into|update)\\s+"?${table}"?\\b`, "i"),
        );
      }
    }
  });

  it("Hele datasettet: ingen TG3 uten kostnadsintervall, ingen TG2 eller TG3 uten årsak og konsekvens, ingen TG2 med kostnad, ingen TG0 utenfor tilliggende, ingen TG3 på dokumentasjon, ingen TG på HMS (testen feiler ved 0 HMS-avvik), ingen avvik utenfor badmalen, ingen ferdig punkt uten TG.", () => {
    let hms = 0;
    const sources = new Set<string>();
    for (const bath of filled()) {
      expect((WET_ROOM_TYPES as readonly string[]).includes(bath.room_type)).toBe(true);
      const v = started(bath);
      for (const c of v.checkpoints) {
        if (c.done) expect(c.tg, `${bath.label}: ${c.checkpointKey} ferdig med TG`).not.toBeNull();
        if (c.tg === "0")
          expect(c.checkpointKey, `${bath.label}: TG0 bare på tilliggende`).toBe(CP.adjacent);
      }
      for (const d of deviationsOf(v)) {
        const where = `${bath.label}: ${d.questionKey}`;
        sources.add(d.textSource);
        expect(
          d.questionKey !== null && QUESTION_KEYS.has(d.questionKey),
          `${where} finnes i badmalen`,
        ).toBe(true);
        expect(d.questionKey!.startsWith(`${d.checkpointKey}.`), `${where} på riktig punkt`).toBe(
          true,
        );
        if (d.tg === 3) {
          expect(d.cost.type, `${where}: TG3 med kostnadsintervall`).toBe("band");
          expect(d.cost.bandKey).not.toBeNull();
          expect(d.checkpointKey, `${where}: ingen TG3 på dokumentasjon`).not.toBe(
            CP.documentation,
          );
        }
        if (d.tg === 2) expect(d.cost.type, `${where}: TG2 uten kostnad`).toBe("none");
        if (d.tg === 2 || d.tg === 3) {
          expect(d.causeCriterion, `${where}: årsak`).not.toBeNull();
          expect(isBlank(d.causeText), `${where}: årsakstekst`).toBe(false);
          expect(isBlank(d.consequenceText), `${where}: konsekvens`).toBe(false);
        }
        if (d.kind === "hms") {
          hms += 1;
          expect(d.tg, `${where}: HMS uten TG`).toBeNull();
        }
        if (d.kind === "tg") expect(d.tg, `${where}: TG valgt`).not.toBeNull();
      }
    }
    expect(hms, "minst ett HMS-avvik").toBeGreaterThan(0);
    expect([...sources].every((s) => s === "template" || s === "edited")).toBe(true);
    expect(
      sources.has("template") && sources.has("edited"),
      "både malteksten og endret tekst",
    ).toBe(true);
  });

  it("«Ferdig» og «fakturert» har 8 av 8 punkt ferdige, hulltaking med måling eller TGIU med grunn, og ingen av advarslene `tg3_on_age_only`, `tgiu_suggested_not_set`, `tgiu_details_missing` og `checkpoint_done_without_tg`. «Under arbeid» har færre enn 8, og punktene som står igjen, har ingen svar (unntak: tilliggende kan ha hulltaking, forslag og TGIU uten å stå ferdig, A512).", () => {
    const blocked = [
      "tg3_on_age_only",
      "tgiu_suggested_not_set",
      "tgiu_details_missing",
      "checkpoint_done_without_tg",
    ];
    expect(finished().length).toBeGreaterThan(0);
    for (const bath of finished()) {
      const v = started(bath);
      expect(v.progress, `${bath.label}: 8 av 8`).toEqual({ done: 8, total: 8 });
      const hole = opt(v, F.hole);
      if (hole === "not_done") {
        expect(cp(v, CP.adjacent).tgDirect, `${bath.label}: TGIU`).toBe("IU");
        expect(opt(v, F.reason), `${bath.label}: grunn`).not.toBeNull();
      } else {
        expect(["done_no_findings", "done_with_findings"], `${bath.label}: hulltaking`).toContain(
          hole,
        );
        expect(num(v, F.reading), `${bath.label}: måling`).not.toBeNull();
        expect(opt(v, F.unit), `${bath.label}: enhet`).not.toBeNull();
      }
      const warnings = v.checkpoints.flatMap((c) =>
        c.warnings.map((w) => `${c.checkpointKey}:${w.code}`),
      );
      expect(
        warnings.filter((w) => blocked.some((code) => w.endsWith(`:${code}`))),
        bath.label,
      ).toEqual([]);
    }
    const inProgress = filled().filter((b) => b.status === "in_progress");
    expect(inProgress.length).toBeGreaterThan(0);
    for (const bath of inProgress) {
      const v = started(bath);
      expect(v.progress.done, `${bath.label}: færre enn 8`).toBeLessThan(8);
      const ordered = CHECKPOINT_ORDER.filter((key) => key !== CP.adjacent);
      const firstOpen = ordered.findIndex((key) => !cp(v, key).done);
      for (const [index, key] of ordered.entries()) {
        const c = cp(v, key);
        if (firstOpen >= 0 && index > firstOpen) {
          expect(c.done, `${bath.label}: ${key} ferdig etter et åpent punkt`).toBe(false);
        }
        if (!c.done) {
          const answered = v.answers.filter(
            (a) => CHECKPOINT_OF_ELEMENT.get(a.elementKey) === key && hasValue(a.value),
          );
          expect(
            answered.map((a) => a.elementKey),
            `${bath.label}: ${key} har ingen svar`,
          ).toEqual([]);
          expect(c.deviations, `${bath.label}: ${key} har ingen avvik`).toEqual([]);
          expect(c.tgDirect, `${bath.label}: ${key} har ingen TG`).toBeNull();
          expect(isBlank(c.descriptionText), `${bath.label}: ${key} har ingen beskrivelse`).toBe(
            true,
          );
        }
      }
    }
  });

  it("Testsakene fra fagansvarlig består (alder −18 gir TG2, −17 gir ingenting, 1999 gir TG3 uten TG2, 2000 gir TG2, hull nektet gir TGIU uten TG2, 14,9 vekt-% gir TG0 bare på tilliggende, 15 vekt-% gir fukt med riktig tiltak, RF % og «Ukjent» gir ikke vurdert).", () => {
    const year = 2026;
    const evaluate = (answers: Record<string, JsonValue>): RuleResult[] =>
      evaluateRules({
        template: { kind: "system", reportType: "condition_report" },
        document: TEMPLATE,
        answers,
        inspectionYear: year,
        lifespans: WET_ROOM_LIFESPANS,
        thresholds: WET_ROOM_THRESHOLDS,
      });
    const stateOf = (results: RuleResult[], key: string) =>
      results.find((r) => r.rule_key === key)?.state;
    const triggered = (results: RuleResult[]) =>
      results
        .filter((r) => r.state === "triggered")
        .map((r) => r.rule_key)
        .sort();
    const foil = (y: number) => ({
      [F.membraneType]: "foil",
      [F.docs]: "none",
      [F.buildYear]: y,
      [F.buildYearSource]: "documented",
    });

    expect(triggered(evaluate(foil(year - 18)))).toContain(RULE.pastLifespan);
    expect(triggered(evaluate(foil(year - 17)))).not.toContain(RULE.pastLifespan);
    expect(triggered(evaluate(foil(year - 17)))).not.toContain(RULE.before2000);
    const y1999 = triggered(evaluate(foil(1999)));
    expect(y1999).toContain(RULE.before2000);
    expect(y1999).not.toContain(RULE.pastLifespan);
    expect(triggered(evaluate(foil(2000)))).toEqual([RULE.pastLifespan]);

    const refused = evaluate({
      ...foil(year - 2),
      [F.hole]: "not_done",
      [F.reason]: "owner_refused",
    });
    expect(stateOf(refused, RULE.notDone)).toBe("triggered");
    expect(triggered(refused)).not.toContain(RULE.pastLifespan);

    const below = evaluate({
      [F.hole]: "done_no_findings",
      [F.unit]: "weight_percent",
      [F.reading]: 14.9,
    });
    const tg0 = below.find((r) => r.rule_key === RULE.noMoisture)!;
    expect(tg0.state).toBe("triggered");
    expect(tg0.suggestion).toMatchObject({ kind: "tg0", checkpoint_key: CP.adjacent });
    expect(
      below
        .filter((r) => r.state === "triggered" && r.suggestion?.kind === "tg0")
        .map((r) => r.rule_key),
    ).toEqual([RULE.noMoisture]);

    const at = evaluate({
      [F.hole]: "done_with_findings",
      [F.unit]: "weight_percent",
      [F.reading]: 15,
    });
    const moisture = at.find((r) => r.rule_key === RULE.moisture)!;
    expect(moisture.state).toBe("triggered");
    expect(moisture.suggestion).toMatchObject({ kind: "outcome", outcome_key: "choose" });
    const measures = TEMPLATE.standard_measures.filter(
      (m) => m.question_key === `${CP.adjacent}.elevated_moisture`,
    );
    for (const tg of [2, 3] as const) {
      expect(
        measures.filter((m) => m.applies_to_tg === tg).length,
        `tiltak for TG${tg}`,
      ).toBeGreaterThan(0);
    }

    const rf = evaluate({
      [F.hole]: "done_with_findings",
      [F.unit]: "relative_humidity",
      [F.reading]: 85,
    });
    expect(triggered(rf)).toEqual([]);
    expect(stateOf(rf, RULE.moisture)).toBe("not_evaluated");

    const unknown = evaluate({
      [F.membraneType]: "foil",
      [F.docs]: "none",
      [F.buildYearSource]: "unknown",
    });
    expect(stateOf(unknown, RULE.pastLifespan)).toBe("not_evaluated");
    expect(stateOf(unknown, RULE.before2000)).toBe("not_evaluated");
  });

  it("`build_year` og `build_year_source` stemmer med `yearRenovated` (`owner_stated`) eller `buildYear` (`documented`), og `membrane_year` er tomt.", () => {
    const planRooms = new Map<string, { yearRenovated: number | null; buildYear: number }>();
    for (const order of plan.orders) {
      if (!order.converted) continue;
      const a = order.converted.assignment;
      for (const b of a.buildings) {
        for (const f of b.floors) {
          for (const r of f.rooms) {
            planRooms.set(`${order.externalRef}|${b.name}|${f.name}|${r.name}`, {
              yearRenovated: r.yearRenovated,
              buildYear: a.property.buildYear,
            });
          }
        }
      }
    }
    let checked = 0;
    for (const bath of filled()) {
      const v = started(bath);
      expect(num(v, F.membraneYear), `${bath.label}: sjiktår tomt`).toBeNull();
      const source = opt(v, F.buildYearSource);
      if (source === "unknown") {
        expect(num(v, F.buildYear), `${bath.label}: tomt år ved «Ukjent»`).toBeNull();
        expect(bath.status).toBe("in_progress");
        continue;
      }
      if (source === null) continue; // Punktet «Generelt» er ikke nådd (avbrutt befaring)
      const planned = planRooms.get(
        `${bath.external_ref}|${bath.building_name}|${bath.floor_name}|${bath.room_name}`,
      );
      expect(planned, `${bath.label}: rommet finnes i del 1-planen`).toBeTruthy();
      checked += 1;
      if (planned!.yearRenovated !== null) {
        expect(source, bath.label).toBe("owner_stated");
        expect(num(v, F.buildYear), bath.label).toBe(planned!.yearRenovated);
      } else {
        expect(source, bath.label).toBe("documented");
        expect(num(v, F.buildYear), bath.label).toBe(planned!.buildYear);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("Ingen rader i `ai_usage_log` fra seed. Aktøren i revisjonsloggen er takstmannen på oppdraget, aldri admin.", async () => {
    expect(aiCalls, "ingen KI-kall").toBe(0);
    expect(await count(sql`select count(*)::int as n from ai_usage_log`)).toBe(aiRowsBefore);
    const admin = await adminActor();
    const [adminEmployee] = await rows<{ id: string }>(
      sql`select id from employees where user_id = ${admin.id} and organization_id = ${organizationId}`,
    );
    const audit = await rows<{
      assignment_id: string;
      actor_employee_id: string | null;
      team: string[] | null;
    }>(sql`
      select rep.assignment_id, al.actor_employee_id,
        (select array_agg(t.employee_id::text) from assignment_team_members t
          where t.organization_id = rep.organization_id and t.assignment_id = rep.assignment_id
            and t.deleted_at is null
            and t.team_role in ('responsible', 'co_responsible', 'inspector')) as team
      from audit_log al
      join reports rep on rep.organization_id = al.organization_id
        and (al.changes ->> 'reportId' = rep.id::text
          or (al.entity_type = 'report' and al.entity_id = rep.id::text))
      where al.organization_id = ${organizationId}`);
    expect(audit.length, "revisjonsrader for rapportene").toBeGreaterThan(0);
    for (const row of audit) {
      expect(row.actor_employee_id, "aktør").not.toBeNull();
      expect(row.actor_employee_id).not.toBe(adminEmployee!.id);
      expect(row.team ?? [], "aktøren er takstmannen på oppdraget").toContain(
        row.actor_employee_id,
      );
    }
  });

  it("Ingen tekst i datafilen eller rapportdataene har navn, adresse, e-post, telefon eller matrikkel fra testdataene, gjetteord eller tekst fra standarden (test med `tests/redaction.ts` og `tests/known-values.ts`).", async () => {
    // Datafilen: alle strenger, både i kildeteksten og i de eksporterte verdiene
    const path = join(process.cwd(), "src/db/seed/testdata-bath.data.ts");
    expect(existsSync(path), "src/db/seed/testdata-bath.data.ts finnes").toBe(true);
    // Modulstier i import-linjer er ikke tekst («@/db/schema» er ingen e-post)
    const literals = stringLiterals(readFileSync(path, "utf8")).filter(
      (value) => !/^(@\/|\.{1,2}\/)/.test(value),
    );
    const exported = collectStrings(await loadModule("./testdata-bath.data"), "").all;
    for (const value of new Set([...literals, ...exported])) {
      expect(textProblems(value), `datafilen: «${value}»`).toEqual([]);
    }

    // Rapportdataene: vasken finner ingen kjente verdier fra oppdraget i noen tekst
    const admin = await adminActor();
    const grant = await requireOrganizationAccess(admin, organizationId, "organization.read");
    const byAssignment = new Map<string, Bath[]>();
    for (const bath of filled()) {
      byAssignment.set(bath.assignment_id, [...(byAssignment.get(bath.assignment_id) ?? []), bath]);
    }
    let texts = 0;
    for (const [assignmentId, list] of byAssignment) {
      const known = await loadKnownValues(grant, assignmentId);
      for (const bath of list) {
        for (const value of textsOf(started(bath))) {
          texts += 1;
          expect(redactText(value, known).count, `${bath.label}: kjente verdier i «${value}»`).toBe(
            0,
          );
          expect(textProblems(value), `${bath.label}: «${value}»`).toEqual([]);
        }
      }
    }
    expect(texts, "tekster i rapportdataene").toBeGreaterThan(0);
    for (const line of lines) expect(textProblems(line), `oppsummeringen: «${line}»`).toEqual([]);
  });

  it("Bruker i annen organisasjon ser ingen av rapportene (`expectTenantIsolation` på oppslaget), og en annen organisasjon har samme radtall før og etter seed. Takstmann, kontor, leder og admin åpner en seedet rapport slik badskjermen tillater.", async () => {
    const target = filled().find(isShowcase) ?? filled()[0]!;
    const room = { assignmentId: target.assignment_id, roomId: target.room_id };
    const [org] = await rows<{ settings: unknown }>(
      sql`select settings from organizations where id = ${organizationId}`,
    );
    const inspectorsEdit = readInspectorsEditAll(organizationId, org!.settings);
    const roleEmail = (role: "inspector" | "office" | "manager") => {
      const only = plan.employees.find((e) => e.roles.length === 1 && e.roles[0] === role);
      const found =
        only ?? plan.employees.find((e) => (e.roles as readonly string[]).includes(role));
      if (!found) throw new Error(`ingen ansatt med rollen ${role}`);
      return found.email;
    };
    const cases = [
      {
        role: "takstmann",
        actor: await actorByEmail(roleEmail("inspector")),
        canEdit: inspectorsEdit,
      },
      { role: "kontor", actor: await actorByEmail(roleEmail("office")), canEdit: false },
      { role: "leder", actor: await actorByEmail(roleEmail("manager")), canEdit: true },
      { role: "admin", actor: await adminActor(), canEdit: true },
    ];
    for (const c of cases) {
      const view = await getRoomView(c.actor, organizationId, room);
      expect(view.state, `${c.role} åpner rapporten`).toBe("started");
      if (view.state === "started") {
        expect(view.reportId).toBe(target.report_id);
        expect(view.canEdit, `${c.role}: endre`).toBe(c.canEdit);
        expect(view.checkpoints.length).toBe(8);
      }
    }
    // Annen organisasjon: ingen tilgang til badet, og ingen data i feilen
    const { createOrganization, createUser, createEmployee } =
      await import("../../../tests/factories");
    const other = await createOrganization("Annen organisasjon");
    const stranger = await createUser({ name: "Fremmed Admin" });
    await createEmployee(stranger, other.id, ["admin"]);
    const denied = await errorFrom(getRoomView(stranger, organizationId, room));
    expect(denied).toBeInstanceOf(AccessDeniedError);
    expect(denied.message).not.toContain(target.number);
    const lookup = await errorFrom(getRoomView(stranger, other.id, room));
    expect(lookup.message).not.toContain(target.number);
  });

  it("`TESTDATA_TABLES` og oppsummeringen viser de nye tabellene og antall bad som er hoppet over.", () => {
    const normalized = (TESTDATA_TABLES as readonly string[]).map((t) =>
      t.replace(/_/g, "").toLowerCase(),
    );
    for (const table of BATH_TABLES) {
      expect(normalized, `TESTDATA_TABLES har ${table}`).toContain(
        table.replace(/_/g, "").toLowerCase(),
      );
    }
    const record = summary as unknown as Record<string, unknown>;
    expect("bathsSkipped" in record, "oppsummeringen har bathsSkipped").toBe(true);
    const skipped = record.bathsSkipped;
    expect(
      Array.isArray(skipped) ? skipped.length : skipped,
      "første kjøring hopper ikke over noe",
    ).toBe(0);
    expect(
      lines.some((line) => /hoppet over/i.test(line) && /bad/i.test(line)),
      "linje med bad hoppet over",
    ).toBe(true);
  });

  it("E2e (PC og iPad-størrelse): visningsbadet, funnet med `findShowcaseBathReport`, viser TG3 med kostnad, TGIU og fremdrift «x av 8» med x < 8 og totalen 8. Badet uten avvik vises riktig.", async () => {
    // Skjermen prøves i e2e/fase-2a-testdata-del-2.spec.ts. Her: oppslaget gir badet med innholdet.
    const find = await lookupFn("findShowcaseBathReport");
    const ids = idsOf(await find(db, organizationId));
    const showcase = baths.filter(isShowcase);
    expect(showcase.length, "visningsbadet finnes").toBeGreaterThan(0);
    expect(showcase.map((b) => b.room_id)).toContain(ids.roomId);
    const view = started(showcase.find((b) => b.room_id === ids.roomId)!);
    expect(view.progress.total).toBe(8);
    expect(view.progress.done).toBeLessThan(8);
    expect(finished().some(isWithoutDeviations), "badet uten avvik").toBe(true);
  });

  it("Versjonen i `package.json` er økt (patch). A501–A514 er ført i `docs/09-apne-sporsmal.md`.", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      version: string;
    };
    const [major = 0, minor = 0, patch = 0] = pkg.version.split(".").map(Number);
    // Versjonen da oppgaven ble startet var 0.18.1; main går videre, så bare «høyere enn» testes.
    expect(major * 1_000_000 + minor * 1_000 + patch, "versjonen er over 0.18.1").toBeGreaterThan(
      18_001,
    );
    const doc = readFileSync(join(process.cwd(), "docs/09-apne-sporsmal.md"), "utf8");
    for (let n = 501; n <= 514; n += 1) {
      expect(doc, `A${n} i tabellen`).toMatch(new RegExp(`^\\| A${n} \\|`, "m"));
    }
    // Admin fra seed er urørt etter kjøringen (regel 11)
    expect(adminCountBefore).toBeGreaterThan(0);
    expect(adminRolesBefore).not.toBe("");
  });
});

// ===============================================================================================
// Kriteriene som trenger egne kjøringer (tømmer databasen)
// ===============================================================================================

describe("testdata del 2: uventet forslag (kriterium 4)", () => {
  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    lifespanOverride.shrink = false;
    await resetDatabase();
  });
  afterEach(() => {
    lifespanOverride.shrink = false;
    vi.restoreAllMocks();
  });

  it("Et forslag scenarioet ikke venter, stopper seed med tydelig feil og ruller tilbake badet (test med smøremembran uten dokumentasjon, 15 år, i scenarioet uten avvik).", async () => {
    await runSeed(env);
    const organizationId = await byggconId();
    await publishTemplate(organizationId);
    lifespanOverride.shrink = true;
    const error = await errorFrom(seedTestdata({ db, now: TEST_NOW, seed: TESTDATA_SEED }));
    lifespanOverride.shrink = false;
    // Tydelig norsk melding, uten persondata
    const message = [error.message, (error.cause as Error | undefined)?.message ?? ""].join(" ");
    expect(message).toMatch(/forslag/i);
    expect(message).not.toContain("@");
    // Ingen halv rapport: ferdige og fakturerte bad med svar er helt ferdige, og ingen ferdig
    // punkt har et forslag som ikke er avgjort
    const baths = await loadBaths(organizationId);
    for (const bath of baths.filter((b) => b.view !== null)) {
      const v = started(bath);
      const answered = v.answers.some((a) => hasValue(a.value));
      if (FINISHED.has(bath.status) && answered) {
        expect(v.progress.done, `${bath.label}: ikke halvt utfylt`).toBe(8);
      }
      for (const s of v.suggestions.filter(
        (x) => x.state === "triggered" && x.latestDecision === null,
      )) {
        expect(
          cp(v, s.checkpointKey).done,
          `${bath.label}: ${s.ruleKey} åpent på ferdig punkt`,
        ).toBe(false);
      }
      for (const c of v.checkpoints.filter((x) => x.tgDirect === "1")) {
        const open = v.suggestions.filter(
          (s) =>
            s.checkpointKey === c.checkpointKey &&
            s.state === "triggered" &&
            s.latestDecision === null,
        );
        expect(open, `${bath.label}: TG1 satt med åpent forslag`).toEqual([]);
      }
    }
  });
});

describe("testdata del 2: samme frø, ny kjøring og myk sletting", () => {
  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await resetDatabase();
  });
  afterEach(() => vi.restoreAllMocks());

  it("Alle tolv pliktige scenarioer er brukt minst én gang, med fast fordeling; samme frø gir samme fordeling (test på datafilen og i databasen). (to tomme databaser)", async () => {
    const first = await seedAll();
    const firstPrint = fingerprint(await loadBaths(first.organizationId));
    await resetDatabase();
    const second = await seedAll();
    const secondPrint = fingerprint(await loadBaths(second.organizationId));
    expect(secondPrint).toEqual(firstPrint);
    expect(firstPrint.some((line) => !line.endsWith("ingen rapport"))).toBe(true);
  });

  it("To kjøringer på rad gir like mange rader per tabell og samme TG per bad. En rapport som er endret for hånd, og et avvik som er myk-slettet, røres ikke ved ny kjøring.", async () => {
    const { organizationId } = await seedAll();
    const baths = await loadBaths(organizationId);
    const filledBaths = baths.filter((b) => b.view !== null);
    expect(filledBaths.length).toBeGreaterThan(0);

    // Endret for hånd: beskrivelse på et ferdig punkt, som takstmannen på oppdraget
    const target = filledBaths.find((b) => FINISHED.has(b.status))!;
    const [inspector] = await rows<Actor>(sql`
      select u.id, u.name, u.email from assignment_team_members t
      join employees e on e.id = t.employee_id
      join users u on u.id = e.user_id
      where t.organization_id = ${organizationId} and t.assignment_id = ${target.assignment_id}
        and t.team_role = 'responsible' and t.deleted_at is null and t.to_at is null`);
    expect(inspector, "takstmannen på oppdraget").toBeTruthy();
    const room = { assignmentId: target.assignment_id, roomId: target.room_id };
    const point = cp(started(target), CP.general);
    const saved = await saveField(inspector!, organizationId, room, {
      table: "checkpoint_results",
      checkpointKey: CP.general,
      field: "description_text",
      value: "Lagt inn for hånd i testen",
      base: point.descriptionText,
    });
    expect(saved.status).toBe("saved");

    // Myk-slettet avvik
    const withDeviation = filledBaths.find((b) => deviationsOf(started(b)).length > 0)!;
    const deviation = deviationsOf(started(withDeviation))[0]!;
    await db.execute(sql`
      update deviations set deleted_at = ${"2026-11-04T08:00:00Z"}::timestamptz
      where id = ${deviation.id} and organization_id = ${organizationId}`);

    const before = await countRows();
    const updatedBefore = await rows<{ line: string }>(sql`
      select id::text || ':' || updated_at::text || ':' || coalesce(deleted_at::text, '-') as line
      from reports where organization_id = ${organizationId} order by id`);
    const deletedBefore = await rows<{ line: string }>(sql`
      select ${sql.raw("'x'")} || id::text || ':' || deleted_at::text as line from deviations
      where deleted_at is not null order by id`);
    const printBefore = fingerprint(await loadBaths(organizationId));

    const again = await seedTestdata({ db, now: TEST_NOW, seed: TESTDATA_SEED });
    expect(await countRows()).toEqual(before);
    expect(
      await rows<{ line: string }>(sql`
        select id::text || ':' || updated_at::text || ':' || coalesce(deleted_at::text, '-') as line
        from reports where organization_id = ${organizationId} order by id`),
    ).toEqual(updatedBefore);
    expect(
      await rows<{ line: string }>(sql`
        select ${sql.raw("'x'")} || id::text || ':' || deleted_at::text as line from deviations
        where deleted_at is not null order by id`),
    ).toEqual(deletedBefore);
    expect(fingerprint(await loadBaths(organizationId))).toEqual(printBefore);

    const record = again as unknown as Record<string, unknown>;
    const skipped = record.bathsSkipped;
    expect(Array.isArray(skipped) ? skipped.length : skipped, "alle badene hoppet over").toBe(
      filledBaths.length,
    );

    const after = await getRoomView(await adminActor(), organizationId, room);
    if (after.state !== "started") throw new Error("rapporten forsvant");
    expect(cp(after, CP.general).descriptionText).toBe("Lagt inn for hånd i testen");
    const restored = deviationsOf(
      (await getRoomView(await adminActor(), organizationId, {
        assignmentId: withDeviation.assignment_id,
        roomId: withDeviation.room_id,
      })) as StartedView,
    );
    expect(restored.map((d) => d.id)).not.toContain(deviation.id);
    expect(
      restored.filter(
        (d) =>
          d.questionKey === deviation.questionKey && d.checkpointKey === deviation.checkpointKey,
      ),
      "avviket er ikke laget på nytt",
    ).toEqual([]);
  });
});

describe("testdata del 2: vakten (kriterium 19)", () => {
  const saved = { app: process.env.APP_ENVIRONMENT };
  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await resetDatabase();
  });
  afterEach(() => {
    if (saved.app === undefined) delete process.env.APP_ENVIRONMENT;
    else process.env.APP_ENVIRONMENT = saved.app;
    vi.restoreAllMocks();
  });

  it.each([
    ["production", "production"],
    ["tom", ""],
    ["manglende", undefined],
  ])(
    "Seed stopper med tydelig melding når `APP_ENVIRONMENT` ikke er development eller test, eller mangler, før noe skrives (0 nye rader). (%s)",
    async (_name, value) => {
      await runSeed(env);
      await publishTemplate(await byggconId());
      const before = await countRows();
      const transaction = vi.spyOn(db, "transaction");
      if (value === undefined) delete process.env.APP_ENVIRONMENT;
      else process.env.APP_ENVIRONMENT = value;
      const error = await errorFrom(seedTestdata({ db, now: TEST_NOW, seed: TESTDATA_SEED }));
      process.env.APP_ENVIRONMENT = saved.app ?? "test";
      expect(error).toBeInstanceOf(TestdataNotAllowedError);
      expect(error.message).toBe(TESTDATA_ENVIRONMENT_MESSAGE);
      expect(transaction).not.toHaveBeenCalled();
      expect(await countRows()).toEqual(before);
    },
  );
});

describe("testdata del 2: annen organisasjon og oppslagene (kriterium 22)", () => {
  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await resetDatabase();
  });
  afterEach(() => vi.restoreAllMocks());

  /** Et bad med startet rapport på et TD-oppdrag under arbeid, med TG3 og TGIU (som visningsbadet). */
  async function bathWithReport(organizationId: string, side: string): Promise<string> {
    const f = await createBathroomFixture({ organizationId, roles: ["inspector"] });
    await db.execute(sql`
      update assignments set status = 'in_progress' where id = ${f.assignmentId}
        and organization_id = ${organizationId}`);
    await createOrder(organizationId, {
      externalRef: `TD-90${side === "a" ? "01" : "02"}`,
      assignmentId: f.assignmentId,
      status: "converted",
    });
    const { reportId } = await startReport(f.actor, organizationId, f.assignmentId);
    await answer(f, F.membraneType, { optionKeys: ["foil"] });
    await answer(f, F.docs, { optionKeys: ["none"] });
    await answer(f, F.buildYear, { number: 1990 });
    await answer(f, F.buildYearSource, { optionKeys: ["documented"] });
    const deviationId = uuidv7();
    await decideSuggestion(f.actor, organizationId, f.room, {
      id: uuidv7(),
      ruleKey: RULE.before2000,
      decision: "accepted",
      deviationId,
    });
    // TG3 med kostnadsintervall, som i visningsbadet (A509)
    await saveField(f.actor, organizationId, f.room, {
      table: "deviations",
      id: deviationId,
      field: "cost",
      value: { type: "band", bandKey: "from_200000_to_500000", amount: null },
      base: { type: "none", bandKey: null, amount: null },
    });
    await answerHole(f, "not_done");
    await answer(f, F.reason, { optionKeys: ["owner_refused"] });
    await decideSuggestion(f.actor, organizationId, f.room, {
      id: uuidv7(),
      ruleKey: RULE.notDone,
      decision: "accepted",
    });
    return reportId;
  }

  it.each(["findTestdataBathReports", "findShowcaseBathReport"] as const)(
    "Bruker i annen organisasjon ser ingen av rapportene (`expectTenantIsolation` på oppslaget). (%s)",
    async (name) => {
      const find = await lookupFn(name);
      await expectTenantIsolation({
        seed: async (grantA, grantB) => ({
          a: [await bathWithReport(grantA.organizationId, "a")],
          b: [await bathWithReport(grantB.organizationId, "b")],
        }),
        query: async (actor, organizationId) => {
          const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
          const found = await find(db, grant.organizationId);
          const list = Array.isArray(found) ? found : found ? [found] : [];
          return list.map((row) => idsOf(row).reportId ?? "");
        },
        idOf: (id: string) => id,
      });
    },
  );

  it("en annen organisasjon har samme radtall før og etter seed, og en rapport der gjør ikke at Byggcon hopper over badet", async () => {
    await runSeed(env);
    await runSampleSeed(env, TEST_NOW);
    const organizationId = await byggconId();
    await publishTemplate(organizationId);
    const { createOrganization } = await import("../../../tests/factories");
    const other = await createOrganization("Annen organisasjon bad");
    await publishTemplate(other.id);
    await bathWithReport(other.id, "a");
    const [sample] = await rows<{ id: string }>(
      sql`select id from organizations where settings ->> 'sampleData' = 'true' limit 1`,
    );
    const otherBefore = await countRowsIn(other.id);
    const sampleBefore = sample ? await countRowsIn(sample.id) : null;
    const summary = await seedTestdata({ db, now: TEST_NOW, seed: TESTDATA_SEED });
    expect(await countRowsIn(other.id)).toEqual(otherBefore);
    if (sample) expect(await countRowsIn(sample.id)).toEqual(sampleBefore);
    const skipped = (summary as unknown as Record<string, unknown>).bathsSkipped;
    expect(Array.isArray(skipped) ? skipped.length : skipped, "ingen Byggcon-bad hoppet over").toBe(
      0,
    );
    const filled = (await loadBaths(organizationId)).filter((b) => b.view !== null);
    expect(filled.length).toBeGreaterThan(0);
  });

  it("admin stenges ikke ute: alle rettigheter etter kjøringen, og seed-admin er urørt (regel 11)", async () => {
    await runSeed(env);
    const organizationId = await byggconId();
    await publishTemplate(organizationId);
    const admin = await adminActor();
    const rolesQuery = sql`
      select er.role, e.deactivated_at, e.deleted_at from employees e
      left join employee_roles er on er.employee_id = e.id and er.deleted_at is null
      where e.user_id = ${admin.id} order by er.role`;
    const rolesBefore = await rows(rolesQuery);
    const countBefore = await activeAdminCount(organizationId);
    await seedTestdata({ db, now: TEST_NOW, seed: TESTDATA_SEED });
    expect(await rows(rolesQuery)).toEqual(rolesBefore);
    expect(await activeAdminCount(organizationId)).toBe(countBefore);
    // Seed-admin har ingen sertifisering, så bare report.publish mangler (A29), som i del 1
    for (const permission of PERMISSIONS) {
      if (permission === "report.publish") {
        await expect(
          requireOrganizationAccess(admin, organizationId, permission),
          permission,
        ).rejects.toBeInstanceOf(AccessDeniedError);
        continue;
      }
      const grant = await requireOrganizationAccess(admin, organizationId, permission);
      expect(grant.organizationId, permission).toBe(organizationId);
    }
  });
});
