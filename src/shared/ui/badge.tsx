import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

const tones = {
  neutral: "bg-sand text-slate-700",
  brand: "bg-brand-50 text-brand-700",
  warning: "bg-watch-fill text-watch-text",
  danger: "bg-urgent-fill text-urgent-text",
} as const;

/** Lite merke (rolle, «Sluttet», «Forsikring utløpt», «Forfalt»). Teksten bærer alltid meningen, ikke fargen. */
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
