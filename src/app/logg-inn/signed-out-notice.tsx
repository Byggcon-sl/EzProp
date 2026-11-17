"use client";

import { useEffect, useRef, type MouseEvent, type Ref } from "react";
import type { FormNotice } from "@/shared/forms/guarded-form-action";

/**
 * Lenken «Logg inn» ved utløpt innlogging. Med JavaScript åpner den innloggingsdialogen over
 * skjemaet (`preventDefault`), så det som er skrevet står. Uten JavaScript går den til
 * innloggingssiden med `neste` tilbake hit. Minst 44 px høy.
 */
export function SignInLink({
  href,
  text,
  onOpen,
}: {
  href: string;
  text: string;
  onOpen: () => void;
}) {
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    onOpen();
  }
  return (
    // Vanlig lenke, ikke Next-lenke: uten JavaScript skal den laste innloggingssiden.
    <a
      href={href}
      onClick={onClick}
      data-testid="sign-in-link"
      className="inline-flex min-h-11 items-center font-semibold text-urgent-text underline underline-offset-4"
    >
      {text}
    </a>
  );
}

/** Meldingen om utløpt innlogging med lenken «Logg inn». Leses opp som feil. */
export function SignedOutNotice({
  message,
  link,
  onSignIn,
}: {
  message: string;
  link: { href: string; text: string };
  onSignIn: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 rounded-xl bg-urgent-fill px-3 py-1 text-sm text-urgent-text"
    >
      <span className="py-1">{message}</span>
      <SignInLink href={link.href} text={link.text} onOpen={onSignIn} />
    </div>
  );
}

/**
 * Meldingen over knappen i et skjema med skjemahjelperen. Feil leses opp med `role="alert"`;
 * «Nettet er tilbake» og «Du er logget inn igjen» med `aria-live="polite"`. Etter hvert mislykket
 * forsøk får meldingen fokus (som `FormErrors`); fokus forlater aldri skjemaet.
 */
export function GuardedFormNotice({
  notice,
  attempt,
  onSignIn,
  focusOnAttempt = true,
}: {
  notice: FormNotice | null;
  attempt: number;
  onSignIn: () => void;
  /** `false` når skjemaet selv flytter fokus til en samlet feilboks. */
  focusOnAttempt?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const hasAlert = notice?.tone === "alert";
  useEffect(() => {
    if (focusOnAttempt && attempt > 0 && hasAlert) ref.current?.focus();
  }, [focusOnAttempt, attempt, hasAlert]);

  // Meldingen om «tilbake» og «logget inn igjen» står alltid i DOM-en, så skjermleseren leser den
  // når teksten kommer. Tom er den skjult utenfor flyten (`sr-only`) og gir ingen luft i skjemaet.
  return (
    <>
      {notice?.tone === "alert" && (
        <div ref={ref} tabIndex={-1} className="rounded-xl">
          {notice.signedOut && notice.link ? (
            <SignedOutNotice message={notice.message} link={notice.link} onSignIn={onSignIn} />
          ) : (
            <p
              role="alert"
              className="rounded-xl bg-urgent-fill px-3 py-2 text-sm text-urgent-text"
            >
              {notice.message}
            </p>
          )}
        </div>
      )}
      <PoliteMessage message={notice?.tone === "polite" ? notice.message : null} />
    </>
  );
}

/** Rolig melding (`aria-live="polite"`), alltid i DOM-en; tom er den utenfor flyten. */
export function PoliteMessage({
  message,
  ref,
}: {
  message: string | null;
  ref?: Ref<HTMLParagraphElement>;
}) {
  return (
    <p
      ref={ref}
      tabIndex={message ? -1 : undefined}
      aria-live="polite"
      className={message ? "rounded-xl bg-sand px-3 py-2 text-sm text-slate-900" : "sr-only"}
    >
      {message ?? ""}
    </p>
  );
}
