// MIDLERTIDIG STUBB for bit 2. Erstattes av bit 1.
import type { Actor } from "@/core/access";

export { ACTIVITY_INTERVAL_SECONDS, shouldSendActivity } from "./activity";
export { TimeTrackingValidationError } from "./errors";
export { timeTrackingSettingsSchema, type TimeTrackingSettingsInput } from "./schemas";
import { TimeTrackingValidationError } from "./errors";
import { timeTrackingSettingsSchema } from "./schemas";

export const WORK_PHASES = ["preparation", "inspection", "office", "delivery"] as const;
export type WorkPhase = (typeof WORK_PHASES)[number];

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
  input: unknown,
): Promise<void> {
  const parsed = timeTrackingSettingsSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[issue.path.join(".") || "form"] ??= issue.message;
    }
    throw new TimeTrackingValidationError(fieldErrors);
  }
}
