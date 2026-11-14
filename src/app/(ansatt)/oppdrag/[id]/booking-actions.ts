"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AssignmentChangedError, updateAssignmentBooking } from "@/core/assignments";
import { ContactNotFoundError } from "@/core/contacts";
import { isUuid } from "@/shared/lib/uuid";
import { errorResult, failure, type KnownError } from "../../action-result";
import { getEmployeeContext } from "../../employee-context";
import { NO_ACCESS, type FormState } from "../../form-state";
import { readOrderValues } from "../../ordre/order-values";
import { ASSIGNMENT_CHANGED_MESSAGE } from "./booking-values";

/*
 * «Endre bestillingen» på oppdragssiden (docs/funksjoner/fase2a-nytt-oppdrag.md, Omfang 10).
 * Ingen tilgangslogikk her: organisasjonen kommer fra `getEmployeeContext()`, og kjernen sjekker
 * `assignment.edit` og låsen med `rowVersion`. Loggen får bare rute, bruker-id, oppdrags-id og
 * feilnavn, aldri innholdet i skjemaet.
 */

const BOOKING_ERRORS: readonly KnownError[] = [
  { error: AssignmentChangedError, message: ASSIGNMENT_CHANGED_MESSAGE },
  { error: ContactNotFoundError, field: "orderedByContactId", message: "Kontakten finnes ikke." },
];

/** Tomme valgfrie felt sendes som `null` (tømmer feltet). */
function optional(value: string | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * «Lagre» i «Endre bestillingen». Virker i alle statuser. Tom «Mottatt» betyr uendret (kjernen).
 * Egenerklæringen står ikke i skjemaet; verdien fra oppdraget sendes med uendret (skjult felt,
 * beskyttet av `rowVersion`). Ved suksess går man tilbake til oppdraget med kvitteringen.
 */
export async function updateAssignmentBookingAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const assignmentId = String(formData.get("assignmentId") ?? "");
  const values = readOrderValues(formData);
  const context = await getEmployeeContext();
  if (!context || !isUuid(assignmentId)) return failure(previous, values, {}, NO_ACCESS);

  // Versjonen skjemaet ble åpnet med. Tuklet eller manglende verdi gir konfliktmeldingen.
  const rowVersionText = String(formData.get("rowVersion") ?? "").trim();
  const rowVersion = /^\d{1,9}$/.test(rowVersionText) ? Number(rowVersionText) : null;
  if (rowVersion === null) return failure(previous, values, {}, ASSIGNMENT_CHANGED_MESSAGE);

  try {
    await updateAssignmentBooking(
      context.actor,
      context.organizationId,
      assignmentId,
      {
        addressText: (values.addressText ?? "").trim(),
        receivedAt: optional(values.receivedAt),
        externalRef: optional(values.externalRef),
        orderedByText: optional(values.orderedByText),
        orderedByContactId: optional(values.orderedByContactId),
        gnr: optional(values.gnr),
        bnr: optional(values.bnr),
        snr: optional(values.snr),
        housingAssociationName: optional(values.housingAssociationName),
        sellerDeclarationReceived: values.sellerDeclarationReceived === "on",
      },
      rowVersion,
    );
  } catch (error) {
    return errorResult(
      error,
      previous,
      values,
      { route: "/oppdrag/[id]", userId: context.actor.id, assignmentId },
      { known: BOOKING_ERRORS },
    );
  }
  revalidatePath(`/oppdrag/${assignmentId}`);
  revalidatePath("/arbeidskoe");
  redirect(`/oppdrag/${assignmentId}?endret=1`);
}
