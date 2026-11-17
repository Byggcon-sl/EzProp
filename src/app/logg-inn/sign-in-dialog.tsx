"use client";

import { useEffect, useRef, type SyntheticEvent } from "react";
import { LoginForm } from "./login-form";

export const SIGN_IN_DIALOG_TITLE = "Logg inn igjen";
export const SIGN_IN_DIALOG_INTRO =
  "Det du har skrevet, står i skjemaet. Logg inn med en kode på e-post, og trykk Lagre etterpå.";

/**
 * Innloggingsdialogen over et skjema (`SignInDialog`, T-0070). Innebygd `<dialog>` med
 * `showModal`: fokus går inn ved åpning, Esc lukker, og ved lukking går fokus til `returnFocus`
 * (Lagre). Bare innlogging med kode: «Logg inn med Microsoft» forlater siden og ville slette det
 * som står i skjemaet (A390). Etter innlogging lukkes dialogen og `onSignedIn` kalles; ingenting
 * lagres av seg selv. E-posten er den ansattes egen, kommer fra siden og står aldri i en adresse.
 *
 * Dialogen skal stå utenfor `<form>` til skjemaet den hører til (skjemaer kan ikke ligge i
 * hverandre). Hendelsene `cancel` og `close` stoppes her, så en dialog rundt (som «Legg til flere
 * rom») ikke tror at den selv blir lukket.
 */
/** Elementet som får fokus når dialogen åpnes. */
export function firstStepSelector(email: string | undefined): string {
  return email?.trim() ? 'form button[type="submit"]' : 'input[type="email"]';
}

export function SignInDialog({
  open,
  email,
  onClose,
  onSignedIn,
  returnFocus,
}: {
  open: boolean;
  email?: string;
  onClose: () => void;
  onSignedIn: () => void;
  /** Elementet som får fokus når dialogen lukkes (Lagre-knappen). */
  returnFocus?: () => HTMLElement | null | undefined;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // Fokus til neste steg: «Send meg en kode» når e-posten er fylt ut, ellers e-postfeltet.
      dialog.querySelector<HTMLElement>(firstStepSelector(email))?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open, email]);

  function onCancel(event: SyntheticEvent<HTMLDialogElement>) {
    event.stopPropagation();
  }

  function onDialogClose(event: SyntheticEvent<HTMLDialogElement>) {
    event.stopPropagation();
    returnFocus?.()?.focus();
    if (open) onClose();
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="sign-in-dialog-title"
      aria-describedby="sign-in-dialog-intro"
      data-testid="sign-in-dialog"
      onCancel={onCancel}
      onClose={onDialogClose}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] max-w-none rounded-xl bg-white p-0 text-slate-900 shadow-xl backdrop:bg-night/40"
    >
      {open && (
        <div className="space-y-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 id="sign-in-dialog-title" className="text-xl font-semibold text-slate-900">
              {SIGN_IN_DIALOG_TITLE}
            </h2>
            <button
              type="button"
              aria-label="Lukk"
              onClick={() => ref.current?.close()}
              className="min-h-11 min-w-11 shrink-0 rounded-full text-2xl leading-none text-slate-900 hover:bg-slate-100"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <p id="sign-in-dialog-intro" className="text-slate-700">
            {SIGN_IN_DIALOG_INTRO}
          </p>
          <LoginForm
            initialEmail={email}
            onSignedIn={() => {
              onSignedIn();
              ref.current?.close();
            }}
          />
        </div>
      )}
    </dialog>
  );
}
