import { z } from "zod";
import { employeeRoles } from "@/db/schema";

/*
 * Validering av skjemaene i adminområdet. Samme skjema brukes av kjernen og skjermene, slik at
 * feltnavn og feilmeldinger er like. Tom tekst blir `null`.
 */

const REQUIRED_NAME = "Navn må fylles ut";
const ORG_NUMBER = "Org.nr. må være 9 siffer";
const VALID_TO = "Gyldig til må være en dato";
const SORT_ORDER = "Rekkefølge må være et heltall";
const EMAIL = "Skriv en gyldig e-post";

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Valgfri tekst: trimmes, og tom tekst blir `null`. */
const optionalText = z.string().nullish().transform(emptyToNull);

const requiredName = z.string({ error: REQUIRED_NAME }).trim().min(1, { error: REQUIRED_NAME });

/** Sjekker at `YYYY-MM-DD` er en dato som finnes (ikke 2026-02-30). */
function isRealIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Valgfri id fra skjemaet. Formatet sjekkes i kjernen (ugyldig id gir `AccessDeniedError`). */
const optionalId = z.string().nullish().transform(emptyToNull);

export const companyInputSchema = z.object({
  legalName: requiredName,
  orgNumber: optionalText.refine((value) => value === null || /^[0-9]{9}$/.test(value), {
    error: ORG_NUMBER,
  }),
  vatRegistered: z.boolean().default(true),
  address: optionalText,
  postalCode: optionalText,
  city: optionalText,
  /** Firmatekst i rapporten. */
  companyText: optionalText,
  liabilityInsurer: optionalText,
  liabilityPolicyNumber: optionalText,
  liabilityValidTo: optionalText.refine((value) => value === null || isRealIsoDate(value), {
    error: VALID_TO,
  }),
});
export type CompanyInput = z.input<typeof companyInputSchema>;

export const officeInputSchema = z.object({
  name: requiredName,
  address: optionalText,
  sortOrder: z.number({ error: SORT_ORDER }).int({ error: SORT_ORDER }).default(0),
});
export type OfficeInput = z.input<typeof officeInputSchema>;

export const employeeRolesSchema = z.array(z.enum(employeeRoles));

export const employeeCreateSchema = z.object({
  name: requiredName,
  email: z
    .string({ error: EMAIL })
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: EMAIL })),
  jobTitle: optionalText,
  companyId: optionalId,
  officeId: optionalId,
  roles: employeeRolesSchema.default([]),
});
export type EmployeeCreateInput = z.input<typeof employeeCreateSchema>;

export const employeeUpdateSchema = z.object({
  name: requiredName,
  jobTitle: optionalText,
  companyId: optionalId,
  officeId: optionalId,
});
export type EmployeeUpdateInput = z.input<typeof employeeUpdateSchema>;
