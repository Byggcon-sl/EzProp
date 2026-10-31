/** Svaret fra en server action i /admin når noe ikke ble lagret. Ved suksess sendes man videre. */
export type FormState = {
  /** Feil per felt (første melding per felt). */
  fieldErrors: Record<string, string>;
  /** Melding øverst i skjemaet eller kortet. */
  message: string | null;
  /** Verdiene som ble sendt, slik at feltene beholder dem. */
  values: Record<string, string | string[]>;
  /** Økes ved hvert mislykket forsøk, slik at fokus flyttes til meldingen hver gang. */
  attempt: number;
};

export const initialFormState: FormState = {
  fieldErrors: {},
  message: null,
  values: {},
  attempt: 0,
};

export const FIX_FIELDS = "Rett feltene som er merket.";
export const UNKNOWN_ERROR = "Noe gikk galt. Ingenting er lagret. Prøv igjen.";
export const NO_ACCESS = "Du har ikke tilgang til dette.";

/** Tekstverdien til et felt fra forrige forsøk, ellers `fallback`. */
export function textValue(state: FormState, name: string, fallback: string | null | undefined) {
  const value = state.values[name];
  return typeof value === "string" ? value : (fallback ?? "");
}

/** Valgte verdier i en gruppe fra forrige forsøk, ellers `fallback`. */
export function listValue(state: FormState, name: string, fallback: readonly string[]) {
  const value = state.values[name];
  return Array.isArray(value) ? value : fallback;
}
