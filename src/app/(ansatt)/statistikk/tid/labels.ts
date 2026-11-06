import type { WorkPhase } from "@/core/work-sessions";

/** Norske navn på fasene i tidsmålingen. Kodene er faste (regel 6). */
export const phaseLabels: Record<WorkPhase, string> = {
  preparation: "Forberedelse",
  inspection: "Befaring",
  office: "Kontorarbeid",
  delivery: "Levering",
};

/** Forskjell mot nullpunktet med fortegn, for eksempel «-25 %» eller «+10 %». `null` gir «–». */
export function formatDifference(percent: number | null): string {
  if (percent === null) return "–";
  if (percent > 0) return `+${percent} %`;
  return `${percent} %`;
}
