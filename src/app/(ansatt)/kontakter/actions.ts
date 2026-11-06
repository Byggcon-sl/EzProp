"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AccessDeniedError } from "@/core/access";
import { logger } from "@/shared/lib/logger";
import { isUuid } from "@/shared/lib/uuid";
import { errorResult, failure, type KnownError } from "../action-result";
import { getEmployeeContext } from "../employee-context";
import { NO_ACCESS, type FormState } from "../form-state";
import {
  createContact,
  FirmNotFoundError,
  listContacts,
  mergeContacts,
  MergeSameRecordError,
  removeContact,
  updateContact,
} from "@/core/contacts";
import { contactName } from "./contact-name";

/*
 * Server actions i /kontakter. Ingen tilgangslogikk her: organisasjonen kommer fra
 * `getEmployeeContext()`, og kjernen sjekker rettigheten. Skjemaet setter aldri `source`
 * (kjernen setter `manual`), og et felt `organizationId` leses aldri. Kontakter er
 * personopplysninger: loggen får bare rute, bruker-id, id-er og feilnavn.
 */

const ROUTE = "/kontakter";

const FIRM_NOT_FOUND = "Firmaet finnes ikke.";
const CONTACT_NOT_FOUND = "Kontakten finnes ikke.";
const SAME_CONTACT = "Velg to ulike kontakter.";

/** Fremmed, ukjent, fjernet eller ugyldig id og manglende rettighet gir samme melding. */
const REMOVE_MERGE_ERRORS: readonly KnownError[] = [
  { error: MergeSameRecordError, message: SAME_CONTACT },
  { error: AccessDeniedError, message: CONTACT_NOT_FOUND },
];

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

/** Id fra skjemaet, trimmet. */
function readId(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

/** Stiene som viser kontakter, firma eller koblingene til dem. */
function revalidateContactPaths() {
  revalidatePath("/kontakter");
  revalidatePath("/kontakter/[id]", "page");
  revalidatePath("/firma/[id]", "page");
  revalidatePath("/oppdrag/[id]", "page");
  revalidatePath("/ordre/[id]", "page");
}

/**
 * «Fjern» i bekreftelsen på kontaktsiden (myk sletting i kjernen, `contacts.manage`). Ved suksess
 * går man til listen med kvitteringen «<navn> er fjernet.» (`?fjernet=<id>`; navnet slås opp på
 * listesiden, så det står aldri i adressen).
 */
export async function removeContactAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const contactId = readId(formData, "contactId");
  const context = await getEmployeeContext();
  if (!context) return failure(previous, {}, {}, NO_ACCESS);
  if (!isUuid(contactId)) return failure(previous, {}, {}, CONTACT_NOT_FOUND);

  try {
    await removeContact(context.actor, context.organizationId, contactId);
  } catch (error) {
    return errorResult(
      error,
      previous,
      {},
      { route: ROUTE, userId: context.actor.id, contactId },
      { known: REMOVE_MERGE_ERRORS },
    );
  }
  revalidateContactPaths();
  redirect(`${ROUTE}?fjernet=${contactId}`);
}

/**
 * «Slå sammen» på /kontakter/[id]/sla-sammen. Parter og ordrer flyttes til `keepId`, og `removeId`
 * fjernes (kjernen, `contacts.manage`). Ved suksess går man til kontakten som beholdes.
 */
export async function mergeContactsAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const keepId = readId(formData, "keepId");
  const removeId = readId(formData, "removeId");
  const context = await getEmployeeContext();
  if (!context) return failure(previous, {}, {}, NO_ACCESS);
  if (!isUuid(keepId) || !isUuid(removeId)) return failure(previous, {}, {}, CONTACT_NOT_FOUND);

  try {
    await mergeContacts(context.actor, context.organizationId, { keepId, removeId });
  } catch (error) {
    return errorResult(
      error,
      previous,
      {},
      { route: `${ROUTE}/sla-sammen`, userId: context.actor.id, keepId, removeId },
      { known: REMOVE_MERGE_ERRORS },
    );
  }
  revalidateContactPaths();
  redirect(`${ROUTE}/${keepId}?sammenslatt=1`);
}

/** Ett treff i kontaktvelgeren: bare det som fylles ut i skjemaet. */
export type ContactHit = {
  id: string;
  name: string;
  firmName: string | null;
  email: string | null;
  phone: string | null;
};

/** Søket starter først ved så mange tegn. */
const MIN_SEARCH_LENGTH = 2;

/** Kontaktvelgeren viser høyst så mange treff. */
const MAX_SEARCH_HITS = 10;

/**
 * Søket i kontaktvelgeren (partene på oppdraget og bestilleren på ny ordre). Kaller den samme
 * `listContacts` som /kontakter, så tilgangen (`organization.read`) og organisasjonen sjekkes i
 * kjernen. Under 2 tegn gir ingen treff uten kall. Ingen tilgang eller en feil gir tom liste,
 * aldri et unntak ut. Loggen får aldri søketeksten eller kontaktdata. Treffene sendes aldri til KI.
 */
export async function searchContactsAction(query: string): Promise<ContactHit[]> {
  const text = typeof query === "string" ? query.trim() : "";
  if (text.length < MIN_SEARCH_LENGTH) return [];

  // Som de andre handlingene: uten innlogging sendes man til innloggingen (requireActor).
  const context = await getEmployeeContext();
  if (!context) return [];
  try {
    const rows = await listContacts(context.actor, context.organizationId, {
      query: text,
      limit: MAX_SEARCH_HITS,
    });
    return rows.slice(0, MAX_SEARCH_HITS).map((row) => ({
      id: row.id,
      name: contactName(row),
      firmName: row.firmName ?? null,
      email: row.email ?? null,
      phone: row.phone ?? null,
    }));
  } catch (error) {
    if (!(error instanceof AccessDeniedError)) {
      logger.error("Søk i kontakter feilet", {
        route: ROUTE,
        userId: context.actor.id,
        errorName: error instanceof Error ? error.name : "ukjent feil",
      });
    }
    return [];
  }
}
