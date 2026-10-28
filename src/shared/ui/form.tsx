import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

export function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "block min-h-11 w-full rounded-xl border border-field bg-white px-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-brand-600",
        className,
      )}
      {...props}
    />
  );
}

/** Feilmelding knyttet til et skjema. Leses opp av skjermleser. */
export function FormMessage({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
      {message}
    </p>
  );
}
