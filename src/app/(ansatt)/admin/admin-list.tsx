import Link from "next/link";
import type { ReactNode } from "react";
import { buttonVariants } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Notice } from "@/shared/ui/notice";

/** Overskrift med hovedknapp og kvittering øverst på en listeside. */
export function ListHeader({
  title,
  actionLabel,
  actionHref,
  notice,
}: {
  title: string;
  actionLabel: string;
  actionHref: string;
  notice: string | null;
}) {
  return (
    <>
      {notice && (
        <div className="mb-4">
          <Notice message={notice} />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        <Link href={actionHref} className={buttonVariants({ variant: "primary", size: "md" })}>
          {actionLabel}
        </Link>
      </div>
    </>
  );
}

/** Kort med en liste der hver rad er én lenke. */
export function RowList({ children }: { children: ReactNode }) {
  return (
    <Card className="mt-6 overflow-hidden p-0">
      <ul>{children}</ul>
    </Card>
  );
}

/** Rad i en liste. Hele raden er trykkflaten (minst 56 px). */
export function Row({
  href,
  title,
  muted = false,
  children,
}: {
  href: string;
  title: string;
  muted?: boolean;
  children?: ReactNode;
}) {
  return (
    <li className="border-t border-slate-200 first:border-t-0">
      <Link
        href={href}
        className="flex min-h-14 items-center gap-3 px-5 py-3 hover:bg-brand-50 focus-visible:-outline-offset-2"
      >
        <span className="min-w-0 flex-1 break-words">
          <span
            className={
              muted ? "block font-medium text-slate-600" : "block font-medium text-slate-900"
            }
          >
            {title}
          </span>
          {children}
        </span>
        <span className="shrink-0 text-sm font-medium text-brand-700">
          Endre<span className="sr-only"> {title}</span> <span aria-hidden="true">›</span>
        </span>
      </Link>
    </li>
  );
}

/** Tomt kort når listen er tom. */
export function EmptyList({ text }: { text: string }) {
  return (
    <Card className="mt-6">
      <p className="text-slate-600">{text}</p>
    </Card>
  );
}

/** Lenken tilbake og overskriften på en skjemaside. */
export function FormHeader({
  title,
  backHref,
  backLabel,
}: {
  title: string;
  backHref: string;
  backLabel: string;
}) {
  return (
    <>
      <Link
        href={backHref}
        className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700"
      >
        <span aria-hidden="true">‹&nbsp;</span>
        {backLabel}
      </Link>
      <h1 className="mt-2 mb-6 text-2xl font-semibold text-slate-900">{title}</h1>
    </>
  );
}
