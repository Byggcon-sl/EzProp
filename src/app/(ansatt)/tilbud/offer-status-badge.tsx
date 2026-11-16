import type { OfferDisplayStatus } from "@/core/orders/codes";
import { Badge } from "@/shared/ui/badge";
import { formatIsoDate } from "./received-at";

/*
 * Merkene på tilbudet (docs/funksjoner/fase2a-tilbud-design.md avsnitt 3.5). Bare visning: status,
 * dato og dager igjen regnes ut i kjernen (`offerDisplayStatus`, `offerDaysLeft`) og sendes inn.
 * Ingen import av kjernen her, så merket kan brukes både på serveren og i klientdeler.
 * Teksten bærer meningen; fargen er bare hjelp. Gult (watch) betyr bare «går ut snart» (A370).
 */

/** Teksten for hver visningsstatus. En ny kode uten tekst gir feil i typesjekken og testen. */
export const OFFER_DISPLAY_STATUS_LABELS: Record<OfferDisplayStatus, string> = {
  open: "Åpent",
  expired: "Utløpt",
  rejected: "Avslått",
  converted: "Gjort om til oppdrag",
};

const TONES: Record<OfferDisplayStatus, "brand" | "neutral"> = {
  open: "brand",
  expired: "neutral",
  rejected: "neutral",
  converted: "neutral",
};

/**
 * «Går ut i dag», «Går ut i morgen» eller «Går ut om N dager» når `daysLeft` er fra 0 til
 * `soonDays`, ellers `null` (ingen merke). `soonDays` er `OFFER_EXPIRING_SOON_DAYS` fra kjernen.
 */
export function offerExpiryText(daysLeft: number | null, soonDays: number): string | null {
  if (daysLeft === null || daysLeft < 0 || daysLeft > soonDays) return null;
  if (daysLeft === 0) return "Går ut i dag";
  if (daysLeft === 1) return "Går ut i morgen";
  return `Går ut om ${daysLeft} dager`;
}

/**
 * Skal «Forleng 30 dager» vises (F1, A365)? Ja for utløpte tilbud og åpne med 0 til `soonDays`
 * dager igjen; aldri for avslåtte og gjort-om. Rettigheten sjekkes i kjernen; siden skjuler
 * knappen i tillegg uten `canEditOrders`.
 */
export function canExtendOffer(
  displayStatus: OfferDisplayStatus,
  daysLeft: number | null,
  soonDays: number,
): boolean {
  if (displayStatus === "expired") return true;
  return displayStatus === "open" && offerExpiryText(daysLeft, soonDays) !== null;
}

/** Teksten i statusmerket: «Utløpt 14.11.2026» for utløpte, ellers etiketten. */
export function offerStatusText(displayStatus: OfferDisplayStatus, validUntil: string): string {
  const label = OFFER_DISPLAY_STATUS_LABELS[displayStatus];
  return displayStatus === "expired" ? `${label} ${formatIsoDate(validUntil)}` : label;
}

function ClockIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/**
 * Statusmerket på et tilbud. Et åpent tilbud med 0–7 dager igjen får «Går ut …» (watch, med
 * klokke) i stedet for «Åpent», så raden ikke får to merker.
 */
export function OfferStatusBadge({
  displayStatus,
  validUntil,
  expiryText = null,
}: {
  displayStatus: OfferDisplayStatus;
  /** «ÅÅÅÅ-MM-DD». */
  validUntil: string;
  /** Fra `offerExpiryText`. Brukes bare når tilbudet er åpent. */
  expiryText?: string | null;
}) {
  if (displayStatus === "open" && expiryText) {
    return (
      <Badge tone="warning">
        <ClockIcon />
        {expiryText}
      </Badge>
    );
  }
  return <Badge tone={TONES[displayStatus]}>{offerStatusText(displayStatus, validUntil)}</Badge>;
}
