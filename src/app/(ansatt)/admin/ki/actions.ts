"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AiRetentionValidationError, saveAiRetentionSettings } from "@/core/ai";
import { errorResult, failure } from "../../action-result";
import { NO_ACCESS, type FormState } from "../../form-state";
import { getAdminContext } from "../admin-context";

/*
 * Lagrer hvor mange år avviste KI-forslag minst oppbevares (K7, oppgavekortet
 * docs/agenter/oppgaver/ki-oppbevaring-avviste.md, Omfang 4). Ingen tilgangslogikk her:
 * organisasjonen kommer fra økten (`getAdminContext`), og kjernen krever `organization.manage`.
 * Teksten sendes videre som den er; kjernen gjør den om til et helt tall og validerer.
 * Støtter hovedmål: best for de ansatte (admin endrer tallet selv) og KI i bunnen.
 */

const ROUTE = "/admin/ki";
const FIELD = "rejectedRetentionYears";

/** Fast tekst ved feltet. Gjengir aldri det som ble skrevet inn. */
const FIELD_ERROR = "Skriv et helt antall år fra 1 til 10.";

export async function saveAiRetentionSettingsAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const value = String(formData.get(FIELD) ?? "");
  const values: FormState["values"] = { [FIELD]: value };

  const context = await getAdminContext();
  if (!context) return failure(previous, values, {}, NO_ACCESS);

  try {
    await saveAiRetentionSettings(context.actor, context.organizationId, {
      rejectedRetentionYears: value,
    });
  } catch (error) {
    if (error instanceof AiRetentionValidationError) {
      return failure(previous, values, { [FIELD]: FIELD_ERROR });
    }
    return errorResult(error, previous, values, { route: ROUTE, userId: context.actor.id });
  }
  // Også når verdien var den samme og ingenting ble skrevet (A275): vanlig kvittering.
  revalidatePath(ROUTE);
  redirect(`${ROUTE}?lagret=1`);
}
