/*
 * Det skjemaet «Nytt oppdrag» og handlingene har felles, uten «use client» eller «use server».
 */

/** Feltene i skjemaet (`name`), i skjermrekkefølge. */
export const ASSIGNMENT_FORM_FIELDS = [
  "addressText",
  "gnr",
  "bnr",
  "snr",
  "orderedByContactId",
  "orderedByText",
  "inspectionAt",
  "officeId",
  "responsibleEmployeeId",
  "receivedAt",
  "externalRef",
  "housingAssociationName",
  "creationKey",
] as const;

/** Verdiene fra skjemaet som tekst, slik at feltene beholder dem etter et mislykket forsøk. */
export function readAssignmentValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of ASSIGNMENT_FORM_FIELDS) {
    const value = formData.get(name);
    values[name] = typeof value === "string" ? value : "";
  }
  return values;
}

/** Meldingen når «Lagre» trykkes uten nett, eller nettet faller under lagringen. */
export const ASSIGNMENT_OFFLINE_MESSAGE =
  "Ikke lagret. Du er uten nett. Trykk Lagre når du har nett igjen.";

/** Ukjent feil ved lagring. */
export const ASSIGNMENT_UNKNOWN_ERROR = "Noe gikk galt. Oppdraget er ikke lagret. Prøv igjen.";

/** Feltene dublettoppslaget ser på, slik skjemaet sender dem. */
export type DraftDuplicateFields = {
  addressText: string;
  gnr: string;
  bnr: string;
  snr: string;
  receivedAt: string;
};
