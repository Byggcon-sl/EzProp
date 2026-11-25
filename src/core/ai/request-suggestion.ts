import { and, desc, eq, gte, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { AccessDeniedError, grantHasPermission, type EmployeeGrant } from "@/core/access";
import { db } from "@/db/client";
import {
  AI_CANDIDATE_SOURCES,
  SUMMARY_GROUPS,
  aiUsageLog,
  assignments,
  type AiCandidateRef,
  type AiErrorCode,
  type AiGuardCode,
  type AiOutcome,
} from "@/db/schema";
import { stripUnstorableChars } from "@/shared/lib/clean-text";
import { logger } from "@/shared/lib/logger";
import { PII_PLACEHOLDERS } from "@/shared/lib/pii-patterns";
import { isUuid } from "@/shared/lib/uuid";
import { parseCandidateAnswer } from "./candidates";
import { AiInputTooLargeError, AiRateLimitError, AiRequestRejectedError } from "./errors";
import { getFeatureDefinition, type AiFeatureDefinition } from "./features";
import { checkAnswerGuards, isBlankText } from "./guards";
import {
  AI_BATCH_MAX_REQUESTS,
  AI_CANDIDATES_MAX,
  AI_CANDIDATE_TEXT_MAX_LENGTH,
  AI_OVERRIDE_SUMMARY_MAX_PER_EMPLOYEE_PER_HOUR,
  AI_OVERRIDE_SUMMARY_MAX_PER_ORGANIZATION_PER_DAY,
  AI_SUMMARY_FINDINGS_MAX,
  AI_SUMMARY_INPUT_MAX_LENGTH,
} from "./limits";
import { overrideStatsCutSchema, parseOverrideStats } from "./override-stats";
import { PlaceholderRestoreError, restorePlaceholders } from "./placeholders";
import {
  assembleSummary,
  parseSummaryAnswer,
  prepareCandidatePrompt,
  prepareOverridePrompt,
  preparePrompt,
  prepareSummaryPrompt,
  type PreparedCandidatePrompt,
  type PreparedOverridePrompt,
  type PreparedPrompt,
  type PreparedSummaryPrompt,
} from "./prompt";
import { findPromptLeaks } from "./prompt-leaks";
import { resolveAiProvider } from "./provider-resolution";
import type { AiProvider, AiProviderResult } from "./providers/types";
import { loadKnownValues, loadOrganizationKnownValues, type KnownValues } from "./redaction";
import {
  aiSuggestionRequestShapeSchema,
  hasOnlyAllowedFields,
  isOrganizationTargetType,
  isResolvedTargetType,
} from "./request";
import { resolveAiTarget } from "./resolve-target";
import { loadRejectedRetentionYears, retainUntilFor } from "./retention";
import type {
  AiCandidate,
  AiFeatureCode,
  AiOverrideStats,
  AiServerInput,
  AiSuggestionRequest,
  AiSuggestionResult,
  AiSummaryGroup,
  AiTargetRef,
  RequestSuggestion,
  RequestSuggestionBatch,
} from "./types";
import {
  insertBlockedRow,
  lockTarget,
  normalizeTarget,
  recordStatusChange,
  retainUntilFrom,
  sameTarget,
  sameTargetWhere,
  toSuggestionResult,
} from "./usage-log";

/*
 * Be om et KI-forslag (docs/funksjoner/fase2a-ki-modul-logg.md Omfang 3, ADR 0006 del 1, 4, 7 og
 * 8, og «KI i veien»: docs/funksjoner/fase2a-ki-i-veien.md). Rekkefølgen er fast:
 *
 *  1. valider forespørselen (strengt; kandidater, funn, `reportId` og `assignmentId` for mål som
 *     slås opp, kommer aldri fra nettleseren) og tom tekst (T-0111)
 *  2. rettighet → tillatt-liste → rensing av tegn → det bare serveren gir inn (`AiServerInput`),
 *     med grensene i `limits.ts` (for mye gir `AiInputTooLargeError`; kjernen kutter aldri)
 *  3. målet: for måltypene kjernen kontrollerer, slås målraden opp (`resolveAiTarget`) og
 *     rapport og oppdrag utledes; ellers kontrolleres oppdraget fra forespørselen
 *  4. samme `requestId` → «KI er av» (ingen rad) → åpent forslag på et organisasjonsmål
 *     gjenbrukes (ingen rad) → grensene per funksjon (`AiRateLimitError`, ingen rad) → sperret
 *     (`blocked`-rad, intet kall) → funksjonen er ikke slått på for leverandøren
 *     (`settings.features`, ingen rad)
 *  5. vask (hvert felt, hver kandidat og hvert funn for seg) → ledetekst → lekkasjesjekk for
 *     ekte leverandør (`blocked`-rad, intet kall) → kall leverandøren
 *  6. tolk svaret: kandidatmerkene strengt (`phrase_suggest`), vaktene (`language_polish` og
 *     `summary_draft`, A431), plassholderne tilbake i teksten til klienten (A466)
 *  7. én transaksjon med ny rad, avvisning av forrige forslag (bare når det nye kan vises) og
 *     revisjonslogg
 *
 * Alle avslag før kallet gir ingen rad, intet kall og ingen linje i `audit_log`. Organisasjon og
 * ansatt kommer bare fra `grant`. Leverandøren får bare vasket tekst, også den falske. Kaster
 * vasken, kalles leverandøren aldri (A176).
 *
 * Et stoppet svar (`stopped`) går aldri til klienten, `logger` eller `audit_log`: svaret har bare
 * vaktkoden, og teksten står bare i `output_text`. De opprinnelige verdiene bak plassholderne
 * holdes bare i minnet under kallet; `output_text` beholder plassholderne.
 *
 * Tegn databasen ikke tar (nulltegn, ensomme surrogater) fjernes fra verdiene rett etter
 * tillatt-listen, før alt annet og før personvernvasken (A180). Svaret fra leverandøren renses
 * likt.
 *
 * Låser aldri rapportraden eller målraden, bare KI-låsen på målet (`lockTarget`), så denne veien
 * og `recordDecisionIn` (rapporten først, så KI-låsen) ikke kan vente på hverandre.
 */

/** Måltyper som ikke kan kontrolleres mot organisasjonen ennå (A166, A173, A472). */
export const FAKE_ONLY_TARGET_TYPES: ReadonlySet<string> = new Set(["field_answer", "tgiu_detail"]);

/** Koden til den falske leverandøren. Alt annet regnes som ekte. */
const FAKE_PROVIDER_CODE = "fake";

/** Hvor mange felt fra «Språkvask avviket» som går til leverandøren samtidig. */
const BATCH_CONCURRENCY = 4;

/**
 * Om leverandøren er ekte. Sammenligner på fast kode, ikke på objektet: alt som ikke har koden
 * `fake`, regnes som ekte (docs/funksjoner/fase2a-ki-leverandor.md Omfang 6).
 */
function isRealProvider(provider: AiProvider): boolean {
  return provider.code !== FAKE_PROVIDER_CODE;
}

/**
 * Kildene i `serverSources` som bare har faste koder, faste etiketter, punktnavn fra malversjonen
 * og tall, bygget av serveren (ADR 0006, tillegg 24.11.2026, A568). Bare disse kan gå til en ekte
 * leverandør uten oppdrag. Ny nøkkel her krever gjennomgang av sikkerhet-personvern (A175).
 */
const ORGANIZATION_SERVER_SOURCE_KEYS: ReadonlySet<string> = new Set(["override_stats"]);

/**
 * Om et mål uten oppdrag kan gå til en ekte leverandør (ADR 0006, tillegg 24.11.2026, A568).
 * Alle vilkårene må holde: målet hører til organisasjonen (slått opp av kjernen), nettleseren kan
 * ikke sende én eneste verdi (tom `allowedFields` og `fieldSources`), og alt funksjonen sender,
 * kommer fra serveren gjennom kilder med bare faste koder, etiketter og tall.
 */
export function isOrganizationTargetAllowed(
  definition: Pick<AiFeatureDefinition, "allowedFields" | "fieldSources" | "serverSources">,
  targetType: string,
): boolean {
  if (!isOrganizationTargetType(targetType)) return false;
  if (definition.allowedFields.length > 0) return false;
  if (Object.keys(definition.fieldSources).length > 0) return false;
  const serverKeys = Object.keys(definition.serverSources);
  return (
    serverKeys.length > 0 && serverKeys.every((key) => ORGANIZATION_SERVER_SOURCE_KEYS.has(key))
  );
}

/**
 * Om forespørselen sperres (ad-1): bare den falske leverandøren får mål som ikke kontrolleres, og
 * ingen tekst går til en ekte leverandør uten oppdrag (spørsmål 58). Eneste unntak er et
 * organisasjonsmål for en funksjon som bare sender faste koder, etiketter og tall
 * (`isOrganizationTargetAllowed`).
 */
function isBlocked(
  provider: AiProvider,
  definition: AiFeatureDefinition,
  targetType: string,
  assignmentId: string | null,
): boolean {
  if (!isRealProvider(provider)) return false;
  if (FAKE_ONLY_TARGET_TYPES.has(targetType)) return true;
  if (assignmentId !== null) return false;
  return !isOrganizationTargetAllowed(definition, targetType);
}

/**
 * Grensene per funksjon (A575). Bare funksjoner som står her, telles. Talt i `ai_usage_log` på
 * organisasjon, funksjon og tid; sperrede rader (`blocked`) telles ikke, de har ikke kalt noen.
 * To samtidige kall kan i verste fall slippe én over grensen; grensen er et vern mot kostnad, ikke
 * en lås.
 */
const RATE_LIMITS: Partial<
  Record<AiFeatureCode, { perEmployeePerHour: number; perOrganizationPerDay: number }>
> = {
  override_summary: {
    perEmployeePerHour: AI_OVERRIDE_SUMMARY_MAX_PER_EMPLOYEE_PER_HOUR,
    perOrganizationPerDay: AI_OVERRIDE_SUMMARY_MAX_PER_ORGANIZATION_PER_DAY,
  },
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

async function countCalls(
  grant: EmployeeGrant,
  feature: AiFeatureCode,
  since: Date,
  employeeOnly: boolean,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(aiUsageLog)
    .where(
      and(
        eq(aiUsageLog.organizationId, grant.organizationId),
        eq(aiUsageLog.feature, feature),
        gte(aiUsageLog.createdAt, since),
        ne(aiUsageLog.outcome, "blocked"),
        employeeOnly ? eq(aiUsageLog.employeeId, grant.employeeId) : undefined,
      ),
    );
  return row?.count ?? 0;
}

/** Kaster `AiRateLimitError` når en grense er nådd. Ingen rad, intet kall. */
async function checkRateLimits(grant: EmployeeGrant, feature: AiFeatureCode): Promise<void> {
  const limits = RATE_LIMITS[feature];
  if (!limits) return;
  const now = Date.now();
  const lastHour = await countCalls(grant, feature, new Date(now - HOUR_MS), true);
  if (lastHour >= limits.perEmployeePerHour) throw new AiRateLimitError("employee_hour");
  const lastDay = await countCalls(grant, feature, new Date(now - DAY_MS), false);
  if (lastDay >= limits.perOrganizationPerDay) throw new AiRateLimitError("organization_day");
}

const resultColumns = {
  id: aiUsageLog.id,
  organizationId: aiUsageLog.organizationId,
  employeeId: aiUsageLog.employeeId,
  feature: aiUsageLog.feature,
  targetRef: aiUsageLog.targetRef,
  outcome: aiUsageLog.outcome,
  outputText: aiUsageLog.outputText,
  errorCode: aiUsageLog.errorCode,
  candidateRefs: aiUsageLog.candidateRefs,
  redactedCount: aiUsageLog.redactedCount,
  deletedAt: aiUsageLog.deletedAt,
};

/**
 * Svaret fra en rad som ble lagret i et tidligere kall (samme `requestId`). Har raden en tekst med
 * plassholdere (`redacted_count > 0`), er de opprinnelige verdiene borte (de holdes bare i minnet
 * under kallet, A466). Da gir kjernen `error` (prøv igjen), aldri teksten med plassholderne.
 * Teksten sjekkes også direkte, fordi linjer som koden lager selv (TGIU-linjene i sammendraget),
 * kan ha plassholdere uten at de telles i `redacted_count`.
 */
function replayedResult(row: {
  id: string;
  outcome: string;
  outputText: string | null;
  errorCode: string | null;
  candidateRefs: AiCandidateRef[] | null;
  redactedCount: number;
}): AiSuggestionResult {
  const answer = toSuggestionResult(row);
  const hasPlaceholder =
    row.outputText !== null &&
    PII_PLACEHOLDERS.some((placeholder) => row.outputText!.includes(placeholder));
  if (answer.kind === "suggestion" && (row.redactedCount > 0 || hasPlaceholder)) {
    return { kind: "error", usageId: row.id };
  }
  return answer;
}

type StoredRow = {
  organizationId: string;
  employeeId: string;
  feature: string;
  targetRef: AiTargetRef;
  deletedAt: Date | null;
};

/** Om den lagrede raden er samme forespørsel fra samme ansatt i samme organisasjon. */
function isOwnRequest(
  row: StoredRow,
  grant: EmployeeGrant,
  feature: string,
  target: AiTargetRef,
): boolean {
  return (
    row.deletedAt === null &&
    row.organizationId === grant.organizationId &&
    row.employeeId === grant.employeeId &&
    row.feature === feature &&
    sameTarget(row.targetRef, target)
  );
}

/** Kaller leverandøren. Et unntak gir `error` med `unknown`; feilen sendes aldri videre. */
async function callProvider(call: () => Promise<AiProviderResult>): Promise<AiProviderResult> {
  try {
    return await call();
  } catch {
    return { outcome: "error", errorCode: "unknown" };
  }
}

// --- Validering av det serveren gir inn ----------------------------------------------------------

const candidateSchema = z
  .object({
    source: z.enum(AI_CANDIDATE_SOURCES),
    id: z.string().refine(isUuid),
    text: z.string(),
  })
  .strict();

const findingSchema = z
  .object({
    checkpointName: z.string().min(1),
    deviationText: z.string().nullable(),
    causeText: z.string().nullable(),
    consequenceText: z.string().nullable(),
    measures: z.array(z.string()),
  })
  .strict();

const fixedLineSchema = z.object({ checkpointName: z.string().min(1), text: z.string() }).strict();

const summaryGroupSchema = z
  .object({
    group: z.enum(SUMMARY_GROUPS),
    heading: z.string().min(1),
    findings: z.array(findingSchema),
    fixedLines: z.array(fixedLineSchema),
  })
  .strict();

const serverInputSchema = z
  .object({
    candidates: z.array(candidateSchema).optional(),
    candidatesCut: z.number().int().min(0).optional(),
    summaryGroups: z.array(summaryGroupSchema).optional(),
    // Kontrolleres strengt for seg (`parseOverrideStats`) rett før ledeteksten bygges
    overrideStats: z.unknown().optional(),
    overrideStatsCut: overrideStatsCutSchema.optional(),
  })
  .strict();

type CheckedServerInput =
  | { kind: "none" }
  | { kind: "override"; stats: AiOverrideStats; cut: number }
  | { kind: "candidates"; candidates: AiCandidate[]; cut: number }
  | { kind: "summary"; groups: AiSummaryGroup[]; findingCount: number; fixedLineCount: number };

/** Kontrollerer `AiServerInput` mot funksjonen. Kaster ved feil; kutter aldri. */
function checkServerInput(
  definition: AiFeatureDefinition,
  serverInput: AiServerInput | undefined,
): CheckedServerInput {
  const parsed = serverInputSchema.safeParse(serverInput ?? {});
  if (!parsed.success) throw new AiRequestRejectedError();
  const { candidates, candidatesCut, summaryGroups, overrideStats, overrideStatsCut } = parsed.data;

  if (definition.code === "override_summary") {
    if (candidates !== undefined || candidatesCut !== undefined || summaryGroups !== undefined) {
      throw new AiRequestRejectedError();
    }
    // Ukjente nøkler, koder utenfor nøkkelformatet, tall som ikke er heltall, og null rapporter
    // (da skal KI ikke kalles) gir samme avslag
    const stats = parseOverrideStats(overrideStats);
    if (stats === null) throw new AiRequestRejectedError();
    return { kind: "override", stats, cut: overrideStatsCut ?? 0 };
  }
  if (overrideStats !== undefined || overrideStatsCut !== undefined) {
    throw new AiRequestRejectedError();
  }

  if (definition.code === "phrase_suggest") {
    if (summaryGroups !== undefined || candidates === undefined) throw new AiRequestRejectedError();
    // 0 kandidater: kalleren viser «Ingen treff» uten å kalle (intet kall, ingen rad)
    if (candidates.length === 0) throw new AiRequestRejectedError();
    if (candidates.length > AI_CANDIDATES_MAX) {
      throw new AiInputTooLargeError("too_many_candidates");
    }
    if (candidates.some((candidate) => candidate.text.length > AI_CANDIDATE_TEXT_MAX_LENGTH)) {
      throw new AiInputTooLargeError("too_many_candidates");
    }
    const keys = new Set(candidates.map((c) => `${c.source}:${c.id.toLowerCase()}`));
    if (keys.size !== candidates.length) throw new AiRequestRejectedError();
    if (candidates.some((candidate) => isBlankText(candidate.text))) {
      throw new AiRequestRejectedError();
    }
    return {
      kind: "candidates",
      candidates: candidates.map((c) => ({
        source: c.source,
        id: c.id.toLowerCase(),
        text: c.text,
      })),
      cut: candidatesCut ?? 0,
    };
  }

  if (definition.code === "summary_draft") {
    if (candidates !== undefined || candidatesCut !== undefined || summaryGroups === undefined) {
      throw new AiRequestRejectedError();
    }
    let findingCount = 0;
    let fixedLineCount = 0;
    let lastOrder = -1;
    for (const group of summaryGroups) {
      const order = SUMMARY_GROUPS.indexOf(group.group);
      // Fast rekkefølge, hver gruppe én gang
      if (order <= lastOrder) throw new AiRequestRejectedError();
      lastOrder = order;
      const textGroup = group.group !== "tgiu";
      if (textGroup && (group.fixedLines.length > 0 || group.findings.length === 0)) {
        throw new AiRequestRejectedError();
      }
      if (!textGroup && (group.findings.length > 0 || group.fixedLines.length === 0)) {
        throw new AiRequestRejectedError();
      }
      findingCount += group.findings.length;
      fixedLineCount += group.fixedLines.length;
    }
    // Uten funn som KI skal skrive, trenger utkastet ikke KI (rapportkjernen setter det sammen)
    if (findingCount === 0) throw new AiRequestRejectedError();
    if (findingCount + fixedLineCount > AI_SUMMARY_FINDINGS_MAX) {
      throw new AiInputTooLargeError("too_many_findings");
    }
    return { kind: "summary", groups: summaryGroups, findingCount, fixedLineCount };
  }

  if (candidates !== undefined || candidatesCut !== undefined || summaryGroups !== undefined) {
    throw new AiRequestRejectedError();
  }
  return { kind: "none" };
}

/** Tom tekst (T-0111): språkvask krever tekst; fraseforslag tillater tomt `text`. */
function hasBlankValue(feature: string, fields: Readonly<Record<string, string>>): boolean {
  if (feature === "language_polish") {
    if (!Object.prototype.hasOwnProperty.call(fields, "text")) return true;
    return Object.values(fields).some(isBlankText);
  }
  if (feature === "phrase_suggest") {
    return Object.entries(fields).some(([key, value]) => key !== "text" && isBlankText(value));
  }
  return Object.values(fields).some((value) => value.length === 0);
}

type Validated = {
  definition: AiFeatureDefinition;
  requestId: string;
  requestAssignmentId: string | null;
  target: AiTargetRef;
  fields: Record<string, string>;
  server: CheckedServerInput;
};

/** Trinn 1–2: alt som kan avgjøres uten databasen. Kaster ved avslag. */
function validateRequest(
  grant: EmployeeGrant,
  request: AiSuggestionRequest,
  serverInput: AiServerInput | undefined,
): Validated {
  const parsed = aiSuggestionRequestShapeSchema.safeParse(request);
  if (!parsed.success) throw new AiRequestRejectedError();
  const input = parsed.data;
  const definition = getFeatureDefinition(input.feature);
  if (!definition) throw new AiRequestRejectedError();
  if (hasBlankValue(definition.code, input.fields)) throw new AiRequestRejectedError();

  // Rettigheten fra funksjonen (admin har alle)
  if (!grantHasPermission(grant, definition.permission)) throw new AccessDeniedError();

  // Bare feltkoder fra tillatt-listen
  if (!hasOnlyAllowedFields(definition, input.fields)) throw new AiRequestRejectedError();

  // Tegn databasen ikke tar fjernes fra verdiene (ikke fra feltkodene). Tom etter rensing gir
  // samme avslag som tom tekst, før oppslag, sperret rad, personvernvask og leverandør.
  const fields: Record<string, string> = Object.fromEntries(
    Object.entries(input.fields).map(([key, value]) => [key, stripUnstorableChars(value)]),
  );
  if (hasBlankValue(definition.code, fields)) throw new AiRequestRejectedError();

  const server = checkServerInput(definition, serverInput);
  return {
    definition,
    requestId: input.requestId.toLowerCase(),
    requestAssignmentId: input.assignmentId,
    target: normalizeTarget(input.target),
    fields,
    server,
  };
}

/** Trinn 3: rapport og oppdrag fra målet, eller oppdraget fra forespørselen. `null` = avslag. */
async function resolveScope(
  grant: EmployeeGrant,
  validated: Validated,
): Promise<{ reportId: string | null; assignmentId: string | null } | null> {
  if (isResolvedTargetType(validated.target.type)) {
    const resolved = await resolveAiTarget(grant, validated.target);
    return resolved ? { reportId: resolved.reportId, assignmentId: resolved.assignmentId } : null;
  }
  const assignmentId = validated.requestAssignmentId;
  if (assignmentId === null) return { reportId: null, assignmentId: null };
  const [assignment] = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(
      and(
        eq(assignments.id, assignmentId),
        eq(assignments.organizationId, grant.organizationId),
        isNull(assignments.deletedAt),
      ),
    );
  return assignment ? { reportId: null, assignmentId } : null;
}

// --- Tolking av svaret -----------------------------------------------------------------------

type Interpreted = {
  outcome: AiOutcome;
  errorCode: AiErrorCode | AiGuardCode | null;
  /** Det som lagres: med plassholderne, aldri de opprinnelige verdiene. */
  outputText: string | null;
  /** Det klienten får: plassholderne byttet tilbake. Bare når utfallet er `ok` med tekst. */
  clientText: string | null;
  candidateRefs: AiCandidateRef[] | null;
  summaryExtra: Record<string, number>;
};

type Prepared =
  | { kind: "fields"; prepared: PreparedPrompt }
  | { kind: "candidates"; prepared: PreparedCandidatePrompt; cut: number }
  | { kind: "summary"; prepared: PreparedSummaryPrompt }
  | { kind: "override"; prepared: PreparedOverridePrompt };

function stopped(guard: AiGuardCode, answer: string): Interpreted {
  return {
    outcome: "stopped",
    errorCode: guard,
    outputText: answer,
    clientText: null,
    candidateRefs: null,
    summaryExtra: {},
  };
}

function noMatch(extra: Record<string, number> = {}): Interpreted {
  return {
    outcome: "no_match",
    errorCode: null,
    outputText: null,
    clientText: null,
    candidateRefs: null,
    summaryExtra: extra,
  };
}

/**
 * Tolker et svar med utfallet `ok` for funksjonen. Vaktene kjøres her. `known` er de kjente
 * verdiene fra oppslaget; navnevakten for `override_summary` bruker navnene derfra.
 */
function interpretAnswer(
  prepared: Prepared,
  answer: string,
  known: KnownValues | null,
): Interpreted {
  if (prepared.kind === "override") {
    if (isBlankText(answer)) return noMatch();
    const guard = checkAnswerGuards({
      feature: "override_summary",
      sent: [{ label: null, texts: prepared.prepared.texts }],
      answer: [{ label: null, text: answer }],
      personNames: known?.personNames ?? [],
    });
    if (guard !== null) return stopped(guard, answer);
    // Ingen plassholdere i svaret (vakten over), så teksten til klienten er den samme
    return {
      outcome: "ok",
      errorCode: null,
      outputText: answer,
      clientText: answer,
      candidateRefs: null,
      summaryExtra: {},
    };
  }

  if (prepared.kind === "candidates") {
    const parsed = parseCandidateAnswer(answer, prepared.prepared.labeled);
    const extra = {
      unknown_labels: parsed.unknownLabels,
      duplicate_labels: parsed.duplicateLabels,
    };
    if (parsed.refs.length === 0) return noMatch(extra);
    return {
      outcome: "ok",
      errorCode: null,
      outputText: null,
      clientText: null,
      candidateRefs: parsed.refs,
      summaryExtra: extra,
    };
  }

  if (prepared.kind === "summary") {
    const summary = prepared.prepared;
    const parts = parseSummaryAnswer(answer);
    const guard = checkAnswerGuards({
      feature: "summary_draft",
      sent: summary.parts.map((part) => ({ label: part.label, texts: part.texts })),
      answer: parts,
    });
    if (guard !== null) return stopped(guard, answer);
    const byLabel = new Map(parts.map((part) => [part.label, part.text]));
    const originalsByLabel = new Map(summary.parts.map((part) => [part.label, part.originals]));
    let restored: Map<string, string>;
    try {
      restored = new Map(
        summary.parts.map((part) => [
          part.label,
          restorePlaceholders(
            byLabel.get(part.label) ?? "",
            originalsByLabel.get(part.label) ?? [],
          ),
        ]),
      );
    } catch (error) {
      if (error instanceof PlaceholderRestoreError) return stopped("placeholder_guard", answer);
      throw error;
    }
    return {
      outcome: "ok",
      errorCode: null,
      outputText: assembleSummary(summary, (label) => byLabel.get(label) ?? "", true),
      clientText: assembleSummary(summary, (label) => restored.get(label) ?? "", false),
      candidateRefs: null,
      summaryExtra: {},
    };
  }

  // language_polish: én del, vaktene på hele svaret
  if (isBlankText(answer)) return noMatch();
  const sentTexts = Object.values(prepared.prepared.redactedFields);
  const guard = checkAnswerGuards({
    feature: "language_polish",
    sent: [{ label: null, texts: sentTexts }],
    answer: [{ label: null, text: answer }],
  });
  if (guard !== null) return stopped(guard, answer);
  const originals = Object.values(prepared.prepared.originals).flat();
  let clientText: string;
  try {
    clientText = restorePlaceholders(answer, originals);
  } catch (error) {
    if (error instanceof PlaceholderRestoreError) return stopped("placeholder_guard", answer);
    throw error;
  }
  return {
    outcome: "ok",
    errorCode: null,
    outputText: answer,
    clientText,
    candidateRefs: null,
    summaryExtra: {},
  };
}

/** `input_summary`: bare feltnavn og antall, aldri tekst. */
function inputSummaryFor(
  prepared: Prepared,
  fieldKeys: readonly string[],
  extra: Record<string, number>,
): Record<string, number> {
  if (prepared.kind === "override") {
    // Bare antall linjer og hvor mange kalleren kuttet (ADR 0006 tillegg 24.11.2026, del 5)
    return { rows: prepared.prepared.rows, rows_cut: prepared.prepared.cut, ...extra };
  }
  if (prepared.kind === "summary") {
    const summary = prepared.prepared;
    return {
      findings: summary.parts.length,
      fixed_lines: summary.groups.reduce((sum, group) => sum + group.fixedLines.length, 0),
      input_chars: summary.inputLength,
      ...extra,
    };
  }
  const fieldLengths = Object.fromEntries(
    fieldKeys.map((key) => [key, (prepared.prepared.redactedFields[key] ?? "").length]),
  );
  if (prepared.kind === "candidates") {
    return {
      ...fieldLengths,
      candidates: prepared.prepared.labeled.length,
      candidates_cut: prepared.cut,
      unknown_labels: 0,
      duplicate_labels: 0,
      ...extra,
    };
  }
  return { ...fieldLengths, ...extra };
}

// --- Inngangen -------------------------------------------------------------------------------

export const requestSuggestion: RequestSuggestion = async (grant, request, serverInput) => {
  // 1–2. Validering, rettighet, tillatt-liste, rensing og det serveren gir inn
  const validated = validateRequest(grant, request, serverInput);
  const { definition, target, fields, requestId } = validated;

  // 3. Målet (eller oppdraget) i organisasjonen
  const scope = await resolveScope(grant, validated);
  if (scope === null) throw new AiRequestRejectedError();

  // 4. Samme requestId på nytt: svaret fra første gang, uten nytt kall
  const [existing] = await db
    .select(resultColumns)
    .from(aiUsageLog)
    .where(and(eq(aiUsageLog.id, requestId), eq(aiUsageLog.organizationId, grant.organizationId)));
  if (existing) {
    if (!isOwnRequest(existing, grant, definition.code, target)) {
      throw new AiRequestRejectedError();
    }
    return replayedResult(existing);
  }
  // Id-en finnes hos en annen organisasjon eller er mykt slettet: avslag før leverandøren kalles
  const [taken] = await db
    .select({ id: aiUsageLog.id })
    .from(aiUsageLog)
    .where(eq(aiUsageLog.id, requestId));
  if (taken) throw new AiRequestRejectedError();

  // KI av: ingen rad, intet kall
  const resolved = await resolveAiProvider(grant);
  if (resolved.kind === "disabled") return { kind: "disabled" };
  const { provider, model } = resolved;
  const fieldKeys = Object.keys(fields).sort();

  // Organisasjonsmål: et åpent forslag på målet gjenbrukes for hele organisasjonen, uansett hvem
  // som ba om det (ADR 0006 tillegg 24.11.2026, del 8). Ingen ny rad, intet kall.
  if (isOrganizationTargetType(target.type)) {
    const [open] = await db
      .select(resultColumns)
      .from(aiUsageLog)
      .where(
        and(
          sameTargetWhere(grant.organizationId, definition.code, target),
          eq(aiUsageLog.outcome, "ok"),
          eq(aiUsageLog.status, "suggested"),
        ),
      )
      .orderBy(desc(aiUsageLog.createdAt))
      .limit(1);
    if (open) return replayedResult(open);
  }

  // Grensene per funksjon (A575): ingen rad, intet kall
  await checkRateLimits(grant, definition.code);

  const blockedRow = () =>
    insertBlockedRow(grant, {
      requestId,
      feature: definition.code,
      provider: provider.code,
      model,
      promptVersion: definition.promptVersion,
      assignmentId: scope.assignmentId,
      reportId: scope.reportId,
      target,
      sourceFields: fieldKeys,
    });

  // Sperret: rad med utfallet `blocked`, ingen vask, intet kall
  if (isBlocked(provider, definition, target.type, scope.assignmentId)) return blockedRow();

  // Funksjonen er ikke slått på for leverandøren (`settings.features`, A194): som «KI er av»,
  // ingen rad, ingen vask, intet kall. `null` betyr alle (bare `fake`); tom liste betyr ingen.
  if (resolved.features !== null && !resolved.features.includes(definition.code)) {
    return { kind: "disabled" };
  }

  // 5. Kjente verdier for oppdraget, eller navnene på de ansatte for et organisasjonsmål. Kaster
  // oppslaget eller vasken, kalles leverandøren aldri.
  const known =
    scope.assignmentId !== null
      ? await loadKnownValues(grant, scope.assignmentId)
      : isOrganizationTargetType(target.type)
        ? await loadOrganizationKnownValues(grant)
        : null;

  let prepared: Prepared;
  if (validated.server.kind === "override") {
    prepared = {
      kind: "override",
      prepared: prepareOverridePrompt(
        definition,
        validated.server.stats,
        validated.server.cut,
        known,
      ),
    };
  } else if (validated.server.kind === "candidates") {
    prepared = {
      kind: "candidates",
      prepared: prepareCandidatePrompt(definition, fields, validated.server.candidates, known),
      cut: validated.server.cut,
    };
  } else if (validated.server.kind === "summary") {
    const summary = prepareSummaryPrompt(definition, validated.server.groups, known);
    // For mye tekst til ett utkast: tydelig melding, aldri stille kutt av funn
    if (summary.inputLength > AI_SUMMARY_INPUT_MAX_LENGTH) {
      throw new AiInputTooLargeError("too_many_findings");
    }
    prepared = { kind: "summary", prepared: summary };
  } else {
    prepared = { kind: "fields", prepared: preparePrompt(definition, fields, known) };
  }
  const prompt = prepared.prepared.prompt;
  const redactedCount = prepared.prepared.redactedCount;

  // Lekkasjesjekken på den ferdige ledeteksten (A195), også kandidater og funn: siste vern før
  // tekst forlater oss. Treff gir `blocked`-rad uten kall. Typen eller verdien logges ikke.
  // For et organisasjonsmål er de kjente verdiene navnene på alle ansatte, og korte navneord
  // («To», «Leder») står i den faste instruksen. Der sjekkes derfor innholdet etter skillet, alt
  // som ikke er vår egen faste tekst.
  const leakText = prepared.kind === "override" ? prepared.prepared.texts.join("\n") : prompt;
  if (isRealProvider(provider) && findPromptLeaks(leakText, known).length > 0) {
    return blockedRow();
  }

  const providerResult = await callProvider(() =>
    provider.complete({
      feature: definition.code,
      promptVersion: definition.promptVersion,
      prompt,
      model,
    }),
  );

  // 6. Tolk svaret. Samme rensede tekst i `ai_usage_log` som det vaktene så.
  let interpreted: Interpreted;
  if (providerResult.outcome === "ok") {
    interpreted = interpretAnswer(prepared, stripUnstorableChars(providerResult.text), known);
  } else if (providerResult.outcome === "no_match") {
    interpreted = noMatch();
  } else {
    interpreted = {
      outcome: "error",
      errorCode: providerResult.errorCode,
      outputText: null,
      clientText: null,
      candidateRefs: null,
      summaryExtra: {},
    };
    logger.warn("KI-kallet ga feil", {
      feature: definition.code,
      provider: provider.code,
      errorCode: providerResult.errorCode,
      usageId: requestId,
    });
  }
  if (interpreted.outcome === "stopped") {
    // Bare koden, aldri teksten
    logger.info("KI-svaret ble stoppet av en vakt", {
      feature: definition.code,
      guard: interpreted.errorCode,
      usageId: requestId,
    });
  }

  // 7. Én transaksjon: ny rad, forrige forslag på samme mål avvist, revisjonslogg.
  // `input_summary` regnes av den vaskede teksten, det som faktisk ble sendt (A172).
  const now = new Date();
  const inputSummary = inputSummaryFor(prepared, fieldKeys, interpreted.summaryExtra);
  const paid = providerResult.outcome !== "error";
  const status = interpreted.outcome === "ok" ? ("suggested" as const) : null;

  const result = await db.transaction(async (tx) => {
    await lockTarget(tx, grant.organizationId, definition.code, target);
    const [inserted] = await tx
      .insert(aiUsageLog)
      .values({
        id: requestId,
        organizationId: grant.organizationId,
        employeeId: grant.employeeId,
        feature: definition.code,
        provider: provider.code,
        model,
        promptVersion: definition.promptVersion,
        assignmentId: scope.assignmentId,
        reportId: scope.reportId,
        targetRef: target,
        sourceFields: fieldKeys,
        inputSummary,
        outcome: interpreted.outcome,
        errorCode: interpreted.errorCode,
        outputText: interpreted.outputText,
        candidateRefs: interpreted.candidateRefs,
        status,
        tokensIn: paid ? providerResult.tokensIn : 0,
        tokensOut: paid ? providerResult.tokensOut : 0,
        cost: paid ? String(providerResult.cost) : "0",
        currency: paid ? providerResult.currency : "NOK",
        redactedCount,
        retainUntil: retainUntilFrom(now),
        createdAt: now,
        updatedAt: now,
        createdBy: grant.employeeId,
        updatedBy: grant.employeeId,
      })
      .onConflictDoNothing({ target: aiUsageLog.id })
      .returning(resultColumns);

    if (!inserted) {
      // Et samtidig kall med samme id kom først. Bare vår egen rad leses tilbake.
      const [winner] = await tx
        .select(resultColumns)
        .from(aiUsageLog)
        .where(
          and(eq(aiUsageLog.id, requestId), eq(aiUsageLog.organizationId, grant.organizationId)),
        );
      if (!winner || !isOwnRequest(winner, grant, definition.code, target)) {
        throw new AiRequestRejectedError();
      }
      return { row: winner, own: false };
    }

    // Avklaring A: forrige forslag avvises bare når det nye kan vises (ikke ved `stopped`)
    if (inserted.outcome === "ok") {
      const toReject = await tx
        .select({ id: aiUsageLog.id, createdAt: aiUsageLog.createdAt })
        .from(aiUsageLog)
        .where(
          and(
            sameTargetWhere(grant.organizationId, definition.code, target),
            eq(aiUsageLog.status, "suggested"),
            ne(aiUsageLog.id, inserted.id),
          ),
        );
      if (toReject.length > 0) {
        // Hver avvist rad får dato fra sin egen `created_at` og innstillingen (K7)
        const rejectedYears = await loadRejectedRetentionYears(tx, grant.organizationId);
        for (const candidate of toReject) {
          const [replaced] = await tx
            .update(aiUsageLog)
            .set({
              status: "rejected",
              chosenCandidate: null,
              retainUntil: retainUntilFor("rejected", candidate.createdAt, rejectedYears),
              decidedBy: grant.employeeId,
              decidedAt: now,
              updatedBy: grant.employeeId,
            })
            .where(
              and(
                eq(aiUsageLog.id, candidate.id),
                eq(aiUsageLog.organizationId, grant.organizationId),
                eq(aiUsageLog.status, "suggested"),
                isNull(aiUsageLog.deletedAt),
              ),
            )
            .returning({ id: aiUsageLog.id });
          if (replaced) {
            await recordStatusChange(tx, grant, replaced.id, "suggested", "rejected");
          }
        }
      }
    }
    return { row: inserted, own: true };
  });

  if (!result.own) return replayedResult(result.row);
  const answer = toSuggestionResult(result.row);
  // Teksten til klienten har de opprinnelige verdiene tilbake (A466); raden har plassholderne
  if (answer.kind === "suggestion" && interpreted.clientText !== null) {
    return { ...answer, text: interpreted.clientText };
  }
  return answer;
};

// --- Flere felt fra ett trykk («Språkvask avviket», A460) --------------------------------------

function targetKey(target: AiTargetRef): string {
  const normalized = normalizeTarget(target);
  return `${normalized.type}:${normalized.id}:${normalized.fieldKey}`;
}

export const requestSuggestionBatch: RequestSuggestionBatch = async (grant, requests) => {
  if (!Array.isArray(requests) || requests.length === 0) throw new AiRequestRejectedError();
  if (requests.length > AI_BATCH_MAX_REQUESTS) throw new AiRequestRejectedError();

  // Hele listen valideres før noe kalles
  const validated = requests.map((request) => validateRequest(grant, request, undefined));
  if (validated.some((entry) => entry.definition.code !== "language_polish")) {
    throw new AiRequestRejectedError();
  }
  if (new Set(validated.map((entry) => entry.requestId)).size !== validated.length) {
    throw new AiRequestRejectedError();
  }
  if (new Set(validated.map((entry) => targetKey(entry.target))).size !== validated.length) {
    throw new AiRequestRejectedError();
  }
  // Alle målene må slås opp av kjernen og høre til samme rapport
  if (validated.some((entry) => !isResolvedTargetType(entry.target.type))) {
    throw new AiRequestRejectedError();
  }
  const reportIds = new Set<string>();
  for (const entry of validated) {
    const resolved = await resolveAiTarget(grant, entry.target);
    // Mål uten rapport (organisasjonsmål) kan ikke stå i et trykk med flere felt
    if (!resolved || resolved.reportId === null) throw new AiRequestRejectedError();
    reportIds.add(resolved.reportId);
  }
  if (reportIds.size !== 1) throw new AiRequestRejectedError();

  // Ett leverandørkall og én rad per felt, noen om gangen. Feil eller stopp på ett felt er et
  // eget svar og stopper ikke de andre.
  const results: AiSuggestionResult[] = new Array(requests.length);
  let next = 0;
  async function worker() {
    while (next < requests.length) {
      const index = next;
      next += 1;
      results[index] = await requestSuggestion(grant, requests[index] as AiSuggestionRequest);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(BATCH_CONCURRENCY, requests.length) }, () => worker()),
  );
  return results;
};
