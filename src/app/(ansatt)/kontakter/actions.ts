"use server";

import { redirect } from "next/navigation";
import { isUuid } from "@/shared/lib/uuid";
import { errorResult, failure, type KnownError } from "../action-result";
import { getEmployeeContext } from "../employee-context";
import { NO_ACCESS, type FormState } from "../form-state";
import { createContact, FirmNotFoundError, updateContact } from "@/core/contacts";

/*
 * Server actions i /kontakter. Ingen tilgangslogikk her: organisasjonen kommer fra
 * `getEmployeeContext()`, og kjernen sjekker rettigheten. Skjemaet setter aldri `source`
 * (kjernen setter `manual`), og et felt `organizationId` leses aldri. Kontakter er
 * personopplysninger: loggen får bare rute, bruker-id, id-er og feilnavn.
 */

const ROUTE = "/kontakter";

const FIRM_NOT_FOUND = "Firmaet finnes ikke.";

const CONTACT_ERRORS: readonly KnownError[] = [
  { error: FirmNotFoundError, field: "firmId", message: FIRM_NOT_FOUND },
];

const CONTACT_FIELDS = ["firstName", "lastName", "email", "phone", "firmId", "notes"] as const;

function readContact(formData: FormData) {
  const values: Record<string, string> = {};
  for (const name of CONTACT_FIELDS) values[name] = String(formData.get(name) ?? "");
  return values;
}

/** Valget «Ingen» i firmalisten sendes som tom verdi og blir `null`. */
function contactInput(values: Record<string, string>) {
  const firmId = (values.firmId ?? "").trim();
  return {
    firstName: values.firstName ?? "",
    lastName: values.lastName ?? "",
    email: values.email ?? "",
    phone: values.phone ?? "",
    firmId: firmId === "" ? null : firmId,
    notes: values.notes ?? "",
  };
}

/** En firma-id som ikke er uuid, kan ikke finnes. Kjernen kalles ikke. */
function invalidFirm(previous: FormState, values: Record<string, string>): FormState | null {
  const firmId = (values.firmId ?? "").trim();
  return firmId !== "" && !isUuid(firmId)
    ? failure(previous, values, { firmId: FIRM_NOT_FOUND })
    : null;
}

/** «Lagre» på /kontakter/ny. Ved suksess går man til kontaktsiden. */
export async function createContactAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = readContact(formData);
  const context = await getEmployeeContext();
  if (!context) return failure(previous, values, {}, NO_ACCESS);
  const badFirm = invalidFirm(previous, values);
  if (badFirm) return badFirm;

  let contactId: string;
  try {
    const contact = await createContact(
      context.actor,
      context.organizationId,
      contactInput(values),
    );
    contactId = contact.id;
  } catch (error) {
    return errorResult(
      error,
      previous,
      values,
      { route: `${ROUTE}/ny`, userId: context.actor.id },
      { known: CONTACT_ERRORS },
    );
  }
  redirect(`${ROUTE}/${contactId}`);
}

/** «Lagre» på kontaktsiden. */
export async function updateContactAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const contactId = String(formData.get("contactId") ?? "");
  const values = readContact(formData);
  const context = await getEmployeeContext();
  if (!context || !isUuid(contactId)) return failure(previous, values, {}, NO_ACCESS);
  const badFirm = invalidFirm(previous, values);
  if (badFirm) return badFirm;

  try {
    await updateContact(context.actor, context.organizationId, contactId, contactInput(values));
  } catch (error) {
    return errorResult(
      error,
      previous,
      values,
      { route: ROUTE, userId: context.actor.id, contactId },
      { known: CONTACT_ERRORS },
    );
  }
  redirect(`${ROUTE}/${contactId}`);
}
