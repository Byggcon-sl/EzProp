"use server";

import { redirect } from "next/navigation";
import { grantablePermissions } from "@/core/access";
import { employeeRoles } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { errorResult, failure } from "../action-result";
import { getAdminContext, type AdminContext } from "../admin-context";
import { NO_ACCESS, type FormState } from "../form-state";
import {
  createEmployee,
  deactivateEmployee,
  getEmployeeForAdmin,
  grantEmployeePermission,
  listCompanies,
  listOffices,
  reactivateEmployee,
  revokeEmployeePermission,
  setEmployeeRoles,
  updateEmployee,
} from "../organization";

const ROUTE = "/admin/ansatte";

/** Feilmeldingene ved feltet fra skissen (avsnitt 6). */
const MESSAGES = {
  name: "Skriv inn navnet.",
  email: "Skriv inn en gyldig e-postadresse.",
};

/** Bare kjente verdier sendes videre; alt annet fra skjemaet ignoreres. */
function pick<T extends string>(formData: FormData, name: string, allowed: readonly T[]): T[] {
  const chosen = new Set(formData.getAll(name).map(String));
  return allowed.filter((value) => chosen.has(value));
}

function readDetails(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    jobTitle: String(formData.get("jobTitle") ?? ""),
    companyId: String(formData.get("companyId") ?? ""),
    officeId: String(formData.get("officeId") ?? ""),
  };
}

/**
 * Selskap og kontor må være blant dem admin ser i egen organisasjon (ikke slettet). Kjernen
 * sjekker det samme; her gir det meldingen ved riktig felt.
 */
async function checkCompanyAndOffice(
  context: AdminContext,
  companyId: string,
  officeId: string,
): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};
  if (companyId) {
    const companies = await listCompanies(context.actor, context.organizationId);
    if (!isUuid(companyId) || !companies.some((row) => row.id === companyId)) {
      errors.companyId = "Velg et annet selskap.";
    }
  }
  if (officeId) {
    const offices = await listOffices(context.actor, context.organizationId);
    if (!isUuid(officeId) || !offices.some((row) => row.id === officeId)) {
      errors.officeId = "Velg et annet kontor.";
    }
  }
  return errors;
}

function detailsInput(details: ReturnType<typeof readDetails>) {
  return {
    name: details.name.trim(),
    jobTitle: details.jobTitle.trim() || null,
    companyId: details.companyId || null,
    officeId: details.officeId || null,
  };
}

/** Ny ansatt. Ingen e-post sendes; personen logger inn med engangskode på innloggingssiden. */
export async function createEmployeeAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const details = readDetails(formData);
  const roles = pick(formData, "roles", employeeRoles);
  const values = { ...details, email: String(formData.get("email") ?? ""), roles };
  const context = await getAdminContext();
  if (!context) return failure(previous, values, {}, NO_ACCESS);

  try {
    const choiceErrors = await checkCompanyAndOffice(context, details.companyId, details.officeId);
    if (Object.keys(choiceErrors).length > 0) return failure(previous, values, choiceErrors);
    await createEmployee(context.actor, context.organizationId, {
      ...detailsInput(details),
      email: values.email.trim(),
      roles,
    });
  } catch (error) {
    return errorResult(
      error,
      previous,
      values,
      { route: ROUTE, userId: context.actor.id },
      MESSAGES,
    );
  }
  redirect(`${ROUTE}?lagret=ny-ansatt`);
}

/** Opplysninger om en ansatt (ikke e-post, som ikke kan endres). */
export async function updateEmployeeAction(
  employeeId: string,
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = readDetails(formData);
  const context = await getAdminContext();
  if (!context || !isUuid(employeeId)) return failure(previous, values, {}, NO_ACCESS);

  try {
    const choiceErrors = await checkCompanyAndOffice(context, values.companyId, values.officeId);
    if (Object.keys(choiceErrors).length > 0) return failure(previous, values, choiceErrors);
    await updateEmployee(context.actor, context.organizationId, employeeId, detailsInput(values));
  } catch (error) {
    return errorResult(
      error,
      previous,
      values,
      { route: ROUTE, userId: context.actor.id, employeeId },
      MESSAGES,
    );
  }
  redirect(`${ROUTE}?lagret=endret`);
}

/** Rollene til en ansatt. Siste admin kan ikke miste rollen (kjernen stopper det). */
export async function setRolesAction(
  employeeId: string,
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const roles = pick(formData, "roles", employeeRoles);
  const values = { roles };
  const context = await getAdminContext();
  if (!context || !isUuid(employeeId)) return failure(previous, values, {}, NO_ACCESS);

  try {
    await setEmployeeRoles(context.actor, context.organizationId, employeeId, roles);
  } catch (error) {
    return errorResult(error, previous, values, {
      route: ROUTE,
      userId: context.actor.id,
      employeeId,
    });
  }
  redirect(`${ROUTE}/${employeeId}?lagret=roller`);
}

/** Enkeltrettighetene til en ansatt: gir de nye og tar bort dem som ikke er krysset av. */
export async function setPermissionsAction(
  employeeId: string,
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const wanted = pick(formData, "permissions", grantablePermissions);
  const values = { permissions: wanted };
  const context = await getAdminContext();
  if (!context || !isUuid(employeeId)) return failure(previous, values, {}, NO_ACCESS);

  try {
    const { actor, organizationId } = context;
    const employee = await getEmployeeForAdmin(actor, organizationId, employeeId);
    const current = new Set<string>(employee.permissions);
    for (const permission of grantablePermissions) {
      const shouldHave = wanted.includes(permission);
      if (shouldHave && !current.has(permission)) {
        await grantEmployeePermission(actor, organizationId, employeeId, permission);
      } else if (!shouldHave && current.has(permission)) {
        await revokeEmployeePermission(actor, organizationId, employeeId, permission);
      }
    }
  } catch (error) {
    return errorResult(error, previous, values, {
      route: ROUTE,
      userId: context.actor.id,
      employeeId,
    });
  }
  redirect(`${ROUTE}/${employeeId}?lagret=rettigheter`);
}

/** «Har sluttet». Uten ekstra bekreftelse, fordi det kan angres. */
export async function deactivateEmployeeAction(
  employeeId: string,
  previous: FormState,
): Promise<FormState> {
  const context = await getAdminContext();
  if (!context || !isUuid(employeeId)) return failure(previous, {}, {}, NO_ACCESS);
  try {
    await deactivateEmployee(context.actor, context.organizationId, employeeId);
  } catch (error) {
    return errorResult(error, previous, {}, { route: ROUTE, userId: context.actor.id, employeeId });
  }
  redirect(`${ROUTE}?lagret=sluttet`);
}

/** «Angre sluttet». */
export async function reactivateEmployeeAction(
  employeeId: string,
  previous: FormState,
): Promise<FormState> {
  const context = await getAdminContext();
  if (!context || !isUuid(employeeId)) return failure(previous, {}, {}, NO_ACCESS);
  try {
    await reactivateEmployee(context.actor, context.organizationId, employeeId);
  } catch (error) {
    return errorResult(error, previous, {}, { route: ROUTE, userId: context.actor.id, employeeId });
  }
  redirect(`${ROUTE}?lagret=angret`);
}
