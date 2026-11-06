"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  saveTimeTrackingSettings,
  TimeTrackingValidationError,
  WORK_PHASES,
} from "@/core/work-sessions";
import { errorResult, failure } from "../../action-result";
import { getEmployeeContext } from "../../employee-context";
import { NO_ACCESS, UNKNOWN_ERROR, type FormState } from "../../form-state";

/*
 * Lagrer nullpunktet fra IVIT og bryteren «Mål tid» (docs/funksjoner/fase2a-tidsmaling.md punkt 6).
 * Ingen tilgangslogikk her: organisasjonen kommer fra `getEmployeeContext()`, og kjernen krever
 * `organization.manage`. Kjernen slår sammen med de andre innstillingene.
 * Støtter hovedmål: tid (sammenligningen med IVIT).
 */

const ROUTE = "/statistikk/tid";

const FIELDS: readonly string[] = [...WORK_PHASES, "source"];

/** Tomt felt er 0 (ikke målt i IVIT). Alt som ikke er et helt tall, blir avvist av skjemaet. */
function toMinutes(value: string): number {
  const trimmed = value.trim().replace(/\s/g, "");
  if (trimmed === "") return 0;
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

/**
 * Feilene fra kjernen har nøkler som `baseline.office`. Skjemafeltet er siste ledd. Feil uten felt
 * (for eksempel `form`) vises øverst.
 */
function fieldErrorsFrom(error: TimeTrackingValidationError): {
  fieldErrors: Record<string, string>;
  message: string | null;
} {
  const fieldErrors: Record<string, string> = {};
  let message: string | null = null;
  for (const [path, text] of Object.entries(error.fieldErrors)) {
    const field = path.split(".").pop() ?? "";
    if (FIELDS.includes(field)) fieldErrors[field] ??= text;
    else message ??= text;
  }
  return { fieldErrors, message };
}

export async function saveTimeTrackingSettingsAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const text = (name: string) => String(formData.get(name) ?? "");
  const enabled = formData.get("enabled") === "on";
  const source = text("source");
  const minutes = Object.fromEntries(WORK_PHASES.map((phase) => [phase, text(phase)])) as Record<
    (typeof WORK_PHASES)[number],
    string
  >;
  const values: FormState["values"] = { ...minutes, enabled: enabled ? "on" : "", source };

  const context = await getEmployeeContext();
  if (!context) return failure(previous, values, {}, NO_ACCESS);

  const input = {
    enabled,
    baseline: {
      preparation: toMinutes(minutes.preparation),
      inspection: toMinutes(minutes.inspection),
      office: toMinutes(minutes.office),
      delivery: toMinutes(minutes.delivery),
      source: source.trim(),
    },
  };

  try {
    await saveTimeTrackingSettings(context.actor, context.organizationId, input);
  } catch (error) {
    if (error instanceof TimeTrackingValidationError) {
      const { fieldErrors, message } = fieldErrorsFrom(error);
      return Object.keys(fieldErrors).length > 0
        ? failure(previous, values, fieldErrors)
        : failure(previous, values, {}, message ?? UNKNOWN_ERROR);
    }
    return errorResult(error, previous, values, { route: ROUTE, userId: context.actor.id });
  }
  revalidatePath(ROUTE);
  redirect(`${ROUTE}?lagret=1`);
}
