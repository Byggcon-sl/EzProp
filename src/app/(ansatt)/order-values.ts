/*
 * Det bestillingsskjemaene har felles («Nytt tilbud», «Endre tilbudet» og «Endre bestillingen» på
 * oppdraget), uten «use client» eller «use server», så både skjemaene og handlingene kan bruke det.
 */

/** Tekstfeltene i bestillingsskjemaet (`name` på feltene). Avkrysningen står for seg. */
export const ORDER_FORM_TEXT_FIELDS = [
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

/** Verdiene fra skjemaet som tekst, slik at feltene beholder dem etter et mislykket forsøk. */
export function readOrderValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of ORDER_FORM_TEXT_FIELDS) values[name] = String(formData.get(name) ?? "");
  // Avkrysningen sendes bare når den er krysset av.
  if (formData.get("sellerDeclarationReceived") !== null) values.sellerDeclarationReceived = "on";
  return values;
}

/**
 * Verdiene i tilbudsskjemaet: bestillingsfeltene og «Gyldig til» (`validUntil`, bare på tilbudet,
 * ADR 0012).
 */
export function readOfferValues(formData: FormData): Record<string, string> {
  return { ...readOrderValues(formData), validUntil: String(formData.get("validUntil") ?? "") };
}

/** Meldingen når en annen har lagret tilbudet etter at skjemaet ble åpnet (A253). */
export const ORDER_CHANGED_MESSAGE = "Tilbudet er endret av en annen. Last siden på nytt.";

/** Meldingen når «Lagre» trykkes uten nett. Teksten i skjemaet står igjen. */
export const ORDER_OFFLINE_MESSAGE = "Du er uten nett. Endringen er ikke lagret.";
