"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { AccessDeniedError } from "@/core/access";
import {
  createAssignment,
  EmployeeNotFoundError,
  findPossibleDuplicatesFor,
  OfficeNotFoundError,
  PossibleDuplicatesLookupError,
  ResponsibleNotInspectorError,
} from "@/core/assignments";
import { ContactNotFoundError } from "@/core/contacts";
import { createOrder, OFFER_VALID_DAYS } from "@/core/orders";
import { addDays, todayInOslo } from "@/shared/lib/dates";
import { logger } from "@/shared/lib/logger";
import { errorResult, failure, type KnownError } from "../../action-result";
import { getEmployeeContext } from "../../employee-context";
import { NO_ACCESS, UNKNOWN_ERROR, type FormState } from "../../form-state";
import { parseOsloDateTimeLocal } from "../../tilbud/received-at";
import type { BookingDuplicateItem } from "../../possible-duplicates-notice";
import {
  ASSIGNMENT_UNKNOWN_ERROR,
  OFFER_UNKNOWN_ERROR,
  readAssignmentValues,
  type DraftDuplicateFields,
} from "./assignment-values";

/*
 * Server actions på /oppdrag/ny (docs/funksjoner/fase2a-nytt-oppdrag.md, Omfang 6–8, og
 * «Lagre som tilbud i stedet», docs/funksjoner/fase2a-tilbud.md F2 a). Ingen
 * tilgangslogikk her: organisasjonen kommer fra `getEmployeeContext()`, og kjernen sjekker
 * `assignment.edit` og `organization.read`. Et felt `organizationId`, nummer, status, kilde,
 * rapporttype, selskap eller firma i skjemaet leses aldri; kjernen setter dem.
 *
 * Personvern: loggen får bare rute, bruker-id og feilnavn, aldri innholdet i skjemaet.
 */

const ROUTE = "/oppdrag/ny";

const OFFICE = "Velg kontor.";
const RESPONSIBLE = "Velg ansvarlig takstmann.";
const CONTACT_NOT_FOUND = "Kontakten finnes ikke.";

/** Feilene fra kjernen som skjemaet viser ved feltet. Fremmed og ukjent id gir samme tekst. */
const CREATE_ERRORS: readonly KnownError[] = [
  { error: OfficeNotFoundError, field: "officeId", message: OFFICE },
  { error: EmployeeNotFoundError, field: "responsibleEmployeeId", message: RESPONSIBLE },
  { error: ResponsibleNotInspectorError, field: "responsibleEmployeeId", message: RESPONSIBLE },
  { error: ContactNotFoundError, field: "orderedByContactId", message: CONTACT_NOT_FOUND },
];

/** Tomme valgfrie felt sendes ikke til kjernen. */
function optional(value: string | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Feil ved feltene står bare ved feltene (ingen samlemelding øverst), og fokus flyttes til første
 * felt med feil i skjemaet. Ukjent feil får teksten som sier hva som ikke er lagret (oppdraget
 * eller tilbudet).
 */
function forAssignmentForm(state: FormState, unknownError = ASSIGNMENT_UNKNOWN_ERROR): FormState {
  if (Object.keys(state.fieldErrors).length > 0) return { ...state, message: null };
  if (state.message === UNKNOWN_ERROR) return { ...state, message: unknownError };
  return state;
}

/** Feilene fra kjernen ved oppretting av tilbud. Fremmed og ukjent kontakt gir samme tekst. */
const OFFER_CREATE_ERRORS: readonly KnownError[] = [
  { error: ContactNotFoundError, field: "orderedByContactId", message: CONTACT_NOT_FOUND },
];

/** «Lagre» på /oppdrag/ny. Ved suksess går man til oppdraget med kvitteringen. */
export async function createAssignmentAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = readAssignmentValues(formData);
  const context = await getEmployeeContext();
  if (!context) return failure(previous, values, {}, NO_ACCESS);

  let assignmentId: string;
  try {
    const result = await createAssignment(context.actor, context.organizationId, {
      addressText: values.addressText ?? "",
      gnr: optional(values.gnr),
      bnr: optional(values.bnr),
      snr: optional(values.snr),
      orderedByContactId: optional(values.orderedByContactId),
      orderedByText: optional(values.orderedByText),
      inspectionAt: optional(values.inspectionAt),
      officeId: values.officeId ?? "",
      responsibleEmployeeId: values.responsibleEmployeeId ?? "",
      receivedAt: optional(values.receivedAt),
      externalRef: optional(values.externalRef),
      housingAssociationName: optional(values.housingAssociationName),
      creationKey: optional(values.creationKey),
    });
    assignmentId = result.id;
  } catch (error) {
    return forAssignmentForm(
      errorResult(
        error,
        previous,
        values,
        { route: ROUTE, userId: context.actor.id },
        { known: CREATE_ERRORS },
      ),
    );
  }
  revalidatePath("/arbeidskoe");
  redirect(`/oppdrag/${assignmentId}?ny=1`);
}

/**
 * «Lagre som tilbud i stedet» på /oppdrag/ny (F2 a, A363): det samme skjemaet blir et tilbud med
 * bestillingsfeltene og «Gyldig til» i dag + `OFFER_VALID_DAYS`. Takstmann, befaringsdato, kontor
 * og engangsnøkkelen gjelder bare oppdraget og sendes ikke til kjernen. Organisasjonen kommer fra
 * serveren, aldri fra skjemaet. Ved suksess går man til tilbudet med kvitteringen «Tilbudet er
 * laget. Gyldig til [dato].» (`?ny=1`, samme signal som etter «Nytt tilbud»); bare id-en står i
 * adressen. Feil vises på «Nytt oppdrag», og det som er skrevet står igjen.
 */
export async function saveAsOfferAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = readAssignmentValues(formData);
  const context = await getEmployeeContext();
  if (!context) return failure(previous, values, {}, NO_ACCESS);

  const now = new Date();
  let orderId: string;
  try {
    const order = await createOrder(
      context.actor,
      context.organizationId,
      {
        addressText: values.addressText ?? "",
        gnr: optional(values.gnr),
        bnr: optional(values.bnr),
        snr: optional(values.snr),
        orderedByContactId: optional(values.orderedByContactId),
        orderedByText: optional(values.orderedByText),
        receivedAt: optional(values.receivedAt),
        externalRef: optional(values.externalRef),
        housingAssociationName: optional(values.housingAssociationName),
        validUntil: addDays(todayInOslo(now), OFFER_VALID_DAYS),
      },
      now,
    );
    orderId = order.id;
  } catch (error) {
    return forAssignmentForm(
      errorResult(
        error,
        previous,
        values,
        { route: ROUTE, userId: context.actor.id },
        { known: OFFER_CREATE_ERRORS },
      ),
      OFFER_UNKNOWN_ERROR,
    );
  }
  revalidatePath("/tilbud");
  redirect(`/tilbud/${orderId}?ny=1`);
}

export type DraftDuplicatesResult = { items: BookingDuplicateItem[]; hasMore: boolean };

const NO_DUPLICATES: DraftDuplicatesResult = { items: [], hasMore: false };

/** Feltet som tekst med grense, ellers tom tekst. Ingen verdier i adressen; dette er en POST. */
function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Dublettoppslaget mens skjemaet fylles ut (når adressefeltet eller matrikkelgruppen forlates).
 * Server action, altså POST med verdiene i kroppen, aldri i adressen. Feiler oppslaget, gis ingen
 * treff: varselet stopper aldri lagringen. Svaret har bare type, id, nummer, status, adresse og
 * grunn, og for tilbud visningsstatusen (åpent eller utløpt, F2 b).
 */
export async function findDraftDuplicatesAction(
  fields: DraftDuplicateFields,
): Promise<DraftDuplicatesResult> {
  const context = await getEmployeeContext();
  if (!context || typeof fields !== "object" || fields === null) return NO_DUPLICATES;

  const receivedAtText = text(fields.receivedAt, 20);
  const receivedAt = (receivedAtText && parseOsloDateTimeLocal(receivedAtText)) || new Date();
  try {
    const result = await findPossibleDuplicatesFor(context.actor, context.organizationId, {
      addressText: text(fields.addressText, 300) || null,
      gnr: text(fields.gnr, 10) || null,
      bnr: text(fields.bnr, 10) || null,
      snr: text(fields.snr, 10) || null,
      receivedAt,
    });
    return {
      items: result.items.map((item) => ({
        kind: item.kind,
        id: item.id,
        number: item.number,
        status: item.status,
        addressText: item.addressText,
        reasons: item.reasons,
        displayStatus: item.kind === "order" ? item.displayStatus : null,
      })),
      hasMore: result.hasMore,
    };
  } catch (error) {
    // Databasefeil er logget i kjernen uten verdier; ugyldige felt og manglende tilgang gir bare
    // ingen treff. Andre feil logges med feilnavnet, aldri med feltene.
    const expected =
      error instanceof ZodError ||
      error instanceof PossibleDuplicatesLookupError ||
      error instanceof AccessDeniedError;
    if (!expected) {
      logger.error("Dublettoppslaget i skjemaet feilet", {
        route: ROUTE,
        userId: context.actor.id,
        errorName: error instanceof Error ? error.name : "ukjent feil",
      });
    }
    return NO_DUPLICATES;
  }
}
