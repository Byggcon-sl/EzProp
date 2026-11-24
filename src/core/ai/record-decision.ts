import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { AccessDeniedError, grantHasPermission, type EmployeeGrant } from "@/core/access";
import { db, type DbExecutor } from "@/db/client";
import {
  AI_CANDIDATE_SOURCES,
  aiUsageLog,
  type AiCandidateRef,
  type AiSuggestionStatus,
} from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { containsCandidate } from "./candidates";
import { AiDecisionError, AiRequestRejectedError } from "./errors";
import { AI_FEATURES, getFeatureDefinition } from "./features";
import {
  AI_DECISIONS,
  type AiDecision,
  type AiDecisionOptions,
  type RecordDecision,
  type RecordDecisionIn,
} from "./types";
import { loadRejectedRetentionYears, retainUntilFor } from "./retention";
import {
  AI_USAGE_RETENTION_YEARS,
  lockTarget,
  recordStatusChange,
  sameTargetWhere,
} from "./usage-log";

/*
 * Registrer hva den ansatte gjorde med et KI-forslag (docs/funksjoner/fase2a-ki-modul-logg.md
 * Omfang 4, A162). Hvem som avgjorde, kommer bare fra `grant`. Rettigheten hentes fra funksjonen
 * på raden. Virker også når KI er av.
 *
 * Rekkefølgen for tilgang (docs/funksjoner/fase2a-forslagsmonster.md Omfang 7):
 * 1. Før noe leses: uten rettigheten til minst én KI-funksjon gir `AccessDeniedError`, også for
 *    ugyldig og ukjent id.
 * 2. Etter lesing: manglende rettighet for akkurat funksjonen på raden gir samme nøytrale avslag
 *    som «finnes ikke», så svaret ikke røper hva raden gjelder.
 * Ved avslag endres verken raden eller `audit_log`. Admin har alle rettigheter.
 *
 * Rangerte kandidater (`phrase_suggest`, A432): på en rad med `candidate_refs` krever `accepted`
 * en kandidat fra den lagrede listen, og den lagres i `chosen_candidate`. `edited` er ikke lov
 * (teksten er kildens egen). `rejected` (lukket liste) og `undo` tømmer `chosen_candidate`. En
 * kandidat på en rad uten `candidate_refs` er ikke lov.
 *
 * `recordDecisionIn` gjør det samme i kallerens transaksjon (A469). Kalleren har låst rapportraden
 * (eller rommet) først; her tas KI-låsen på målet etterpå. Aldri motsatt rekkefølge.
 */

/** Om `grant` har rettigheten til minst én KI-funksjon. */
function hasAnyAiPermission(grant: EmployeeGrant): boolean {
  return Object.values(AI_FEATURES).some((definition) =>
    grantHasPermission(grant, definition.permission),
  );
}

type Transition = { kind: "change"; to: AiSuggestionStatus } | { kind: "none" } | { kind: "error" };

/** Tabellen over lovlige endringer. Alt som ikke står her, er feil. */
function transitionFor(from: AiSuggestionStatus, decision: AiDecision): Transition {
  if (from === "suggested") {
    return decision === "undo" ? { kind: "error" } : { kind: "change", to: decision };
  }
  if (decision === "undo") return { kind: "change", to: "suggested" };
  if (decision === from) return { kind: "none" };
  return { kind: "error" };
}

function isDecision(value: unknown): value is AiDecision {
  return typeof value === "string" && (AI_DECISIONS as readonly string[]).includes(value);
}

/** Valgt kandidat i riktig form: kjent kilde og id som er en UUID. Ellers `null`. */
function parseCandidate(value: unknown): AiCandidateRef | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const { source, id, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return null;
  if (typeof source !== "string" || !(AI_CANDIDATE_SOURCES as readonly string[]).includes(source)) {
    return null;
  }
  if (typeof id !== "string" || !isUuid(id)) return null;
  return { source: source as AiCandidateRef["source"], id: id.toLowerCase() };
}

function sameCandidate(a: AiCandidateRef | null, b: AiCandidateRef | null): boolean {
  if (a === null || b === null) return a === b;
  return a.source === b.source && a.id.toLowerCase() === b.id.toLowerCase();
}

export const recordDecisionIn: RecordDecisionIn = async (
  tx: DbExecutor,
  grant: EmployeeGrant,
  usageId: string,
  decision: AiDecision,
  options?: AiDecisionOptions,
) => {
  if (!hasAnyAiPermission(grant)) throw new AccessDeniedError();
  if (typeof usageId !== "string" || !isUuid(usageId) || !isDecision(decision)) {
    throw new AiRequestRejectedError();
  }
  const rawCandidate = options?.candidate;
  const candidate = rawCandidate === undefined ? null : parseCandidate(rawCandidate);
  if (rawCandidate !== undefined && candidate === null) throw new AiRequestRejectedError();

  const ownRow = and(
    eq(aiUsageLog.id, usageId.toLowerCase()),
    eq(aiUsageLog.organizationId, grant.organizationId),
    isNull(aiUsageLog.deletedAt),
  );
  const [found] = await tx
    .select({
      feature: aiUsageLog.feature,
      targetRef: aiUsageLog.targetRef,
    })
    .from(aiUsageLog)
    .where(ownRow);
  if (!found) throw new AiRequestRejectedError();

  const definition = getFeatureDefinition(found.feature);
  if (!definition) throw new AiRequestRejectedError();
  if (!grantHasPermission(grant, definition.permission)) throw new AiRequestRejectedError();

  // Samme lås som nytt forslag på samme mål, så angre og nytt forslag ikke krysser hverandre
  await lockTarget(tx, grant.organizationId, found.feature, found.targetRef);
  const [row] = await tx
    .select({
      id: aiUsageLog.id,
      outcome: aiUsageLog.outcome,
      status: aiUsageLog.status,
      createdAt: aiUsageLog.createdAt,
      candidateRefs: aiUsageLog.candidateRefs,
      chosenCandidate: aiUsageLog.chosenCandidate,
    })
    .from(aiUsageLog)
    .where(ownRow)
    .for("update");
  if (!row) throw new AiRequestRejectedError();
  // En sperret forespørsel (ad-1) er ikke et forslag og kan aldri avgjøres. Det samme gjelder et
  // stoppet svar (`stopped`), ingen treff og feil.
  if (row.outcome === "blocked") throw new AiDecisionError();
  if (row.outcome !== "ok" || row.status === null) throw new AiDecisionError();

  // Rangerte kandidater: valgt kandidat bare ved `accepted`, og bare blant de viste
  const ranked = row.candidateRefs !== null;
  if (!ranked && candidate !== null) throw new AiDecisionError();
  if (ranked) {
    if (decision === "edited") throw new AiDecisionError();
    if (decision === "accepted") {
      if (candidate === null || !containsCandidate(row.candidateRefs, candidate)) {
        throw new AiDecisionError();
      }
    } else if (candidate !== null) {
      throw new AiDecisionError();
    }
  }

  const transition = transitionFor(row.status, decision);
  if (transition.kind === "none") {
    // Samme valg på nytt er uendret; et annet valg på en godtatt rad er ikke lov
    if (ranked && decision === "accepted" && !sameCandidate(row.chosenCandidate, candidate)) {
      throw new AiDecisionError();
    }
    return;
  }
  if (transition.kind === "error") throw new AiDecisionError();

  // Avklaring D: angre fra avvist er feil når det finnes et nyere forslag på samme mål
  if (decision === "undo" && row.status === "rejected") {
    const [newer] = await tx
      .select({ id: aiUsageLog.id })
      .from(aiUsageLog)
      .where(
        and(
          sameTargetWhere(grant.organizationId, found.feature, found.targetRef),
          eq(aiUsageLog.outcome, "ok"),
          ne(aiUsageLog.id, row.id),
          gt(aiUsageLog.createdAt, row.createdAt),
        ),
      )
      .limit(1);
    if (newer) throw new AiDecisionError();
  }

  const undo = transition.to === "suggested";
  // Oppbevaringstiden følger ny status (K7): innstillingen for avviste, ellers 10 år
  const rejectedYears =
    transition.to === "rejected"
      ? await loadRejectedRetentionYears(tx, grant.organizationId)
      : AI_USAGE_RETENTION_YEARS;
  const [updated] = await tx
    .update(aiUsageLog)
    .set({
      status: transition.to,
      chosenCandidate: transition.to === "accepted" && ranked ? candidate : null,
      retainUntil: retainUntilFor(transition.to, row.createdAt, rejectedYears),
      decidedBy: undo ? null : grant.employeeId,
      decidedAt: undo ? null : new Date(),
      updatedBy: grant.employeeId,
    })
    .where(ownRow)
    .returning({ id: aiUsageLog.id });
  if (!updated) throw new AiRequestRejectedError();
  await recordStatusChange(tx, grant, updated.id, row.status, transition.to);
};

/** Registrerer beslutningen i egen transaksjon. Samme kontroller som `recordDecisionIn`. */
export const recordDecision: RecordDecision = async (grant, usageId, decision, options) => {
  // Rettigheten sjekkes før transaksjonen åpnes, som før
  if (!hasAnyAiPermission(grant)) throw new AccessDeniedError();
  await db.transaction((tx) => recordDecisionIn(tx, grant, usageId, decision, options));
};
