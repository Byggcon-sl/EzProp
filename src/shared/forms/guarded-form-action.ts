import { useActionState, useCallback, useEffect, useState } from "react";
import { loginHref } from "./login-link";
import {
  BACK_ONLINE_MESSAGE,
  OFFLINE_MESSAGE,
  SIGN_IN_LINK_TEXT,
  SIGNED_IN_AGAIN_MESSAGE,
  SIGNED_OUT_ON_FOCUS_MESSAGE,
  type GuardedFormState,
} from "./messages";

/*
 * Skjemahjelper for lagring med `useActionState` (T-0070, T-0071). Uten nett eller med utløpt
 * innlogging står skjemaet med verdiene og en norsk melding, i stedet for engelsk feilside eller
 * videresending. Verdiene holdes bare i React-tilstand i den åpne siden, aldri i nettleserens
 * lagring. Ingen import fra kjernen eller sidene (modulgrensene).
 */

export type FormAction<S> = (previous: S, formData: FormData) => Promise<S>;

/** Hvordan meldingen leses opp: `alert` for feil, `polite` for «tilbake» og «logget inn igjen». */
export type FormNoticeTone = "alert" | "polite";

/** Meldingen skjemaet viser over knappen, med lenken «Logg inn» når innloggingen er ute. */
export type FormNotice = {
  message: string;
  tone: FormNoticeTone;
  signedOut: boolean;
  link?: { href: string; text: string };
};

/**
 * Lokal melding over handlingsstatusen. Gjelder bare for forsøket (`attempt`) den ble satt i;
 * neste svar fra handlingen tar over.
 */
export type NoticeOverlay =
  | { attempt: number; kind: "back_online" | "signed_in_again" }
  | { attempt: number; kind: "signed_out_on_focus"; href: string };

/** Alle tekstverdier i skjemaet. Gjentatte navn blir en liste. Filer tas aldri med. */
export function readFormValues(formData: FormData): Record<string, string | string[]> {
  const values: Record<string, string | string[]> = {};
  for (const [name, value] of formData.entries()) {
    if (typeof value !== "string") continue;
    const existing = values[name];
    if (existing === undefined) values[name] = value;
    else values[name] = Array.isArray(existing) ? [...existing, value] : [existing, value];
  }
  return values;
}

/** Svaret når nettet er borte: verdiene står, ingen feil per felt, og forsøket telles. */
export function offlineState<S extends GuardedFormState>(previous: S, values: S["values"]): S {
  const { link: _link, signedOut: _signedOut, ...rest } = previous;
  return {
    ...rest,
    message: OFFLINE_MESSAGE,
    values,
    fieldErrors: {},
    attempt: previous.attempt + 1,
  } as S;
}

/** `fetch` avviser med `TypeError` når forespørselen ikke når fram (nettbrudd). */
export function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError;
}

/** «Logget ut»-svaret får lenken til innloggingen. Andre svar gis tilbake uendret. */
export function withSignInLink<S extends GuardedFormState>(result: S, path: string): S {
  if (result.signedOut !== true) return result;
  return { ...result, link: { href: loginHref(path), text: SIGN_IN_LINK_TEXT } };
}

export type GuardOptions<S extends GuardedFormState> = {
  readValues: (formData: FormData) => S["values"];
  isOnline: () => boolean;
  currentPath: () => string;
};

/**
 * Pakker en skjemahandling. Uten nett kalles handlingen ikke. Nettbrudd under sending gir samme
 * svar. Andre feil (også videresending etter lagring) kastes videre uendret.
 */
export function guardAction<S extends GuardedFormState>(
  action: FormAction<S>,
  options: GuardOptions<S>,
): FormAction<S> {
  return async (previous, formData) => {
    if (!options.isOnline()) return offlineState(previous, options.readValues(formData));
    let result: S;
    try {
      result = await action(previous, formData);
    } catch (error) {
      if (isNetworkError(error)) return offlineState(previous, options.readValues(formData));
      throw error;
    }
    return withSignInLink(result, options.currentPath());
  };
}

/** Meldingen som skal vises nå: den lokale meldingen for dette forsøket, ellers svaret. */
export function resolveNotice<S extends GuardedFormState>(
  state: S,
  overlay: NoticeOverlay | null,
): FormNotice | null {
  if (overlay && overlay.attempt === state.attempt) {
    switch (overlay.kind) {
      case "back_online":
        return { message: BACK_ONLINE_MESSAGE, tone: "polite", signedOut: false };
      case "signed_in_again":
        return { message: SIGNED_IN_AGAIN_MESSAGE, tone: "polite", signedOut: false };
      case "signed_out_on_focus":
        return {
          message: SIGNED_OUT_ON_FOCUS_MESSAGE,
          tone: "alert",
          signedOut: true,
          link: { href: overlay.href, text: SIGN_IN_LINK_TEXT },
        };
    }
  }
  if (!state.message) return null;
  return {
    message: state.message,
    tone: "alert",
    signedOut: state.signedOut === true,
    ...(state.link ? { link: state.link } : {}),
  };
}

/** Skal skjemaet lytte på `online` nå? Bare mens meldingen om manglende nett vises. */
export function waitsForNetwork(notice: FormNotice | null): boolean {
  return notice?.message === OFFLINE_MESSAGE;
}

/** Hendelsene hjelperen lytter på (`window` i nettleseren, en falsk i testene). */
export type OnlineTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;

/** Kaller `onOnline` én gang når nettet er tilbake. Gir tilbake funksjonen som fjerner lytteren. */
export function listenForOnline(target: OnlineTarget, onOnline: () => void): () => void {
  const handler = () => onOnline();
  target.addEventListener("online", handler);
  return () => target.removeEventListener("online", handler);
}

export type GuardedFormAction<S extends GuardedFormState> = {
  state: S;
  formAction: (formData: FormData) => void;
  pending: boolean;
  /** Meldingen over knappen, eller `null`. */
  notice: FormNotice | null;
  /** Etter innlogging i dialogen: «Du er logget inn igjen. Trykk Lagre.» Ingenting lagres. */
  showSignedInAgain: () => void;
  /** Økten er ute når siden får fokus igjen: «Du er logget ut. Logg inn før du lagrer.» */
  showSignedOutOnFocus: () => void;
};

/**
 * `useActionState` med vern mot manglende nett og utløpt innlogging. `path` er siden lenken
 * «Logg inn» skal tilbake til; standard er gjeldende side (uten spørrestreng).
 */
export function useGuardedFormAction<S extends GuardedFormState>(
  action: FormAction<S>,
  initialState: S,
  options: { readValues?: (formData: FormData) => S["values"]; path?: string } = {},
): GuardedFormAction<S> {
  const readValues = options.readValues ?? readFormValues;
  const path = options.path;
  const guarded = useCallback(
    (previous: S, formData: FormData) =>
      guardAction<S>(action, {
        readValues: (data) => readValues(data) as S["values"],
        isOnline: () => navigator.onLine,
        currentPath: () => path ?? window.location.pathname,
      })(previous, formData),
    [action, readValues, path],
  );

  const [actionState, formAction, pending] = useActionState<S, FormData>(
    guarded as (previous: Awaited<S>, formData: FormData) => Promise<S>,
    initialState as Awaited<S>,
  );
  const state = actionState as S;
  const [overlay, setOverlay] = useState<NoticeOverlay | null>(null);
  const notice = resolveNotice(state, overlay);
  const waiting = waitsForNetwork(notice);
  const attempt = state.attempt;

  useEffect(() => {
    if (!waiting) return;
    return listenForOnline(window, () => setOverlay({ attempt, kind: "back_online" }));
  }, [waiting, attempt]);

  const showSignedInAgain = useCallback(
    () => setOverlay({ attempt, kind: "signed_in_again" }),
    [attempt],
  );
  const showSignedOutOnFocus = useCallback(
    () =>
      setOverlay({
        attempt,
        kind: "signed_out_on_focus",
        href: loginHref(path ?? window.location.pathname),
      }),
    [attempt, path],
  );

  return { state, formAction, pending, notice, showSignedInAgain, showSignedOutOnFocus };
}
