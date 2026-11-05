import { ASSIGNMENT_STATUSES, type AssignmentStatus } from "./codes";

/*
 * Tolking av adressen til arbeidskøen (`?status=`, `?mine=`, `?q=`). Ren funksjon uten database.
 * Ugyldige verdier gir standard, aldri feil (A99, A102). Organisasjon og ansatt leses aldri fra
 * adressen; de kommer fra tilgangssjekken.
 */

/** Høyst så mange kort per fane (A104). */
export const WORK_QUEUE_LIMIT = 50;

/** Fanen som vises uten valg (A99). */
export const DEFAULT_WORK_QUEUE_STATUS: AssignmentStatus = "in_progress";

/** Lengste søketekst. Lengre tekst kuttes. */
export const WORK_QUEUE_QUERY_MAX_LENGTH = 100;

export type WorkQueueParams = {
  status: AssignmentStatus;
  mineOnly: boolean;
  query: string;
};

type SearchParams = Record<string, string | string[] | undefined>;

function isAssignmentStatus(value: unknown): value is AssignmentStatus {
  return typeof value === "string" && (ASSIGNMENT_STATUSES as readonly string[]).includes(value);
}

/** Leser fane, «Mine» og søk fra adressen. Kaster aldri. */
export function parseWorkQueueParams(
  searchParams: SearchParams | null | undefined,
): WorkQueueParams {
  const params = searchParams ?? {};
  const status = isAssignmentStatus(params.status) ? params.status : DEFAULT_WORK_QUEUE_STATUS;
  // Bare `mine=0` gir «Alle». Alt annet (mangler, ugyldig, liste) gir «Mine».
  const mineOnly = params.mine !== "0";
  const query =
    typeof params.q === "string"
      ? params.q.trim().slice(0, WORK_QUEUE_QUERY_MAX_LENGTH).trim()
      : "";
  return { status, mineOnly, query };
}
