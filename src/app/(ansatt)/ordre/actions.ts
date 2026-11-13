"use server";

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
} from "@/core/orders";
import { ORDER_CHANGED } from "./order-messages";
import { osloDateTimeLocal, parseOsloDateTimeLocal } from "./received-at";

/*
 * Server actions i /ordre. Ingen tilgangslogikk her: organisasjonen kommer fra
 * `getEmployeeContext()`, og kjernen sjekker rettigheten. Et felt `organizationId` i skjemaet
 * leses aldri. Skjemaet setter aldri `source` eller rapporttype; kjernen setter `manual` og
 * `condition_report`.
 */

const ROUTE = "/ordre";

const CONTACT_NOT_FOUND = "Kontakten finnes ikke.";

/** Feilene fra kjernen som ordresidene viser med egen tekst. */
const ORDER_ERRORS: readonly KnownError[] = [
  { error: OrderAlreadyHandledError, message: "Ordren er allerede behandlet." },
  { error: OfficeNotFoundError, field: "officeId", message: "Kontoret finnes ikke." },
  { error: ContactNotFoundError, field: "orderedByContactId", message: CONTACT_NOT_FOUND },
];

const ORDER_TEXT_FIELDS = [
  "addressText",
  "receivedAt",
  "externalRef",
  "orderedByText",
  "orderedByContactId",
  "gnr",
  "bnr",
  "snr",
  "housingAssociationName",
] as const;

function readOrder(formData: FormData) {
  const values: Record<string, string> = {};
  for (const name of ORDER_TEXT_FIELDS) values[name] = String(formData.get(name) ?? "");
  // Avkrysningen sendes bare når den er krysset av.
  if (formData.get("sellerDeclarationReceived") !== null) values.sellerDeclarationReceived = "on";
  return values;
}

/** Tomme valgfrie felt sendes ikke til kjernen. */
function optional(value: string | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? undefined : trimmed;
}

/** «Lagre» på /ordre/ny. Ved suksess går man til ordresiden. */
export async function createOrderAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = readOrder(formData);
  const context = await getEmployeeContext();
  if (!context) return failure(previous, values, {}, NO_ACCESS);

  // Tomt felt: kjernen bruker nå. Annet enn dato og klokkeslett stoppes her.
  const receivedAtText = (values.receivedAt ?? "").trim();
  const receivedAt = receivedAtText === "" ? undefined : parseOsloDateTimeLocal(receivedAtText);
  if (receivedAt === null) {
    return failure(previous, values, { receivedAt: "Skriv inn dato og klokkeslett." });
  }
  // Bestilleren fra kontaktvelgeren. En id som ikke er uuid, kan ikke finnes; kjernen kalles ikke.
  const orderedByContactId = optional(values.orderedByContactId) ?? null;
  if (orderedByContactId !== null && !isUuid(orderedByContactId)) {
    return failure(previous, values, { orderedByContactId: CONTACT_NOT_FOUND });
  }

  const input = {
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
  };

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

/** Feilene ved «Endre ordren»: som ved ny ordre, pluss at en annen har lagret i mellomtiden. */
const UPDATE_ERRORS: readonly KnownError[] = [
  ...ORDER_ERRORS,
  { error: OrderChangedError, message: ORDER_CHANGED },
];

/**
 * Mottatt slik det sto da skjemaet ble åpnet. Står feltet uendret, sendes det lagrede tidspunktet
 * (med sekunder), så en lagring uten endring ikke blir en endring av «Mottatt».
 */
function unchangedReceivedAt(text: string, originalIso: string): string | null {
  const original = new Date(originalIso);
  if (originalIso === "" || Number.isNaN(original.getTime())) return null;
  return osloDateTimeLocal(original) === text ? original.toISOString() : null;
}

/**
 * «Lagre» i «Endre ordren» på ordresiden, i alle statuser. `rowVersion` er versjonen skjemaet ble
 * åpnet med; kjernen avviser lagringen hvis en annen har lagret siden. Ved suksess går man til
 * ordresiden med kvitteringen. Loggen får bare id-er og feilnavn, aldri verdiene i skjemaet.
 */
export async function updateOrderAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const orderId = String(formData.get("orderId") ?? "");
  const values = readOrder(formData);
  const context = await getEmployeeContext();
  if (!context || !isUuid(orderId)) return failure(previous, values, {}, NO_ACCESS);

  // Versjonen skal være et heltall fra skjemaet. Mangler den, må siden lastes på nytt.
  const rowVersionText = String(formData.get("rowVersion") ?? "").trim();
  const expectedRowVersion = /^\d{1,9}$/.test(rowVersionText) ? Number(rowVersionText) : null;
  if (expectedRowVersion === null) return failure(previous, values, {}, ORDER_CHANGED);

  // Mottatt kan ikke tømmes på en lagret ordre (tomt ville gitt «nå»).
  const receivedAtText = (values.receivedAt ?? "").trim();
  const receivedAt = parseOsloDateTimeLocal(receivedAtText);
  if (receivedAt === null) {
    return failure(previous, values, { receivedAt: "Skriv inn dato og klokkeslett." });
  }
  const orderedByContactId = optional(values.orderedByContactId) ?? null;
  if (orderedByContactId !== null && !isUuid(orderedByContactId)) {
    return failure(previous, values, { orderedByContactId: CONTACT_NOT_FOUND });
  }

  // Tomt felt sendes som `null`, så det som er tømt, blir tomt.
  const input = {
    addressText: (values.addressText ?? "").trim(),
    receivedAt:
      unchangedReceivedAt(receivedAtText, String(formData.get("receivedAtOriginal") ?? "")) ??
      receivedAt.toISOString(),
    externalRef: optional(values.externalRef) ?? null,
    orderedByText: optional(values.orderedByText) ?? null,
    orderedByContactId,
    gnr: optional(values.gnr) ?? null,
    bnr: optional(values.bnr) ?? null,
    snr: optional(values.snr) ?? null,
    housingAssociationName: optional(values.housingAssociationName) ?? null,
    sellerDeclarationReceived: values.sellerDeclarationReceived === "on",
  };

  try {
    await updateOrder(context.actor, context.organizationId, orderId, input, expectedRowVersion);
  } catch (error) {
    return errorResult(
      error,
      previous,
      values,
      { route: ROUTE, userId: context.actor.id, orderId },
      { known: UPDATE_ERRORS },
    );
  }
  redirect(`${ROUTE}/${orderId}?lagret=endret`);
}
