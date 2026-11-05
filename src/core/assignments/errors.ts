import { assignmentStatusLabel } from "./codes";

/** Den ansatte finnes ikke i organisasjonen, er slettet eller har sluttet. Ingenting er endret. */
export class EmployeeNotFoundError extends Error {
  constructor() {
    super("Den ansatte finnes ikke.");
    this.name = "EmployeeNotFoundError";
  }
}

/** Statusen er endret av noen andre siden siden ble lastet. Ingenting er endret. */
export class AssignmentStatusConflictError extends Error {
  constructor() {
    super("Statusen er endret av noen andre. Last siden på nytt.");
    this.name = "AssignmentStatusConflictError";
  }
}

/** Overgangen er ikke lov (hopp eller samme status). Ingenting er endret. */
export class AssignmentTransitionNotAllowedError extends Error {
  constructor(from: string, to: string) {
    super(
      `Oppdraget kan ikke flyttes fra ${assignmentStatusLabel(from)} til ${assignmentStatusLabel(to)}.`,
    );
    this.name = "AssignmentTransitionNotAllowedError";
  }
}

/** Bare oppdrag som er Bestilt eller Under arbeid kan kanselleres (A76). Ingenting er endret. */
export class AssignmentCannotBeCancelledError extends Error {
  constructor() {
    super("Et oppdrag som er Ferdig eller Fakturert kan ikke kanselleres.");
    this.name = "AssignmentCannotBeCancelledError";
  }
}
