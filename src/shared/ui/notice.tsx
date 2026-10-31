/** Kvittering etter lagring. Leses opp av skjermleser. Speil av `FormMessage` (som er for feil). */
export function Notice({ message }: { message: string }) {
  return (
    <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
      {message}
    </p>
  );
}
