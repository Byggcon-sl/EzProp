/**
 * Kvittering etter lagring. Leses opp av skjermleser. Speil av `FormMessage` (som er for feil).
 * Sand, ikke grønn: kvitteringen skal ikke konkurrere med TG0 (Byggcon-profilen avsnitt 4.4).
 */
export function Notice({ message }: { message: string }) {
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
      <span>{message}</span>
    </p>
  );
}
