import type { FormState } from "../form-state";
import { ORDER_OFFLINE_MESSAGE } from "../order-values";

/*
 * Tilbud er kontorarbeid på nett. Uten nett sendes ingenting, og det som er skrevet står igjen med
 * meldingen «Du er uten nett. Endringen er ikke lagret.» (A360). Brukes av alle skjemaene i
 * /tilbud: Nytt tilbud, Endre, Avslå, Forleng og Gjør om.
 */

type Action<S extends FormState> = (state: S, formData: FormData) => Promise<S>;

/** Nettleseren sier at den er uten nett. */
function isOffline(): boolean {
  return typeof navigator !== "undefined" && !navigator.onLine;
}

/**
 * Pakker inn en server action: uten nett, eller når nettet faller under sendingen (fetch gir
 * `TypeError`), kommer meldingen og verdiene fra skjemaet tilbake. Videresending etter lagring og
 * andre feil kastes videre til Next.
 */
export function withOfflineMessage<S extends FormState>(
  action: Action<S>,
  readValues: (formData: FormData) => Record<string, string>,
): Action<S> {
  const offline = (previous: S, formData: FormData): S => ({
    ...previous,
    fieldErrors: {},
    message: ORDER_OFFLINE_MESSAGE,
    values: readValues(formData),
    attempt: previous.attempt + 1,
    notice: null,
    done: false,
  });
  return async (previous, formData) => {
    if (isOffline()) return offline(previous, formData);
    try {
      return await action(previous, formData);
    } catch (error) {
      if (isOffline() || error instanceof TypeError) return offline(previous, formData);
      throw error;
    }
  };
}
