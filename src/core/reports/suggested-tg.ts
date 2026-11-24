import { and, eq } from "drizzle-orm";
import { AccessDeniedError } from "@/core/access";
import { ruleSuggestionDecisions, type ChosenTg, type DeviationTg } from "@/db/schema";
import { requireUuid } from "./context";
import { requireOutcome } from "./deviations";
import { ReportValidationError } from "./errors";
import { checkOverrideReason, suggestedTgChangeDecision } from "./logic";
import {
  effectiveDecisionForDeviation,
  requireLiveRoomDeviation,
  SUGGESTED_TG_REASON_MESSAGE,
  writeDeviationTg,
} from "./save-field";
import {
  changeSuggestedDeviationTgInputSchema,
  overrideReasonSchema,
  parseOrThrow,
} from "./schemas";
import type { ChangeSuggestedDeviationTg, ChangeSuggestedDeviationTgResult } from "./types";
import { auditReport, refreshOf, withRoomWrite } from "./write";

/*
 * TG-bytte på et avvik som kom fra et regelforslag (T-0113, A490, ADR 0013 punkt 10 og 12). Egen
 * handling, ikke lagring per felt: ny TG på avviket og en ny rad i `rule_suggestion_decisions`
 * lagres i samme transaksjon, slik at loggen alltid sier hvorfor graden er en annen enn forslaget.
 * Reglene kjøres ikke på nytt: regelsvaret kopieres fra raden som erstattes. Regler og KI setter
 * aldri TG; det gjør bare takstmannen her. Revisjonsloggen får koder, id-er og TG, aldri
 * begrunnelsesteksten.
 */

const TG_TEXT: Record<DeviationTg, ChosenTg> = { 2: "2", 3: "3" };

/** Bytter TG på et avvik fra et regelforslag (`report.edit`). Se `ChangeSuggestedDeviationTg`. */
export const changeSuggestedDeviationTg: ChangeSuggestedDeviationTg = (
  actor,
  organizationId,
  room,
  input,
) =>
  withRoomWrite(
    actor,
    organizationId,
    room,
    async (scope): Promise<ChangeSuggestedDeviationTgResult> => {
      // Id-er før Zod: ugyldig id gir 404 (B5.6)
      requireUuid(input?.id, input?.deviationId);
      const values = parseOrThrow(changeSuggestedDeviationTgInputSchema, input);

      // Samme beslutnings-id to ganger (dobbelt trykk): samme svar, ingen ny rad
      const [repeated] = await scope.tx
        .select({ id: ruleSuggestionDecisions.id })
        .from(ruleSuggestionDecisions)
        .where(
          and(
            eq(ruleSuggestionDecisions.organizationId, scope.orgId),
            eq(ruleSuggestionDecisions.reportId, scope.reportId),
            eq(ruleSuggestionDecisions.id, values.id),
          ),
        );
      if (repeated) {
        return { status: "saved", decisionId: repeated.id, refresh: await refreshOf(scope) };
      }

      const { deviation, result } = await requireLiveRoomDeviation(scope, values.deviationId);
      const current = await effectiveDecisionForDeviation(scope, deviation, result);
      // Avvik uten gjeldende beslutning bytter TG med lagring per felt
      if (!current) throw new ReportValidationError("not_applicable");

      if (deviation.tg !== values.base) {
        return { status: "conflict", current: deviation.tg, refresh: await refreshOf(scope) };
      }
      if (deviation.tg === values.tg) {
        return { status: "saved", decisionId: current.id, refresh: await refreshOf(scope) };
      }

      const ref = deviation.outcomeId
        ? scope.template.outcomeRefById.get(deviation.outcomeId)
        : undefined;
      const outcomeTg = ref
        ? requireOutcome(scope, ref.checkpointKey, ref.questionKey, ref.outcomeKey).outcomeTg
        : null;
      const decision = suggestedTgChangeDecision({
        suggestion: current.suggestion,
        questionKey: ref?.questionKey ?? null,
        outcomeKey: ref?.outcomeKey ?? null,
        outcomeTg,
        tg: values.tg,
      });

      // Grunnen: `changed` krever den, `accepted` skal ikke ha den (A380, A398)
      const check = checkOverrideReason({
        decision,
        code: values.overrideReasonCode ?? null,
        text: values.overrideReason ?? null,
      });
      if (check === "reason_required") {
        throw new ReportValidationError("override_reason", SUGGESTED_TG_REASON_MESSAGE);
      }
      const reason = parseOrThrow(
        overrideReasonSchema,
        {
          decision,
          overrideReasonCode: values.overrideReasonCode,
          overrideReason: values.overrideReason,
        },
        "override_reason",
      );

      // TG først, så raden: feiler noe, rulles begge tilbake (samme transaksjon)
      await writeDeviationTg(scope, deviation, result, values.tg);
      const chosenTg = values.tg === null ? null : TG_TEXT[values.tg];
      const chosenOutcomeKey = ref?.outcomeKey ?? null;
      const [inserted] = await scope.tx
        .insert(ruleSuggestionDecisions)
        .values({
          id: values.id,
          organizationId: scope.orgId,
          reportId: scope.reportId,
          checkpointResultId: current.checkpointResultId,
          ruleKey: current.ruleKey,
          // Regelsvaret fra raden som erstattes; reglene kjøres ikke på nytt (ADR 0013 punkt 10)
          suggestion: current.suggestion,
          reasons: current.reasons,
          lifespanSetKey: current.lifespanSetKey,
          thresholdSetKey: current.thresholdSetKey,
          inspectionYear: current.inspectionYear,
          decision,
          chosenTg,
          chosenOutcomeKey,
          overrideReasonCode: reason.overrideReasonCode,
          overrideReason: reason.overrideReason,
          deviationId: deviation.id,
          decidedBy: scope.grant.employeeId,
          decidedAt: scope.now,
          createdBy: scope.grant.employeeId,
        })
        .onConflictDoNothing()
        .returning({ id: ruleSuggestionDecisions.id });
      // Id-en finnes i en annen organisasjon eller rapport: 404, og ingenting er lagret
      if (!inserted) throw new AccessDeniedError();

      // Bare koder, id-er og TG. Aldri begrunnelsesteksten.
      await auditReport(scope, "rule_suggestion_decision", inserted.id, decision, {
        ruleKey: current.ruleKey,
        checkpointKey: current.suggestion.checkpoint_key,
        suggestionKind: current.suggestion.kind,
        deviationId: deviation.id,
        replacesDecisionId: current.id,
        fromTg: deviation.tg,
        toTg: values.tg,
        chosenTg,
        chosenOutcomeKey,
        overrideReasonCode: reason.overrideReasonCode,
        inspectionYear: current.inspectionYear,
      });
      return { status: "saved", decisionId: inserted.id, refresh: await refreshOf(scope) };
    },
  );
