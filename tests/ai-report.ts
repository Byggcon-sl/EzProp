import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { uuidv7 } from "@/shared/lib/uuid";
import type { AiTarget } from "./ai";
import {
  createAssignment,
  createCheckpointResultRow,
  createDeviationMeasureRow,
  createDeviationRow,
  createReportRow,
} from "./factories";

/*
 * Testhjelpere for «KI i veien» i kjernen (docs/funksjoner/fase2a-ki-i-veien-testplan.md avsnitt
 * 4d). Lager en rapport med ett kontrollpunktresultat, ett avvik og ett tiltak som rå rader, slik
 * at oppslaget av målet i `src/core/ai` kan prøves uten rapportkjernen. Alle verdier er oppdiktet.
 */

export type AiReportChain = {
  assignmentId: string;
  reportId: string;
  checkpointResultId: string;
  deviationId: string;
  measureId: string;
};

/** Oppdrag → rapport (draft) → kontrollpunktresultat → avvik (TG2) → tiltak. */
export async function createAiReportChain(
  organizationId: string,
  options: { assignmentId?: string } = {},
): Promise<AiReportChain> {
  const assignmentId = options.assignmentId ?? (await createAssignment(organizationId)).id;
  const report = await createReportRow(organizationId, { assignmentId });
  const result = await createCheckpointResultRow(organizationId, { reportId: report.id });
  const deviation = await createDeviationRow(organizationId, {
    reportId: report.id,
    checkpointResultId: result.id,
    tg: 2,
    deviationText: "Sprekker i tettesjiktet ved sluket",
    causeText: "Membranen er gammel",
    consequenceText: "Fukt kan trenge inn i veggen",
  });
  const measure = await createDeviationMeasureRow(organizationId, {
    reportId: report.id,
    deviationId: deviation.id,
    text: "Membranen bør skiftes",
  });
  return {
    assignmentId,
    reportId: report.id,
    checkpointResultId: result.id,
    deviationId: deviation.id,
    measureId: measure.id,
  };
}

/** De fire måltypene kjernen slår opp, pluss `new_measure`, med id fra kjeden. */
export function resolvedTargets(chain: AiReportChain): { name: string; target: AiTarget }[] {
  return [
    {
      name: "deviation/cause_text",
      target: { type: "deviation", id: chain.deviationId, fieldKey: "cause_text" },
    },
    {
      name: "deviation/new_measure",
      target: { type: "deviation", id: chain.deviationId, fieldKey: "new_measure" },
    },
    {
      name: "deviation_measure/text",
      target: { type: "deviation_measure", id: chain.measureId, fieldKey: "text" },
    },
    {
      name: "checkpoint_result/description_text",
      target: {
        type: "checkpoint_result",
        id: chain.checkpointResultId,
        fieldKey: "description_text",
      },
    },
    {
      name: "report/summary_text",
      target: { type: "report", id: chain.reportId, fieldKey: "summary_text" },
    },
  ];
}

/** Mykt sletter en rad (rått, forbi tjenestene). */
export async function softDelete(
  table: "reports" | "assignments" | "checkpoint_results" | "deviations" | "deviation_measures",
  id: string,
) {
  await db.execute(sql`update ${sql.identifier(table)} set deleted_at = now() where id = ${id}`);
}

/** Setter status på rapporten (rått). */
export async function setReportStatus(
  reportId: string,
  status: "draft" | "published" | "superseded",
) {
  await db.execute(sql`update reports set status = ${status} where id = ${reportId}`);
}

/** En oppdiktet kandidat fra malen. */
export function candidate(
  text: string,
  source: "template_outcome" | "template_measure" = "template_outcome",
) {
  return { source, id: uuidv7(), text };
}
