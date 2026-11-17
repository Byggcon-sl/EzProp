/*
 * Faste, norske meldinger for skjemaer som tåler utløpt innlogging og nettbrudd (rett T-0070 og
 * T-0071, docs/agenter/oppgaver/rett-t0070-t0071.md punkt 10), og svaret fra serverhandlingene.
 * Felles kontrakt mellom serverhandlingene i src/app og skjemahjelperen i src/shared/forms.
 * Importerer ingenting fra src/core eller src/app. Meldingene bærer aldri persondata.
 */

/** Lagre ble trykket uten nett, eller nettet falt under sending. */
export const OFFLINE_MESSAGE = "Du er uten nett. Endringen er ikke lagret.";
/** Nettet kom tilbake mens meldingen om manglende nett ble vist. */
export const BACK_ONLINE_MESSAGE = "Nettet er tilbake. Trykk Lagre.";
/** Serverhandlingen svarte at innloggingen er utløpt (etter Lagre). */
export const SIGNED_OUT_MESSAGE = "Du er logget ut. Logg inn igjen.";
/** Sjekken når siden får fokus igjen fant at økten er utløpt. */
export const SIGNED_OUT_ON_FOCUS_MESSAGE = "Du er logget ut. Logg inn før du lagrer.";
/** Etter innlogging i dialogen over skjemaet. Ingenting lagres automatisk. */
export const SIGNED_IN_AGAIN_MESSAGE = "Du er logget inn igjen. Trykk Lagre.";
/** Teksten på knappen som åpner innloggingsdialogen. */
export const SIGN_IN_LINK_TEXT = "Logg inn";

/**
 * Svaret et skjema får fra en serverhandling når noe ikke ble lagret. `FormState` i
 * src/app/(ansatt)/form-state.ts er tilordningsbar til denne typen.
 */
export type GuardedFormState = {
  /** Melding øverst i skjemaet eller over knappen. */
  message: string | null;
  /** Verdiene som ble sendt, slik at feltene beholder dem. */
  values: Record<string, string | string[]>;
  /** Økes ved hvert mislykket forsøk. */
  attempt: number;
  /** Feil per felt. */
  fieldErrors: Record<string, string>;
  /** Lenke som hører til meldingen, for eksempel «Logg inn». */
  link?: { href: string; text: string };
  /** Satt når innloggingen er utløpt («logget ut»-svaret). */
  signedOut?: true;
};
