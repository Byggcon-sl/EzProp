import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/shared/lib/cn";

/** Knapper. Minst 44 px høye (iPad), hovedknapper 56 px (docs/08-designprinsipper.md). */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-xl text-base font-medium transition-colors disabled:pointer-events-none disabled:opacity-60",
  {
    variants: {
      variant: {
        primary: "bg-brand-600 text-white shadow-sm hover:bg-brand-700",
        secondary:
          "bg-white text-slate-900 shadow-sm ring-1 ring-slate-300 ring-inset hover:bg-slate-50",
        ghost: "text-slate-700 hover:bg-slate-100",
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
