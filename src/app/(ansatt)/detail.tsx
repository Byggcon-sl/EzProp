import Link from "next/link";
import type { ReactNode } from "react";

/** Én opplysning i en `<dl>` (visning uten skjema, for eksempel for takstmann uten endringsrett). */
export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-t border-slate-200 py-3 first:border-t-0 first:pt-0 last:pb-0">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="mt-0.5 break-words whitespace-pre-line text-slate-900">{children}</dd>
    </div>
  );
}

export const EMPTY = <span className="text-slate-500">Ikke oppgitt</span>;

/** «‹ Tilbake til …» øverst på en underside. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700"
    >
      <span aria-hidden="true">‹&nbsp;</span>
      {children}
    </Link>
  );
}
