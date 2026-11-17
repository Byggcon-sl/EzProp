import { and, eq, isNull, sql } from "drizzle-orm";
import { addDeviation } from "@/core/reports";
import { db } from "@/db/client";
import { checkpoints, deviationQuestions, outcomes, standardMeasures } from "@/db/schema";
import { uuidv7 } from "@/shared/lib/uuid";
import { enableAi } from "./ai";
import { createAiUsageLog } from "./factories";
import { startedBathroom } from "./report-fixtures";

/*
 * Oppsett for testene av «KI i veien» i rapportkjernen (docs/funksjoner/fase2a-ki-i-veien-testplan.md
 * avsnitt 4 og 5): bad med startet rapport og KI på (falsk leverandør), avvik fra badmalen og
 * rader i KI-loggen med valgt kandidat. Alle verdier er oppdiktede. Testfilen må ha
 * `vi.mock("server-only", () => ({}))`.
 */

export type KiBathroom = Awaited<ReturnType<typeof startedBathroom>>;

/** Utfall i badmalen (faste koder) som testene bruker. */
export const PLACE = {
  /** TG2 på sjikt og sluk (alder). */
  membraneTg2: {
    checkpointKey: "wet_room.membrane_drain",
    questionKey: "wet_room.membrane_drain.membrane_past_lifespan",
    outcomeKey: "tg2",
  },
  /** TG3 på sjikt og sluk (før 2000). */
  membraneTg3: {
    checkpointKey: "wet_room.membrane_drain",
    questionKey: "wet_room.membrane_drain.membrane_before_2000",
    outcomeKey: "tg3",
  },
  /** TG3 på ventilasjon. */
  ventilationTg3: {
    checkpointKey: "wet_room.ventilation",
    questionKey: "wet_room.ventilation.missing_ventilation",
    outcomeKey: "tg3",
  },
  /** TG2 på innredning. */
  furnitureTg2: {
    checkpointKey: "wet_room.fixtures",
    questionKey: "wet_room.fixtures.damaged_furniture",
    outcomeKey: "tg2",
  },
  /** HMS på innredning (varmgang). */
  overheatingHms: {
    checkpointKey: "wet_room.fixtures",
    questionKey: "wet_room.fixtures.signs_of_overheating",
    outcomeKey: "hms",
  },
  /** «Velg TG2 eller TG3» på tilliggende konstruksjoner. */
  adjacentChoose: {
    checkpointKey: "wet_room.adjacent",
    questionKey: "wet_room.adjacent.elevated_moisture",
    outcomeKey: "choose",
  },
} as const;

export type Place = (typeof PLACE)[keyof typeof PLACE];

/** Bad med startet rapport og KI på (falsk leverandør). */
export async function kiBathroom(options: Parameters<typeof startedBathroom>[0] = {}) {
  const f = await startedBathroom(options);
  await enableAi(f.organizationId);
  return f;
}

/** Legger til et avvik fra utfallet. `tg` kreves for «velg TG2 eller TG3». */
export async function addPlaceDeviation(
  f: Pick<KiBathroom, "actor" | "organizationId" | "room">,
  place: Place,
  tg: 2 | 3 | null = null,
): Promise<string> {
  const id = uuidv7();
  const result = await addDeviation(f.actor, f.organizationId, f.room, { id, ...place, tg });
  if (result.status !== "saved") throw new Error(`avviket ble ikke lagt til: ${result.status}`);
  return id;
}

/** Id-en til utfallet i malversjonen. */
export async function outcomeIdOf(organizationId: string, versionId: string, place: Place) {
  const [row] = await db
    .select({ id: outcomes.id })
    .from(outcomes)
    .innerJoin(deviationQuestions, eq(deviationQuestions.id, outcomes.deviationQuestionId))
    .innerJoin(checkpoints, eq(checkpoints.id, deviationQuestions.checkpointId))
    .where(
      and(
        eq(outcomes.organizationId, organizationId),
        eq(checkpoints.versionId, versionId),
        eq(checkpoints.key, place.checkpointKey),
        eq(deviationQuestions.key, place.questionKey),
        eq(outcomes.key, place.outcomeKey),
        isNull(outcomes.deletedAt),
      ),
    );
  if (!row) throw new Error("fant ikke utfallet");
  return row.id;
}

/** Standardtiltakene til utfallet i malversjonen, i malens rekkefølge. */
export async function measureIdsOf(organizationId: string, versionId: string, place: Place) {
  const outcomeId = await outcomeIdOf(organizationId, versionId, place);
  const rows = await db
    .select({ id: standardMeasures.id, text: standardMeasures.text })
    .from(standardMeasures)
    .where(
      and(
        eq(standardMeasures.organizationId, organizationId),
        eq(standardMeasures.outcomeId, outcomeId),
      ),
    )
    .orderBy(standardMeasures.sortOrder);
  return rows;
}

/**
 * En rad i KI-loggen for `phrase_suggest` med valgt kandidat (`accepted`), satt inn rått. Gir
 * «Mest brukt»-tellingen noe å telle. `count` rader med samme kandidat.
 */
export async function chosenPhraseRows(
  organizationId: string,
  options: {
    field: string;
    candidate: { source: string; id: string };
    count?: number;
    reportId?: string | null;
    deviationId?: string;
    deletedAt?: Date | null;
  },
) {
  const ids: string[] = [];
  for (let i = 0; i < (options.count ?? 1); i += 1) {
    const row = await createAiUsageLog(organizationId, {
      feature: "phrase_suggest",
      promptVersion: "phrase_suggest.v1",
      reportId: options.reportId ?? null,
      targetRef: {
        type: "deviation",
        id: options.deviationId ?? uuidv7(),
        fieldKey: options.field,
      },
      sourceFields: ["text"],
      inputSummary: { candidates: 1 },
      outputText: null,
      status: "accepted",
      deletedAt: options.deletedAt ?? null,
    });
    const candidate = JSON.stringify(options.candidate);
    await db.execute(sql`
      update ai_usage_log
      set candidate_refs = jsonb_build_array(${candidate}::jsonb),
          chosen_candidate = ${candidate}::jsonb
      where id = ${row.id}`);
    ids.push(row.id);
  }
  return ids;
}

/** Antall spørringer `run` kjører mot databasen (Drizzle bruker `unsafe` på klienten). */
export async function countQueries(run: () => Promise<unknown>): Promise<number> {
  const client = (db as unknown as { $client: { unsafe: (...args: unknown[]) => unknown } })
    .$client;
  const { vi } = await import("vitest");
  const spy = vi.spyOn(client, "unsafe");
  try {
    await run();
    return spy.mock.calls.length;
  } finally {
    spy.mockRestore();
  }
}
