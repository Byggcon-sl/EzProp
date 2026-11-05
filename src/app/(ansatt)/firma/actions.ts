"use server";

import { redirect } from "next/navigation";
import { isUuid } from "@/shared/lib/uuid";
import { errorResult, failure } from "../action-result";
import { getEmployeeContext } from "../employee-context";
import { NO_ACCESS, type FormState } from "../form-state";
import { createFirm, FirmDuplicateError, updateFirm } from "@/core/contacts";

/*
 * Server actions i /firma. Ingen tilgangslogikk her: organisasjonen kommer fra
 * `getEmployeeContext()`, og kjernen sjekker rettigheten. Et felt `organizationId` i skjemaet
 * leses aldri. Loggen får bare rute, bruker-id, id-er og feilnavn, aldri skjemaverdier.
 */

const ROUTE = "/firma";

const FIRM_FIELDS = ["name", "orgNumber", "firmType", "notes"] as const;

function readFirm(formData: FormData) {
  const values: Record<string, string> = {};
  for (const name of FIRM_FIELDS) values[name] = String(formData.get(name) ?? "");
  return values;
}

/** Kjernen trimmer, kontrollerer nummeret og gjør tomme felt om til `null`. */
function firmInput(values: Record<string, string>) {
  return {
    name: values.name ?? "",
    orgNumber: values.orgNumber ?? "",
    firmType: values.firmType || undefined,
    notes: values.notes ?? "",
  };
}

/** Meldingen ved organisasjonsnummeret, med lenke til firmaet som allerede har det. */
function duplicate(
  previous: FormState,
  values: FormState["values"],
  error: FirmDuplicateError,
): FormState {
  return {
    ...failure(previous, values, {
      orgNumber: `Et firma med dette organisasjonsnummeret finnes allerede: ${error.firmName}.`,
    }),
    link: { href: `${ROUTE}/${error.firmId}`, text: `Åpne ${error.firmName}` },
  };
}

/** «Lagre» på /firma/ny. Ved suksess går man til firmasiden. */
export async function createFirmAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = readFirm(formData);
  const context = await getEmployeeContext();
  if (!context) return failure(previous, values, {}, NO_ACCESS);

  let firmId: string;
  try {
    const firm = await createFirm(context.actor, context.organizationId, firmInput(values));
    firmId = firm.id;
  } catch (error) {
    if (error instanceof FirmDuplicateError) return duplicate(previous, values, error);
    return errorResult(error, previous, values, {
      route: `${ROUTE}/ny`,
      userId: context.actor.id,
    });
  }
  redirect(`${ROUTE}/${firmId}`);
}

/** «Lagre» på firmasiden. */
export async function updateFirmAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const firmId = String(formData.get("firmId") ?? "");
  const values = readFirm(formData);
  const context = await getEmployeeContext();
  if (!context || !isUuid(firmId)) return failure(previous, values, {}, NO_ACCESS);

  try {
    await updateFirm(context.actor, context.organizationId, firmId, firmInput(values));
  } catch (error) {
    if (error instanceof FirmDuplicateError) return duplicate(previous, values, error);
    return errorResult(error, previous, values, {
      route: ROUTE,
      userId: context.actor.id,
      firmId,
    });
  }
  redirect(`${ROUTE}/${firmId}`);
}
