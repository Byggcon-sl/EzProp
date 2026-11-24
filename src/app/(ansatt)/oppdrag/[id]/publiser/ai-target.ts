import type { ReportFieldChange, RoomReportView, TgiuFieldChange } from "@/core/reports/types";
import type { AiTargetRef } from "@/db/schema";

/*
 * Feltet et KI-forslag gjelder, slått opp i rommet slik serveren leser det (F4,
 * docs/funksjoner/fase2a-publisering-badet-design.md avsnitt 9). Ren funksjon over rommets
 * visning: gir teksten som står i feltet nå («Din tekst» i forslagskortet), feltets navn, og
 * endringen «Bruk» lagrer med de samme skrivetjenestene som rommet (`saveField`), med nåverdien
 * som `base`. Ingen KI-kall og ingen tilgang her; serverhandlingen sjekker tilgangen i kjernen.
 * Støtter hovedmål: KI i bunnen (forslaget behandles der mangelen vises) og færre reklamasjoner
 * (teksten kommer bare inn når den ansatte trykker «Bruk»).
 */

type StartedRoom = Extract<RoomReportView, { state: "started" }>;

/** Navnene på feltene KI kan skrive i (`REPORT_AI_TARGET_FIELDS`). */
const FIELD_LABELS: Record<string, string> = {
  deviation_text: "Avviksbeskrivelse",
  cause_text: "Årsak",
  consequence_text: "Konsekvens",
  text: "Tiltak",
  description_text: "Beskrivelse av punktet",
  reason: "Hva er ikke undersøkt, og hvorfor?",
  risk_assessment: "Risiko",
  how_to_examine: "Hva må til for å undersøke?",
};

export type AiFieldTarget = {
  /** Teksten i feltet nå. Tom tekst når feltet er tomt. */
  currentText: string;
  /** Feltets navn til visning. */
  label: string;
  /** Endringen som lagrer `text` i feltet med nåverdien som `base`. */
  change: (text: string) => ReportFieldChange;
};

const TGIU_FIELDS = ["reason", "risk_assessment", "how_to_examine"] as const;
type TgiuTextField = (typeof TGIU_FIELDS)[number];
const DEVIATION_FIELDS = ["deviation_text", "cause_text", "consequence_text"] as const;
type DeviationTextField = (typeof DEVIATION_FIELDS)[number];

function isOneOf<T extends string>(list: readonly T[], value: string): value is T {
  return (list as readonly string[]).includes(value);
}

/** Feltet i rommet, eller `null` når målet ikke finnes der (slettet, eller et annet rom). */
export function aiFieldTarget(room: StartedRoom, field: AiTargetRef): AiFieldTarget | null {
  const { type, id, fieldKey } = field;
  const label = FIELD_LABELS[fieldKey] ?? fieldKey;

  if (type === "deviation" && isOneOf(DEVIATION_FIELDS, fieldKey)) {
    for (const checkpoint of room.checkpoints) {
      const deviation = checkpoint.deviations.find((d) => d.id === id);
      if (!deviation) continue;
      const key: Record<DeviationTextField, string | null> = {
        deviation_text: deviation.deviationText,
        cause_text: deviation.causeText,
        consequence_text: deviation.consequenceText,
      };
      const base = key[fieldKey];
      return {
        currentText: base ?? "",
        label,
        change: (text) => ({ table: "deviations", id, field: fieldKey, value: text, base }),
      };
    }
    return null;
  }

  if (type === "deviation_measure" && fieldKey === "text") {
    for (const checkpoint of room.checkpoints) {
      for (const deviation of checkpoint.deviations) {
        const measure = deviation.measures.find((m) => m.id === id);
        if (!measure) continue;
        const base = measure.text;
        return {
          currentText: base,
          label,
          change: (text) => ({ table: "deviation_measures", id, field: "text", value: text, base }),
        };
      }
    }
    return null;
  }

  if (type === "checkpoint_result" && fieldKey === "description_text") {
    const checkpoint = room.checkpoints.find((c) => c.resultId === id);
    if (!checkpoint) return null;
    const base = checkpoint.descriptionText;
    return {
      currentText: base ?? "",
      label,
      change: (text) => ({
        table: "checkpoint_results",
        checkpointKey: checkpoint.checkpointKey,
        field: "description_text",
        value: text,
        base,
      }),
    };
  }

  if (type === "tgiu_detail" && isOneOf(TGIU_FIELDS, fieldKey)) {
    const checkpoint = room.checkpoints.find((c) => c.tgiuDetails?.id === id);
    const details = checkpoint?.tgiuDetails;
    if (!checkpoint || !details) return null;
    const values: Record<TgiuTextField, string | null> = {
      reason: details.reason,
      risk_assessment: details.riskAssessment,
      how_to_examine: details.howToExamine,
    };
    const base = values[fieldKey];
    return {
      currentText: base ?? "",
      label,
      change: (text): TgiuFieldChange => ({
        table: "tgiu_details",
        checkpointKey: checkpoint.checkpointKey,
        field: fieldKey,
        value: text,
        base,
      }),
    };
  }

  if (type === "field_answer") {
    const answer = room.answers.find((a) => a.id === id);
    if (!answer || answer.elementKey !== fieldKey) return null;
    const element = room.document.elements.find((e) => e.key === answer.elementKey);
    return {
      currentText: answer.value.text ?? "",
      label: element?.label ?? label,
      change: (text) => ({
        table: "field_answers",
        id: answer.id,
        elementKey: answer.elementKey,
        field: "value",
        value: { ...answer.value, text },
        base: answer.value,
      }),
    };
  }

  return null;
}
