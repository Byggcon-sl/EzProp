import { cloneElement, isValidElement, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

/** `aria-describedby` for hjelpetekst og feil under et felt eller en gruppe. */
function describedBy(id: string, hint?: ReactNode, error?: string) {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

function Hint({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={`${id}-hint`} className="text-sm text-slate-600">
      {children}
    </p>
  );
}

function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <p id={`${id}-error`} className="text-sm text-red-800">
      <span className="sr-only">Feil: </span>
      {message}
    </p>
  );
}

/**
 * Etikett, felt, hjelpetekst og feil. Feltet (barnet) får `aria-describedby` med hjelpeteksten og
 * feilen, og `aria-invalid` ved feil.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  const description = describedBy(htmlFor, hint, error);
  const control =
    isValidElement<{ "aria-describedby"?: string; "aria-invalid"?: boolean }>(children) &&
    description
      ? cloneElement(children, {
          "aria-describedby": description,
          "aria-invalid": error ? true : undefined,
        })
      : children;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      {control}
      {hint && <Hint id={htmlFor}>{hint}</Hint>}
      {error && <FieldError id={htmlFor} message={error} />}
    </div>
  );
}

const fieldClass =
  "block w-full rounded-xl border border-field bg-white px-3 text-base text-slate-900 placeholder:text-slate-500 focus:border-brand-600 disabled:bg-slate-100 disabled:text-slate-600 aria-invalid:border-red-700";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(fieldClass, "min-h-11", className)} {...props} />;
}

/** Tekstfelt over flere linjer. Samme stil som `Input`. */
export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(fieldClass, "min-h-32 resize-y py-2.5", className)} {...props} />;
}

type ChoiceProps = Omit<ComponentProps<"input">, "type"> & {
  label: ReactNode;
  description?: ReactNode;
};

function Choice({
  type,
  label,
  description,
  className,
  ...props
}: ChoiceProps & { type: "checkbox" | "radio" }) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-start gap-3 py-2.5 has-disabled:cursor-default",
        className,
      )}
    >
      <input type={type} className="mt-0.5 size-5 shrink-0 accent-brand-600" {...props} />
      <span className="min-w-0 break-words">
        <span className="block text-base text-slate-900">{label}</span>
        {description && <span className="block text-sm text-slate-600">{description}</span>}
      </span>
    </label>
  );
}

/** Avkryssingsboks. Hele raden (boks og tekst) er trykkflaten, minst 44 px høy. */
export function Checkbox(props: ChoiceProps) {
  return <Choice type="checkbox" {...props} />;
}

/** Radioknapp. Hele raden er trykkflaten, minst 44 px høy. */
export function Radio(props: ChoiceProps) {
  return <Choice type="radio" {...props} />;
}

/** Gruppe av `Checkbox` eller `Radio` med gruppenavn (`legend`), hjelpetekst og feil. */
export function ChoiceGroup({
  id,
  legend,
  hint,
  error,
  columns = false,
  disabled,
  children,
}: {
  id: string;
  legend: string;
  hint?: ReactNode;
  error?: string;
  /** To kolonner fra `md`. */
  columns?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <fieldset
      aria-describedby={describedBy(id, hint, error)}
      aria-invalid={error ? true : undefined}
      disabled={disabled}
      className="min-w-0 space-y-1.5"
    >
      <legend className="text-sm font-medium text-slate-700">{legend}</legend>
      {hint && <Hint id={id}>{hint}</Hint>}
      <div className={cn("grid", columns && "md:grid-cols-2 md:gap-x-5")}>{children}</div>
      {error && <FieldError id={id} message={error} />}
    </fieldset>
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
