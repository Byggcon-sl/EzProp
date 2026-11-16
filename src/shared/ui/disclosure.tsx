"use client";

import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

function TrashIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="shrink-0 text-stone"
    >
      <path d="M4 7h16" />
      <path d="M9 7V4.5h6V7" />
      <path d="M6.5 7l1 13h9l1-13" />
      <path d="M10 11v5.5M14 11v5.5" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="ml-auto shrink-0 text-night transition-transform group-open:rotate-180 motion-reduce:transition-none"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/**
 * Sammenfoldet del på `<details>`/`<summary>` (docs/funksjoner/fase2a-papirkurv-design.md 4.2):
 * tastatur og skjermleser følger med fra nettleseren. Lukket som standard. Med `open` er delen
 * styrt; `onOpenChange` får ny tilstand når den åpnes eller lukkes. `id` står på `<details>`, så
 * andre deler av siden kan åpne den (for eksempel «Mer i papirkurven» i angre-meldingen).
 */
export function Disclosure({
  id,
  title,
  open,
  onOpenChange,
  icon = "trash",
  className,
  children,
}: {
  id: string;
  title: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  icon?: "trash" | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details
      id={id}
      open={open}
      onToggle={(event) => onOpenChange?.(event.currentTarget.open)}
      className={cn("group rounded-card border border-line bg-white", className)}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-card px-6 py-3 text-base font-semibold text-night [&::-webkit-details-marker]:hidden">
        {icon === "trash" && <TrashIcon />}
        <span className="min-w-0 break-words">{title}</span>
        <ChevronIcon />
      </summary>
      <div className="border-t border-line">{children}</div>
    </details>
  );
}
