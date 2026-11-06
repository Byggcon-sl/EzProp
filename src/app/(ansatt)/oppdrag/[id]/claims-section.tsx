import Link from "next/link";
import { buttonVariants } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { Card } from "@/shared/ui/card";

/** En sak i listen, ferdig med norske etiketter. */
export type ClaimListItem = {
  id: string;
  /** Mottatt dato som «ÅÅÅÅ-MM-DD». */
  receivedAt: string;
  typeLabel: string;
  description: string;
  open: boolean;
  outcomeLabel: string;
};

const SHORT_DESCRIPTION = 80;

/** «ÅÅÅÅ-MM-DD» som «dd.mm.åååå». Ugyldig verdi vises som den er. */
export function formatClaimDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : isoDate;
}

/** Beskrivelsen avkortet til én kort linje. */
export function shortDescription(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > SHORT_DESCRIPTION ? `${flat.slice(0, SHORT_DESCRIPTION - 1)}…` : flat;
}

/**
 * Delen «Reklamasjoner» nederst på oppdraget. Vises bare for den som kan se sakene; om knappen
 * «Registrer reklamasjon» vises, avgjøres av flagget fra kjernen (`canManage`).
 */
export function ClaimsSection({
  assignmentId,
  claims,
  canManage,
}: {
  assignmentId: string;
  claims: ClaimListItem[];
  canManage: boolean;
}) {
  return (
    <section aria-labelledby="claims-heading" className="mt-8">
      <h2 id="claims-heading" className="mb-3 text-xl font-semibold text-slate-900">
        Reklamasjoner
      </h2>
      {claims.length === 0 ? (
        <p className="mb-4 text-slate-600">Ingen reklamasjoner er registrert.</p>
      ) : (
        <Card className="mb-4 p-0">
          <ul>
            {claims.map((claim) => (
              <li key={claim.id} className="border-t border-slate-200 first:border-t-0">
                <Link
                  href={`/oppdrag/${assignmentId}/reklamasjoner/${claim.id}`}
                  className="flex min-h-11 flex-col gap-1 px-6 py-4 hover:bg-slate-50"
                >
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium text-slate-900 tabular-nums">
                      {formatClaimDate(claim.receivedAt)}
                    </span>
                    <span className="text-slate-700">{claim.typeLabel}</span>
                    <Badge tone={claim.open ? "warning" : "neutral"}>
                      {claim.open ? "Åpen" : `Lukket (${claim.outcomeLabel})`}
                    </Badge>
                  </span>
                  <span className="break-words text-slate-600">
                    {shortDescription(claim.description)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {canManage && (
        <Link
          href={`/oppdrag/${assignmentId}/reklamasjoner/ny`}
          className={buttonVariants({ variant: "secondary", size: "md" })}
        >
          Registrer reklamasjon
        </Link>
      )}
    </section>
  );
}
