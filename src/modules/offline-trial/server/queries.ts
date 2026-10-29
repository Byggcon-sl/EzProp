/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Små lesefunksjoner for `trial_*`-tabellene. Bare for testene (tenant-isolasjonsbeviset, regel 2);
 * ingen side bruker dem. Skjermene leser fra den lokale databasen på enheten.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { requireOrganizationAccess, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { trialAnswers, trialForms } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import type { ListTrialAnswers, ListTrialForms } from "./types";

export const listTrialForms: ListTrialForms = async (actor: Actor, organizationId: string) => {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  return db
    .select()
    .from(trialForms)
    .where(and(eq(trialForms.organizationId, grant.organizationId), isNull(trialForms.deletedAt)))
    .orderBy(asc(trialForms.createdAt), asc(trialForms.id));
};

export const listTrialAnswers: ListTrialAnswers = async (
  actor: Actor,
  organizationId: string,
  trialFormId: string,
) => {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  if (!isUuid(trialFormId)) return [];
  return db
    .select()
    .from(trialAnswers)
    .where(
      and(
        eq(trialAnswers.organizationId, grant.organizationId),
        eq(trialAnswers.trialFormId, trialFormId),
        isNull(trialAnswers.deletedAt),
      ),
    )
    .orderBy(asc(trialAnswers.fieldKey));
};
