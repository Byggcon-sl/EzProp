"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { authClient } from "@/core/auth/auth-client";
import { Button } from "@/shared/ui/button";
import { Field, FormMessage, Input } from "@/shared/ui/form";
import { DEFAULT_NEXT_PATH, safeNextPath } from "./safe-next-path";

/** Brukes bare hvis serveren svarer 429 uten egen melding. */
const TOO_MANY_REQUESTS_FALLBACK = "For mange forsøk. Prøv igjen senere.";

/**
 * Serveren sier selv når man kan prøve igjen (sperre per e-postadresse).
 * Andre 429-svar (Better Auths grense per IP-adresse) er på engelsk og byttes med den norske teksten.
 */
function tooManyRequestsMessage(message: string | undefined): string {
  return message?.trim().startsWith("For mange") ? message.trim() : TOO_MANY_REQUESTS_FALLBACK;
}

/** Samme tekst for alle avviste Microsoft-innlogginger; feilkoden vises ikke (A215). */
export const MICROSOFT_REJECTED_MESSAGE =
  "Du har ikke tilgang med denne kontoen. Be leder eller admin legge deg inn som ansatt, eller logg inn med kode.";

export const OFFLINE_LOGIN_MESSAGE =
  "Du er uten nett. Innlogging trenger nett. Det du har lagret på iPaden, er trygt og synkes når du er inne igjen.";

/** Leverandør-id-en i Better Auth (samme som `MICROSOFT_PROVIDER_ID` på serveren). */
const MICROSOFT = "microsoft";

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/**
 * Innlogging. Med Microsoft satt opp er «Logg inn med Microsoft» hovedvalget, og koden er
 * reserven (ADR 0008). Koden går i to steg: e-postadresse, så koden fra e-posten.
 * `next` er siden brukeren sendes til etter innlogging (sjekkes på nytt her og på serveren).
 * `rejected`: Microsoft-innloggingen ble avvist; meldingen vises og kodeskjemaet er åpent.
 */
export function LoginForm({
  next = DEFAULT_NEXT_PATH,
  microsoft = false,
  rejected = false,
}: {
  next?: string;
  microsoft?: boolean;
  rejected?: boolean;
}) {
  const router = useRouter();
  const online = useOnline();
  const [showCode, setShowCode] = useState(!microsoft || rejected);
  const [redirecting, setRedirecting] = useState(false);
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function signInWithMicrosoft() {
    if (redirecting) return;
    setRedirecting(true);
    setError(null);
    // Omdirigering i samme vindu, aldri sprettoppvindu (virker i appen på hjemskjermen)
    const { error } = await authClient.signIn.social({
      provider: MICROSOFT,
      callbackURL: safeNextPath(next),
      errorCallbackURL: "/logg-inn",
    });
    if (error) {
      setRedirecting(false);
      setError("Vi fikk ikke kontakt med Microsoft. Prøv igjen, eller logg inn med kode.");
      setShowCode(true);
    }
  }

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const { error } = await authClient.emailOtp.sendVerificationOtp({
      email: email.trim(),
      type: "sign-in",
    });
    setPending(false);
    if (error) {
      setError(
        error.status === 429
          ? tooManyRequestsMessage(error.message)
          : "Vi klarte ikke å sende koden. Sjekk e-postadressen og prøv igjen.",
      );
      return;
    }
    setStep("code");
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const { error } = await authClient.signIn.emailOtp({ email: email.trim(), otp: code.trim() });
    if (error) {
      setPending(false);
      setError(
        error.status === 429
          ? tooManyRequestsMessage(error.message)
          : error.code === "TOO_MANY_ATTEMPTS" || error.code === "OTP_EXPIRED"
            ? "Koden er ikke lenger gyldig. Be om en ny kode."
            : "Koden stemmer ikke. Sjekk e-posten og prøv igjen.",
      );
      return;
    }
    router.replace(safeNextPath(next));
    router.refresh();
  }

  let codeForm;
  if (step === "code") {
    codeForm = (
      <form onSubmit={verifyCode} className="space-y-4">
        <p role="status" className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-slate-700">
          Hvis <strong className="break-all">{email.trim()}</strong> har tilgang, har vi sendt en
          kode dit. Den gjelder i 10 minutter.
        </p>
        <Field label="Kode fra e-posten" htmlFor="code">
          <Input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            autoFocus
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className="text-center text-xl tracking-[0.3em] tabular-nums"
          />
        </Field>
        {error && <FormMessage message={error} />}
        <Button type="submit" size="lg" disabled={pending || !online} className="w-full">
          {pending ? "Logger inn …" : "Logg inn"}
        </Button>
        <Button variant="ghost" className="w-full" onClick={() => setStep("email")}>
          Bruk en annen e-postadresse
        </Button>
      </form>
    );
  } else {
    codeForm = (
      <form onSubmit={sendCode} className="space-y-4">
        <Field label="E-postadresse" htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        {error && <FormMessage message={error} />}
        <Button type="submit" size="lg" disabled={pending || !online} className="w-full">
          {pending ? "Sender …" : "Send meg en kode"}
        </Button>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      {!online && (
        <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-slate-800">
          {OFFLINE_LOGIN_MESSAGE}
        </p>
      )}
      {rejected && <FormMessage message={MICROSOFT_REJECTED_MESSAGE} />}
      {microsoft && (
        <Button
          size="lg"
          className="w-full"
          disabled={redirecting || !online}
          onClick={signInWithMicrosoft}
        >
          {redirecting ? "Åpner Microsoft …" : "Logg inn med Microsoft"}
        </Button>
      )}
      {microsoft && !showCode && (
        <Button
          variant="secondary"
          className="w-full"
          disabled={!online}
          onClick={() => setShowCode(true)}
        >
          Logg inn med kode i stedet
        </Button>
      )}
      {showCode && codeForm}
    </div>
  );
}
