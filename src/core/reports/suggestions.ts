import { and, desc, eq } from "drizzle-orm";
import { AccessDeniedError } from "@/core/access";
import type { RuleResult } from "@/core/rules";
import {
  ruleSuggestionDecisions,
  type ChosenTg,
  type DeviationTg,
  type RuleSuggestionDecisionRow,
} from "@/db/schema";
import { uuidv7 } from "@/shared/lib/uuid";
import { inspectionYearOf, requireUuid } from "./context";
import { createDeviationFromOutcome, requireOutcome } from "./deviations";
import { ReportValidationError } from "./errors";
import { suggestionStillApplies } from "./logic";
import { evaluateRoomRules, loadRoomData, roomRules, ruleAnswersOf } from "./room-view";
import {
  decideSuggestionInputSchema,
  overrideReasonSchema,
  parseOrThrow,
  ruleResultSchema,
} from "./schemas";
import { applyDirectTg } from "./tgiu";
import type { DecideSuggestion, DecideSuggestionResult } from "./types";
import {
  auditReport,
  ensureCheckpointResult,
  refreshOf,
  withRoomWrite,
  type WriteScope,
} from "./write";

/*
 * Godta, Endre og Avvis på et regelforslag (docs/funksjoner/fase2a-badet-pc.md Omfang 4, ADR 0013
 * 9–12b). Serveren stoler aldri på klienten: den kjører reglene på lagrede svar og lagrer sitt eget
 * regelsvar. Hver beslutning er en ny rad i `rule_suggestion_decisions`, som aldri endres.
 * Regelsvar er ikke KI og går aldri gjennom `src/core/ai`. Reglene setter aldri TG selv: TG settes
 * bare når takstmannen godtar eller endrer.
 */

/** Målingen regelen slo til på (fuktregelen), så den følger med avviket. */
function measurementOf(result: RuleResult): { value: number; unit: string | null } | null {
  for (const reason of result.reasons) {
    if (reason.type === "number_vs_limit" && reason.truth === "true" && reason.value !== null) {
      return { value: reason.value, unit: reason.unit };
    }
  }
  return null;
}

async function findDecision(scope: WriteScope, id: string) {
  const [row] = await scope.tx
    .select()
    .from(ruleSuggestionDecisions)
    .where(
      and(
        eq(ruleSuggestionDecisions.organizationId, scope.orgId),
        eq(ruleSuggestionDecisions.reportId, scope.reportId),
        eq(ruleSuggestionDecisions.id, id),
      ),
    );
  return row ?? null;
}

async function latestDecisionFor(scope: WriteScope, checkpointResultId: string, ruleKey: string) {
  const [row] = await scope.tx
    .select()
    .from(ruleSuggestionDecisions)
    .where(
      and(
        eq(ruleSuggestionDecisions.organizationId, scope.orgId),
        eq(ruleSuggestionDecisions.reportId, scope.reportId),
        eq(ruleSuggestionDecisions.checkpointResultId, checkpointResultId),
        eq(ruleSuggestionDecisions.ruleKey, ruleKey),
      ),
    )
    .orderBy(desc(ruleSuggestionDecisions.decidedAt), desc(ruleSuggestionDecisions.id))
    .limit(1);
  return row ?? null;
}

const TG_TEXT: Record<DeviationTg, ChosenTg> = { 2: "2", 3: "3" };

/**
 * Godtar, endrer eller avviser et regelforslag (`report.edit`). Se `DecideSuggestion` i `./types`.
 */
export const decideSuggestion: DecideSuggestion = (actor, organizationId, room, input) =>
  withRoomWrite(actor, organizationId, room, async (scope): Promise<DecideSuggestionResult> => {
    requireUuid(input?.id);
    if (input && "deviationId" in input && input.deviationId !== undefined) {
      requireUuid(input.deviationId);
    }
    const values = parseOrThrow(decideSuggestionInputSchema, input);
    const reason = parseOrThrow(
      overrideReasonSchema,
      {
        decision: values.decision,
        overrideReasonCode: values.overrideReasonCode,
        overrideReason: values.overrideReason,
      },
      "override_reason",
    );

    // Regelen må finnes i rapportens låste malversjon og gjelde et punkt i rommet
    const rule = roomRules(scope.template.document, scope.roomDoc).find(
      (r) => r.key === values.ruleKey,
    );
    const ruleId = scope.template.ruleIdByKey.get(values.ruleKey);
    if (!rule || !ruleId) throw new ReportValidationError("unknown_key");

    // Samme beslutnings-id to ganger (dobbelt trykk): samme svar, ingen ny rad
    const repeated = await findDecision(scope, values.id);
    if (repeated) {
      return {
        status: "saved",
        decisionId: repeated.id,
        deviationId: repeated.deviationId,
        refresh: await refreshOf(scope),
      };
    }

    // Serveren regner forslaget selv, på lagrede svar
    const inspectionYear = inspectionYearOf(scope.context.inspectionAt, scope.now).year;
    const data = await loadRoomData(scope.tx, scope.orgId, scope.reportId, scope.context.room.id);
    const results = evaluateRoomRules(
      scope.template,
      scope.roomDoc,
      ruleAnswersOf(scope.template, data.answers),
      inspectionYear,
    );
    const result = results.find((r) => r.rule_key === values.ruleKey);
    if (!result || result.state !== "triggered" || result.suggestion === null) {
      return { status: "no_longer_applies", refresh: await refreshOf(scope) };
    }
    const stored = ruleResultSchema.safeParse(result);
    // Regelsvaret er serverens eget; et svar som ikke passer skjemaet lagres aldri
    if (!stored.success) throw new ReportValidationError("invalid_input");
    const suggestion = stored.data.suggestion;
    if (suggestion === null)
      return { status: "no_longer_applies", refresh: await refreshOf(scope) };
    const checkpointKey = suggestion.checkpoint_key;
    const checkpointResult = await ensureCheckpointResult(scope, checkpointKey);

    let deviationId: string | null = null;
    let chosenTg: ChosenTg | null = null;
    let chosenOutcomeKey: string | null = null;

    if (values.decision === "accepted") {
      if (suggestion.kind === "outcome") {
        // Godta to ganger på samme forslag gir ett avvik: forslaget er alt godtatt, og avviket står
        const latest = await latestDecisionFor(scope, checkpointResult.id, values.ruleKey);
        if (latest && alreadyAccepted(latest, data.deviations, results)) {
          return {
            status: "saved",
            decisionId: latest.id,
            deviationId: latest.deviationId,
            refresh: await refreshOf(scope),
          };
        }
        const created = await createDeviationFromOutcome(scope, {
          id: values.deviationId ?? uuidv7(),
          checkpointKey,
          questionKey: suggestion.question_key,
          outcomeKey: suggestion.outcome_key,
          tg: values.chosenTg ?? null,
          tgiuChoice: values.tgiuChoice,
          suggestedByRuleId: ruleId,
          measurement: measurementOf(result),
        });
        if (created.status === "tgiu_conflict") return { status: "tgiu_conflict" };
        deviationId = created.deviation.id;
        chosenTg = created.deviation.tg === null ? null : TG_TEXT[created.deviation.tg];
        chosenOutcomeKey = suggestion.outcome_key;
      } else {
        if (values.chosenTg !== undefined || values.deviationId !== undefined) {
          throw new ReportValidationError("invalid_choice");
        }
        const target = suggestion.kind === "tgiu" ? "IU" : "0";
        const applied = await applyDirectTg(
          scope,
          checkpointResult,
          target,
          values.tgDeviationChoice,
        );
        if (applied === "conflict") return { status: "tgiu_conflicts_with_deviation" };
        chosenTg = target;
      }
    } else if (values.decision === "changed") {
      if (values.chosenTg === "2" || values.chosenTg === "3") {
        const tg: DeviationTg = values.chosenTg === "2" ? 2 : 3;
        const target =
          values.chosenOutcome ??
          (suggestion.kind === "outcome"
            ? { questionKey: suggestion.question_key, outcomeKey: suggestion.outcome_key }
            : null);
        if (target === null) throw new ReportValidationError("invalid_choice");
        const { outcomeTg } = requireOutcome(
          scope,
          checkpointKey,
          target.questionKey,
          target.outcomeKey,
        );
        if (outcomeTg === null) throw new ReportValidationError("invalid_choice");
        const sameOutcome =
          suggestion.kind === "outcome" &&
          suggestion.question_key === target.questionKey &&
          suggestion.outcome_key === target.outcomeKey;
        // Endre må gå bort fra forslaget: annet utfall, eller annen TG enn utfallets faste.
        // Ved «velg TG2 eller TG3» er valget av TG selve endringen (T-0060, B4.21).
        if (sameOutcome && outcomeTg === tg) {
          throw new ReportValidationError("invalid_choice");
        }
        const created = await createDeviationFromOutcome(scope, {
          id: values.deviationId ?? uuidv7(),
          checkpointKey,
          questionKey: target.questionKey,
          outcomeKey: target.outcomeKey,
          tg,
          allowOtherTg: true,
          tgiuChoice: values.tgiuChoice,
          suggestedByRuleId: ruleId,
          measurement: sameOutcome ? measurementOf(result) : null,
        });
        if (created.status === "tgiu_conflict") return { status: "tgiu_conflict" };
        deviationId = created.deviation.id;
        chosenTg = values.chosenTg;
        chosenOutcomeKey = target.outcomeKey;
      } else {
        if (values.chosenOutcome !== undefined || values.deviationId !== undefined) {
          throw new ReportValidationError("invalid_choice");
        }
        const same =
          (suggestion.kind === "tgiu" && values.chosenTg === "IU") ||
          (suggestion.kind === "tg0" && values.chosenTg === "0");
        if (same) throw new ReportValidationError("invalid_choice");
        const applied = await applyDirectTg(
          scope,
          checkpointResult,
          values.chosenTg,
          values.tgDeviationChoice,
        );
        if (applied === "conflict") return { status: "tgiu_conflicts_with_deviation" };
        chosenTg = values.chosenTg;
      }
    }

    const [inserted] = await scope.tx
      .insert(ruleSuggestionDecisions)
      .values({
        id: values.id,
        organizationId: scope.orgId,
        reportId: scope.reportId,
        checkpointResultId: checkpointResult.id,
        ruleKey: values.ruleKey,
        suggestion,
        reasons: stored.data.reasons,
        lifespanSetKey: stored.data.lifespan_set_key,
        thresholdSetKey: stored.data.threshold_set_key,
        inspectionYear,
        decision: values.decision,
        chosenTg,
        chosenOutcomeKey,
        overrideReasonCode: reason.overrideReasonCode,
        overrideReason: reason.overrideReason,
        deviationId,
        decidedBy: scope.grant.employeeId,
        decidedAt: scope.now,
        createdBy: scope.grant.employeeId,
      })
      .onConflictDoNothing()
      .returning({ id: ruleSuggestionDecisions.id });
    // Id-en finnes i en annen organisasjon eller rapport: 404, og ingenting er lagret
    if (!inserted) throw new AccessDeniedError();

    // Bare koder, id-er og TG. Aldri begrunnelsesteksten.
    await auditReport(scope, "rule_suggestion_decision", inserted.id, values.decision, {
      ruleKey: values.ruleKey,
      checkpointKey,
      suggestionKind: suggestion.kind,
      chosenTg,
      chosenOutcomeKey,
      overrideReasonCode: reason.overrideReasonCode,
      deviationId,
      inspectionYear,
    });
    return {
      status: "saved",
      decisionId: inserted.id,
      deviationId,
      refresh: await refreshOf(scope),
    };
  });

/**
 * Om forslaget alt er godtatt og avviket står: siste beslutning er `accepted`, avviket er ikke
 * fjernet, og regelen gir samme forslag nå.
 */
function alreadyAccepted(
  latest: RuleSuggestionDecisionRow,
  liveDeviations: readonly { id: string }[],
  results: readonly RuleResult[],
): boolean {
  if (latest.decision !== "accepted" || latest.deviationId === null) return false;
  if (!liveDeviations.some((d) => d.id === latest.deviationId)) return false;
  return suggestionStillApplies(
    {
      ruleKey: latest.ruleKey,
      decision: latest.decision,
      suggestion: latest.suggestion,
      chosenTg: latest.chosenTg,
      madeDeviation: true,
      deviationId: latest.deviationId,
    },
    results,
  );
}
