import { ASSIGNMENT_STATUSES, type AssignmentStatus } from "./codes";

/*
 * Statusflyten for oppdrag (A69, A71, A72). Rene funksjoner uten database, så de kan kjøre både
 * på iPaden og på serveren. Rekkefølgen er `ASSIGNMENT_STATUSES`: ett steg fram uten grunn, ett
 * steg tilbake med grunn, ingen hopp. Tabellen er låst med testsaker i `status-flow.test.ts`.
 */

export type AssignmentTransitionKind = "forward" | "back";

/** Neste status (ett steg fram) og forrige status (ett steg tilbake). `null` når det ikke finnes. */
export function allowedTransitions(status: AssignmentStatus): {
  next: AssignmentStatus | null;
  previous: AssignmentStatus | null;
} {
  const index = ASSIGNMENT_STATUSES.indexOf(status);
  if (index === -1) return { next: null, previous: null };
  return {
    next: ASSIGNMENT_STATUSES[index + 1] ?? null,
    previous: index > 0 ? (ASSIGNMENT_STATUSES[index - 1] ?? null) : null,
  };
}

/**
 * Hva slags overgang `from → to` er: `"forward"` (ett steg fram, ingen grunn), `"back"` (ett
 * steg tilbake, grunn påkrevd) eller `null` (ulovlig, også samme status og hopp).
 */
export function transitionKind(
  from: AssignmentStatus,
  to: AssignmentStatus,
): AssignmentTransitionKind | null {
  if (from === to) return null;
  const { next, previous } = allowedTransitions(from);
  if (to === next) return "forward";
  if (to === previous) return "back";
  return null;
}

/**
 * Om oppdraget kan kanselleres (A71). Bare fra Bestilt og Under arbeid. Et levert eller fakturert
 * oppdrag skal stå synlig i 10 år og kan få reklamasjon.
 */
export function canCancel(status: AssignmentStatus): boolean {
  return status === "ordered" || status === "in_progress";
}

/**
 * Merket «Rettet» (A72): oppdraget er Ferdig, og den høyeste sendte utgivelsen har versjon 2
 * eller høyere. Regnes ut, lagres ikke.
 */
export function isCorrected(input: {
  status: AssignmentStatus | string;
  highestSentReleaseVersion: number | null;
}): boolean {
  return (
    input.status === "completed" &&
    input.highestSentReleaseVersion !== null &&
    input.highestSentReleaseVersion >= 2
  );
}
