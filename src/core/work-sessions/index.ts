// MIDLERTIDIG STUBB for bit 2. Erstattes av bit 1.
import { z } from "zod";
import type { Actor } from "@/core/access";

export { ACTIVITY_INTERVAL_SECONDS, shouldSendActivity } from "./activity";

export const WORK_PHASES = ["preparation", "inspection", "office", "delivery"] as const;
export type WorkPhase = (typeof WORK_PHASES)[number];

const minutes = z.number().int().min(0).max(10000);
export const timeTrackingSettingsSchema = z.object({
  enabled: z.boolean(),
  baseline: z.object({
    preparation: minutes,
    inspection: minutes,
    office: minutes,
    delivery: minutes,
    source: z.string().max(200),
  }),
});
export type TimeTrackingSettingsInput = z.input<typeof timeTrackingSettingsSchema>;

export type PhaseStatistics = {
  phase: WorkPhase;
  averageSeconds: number;
  baselineMinutes: number | null;
  differencePercent: number | null;
};

export type TimeStatistics = {
  assignmentCount: number;
  phases: PhaseStatistics[];
  total: Omit<PhaseStatistics, "phase">;
  baseline: {
    preparation: number;
    inspection: number;
    office: number;
    delivery: number;
    source: string;
  } | null;
  enabled: boolean;
};

export function secondsToDisplayMinutes(seconds: number): number {
  return Math.round(seconds / 60);
}

export async function recordWorkActivity(
  _actor: Actor,
  _organizationId: string,
  _assignmentId: string,
  _now: Date = new Date(),
): Promise<void> {}

export async function getTimeStatistics(
  _actor: Actor,
  _organizationId: string,
): Promise<TimeStatistics> {
  return {
    assignmentCount: 0,
    phases: WORK_PHASES.map((phase) => ({
      phase,
      averageSeconds: 0,
      baselineMinutes: null,
      differencePercent: null,
    })),
    total: { averageSeconds: 0, baselineMinutes: null, differencePercent: null },
    baseline: null,
    enabled: true,
  };
}

export async function saveTimeTrackingSettings(
  _actor: Actor,
  _organizationId: string,
  input: TimeTrackingSettingsInput,
): Promise<void> {
  timeTrackingSettingsSchema.parse(input);
}
