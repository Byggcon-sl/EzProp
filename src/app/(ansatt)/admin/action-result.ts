import "server-only";
import { ZodError } from "zod";
import { AccessDeniedError } from "@/core/access";
import { logger } from "@/shared/lib/logger";
import { FIX_FIELDS, NO_ACCESS, UNKNOWN_ERROR, type FormState } from "./form-state";
import {
  DuplicateEmployeeEmailError,
  DuplicateOfficeNameError,
  DuplicateOrgNumberError,
  LastAdminError,
} from "@/core/organization";

/** Et mislykket forsøk med feil ved feltene og/eller en melding øverst. */
export function failure(
  previous: FormState,
  values: FormState["values"],
  fieldErrors: FormState["fieldErrors"],
  message: string | null = Object.keys(fieldErrors).length > 0 ? FIX_FIELDS : null,
): FormState {
  return { fieldErrors, message, values, attempt: previous.attempt + 1 };
}

/** Feilmeldingene ved feltet fra skissen (avsnitt 6), per felt. */
export type FieldMessages = Partial<Record<string, string>>;

/**
 * Første feil per felt fra Zod (feltet er første ledd i stien). Teksten fra skissen brukes der
 * den finnes for feltet, ellers meldingen fra kjernen.
 */
function zodFieldErrors(error: ZodError, messages: FieldMessages): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "");
    if (field && !(field in result)) result[field] = messages[field] ?? issue.message;
  }
  return result;
}

/**
 * Gjør en feil fra kjernen om til et svar til skjemaet. Ukjente feil logges bare med feilnavn,
 * rute og id-er, aldri med innholdet i skjemaet.
 */
export function errorResult(
  error: unknown,
  previous: FormState,
  values: FormState["values"],
  log: { route: string; userId: string; [key: string]: string },
  messages: FieldMessages = {},
): FormState {
  if (error instanceof ZodError) {
    const fieldErrors = zodFieldErrors(error, messages);
    return Object.keys(fieldErrors).length > 0
      ? failure(previous, values, fieldErrors)
      : failure(previous, values, {}, UNKNOWN_ERROR);
  }
  if (error instanceof DuplicateOrgNumberError) {
    return failure(previous, values, { orgNumber: "Det finnes alt et selskap med dette org.nr." });
  }
  if (error instanceof DuplicateOfficeNameError) {
    return failure(previous, values, { name: "Det finnes alt et kontor med dette navnet." });
  }
  if (error instanceof DuplicateEmployeeEmailError) {
    return failure(previous, values, { email: "Det finnes alt en ansatt med denne e-posten." });
  }
  if (error instanceof LastAdminError) {
    return failure(previous, values, {}, "Organisasjonen må ha minst én admin.");
  }
  if (error instanceof AccessDeniedError) return failure(previous, values, {}, NO_ACCESS);

  logger.error("Lagring i adminområdet feilet", {
    ...log,
    errorName: error instanceof Error ? error.name : "ukjent feil",
  });
  return failure(previous, values, {}, UNKNOWN_ERROR);
}
