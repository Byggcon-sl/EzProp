"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addDays, todayInOslo } from "@/shared/lib/dates";
import { isUuid } from "@/shared/lib/uuid";
import { errorResult, failure, type KnownError } from "../action-result";
import { getEmployeeContext } from "../employee-context";
import { NO_ACCESS, type FormState } from "../form-state";
import { ContactNotFoundError } from "@/core/contacts";
import {
  convertOrderToAssignment,
  createOrder,
  getOrder,
  OFFER_REJECTION_REASON_KEYS,
  OFFER_VALID_DAYS,
  OfferValidUntilLockedError,
  OfficeNotFoundError,
  OrderAlreadyHandledError,
  OrderChangedError,
  rejectOrder,
  updateOrder,
} from "@/core/orders";
import type { OfferInput } from "@/core/orders/contract";
import { ORDER_CHANGED_MESSAGE, readOfferValues } from "../order-values";
import { formatIsoDate, parseOsloDateTimeLocal } from "./received-at";

/*
 * Server actions i /tilbud. Ingen tilgangslogikk her: organisasjonen kommer fra
 * `getEmployeeContext()` (`grant.organizationId`), og kjernen sjekker rettigheten. Et felt
 * `organizationId` i skjemaet leses aldri. Skjemaet setter aldri `source` eller rapporttype;
 * kjernen setter `manual` og `condition_report`. Kvitteringer kommer fra svaret på handlingen,
 * aldri fra adressen (T-0089), unntatt «Tilbudet er laget.» som står på en ny side (`?ny=1`).
 */

const ROUTE = "/tilbud";

const CONTACT_NOT_FOUND = "Kontakten finnes ikke.";
const RECEIVED_AT_REQUIRED = "Skriv inn dato og klokkeslett.";
const OFFER_HANDLED_MESSAGE = "Tilbudet er allerede gjort om eller avslått.";
const VALID_UNTIL_LOCKED = "Gyldig til kan bare endres på åpne og utløpte tilbud.";
const CHOOSE_REASON = "Velg en grunn.";
const WRITE_REASON = "Skriv grunnen.";
const CHOOSE_OFFICE = "Velg kontor.";
const OFFICE_NOT_FOUND = "Kontoret finnes ikke.";

/** Feilene fra kjernen som tilbudssidene viser med egen tekst. */
const OFFER_ERRORS: readonly KnownError[] = [
  { error: OrderAlreadyHandledError, message: OFFER_HANDLED_MESSAGE },
  { error: OrderChangedError, message: ORDER_CHANGED_MESSAGE },
  { error: OfferValidUntilLockedError, field: "validUntil", message: VALID_UNTIL_LOCKED },
  { error: OfficeNotFoundError, field: "officeId", message: OFFICE_NOT_FOUND },
  { error: ContactNotFoundError, field: "orderedByContactId", message: CONTACT_NOT_FOUND },
];

/** «Forleng» har ikke datofeltet på skjermen, så låst dato står som melding over knappen. */
const EXTEND_ERRORS: readonly KnownError[] = [
  { error: OfferValidUntilLockedError, message: VALID_UNTIL_LOCKED },
  ...OFFER_ERRORS,
];

/**
 * Svaret fra handlingene på tilbudssiden og i listen. `notice` er kvitteringen (T-0089), og `done`
 * sier at handlingen lyktes (også når ingenting ble endret og det ikke er noen kvittering).
 */
export type OfferActionState = FormState & { notice?: string | null; done?: boolean };

/** Tomme valgfrie felt sendes ikke til kjernen. */
function optional(value: string | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Versjonen skjemaet ble åpnet med, eller `null` når den mangler eller er tuklet med. */
function readRowVersion(formData: FormData): number | null {
  const text = String(formData.get("rowVersion") ?? "").trim();
  return /^\d{1,9}$/.test(text) ? Number(text) : null;
}

/**
 * Bygger tilbudet til kjernen fra skjemaverdiene, likt for «Nytt tilbud» og «Endre tilbudet».
 * Mottatt: tomt felt gir `undefined` (kjernen bruker nå ved oppretting og lar feltet stå ved
 * endring). Gyldig til: tomt felt gir `undefined` (kjernen bruker i dag + 30 ved oppretting og lar
 * datoen stå ved endring); grensene sjekkes i kjernen. En bestiller-id som ikke er uuid, kan ikke
 * finnes; kjernen kalles ikke.
 */
function buildOfferInput(
  values: Record<string, string>,
): { input: OfferInput } | { fieldErrors: Record<string, string> } {
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
      validUntil: optional(values.validUntil) ?? null,
    },
  };
}

/** «Lagre» på /tilbud/ny. Ved suksess går man til tilbudssiden med kvitteringen (A373). */
export async function createOfferAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = readOfferValues(formData);
  const context = await getEmployeeContext();
  if (!context) return failure(previous, values, {}, NO_ACCESS);

  const built = buildOfferInput(values);
  if ("fieldErrors" in built) return failure(previous, values, built.fieldErrors);

  let orderId: string;
  try {
    const order = await createOrder(context.actor, context.organizationId, built.input);
    orderId = order.id;
  } catch (error) {
    return errorResult(
      error,
      previous,
      values,
      { route: `${ROUTE}/ny`, userId: context.actor.id },
      { known: OFFER_ERRORS },
    );
  }
  redirect(`${ROUTE}/${orderId}?ny=1`);
}

/**
 * «Lagre» i «Endre tilbudet» (T1). Virker for alle statuser; «Gyldig til» bare på åpne og utløpte
 * (kjernen, `OfferValidUntilLockedError`). Kjernen sjekker tilgangen og låsen med `rowVersion`
 * (A253). Kvitteringen «Endringene er lagret.» kommer i svaret, og bare når noe ble endret
 * (versjonen økte). Tom «Mottatt» og tom «Gyldig til» betyr uendret.
 */
export async function updateOfferAction(
  previous: OfferActionState,
  formData: FormData,
): Promise<OfferActionState> {
  const orderId = String(formData.get("orderId") ?? "");
  const values = readOfferValues(formData);
  const context = await getEmployeeContext();
  if (!context || !isUuid(orderId)) return failure(previous, values, {}, NO_ACCESS);

  const rowVersion = readRowVersion(formData);
  if (rowVersion === null) return failure(previous, values, {}, ORDER_CHANGED_MESSAGE);

  const built = buildOfferInput(values);
  if ("fieldErrors" in built) return failure(previous, values, built.fieldErrors);

  let changed: boolean;
  try {
    const order = await updateOrder(
      context.actor,
      context.organizationId,
      orderId,
      built.input,
      rowVersion,
    );
    changed = order.rowVersion !== rowVersion;
  } catch (error) {
    return errorResult(
      error,
      previous,
      values,
      { route: `${ROUTE}/${orderId}`, userId: context.actor.id, orderId },
      { known: OFFER_ERRORS },
    );
  }
  revalidatePath(`${ROUTE}/${orderId}`);
  return {
    fieldErrors: {},
    message: null,
    values: {},
    attempt: previous.attempt,
    notice: changed ? "Endringene er lagret." : null,
    done: true,
  };
}

/**
 * «Forleng 30 dager» (F1, A365) på tilbudssiden og i listen. Setter «Gyldig til» til i dag +
 * `OFFER_VALID_DAYS` gjennom `updateOrder`, så endringen står i historikken og følger reglene for
 * datoen (bare åpne og utløpte). De andre feltene sendes uendret fra den lagrede raden.
 *
 * `rowVersion` fra skjemaet brukes når den finnes (tilbudssiden). Et nytt trykk med samme versjon
 * gir `OrderChangedError` i kjernen; da vises siden på nytt uten feil, med kvitteringen når datoen
 * allerede er den nye. Med `withAddress` (listen) står adressen i kvitteringen (A372); den står bare
 * på siden, aldri i adressen.
 */
export async function extendOfferAction(
  previous: OfferActionState,
  formData: FormData,
): Promise<OfferActionState> {
  const orderId = String(formData.get("orderId") ?? "");
  const withAddress = formData.get("withAddress") === "1";
  const context = await getEmployeeContext();
  if (!context || !isUuid(orderId)) return failure(previous, {}, {}, NO_ACCESS);

  const validUntil = addDays(todayInOslo(), OFFER_VALID_DAYS);
  const receipt = (addressText: string) =>
    withAddress
      ? `${addressText} er gyldig til ${formatIsoDate(validUntil)}.`
      : `Gyldig til ${formatIsoDate(validUntil)}.`;
  const done = (notice: string | null): OfferActionState => ({
    fieldErrors: {},
    message: null,
    values: {},
    attempt: previous.attempt,
    notice,
    done: true,
  });

  try {
    const order = await getOrder(context.actor, context.organizationId, orderId);
    const rowVersion = readRowVersion(formData) ?? order.rowVersion;
    try {
      await updateOrder(
        context.actor,
        context.organizationId,
        orderId,
        {
          addressText: order.addressText,
          externalRef: order.externalRef,
          orderedByText: order.orderedByText,
          orderedByContactId: order.orderedByContactId,
          gnr: order.gnr,
          bnr: order.bnr,
          snr: order.snr,
          housingAssociationName: order.housingAssociationName,
          sellerDeclarationReceived: order.sellerDeclarationReceived,
          validUntil,
        },
        rowVersion,
      );
    } catch (error) {
      if (!(error instanceof OrderChangedError)) throw error;
      // Andre trykk (eller en annen var raskere): vis siden på nytt uten feil.
      const latest = await getOrder(context.actor, context.organizationId, orderId);
      revalidatePath(ROUTE);
      revalidatePath(`${ROUTE}/${orderId}`);
      return done(latest.validUntil === validUntil ? receipt(latest.addressText) : null);
    }
    revalidatePath(ROUTE);
    revalidatePath(`${ROUTE}/${orderId}`);
    return done(receipt(order.addressText));
  } catch (error) {
    return errorResult(
      error,
      previous,
      {},
      { route: `${ROUTE}/${orderId}`, userId: context.actor.id, orderId },
      { known: EXTEND_ERRORS },
    );
  }
}

/** Er koden en av de faste avslagsgrunnene (F4)? */
function isReasonKey(value: string): value is (typeof OFFER_REJECTION_REASON_KEYS)[number] {
  return (OFFER_REJECTION_REASON_KEYS as readonly string[]).includes(value);
}

/**
 * «Avslå tilbudet» (F4, A361): en fast grunn er påkrevd, og «Mer om grunnen» er påkrevd ved
 * «Annet». Etter lagring vises siden som avslått; kortet «Avslått: …» er kvitteringen.
 */
export async function rejectOfferAction(
  previous: OfferActionState,
  formData: FormData,
): Promise<OfferActionState> {
  const orderId = String(formData.get("orderId") ?? "");
  const values = {
    reasonKey: String(formData.get("reasonKey") ?? ""),
    reasonText: String(formData.get("reasonText") ?? ""),
  };
  const context = await getEmployeeContext();
  if (!context || !isUuid(orderId)) return failure(previous, values, {}, NO_ACCESS);

  const reasonKey = values.reasonKey.trim();
  const reasonText = values.reasonText.trim();
  if (!isReasonKey(reasonKey)) return failure(previous, values, { reasonKey: CHOOSE_REASON });
  if (reasonKey === "other" && reasonText === "") {
    return failure(previous, values, { reasonText: WRITE_REASON });
  }

  try {
    await rejectOrder(context.actor, context.organizationId, orderId, {
      reasonKey,
      reasonText: reasonText === "" ? null : reasonText,
    });
  } catch (error) {
    return errorResult(
      error,
      previous,
      values,
      { route: `${ROUTE}/${orderId}`, userId: context.actor.id, orderId },
      {
        known: OFFER_ERRORS,
        zodField: "reasonText",
        messages: { reasonKey: CHOOSE_REASON },
      },
    );
  }
  revalidatePath(ROUTE);
  revalidatePath(`${ROUTE}/${orderId}`);
  return {
    fieldErrors: {},
    message: null,
    values: {},
    attempt: previous.attempt,
    notice: null,
    done: true,
  };
}

/**
 * «Gjør om til oppdrag» (ett trykk). Kontoret er forhåndsvalgt på siden (A295); uten kontor må det
 * velges. Kjernen låser raden, så to raske trykk gir ett oppdrag. Ved suksess går man til det nye
 * oppdraget med pekeren til takstmann og befaringsdato (F5, `?fra=tilbud`).
 */
export async function convertOfferAction(
  previous: OfferActionState,
  formData: FormData,
): Promise<OfferActionState> {
  const orderId = String(formData.get("orderId") ?? "");
  const values = { officeId: String(formData.get("officeId") ?? "") };
  const context = await getEmployeeContext();
  if (!context || !isUuid(orderId)) return failure(previous, values, {}, NO_ACCESS);

  const officeId = values.officeId.trim();
  if (officeId === "") return failure(previous, values, { officeId: CHOOSE_OFFICE });
  if (!isUuid(officeId)) return failure(previous, values, { officeId: OFFICE_NOT_FOUND });

  let assignmentId: string;
  try {
    const result = await convertOrderToAssignment(context.actor, context.organizationId, orderId, {
      officeId,
    });
    assignmentId = result.assignment.id;
  } catch (error) {
    return errorResult(
      error,
      previous,
      values,
      { route: `${ROUTE}/${orderId}`, userId: context.actor.id, orderId, officeId },
      { known: OFFER_ERRORS },
    );
  }
  revalidatePath(ROUTE);
  revalidatePath(`${ROUTE}/${orderId}`);
  redirect(`/oppdrag/${assignmentId}?fra=tilbud`);
}
