/**
 * Faste koder for oppdrag og nummerserier (docs/05-domenemodell.md 4.3). Kodene står bare her og
 * i CHECK-reglene i `src/db/schema/assignments.ts` og `number-sequences.ts`. En kode endres
 * aldri; skal den få ny betydning, arkiveres den og det lages en ny (regel 6). Nye koder kan
 * legges til.
 */

/** Type oppdrag. Bare tilstandsrapport nå. */
export const ASSIGNMENT_TYPES = ["condition_report"] as const;
export type AssignmentType = (typeof ASSIGNMENT_TYPES)[number];

/** Oppdragsstatusene fra Ståle 27.10.2026, i rekkefølge. Bare `ordered` settes i fase 2a. */
export const ASSIGNMENT_STATUSES = ["ordered", "in_progress", "completed", "invoiced"] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

/** Hva en nummerserie teller. Bare oppdragsnumre nå. */
export const NUMBER_SEQUENCE_SCOPES = ["assignment"] as const;
export type NumberSequenceScope = (typeof NUMBER_SEQUENCE_SCOPES)[number];

const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  ordered: "Bestilt",
  in_progress: "Under arbeid",
  completed: "Ferdig",
  invoiced: "Fakturert",
};

/** Norsk etikett for en oppdragsstatus. Ukjent kode gir koden tilbake. */
export function assignmentStatusLabel(code: string): string {
  return (ASSIGNMENT_STATUS_LABELS as Record<string, string>)[code] ?? code;
}
