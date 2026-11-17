import { REPORT_SNAPSHOT_SCHEMA_VERSION, type FieldAnswer } from "@/db/schema";
import { computeCheckpointTg, type CheckpointTg } from "./logic";
import type {
  PublishPreviewRoom,
  ReportSnapshot,
  SnapshotAiMark,
  SnapshotAnswer,
  SnapshotBuilding,
  SnapshotCheckpoint,
  SnapshotDeviation,
  SnapshotFloor,
  SnapshotRoom,
  SnapshotRuleDecision,
} from "./publish-types";
import type { PublishRoomSource, PublishSource, ReportAiRow } from "./signals";

/*
 * Snapshot av rapporten i en utgivelse (ADR 0015 punkt 13, A452): en selvstendig kopi av det som
 * publiseres, ikke pekere. Bygges bare av lagrede data som alt er lest med `grant.organizationId`.
 *
 * Aldri med: parter, navn på personer, e-post, telefon, adresse, matrikkel, reklamasjonsdata,
 * KI-forslag som venter eller er avvist, slettede rader og begrunnelser i fritekst. Snapshot
 * logges aldri. «Dette publiseres» bygges av samme snapshot, så det den ansatte ser, er det som
 * lagres.
 */

// --- KI-merking --------------------------------------------------------------------------------

type AiMarks = {
  /** Merket for et tekstfelt: `type|id|felt`. */
  field: (type: string, id: string, fieldKey: string) => SnapshotAiMark | null;
  /** Merket for et svar med `field_answers.ai_usage_id`. */
  answer: (usageId: string | null) => SnapshotAiMark | null;
};

function markOf(row: ReportAiRow | undefined): SnapshotAiMark | null {
  if (!row || (row.status !== "accepted" && row.status !== "edited")) return null;
  return { ai_usage_id: row.id, status: row.status };
}

/**
 * Merkene fra `ai_usage_log`, som er eneste fasit for om en tekst kom fra KI (A355). Per felt
 * gjelder siste avgjørelse (godtatt, endret eller avvist); bare godtatt og endret gir merke.
 * Forslag som venter, gir aldri merke, og forslagsteksten tas aldri med.
 */
function aiMarksOf(rows: readonly ReportAiRow[]): AiMarks {
  const latestByField = new Map<string, ReportAiRow>();
  const byId = new Map<string, ReportAiRow>();
  const decided = rows
    .filter((row) => row.status !== "suggested")
    .sort(
      (a, b) =>
        (a.decidedAt ?? a.createdAt).getTime() - (b.decidedAt ?? b.createdAt).getTime() ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  for (const row of decided) {
    byId.set(row.id, row);
    const { type, id, fieldKey } = row.targetRef;
    latestByField.set(`${type}|${id}|${fieldKey}`, row);
  }
  return {
    field: (type, id, fieldKey) => markOf(latestByField.get(`${type}|${id}|${fieldKey}`)),
    answer: (usageId) => (usageId ? markOf(byId.get(usageId)) : null),
  };
}

function marksFor<K extends string>(
  marks: AiMarks,
  type: string,
  id: string,
  fields: readonly K[],
): Partial<Record<K, SnapshotAiMark>> {
  const result: Partial<Record<K, SnapshotAiMark>> = {};
  for (const field of fields) {
    const mark = marks.field(type, id, field);
    if (mark) result[field] = mark;
  }
  return result;
}

// --- Rapportens deler --------------------------------------------------------------------------

function hasValue(answer: FieldAnswer): boolean {
  return (
    (answer.valueText !== null && answer.valueText.trim() !== "") ||
    answer.valueNumber !== null ||
    (answer.valueOptionKeys !== null && answer.valueOptionKeys.length > 0)
  );
}

function snapshotAnswers(
  source: PublishSource,
  answers: readonly FieldAnswer[],
  marks: AiMarks,
): SnapshotAnswer[] {
  const { template } = source;
  const result: SnapshotAnswer[] = [];
  for (const answer of answers) {
    if (!hasValue(answer)) continue;
    const elementKey = template.elementKeyById.get(answer.elementId);
    const element = template.document.elements.find((e) => e.key === elementKey);
    if (!elementKey || !element) continue;
    const optionKeys = answer.valueOptionKeys;
    result.push({
      element_key: elementKey,
      label: element.label,
      value_text: answer.valueText,
      value_number: answer.valueNumber,
      value_option_keys: optionKeys,
      value_option_labels: optionKeys
        ? optionKeys.map(
            (key) =>
              template.document.element_options.find(
                (o) => o.element_key === elementKey && o.key === key,
              )?.label ?? key,
          )
        : null,
      ai: marks.answer(answer.aiUsageId),
    });
  }
  return result.sort((a, b) => elementOrder(source, a.element_key, b.element_key));
}

function elementOrder(source: PublishSource, a: string, b: string): number {
  const elements = source.template.document.elements;
  const ia = elements.findIndex((e) => e.key === a);
  const ib = elements.findIndex((e) => e.key === b);
  return ia - ib || (a < b ? -1 : a > b ? 1 : 0);
}

function snapshotRoom(
  source: PublishSource,
  room: PublishRoomSource,
  marks: AiMarks,
): SnapshotRoom {
  const { template } = source;
  const stateByKey = new Map(room.state.checkpointStates.map((c) => [c.checkpointKey, c.state]));
  const checkpointKeys = new Set(room.roomDoc.checkpoints.map((c) => c.key));
  const elementCheckpoint = new Map(
    template.document.elements.map((e) => [e.key, e.checkpoint_key] as const),
  );
  const answerCheckpointKey = (answer: FieldAnswer): string | null => {
    const elementKey = template.elementKeyById.get(answer.elementId);
    const key = elementKey ? (elementCheckpoint.get(elementKey) ?? null) : null;
    return key && checkpointKeys.has(key) ? key : null;
  };

  const checkpoints: SnapshotCheckpoint[] = [];
  for (const checkpoint of room.roomDoc.checkpoints) {
    const checkpointId = template.checkpointIdByKey.get(checkpoint.key);
    const state = stateByKey.get(checkpoint.key);
    if (!checkpointId || !state) continue;
    const result = room.data.results.find((r) => r.checkpointId === checkpointId) ?? null;
    const deviationRows = result
      ? room.data.deviations.filter((d) => d.checkpointResultId === result.id)
      : [];
    const tgiuRow = result
      ? (room.data.tgiu.find((t) => t.checkpointResultId === result.id) ?? null)
      : null;

    const deviations: SnapshotDeviation[] = deviationRows.map((row) => ({
      id: row.id,
      kind: row.kind,
      tg: row.tg,
      question_key: row.deviationQuestionId
        ? (template.questionRefById.get(row.deviationQuestionId)?.questionKey ?? null)
        : null,
      outcome_key: row.outcomeId
        ? (template.outcomeRefById.get(row.outcomeId)?.outcomeKey ?? null)
        : null,
      deviation_text: row.deviationText,
      cause_criterion: row.causeCriterion,
      cause_text: row.causeText,
      consequence_text: row.consequenceText,
      cost: {
        type: row.costType,
        band_key: row.costBandKey,
        amount: row.costAmount,
        text: row.costText,
      },
      measurement_value: row.measurementValue,
      measurement_unit: row.measurementUnit,
      text_source: row.textSource,
      suggested_by_rule_key: row.suggestedByRuleId
        ? (template.ruleKeyById.get(row.suggestedByRuleId) ?? null)
        : null,
      measures: room.data.measures
        .filter((m) => m.deviationId === row.id)
        .map((m) => ({
          id: m.id,
          text: m.text,
          text_source: m.textSource,
          ai: marks.field("deviation_measure", m.id, "text"),
        })),
      ai: marksFor(marks, "deviation", row.id, [
        "deviation_text",
        "cause_text",
        "consequence_text",
      ] as const),
    }));

    // Siste beslutning per regel (radene er sortert eldst først). Fritekstbegrunnelsen tas ikke med.
    const latestDecision = new Map<string, SnapshotRuleDecision>();
    if (result) {
      for (const row of room.data.decisions) {
        if (row.checkpointResultId !== result.id) continue;
        latestDecision.set(row.ruleKey, {
          rule_key: row.ruleKey,
          decision: row.decision,
          chosen_tg: row.chosenTg,
          chosen_outcome_key: row.chosenOutcomeKey,
          override_reason_code: row.overrideReasonCode,
          decided_at: row.decidedAt.toISOString(),
        });
      }
    }

    checkpoints.push({
      checkpoint_id: checkpointId,
      checkpoint_key: checkpoint.key,
      label: checkpoint.name,
      tg: computeCheckpointTg(state),
      tg_direct: result?.tgDirect ?? null,
      done: result?.done ?? false,
      description_text: result?.descriptionText ?? null,
      description_ai: result
        ? marks.field("checkpoint_result", result.id, "description_text")
        : null,
      answers: snapshotAnswers(
        source,
        room.data.answers.filter((a) => answerCheckpointKey(a) === checkpoint.key),
        marks,
      ),
      deviations,
      tgiu: tgiuRow
        ? {
            reason: tgiuRow.reason,
            owner_informed: tgiuRow.ownerInformed,
            owner_informed_at: tgiuRow.ownerInformedAt?.toISOString() ?? null,
            alternative_check_method: tgiuRow.alternativeCheckMethod,
            alternative_check_result: tgiuRow.alternativeCheckResult,
            risk_assessment: tgiuRow.riskAssessment,
            construction_vulnerable: tgiuRow.constructionVulnerable,
            how_to_examine: tgiuRow.howToExamine,
            ai: marksFor(marks, "tgiu_detail", tgiuRow.id, [
              "reason",
              "risk_assessment",
              "how_to_examine",
            ] as const),
          }
        : null,
      rule_decisions: [...latestDecision.values()].sort((a, b) =>
        a.rule_key < b.rule_key ? -1 : a.rule_key > b.rule_key ? 1 : 0,
      ),
    });
  }

  return {
    room_id: room.roomId,
    name: room.name,
    room_type: room.roomType,
    answers: snapshotAnswers(
      source,
      room.data.answers.filter((a) => answerCheckpointKey(a) === null),
      marks,
    ),
    checkpoints,
  };
}

/**
 * Snapshot av rapporten (`schema_version` 1). Bygninger, etasjer og rom i rapportens rekkefølge;
 * bare våtrommene nå. Befaringsdatoen er `null` når sperren ble krysset bort.
 */
export function buildReportSnapshot(source: PublishSource): ReportSnapshot {
  const marks = aiMarksOf(source.aiRows);
  const buildings: SnapshotBuilding[] = [];
  for (const room of source.rooms) {
    let building = buildings.find((b) => b.report_building_id === room.building.id);
    if (!building) {
      building = { report_building_id: room.building.id, name: room.building.name, floors: [] };
      buildings.push(building);
    }
    let floor: SnapshotFloor | undefined = building.floors.find(
      (f) => f.floor_id === room.floor.id,
    );
    if (!floor) {
      floor = { floor_id: room.floor.id, name: room.floor.name, rooms: [] };
      building.floors.push(floor);
    }
    floor.rooms.push(snapshotRoom(source, room, marks));
  }
  return {
    schema_version: REPORT_SNAPSHOT_SCHEMA_VERSION,
    report: {
      report_id: source.report.id,
      report_type: source.report.reportType,
      template_version_id: source.template.versionId,
      template_family_id: source.template.familyId,
      template_version_number: source.template.versionNumber,
      inspection_date: source.inspectionDate,
    },
    buildings,
  };
}

/**
 * «Dette publiseres» (F4): TG per rom og kostnaden på hvert TG3-avvik, bygget av snapshot, så
 * oppsummeringen alltid stemmer med det som lagres.
 */
export function buildPublishPreview(snapshot: ReportSnapshot): PublishPreviewRoom[] {
  const result: PublishPreviewRoom[] = [];
  for (const building of snapshot.buildings) {
    for (const floor of building.floors) {
      for (const room of floor.rooms) {
        const tgCounts: Record<CheckpointTg | "none", number> = {
          "0": 0,
          "1": 0,
          "2": 0,
          "3": 0,
          IU: 0,
          none: 0,
        };
        const tg3Costs: PublishPreviewRoom["tg3Costs"] = [];
        for (const checkpoint of room.checkpoints) {
          tgCounts[checkpoint.tg ?? "none"] += 1;
          for (const deviation of checkpoint.deviations) {
            if (deviation.kind === "tg" && deviation.tg === 3) {
              tg3Costs.push({
                type: deviation.cost.type,
                bandKey: deviation.cost.band_key,
                amount: deviation.cost.amount,
              });
            }
          }
        }
        result.push({
          roomId: room.room_id,
          roomName: room.name,
          roomType: room.room_type,
          tgCounts,
          tg3Costs,
        });
      }
    }
  }
  return result;
}
