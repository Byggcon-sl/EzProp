"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

/**
 * Menypunkt i rammen. Klientdelen trengs bare for å vite stien, slik at det aktive punktet får
 * `aria-current="page"`. Med `matchChildren` er punktet også aktivt på sidene under.
 */
export function NavLink({
  href,
  matchChildren = false,
  children,
}: {
  href: string;
  matchChildren?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const active = pathname === href || (matchChildren && pathname.startsWith(`${href}/`));
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-11 min-w-11 items-center gap-2 rounded-[10px] px-4 text-sm lg:gap-2.5 lg:px-3",
        active
          ? "bg-brand-100 font-medium text-brand-900"
          : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-brand-50 lg:bg-transparent lg:ring-0 lg:hover:bg-white",
      )}
    >
      {children}
    </Link>
  );
}
