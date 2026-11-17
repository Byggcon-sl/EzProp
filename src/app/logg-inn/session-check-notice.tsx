"use client";

import { useContext, useRef, useState } from "react";
import { loginHref } from "@/shared/forms/login-link";
import {
  SIGN_IN_LINK_TEXT,
  SIGNED_IN_AGAIN_MESSAGE,
  SIGNED_OUT_ON_FOCUS_MESSAGE,
} from "@/shared/forms/messages";
import { SignInDialog } from "./sign-in-dialog";
import { PoliteMessage, SignedOutNotice } from "./signed-out-notice";
import { SignInEmailContext } from "./use-guarded-form";
import { announceSignedIn, useSessionCheck, useSignedInAnnouncement } from "./use-session-check";

type Status = { kind: "none" } | { kind: "signed_out"; href: string } | { kind: "signed_in" };

/**
 * Én felles melding øverst på en side med mange skjemaer (bygningssiden): når siden får fokus
 * igjen og økten er ute, står «Du er logget ut. Logg inn før du lagrer.» med lenken «Logg inn»
 * og innloggingsdialogen. Ingen skjemaer røres. Etter innlogging (her eller i et skjema) står
 * «Du er logget inn igjen. Trykk Lagre.», og fokus går til den meldingen.
 */
export function SessionCheckNotice() {
  const email = useContext(SignInEmailContext);
  const [status, setStatus] = useState<Status>({ kind: "none" });
  const [dialogOpen, setDialogOpen] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useSessionCheck(() =>
    setStatus({ kind: "signed_out", href: loginHref(window.location.pathname) }),
  );
  useSignedInAnnouncement(() =>
    setStatus((current) => (current.kind === "signed_out" ? { kind: "signed_in" } : current)),
  );

  return (
    <>
      {status.kind === "signed_out" && (
        <SignedOutNotice
          message={SIGNED_OUT_ON_FOCUS_MESSAGE}
          link={{ href: status.href, text: SIGN_IN_LINK_TEXT }}
          onSignIn={() => setDialogOpen(true)}
        />
      )}
      <PoliteMessage
        ref={ref}
        message={status.kind === "signed_in" ? SIGNED_IN_AGAIN_MESSAGE : null}
      />
      <SignInDialog
        open={dialogOpen}
        email={email}
        onClose={() => setDialogOpen(false)}
        onSignedIn={announceSignedIn}
        returnFocus={() => ref.current}
      />
    </>
  );
}
