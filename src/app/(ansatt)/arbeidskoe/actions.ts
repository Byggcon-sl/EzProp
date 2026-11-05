"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { AccessDeniedError } from "@/core/access";
import { NOTE_MAX_LENGTH, parseWorkQueueParams, updateAssignmentNote } from "@/core/assignments";
import { logger } from "@/shared/lib/logger";
import { isUuid } from "@/shared/lib/uuid";
import { getEmployeeContext } from "../employee-context";
import { cardAnchor, QUEUE_PATH, queueHref, type NoteErrorCode } from "./queue-href";

/*
 * «Lagre» på notatet i arbeidskøen. Vanlig skjema uten klientkode, så det virker uten JavaScript.
 * Organisasjonen kommer fra `getEmployeeContext()`, aldri fra skjemaet; kjernen sjekker
 * rettigheten. Etterpå sendes brukeren tilbake til samme fane, filter og søk (bare verdier fra
 * `parseWorkQueueParams`, så ingen åpen omdirigering). Feil sendes tilbake som en fast kode i
 * adressen; den avviste teksten står aldri i adressen eller loggen.
 */

const ROUTE = "/arbeidskoe";

/** Koden for en `ZodError` fra notatet: for lang tekst, ellers fødselsnummer. */
function zodCode(note: string): NoteErrorCode {
  return note.trim().length > NOTE_MAX_LENGTH ? "for_langt" : "fnr";
}

export async function saveNoteAction(formData: FormData): Promise<void> {
  const assignmentId = String(formData.get("assignmentId") ?? "");
  const note = String(formData.get("note") ?? "");
  const state = parseWorkQueueParams({
    status: String(formData.get("status") ?? ""),
    mine: String(formData.get("mine") ?? ""),
    q: String(formData.get("q") ?? ""),
  });

  const context = await getEmployeeContext();
  if (!context || !isUuid(assignmentId)) {
    redirect(queueHref(state, { noteError: { code: "ingen_tilgang" } }));
  }

  let code: NoteErrorCode | null = null;
  try {
    await updateAssignmentNote(context.actor, context.organizationId, assignmentId, note);
  } catch (error) {
    if (error instanceof ZodError) code = zodCode(note);
    // Kjernen sier ikke om oppdraget mangler eller tilgangen mangler. Den som kan endre
    // oppdrag, har fått «ikke funnet» (for eksempel kansellert); ellers «ingen tilgang».
    else if (error instanceof AccessDeniedError)
      code = context.canEditOrders ? "ikke_funnet" : "ingen_tilgang";
    else {
      logger.error("Lagring feilet", {
        route: ROUTE,
        userId: context.actor.id,
        assignmentId,
        errorName: error instanceof Error ? error.name : "ukjent feil",
      });
      code = "ukjent";
    }
  }

  const hash = cardAnchor(assignmentId);
  if (code) redirect(queueHref(state, { noteError: { assignmentId, code }, hash }));
  revalidatePath(QUEUE_PATH);
  redirect(queueHref(state, { hash }));
}
