"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import {
  useGuardedFormAction,
  type FormAction,
  type FormNotice,
  type GuardedFormAction,
} from "@/shared/forms/guarded-form-action";
import type { GuardedFormState } from "@/shared/forms/messages";
import { SignInDialog } from "./sign-in-dialog";
import { GuardedFormNotice } from "./signed-out-notice";
import { announceSignedIn, useSessionCheck, useSignedInAnnouncement } from "./use-session-check";

/**
 * Den ansattes egen e-post til innloggingsdialogen, for sider med mange skjemaer (bygningssiden).
 * Kommer fra siden (`context.actor.email`), står aldri i en adresse og logges aldri.
 */
export const SignInEmailContext = createContext<string | undefined>(undefined);

/** Første Lagre-knapp i skjemaet. Fokus går hit når innloggingsdialogen lukkes. */
export function submitButtonOf(form: HTMLFormElement | null): HTMLElement | null {
  return form?.querySelector<HTMLElement>('button[type="submit"]') ?? null;
}

export type GuardedFormHandle<S extends GuardedFormState> = GuardedFormAction<S> & {
  /** E-posten som fylles ut i innloggingsdialogen. */
  email: string | undefined;
};

/**
 * Skjemahjelperen med sjekk av økten når siden får fokus igjen (T-0070, T-0071). `email` er den
 * ansattes egen e-post (ellers fra `SignInEmailContext`). `sessionCheck: false` når siden har én
 * felles melding om utlogging (bygningssiden). Brukes sammen med `GuardedForm`.
 */
export function useGuardedForm<S extends GuardedFormState>(
  action: FormAction<S>,
  initialState: S,
  options: { email?: string; path?: string; sessionCheck?: boolean } = {},
): GuardedFormHandle<S> {
  const contextEmail = useContext(SignInEmailContext);
  const guarded = useGuardedFormAction(action, initialState, { path: options.path });
  const { notice, showSignedInAgain, showSignedOutOnFocus } = guarded;

  useSessionCheck(showSignedOutOnFocus, options.sessionCheck ?? true);
  useSignedInAnnouncement(() => {
    if (notice?.signedOut) showSignedInAgain();
  });

  return { ...guarded, email: options.email ?? contextEmail };
}

type NoticeContextValue = { notice: FormNotice | null; attempt: number; openSignIn: () => void };

const GuardedNoticeContext = createContext<NoticeContextValue | null>(null);

/**
 * `<form>` med skjemahjelperen, og innloggingsdialogen utenfor (skjemaer kan ikke ligge i
 * hverandre). Lenken «Logg inn» i `FormNotice` åpner dialogen; når den lukkes, går fokus til
 * første Lagre-knapp i skjemaet. Skjemaet byttes aldri ut, så verdiene står.
 */
export function GuardedForm<S extends GuardedFormState>({
  form,
  children,
  ...props
}: { form: GuardedFormHandle<S> } & Omit<ComponentProps<"form">, "action" | "ref">) {
  const formRef = useRef<HTMLFormElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const openSignIn = useCallback(() => setDialogOpen(true), []);
  const closeSignIn = useCallback(() => setDialogOpen(false), []);
  const returnFocus = useCallback(() => submitButtonOf(formRef.current), []);

  return (
    <GuardedNoticeContext value={{ notice: form.notice, attempt: form.state.attempt, openSignIn }}>
      <form ref={formRef} action={form.formAction} {...props}>
        {children}
      </form>
      <SignInDialog
        open={dialogOpen}
        email={form.email}
        onClose={closeSignIn}
        onSignedIn={announceSignedIn}
        returnFocus={returnFocus}
      />
    </GuardedNoticeContext>
  );
}

/**
 * Meldingen over knappen i et `GuardedForm`. `hide`: meldinger skjemaet viser på egen måte.
 * `focusOnAttempt: false` når skjemaet selv flytter fokus til en samlet feilboks.
 */
export function GuardedFormMessage({
  hide = [],
  focusOnAttempt = true,
}: {
  hide?: readonly string[];
  focusOnAttempt?: boolean;
}) {
  const value = useContext(GuardedNoticeContext);
  if (!value) return null;
  const notice = value.notice && !hide.includes(value.notice.message) ? value.notice : null;
  return (
    <GuardedFormNotice
      notice={notice}
      attempt={value.attempt}
      onSignIn={value.openSignIn}
      focusOnAttempt={focusOnAttempt}
    />
  );
}
