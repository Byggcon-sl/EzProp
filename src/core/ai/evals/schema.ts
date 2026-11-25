import { z } from "zod";
import { getFeatureDefinition } from "../features";
import { OUTCOME_MATCH_MAX, OUTCOME_MATCH_NOTE_MAX } from "@/shared/config/ai-targets";
import {
  AI_CANDIDATE_TEXT_MAX_LENGTH,
  AI_CANDIDATES_MAX,
  OUTCOME_MATCH_CANDIDATES_MAX,
} from "../limits";
import { emptyKnownValues, type KnownValues } from "../redact-text";
import type { AiCandidateSource, AiGuardCode } from "../types";

/*
 * Formatet for evalueringssettet (docs/funksjoner/fase2a-evalueringssett.md, Omfang 1, ADR 0006
 * del 9; utvidet i docs/funksjoner/fase2a-ki-i-veien.md, «Falsk leverandør og evalueringssett»).
 * Én fil per KI-funksjon: `<funksjon>.cases.json` i denne mappen. Hver funksjon har sin egen
 * sakstype:
 *
 * - `language_polish`: felt inn, fasit med ord som skal stå eller ikke stå.
 * - `phrase_suggest`: felttekst og faste koder inn, en liste kandidater (id og egen tekst), fasit
 *   er settet av riktige id-er eller `no_match`. Bestått = minst én riktig blant de 3 beste.
 * - `summary_draft`: funnene i gruppene TG3, TG2, TGIU og HMS inn, fasit er `ok` eller stoppet
 *   av en bestemt vakt.
 * - `outcome_match`: notatet og utfallene for romtypen inn, fasit er hvilke utfall som skal vises
 *   blant de 3 første, eller «ingen passer» (se avsnittet om `outcome_match` under).
 *
 * `simulatedAnswer` er et oppdiktet KI-svar som brukes i stedet for leverandørens. Det prøver at
 * vaktene og vurderingen fanger et svar som er feil (byttet TG, flyttet tall, gjetteord). Med
 * `verdict: "fail"` er saken bestått når vurderingen sier at svaret ikke holder.
 *
 * Hovedmål: KI i bunnen. Hver KI-funksjon får faste eksempler med fasit som må bestås før ekte bruk.
 * Færre reklamasjoner: settene måler at ingen funn mangler, og at KI ikke legger til TG eller tall.
 *
 * Eksemplene er oppdiktet prøvedata for KI. De brukes aldri som avvikstekst, seed-data eller mal.
 * Feilmeldingene bygges av sti og feilkode, aldri av verdiene i filen, så en kjent verdi (navn,
 * telefon o.l.) aldri gjentas i utskriften.
 */

export const EVAL_CASES_STATUS = "utkast, ikke godkjent av fagrådet";
export const EVAL_CASES_MIN = 30;
export const EVAL_CASES_MAX = 50;
export const EVAL_CASES_FILE_SUFFIX = ".cases.json";

/** Hvor mange av de beste kandidatene som teller for `phrase_suggest`. */
export const PHRASE_TOP_N = 3;

/*
 * De faste kodene settene bruker. Kjøreren og skjemaet importerer ikke databaseskjemaet (S4), så
 * listene står her og holdes like med `AI_CANDIDATE_SOURCES`, `AI_GUARD_CODES` og
 * `SUMMARY_GROUPS` i `@/db/schema` av `schema.test.ts`. Typene sikrer at ingen ukjent kode kommer
 * inn.
 */
export const EVAL_CANDIDATE_SOURCES = [
  "template_outcome",
  "template_measure",
  "phrase",
] as const satisfies readonly AiCandidateSource[];
export const EVAL_GUARD_CODES = [
  "tg_guard",
  "coverage_guard",
  "number_guard",
  "placeholder_guard",
] as const satisfies readonly AiGuardCode[];
/** Rekkefølgen i sammendraget: TG3, TG2, TGIU, HMS. */
export const EVAL_SUMMARY_GROUPS = ["tg3", "tg2", "tgiu", "hms"] as const;

const stringList = z.array(z.string());
const nullableString = z.string().nullable().default(null);
const caseId = z.string().min(1);
const nonEmpty = z.string().trim().min(1);

/** Kjente verdier i samme form som `KnownValues`, alle felt valgfrie. */
const knownSchema = z.strictObject({
  personNames: stringList.optional(),
  phrases: stringList.optional(),
  emails: stringList.optional(),
  phones: stringList.optional(),
  orgNumbers: stringList.optional(),
  addresses: z
    .strictObject({
      full: stringList.optional(),
      places: stringList.optional(),
      postalCodes: stringList.optional(),
    })
    .optional(),
  cadastral: z
    .strictObject({
      units: z
        .array(
          z.strictObject({
            gnr: nullableString,
            bnr: nullableString,
            fnr: nullableString,
            snr: nullableString,
            shareNumber: nullableString,
          }),
        )
        .optional(),
      municipalityNumbers: stringList.optional(),
    })
    .optional(),
});

export type EvalKnownValues = z.infer<typeof knownSchema>;

/** Om et oppdiktet svar skal holde (`pass`) eller skal fanges av vurderingen (`fail`). */
const verdictSchema = z.enum(["pass", "fail"]);
export type EvalVerdict = z.infer<typeof verdictSchema>;

// --- language_polish ---------------------------------------------------------------------------

const expectSchema = z.strictObject({
  /** `stopped`: en vakt skal stoppe svaret, som i kjernen. `guard` sier hvilken. */
  outcome: z.enum(["ok", "no_match", "stopped"]),
  guard: z.enum(EVAL_GUARD_CODES).optional(),
  mustContain: z.array(z.string().min(1)).optional(),
  mustNotContain: z.array(z.string().min(1)).optional(),
  sameTg: z.boolean().optional(),
  verdict: verdictSchema.optional(),
});

export type EvalExpectation = z.infer<typeof expectSchema>;

const caseSchema = z.strictObject({
  id: caseId,
  description: z.string().optional(),
  fields: z.record(z.string(), z.string()),
  known: knownSchema.optional(),
  mustPass: z.boolean().default(false),
  simulatedAnswer: nonEmpty.optional(),
  expect: expectSchema,
});

/** Sak for `language_polish` (og andre funksjoner som bare tar felt). */
export type EvalCase = z.infer<typeof caseSchema>;

// --- phrase_suggest ----------------------------------------------------------------------------

/** Om avviket og kandidaten gjelder TG eller HMS. De blandes aldri (A463). */
export const PHRASE_DEVIATION_KINDS = ["tg", "hms"] as const;
export type PhraseDeviationKind = (typeof PHRASE_DEVIATION_KINDS)[number];

/**
 * Feltet saken gjelder. Kjernen sender ikke feltet til KI (det står i målet, `target.fieldKey`),
 * derfor står det utenfor `fields`. Brukes bare til å sjekke at alle felttypene er med.
 */
export const PHRASE_EVAL_FIELDS = [
  "deviation_text",
  "cause_text",
  "consequence_text",
  "measure_text",
] as const;

const candidateSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/u),
  source: z.enum(EVAL_CANDIDATE_SOURCES),
  kind: z.enum(PHRASE_DEVIATION_KINDS),
  text: nonEmpty,
});

export type EvalCandidate = z.infer<typeof candidateSchema>;

const phraseExpectSchema = z.discriminatedUnion("outcome", [
  z.strictObject({ outcome: z.literal("ok"), correct: z.array(z.string().min(1)).min(1) }),
  z.strictObject({ outcome: z.literal("no_match") }),
]);

const phraseCaseSchema = z.strictObject({
  id: caseId,
  description: z.string().optional(),
  deviationKind: z.enum(PHRASE_DEVIATION_KINDS),
  field: z.enum(PHRASE_EVAL_FIELDS),
  fields: z.record(z.string(), z.string()),
  candidates: z.array(candidateSchema).min(1).max(AI_CANDIDATES_MAX),
  mustPass: z.boolean().default(false),
  expect: phraseExpectSchema,
});

export type PhraseEvalCase = z.infer<typeof phraseCaseSchema>;

// --- summary_draft -----------------------------------------------------------------------------

const findingSchema = z.strictObject({
  checkpointName: nonEmpty,
  deviationText: nonEmpty.nullable(),
  causeText: nonEmpty.nullable(),
  consequenceText: nonEmpty.nullable(),
  measures: z.array(nonEmpty),
});

const fixedLineSchema = z.strictObject({ checkpointName: nonEmpty, text: nonEmpty });

const writtenGroupSchema = z.strictObject({
  group: z.enum(["tg3", "tg2", "hms"]),
  findings: z.array(findingSchema).min(1),
});
const tgiuGroupSchema = z.strictObject({
  group: z.literal("tgiu"),
  fixedLines: z.array(fixedLineSchema).min(1),
});

const summaryGroupSchema = z.discriminatedUnion("group", [writtenGroupSchema, tgiuGroupSchema]);
export type EvalSummaryGroup = z.infer<typeof summaryGroupSchema>;

/** F-merket i svaret. Ukjente merker (F9 når det finnes tre) er lov, for dekningsvakten. */
export const SUMMARY_LABEL = /^F[1-9]\d*$/u;

const summaryExpectSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("ok"),
    mustContain: z.array(z.string().min(1)).optional(),
    mustNotContain: z.array(z.string().min(1)).optional(),
    verdict: verdictSchema.optional(),
  }),
  z.strictObject({ outcome: z.literal("stopped"), guard: z.enum(EVAL_GUARD_CODES) }),
]);

const summaryCaseSchema = z.strictObject({
  id: caseId,
  description: z.string().optional(),
  groups: z.array(summaryGroupSchema).min(1),
  mustPass: z.boolean().default(false),
  /** Oppdiktet KI-svar: tekst per F-merke, i den rekkefølgen KI ga dem. */
  simulatedAnswer: z
    .array(z.strictObject({ label: z.string().regex(SUMMARY_LABEL), text: z.string() }))
    .optional(),
  expect: summaryExpectSchema,
});

export type SummaryEvalCase = z.infer<typeof summaryCaseSchema>;

// --- outcome_match («Skriv det du ser») --------------------------------------------------------

/*
 * Sakene for `outcome_match` (docs/funksjoner/fase2a-skriv-det-du-ser.md, «KI i bunnen» om
 * evalueringssettet, testplanen avsnitt 2). Notatet er takstmannens egne ord; kandidatene er
 * utfallene for rommets romtype i malen, med den ferdige kandidatteksten KI får (punktnavn,
 * spørsmål og avvikstekst med flettefeltene uutfylt, slik `outcomeMatchCandidateText` lager den).
 *
 * `checkpointKey` er punktets faste kode (`wet_room.floor`), og `outcomeKey` er utfallet slik
 * fagfolk navngir det, uten punktets prefiks (`cracked_tiles_or_joints`, spørsmålet
 * `wet_room.floor.cracked_tiles_or_joints` i malen). Kandidat-id-en er punkt og utfall uten
 * romtypen (`floor.cracked_tiles_or_joints`), så fasiten kan leses.
 *
 * Fasiten (`expect`) gjelder de høyst `OUTCOME_MATCH_MAX` (3) treffene som vises:
 * - `any`: minst én av `ids` er blant treffene;
 * - `all`: alle `ids` er blant treffene (alvorspar, aldersparet, samme utfall på to punkter);
 * - `first`: det første treffet er en av `ids` (sted i notatet, motsaker);
 * - `none`: ingen treff («ingen passer»). `ids` er da tom.
 * Hver sak bestås for seg; sakene for hulltaking og slitasje kan ikke gå tapt i en samlet prosent.
 */

/** Hva saken prøver. Kravene fra fagansvarlig står i kortet. */
export const OUTCOME_MATCH_CASE_CATEGORIES = [
  "match",
  "no_match_hole_drilling",
  "no_match_wear",
  "counter_case",
  "severity_pair",
  "age_pair",
  "two_checkpoints",
  "tg_mention",
] as const;
export type OutcomeMatchCaseCategory = (typeof OUTCOME_MATCH_CASE_CATEGORIES)[number];

export const OUTCOME_MATCH_REQUIREMENTS = ["any", "all", "first", "none"] as const;
export type OutcomeMatchRequirement = (typeof OUTCOME_MATCH_REQUIREMENTS)[number];

/** Kategoriene der fasit alltid er «ingen passer». */
const NO_MATCH_CATEGORIES: ReadonlySet<OutcomeMatchCaseCategory> = new Set([
  "no_match_hole_drilling",
  "no_match_wear",
]);
/** Kategoriene der hver sak må bestås for seg (`mustPass`), aldri bare i en samlet prosent. */
const MUST_PASS_CATEGORIES: ReadonlySet<OutcomeMatchCaseCategory> = new Set([
  "no_match_hole_drilling",
  "no_match_wear",
  "counter_case",
]);
/** Kategoriene der fasit er to utfall som begge skal vises. */
const PAIR_CATEGORIES: ReadonlySet<OutcomeMatchCaseCategory> = new Set([
  "severity_pair",
  "age_pair",
]);
/** En omtale av TG i notatet («TG3», «TG 2», «TGIU»). */
const TG_MENTION = /\btg\s*-?\s*(?:[0-3]|iu)\b/iu;

const outcomeMatchCandidateSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/u),
  source: z.literal("template_outcome"),
  checkpointKey: z.string().regex(/^[a-z0-9][a-z0-9._]*$/u),
  outcomeKey: z.string().regex(/^[a-z0-9][a-z0-9_]*$/u),
  text: nonEmpty.max(AI_CANDIDATE_TEXT_MAX_LENGTH),
});

export type OutcomeMatchEvalCandidate = z.infer<typeof outcomeMatchCandidateSchema>;

const outcomeMatchCaseSchema = z.strictObject({
  id: z.string().regex(/^om-\d{3}$/u),
  description: nonEmpty,
  category: z.enum(OUTCOME_MATCH_CASE_CATEGORIES),
  /** Notatet slik takstmannen skriver det. */
  note: nonEmpty.max(OUTCOME_MATCH_NOTE_MAX),
  candidates: z.array(outcomeMatchCandidateSchema).min(1).max(OUTCOME_MATCH_CANDIDATES_MAX),
  /**
   * Saken må bestås for seg, uansett samlet treffprosent. Sant for hulltaking, slitasje og
   * motsakene (fagansvarlig 24.11.2026); kontrolleres av `checkOutcomeMatchCase`.
   */
  mustPass: z.boolean().default(false),
  expect: z.strictObject({
    require: z.enum(OUTCOME_MATCH_REQUIREMENTS),
    ids: z.array(z.string().min(1)).max(OUTCOME_MATCH_MAX),
  }),
});

export type OutcomeMatchEvalCase = z.infer<typeof outcomeMatchCaseSchema>;

// --- Filen -------------------------------------------------------------------------------------

function fileSchema<T extends z.ZodType>(cases: T) {
  return z.strictObject({
    feature: z.string().min(1),
    status: z.literal(EVAL_CASES_STATUS),
    note: z.string().trim().min(1),
    cases: z.array(cases).min(EVAL_CASES_MIN).max(EVAL_CASES_MAX),
  });
}

const FILE_SCHEMAS = {
  language_polish: fileSchema(caseSchema),
  phrase_suggest: fileSchema(phraseCaseSchema),
  summary_draft: fileSchema(summaryCaseSchema),
  outcome_match: fileSchema(outcomeMatchCaseSchema),
} as const;

type EvalFeatureKind = keyof typeof FILE_SCHEMAS;
type FileHeader = { status: typeof EVAL_CASES_STATUS; note: string };

export type EvalCasesFile =
  | (FileHeader & { feature: "language_polish"; cases: EvalCase[] })
  | (FileHeader & { feature: "phrase_suggest"; cases: PhraseEvalCase[] })
  | (FileHeader & { feature: "summary_draft"; cases: SummaryEvalCase[] })
  | (FileHeader & { feature: "outcome_match"; cases: OutcomeMatchEvalCase[] });

export type ParseCasesResult = { ok: true; file: EvalCasesFile } | { ok: false; errors: string[] };

function formatPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "filen";
  let out = "";
  for (const segment of path) {
    if (typeof segment === "number") out += `[${segment}]`;
    else out += out === "" ? String(segment) : `.${String(segment)}`;
  }
  return out;
}

/** Kort norsk forklaring av en feil i skjemaet. Bruker bare feilkode og grenser, aldri verdien. */
function describeIssue(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case "invalid_type":
      return `feil type, ventet ${issue.expected}`;
    case "unrecognized_keys":
      return `ukjent nøkkel: ${issue.keys.join(", ")}`;
    case "too_small":
      return issue.origin === "array"
        ? `for få elementer, minst ${String(issue.minimum)}`
        : `for kort eller tom, minst ${String(issue.minimum)}`;
    case "too_big":
      return issue.origin === "array"
        ? `for mange elementer, høyst ${String(issue.maximum)}`
        : `for lang, høyst ${String(issue.maximum)}`;
    case "invalid_value":
      return "ugyldig verdi";
    case "invalid_format":
      return "ugyldig form";
    case "invalid_union":
      return "ugyldig innhold for utfallet eller gruppen";
    default:
      return "ugyldig innhold";
  }
}

function isFeatureKind(feature: unknown): feature is EvalFeatureKind {
  return typeof feature === "string" && Object.prototype.hasOwnProperty.call(FILE_SCHEMAS, feature);
}

function issuesToErrors(error: z.ZodError, fileName: string): string[] {
  return error.issues.map(
    (issue) => `${fileName}: ${formatPath(issue.path)}: ${describeIssue(issue)}.`,
  );
}

/**
 * Leser og validerer innholdet i én eksempelfil. `fileName` brukes bare i meldingene. Meldingene er
 * på norsk og gjentar aldri verdier fra filen (bare sti, feilkode, eksempel-id, feltkode og
 * kandidat-id).
 */
export function parseCasesFile(json: unknown, fileName: string): ParseCasesResult {
  const feature =
    typeof json === "object" && json !== null && "feature" in json
      ? (json as { feature: unknown }).feature
      : undefined;
  const kind: EvalFeatureKind = isFeatureKind(feature) ? feature : "language_polish";
  const parsed = FILE_SCHEMAS[kind].safeParse(json, { reportInput: false });
  if (!parsed.success) return { ok: false, errors: issuesToErrors(parsed.error, fileName) };

  const errors: string[] = [];
  // Settet for en funksjon kan finnes før funksjonen er registrert i kjernen (`outcome_match` har
  // ingen felt å sjekke). Ukjent er bare en `feature` uten eget skjema.
  if (!isFeatureKind(feature)) errors.push(`${fileName}: feature: ukjent KI-funksjon.`);
  const definition = getFeatureDefinition(parsed.data.feature);

  const seen = new Set<string>();
  parsed.data.cases.forEach((evalCase, index) => {
    const where = `${fileName}: cases[${index}]`;
    if (seen.has(evalCase.id)) {
      errors.push(`${where}: id-en ${evalCase.id} er brukt før. Hver id skal være unik.`);
    }
    seen.add(evalCase.id);
    if (definition !== null && "fields" in evalCase) {
      for (const key of Object.keys(evalCase.fields)) {
        if (!definition.allowedFields.includes(key)) {
          errors.push(`${where}.fields: feltet ${key} står ikke på tillatt-listen for funksjonen.`);
        }
      }
    }
  });

  if (errors.length > 0) return { ok: false, errors };
  // Typen følger skjemaet som ble valgt av `feature`
  const file = parsed.data as EvalCasesFile;
  switch (file.feature) {
    case "language_polish":
      file.cases.forEach((c, i) => errors.push(...checkPolishCase(c, `${fileName}: cases[${i}]`)));
      break;
    case "phrase_suggest":
      file.cases.forEach((c, i) => errors.push(...checkPhraseCase(c, `${fileName}: cases[${i}]`)));
      break;
    case "summary_draft":
      file.cases.forEach((c, i) => errors.push(...checkSummaryCase(c, `${fileName}: cases[${i}]`)));
      break;
    case "outcome_match":
      file.cases.forEach((c, i) =>
        errors.push(...checkOutcomeMatchCase(c, `${fileName}: cases[${i}]`)),
      );
      break;
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, file };
}

function checkPolishCase(evalCase: EvalCase, where: string): string[] {
  const errors: string[] = [];
  if (evalCase.expect.outcome === "no_match" && evalCase.expect.mustContain !== undefined) {
    errors.push(`${where}.expect: mustContain kan ikke brukes med utfallet no_match.`);
  }
  if (evalCase.expect.verdict === "fail" && evalCase.simulatedAnswer === undefined) {
    errors.push(`${where}.expect: verdict fail krever simulatedAnswer.`);
  }
  if (evalCase.simulatedAnswer !== undefined && evalCase.expect.outcome !== "ok") {
    errors.push(`${where}.simulatedAnswer: kan bare brukes med utfallet ok.`);
  }
  return errors;
}

function checkPhraseCase(evalCase: PhraseEvalCase, where: string): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  evalCase.candidates.forEach((candidate, index) => {
    if (ids.has(candidate.id)) {
      errors.push(`${where}.candidates[${index}]: kandidat-id-en ${candidate.id} er brukt før.`);
    }
    ids.add(candidate.id);
    if (candidate.kind !== evalCase.deviationKind) {
      errors.push(
        `${where}.candidates[${index}]: ${candidate.kind}-kandidat for et ${evalCase.deviationKind}-avvik. HMS og TG blandes aldri.`,
      );
    }
  });
  if (evalCase.expect.outcome === "ok") {
    const correct = evalCase.expect.correct;
    if (new Set(correct).size !== correct.length) {
      errors.push(`${where}.expect.correct: samme kandidat-id står to ganger.`);
    }
    for (const id of correct) {
      if (!ids.has(id)) errors.push(`${where}.expect.correct: ukjent kandidat-id ${id}.`);
    }
  }
  return errors;
}

function checkSummaryCase(evalCase: SummaryEvalCase, where: string): string[] {
  const errors: string[] = [];
  const order = evalCase.groups.map((group) => EVAL_SUMMARY_GROUPS.indexOf(group.group));
  if (order.some((value, index) => index > 0 && value <= order[index - 1]!)) {
    errors.push(`${where}.groups: gruppene står ikke i rekkefølgen TG3, TG2, TGIU, HMS.`);
  }
  if (!evalCase.groups.some((group) => group.group !== "tgiu")) {
    errors.push(`${where}.groups: minst ett funn må gå til KI (TG3, TG2 eller HMS).`);
  }
  const expect = evalCase.expect;
  if (expect.outcome === "stopped" && evalCase.simulatedAnswer === undefined) {
    errors.push(`${where}.expect: utfallet stopped krever simulatedAnswer.`);
  }
  if (
    expect.outcome === "ok" &&
    expect.verdict === "fail" &&
    evalCase.simulatedAnswer === undefined
  ) {
    errors.push(`${where}.expect: verdict fail krever simulatedAnswer.`);
  }
  return errors;
}

function checkOutcomeMatchCase(evalCase: OutcomeMatchEvalCase, where: string): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const outcomes = new Set<string>();
  evalCase.candidates.forEach((candidate, index) => {
    if (ids.has(candidate.id)) {
      errors.push(`${where}.candidates[${index}]: kandidat-id-en ${candidate.id} er brukt før.`);
    }
    ids.add(candidate.id);
    const outcome = `${candidate.checkpointKey}|${candidate.outcomeKey}`;
    if (outcomes.has(outcome)) {
      errors.push(`${where}.candidates[${index}]: samme utfall står to ganger.`);
    }
    outcomes.add(outcome);
  });
  const { require, ids: expected } = evalCase.expect;
  if (new Set(expected).size !== expected.length) {
    errors.push(`${where}.expect.ids: samme kandidat-id står to ganger.`);
  }
  for (const id of expected) {
    if (!ids.has(id)) errors.push(`${where}.expect.ids: ukjent kandidat-id ${id}.`);
  }
  if (require === "none" && expected.length > 0) {
    errors.push(`${where}.expect: fasit none kan ikke ha kandidat-id-er.`);
  }
  if (require !== "none" && expected.length === 0) {
    errors.push(`${where}.expect: fasit ${require} krever minst én kandidat-id.`);
  }
  if (NO_MATCH_CATEGORIES.has(evalCase.category) && require !== "none") {
    errors.push(`${where}.expect: kategorien ${evalCase.category} krever fasit none.`);
  }
  if (evalCase.category === "counter_case" && require === "none") {
    errors.push(`${where}.expect: en motsak skal treffe, ikke ha fasit none.`);
  }
  if (MUST_PASS_CATEGORIES.has(evalCase.category) && !evalCase.mustPass) {
    errors.push(`${where}.mustPass: kategorien ${evalCase.category} må bestås for seg.`);
  }
  if (PAIR_CATEGORIES.has(evalCase.category) && (require !== "all" || expected.length !== 2)) {
    errors.push(`${where}.expect: kategorien ${evalCase.category} krever fasit all med to utfall.`);
  }
  if (evalCase.category === "tg_mention" && !TG_MENTION.test(evalCase.note)) {
    errors.push(`${where}.note: kategorien tg_mention krever at notatet nevner TG.`);
  }
  return errors;
}

/** Fyller ut kjente verdier fra et eksempel til full `KnownValues`. */
export function toKnownValues(known: EvalKnownValues): KnownValues {
  const full = emptyKnownValues();
  return {
    personNames: known.personNames ?? full.personNames,
    phrases: known.phrases ?? full.phrases,
    emails: known.emails ?? full.emails,
    phones: known.phones ?? full.phones,
    orgNumbers: known.orgNumbers ?? full.orgNumbers,
    addresses: {
      full: known.addresses?.full ?? full.addresses.full,
      places: known.addresses?.places ?? full.addresses.places,
      postalCodes: known.addresses?.postalCodes ?? full.addresses.postalCodes,
    },
    cadastral: {
      units: known.cadastral?.units ?? full.cadastral.units,
      municipalityNumbers:
        known.cadastral?.municipalityNumbers ?? full.cadastral.municipalityNumbers,
    },
  };
}
