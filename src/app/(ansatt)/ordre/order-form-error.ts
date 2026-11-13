import { initialFormState, NO_ACCESS, UNKNOWN_ERROR, type FormState } from "../form-state";

/*
 * Feilkodene i skjemaet «Endre ordren» og meldingen til hver. Ren fil uten DOM, så den kan
 * prøves med Vitest (docs/funksjoner/fase2a-rette-ordre-testplan.md 10.4).
 */

export const ORDER_FORM_ERROR_CODES = ["ORDER_CHANGED", "OFFLINE", "NO_ACCESS", "UNKNOWN"] as const;
export type OrderFormErrorCode = (typeof ORDER_FORM_ERROR_CODES)[number];

export const ORDER_CHANGED_MESSAGE = "Ordren er endret av en annen. Last siden på nytt.";
export const OFFLINE_MESSAGE = "Du er uten nett. Endringen er ikke lagret.";
export const ORDER_SAVED_MESSAGE = "Endringene er lagret.";

/** Meldingen øverst i skjemaet, og om knappen «Last siden på nytt» skal vises. */
export function orderFormError(code: string): { message: string; reload: boolean } {
  switch (code) {
    case "ORDER_CHANGED":
      return { message: ORDER_CHANGED_MESSAGE, reload: true };
    case "OFFLINE":
      return { message: OFFLINE_MESSAGE, reload: false };
    case "NO_ACCESS":
      return { message: NO_ACCESS, reload: false };
    default:
      return { message: UNKNOWN_ERROR, reload: false };
  }
}

/**
 * Tilstanden fra `updateOrderAction`. Som `FormState`, pluss feilkoden (eller `null`) og
 * `saved`, som er sann når endringene er lagret og skjemaet skal lukkes.
 */
export type OrderEditState = FormState & { code: OrderFormErrorCode | null; saved: boolean };

export const initialOrderEditState: OrderEditState = {
  ...initialFormState,
  code: null,
  saved: false,
};
