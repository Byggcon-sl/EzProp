"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logger } from "@/shared/lib/logger";
import { isUuid } from "@/shared/lib/uuid";
import { errorResult, failure, type KnownError } from "../action-result";
import { getEmployeeContext } from "../employee-context";
import { NO_ACCESS, UNKNOWN_ERROR, type FormState } from "../form-state";
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
import {
  initialOrderEditState,
  ORDER_CHANGED_MESSAGE,
  type OrderEditState,
  type OrderFormErrorCode,
} from "./order-form-error";
import { parseOsloDateTimeLocal } from "./received-at";

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

/** Feilkoden til skjemaet «Endre ordren» ut fra meldingen øverst. Feil ved feltene har ingen kode. */
function editCode(state: FormState): OrderFormErrorCode | null {
  if (state.message === NO_ACCESS) return "NO_ACCESS";
  if (state.message === UNKNOWN_ERROR) return "UNKNOWN";
  return null;
}

function editFailure(state: FormState): OrderEditState {
  return { ...state, code: editCode(state), saved: false };
}

/** Tomt valgfritt felt sendes som `null`, slik at det kan tømmes ved endring. */
function clearable(value: string | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * «Lagre» i skjemaet «Endre ordren» på ordresiden. Ordre-id og `rowVersion` kommer fra skjulte
 * felt. Alle innsendte verdier følger med tilbake ved feil, så ingenting som er skrevet går tapt.
 * `orderedByFirmId` sendes aldri: firmaet utledes av kjernen fra kontakten. Logglinjene har bare
 * rute, bruker-id, ordre-id og feilkode, aldri verdier fra skjemaet.
 */
export async function updateOrderAction(
  previous: OrderEditState,
  formData: FormData,
): Promise<OrderEditState> {
  const orderId = String(formData.get("orderId") ?? "");
  const values: Record<string, string> = {
    ...readOrder(formData),
    receivedAtInitial: String(formData.get("receivedAtInitial") ?? ""),
  };
  const context = await getEmployeeContext();
  if (!context || !isUuid(orderId)) {
    return { ...failure(previous, values, {}, NO_ACCESS), code: "NO_ACCESS", saved: false };
  }
  const log = { route: `${ROUTE}/${orderId}`, userId: context.actor.id, orderId };

  const rowVersionText = String(formData.get("rowVersion") ?? "").trim();
  const expectedRowVersion = /^\d{1,9}$/.test(rowVersionText) ? Number(rowVersionText) : null;
  if (expectedRowVersion === null) return orderChanged(previous, values, log);

  // Tomt felt eller uendret tidspunkt: kjernen beholder verdien på raden (sekundene går ikke tapt).
  const receivedAtText = (values.receivedAt ?? "").trim();
  const keepReceivedAt = receivedAtText === "" || receivedAtText === values.receivedAtInitial;
  const receivedAt = keepReceivedAt ? undefined : parseOsloDateTimeLocal(receivedAtText);
  if (receivedAt === null) {
    return editFailure(failure(previous, values, { receivedAt: "Skriv inn dato og klokkeslett." }));
  }
  const orderedByContactId = clearable(values.orderedByContactId);
  if (orderedByContactId !== null && !isUuid(orderedByContactId)) {
    return editFailure(failure(previous, values, { orderedByContactId: CONTACT_NOT_FOUND }));
  }

  const input = {
    addressText: (values.addressText ?? "").trim(),
    receivedAt: receivedAt?.toISOString(),
    externalRef: clearable(values.externalRef),
    orderedByText: clearable(values.orderedByText),
    orderedByContactId,
    gnr: clearable(values.gnr),
    bnr: clearable(values.bnr),
    snr: clearable(values.snr),
    housingAssociationName: clearable(values.housingAssociationName),
    sellerDeclarationReceived: values.sellerDeclarationReceived === "on",
  };

  try {
    await updateOrder(context.actor, context.organizationId, orderId, input, expectedRowVersion);
  } catch (error) {
    if (error instanceof OrderChangedError) return orderChanged(previous, values, log);
    return editFailure(errorResult(error, previous, values, log, { known: ORDER_ERRORS }));
  }
  revalidatePath(`${ROUTE}/${orderId}`);
  revalidatePath(ROUTE);
  return { ...initialOrderEditState, attempt: previous.attempt + 1, saved: true };
}

/** En annen har lagret ordren etter at skjemaet ble åpnet. Det som er skrevet, står igjen. */
function orderChanged(
  previous: OrderEditState,
  values: Record<string, string>,
  log: { route: string; userId: string; orderId: string },
): OrderEditState {
  logger.warn("Ordren er endret av en annen", { ...log, code: "ORDER_CHANGED" });
  return {
    ...failure(previous, values, {}, ORDER_CHANGED_MESSAGE),
    code: "ORDER_CHANGED",
    saved: false,
  };
}
