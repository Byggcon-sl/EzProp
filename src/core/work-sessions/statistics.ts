import { WORK_PHASES, type WorkPhase } from "./phase";
import type { TimeTrackingBaseline } from "./schemas";

/*
 * Utregningen i statistikken (A124). Ren funksjon: sekunder inn, snitt per oppdrag ut. Typen har
 * bevisst ingen felt om den ansatte (arbeidsmiljøloven kapittel 9).
 */

/** Sum sekunder for ett oppdrag i én fase. */
export type TimeStatisticsRow = { assignmentId: string; phase: WorkPhase; seconds: number };

export type PhaseStatistics = {
  phase: WorkPhase;
  averageSeconds: number;
  baselineMinutes: number | null;
  /** (snitt − nullpunkt) / nullpunkt × 100, helt tall. `null` når nullpunktet mangler eller er 0, eller ingen oppdrag telles. */
  differencePercent: number | null;
};

export type TimeStatisticsSummary = {
  /** Ferdige eller fakturerte oppdrag med minst én målt økt. */
  assignmentCount: number;
  phases: PhaseStatistics[];
  total: {
    averageSeconds: number;
    baselineMinutes: number | null;
    differencePercent: number | null;
  };
};

/** Minutter til visning: avrundes først her, utregningen gjøres i sekunder. */
export function secondsToDisplayMinutes(seconds: number): number {
  return Math.round(seconds / 60);
}

function differencePercent(
  averageSeconds: number,
  baselineMinutes: number | null,
  assignmentCount: number,
): number | null {
  // Ingen oppdrag som telles: ingen tall å sammenligne
  if (assignmentCount === 0 || baselineMinutes === null || baselineMinutes === 0) return null;
  const result = Math.round(((averageSeconds / 60 - baselineMinutes) / baselineMinutes) * 100);
  // Unngå «-0»
  return result === 0 ? 0 : result;
}

/**
 * Snitt per fase og totalt (A124). Nevneren er antall distinkte oppdrag i `rows`, den samme for
 * alle faser, så totalt er summen av snittene. Et oppdrag uten økt i en fase bidrar med 0.
 * Totalt-nullpunktet er summen av de fire fasene.
 */
export function summarizeTimeStatistics(
  rows: readonly TimeStatisticsRow[],
  baseline: TimeTrackingBaseline | null,
): TimeStatisticsSummary {
  const assignmentCount = new Set(rows.map((row) => row.assignmentId)).size;
  const sums = new Map<WorkPhase, number>(WORK_PHASES.map((phase) => [phase, 0]));
  for (const row of rows) sums.set(row.phase, (sums.get(row.phase) ?? 0) + row.seconds);

  const average = (seconds: number) => (assignmentCount === 0 ? 0 : seconds / assignmentCount);

  const phases = WORK_PHASES.map((phase): PhaseStatistics => {
    const averageSeconds = average(sums.get(phase) ?? 0);
    const baselineMinutes = baseline ? baseline[phase] : null;
    return {
      phase,
      averageSeconds,
      baselineMinutes,
      differencePercent: differencePercent(averageSeconds, baselineMinutes, assignmentCount),
    };
  });

  const totalSeconds = [...sums.values()].reduce((sum, value) => sum + value, 0);
  const totalAverage = average(totalSeconds);
  const totalBaseline = baseline
    ? WORK_PHASES.reduce((sum, phase) => sum + baseline[phase], 0)
    : null;

  return {
    assignmentCount,
    phases,
    total: {
      averageSeconds: totalAverage,
      baselineMinutes: totalBaseline,
      differencePercent: differencePercent(totalAverage, totalBaseline, assignmentCount),
    },
  };
}
