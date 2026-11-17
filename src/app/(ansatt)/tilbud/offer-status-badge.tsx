import { offerDisplayStatusLabel, type OfferDisplayStatus } from "@/core/orders/codes";
import { Badge } from "@/shared/ui/badge";
import { formatIsoDate } from "./received-at";

/*
 * Merkene på tilbudet (docs/funksjoner/fase2a-tilbud-design.md avsnitt 3.5). Bare visning: status
 * og «Går ut …» regnes ut i kjernen (`offerDisplayStatus`, `offerExpiresLabel`) og sendes inn.
 * Bare den rene kodefilen fra kjernen importeres, så merket kan brukes også i klientdeler.
 * Teksten bærer meningen; fargen er bare hjelp. Gult (watch) betyr bare «går ut snart» (A370).
 */

const TONES: Record<OfferDisplayStatus, "brand" | "neutral"> = {
  open: "brand",
  expired: "neutral",
  rejected: "neutral",
  converted: "neutral",
};

/** Teksten i statusmerket: «Utløpt 14.11.2026» for utløpte, ellers etiketten. */
export function offerStatusText(displayStatus: OfferDisplayStatus, validUntil: string): string {
  const label = offerDisplayStatusLabel(displayStatus);
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
  /** Fra `offerExpiresLabel` i kjernen. Brukes bare når tilbudet er åpent. */
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
