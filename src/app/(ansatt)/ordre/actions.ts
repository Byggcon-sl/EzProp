"use server";

import { redirect } from "next/navigation";
import { isUuid } from "@/shared/lib/uuid";
import { errorResult, failure, type KnownError } from "../action-result";
import { getEmployeeContext } from "../employee-context";
import { NO_ACCESS, type FormState } from "../form-state";
import {
  convertOrderToAssignment,
  createOrder,
  OfficeNotFoundError,
  OrderAlreadyHandledError,
  rejectOrder,
} from "@/core/orders";
import { parseOsloDateTimeLocal } from "./received-at";

/*
 * Server actions i /ordre. Ingen tilgangslogikk her: organisasjonen kommer fra
 * `getEmployeeContext()`, og kjernen sjekker rettigheten. Et felt `organizationId` i skjemaet
 * leses aldri. Skjemaet setter aldri `source` eller rapporttype; kjernen setter `manual` og
 * `condition_report`.
 */

const ROUTE = "/ordre";

/** Feilene fra kjernen som ordresidene viser med egen tekst. */
const ORDER_ERRORS: readonly KnownError[] = [
  { error: OrderAlreadyHandledError, message: "Ordren er allerede behandlet." },
  { error: OfficeNotFoundError, field: "officeId", message: "Kontoret finnes ikke." },
];

const ORDER_TEXT_FIELDS = [
  "addressText",
  "receivedAt",
  "externalRef",
  "orderedByText",
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

  const input = {
    addressText: (values.addressText ?? "").trim(),
    receivedAt: receivedAt?.toISOString(),
    externalRef: optional(values.externalRef),
    orderedByText: optional(values.orderedByText),
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
