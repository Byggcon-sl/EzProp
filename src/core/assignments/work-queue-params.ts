import type { EmployeeRole } from "@/db/schema";
import { SEARCH_QUERY_MAX_LENGTH } from "@/shared/lib/like-pattern";
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

export type WorkQueueParams = {
  status: AssignmentStatus;
  mineOnly: boolean;
  query: string;
};

type SearchParams = Record<string, string | string[] | undefined>;

function isAssignmentStatus(value: unknown): value is AssignmentStatus {
  return typeof value === "string" && (ASSIGNMENT_STATUSES as readonly string[]).includes(value);
}

/**
 * `defaultMineOnly` avgjør «Mine» eller «Alle» når `mine` mangler eller er ugyldig. Verdien
 * kommer fra `defaultMineOnly(grant.roles)`, aldri fra adressen.
 */
export type ParseWorkQueueOptions = { defaultMineOnly: boolean };

/**
 * Standardvalget i arbeidskøen (T-0029): «Mine» for den som har takstmann-rollen, også sammen
 * med andre roller. Kontor, leder og admin uten takstmann-rolle starter på «Alle». Rollene skal
 * komme fra tilgangssjekken (`grant.roles`).
 */
export function defaultMineOnly(roles: readonly EmployeeRole[]): boolean {
  return roles.includes("inspector");
}

/**
 * Leser fane, «Mine» og søk fra adressen. Kaster aldri. `mine=1` og `mine=0` overstyrer alltid
 * standardvalget. Uten `options` er standarden «Mine», som før.
 */
export function parseWorkQueueParams(
  searchParams: SearchParams | null | undefined,
  options: ParseWorkQueueOptions = { defaultMineOnly: true },
): WorkQueueParams {
  const params = searchParams ?? {};
  const status = isAssignmentStatus(params.status) ? params.status : DEFAULT_WORK_QUEUE_STATUS;
  const mineOnly =
    params.mine === "1" ? true : params.mine === "0" ? false : options.defaultMineOnly;
  const query =
    typeof params.q === "string" ? params.q.trim().slice(0, SEARCH_QUERY_MAX_LENGTH).trim() : "";
  return { status, mineOnly, query };
}
