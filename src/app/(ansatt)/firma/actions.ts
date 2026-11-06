"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AccessDeniedError } from "@/core/access";
import { isUuid } from "@/shared/lib/uuid";
import { errorResult, failure, type KnownError } from "../action-result";
import { getEmployeeContext } from "../employee-context";
import { NO_ACCESS, type FormState } from "../form-state";
import {
  createFirm,
  FirmDuplicateError,
  mergeFirms,
  MergeSameRecordError,
  removeFirm,
  updateFirm,
} from "@/core/contacts";

/*
 * Server actions i /firma. Ingen tilgangslogikk her: organisasjonen kommer fra
 * `getEmployeeContext()`, og kjernen sjekker rettigheten. Et felt `organizationId` i skjemaet
 * leses aldri. Loggen får bare rute, bruker-id, id-er og feilnavn, aldri skjemaverdier.
 */

const ROUTE = "/firma";

const FIRM_NOT_FOUND = "Firmaet finnes ikke.";
const SAME_FIRM = "Velg to ulike firma.";

/** Fremmed, ukjent, fjernet eller ugyldig id og manglende rettighet gir samme melding. */
const REMOVE_MERGE_ERRORS: readonly KnownError[] = [
  { error: MergeSameRecordError, message: SAME_FIRM },
  { error: AccessDeniedError, message: FIRM_NOT_FOUND },
];

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

/** Id fra skjemaet, trimmet. */
function readId(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

/** Stiene som viser firma, kontakter eller koblingene til dem. */
function revalidateFirmPaths() {
  revalidatePath("/firma");
  revalidatePath("/firma/[id]", "page");
  revalidatePath("/kontakter");
  revalidatePath("/kontakter/[id]", "page");
  revalidatePath("/oppdrag/[id]", "page");
  revalidatePath("/ordre/[id]", "page");
}

/**
 * «Fjern» i bekreftelsen på firmasiden (myk sletting i kjernen, `contacts.manage`). Kontaktene
 * beholdes uten firma. Ved suksess går man til listen med kvitteringen «<navn> er fjernet.»
 * (`?fjernet=<id>`; navnet slås opp på listesiden).
 */
export async function removeFirmAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const firmId = readId(formData, "firmId");
  const context = await getEmployeeContext();
  if (!context) return failure(previous, {}, {}, NO_ACCESS);
  if (!isUuid(firmId)) return failure(previous, {}, {}, FIRM_NOT_FOUND);

  try {
    await removeFirm(context.actor, context.organizationId, firmId);
  } catch (error) {
    return errorResult(
      error,
      previous,
      {},
      { route: ROUTE, userId: context.actor.id, firmId },
      { known: REMOVE_MERGE_ERRORS },
    );
  }
  revalidateFirmPaths();
  redirect(`${ROUTE}?fjernet=${firmId}`);
}

/**
 * «Slå sammen» på /firma/[id]/sla-sammen. Kontakter, parter og ordrer flyttes til `keepId`, og
 * `removeId` fjernes (kjernen, `contacts.manage`). Ved suksess går man til firmaet som beholdes.
 */
export async function mergeFirmsAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const keepId = readId(formData, "keepId");
  const removeId = readId(formData, "removeId");
  const context = await getEmployeeContext();
  if (!context) return failure(previous, {}, {}, NO_ACCESS);
  if (!isUuid(keepId) || !isUuid(removeId)) return failure(previous, {}, {}, FIRM_NOT_FOUND);

  try {
    await mergeFirms(context.actor, context.organizationId, { keepId, removeId });
  } catch (error) {
    return errorResult(
      error,
      previous,
      {},
      { route: `${ROUTE}/sla-sammen`, userId: context.actor.id, keepId, removeId },
      { known: REMOVE_MERGE_ERRORS },
    );
  }
  revalidateFirmPaths();
  redirect(`${ROUTE}/${keepId}?sammenslatt=1`);
}
