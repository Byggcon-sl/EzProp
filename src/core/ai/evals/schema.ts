import { z } from "zod";
import { getFeatureDefinition } from "../features";
import { emptyKnownValues, type KnownValues } from "../redact-text";

/*
 * Formatet for evalueringssettet (docs/funksjoner/fase2a-evalueringssett.md, Omfang 1, ADR 0006
 * del 9). Én fil per KI-funksjon: `<funksjon>.cases.json` i denne mappen.
 *
 * Hovedmål: KI i bunnen. Hver KI-funksjon får faste eksempler med fasit som må bestås før ekte bruk.
 *
 * Eksemplene er oppdiktet prøvedata for KI. De brukes aldri som avvikstekst, seed-data eller mal.
 * Feilmeldingene bygges av sti og feilkode, aldri av verdiene i filen, så en kjent verdi (navn,
 * telefon o.l.) aldri gjentas i utskriften.
 */

export const EVAL_CASES_STATUS = "utkast, ikke godkjent av fagrådet";
export const EVAL_CASES_MIN = 30;
export const EVAL_CASES_MAX = 50;
export const EVAL_CASES_FILE_SUFFIX = ".cases.json";

const stringList = z.array(z.string());
const nullableString = z.string().nullable().default(null);

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

const expectSchema = z.strictObject({
  outcome: z.enum(["ok", "no_match"]),
  mustContain: z.array(z.string().min(1)).optional(),
  mustNotContain: z.array(z.string().min(1)).optional(),
  sameTg: z.boolean().optional(),
});

export type EvalExpectation = z.infer<typeof expectSchema>;

const caseSchema = z.strictObject({
  id: z.string().min(1),
  description: z.string().optional(),
  fields: z.record(z.string(), z.string()),
  known: knownSchema.optional(),
  mustPass: z.boolean().default(false),
  expect: expectSchema,
});

export type EvalCase = z.infer<typeof caseSchema>;

const fileSchema = z.strictObject({
  feature: z.string().min(1),
  status: z.literal(EVAL_CASES_STATUS),
  note: z.string().trim().min(1),
  cases: z.array(caseSchema).min(EVAL_CASES_MIN).max(EVAL_CASES_MAX),
});

export type EvalCasesFile = z.infer<typeof fileSchema>;

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
    default:
      return "ugyldig innhold";
  }
}

/**
 * Leser og validerer innholdet i én eksempelfil. `fileName` brukes bare i meldingene. Meldingene er
 * på norsk og gjentar aldri verdier fra filen (bare sti, feilkode, eksempel-id og feltkode).
 */
export function parseCasesFile(json: unknown, fileName: string): ParseCasesResult {
  const parsed = fileSchema.safeParse(json, { reportInput: false });
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (issue) => `${fileName}: ${formatPath(issue.path)}: ${describeIssue(issue)}.`,
      ),
    };
  }

  const file = parsed.data;
  const errors: string[] = [];
  const definition = getFeatureDefinition(file.feature);
  if (definition === null) {
    errors.push(`${fileName}: feature: ukjent KI-funksjon.`);
  }

  const seen = new Set<string>();
  file.cases.forEach((evalCase, index) => {
    const where = `${fileName}: cases[${index}]`;
    if (seen.has(evalCase.id)) {
      errors.push(`${where}: id-en ${evalCase.id} er brukt før. Hver id skal være unik.`);
    }
    seen.add(evalCase.id);
    if (definition !== null) {
      for (const key of Object.keys(evalCase.fields)) {
        if (!definition.allowedFields.includes(key)) {
          errors.push(`${where}.fields: feltet ${key} står ikke på tillatt-listen for funksjonen.`);
        }
      }
    }
    if (evalCase.expect.outcome === "no_match" && evalCase.expect.mustContain !== undefined) {
      errors.push(`${where}.expect: mustContain kan ikke brukes med utfallet no_match.`);
    }
  });

  return errors.length > 0 ? { ok: false, errors } : { ok: true, file };
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
