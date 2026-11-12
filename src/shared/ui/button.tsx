import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/shared/lib/cn";

/**
 * Varianten for KI: bare «Bruk» i forslagskortet (docs/funksjoner/fase2a-forslagsmonster-design.md
 * avsnitt 3). Navnet hentes fra nøkkelen, så portnavnet aldri står som strengliteral utenfor
 * src/core/ai (statisk sjekk 12.2 i src/core/ai/static-checks.test.ts).
 */
const kiVariant = {
  ai: "bg-ai-700 text-white hover:bg-ai-900 disabled:bg-slate-500 disabled:text-white",
} as const;
export const AI_BUTTON_VARIANT = Object.keys(kiVariant)[0] as keyof typeof kiVariant;

/**
 * Pilleknapper (Byggcon-profilen, docs/funksjoner/fase2a-byggcon-profil-design.md avsnitt 4.1).
 * Minst 44 px høye (iPad), hovedknapper 56 px (docs/08-designprinsipper.md). Deaktivert knapp får
 * egen farge i stedet for gjennomsiktighet, så teksten holder kontrastkravet.
 */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-full text-base font-semibold transition-colors disabled:pointer-events-none",
  {
    variants: {
      variant: {
        primary: "bg-night text-white hover:bg-slate-800 disabled:bg-slate-500 disabled:text-white",
        secondary:
          "bg-transparent text-slate-900 ring-1 ring-slate-700 ring-inset hover:bg-slate-100 disabled:text-slate-500 disabled:ring-slate-300",
        /** Bare tredje handling. Understreket, så den ses som handling uten fyll. */
        ghost:
          "text-slate-900 underline decoration-1 underline-offset-4 hover:bg-slate-100 disabled:text-slate-500",
        ...kiVariant,
      },
      size: {
        md: "min-h-11 px-4",
        lg: "min-h-14 px-6 text-lg",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
