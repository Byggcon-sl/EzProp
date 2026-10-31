/*
 * MIDLERTIDIG: kontrakten fra bit 1 (src/core/organization) mens kjernen bygges i parallell.
 * Sidene i /admin importerer bare herfra, slik at byttet til `@/core/organization` er én fil.
 * Funksjonene her kaster alltid; ingen data og ingen tilgang uten kjernen.
 */
import { z } from "zod";
import { AccessDeniedError, type Actor, type GrantablePermission } from "@/core/access";
import type { EmployeeRole } from "@/db/schema";

export { listCompanies, listOffices } from "@/core/organization";
export { grantEmployeePermission, revokeEmployeePermission } from "@/core/organization";

function missing(): never {
  throw new AccessDeniedError();
}

export class LastAdminError extends Error {
  constructor() {
    super("Organisasjonen må ha minst én admin.");
    this.name = "LastAdminError";
  }
}
export class DuplicateEmployeeEmailError extends Error {
  constructor() {
    super("Det finnes alt en ansatt med denne e-posten.");
    this.name = "DuplicateEmployeeEmailError";
  }
}
export class DuplicateOfficeNameError extends Error {
  constructor() {
    super("Det finnes alt et kontor med dette navnet.");
    this.name = "DuplicateOfficeNameError";
  }
}
export class DuplicateOrgNumberError extends Error {
  constructor() {
    super("Det finnes alt et selskap med dette org.nr.");
    this.name = "DuplicateOrgNumberError";
  }
}

export const companyInputSchema = z.object({
  legalName: z.string(),
  orgNumber: z.string().nullable(),
  vatRegistered: z.boolean(),
  address: z.string().nullable(),
  postalCode: z.string().nullable(),
  city: z.string().nullable(),
  companyText: z.string().nullable(),
  liabilityInsurer: z.string().nullable(),
  liabilityPolicyNumber: z.string().nullable(),
  liabilityValidTo: z.string().nullable(),
});
export const officeInputSchema = z.object({
  name: z.string(),
  address: z.string().nullable(),
  sortOrder: z.number(),
});
export const employeeUpdateSchema = z.object({
  name: z.string(),
  jobTitle: z.string().nullable(),
  companyId: z.string().nullable(),
  officeId: z.string().nullable(),
});
export const employeeCreateSchema = employeeUpdateSchema.extend({
  email: z.string(),
  roles: z.array(z.string()),
});

type Company = z.infer<typeof companyInputSchema> & { id: string };
type Office = z.infer<typeof officeInputSchema> & { id: string };
type AdminEmployee = {
  id: string;
  name: string;
  email: string | null;
  jobTitle: string | null;
  companyId: string | null;
  companyName: string | null;
  officeId: string | null;
  officeName: string | null;
  deactivatedAt: Date | null;
  hasLogin: boolean;
  roles: EmployeeRole[];
  permissions: GrantablePermission[];
};

export async function findAdminOrganizationId(_actor: Actor): Promise<string | null> {
  return null;
}
export async function createCompany(_a: Actor, _o: string, _input: unknown): Promise<Company> {
  return missing();
}
export async function updateCompany(
  _a: Actor,
  _o: string,
  _id: string,
  _input: unknown,
): Promise<Company> {
  return missing();
}
export async function createOffice(_a: Actor, _o: string, _input: unknown): Promise<Office> {
  return missing();
}
export async function updateOffice(
  _a: Actor,
  _o: string,
  _id: string,
  _input: unknown,
): Promise<Office> {
  return missing();
}
export async function listEmployeesForAdmin(_a: Actor, _o: string): Promise<AdminEmployee[]> {
  return missing();
}
export async function getEmployeeForAdmin(
  _a: Actor,
  _o: string,
  _id: string,
): Promise<AdminEmployee> {
  return missing();
}
export async function createEmployee(
  _a: Actor,
  _o: string,
  _input: unknown,
): Promise<{ id: string }> {
  return missing();
}
export async function updateEmployee(
  _a: Actor,
  _o: string,
  _id: string,
  _input: unknown,
): Promise<{ id: string }> {
  return missing();
}
export async function setEmployeeRoles(
  _a: Actor,
  _o: string,
  _id: string,
  _roles: readonly string[],
): Promise<EmployeeRole[]> {
  return missing();
}
export async function deactivateEmployee(_a: Actor, _o: string, _id: string): Promise<unknown> {
  return missing();
}
export async function reactivateEmployee(_a: Actor, _o: string, _id: string): Promise<unknown> {
  return missing();
}
