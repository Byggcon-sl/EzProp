import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import { ROOM_TYPES } from "@/core/buildings";
import { inspectionYearOf } from "@/core/reports/context";
// Tjenestene importeres fra filene, ikke fra `@/core/reports`: inngangen der er merket
// `server-only` for Next.js og kan ikke lastes av `tsx` i `pnpm db:seed:testdata`. Det er de samme
// tjenestene, med samme tilgangssjekk, revisjonslogg og validering.
import { addDeviation } from "@/core/reports/deviations";
import { startReport } from "@/core/reports/reports";
import { saveField } from "@/core/reports/save-field";
import { decideSuggestion } from "@/core/reports/suggestions";
import { setCheckpointDone, setTgDirect } from "@/core/reports/tgiu";
import type {
  ActionResult,
  AnswerValue,
  CheckpointView,
  DecideSuggestionResult,
  RoomRef,
  RoomRefresh,
  SaveFieldResult,
} from "@/core/reports/types";
import { evaluateRules, type JsonValue, type RuleAnswers, type RuleResult } from "@/core/rules";
import { WET_ROOM_LIFESPANS } from "@/core/rules/data/lifespans";
import { WET_ROOM_THRESHOLDS } from "@/core/rules/data/thresholds";
import { getTemplateVersion, type TemplateDocument } from "@/core/templates";
import type { Database } from "@/db/client";
import {
  assignments,
  assignmentTeamMembers,
  checkpointResults,
  deviationMeasures,
  deviations,
  employees,
  fieldAnswers,
  floors,
  orders,
  reportBuildings,
  reports,
  rooms,
  ruleSuggestionDecisions,
  templateFamilies,
  templateVersions,
  tgiuDetails,
  users,
} from "@/db/schema";
import { uuidv7 } from "@/shared/lib/uuid";
import { createSeededRandom } from "./seeded-random";
import { wetRoomTemplate } from "./templates/wet-room";
import {
  BATH_ASSIGNMENT_STATUSES,
  BATH_RULES,
  MANDATORY_BATH_SCENARIO_KEYS,
  SHOWCASE_BATH_SCENARIO_KEY,
  TESTDATA_BATH_EDITED_TEXTS,
  TESTDATA_BATH_SCENARIOS,
  WET_ROOM_CHECKPOINT_ORDER,
  bathScenarioByKey,
  type BathAgeProfile,
  type BathAnswer,
  type BathAssignmentStatus,
  type BathCheckpointKey,
  type BathEditedTextKey,
  type BathExpectedDeviation,
  type BathScenario,
} from "./testdata-bath.data";
import { findTestdataOrganization, resolveTestdataPlan } from "./testdata-anchor";
import { assertTestdataAllowed } from "./testdata-guard";
import { TESTDATA_ORDER_PREFIX } from "./testdata.data";
import type { TestdataPlan } from "./testdata.types";

/*
 * Testdata, del 2: badene i testoppdragene fylt ut (docs/funksjoner/fase2a-testdata-del-2.md).
 * Kalles fra `seedTestdata` etter del 1.
 *
 * Støtter hovedmålene: de ansatte får bad som ligner ekte befaringer i testmiljøet; KI i bunnen
 * får strukturerte avvik og regelbeslutninger i samme form som ekte data (ingen rader i
 * `ai_usage_log`, A503); færre reklamasjoner fordi TG bare kommer fra regelmotoren og malen.
 *
 * - Vakten (`assertTestdataAllowed`) kjøres før noe databasekall.
 * - Alt som skrives i rapporten, går gjennom kjernetjenestene med takstmannen på oppdraget som
 *   aktør (aldri admin). Seed skriver aldri direkte til rapporttabellene.
 * - Fordelingen av scenarioer er fast (`assignBathScenarios`, A504). Befaringsåret kommer fra
 *   oppdragets befaringsdato, aldri fra «i dag».
 * - Før noe skrives, kjøres regelmotoren på hvert bad med de svarene scenarioet skal gi. Gir den
 *   et forslag scenarioet ikke venter, eller mangler et forslag, stopper seed med norsk melding,
 *   og ingenting er skrevet. Tjenestene har hver sin transaksjon, så denne kontrollen er det som
 *   hindrer halve bad (se funnet om transaksjon per bad i kortet).
 * - Ny kjøring: et bad som alt har svar eller punkt i rapporten, hoppes over (A508). Ingenting
 *   overskrives, ingenting slettes, og myk-slettede avvik lages ikke på nytt.
 * - Feilmeldingene har bare oppdragsnummer, romnavn fra planen og scenarionavn, aldri adresse,
 *   navn eller verdier fra databasen.
 */

export type Db = Database;

/** Feil i badsteget. Meldingen er norsk og har ingen personopplysninger. */
export class TestdataBathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestdataBathError";
  }
}

// ---------------------------------------------------------------------------------------------
// Badene og fordelingen (ren)
// ---------------------------------------------------------------------------------------------

/** Et våtrom i et testoppdrag, med det fordelingen trenger. */
export type TestdataBathCandidate = {
  /** Sorteringsnøkkelen: oppdragsnummeret i databasen, eller `TD-`-nøkkelen i planen. */
  assignmentKey: string;
  /** Oppdragsnummeret som vises i oppsummeringen (`TD-`-nøkkelen når nummeret ikke finnes). */
  assignmentLabel: string;
  status: string;
  /** Befaringsåret fra oppdragets befaringsdato, eller `null` når datoen mangler. */
  inspectionYear: number | null;
  /** Rekkefølgen på rommet i oppdraget (bygning, etasje, rom i planen). */
  roomOrder: number;
  roomName: string;
  /** Året badet ble bygget eller fikk nytt sjikt (A507). */
  bathYear: number;
  bathYearSource: "owner_stated" | "documented";
};

export type TestdataBathAssignment = {
  bath: TestdataBathCandidate;
  scenarioKey: string;
};

const WET_ROOM_TYPES: ReadonlySet<string> = new Set<string>(
  ROOM_TYPES.filter((type) => type.group === "wet_room").map((type) => type.key),
);

function isBathStatus(status: string): status is BathAssignmentStatus {
  return (BATH_ASSIGNMENT_STATUSES as readonly string[]).includes(status);
}

/** Ett svar slik seed lagrer det. */
export type BathAnswerStep = {
  checkpointKey: BathCheckpointKey;
  elementKey: string;
  value: BathAnswer;
};

/**
 * Alle svarene badet får, i malens rekkefølge per punkt: byggeåret fra badet (eller «Ukjent»),
 * svarene i scenarioet og TGIU-opplysningene på tilliggende.
 */
export function bathAnswerSteps(
  scenario: BathScenario,
  bath: Pick<TestdataBathCandidate, "bathYear" | "bathYearSource">,
): BathAnswerStep[] {
  const steps: BathAnswerStep[] = [];
  for (const checkpointKey of WET_ROOM_CHECKPOINT_ORDER) {
    const own = scenario.answers[checkpointKey];
    const add = (elementKey: string, value: BathAnswer) =>
      steps.push({ checkpointKey, elementKey, value });
    if (checkpointKey === "wet_room.general" && own !== undefined) {
      if (scenario.buildYear === "from_bath") {
        add("wet_room.build_year", bath.bathYear);
        add("wet_room.build_year_source", bath.bathYearSource);
      } else {
        add("wet_room.build_year_source", "unknown");
      }
    }
    for (const [elementKey, value] of Object.entries(own ?? {})) add(elementKey, value);
    if (checkpointKey === "wet_room.adjacent" && scenario.tgiu !== null) {
      const t = scenario.tgiu;
      add("wet_room.hole_drilling", "not_done");
      add("wet_room.hole_drilling_reason", t.reason);
      add("wet_room.hole_drilling_reason_note", t.reasonNote);
      // «Eier informert» står tomt ved andre grunner enn at eier nektet (A349)
      if (t.ownerInformed) add("wet_room.owner_informed", true);
      add("wet_room.other_moisture_method", t.alternativeMethod);
      add("wet_room.other_moisture_result", t.alternativeResult);
      add("wet_room.not_investigated_risk", t.risk);
      add("wet_room.construction_damage_prone", t.constructionVulnerable);
    }
  }
  return steps;
}

/** Svaret som lagret verdi, etter felttypen i malen. */
export function answerValueFor(document: TemplateDocument, step: BathAnswerStep): AnswerValue {
  const element = document.elements.find((e) => e.key === step.elementKey);
  if (!element) {
    throw new TestdataBathError(`Feltet ${step.elementKey} finnes ikke i den publiserte malen.`);
  }
  const empty: AnswerValue = { text: null, number: null, optionKeys: null };
  switch (element.field_type) {
    case "choice":
      return { ...empty, optionKeys: [String(step.value)] };
    case "number":
      return { ...empty, number: Number(step.value) };
    case "checkbox":
      return { ...empty, number: step.value === true ? 1 : 0 };
    default:
      return { ...empty, text: String(step.value) };
  }
}

/** Svarene slik regelmotoren leser dem (samme form som på serveren). */
export function bathRuleAnswers(
  document: TemplateDocument,
  steps: readonly BathAnswerStep[],
): RuleAnswers {
  const result: Record<string, JsonValue> = Object.create(null);
  for (const step of steps) {
    const value = answerValueFor(document, step);
    if (value.optionKeys) result[step.elementKey] = value.optionKeys;
    else if (value.number !== null) result[step.elementKey] = value.number;
    else if (value.text !== null && value.text.trim() !== "") result[step.elementKey] = value.text;
  }
  return result;
}

/** Kontrollpunktet regelen gjelder. */
function ruleCheckpointOf(document: TemplateDocument, ruleKey: string): string | null {
  const rule = document.rules.find((r) => r.key === ruleKey);
  return rule?.target_checkpoint_key ?? rule?.suggested_outcome?.checkpoint_key ?? null;
}

/** Regelmotoren på badets svar, med reglene for våtrom i malen. Setter aldri TG. */
export function evaluateBathRules(
  document: TemplateDocument,
  answers: RuleAnswers,
  inspectionYear: number,
): RuleResult[] {
  const wetRoomCheckpoints = new Set(
    document.checkpoints.filter((c) => c.room_type_groups.includes("wet_room")).map((c) => c.key),
  );
  return evaluateRules({
    template: { kind: "system", reportType: "condition_report" },
    document: {
      rules: document.rules.filter((rule) => {
        const checkpointKey = ruleCheckpointOf(document, rule.key);
        return checkpointKey !== null && wetRoomCheckpoints.has(checkpointKey);
      }),
      rule_conditions: document.rule_conditions,
      outcomes: document.outcomes,
      element_options: document.element_options,
    },
    answers,
    inspectionYear,
    lifespans: WET_ROOM_LIFESPANS,
    thresholds: WET_ROOM_THRESHOLDS,
  });
}

/** Forslagene som slår til, sortert på regelkode. */
export function triggeredRuleKeys(results: readonly RuleResult[]): string[] {
  return results
    .filter((r) => r.state === "triggered" && r.suggestion !== null)
    .map((r) => r.rule_key)
    .sort();
}

/** Aldersprofilen regelmotoren gir (A514). */
export function ageProfileOf(results: readonly RuleResult[]): BathAgeProfile {
  const triggered = new Set(triggeredRuleKeys(results));
  if (triggered.has(BATH_RULES.before2000)) return "tg3_before_2000";
  if (triggered.has(BATH_RULES.pastLifespan)) return "tg2_age";
  return "none";
}

/** Regelkodene scenarioet venter forslag fra, sortert. */
export function expectedRuleKeys(scenario: BathScenario): string[] {
  return scenario.decisions.map((d) => d.ruleKey).sort();
}

/** Hva regelmotoren gir for scenarioet på badet. */
export function evaluateScenario(
  scenario: BathScenario,
  bath: Pick<TestdataBathCandidate, "bathYear" | "bathYearSource">,
  inspectionYear: number,
  document: TemplateDocument,
) {
  const steps = bathAnswerSteps(scenario, bath);
  const results = evaluateBathRules(document, bathRuleAnswers(document, steps), inspectionYear);
  return { steps, results, triggered: triggeredRuleKeys(results), profile: ageProfileOf(results) };
}

/**
 * Om scenarioet passer badet: statusen er lov, og regelmotoren gir nøyaktig forslagene i
 * scenarioet med badets år og befaringsåret, også aldersprofilen.
 */
export function scenarioFitsBath(
  scenario: BathScenario,
  bath: TestdataBathCandidate,
  document: TemplateDocument,
): boolean {
  if (!isBathStatus(bath.status) || !scenario.allowedStatuses.includes(bath.status)) return false;
  if (bath.inspectionYear === null) return false;
  const outcome = evaluateScenario(scenario, bath, bath.inspectionYear, document);
  if (outcome.profile !== scenario.ageProfile) return false;
  const expected = expectedRuleKeys(scenario);
  return (
    outcome.triggered.length === expected.length &&
    outcome.triggered.every((key, index) => key === expected[index])
  );
}

function compareBaths(a: TestdataBathCandidate, b: TestdataBathCandidate): number {
  if (a.assignmentKey !== b.assignmentKey) return a.assignmentKey < b.assignmentKey ? -1 : 1;
  return a.roomOrder - b.roomOrder;
}

/** Ord som ikke hører hjemme i tekster om treverk (vekt-% måles i treverk, spørsmål 77 e). */
const MASONRY_WORDS = /betong|\bmur|murt|støp/i;

/**
 * De faglige grensene for et scenario (fagansvarlig 5, A505–A514). Tom liste betyr at scenarioet
 * er lov. Brukes av fordelingen, så seed aldri skriver et scenario som bryter grensene, og av
 * testene. Meldingene er norske og har bare koder.
 */
export function bathScenarioProblems(
  scenario: BathScenario,
  document: TemplateDocument = wetRoomTemplate,
): string[] {
  const problems: string[] = [];
  const order = (key: string) => WET_ROOM_CHECKPOINT_ORDER.indexOf(key as BathCheckpointKey);
  const isDone = (key: string) => order(key) >= 0 && order(key) < scenario.doneCount;
  const answers = (key: BathCheckpointKey) => scenario.answers[key] ?? {};
  const adjacent = answers("wet_room.adjacent");
  const doneOnly = scenario.allowedStatuses.every((s) => s === "completed" || s === "invoiced");
  const inProgressOnly = scenario.allowedStatuses.every((s) => s === "in_progress");

  if (doneOnly && scenario.doneCount !== 8) problems.push("ferdige bad må ha 8 av 8 punkt");
  if (inProgressOnly && scenario.doneCount >= 8)
    problems.push("bad under arbeid må ha færre enn 8");
  if (!doneOnly && !inProgressOnly) problems.push("blander under arbeid og ferdig");
  if (scenario.buildYear === "unknown" && !inProgressOnly) {
    problems.push("«Ukjent» byggeår bare under arbeid");
  }

  // Svar bare på punkt som står ferdige, og på tilliggende (A512)
  for (const key of Object.keys(scenario.answers)) {
    if (!isDone(key) && key !== "wet_room.adjacent") problems.push(`svar på urørt punkt ${key}`);
  }
  if (scenario.tgiu !== null && Object.keys(adjacent).includes("wet_room.hole_drilling")) {
    problems.push("TGIU og hulltaking på samme punkt");
  }

  // Dokumentasjon: bare tre valg (A513), og «Ingen» i et ferdig punkt gir TG2 (A510)
  const documentation = answers("wet_room.documentation")["wet_room.documentation_type"];
  if (documentation === "other_written") problems.push("other_written brukes ikke (A513)");
  const hasMissingDoc = scenario.expected.deviations.some(
    (d) => d.questionKey === "wet_room.documentation.missing_membrane_documentation",
  );
  if (isDone("wet_room.documentation") && (documentation ?? "none") === "none" && !hasMissingDoc) {
    problems.push("dokumentasjon «Ingen» uten missing_membrane_documentation (A510)");
  }

  // Hulltaking: vekt-% i treverk, RF % bare når tilliggende ikke står ferdig (A511)
  const unit = adjacent["wet_room.hole_moisture_unit"];
  const reading = adjacent["wet_room.hole_moisture_reading"];
  const drilling = adjacent["wet_room.hole_drilling"];
  if (unit === "weight_percent") {
    for (const field of ["wet_room.hole_moisture_location", "wet_room.hole_construction"]) {
      const value = adjacent[field];
      if (typeof value === "string" && MASONRY_WORDS.test(value)) {
        problems.push(`vekt-% med tekst om betong eller mur i ${field}`);
      }
    }
    if (drilling === "done_no_findings" && typeof reading === "number" && reading >= 15) {
      problems.push("utført uten funn med 15 vekt-% eller mer");
    }
  }
  if (unit === "relative_humidity" && isDone("wet_room.adjacent")) {
    problems.push("RF % på ferdig tilliggende (A511)");
  }
  if (doneOnly && drilling === undefined && scenario.tgiu === null) {
    problems.push("ferdig bad uten hulltaking eller TGIU");
  }

  // TGIU: «eier informert» bare når eier nektet (A349)
  if (
    scenario.tgiu !== null &&
    scenario.tgiu.ownerInformed !== (scenario.tgiu.reason === "owner_refused")
  ) {
    problems.push("«eier informert» stemmer ikke med grunnen");
  }

  // Beslutningene (fagansvarlig 5, A506)
  for (const decision of scenario.decisions) {
    const checkpointKey = ruleCheckpointOf(document, decision.ruleKey);
    if (checkpointKey === null) {
      problems.push(`regelen ${decision.ruleKey} finnes ikke i malen`);
      continue;
    }
    const touched =
      isDone(checkpointKey) ||
      Object.keys(scenario.answers).includes(checkpointKey) ||
      (checkpointKey === "wet_room.adjacent" && scenario.tgiu !== null);
    if (decision.decision === "open") {
      if (isDone(checkpointKey)) problems.push(`åpent forslag på ferdig punkt ${checkpointKey}`);
      if (decision.ruleKey !== BATH_RULES.before2000) problems.push("bare før 2000 kan stå åpent");
      continue;
    }
    if (!touched) problems.push(`beslutning på urørt punkt ${checkpointKey}`);
    if (decision.decision === "changed") {
      if (decision.ruleKey !== BATH_RULES.noMoisture || decision.chosenTg !== "1") {
        problems.push("eneste lovlige endring er TG0 til TG1");
      }
    }
    if (decision.decision === "rejected") {
      const allowed =
        decision.ruleKey === BATH_RULES.noMoisture &&
        decision.overrideReasonCode === "measured_again" &&
        !isDone(checkpointKey);
      if (!allowed) problems.push("eneste lovlige avvisning er TG0 med measured_again");
    }
    if (decision.decision === "accepted" && decision.ruleKey === BATH_RULES.moisture) {
      if (decision.chosenTg === undefined) problems.push("forhøyet fukt uten valgt TG");
    }
  }

  // Avvikene: TG fra malen, kostnad bare på TG3, HMS uten TG
  for (const deviation of scenario.expected.deviations) {
    const outcome = document.outcomes.find(
      (o) =>
        o.checkpoint_key === deviation.checkpointKey &&
        o.question_key === deviation.questionKey &&
        o.key === deviation.outcomeKey,
    );
    if (!outcome) {
      problems.push(`utfallet ${deviation.questionKey} finnes ikke i malen`);
      continue;
    }
    if (deviation.questionKey.endsWith(".low_threshold_height")) {
      problems.push("low_threshold_height lages ikke");
    }
    if (deviation.questionKey === "wet_room.floor.insufficient_fall") {
      const floor = answers("wet_room.floor");
      const negative = ["wet_room.fall_direction_1", "wet_room.fall_direction_2"].some(
        (key) => typeof floor[key] === "number" && (floor[key] as number) < 0,
      );
      if (!negative) problems.push("insufficient_fall bare ved motfall");
    }
    const fixedTg = outcome.kind === "tg2" ? 2 : outcome.kind === "tg3" ? 3 : null;
    if (outcome.kind === "hms" && (deviation.tg !== null || deviation.kind !== "hms")) {
      problems.push("HMS har ingen TG");
    }
    if (fixedTg !== null && deviation.tg !== fixedTg) {
      problems.push(`TG på ${deviation.questionKey} er ikke malens`);
    }
    if (outcome.kind === "choose_tg2_tg3" && deviation.tg !== 2 && deviation.tg !== 3) {
      problems.push(`velg TG2 eller TG3 uten valg på ${deviation.questionKey}`);
    }
    if (deviation.tg === 3 && deviation.cost.type === "none") problems.push("TG3 uten kostnad");
    if (deviation.tg !== 3 && deviation.cost.type !== "none") {
      problems.push("kostnad bare på TG3");
    }
    if (deviation.cost.type === "approx" && deviation.cost.amount % 10_000 !== 0) {
      problems.push("eget beløp er ikke rundet til nærmeste 10 000");
    }
    if (deviation.tg === 3 && deviation.checkpointKey === "wet_room.documentation") {
      problems.push("TG3 på dokumentasjon");
    }
    if (!isDone(deviation.checkpointKey) && deviation.checkpointKey !== "wet_room.adjacent") {
      problems.push(`avvik på urørt punkt ${deviation.checkpointKey}`);
    }
    if (deviation.source.type === "rule") {
      const ruleKey = deviation.source.ruleKey;
      const decision = scenario.decisions.find((d) => d.ruleKey === ruleKey);
      if (!decision || decision.decision !== "accepted") {
        problems.push(`avviket ${deviation.questionKey} mangler godtatt forslag`);
      }
    }
    if (deviation.plannedPhotos.length === 0) problems.push("avvik uten planlagt bilde");
    if (deviation.fieldNote.trim() === "") problems.push("avvik uten feltnotat");
  }
  return problems;
}

/** Scenarioene den tilfeldige delen kan velge: alle unntatt visningsbadet (det skal være ett). */
const RANDOM_POOL = TESTDATA_BATH_SCENARIOS.filter((s) => s.key !== SHOWCASE_BATH_SCENARIO_KEY);

/**
 * Den faste fordelingen (A504): de tolv pliktige scenarioene i fast rekkefølge på de første badene
 * som passer (sortert på oppdragsnummer og rommets plass), deretter et seedet tilfeldig valg blant
 * scenarioene som passer for resten. Bad i «bestilt» og andre statuser er ikke med. Kaster med
 * norsk melding når et bad mangler befaringsdato, eller når et scenario ikke finner et bad.
 */
export function assignBathScenarios({
  baths,
  seed,
  document = wetRoomTemplate,
}: {
  baths: readonly TestdataBathCandidate[];
  seed: number;
  document?: TemplateDocument;
}): TestdataBathAssignment[] {
  for (const scenario of TESTDATA_BATH_SCENARIOS) {
    const problems = bathScenarioProblems(scenario, document);
    if (problems.length > 0) {
      throw new TestdataBathError(
        `Scenarioet «${scenario.name}» bryter de faglige grensene: ${problems.join("; ")}. Ingen bad er fylt ut.`,
      );
    }
  }
  const eligible = baths.filter((bath) => isBathStatus(bath.status)).sort(compareBaths);
  const missingDate = eligible.find((bath) => bath.inspectionYear === null);
  if (missingDate) {
    throw new TestdataBathError(
      `Oppdrag ${missingDate.assignmentLabel} mangler befaringsdato, så byggeåret for badet kan ikke regnes. Ingen bad er fylt ut.`,
    );
  }
  const chosen = new Map<TestdataBathCandidate, string>();
  for (const key of MANDATORY_BATH_SCENARIO_KEYS) {
    const scenario = bathScenarioByKey(key);
    const bath = eligible.find(
      (candidate) => !chosen.has(candidate) && scenarioFitsBath(scenario, candidate, document),
    );
    if (!bath) {
      throw new TestdataBathError(
        `Fant ikke et bad som passer scenarioet «${scenario.name}». Ingen bad er fylt ut.`,
      );
    }
    chosen.set(bath, key);
  }
  const rng = createSeededRandom(seed);
  for (const bath of eligible) {
    if (chosen.has(bath)) continue;
    const pool = RANDOM_POOL.filter((scenario) => scenarioFitsBath(scenario, bath, document));
    if (pool.length === 0) {
      throw new TestdataBathError(
        `Fant ikke et scenario som passer ${bath.roomName} i oppdrag ${bath.assignmentLabel}. Ingen bad er fylt ut.`,
      );
    }
    chosen.set(bath, rng.pick(pool).key);
  }
  return eligible.map((bath) => ({ bath, scenarioKey: chosen.get(bath) as string }));
}

/** Badene i planen fra del 1, med `TD-`-nøkkelen som oppdragsnummer. For testene og kartet. */
export function bathCandidatesFromPlan(plan: TestdataPlan): TestdataBathCandidate[] {
  const result: TestdataBathCandidate[] = [];
  for (const order of plan.orders) {
    if (!order.converted) continue;
    const assignment = order.converted.assignment;
    let roomOrder = 0;
    for (const building of assignment.buildings) {
      for (const floor of building.floors) {
        for (const room of floor.rooms) {
          roomOrder += 1;
          if (!WET_ROOM_TYPES.has(room.roomType)) continue;
          result.push({
            assignmentKey: order.key,
            assignmentLabel: order.key,
            status: assignment.status,
            inspectionYear:
              assignment.inspectionAt === null
                ? null
                : inspectionYearOf(assignment.inspectionAt).year,
            roomOrder,
            roomName: room.name,
            bathYear: room.yearRenovated ?? assignment.property.buildYear,
            bathYearSource: room.yearRenovated !== null ? "owner_stated" : "documented",
          });
        }
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Oppslag (filtrerer alltid på organisasjonen)
// ---------------------------------------------------------------------------------------------

const isTestdataOrder = sql`left(${orders.externalRef}, ${TESTDATA_ORDER_PREFIX.length}) = ${TESTDATA_ORDER_PREFIX}`;

export type TestdataBathReportRow = {
  reportId: string;
  assignmentId: string;
  assignmentNumber: string;
  assignmentStatus: string;
  templateVersionId: string;
  roomId: string;
  roomName: string | null;
  roomType: string;
};

/**
 * Rapportene i testoppdragene (ordre med `TD-`), én rad per våtrom i oppdraget. Bare gjeldende
 * rapport og rader uten `deleted_at`.
 */
export async function findTestdataBathReports(
  db: Db,
  organizationId: string,
): Promise<TestdataBathReportRow[]> {
  return db
    .select({
      reportId: reports.id,
      assignmentId: assignments.id,
      assignmentNumber: assignments.number,
      assignmentStatus: assignments.status,
      templateVersionId: reports.templateVersionId,
      roomId: rooms.id,
      roomName: rooms.name,
      roomType: rooms.roomType,
    })
    .from(reports)
    .innerJoin(
      assignments,
      and(
        eq(assignments.id, reports.assignmentId),
        eq(assignments.organizationId, organizationId),
        isNull(assignments.deletedAt),
      ),
    )
    .innerJoin(
      orders,
      and(
        eq(orders.assignmentId, assignments.id),
        eq(orders.organizationId, organizationId),
        isTestdataOrder,
      ),
    )
    .innerJoin(
      reportBuildings,
      and(
        eq(reportBuildings.assignmentId, assignments.id),
        eq(reportBuildings.organizationId, organizationId),
        isNull(reportBuildings.deletedAt),
      ),
    )
    .innerJoin(
      floors,
      and(
        eq(floors.reportBuildingId, reportBuildings.id),
        eq(floors.organizationId, organizationId),
        isNull(floors.deletedAt),
      ),
    )
    .innerJoin(
      rooms,
      and(
        eq(rooms.floorId, floors.id),
        eq(rooms.organizationId, organizationId),
        isNull(rooms.deletedAt),
        inArray(rooms.roomType, [...WET_ROOM_TYPES]),
      ),
    )
    .where(
      and(
        eq(reports.organizationId, organizationId),
        isNull(reports.deletedAt),
        ne(reports.status, "superseded"),
      ),
    )
    .orderBy(asc(assignments.number), asc(rooms.createdAt), asc(rooms.id));
}

export type ShowcaseBathReport = {
  reportId: string;
  assignmentId: string;
  assignmentNumber: string;
  roomId: string;
  roomName: string | null;
};

/**
 * Visningsbadet (forbedrer 2), funnet på innholdet og ikke på rekkefølge: et testoppdrag under
 * arbeid der samme bad har et avvik med TG3 og et punkt med TGIU. `null` når det ikke finnes.
 */
export async function findShowcaseBathReport(
  db: Db,
  organizationId: string,
): Promise<ShowcaseBathReport | null> {
  const hasTg3 = sql`exists (
    select 1 from ${deviations}
    join ${checkpointResults} on ${checkpointResults.id} = ${deviations.checkpointResultId}
      and ${checkpointResults.organizationId} = ${organizationId}
      and ${checkpointResults.deletedAt} is null
    where ${deviations.organizationId} = ${organizationId}
      and ${deviations.reportId} = ${reports.id}
      and ${deviations.deletedAt} is null
      and ${deviations.kind} = 'tg'
      and ${deviations.tg} = 3
      and ${checkpointResults.roomId} = ${rooms.id})`;
  const hasTgiu = sql`exists (
    select 1 from ${checkpointResults}
    where ${checkpointResults.organizationId} = ${organizationId}
      and ${checkpointResults.reportId} = ${reports.id}
      and ${checkpointResults.roomId} = ${rooms.id}
      and ${checkpointResults.deletedAt} is null
      and ${checkpointResults.tgDirect} = 'IU')`;
  const [row] = await db
    .select({
      reportId: reports.id,
      assignmentId: assignments.id,
      assignmentNumber: assignments.number,
      roomId: rooms.id,
      roomName: rooms.name,
    })
    .from(reports)
    .innerJoin(
      assignments,
      and(
        eq(assignments.id, reports.assignmentId),
        eq(assignments.organizationId, organizationId),
        isNull(assignments.deletedAt),
        eq(assignments.status, "in_progress"),
      ),
    )
    .innerJoin(
      orders,
      and(
        eq(orders.assignmentId, assignments.id),
        eq(orders.organizationId, organizationId),
        isTestdataOrder,
      ),
    )
    .innerJoin(
      reportBuildings,
      and(
        eq(reportBuildings.assignmentId, assignments.id),
        eq(reportBuildings.organizationId, organizationId),
        isNull(reportBuildings.deletedAt),
      ),
    )
    .innerJoin(
      floors,
      and(
        eq(floors.reportBuildingId, reportBuildings.id),
        eq(floors.organizationId, organizationId),
        isNull(floors.deletedAt),
      ),
    )
    .innerJoin(
      rooms,
      and(
        eq(rooms.floorId, floors.id),
        eq(rooms.organizationId, organizationId),
        isNull(rooms.deletedAt),
      ),
    )
    .where(
      and(
        eq(reports.organizationId, organizationId),
        isNull(reports.deletedAt),
        eq(reports.status, "draft"),
        hasTg3,
        hasTgiu,
      ),
    )
    .orderBy(asc(assignments.number), asc(rooms.createdAt), asc(rooms.id))
    .limit(1);
  return row ?? null;
}

/** Våtrommene i testoppdragene i databasen, med det seed trenger. Bare Byggcon og TD-ordre. */
type DbBath = {
  assignmentId: string;
  assignmentNumber: string;
  assignmentStatus: string;
  inspectionAt: Date | null;
  externalRef: string;
  buildingName: string;
  floorName: string;
  roomId: string;
  roomName: string | null;
};

async function findDbBaths(db: Db, organizationId: string): Promise<DbBath[]> {
  const rows = await db
    .select({
      assignmentId: assignments.id,
      assignmentNumber: assignments.number,
      assignmentStatus: assignments.status,
      inspectionAt: assignments.inspectionAt,
      externalRef: orders.externalRef,
      buildingName: reportBuildings.name,
      floorName: floors.name,
      roomId: rooms.id,
      roomName: rooms.name,
    })
    .from(rooms)
    .innerJoin(
      floors,
      and(
        eq(floors.id, rooms.floorId),
        eq(floors.organizationId, organizationId),
        isNull(floors.deletedAt),
      ),
    )
    .innerJoin(
      reportBuildings,
      and(
        eq(reportBuildings.id, floors.reportBuildingId),
        eq(reportBuildings.organizationId, organizationId),
        isNull(reportBuildings.deletedAt),
      ),
    )
    .innerJoin(
      assignments,
      and(
        eq(assignments.id, reportBuildings.assignmentId),
        eq(assignments.organizationId, organizationId),
        isNull(assignments.deletedAt),
      ),
    )
    .innerJoin(
      orders,
      and(
        eq(orders.assignmentId, assignments.id),
        eq(orders.organizationId, organizationId),
        isNull(orders.deletedAt),
        isTestdataOrder,
      ),
    )
    .where(
      and(
        eq(rooms.organizationId, organizationId),
        isNull(rooms.deletedAt),
        inArray(rooms.roomType, [...WET_ROOM_TYPES]),
      ),
    )
    .orderBy(asc(assignments.number), asc(rooms.createdAt), asc(rooms.id));
  return rows.map((row) => ({ ...row, externalRef: row.externalRef ?? "" }));
}

/** Den publiserte systemmalen for tilstandsrapport (samme valg som `startReport`). */
async function findPublishedSystemTemplateId(db: Db, organizationId: string) {
  const [row] = await db
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .innerJoin(
      templateFamilies,
      and(
        eq(templateFamilies.id, templateVersions.familyId),
        eq(templateFamilies.organizationId, organizationId),
        eq(templateFamilies.kind, "system"),
        eq(templateFamilies.reportType, "condition_report"),
        isNull(templateFamilies.deletedAt),
      ),
    )
    .where(
      and(
        eq(templateVersions.organizationId, organizationId),
        eq(templateVersions.status, "published"),
        isNull(templateVersions.deletedAt),
      ),
    )
    .orderBy(
      sql`${templateVersions.publishedAt} desc nulls last`,
      sql`${templateVersions.versionNumber} desc`,
    )
    .limit(1);
  return row?.id ?? null;
}

/** Gjeldende rapport per oppdrag (id, status og malversjon). */
async function findCurrentReports(db: Db, organizationId: string, assignmentIds: string[]) {
  if (assignmentIds.length === 0) return new Map<string, CurrentReport>();
  const rows = await db
    .select({
      id: reports.id,
      assignmentId: reports.assignmentId,
      status: reports.status,
      templateVersionId: reports.templateVersionId,
    })
    .from(reports)
    .where(
      and(
        eq(reports.organizationId, organizationId),
        inArray(reports.assignmentId, assignmentIds),
        isNull(reports.deletedAt),
        ne(reports.status, "superseded"),
      ),
    );
  return new Map(rows.map((row) => [row.assignmentId, row]));
}
type CurrentReport = { id: string; status: string; templateVersionId: string };

/** Rommene som alt har svar eller punkt i rapporten (også myk-slettede rader). */
async function findTouchedRooms(
  db: Db,
  organizationId: string,
  reportIds: string[],
): Promise<Set<string>> {
  if (reportIds.length === 0) return new Set();
  const answered = await db
    .selectDistinct({ roomId: fieldAnswers.roomId })
    .from(fieldAnswers)
    .where(
      and(
        eq(fieldAnswers.organizationId, organizationId),
        inArray(fieldAnswers.reportId, reportIds),
      ),
    );
  const checked = await db
    .selectDistinct({ roomId: checkpointResults.roomId })
    .from(checkpointResults)
    .where(
      and(
        eq(checkpointResults.organizationId, organizationId),
        inArray(checkpointResults.reportId, reportIds),
      ),
    );
  return new Set(
    [...answered, ...checked].flatMap((row) => (row.roomId === null ? [] : [row.roomId])),
  );
}

/** Takstmannen på oppdraget (aktiv ansvarlig i teamet), som aktør. `null` når ingen er aktiv. */
async function findResponsibleActors(
  db: Db,
  organizationId: string,
  assignmentIds: string[],
): Promise<Map<string, Actor>> {
  if (assignmentIds.length === 0) return new Map();
  const rows = await db
    .select({
      assignmentId: assignmentTeamMembers.assignmentId,
      userId: users.id,
      email: users.email,
      name: users.name,
    })
    .from(assignmentTeamMembers)
    .innerJoin(
      employees,
      and(
        eq(employees.id, assignmentTeamMembers.employeeId),
        eq(employees.organizationId, organizationId),
        isNull(employees.deletedAt),
        isNull(employees.deactivatedAt),
      ),
    )
    .innerJoin(users, eq(users.id, employees.userId))
    .where(
      and(
        eq(assignmentTeamMembers.organizationId, organizationId),
        inArray(assignmentTeamMembers.assignmentId, assignmentIds),
        eq(assignmentTeamMembers.teamRole, "responsible"),
        isNull(assignmentTeamMembers.toAt),
        isNull(assignmentTeamMembers.deletedAt),
      ),
    )
    .orderBy(asc(assignmentTeamMembers.fromAt), asc(assignmentTeamMembers.id));
  const result = new Map<string, Actor>();
  for (const row of rows) {
    result.set(row.assignmentId, { id: row.userId, email: row.email, name: row.name });
  }
  return result;
}

/** Tabellene seed skriver rader i (gjennom tjenestene). */
export const TESTDATA_BATH_TABLES = [
  "reports",
  "fieldAnswers",
  "checkpointResults",
  "deviations",
  "deviationMeasures",
  "tgiuDetails",
  "ruleSuggestionDecisions",
] as const;
export type TestdataBathTable = (typeof TESTDATA_BATH_TABLES)[number];

/** Radene i rapportene for testoppdragene, per tabell (også myk-slettede). */
async function countBathRows(
  db: Db,
  organizationId: string,
): Promise<Record<TestdataBathTable, number>> {
  const testReports = db
    .select({ id: reports.id })
    .from(reports)
    .innerJoin(
      orders,
      and(
        eq(orders.assignmentId, reports.assignmentId),
        eq(orders.organizationId, organizationId),
        isTestdataOrder,
      ),
    )
    .where(eq(reports.organizationId, organizationId));
  const count = async (
    table:
      | typeof fieldAnswers
      | typeof checkpointResults
      | typeof deviations
      | typeof deviationMeasures
      | typeof tgiuDetails
      | typeof ruleSuggestionDecisions,
  ) => {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(table)
      .where(and(eq(table.organizationId, organizationId), inArray(table.reportId, testReports)));
    return row?.n ?? 0;
  };
  const [reportRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reports)
    .where(and(eq(reports.organizationId, organizationId), inArray(reports.id, testReports)));
  return {
    reports: reportRow?.n ?? 0,
    fieldAnswers: await count(fieldAnswers),
    checkpointResults: await count(checkpointResults),
    deviations: await count(deviations),
    deviationMeasures: await count(deviationMeasures),
    tgiuDetails: await count(tgiuDetails),
    ruleSuggestionDecisions: await count(ruleSuggestionDecisions),
  };
}

// ---------------------------------------------------------------------------------------------
// Skrivingen av ett bad (bare tjenestene)
// ---------------------------------------------------------------------------------------------

/** Advarslene som aldri skal stå på et ferdig punkt i testdataene (akseptkriteriene). */
const FORBIDDEN_WARNINGS = new Set([
  "tg3_on_age_only",
  "tgiu_suggested_not_set",
  "tgiu_details_missing",
  "checkpoint_done_without_tg",
  "no_findings_with_reading_over_limit",
  "suggestion_no_longer_applies",
]);

type BathWork = {
  bath: TestdataBathCandidate;
  scenario: BathScenario;
  assignmentId: string;
  roomId: string;
  actor: Actor;
  inspectionYear: number;
  document: TemplateDocument;
  steps: BathAnswerStep[];
};

function describeBath(work: Pick<BathWork, "bath" | "scenario">): string {
  return `${work.bath.roomName} i oppdrag ${work.bath.assignmentLabel} (scenario «${work.scenario.name}»)`;
}

/**
 * Kontrollerer regelmotoren mot scenarioet før noe skrives: nøyaktig forslagene i scenarioet, og
 * bare utfall som finnes i malen badet låses til. Kaster `TestdataBathError` med norsk melding.
 */
export function checkBathAgainstRules(input: {
  bath: TestdataBathCandidate;
  scenario: BathScenario;
  inspectionYear: number;
  document: TemplateDocument;
}): void {
  const { scenario, document } = input;
  const problems = bathScenarioProblems(scenario, document);
  if (problems.length > 0) {
    throw new TestdataBathError(
      `${describeBath(input)} bryter de faglige grensene: ${problems.join("; ")}. Ingen bad er fylt ut.`,
    );
  }
  const steps = bathAnswerSteps(scenario, input.bath);
  const results = evaluateBathRules(
    document,
    bathRuleAnswers(document, steps),
    input.inspectionYear,
  );
  const triggered = new Set(triggeredRuleKeys(results));
  const expected = new Set(expectedRuleKeys(scenario));
  for (const key of triggered) {
    if (!expected.has(key)) {
      throw new TestdataBathError(
        `${describeBath(input)} gir forslaget ${key}, som scenarioet ikke venter. Ingen bad er fylt ut.`,
      );
    }
  }
  for (const key of expected) {
    if (!triggered.has(key)) {
      throw new TestdataBathError(
        `${describeBath(input)} mangler forslaget ${key}, som scenarioet venter. Ingen bad er fylt ut.`,
      );
    }
  }
}

function expectSaved(
  work: BathWork,
  step: string,
  result: ActionResult | SaveFieldResult | DecideSuggestionResult,
): RoomRefresh | null {
  if (result.status === "saved") return "refresh" in result ? result.refresh : null;
  throw new TestdataBathError(
    `${describeBath(work)} stoppet ved ${step}: tjenesten svarte «${result.status}».`,
  );
}

function editedKeyOf(deviation: BathExpectedDeviation): BathEditedTextKey {
  const key = `${deviation.questionKey}|${deviation.outcomeKey}`;
  if (!(key in TESTDATA_BATH_EDITED_TEXTS.variants)) {
    throw new TestdataBathError(`Den endrede teksten for ${key} finnes ikke i datafilen.`);
  }
  return key as BathEditedTextKey;
}

function deviationIn(refresh: RoomRefresh | null, id: string) {
  for (const checkpoint of refresh?.checkpoints ?? []) {
    const found = checkpoint.deviations.find((d) => d.id === id);
    if (found) return found;
  }
  return null;
}

/** Skriver ett bad gjennom tjenestene og kontrollerer resultatet mot scenarioet. */
async function writeBath(work: BathWork, organizationId: string): Promise<void> {
  const { scenario, actor } = work;
  const room: RoomRef = { assignmentId: work.assignmentId, roomId: work.roomId };
  const orderIndex = (key: string) => WET_ROOM_CHECKPOINT_ORDER.indexOf(key as BathCheckpointKey);
  const isDone = (key: string) => orderIndex(key) >= 0 && orderIndex(key) < scenario.doneCount;
  const touched = WET_ROOM_CHECKPOINT_ORDER.filter(
    (key) => isDone(key) || work.steps.some((s) => s.checkpointKey === key),
  );
  let refresh: RoomRefresh | null = null;

  for (const checkpointKey of touched) {
    // Svarene på punktet
    for (const step of work.steps.filter((s) => s.checkpointKey === checkpointKey)) {
      const empty: AnswerValue = { text: null, number: null, optionKeys: null };
      refresh = expectSaved(
        work,
        `svaret ${step.elementKey}`,
        await saveField(actor, organizationId, room, {
          table: "field_answers",
          id: uuidv7(),
          elementKey: step.elementKey,
          field: "value",
          value: answerValueFor(work.document, step),
          base: empty,
        }),
      );
    }

    // Regelforslagene på punktet: godta, endre eller avvis (åpne forslag står)
    const deviationIds = new Map<BathExpectedDeviation, string>();
    for (const decision of scenario.decisions) {
      if (ruleCheckpointOf(work.document, decision.ruleKey) !== checkpointKey) continue;
      if (decision.decision === "open") continue;
      const expectedDeviation = scenario.expected.deviations.find(
        (d) => d.source.type === "rule" && d.source.ruleKey === decision.ruleKey,
      );
      const deviationId = expectedDeviation ? uuidv7() : undefined;
      if (expectedDeviation && deviationId) deviationIds.set(expectedDeviation, deviationId);
      const base = { id: uuidv7(), ruleKey: decision.ruleKey };
      const result =
        decision.decision === "accepted"
          ? await decideSuggestion(actor, organizationId, room, {
              ...base,
              decision: "accepted",
              ...(deviationId ? { deviationId } : {}),
              ...(decision.chosenTg !== undefined
                ? { chosenTg: decision.chosenTg === 2 ? 2 : 3 }
                : {}),
            })
          : decision.decision === "changed"
            ? await decideSuggestion(actor, organizationId, room, {
                ...base,
                decision: "changed",
                chosenTg: decision.chosenTg,
                overrideReasonCode: decision.overrideReasonCode,
              })
            : await decideSuggestion(actor, organizationId, room, {
                ...base,
                decision: "rejected",
                overrideReasonCode: decision.overrideReasonCode,
              });
      if (result.status === "no_longer_applies") {
        throw new TestdataBathError(
          `${describeBath(work)}: forslaget ${decision.ruleKey} gjelder ikke lenger på serveren.`,
        );
      }
      refresh = expectSaved(work, `forslaget ${decision.ruleKey}`, result);
    }

    // Avvik takstmannen velger fra utfallene i malen
    for (const deviation of scenario.expected.deviations) {
      if (deviation.checkpointKey !== checkpointKey || deviation.source.type !== "outcome") {
        continue;
      }
      const id = uuidv7();
      deviationIds.set(deviation, id);
      refresh = expectSaved(
        work,
        `avviket ${deviation.questionKey}`,
        await addDeviation(actor, organizationId, room, {
          id,
          checkpointKey,
          questionKey: deviation.questionKey,
          outcomeKey: deviation.outcomeKey,
          tg: deviation.outcomeKey === "choose" ? deviation.tg : null,
        }),
      );
    }

    // Endret tekst og kostnad på avvikene
    for (const [deviation, id] of deviationIds) {
      if (deviation.textSource === "edited") {
        const current = deviationIn(refresh, id);
        refresh = expectSaved(
          work,
          `teksten på ${deviation.questionKey}`,
          await saveField(actor, organizationId, room, {
            table: "deviations",
            id,
            field: "deviation_text",
            value: TESTDATA_BATH_EDITED_TEXTS.variants[editedKeyOf(deviation)],
            base: current?.deviationText ?? null,
          }),
        );
      }
      if (deviation.cost.type !== "none") {
        refresh = expectSaved(
          work,
          `kostnaden på ${deviation.questionKey}`,
          await saveField(actor, organizationId, room, {
            table: "deviations",
            id,
            field: "cost",
            value:
              deviation.cost.type === "band"
                ? { type: "band", bandKey: deviation.cost.bandKey, amount: null }
                : { type: "approx", bandKey: null, amount: deviation.cost.amount },
            base: { type: "none", bandKey: null, amount: null },
          }),
        );
      }
    }

    // TGIU-opplysningene etter grunnen (samme tekst som i svarene, T-0114)
    if (checkpointKey === "wet_room.adjacent" && scenario.tgiu !== null) {
      const t = scenario.tgiu;
      const textFields = [
        ["reason", t.reasonNote],
        ["alternative_check_method", t.alternativeMethod],
        ["alternative_check_result", t.alternativeResult],
        ["risk_assessment", t.risk],
        ["how_to_examine", t.howToExamine],
      ] as const;
      for (const [field, value] of textFields) {
        refresh = expectSaved(
          work,
          `TGIU-feltet ${field}`,
          await saveField(actor, organizationId, room, {
            table: "tgiu_details",
            checkpointKey,
            field,
            value,
            base: null,
          }),
        );
      }
      refresh = expectSaved(
        work,
        "TGIU-feltet construction_vulnerable",
        await saveField(actor, organizationId, room, {
          table: "tgiu_details",
          checkpointKey,
          field: "construction_vulnerable",
          value: t.constructionVulnerable,
          base: null,
        }),
      );
      if (t.ownerInformed) {
        refresh = expectSaved(
          work,
          "TGIU-feltet owner_informed",
          await saveField(actor, organizationId, room, {
            table: "tgiu_details",
            checkpointKey,
            field: "owner_informed",
            value: true,
            base: null,
          }),
        );
      }
    }

    if (!isDone(checkpointKey)) continue;

    // TG1 bare på ferdige punkt uten avvik med TG, uten TG direkte og uten åpent forslag (A505)
    const view = checkpointIn(refresh, checkpointKey);
    const hasTgDeviation = view?.deviations.some((d) => d.kind === "tg" && d.tg !== null) ?? false;
    const openSuggestion = scenario.decisions.some(
      (d) => d.decision === "open" && ruleCheckpointOf(work.document, d.ruleKey) === checkpointKey,
    );
    if (openSuggestion) {
      throw new TestdataBathError(
        `${describeBath(work)}: punktet ${checkpointKey} har et åpent forslag og kan ikke stå ferdig.`,
      );
    }
    if (!hasTgDeviation && (view?.tgDirect ?? null) === null) {
      refresh = expectSaved(
        work,
        `TG1 på ${checkpointKey}`,
        await setTgDirect(actor, organizationId, room, {
          checkpointKey,
          tgDirect: "1",
          base: null,
        }),
      );
    }
    refresh = expectSaved(
      work,
      `ferdig på ${checkpointKey}`,
      await setCheckpointDone(actor, organizationId, room, { checkpointKey, done: true }),
    );
  }

  verifyBath(work, refresh);
}

function checkpointIn(refresh: RoomRefresh | null, key: string): CheckpointView | null {
  return refresh?.checkpoints.find((c) => c.checkpointKey === key) ?? null;
}

/** Kontrollerer badet etter skrivingen: avvik, TG, ferdige punkt og advarsler. */
function verifyBath(work: BathWork, refresh: RoomRefresh | null): void {
  const fail = (what: string) => {
    throw new TestdataBathError(`${describeBath(work)} stemmer ikke med scenarioet: ${what}.`);
  };
  if (refresh === null) fail("ingenting ble lagret");
  const checkpoints = refresh?.checkpoints ?? [];
  const live = checkpoints.flatMap((c) =>
    c.deviations.map((d) => ({ checkpointKey: c.checkpointKey, ...d })),
  );
  const signature = (d: {
    checkpointKey: string;
    questionKey: string | null;
    outcomeKey: string | null;
    tg: number | null;
    textSource: string;
    costType: string;
    costBandKey: string | null;
  }) =>
    [
      d.checkpointKey,
      d.questionKey,
      d.outcomeKey,
      d.tg ?? "-",
      d.textSource,
      d.costType,
      d.costBandKey ?? "-",
    ].join("|");
  const actual = live
    .map((d) => signature({ ...d, costType: d.cost.type, costBandKey: d.cost.bandKey }))
    .sort();
  const expected = work.scenario.expected.deviations
    .map((d) =>
      signature({
        ...d,
        costType: d.cost.type,
        costBandKey: d.cost.type === "band" ? d.cost.bandKey : null,
      }),
    )
    .sort();
  if (actual.join(";") !== expected.join(";")) fail("avvikene er ikke de forventede");

  for (const checkpoint of checkpoints) {
    const index = WET_ROOM_CHECKPOINT_ORDER.indexOf(checkpoint.checkpointKey as BathCheckpointKey);
    const shouldBeDone = index >= 0 && index < work.scenario.doneCount;
    if (checkpoint.done !== shouldBeDone)
      fail(`punktet ${checkpoint.checkpointKey} har feil status`);
    if (checkpoint.done && checkpoint.tg === null)
      fail(`punktet ${checkpoint.checkpointKey} mangler TG`);
    if (checkpoint.tgDirect === "0" && checkpoint.checkpointKey !== "wet_room.adjacent") {
      fail(`TG0 utenfor tilliggende`);
    }
    for (const warning of checkpoint.warnings) {
      const counts = checkpoint.done || warning.code === "tgiu_details_missing";
      if (counts && FORBIDDEN_WARNINGS.has(warning.code)) {
        fail(`advarselen ${warning.code} på ${checkpoint.checkpointKey}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Inngangen
// ---------------------------------------------------------------------------------------------

export type TestdataBathScenarioLine = {
  scenarioKey: string;
  scenarioName: string;
  assignmentNumber: string;
  roomName: string;
};

export type TestdataBathSummary = {
  created: Record<TestdataBathTable, number>;
  existing: Record<TestdataBathTable, number>;
  bathsFilled: number;
  /** Bad som alt hadde svar i rapporten (bare Byggcon). Ingenting er endret i dem. */
  bathsSkipped: number;
  /** Bad der takstmannen på oppdraget ikke kan endre rapporter (A515). */
  bathsWithoutAccess: number;
  /** `false` når Byggcon ikke har en publisert systemmal for tilstandsrapport (A516). */
  templatePublished: boolean;
  /** Én linje per pliktig scenario, i kortets rekkefølge (forbedrer runde 2, tillegg 1). */
  scenarioMap: TestdataBathScenarioLine[];
};

function zeroCounts(): Record<TestdataBathTable, number> {
  return Object.fromEntries(TESTDATA_BATH_TABLES.map((table) => [table, 0])) as Record<
    TestdataBathTable,
    number
  >;
}

/** Nøkkelen rommet har i planen: bygning, etasje og romnavn. */
function roomPlanKey(externalRef: string, building: string, floor: string, room: string | null) {
  return [externalRef, building, floor, room ?? ""].join("|");
}

/** Badets år og rekkefølge fra planen, per rom. */
function planRoomIndex(plan: TestdataPlan) {
  const index = new Map<
    string,
    { roomOrder: number; bathYear: number; bathYearSource: "owner_stated" | "documented" }
  >();
  for (const order of plan.orders) {
    if (!order.converted) continue;
    const assignment = order.converted.assignment;
    let roomOrder = 0;
    for (const building of assignment.buildings) {
      for (const floor of building.floors) {
        for (const room of floor.rooms) {
          roomOrder += 1;
          index.set(roomPlanKey(order.externalRef, building.name, floor.name, room.name), {
            roomOrder,
            bathYear: room.yearRenovated ?? assignment.property.buildYear,
            bathYearSource: room.yearRenovated !== null ? "owner_stated" : "documented",
          });
        }
      }
    }
  }
  return index;
}

/**
 * Fyller ut badene i testoppdragene i Byggcon (del 2). Kalles fra `seedTestdata` etter del 1.
 * Kaster `TestdataNotAllowedError` (vakten) eller `TestdataBathError` (norsk melding).
 */
export async function seedTestdataBaths({
  db,
  now,
  seed,
}: {
  db: Db;
  now: Date;
  seed: number;
}): Promise<TestdataBathSummary> {
  assertTestdataAllowed();

  const summary: TestdataBathSummary = {
    created: zeroCounts(),
    existing: zeroCounts(),
    bathsFilled: 0,
    bathsSkipped: 0,
    bathsWithoutAccess: 0,
    templatePublished: false,
    scenarioMap: [],
  };
  const organization = await findTestdataOrganization(db);
  if (!organization) return summary;
  const organizationId = organization.id;

  const publishedId = await findPublishedSystemTemplateId(db, organizationId);
  if (publishedId === null) return summary;
  summary.templatePublished = true;

  // Badene i databasen, koblet til planen fra del 1 (byggeåret står bare i planen, A502)
  const plan = await resolveTestdataPlan(db, organizationId, seed, now);
  const planIndex = planRoomIndex(plan);
  const dbBaths = await findDbBaths(db, organizationId);
  const byCandidate = new Map<TestdataBathCandidate, DbBath>();
  const candidates: TestdataBathCandidate[] = [];
  for (const row of dbBaths) {
    const planned = planIndex.get(
      roomPlanKey(row.externalRef, row.buildingName, row.floorName, row.roomName),
    );
    if (!planned) continue;
    const candidate: TestdataBathCandidate = {
      assignmentKey: row.assignmentNumber,
      assignmentLabel: row.assignmentNumber,
      status: row.assignmentStatus,
      inspectionYear: row.inspectionAt === null ? null : inspectionYearOf(row.inspectionAt).year,
      roomOrder: planned.roomOrder,
      roomName: row.roomName ?? "",
      bathYear: planned.bathYear,
      bathYearSource: planned.bathYearSource,
    };
    candidates.push(candidate);
    byCandidate.set(candidate, row);
  }

  const assignmentsOfBaths = assignBathScenarios({ baths: candidates, seed });
  for (const key of MANDATORY_BATH_SCENARIO_KEYS) {
    const found = assignmentsOfBaths.find((a) => a.scenarioKey === key);
    if (found) {
      summary.scenarioMap.push({
        scenarioKey: key,
        scenarioName: bathScenarioByKey(key).name,
        assignmentNumber: found.bath.assignmentLabel,
        roomName: found.bath.roomName,
      });
    }
  }

  const assignmentIds = [
    ...new Set(assignmentsOfBaths.map((a) => byCandidate.get(a.bath)!.assignmentId)),
  ];
  const currentReports = await findCurrentReports(db, organizationId, assignmentIds);
  const touchedRooms = await findTouchedRooms(
    db,
    organizationId,
    [...currentReports.values()].map((r) => r.id),
  );
  const actors = await findResponsibleActors(db, organizationId, assignmentIds);

  // Malen badene låses til: rapportens versjon, ellers den publiserte (som `startReport`)
  const documents = new Map<string, TemplateDocument>();
  const documentFor = async (versionId: string, actor: Actor) => {
    const cached = documents.get(versionId);
    if (cached) return cached;
    const detail = await getTemplateVersion(actor, organizationId, versionId);
    documents.set(versionId, detail.document);
    return detail.document;
  };

  // Planlegg og kontroller alle badene før noe skrives
  const work: BathWork[] = [];
  for (const assignment of assignmentsOfBaths) {
    const row = byCandidate.get(assignment.bath)!;
    const report = currentReports.get(row.assignmentId);
    if (touchedRooms.has(row.roomId) || (report && report.status !== "draft")) {
      summary.bathsSkipped += 1;
      continue;
    }
    const actor = actors.get(row.assignmentId);
    if (!actor || !(await canEditReports(actor, organizationId))) {
      summary.bathsWithoutAccess += 1;
      continue;
    }
    const scenario = bathScenarioByKey(assignment.scenarioKey);
    const document = await documentFor(report?.templateVersionId ?? publishedId, actor);
    const item: BathWork = {
      bath: assignment.bath,
      scenario,
      assignmentId: row.assignmentId,
      roomId: row.roomId,
      actor,
      inspectionYear: assignment.bath.inspectionYear as number,
      document,
      steps: bathAnswerSteps(scenario, assignment.bath),
    };
    checkBathAgainstRules(item);
    work.push(item);
  }

  const before = await countBathRows(db, organizationId);
  // Badene i samme oppdrag deler rapporten og skrives etter hverandre. Ulike oppdrag skrives
  // samtidig (høyst `BATH_WRITERS`), siden hver tjeneste låser sin egen rapport.
  const byAssignment = new Map<string, BathWork[]>();
  for (const item of work) {
    byAssignment.set(item.assignmentId, [...(byAssignment.get(item.assignmentId) ?? []), item]);
  }
  await runLimited([...byAssignment.values()], BATH_WRITERS, async (items) => {
    const first = items[0] as BathWork;
    await startReport(first.actor, organizationId, first.assignmentId);
    for (const item of items) {
      await writeBath(item, organizationId);
      summary.bathsFilled += 1;
    }
  });
  const after = await countBathRows(db, organizationId);
  for (const table of TESTDATA_BATH_TABLES) {
    summary.existing[table] = before[table];
    summary.created[table] = after[table] - before[table];
  }
  return summary;
}

/** Hvor mange oppdrag som skrives samtidig. Databasen har ti forbindelser (`src/db/client.ts`). */
const BATH_WRITERS = 4;

/**
 * Kjører `task` for hvert element med høyst `limit` samtidig. Etter første feil startes ingen nye,
 * de som er i gang, får gjøre seg ferdige, og den første feilen kastes.
 */
async function runLimited<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  let failure: { error: unknown } | null = null;
  const worker = async () => {
    while (failure === null && next < items.length) {
      const item = items[next] as T;
      next += 1;
      try {
        await task(item);
      } catch (error) {
        failure ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failure !== null) throw (failure as { error: unknown }).error;
}

/** Om aktøren kan endre rapporter. Tilgangen sjekkes bare i `@/core/access`. */
async function canEditReports(actor: Actor, organizationId: string): Promise<boolean> {
  try {
    await requireOrganizationAccess(actor, organizationId, "report.edit");
    return true;
  } catch (error) {
    if (error instanceof AccessDeniedError) return false;
    throw error;
  }
}
