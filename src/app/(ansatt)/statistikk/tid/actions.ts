"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { saveTimeTrackingSettings, WORK_PHASES } from "@/core/work-sessions";
import { errorResult, failure } from "../../action-result";
import { getEmployeeContext } from "../../employee-context";
import { NO_ACCESS, type FormState } from "../../form-state";

/*
 * Lagrer nullpunktet fra IVIT og bryteren «Mål tid» (docs/funksjoner/fase2a-tidsmaling.md punkt 6).
 * Ingen tilgangslogikk her: organisasjonen kommer fra `getEmployeeContext()`, og kjernen krever
 * `organization.manage`. Kjernen slår sammen med de andre innstillingene.
 * Støtter hovedmål: tid (sammenligningen med IVIT).
 */

const ROUTE = "/statistikk/tid";

const MINUTES_MESSAGE = "Skriv et helt tall fra 0 til 10 000.";
const SOURCE_MESSAGE = "Kilden kan ha høyst 200 tegn.";

const FIELD_MESSAGES: Record<string, string> = {
  preparation: MINUTES_MESSAGE,
  inspection: MINUTES_MESSAGE,
  office: MINUTES_MESSAGE,
  delivery: MINUTES_MESSAGE,
  source: SOURCE_MESSAGE,
};

/** Tomt felt er 0 (ikke målt i IVIT). Alt som ikke er et helt tall, blir avvist av skjemaet. */
function toMinutes(value: string): number {
  const trimmed = value.trim().replace(/\s/g, "");
  if (trimmed === "") return 0;
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

/** Første feil per felt. Feltet er siste ledd i stien, slik at nøstede nullpunktfelt også treffer. */
function fieldErrorsFrom(error: ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = [...issue.path].reverse().find((part) => typeof part === "string");
    if (typeof field !== "string" || field in result) continue;
    result[field] = FIELD_MESSAGES[field] ?? issue.message;
  }
  return result;
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
    if (error instanceof ZodError) {
      const fieldErrors = fieldErrorsFrom(error);
      if (Object.keys(fieldErrors).length > 0) return failure(previous, values, fieldErrors);
    }
    return errorResult(error, previous, values, { route: ROUTE, userId: context.actor.id });
  }
  revalidatePath(ROUTE);
  redirect(`${ROUTE}?lagret=1`);
}
