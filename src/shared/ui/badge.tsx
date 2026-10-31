import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

const tones = {
  neutral: "bg-slate-100 text-slate-700",
  brand: "bg-brand-50 text-brand-700",
  warning: "bg-amber-50 text-amber-900",
} as const;

/** Lite merke (rolle, «Sluttet», «Forsikring utløpt»). Teksten bærer alltid meningen, ikke fargen. */
export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof tones;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium whitespace-nowrap",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}
