"use server";

import { z } from "zod";
import { recordWorkActivity } from "@/core/work-sessions";
import { logger } from "@/shared/lib/logger";
import { getEmployeeContext } from "../../employee-context";

const assignmentIdSchema = z.string().uuid();

/**
 * Måleren på oppdragssidene kaller denne når den ansatte er aktiv (docs/funksjoner/fase2a-tidsmaling.md
 * punkt 4). Organisasjonen kommer fra den innloggede ansatte, aldri fra argumentet. Tilgangen
 * sjekkes i kjernen. Handlingen svarer aldri med feil: målingen skal ikke forstyrre siden.
 * Støtter hovedmål: tid (null trykk for takstmannen).
 */
export async function recordWorkActivityAction(assignmentId: string): Promise<void> {
  try {
    const parsed = assignmentIdSchema.safeParse(assignmentId);
    if (!parsed.success) return;
    const context = await getEmployeeContext();
    if (!context) return;
    await recordWorkActivity(context.actor, context.organizationId, parsed.data);
  } catch (error) {
    // Bare feilnavnet; ingen navn, e-post eller oppdrags-id i loggen.
    logger.warn("Tidsmåling feilet", {
      route: "/oppdrag/[id]",
      errorName: error instanceof Error ? error.name : "ukjent feil",
    });
  }
}
