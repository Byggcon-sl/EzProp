import "server-only";
import { ZodError } from "zod";
import { AccessDeniedError } from "@/core/access";
import { logger } from "@/shared/lib/logger";
import { FIX_FIELDS, NO_ACCESS, UNKNOWN_ERROR, type FormState } from "./form-state";

/** Et mislykket forsøk med feil ved feltene og/eller en melding øverst. */
export function failure(
  previous: FormState,
  values: FormState["values"],
  fieldErrors: FormState["fieldErrors"],
  message: string | null = Object.keys(fieldErrors).length > 0 ? FIX_FIELDS : null,
): FormState {
  return { fieldErrors, message, values, attempt: previous.attempt + 1 };
}

/** Feilmeldingene ved feltet fra skissen, per felt. */
export type FieldMessages = Partial<Record<string, string>>;

/**
 * En feil fra kjernen som området kjenner og viser med egen tekst. Med `field` står meldingen ved
 * feltet, ellers øverst i skjemaet.
 */
export type KnownError = {
  error: new (...args: never[]) => Error;
  field?: string;
  message: string;
};

/**
 * Første feil per felt fra Zod (feltet er første ledd i stien). Teksten fra skissen brukes der
 * den finnes for feltet, ellers meldingen fra kjernen. Feil uten sti (kjernen validerte én verdi,
 * ikke et objekt) står ved `zodField` når den er gitt.
 */
function zodFieldErrors(
  error: ZodError,
  messages: FieldMessages,
  zodField: string | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? zodField ?? "");
    if (field && !(field in result)) result[field] = messages[field] ?? issue.message;
  }
  return result;
}

/**
 * Gjør en feil fra kjernen om til et svar til skjemaet. Hvert område sender sine kjente feil.
 * Ukjente feil logges bare med feilnavn, rute og id-er, aldri med innholdet i skjemaet.
 */
export function errorResult(
  error: unknown,
  previous: FormState,
  values: FormState["values"],
  log: { route: string; userId: string; [key: string]: string },
  {
    known = [],
    messages = {},
    zodField,
  }: { known?: readonly KnownError[]; messages?: FieldMessages; zodField?: string } = {},
): FormState {
  if (error instanceof ZodError) {
    const fieldErrors = zodFieldErrors(error, messages, zodField);
    return Object.keys(fieldErrors).length > 0
      ? failure(previous, values, fieldErrors)
      : failure(previous, values, {}, UNKNOWN_ERROR);
  }
  const match = known.find((entry) => error instanceof entry.error);
  if (match) {
    return match.field
      ? failure(previous, values, { [match.field]: match.message })
      : failure(previous, values, {}, match.message);
  }
  if (error instanceof AccessDeniedError) return failure(previous, values, {}, NO_ACCESS);

  logger.error("Lagring feilet", {
    ...log,
    errorName: error instanceof Error ? error.name : "ukjent feil",
  });
  return failure(previous, values, {}, UNKNOWN_ERROR);
}
