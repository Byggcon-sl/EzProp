import Link from "next/link";

/**
 * Kvittering etter lagring. Leses opp av skjermleser. Speil av `FormMessage` (som er for feil).
 * Sand, ikke grønn: kvitteringen skal ikke konkurrere med TG0 (Byggcon-profilen avsnitt 4.4).
 * Valgfri `link` står etter meldingen i samme avsnitt, for eksempel neste steg etter lagring
 * (fjord-dark på sand holder 4,5:1). Uten `link` er kvitteringen som før.
 */
export function Notice({
  message,
  link,
}: {
  message: string;
  link?: { href: string; label: string };
}) {
  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-xl bg-sand px-4 py-3 text-sm text-slate-900"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        className="mt-0.5 shrink-0"
      >
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
      <span>
        {message}
        {link && (
          <>
            {" "}
            <Link
              href={link.href}
              className="inline-flex min-h-11 items-center font-medium text-fjord-dark underline"
            >
              {link.label}
              <span aria-hidden="true">&nbsp;›</span>
            </Link>
          </>
        )}
      </span>
    </p>
  );
}
