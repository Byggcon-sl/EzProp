import type { EmployeeGrant } from "@/core/access";
import type { DbExecutor } from "@/db/client";
import { events } from "@/db/schema";
import type { EventType } from "./types";

export { EVENT_TYPES, type EventType } from "./types";

export type EventInput = {
  type: EventType;
  assignmentId?: string | null;
  reportId?: string | null;
  /** Detaljer. Aldri passord, nøkler eller mer personopplysninger enn nødvendig. */
  data?: Record<string, unknown>;
};

/**
 * Skriver en hendelse fra en ansatt. Kall den i samme transaksjon som endringen, bak en
 * handling som alt er tilgangssjekket. Organisasjonen og den ansatte kommer fra
 * tilgangssjekken, aldri fra skjemaet. Hendelser endres eller slettes aldri.
 */
export async function recordEvent(executor: DbExecutor, grant: EmployeeGrant, input: EventInput) {
  await executor.insert(events).values({
    organizationId: grant.organizationId,
    actorType: "employee",
    actorId: grant.employeeId,
    createdBy: grant.employeeId,
    type: input.type,
    assignmentId: input.assignmentId ?? null,
    reportId: input.reportId ?? null,
    data: input.data ?? {},
  });
}
