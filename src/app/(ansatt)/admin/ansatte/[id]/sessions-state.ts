/*
 * Felles kontrakt mellom `session-actions.ts` (server) og `sessions-section.tsx` (klient) for
 * «Logg ut av alle enheter». Ingen persondata: bare status, fast melding og antall.
 */

/** Svaret fra `revokeAllEmployeeSessionsAction`. */
export type EmployeeSessionsActionState = {
  status: "idle" | "done" | "failed";
  message: string | null;
  /** Økes ved hvert svar, slik at fokus flyttes til meldingen hver gang. */
  attempt: number;
  /** Admin logget ut seg selv: klienten logger ut her og går til innloggingssiden. */
  isSelf: boolean;
  /** Antall enheter som ble logget ut (bare ved `done`). */
  count?: number;
  /** Innloggingen er utløpt («logget ut»-svaret). */
  signedOut?: true;
};

/** Navnet på avkryssingsfeltet «Jeg blir også logget ut her» og verdien det sender. */
export const CONFIRM_SELF_FIELD = "confirmSelf";
export const CONFIRM_SELF_VALUE = "yes";
