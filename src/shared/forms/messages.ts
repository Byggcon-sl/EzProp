/**
 * Faste, norske meldinger når lagring ikke går fordi nettet er borte eller innloggingen er ute
 * (T-0070, T-0071). Brukes både av serverhandlingene og av skjemahjelperen i nettleseren.
 */
export const OFFLINE_MESSAGE = "Du er uten nett. Endringen er ikke lagret.";
export const BACK_ONLINE_MESSAGE = "Nettet er tilbake. Trykk Lagre.";
export const SIGNED_OUT_MESSAGE = "Du er logget ut. Logg inn igjen.";
export const SIGNED_OUT_ON_FOCUS_MESSAGE = "Du er logget ut. Logg inn før du lagrer.";
export const SIGNED_IN_AGAIN_MESSAGE = "Du er logget inn igjen. Trykk Lagre.";
export const SIGN_IN_LINK_TEXT = "Logg inn";

/**
 * Svaret fra en skjemahandling som skjemahjelperen forstår. `signedOut` er satt bare i
 * «logget ut»-svaret (`signed_out`); da står `SIGNED_OUT_MESSAGE` i `message`.
 */
export type GuardedFormState = {
  message: string | null;
  values: Record<string, string | string[]>;
  attempt: number;
  fieldErrors: Record<string, string>;
  link?: { href: string; text: string };
  signedOut?: true;
};
