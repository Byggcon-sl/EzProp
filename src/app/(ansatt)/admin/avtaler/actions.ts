"use server";

import { redirect } from "next/navigation";
import { isUuid } from "@/shared/lib/uuid";
import { errorResult, failure, type KnownError } from "../../action-result";
import { getEmployeeContext } from "../../employee-context";
import { NO_ACCESS, type FormState } from "../../form-state";
import {
  AgreementFirmNotFoundError,
  createAgreement,
  deleteAgreement,
  NotFoundError,
  updateAgreement,
} from "@/core/agreements";

/*
 * Server actions for avtaler med oppdragsgiver. Ingen tilgangslogikk her: organisasjonen kommer
 * fra `getEmployeeContext()`, og kjernen krever `organization.manage` (admin, A108). Et felt
 * `organizationId` i skjemaet leses aldri. Id-er som ikke er uuid stoppes før kjernen kalles.
 * Loggen får bare rute, bruker-id, id-er og feilnavn, aldri premisseteksten (A112).
 */

const ROUTE = "/admin/avtaler";

const TEXT_FIELDS = [
  "firmId",
  "name",
  "validFrom",
  "validTo",
  "premiseText",
  "reportProfileCode",
] as const;

/** Firmaet er fjernet eller finnes ikke i organisasjonen (eller avtalen er fjernet). */
const AGREEMENT_ERRORS: readonly KnownError[] = [
  { error: AgreementFirmNotFoundError, field: "firmId", message: "Firmaet finnes ikke." },
  { error: NotFoundError, message: "Fant ikke avtalen eller firmaet. Last siden på nytt." },
];

function readAgreementForm(formData: FormData) {
  const values = {} as Record<(typeof TEXT_FIELDS)[number], string>;
  for (const name of TEXT_FIELDS) values[name] = String(formData.get(name) ?? "");
  const input = {
    firmId: values.firmId.trim(),
    name: values.name,
    validFrom: values.validFrom.trim(),
    validTo: values.validTo,
    premiseText: values.premiseText,
    reportProfileCode: values.reportProfileCode,
  };
  return { values, input };
}

/**
 * «Lagre avtalen». Tomt `id` lager en ny avtale; ellers endres avtalen med den id-en.
 */
export async function saveAgreementAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { values, input } = readAgreementForm(formData);
  const id = String(formData.get("id") ?? "").trim();
  const context = await getEmployeeContext();
  if (!context) return failure(previous, values, {}, NO_ACCESS);
  if (id !== "" && !isUuid(id)) return failure(previous, values, {}, NO_ACCESS);

  try {
    if (id === "") await createAgreement(context.actor, context.organizationId, input);
    else await updateAgreement(context.actor, context.organizationId, id, input);
  } catch (error) {
    return errorResult(
      error,
      previous,
      values,
      { route: ROUTE, userId: context.actor.id, ...(id && { agreementId: id }) },
      { known: AGREEMENT_ERRORS },
    );
  }
  redirect("/admin/avtaler?lagret=avtale");
}

/** «Fjern avtalen» etter bekreftelse. Myk sletting i kjernen. */
export async function deleteAgreementAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = String(formData.get("id") ?? "").trim();
  const context = await getEmployeeContext();
  if (!context || !isUuid(id)) return failure(previous, {}, {}, NO_ACCESS);

  try {
    await deleteAgreement(context.actor, context.organizationId, id);
  } catch (error) {
    return errorResult(
      error,
      previous,
      {},
      { route: ROUTE, userId: context.actor.id, agreementId: id },
      { known: AGREEMENT_ERRORS },
    );
  }
  redirect("/admin/avtaler?lagret=avtale-fjernet");
}
