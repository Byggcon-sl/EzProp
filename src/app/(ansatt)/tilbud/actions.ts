"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isUuid } from "@/shared/lib/uuid";
import { errorResult, failure, type KnownError } from "../action-result";
import { getEmployeeContext } from "../employee-context";
import { NO_ACCESS, type FormState } from "../form-state";
import { ContactNotFoundError } from "@/core/contacts";
import {
  convertOrderToAssignment,
  createOrder,
  OfficeNotFoundError,
  OrderAlreadyHandledError,
  OrderChangedError,
  rejectOrder,
  updateOrder,
  type OrderInput,
} from "@/core/orders";
import { ORDER_CHANGED_MESSAGE, readOrderValues } from "./order-values";
import { parseOsloDateTimeLocal } from "./received-at";

/*
 * Server actions i /ordre. Ingen tilgangslogikk her: organisasjonen kommer fra
 * `getEmployeeContext()`, og kjernen sjekker rettigheten. Et felt `organizationId` i skjemaet
 * leses aldri. Skjemaet setter aldri `source` eller rapporttype; kjernen setter `manual` og
 * `condition_report`.
 */

const ROUTE = "/ordre";

const CONTACT_NOT_FOUND = "Kontakten finnes ikke.";
const RECEIVED_AT_REQUIRED = "Skriv inn dato og klokkeslett.";

/** Feilene fra kjernen som ordresidene viser med egen tekst. */
const ORDER_ERRORS: readonly KnownError[] = [
  { error: OrderAlreadyHandledError, message: "Ordren er allerede behandlet." },
  { error: OrderChangedError, message: ORDER_CHANGED_MESSAGE },
  { error: OfficeNotFoundError, field: "officeId", message: "Kontoret finnes ikke." },
  { error: ContactNotFoundError, field: "orderedByContactId", message: CONTACT_NOT_FOUND },
];

/** Tomme valgfrie felt sendes ikke til kjernen. */
function optional(value: string | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Bygger ordren til kjernen fra skjemaverdiene, likt for «Ny ordre» og «Endre ordren».
 * Mottatt: tomt felt gir `undefined` (kjernen bruker nå ved oppretting og lar feltet stå ved
 * endring), annet enn dato og klokkeslett stoppes her. En bestiller-id som ikke er uuid, kan ikke finnes; kjernen kalles ikke.
 */
function buildOrderInput(
  values: Record<string, string>,
): { input: OrderInput } | { fieldErrors: Record<string, string> } {
  const receivedAtText = (values.receivedAt ?? "").trim();
  const receivedAt = receivedAtText === "" ? undefined : parseOsloDateTimeLocal(receivedAtText);
  if (receivedAt === null) return { fieldErrors: { receivedAt: RECEIVED_AT_REQUIRED } };
  const orderedByContactId = optional(values.orderedByContactId) ?? null;
  if (orderedByContactId !== null && !isUuid(orderedByContactId)) {
    return { fieldErrors: { orderedByContactId: CONTACT_NOT_FOUND } };
  }
  return {
    input: {
      addressText: (values.addressText ?? "").trim(),
      receivedAt: receivedAt?.toISOString(),
      externalRef: optional(values.externalRef),
      orderedByText: optional(values.orderedByText),
      orderedByContactId,
      gnr: optional(values.gnr),
      bnr: optional(values.bnr),
      snr: optional(values.snr),
      housingAssociationName: optional(values.housingAssociationName),
      sellerDeclarationReceived: values.sellerDeclarationReceived === "on",
    },
  };
}

/** «Lagre» på /ordre/ny. Ved suksess går man til ordresiden. */
export async function createOrderAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = readOrderValues(formData);
  const context = await getEmployeeContext();
  if (!context) return failure(previous, values, {}, NO_ACCESS);

  const built = buildOrderInput(values);
  if ("fieldErrors" in built) return failure(previous, values, built.fieldErrors);
  const input = built.input;

  let orderId: string;
  try {
    const order = await createOrder(context.actor, context.organizationId, input);
    orderId = order.id;
  } catch (error) {
    return errorResult(
      error,
      previous,
      values,
      { route: `${ROUTE}/ny`, userId: context.actor.id },
      { known: ORDER_ERRORS },
    );
  }
  redirect(`${ROUTE}/${orderId}`);
}

/**
 * «Lagre» i «Endre ordren» på ordresiden (T1). Virker for alle statuser; kjernen sjekker tilgangen
 * og låsen med `rowVersion` (A253). Ved suksess går man tilbake til ordresiden med kvitteringen.
 * Tom «Mottatt» betyr uendret (kjernen).
 */
export async function updateOrderAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const orderId = String(formData.get("orderId") ?? "");
  const values = readOrderValues(formData);
  const context = await getEmployeeContext();
  if (!context || !isUuid(orderId)) return failure(previous, values, {}, NO_ACCESS);

  // Versjonen skjemaet ble åpnet med. Tuklet eller manglende verdi gir konfliktmeldingen.
  const rowVersionText = String(formData.get("rowVersion") ?? "").trim();
  const rowVersion = /^\d{1,9}$/.test(rowVersionText) ? Number(rowVersionText) : null;
  if (rowVersion === null) return failure(previous, values, {}, ORDER_CHANGED_MESSAGE);

  const built = buildOrderInput(values);
  if ("fieldErrors" in built) return failure(previous, values, built.fieldErrors);

  try {
    await updateOrder(context.actor, context.organizationId, orderId, built.input, rowVersion);
  } catch (error) {
    return errorResult(
      error,
      previous,
      values,
      { route: `${ROUTE}/${orderId}`, userId: context.actor.id, orderId },
      { known: ORDER_ERRORS },
    );
  }
  revalidatePath(`${ROUTE}/${orderId}`);
  redirect(`${ROUTE}/${orderId}?endret=1`);
}

/** «Avvis» på ordresiden. Grunnen som må fylles ut, er bekreftelsen. */
export async function rejectOrderAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const orderId = String(formData.get("orderId") ?? "");
  const values = { reason: String(formData.get("reason") ?? "") };
  const context = await getEmployeeContext();
  if (!context || !isUuid(orderId)) return failure(previous, values, {}, NO_ACCESS);

  const reason = values.reason.trim();
  if (reason === "") return failure(previous, values, { reason: "Skriv inn en grunn." });

  try {
    await rejectOrder(context.actor, context.organizationId, orderId, reason);
  } catch (error) {
    return errorResult(
      error,
      previous,
      values,
      { route: ROUTE, userId: context.actor.id, orderId },
      { known: ORDER_ERRORS, zodField: "reason" },
    );
  }
  redirect(`${ROUTE}/${orderId}`);
}

/** «Gjør om til oppdrag» på ordresiden. Nummeret lages i kjernen og vises på ordresiden. */
export async function convertOrderAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const orderId = String(formData.get("orderId") ?? "");
  const values = { officeId: String(formData.get("officeId") ?? "") };
  const context = await getEmployeeContext();
  if (!context || !isUuid(orderId)) return failure(previous, values, {}, NO_ACCESS);

  const officeId = values.officeId.trim();
  if (officeId === "") return failure(previous, values, { officeId: "Velg et kontor." });
  if (!isUuid(officeId)) return failure(previous, values, { officeId: "Kontoret finnes ikke." });

  try {
    await convertOrderToAssignment(context.actor, context.organizationId, orderId, { officeId });
  } catch (error) {
    return errorResult(
      error,
      previous,
      values,
      { route: ROUTE, userId: context.actor.id, orderId, officeId },
      { known: ORDER_ERRORS },
    );
  }
  redirect(`${ROUTE}/${orderId}`);
}
