"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/core/auth/auth-client";
import { Button } from "@/shared/ui/button";
import { Field, FormMessage, Input } from "@/shared/ui/form";
import { DEFAULT_NEXT_PATH, safeNextPath } from "./safe-next-path";

const TOO_MANY_ATTEMPTS = "For mange forsøk på kort tid. Vent ett minutt og prøv igjen.";

/**
 * Innlogging i to steg: e-postadresse, så koden fra e-posten.
 * `next` er siden brukeren sendes til etter riktig kode (sjekkes på nytt her).
 */
export function LoginForm({ next = DEFAULT_NEXT_PATH }: { next?: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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
          ? TOO_MANY_ATTEMPTS
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
          ? TOO_MANY_ATTEMPTS
          : error.code === "TOO_MANY_ATTEMPTS" || error.code === "OTP_EXPIRED"
            ? "Koden er ikke lenger gyldig. Be om en ny kode."
            : "Koden stemmer ikke. Sjekk e-posten og prøv igjen.",
      );
      return;
    }
    router.replace(safeNextPath(next));
    router.refresh();
  }

  if (step === "code") {
    return (
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
        <Button type="submit" size="lg" disabled={pending} className="w-full">
          {pending ? "Logger inn …" : "Logg inn"}
        </Button>
        <Button variant="ghost" className="w-full" onClick={() => setStep("email")}>
          Bruk en annen e-postadresse
        </Button>
      </form>
    );
  }

  return (
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
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? "Sender …" : "Send meg en kode"}
      </Button>
    </form>
  );
}
