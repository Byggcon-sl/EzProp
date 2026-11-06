import type { AssignmentStatus } from "@/core/assignments/codes";
import { todayInOslo } from "@/shared/lib/dates";

/**
 * Fasene en arbeidsøkt kan høre til (docs/05-domenemodell.md 4.13). Faste koder (regel 6).
 * CHECK-regelen i `src/db/schema/work-sessions.ts` må ha de samme kodene.
 */
export const WORK_PHASES = ["preparation", "inspection", "office", "delivery"] as const;
export type WorkPhase = (typeof WORK_PHASES)[number];

/** Pause som avslutter en økt: aktivitet høyst så mange minutter etter forrige forlenger den. */
export const IDLE_GAP_MINUTES = 10;

/**
 * Fasen regnes ut fra oppdraget (A119), ikke valgt av takstmannen:
 * - Bestilt → forberedelse.
 * - Under arbeid: befaring mangler eller er senere enn i dag → forberedelse; samme dag →
 *   befaring; tidligere → kontorarbeid. Datoene regnes i norsk tid (også sommertid).
 * - Ferdig og fakturert → levering.
 */
export function phaseForAssignment(
  { status, inspectionAt }: { status: AssignmentStatus; inspectionAt: Date | null },
  now: Date,
): WorkPhase {
  switch (status) {
    case "ordered":
      return "preparation";
    case "in_progress": {
      if (!inspectionAt) return "preparation";
      // «ÅÅÅÅ-MM-DD» kan sammenlignes som tekst
      const inspectionDate = todayInOslo(inspectionAt);
      const today = todayInOslo(now);
      if (inspectionDate > today) return "preparation";
      if (inspectionDate === today) return "inspection";
      return "office";
    }
    case "completed":
    case "invoiced":
      return "delivery";
    default: {
      const unknown: never = status;
      throw new Error(`Ukjent status: ${String(unknown)}`);
    }
  }
}
