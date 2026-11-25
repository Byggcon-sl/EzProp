import { z } from "zod";
import { getFeatureDefinition } from "../features";
import { AI_CANDIDATES_MAX } from "../limits";
import { parseOverrideStats } from "../override-stats";
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
 * - `override_summary`: tallgrunnlaget (`AiOverrideStats`) inn, eventuelt navnene på de ansatte
 *   (til navnevakten), fasit er `ok`, stoppet av en bestemt vakt, `error` fra leverandøren, eller
 *   `not_called` når grunnlaget skal avvises før KI (null rapporter, ukjente nøkler, fritekst).
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
  "guess_guard",
  "name_guard",
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

// --- override_summary --------------------------------------------------------------------------

const overrideExpectSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("ok"),
    mustContain: z.array(z.string().min(1)).optional(),
    mustNotContain: z.array(z.string().min(1)).optional(),
    verdict: verdictSchema.optional(),
  }),
  z.strictObject({ outcome: z.literal("stopped"), guard: z.enum(EVAL_GUARD_CODES) }),
  z.strictObject({ outcome: z.literal("error") }),
  /** Grunnlaget skal avvises av kjernen før leverandøren kalles. */
  z.strictObject({ outcome: z.literal("not_called") }),
]);

const overrideCaseSchema = z.strictObject({
  id: caseId,
  description: z.string().optional(),
  /**
   * Tallgrunnlaget slik `BuildOverrideStats` gir det. Kontrolleres av `parseOverrideStats` i
   * `parseCasesFile`: må bestå, unntatt for `not_called`, der det ikke skal bestå.
   */
  stats: z.unknown(),
  statsCut: z.number().int().min(0).optional(),
  /** Oppdiktede navn på ansatte i organisasjonen (navnevakten og lekkasjesjekken). */
  personNames: z.array(nonEmpty).optional(),
  mustPass: z.boolean().default(false),
  /** Oppdiktet KI-svar som brukes i stedet for leverandørens. */
  simulatedAnswer: nonEmpty.optional(),
  expect: overrideExpectSchema,
});

export type OverrideEvalCase = z.infer<typeof overrideCaseSchema>;

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
  override_summary: fileSchema(overrideCaseSchema),
} as const;

type EvalFeatureKind = keyof typeof FILE_SCHEMAS;
type FileHeader = { status: typeof EVAL_CASES_STATUS; note: string };

export type EvalCasesFile =
  | (FileHeader & { feature: "language_polish"; cases: EvalCase[] })
  | (FileHeader & { feature: "phrase_suggest"; cases: PhraseEvalCase[] })
  | (FileHeader & { feature: "summary_draft"; cases: SummaryEvalCase[] })
  | (FileHeader & { feature: "override_summary"; cases: OverrideEvalCase[] });

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
  const definition = isFeatureKind(feature) ? getFeatureDefinition(parsed.data.feature) : null;
  if (definition === null) errors.push(`${fileName}: feature: ukjent KI-funksjon.`);

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
    case "override_summary":
      file.cases.forEach((c, i) =>
        errors.push(...checkOverrideCase(c, `${fileName}: cases[${i}]`)),
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

function checkOverrideCase(evalCase: OverrideEvalCase, where: string): string[] {
  const errors: string[] = [];
  const expect = evalCase.expect;
  const valid = parseOverrideStats(evalCase.stats) !== null;
  if (expect.outcome === "not_called") {
    if (valid) errors.push(`${where}.stats: utfallet not_called krever et grunnlag som avvises.`);
    if (evalCase.simulatedAnswer !== undefined) {
      errors.push(`${where}.simulatedAnswer: kan ikke brukes med utfallet not_called.`);
    }
  } else if (!valid) {
    errors.push(`${where}.stats: grunnlaget består ikke kontrollen (ukjent nøkkel, kode eller tall).`);
  }
  if (expect.outcome === "error" && evalCase.simulatedAnswer !== undefined) {
    errors.push(`${where}.simulatedAnswer: kan ikke brukes med utfallet error.`);
  }
  if (expect.outcome === "ok" && expect.verdict === "fail" && evalCase.simulatedAnswer === undefined) {
    errors.push(`${where}.expect: verdict fail krever simulatedAnswer.`);
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
