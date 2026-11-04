"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button, buttonVariants } from "@/shared/ui/button";
import { FormMessage } from "@/shared/ui/form";
import type { FormState } from "./form-state";

/** Lagre-knappen. Viser «Lagrer …» og er låst mens skjemaet sendes. */
export function SubmitButton({
  children,
  variant = "primary",
  size = "lg",
  disabled = false,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary";
  size?: "md" | "lg";
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} disabled={disabled || pending}>
      {pending ? "Lagrer …" : children}
    </Button>
  );
}

/** «Lagre» og «Avbryt» nederst i et skjema. */
export function FormActions({ cancelHref }: { cancelHref: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 pt-2">
      <SubmitButton>Lagre</SubmitButton>
      <Link href={cancelHref} className={buttonVariants({ variant: "ghost", size: "md" })}>
        Avbryt
      </Link>
    </div>
  );
}

/** Meldingen øverst i skjemaet. Får fokus etter hvert mislykket forsøk. */
export function FormErrors({ state }: { state: FormState }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.attempt > 0) ref.current?.focus();
  }, [state.attempt]);
  if (!state.message) return null;
  return (
    <div ref={ref} tabIndex={-1}>
      <FormMessage message={state.message} />
    </div>
  );
}
